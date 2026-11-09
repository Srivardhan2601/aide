"""Study planner, people notes, search, backup/restore and auto-send settings.

Kept out of main.py so that file stays about the reply queue. register() adds the routes.
"""
from __future__ import annotations

import json
import logging
from datetime import date, datetime

from fastapi import FastAPI, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field

from . import planner
from .config import BACKEND_DIR, load_json, save_json
from .db import DB, iso, utcnow

log = logging.getLogger("aide.extras")

BACKUP_VERSION = 1
BACKUP_TABLES = ["messages", "approvals", "sent", "daily_stats", "learned_examples", "food_orders", "deadlines",
                 "gmail_links", "kv", "study_subjects", "study_sessions", "people"]
PRIVATE_KV = {"pair_pin", "devices"}  # phone pairing secrets never leave this computer
CONFIG_FILES = ["style_profile.json", "rules.json", "food_profile.json"]
BACKUP_DIR = BACKEND_DIR / "backups"   # git-ignored


# ===== Request bodies ========================================================
class SubjectIn(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    name: str = Field(min_length=1, max_length=80)
    exam_date: date = Field(alias="examDate")
    topics: list[str] = Field(default_factory=list, max_length=60)
    minutes_per_topic: int = Field(default=60, alias="minutesPerTopic", ge=15, le=240)


class SubjectPatch(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    name: str | None = Field(default=None, min_length=1, max_length=80)
    exam_date: date | None = Field(default=None, alias="examDate")
    topics: list[str] | None = Field(default=None, max_length=60)
    minutes_per_topic: int | None = Field(default=None, alias="minutesPerTopic", ge=15, le=240)


class StudySettingsIn(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    daily_minutes: int = Field(alias="dailyMinutes", ge=30, le=720)


class SessionPatch(BaseModel):
    done: bool


class PersonIn(BaseModel):
    notes: str = Field(default="", max_length=1000)


class AutoSendIn(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    enabled: bool | None = None
    daily_cap: int | None = Field(default=None, alias="dailyCap", ge=1, le=50)


AUTOSEND_DEFAULTS = {"enabled": False, "daily_cap": 10}


def _clean_topics(topics: list[str]) -> list[str]:
    out, seen = [], set()
    for t in topics:
        t = " ".join(t.split())[:120]
        if t and t.casefold() not in seen:
            seen.add(t.casefold())
            out.append(t)
    return out


def register(app: FastAPI, db: DB, local_only) -> dict:
    """Adds the routes. Returns helpers main.py needs (study for the brief, notes for drafting, auto-send)."""

    # ===== Study planner ======================================================
    def study_settings() -> dict:
        return {"daily_minutes": 240, **(db.get_setting("study", {}) or {})}

    def subjects() -> list[dict]:
        with db.lock:
            rows = db.conn.execute("SELECT * FROM study_subjects ORDER BY exam_date, id").fetchall()
        return [{**dict(r), "topics": json.loads(r["topics"]), "exam_date": date.fromisoformat(r["exam_date"])} for r in rows]

    def replan() -> list[str]:
        """Rebuild every future session. Done sessions stay; missed ones are rescheduled from today."""
        today = datetime.now().date()
        with db.lock:
            done_rows = db.conn.execute("SELECT subject_id, topic, kind FROM study_sessions WHERE done = 1").fetchall()
            done = {(r["subject_id"], r["topic"], r["kind"]) for r in done_rows}
            sessions, warnings = planner.build_plan(subjects(), today, study_settings()["daily_minutes"], done)
            db.conn.execute("DELETE FROM study_sessions WHERE done = 0")
            db.conn.executemany(
                "INSERT INTO study_sessions (subject_id, subject, topic, kind, day, minutes) VALUES (?, ?, ?, ?, ?, ?)",
                [(s["subject_id"], s["subject"], s["topic"], s["kind"], s["day"].isoformat(), s["minutes"]) for s in sessions])
            db.conn.commit()
        db.set_setting("study_warnings", warnings)
        return warnings

    def session_json(r) -> dict:
        return {"id": r["id"], "subjectId": r["subject_id"], "subject": r["subject"], "topic": r["topic"],
                "kind": r["kind"], "day": r["day"], "minutes": r["minutes"], "done": bool(r["done"])}

    def sessions_from(day: str) -> list[dict]:
        with db.lock:
            rows = db.conn.execute("SELECT * FROM study_sessions WHERE day >= ? OR done = 1 ORDER BY day, kind DESC, id",
                                   (day,)).fetchall()
        return [session_json(r) for r in rows]

    def study_today() -> list[dict]:
        today = datetime.now().date().isoformat()
        with db.lock:
            rows = db.conn.execute("SELECT * FROM study_sessions WHERE day = ? ORDER BY kind DESC, id", (today,)).fetchall()
        return [session_json(r) for r in rows]

    def subject_json(s: dict) -> dict:
        return {"id": s["id"], "name": s["name"], "examDate": s["exam_date"].isoformat(), "topics": s["topics"],
                "minutesPerTopic": s["minutes_per_topic"]}

    @app.get("/api/study")
    def get_study():
        today = datetime.now().date()
        subs = subjects()
        planned = {s["name"].casefold() for s in subs}
        # Exams Aide found in your messages that aren't in the plan yet.
        suggestions = [{"title": r["title"], "dueDate": r["due_date"]} for r in db.list_deadlines()
                       if r["kind"] == "exam" and r["due_date"] > today.isoformat()
                       and not any(p in r["title"].casefold() for p in planned)]
        return {"settings": {"dailyMinutes": study_settings()["daily_minutes"]},
                "subjects": [subject_json(s) for s in subs],
                "sessions": [s for s in sessions_from(today.isoformat())],
                "today": study_today(),
                "warnings": db.get_setting("study_warnings", []) or [],
                "suggestions": suggestions[:5]}

    @app.post("/api/study/subjects", status_code=201)
    def add_subject(body: SubjectIn):
        with db.lock:
            db.conn.execute(
                "INSERT INTO study_subjects (name, exam_date, topics, minutes_per_topic, created_at) VALUES (?, ?, ?, ?, ?)",
                (" ".join(body.name.split()), body.exam_date.isoformat(), json.dumps(_clean_topics(body.topics)),
                 body.minutes_per_topic, iso(utcnow())))
            db.conn.commit()
        replan()
        return get_study()

    @app.patch("/api/study/subjects/{subject_id}")
    def edit_subject(subject_id: int, body: SubjectPatch):
        fields = {}
        for k in body.model_fields_set:
            v = getattr(body, k)
            if v is None:
                continue
            fields[k] = (v.isoformat() if isinstance(v, date) else json.dumps(_clean_topics(v)) if k == "topics"
                         else " ".join(v.split()) if isinstance(v, str) else v)
        with db.lock:
            if not db.conn.execute("SELECT 1 FROM study_subjects WHERE id = ?", (subject_id,)).fetchone():
                raise HTTPException(404, "Not found")
            if fields:
                db.conn.execute(f"UPDATE study_subjects SET {', '.join(f'{k} = ?' for k in fields)} WHERE id = ?",
                                (*fields.values(), subject_id))
                if "name" in fields:
                    db.conn.execute("UPDATE study_sessions SET subject = ? WHERE subject_id = ?", (fields["name"], subject_id))
                db.conn.commit()
        replan()
        return get_study()

    @app.delete("/api/study/subjects/{subject_id}")
    def delete_subject(subject_id: int):
        with db.lock:
            db.conn.execute("DELETE FROM study_sessions WHERE subject_id = ?", (subject_id,))
            cur = db.conn.execute("DELETE FROM study_subjects WHERE id = ?", (subject_id,))
            db.conn.commit()
        if not cur.rowcount:
            raise HTTPException(404, "Not found")
        replan()
        return get_study()

    @app.put("/api/study/settings")
    def put_study_settings(body: StudySettingsIn):
        db.set_setting("study", {"daily_minutes": body.daily_minutes})
        replan()
        return get_study()

    @app.patch("/api/study/sessions/{session_id}")
    def tick_session(session_id: int, body: SessionPatch):
        with db.lock:
            cur = db.conn.execute("UPDATE study_sessions SET done = ? WHERE id = ?", (int(body.done), session_id))
            db.conn.commit()
        if not cur.rowcount:
            raise HTTPException(404, "Not found")
        return get_study()

    @app.post("/api/study/replan")
    def post_replan():
        replan()
        return get_study()

    # ===== People notes =======================================================
    def notes_for(sender: str) -> str:
        with db.lock:
            r = db.conn.execute("SELECT notes FROM people WHERE name = ?", (sender,)).fetchone()
        return r["notes"] if r else ""

    @app.get("/api/people")
    def list_people():
        with db.lock:
            rows = db.conn.execute(
                """SELECT m.sender AS name, COUNT(*) AS messages, MAX(m.received_at) AS last,
                          GROUP_CONCAT(DISTINCT m.channel) AS channels, COALESCE(p.notes, '') AS notes
                   FROM messages m LEFT JOIN people p ON p.name = m.sender
                   GROUP BY m.sender COLLATE NOCASE ORDER BY last DESC LIMIT 200""").fetchall()
            extra = db.conn.execute(
                """SELECT name, notes FROM people WHERE name NOT IN (SELECT sender FROM messages) AND notes != ''""").fetchall()
        out = [{"name": r["name"], "messages": r["messages"], "last": r["last"],
                "channels": sorted(set((r["channels"] or "").split(","))), "notes": r["notes"]} for r in rows]
        out += [{"name": r["name"], "messages": 0, "last": None, "channels": [], "notes": r["notes"]} for r in extra]
        return out

    @app.put("/api/people/{name}")
    def put_person(name: str, body: PersonIn):
        name = " ".join(name.split())[:200]
        if not name:
            raise HTTPException(422, "Name required")
        notes = body.notes.strip()
        with db.lock:
            if notes:
                db.conn.execute("""INSERT INTO people (name, notes, updated_at) VALUES (?, ?, ?)
                                   ON CONFLICT(name) DO UPDATE SET notes = excluded.notes, updated_at = excluded.updated_at""",
                                (name, notes, iso(utcnow())))
            else:
                db.conn.execute("DELETE FROM people WHERE name = ?", (name,))
            db.conn.commit()
        return {"name": name, "notes": notes}

    # ===== Search =============================================================
    @app.get("/api/search")
    def search(q: str = Query(min_length=2, max_length=100)):
        like = f"%{q.strip()}%"
        with db.lock:
            msgs = db.conn.execute(
                """SELECT id, channel, sender, original, draft, status, created_at FROM approvals
                   WHERE original LIKE ? OR draft LIKE ? OR sender LIKE ? ORDER BY created_at DESC LIMIT 20""",
                (like, like, like)).fetchall()
            dls = db.conn.execute(
                "SELECT * FROM deadlines WHERE title LIKE ? OR sender LIKE ? ORDER BY due_date DESC LIMIT 10", (like, like)).fetchall()
            food = db.conn.execute(
                "SELECT * FROM food_orders WHERE request LIKE ? OR restaurant LIKE ? OR items LIKE ? ORDER BY created_at DESC LIMIT 10",
                (like, like, like)).fetchall()
            people = db.conn.execute("SELECT * FROM people WHERE name LIKE ? OR notes LIKE ? LIMIT 10", (like, like)).fetchall()
            study = db.conn.execute(
                "SELECT * FROM study_subjects WHERE name LIKE ? OR topics LIKE ? LIMIT 10", (like, like)).fetchall()
        return {
            "query": q,
            "messages": [{"id": r["id"], "channel": r["channel"], "from": r["sender"], "text": r["original"],
                          "reply": r["draft"], "status": r["status"], "at": r["created_at"]} for r in msgs],
            "deadlines": [{"id": r["id"], "title": r["title"], "kind": r["kind"], "dueDate": r["due_date"],
                           "done": bool(r["done"])} for r in dls],
            "food": [{"id": r["id"], "request": r["request"], "restaurant": r["restaurant"], "status": r["status"],
                      "at": r["created_at"]} for r in food],
            "people": [{"name": r["name"], "notes": r["notes"]} for r in people],
            "study": [{"id": r["id"], "name": r["name"], "examDate": r["exam_date"]} for r in study],
        }

    # ===== Backup / restore (this computer only) ==============================
    def export() -> dict:
        data = {"app": "aide", "version": BACKUP_VERSION, "exportedAt": iso(utcnow()), "tables": {}, "config": {}}
        with db.lock:
            for t in BACKUP_TABLES:
                rows = [dict(r) for r in db.conn.execute(f"SELECT * FROM {t}")]
                if t == "kv":
                    rows = [r for r in rows if r["key"] not in PRIVATE_KV]
                data["tables"][t] = rows
        for name in CONFIG_FILES:
            try:
                data["config"][name] = load_json(name)
            except FileNotFoundError:
                pass
        return data

    @app.get("/api/backup")
    def backup(request: Request):
        local_only(request)
        from fastapi.responses import Response
        stamp = datetime.now().strftime("%Y-%m-%d_%H%M")
        return Response(json.dumps(export(), ensure_ascii=False, indent=1), media_type="application/json",
                        headers={"Content-Disposition": f'attachment; filename="aide-backup-{stamp}.json"'})

    @app.post("/api/backup/restore")
    async def restore(request: Request):
        """Replace everything with a backup. Saves a safety copy of the current data first."""
        local_only(request)
        try:
            data = json.loads(await request.body())
        except ValueError:
            raise HTTPException(422, "That file isn't a valid Aide backup") from None
        if not isinstance(data, dict) or data.get("app") != "aide" or data.get("version") != BACKUP_VERSION \
                or not isinstance(data.get("tables"), dict):
            raise HTTPException(422, "That file isn't a valid Aide backup")

        BACKUP_DIR.mkdir(exist_ok=True)
        safety = BACKUP_DIR / f"before-restore-{datetime.now().strftime('%Y-%m-%d_%H%M%S')}.json"
        safety.write_text(json.dumps(export(), ensure_ascii=False), encoding="utf-8")

        counts = {}
        with db.lock:
            try:
                db.conn.execute("PRAGMA foreign_keys = OFF")
                for t in BACKUP_TABLES:
                    rows = data["tables"].get(t, [])
                    if not isinstance(rows, list):
                        raise ValueError(t)
                    cols = {r["name"] for r in db.conn.execute(f"PRAGMA table_info({t})")}
                    if t == "kv":
                        db.conn.execute(f"DELETE FROM kv WHERE key NOT IN ({','.join('?' * len(PRIVATE_KV))})", tuple(PRIVATE_KV))
                        rows = [r for r in rows if r.get("key") not in PRIVATE_KV]
                    else:
                        db.conn.execute(f"DELETE FROM {t}")
                    for r in rows:
                        keep = {k: v for k, v in r.items() if k in cols}
                        if keep:
                            db.conn.execute(f"INSERT INTO {t} ({', '.join(keep)}) VALUES ({', '.join('?' * len(keep))})",
                                            tuple(keep.values()))
                    counts[t] = len(rows)
                db.conn.commit()
            except Exception as e:  # noqa: BLE001 - roll back to exactly what was there
                db.conn.rollback()
                raise HTTPException(422, f"Couldn't restore that backup ({type(e).__name__}). Nothing was changed.") from None
            finally:
                db.conn.execute("PRAGMA foreign_keys = ON")
        for name, content in (data.get("config") or {}).items():
            if name in CONFIG_FILES and isinstance(content, dict):
                save_json(name, content)
        log.info("Restored a backup (%s). Safety copy: %s", counts, safety)
        return {"restored": counts, "safetyCopy": safety.name}

    # ===== Auto-send settings =================================================
    def autosend() -> dict:
        return {**AUTOSEND_DEFAULTS, **(db.get_setting("autosend", {}) or {})}

    def autosend_json() -> dict:
        a = autosend()
        since = iso(datetime.combine(datetime.now().date(), datetime.min.time()).astimezone())
        return {"enabled": a["enabled"], "dailyCap": a["daily_cap"], "sentToday": db.auto_sent_since(since)}

    @app.get("/api/autosend")
    def get_autosend():
        return autosend_json()

    @app.put("/api/autosend")
    def put_autosend(body: AutoSendIn, request: Request):
        local_only(request)  # only from the computer running Aide
        a = autosend()
        if body.enabled is not None:
            a["enabled"] = body.enabled
        if body.daily_cap is not None:
            a["daily_cap"] = body.daily_cap
        db.set_setting("autosend", a)
        return autosend_json()

    return {"study_today": study_today, "notes_for": notes_for, "autosend": autosend}
