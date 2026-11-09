"""Aide backend: FastAPI app with the draft + approval queue API, serving aide-ui at "/".

Run:  uvicorn app.main:app --port 8000
"""
from __future__ import annotations

import asyncio
import logging
import re
import threading
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta
from typing import Literal

from fastapi import FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field

from .classifier import guess_group
from .config import BUCKET_LABELS, CHANNELS, MINUTES_PER_REPLY, Settings, load_json, load_profile, load_rules, save_json
from .db import DB, iso, local_day, parse_iso, streak, utcnow
from . import deadlines as deadlines_mod
from . import extras, food, phone
from . import gmail as gmail_mod
from .drafter import get_drafter
from .sender import send_reply

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("aide")

Status = Literal["pending", "sending", "sent", "rejected"]


# ===== Request bodies ========================================================
class MessageIn(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    channel: str
    sender: str = Field(alias="from", min_length=1, max_length=200)
    text: str = Field(min_length=1, max_length=10_000)


class EditIn(BaseModel):
    draft: str = Field(min_length=1, max_length=10_000)


class RegenerateIn(BaseModel):
    tone: Literal["shorter", "warmer", "formal"]


class ApproveIn(BaseModel):
    draft: str | None = Field(default=None, min_length=1, max_length=10_000)


class ProfileIn(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    form_of_address: str | None = Field(default=None, alias="formOfAddress", min_length=1, max_length=60)
    availability: str | None = Field(default=None, min_length=1, max_length=200)


class RulesIn(BaseModel):
    auto: list[str] = Field(default_factory=list, max_length=30)
    ask: list[str] = Field(default_factory=list, max_length=30)
    never: list[str] = Field(default_factory=list, max_length=30)


class SnoozeIn(BaseModel):
    until: datetime


class CaptureIn(BaseModel):
    text: str = Field(min_length=1, max_length=1000)


# "order 2 dosa from MTR", "get me a coffee", "...on swiggy" (but not "in order to submit")
FOOD_INTENT = re.compile(r"^\s*(?:please\s+)?(?:order|get me)\b|\b(?:swiggy|zomato)\b", re.I)
FOOD_INTENT_PREFIX = re.compile(r"^\s*(?:please\s+)?(?:order|get me)\s+(?:me\s+)?(?:some\s+)?", re.I)


class PairIn(BaseModel):
    pin: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")


class QuietIn(BaseModel):
    until: datetime | None = None          # null turns quiet mode off
    allow: list[str] | None = Field(default=None, max_length=20)


HHMM = r"^([01]\d|2[0-3]):[0-5]\d$"


class DeadlineIn(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    title: str = Field(min_length=1, max_length=120)
    kind: Literal["exam", "assignment", "meeting", "payment", "other"] = "other"
    due_date: date = Field(alias="dueDate")
    due_time: str | None = Field(default=None, alias="dueTime", pattern=HHMM)


class DeadlinePatch(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    title: str | None = Field(default=None, min_length=1, max_length=120)
    kind: Literal["exam", "assignment", "meeting", "payment", "other"] | None = None
    due_date: date | None = Field(default=None, alias="dueDate")
    due_time: str | None = Field(default=None, alias="dueTime", pattern=HHMM)
    done: bool | None = None


FoodApp = Literal["swiggy", "zomato"]


class FoodItem(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    qty: int = Field(default=1, ge=1, le=50)
    notes: str = Field(default="", max_length=200)


class FoodRequestIn(BaseModel):
    text: str = Field(min_length=1, max_length=1000)
    app: FoodApp | None = None


class FoodPatchIn(BaseModel):
    app: FoodApp | None = None
    restaurant: str | None = Field(default=None, max_length=120)
    budget: int | None = Field(default=None, ge=0, le=100_000)
    notes: str | None = Field(default=None, max_length=300)
    items: list[FoodItem] | None = Field(default=None, max_length=30)


class FoodProfileIn(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    area: str | None = Field(default=None, max_length=120)
    diet: Literal["no preference", "vegetarian", "eggetarian", "vegan"] | None = None
    spice: Literal["mild", "medium", "spicy"] | None = None
    budget_cap: int | None = Field(default=None, alias="budgetCap", ge=0, le=100_000)
    preferred_app: FoodApp | None = Field(default=None, alias="preferredApp")
    favorites: list[str] | None = Field(default=None, max_length=30)
    avoid: list[str] | None = Field(default=None, max_length=30)
    notes: str | None = Field(default=None, max_length=300)


FOOD_DEFAULTS = {"area": "", "diet": "no preference", "spice": "medium", "budget_cap": 500,
                 "preferred_app": "swiggy", "favorites": [], "avoid": [], "notes": ""}


def load_food_profile() -> dict:
    try:
        saved = load_json("food_profile.json")
    except FileNotFoundError:
        saved = {}
    return {**FOOD_DEFAULTS, **{k: v for k, v in saved.items() if not k.startswith("_")}}


def food_profile_json(p: dict) -> dict:
    return {"area": p["area"], "diet": p["diet"], "spice": p["spice"], "budgetCap": p["budget_cap"],
            "preferredApp": p["preferred_app"], "favorites": p["favorites"], "avoid": p["avoid"], "notes": p["notes"]}


def fmt_minutes(m: int) -> str:
    h, mm = divmod(m, 60)
    return f"{h}h {mm}m" if h and mm else f"{h}h" if h else f"{mm}m"


def _norm(s: str | None) -> str:
    return " ".join((s or "").split()).casefold()


def _clean_rules(items: list[str]) -> list[str]:
    out, seen = [], set()
    for t in items:
        t = " ".join(t.split())[:200]
        if t and _norm(t) not in seen:
            seen.add(_norm(t))
            out.append(t)
    return out


URGENT = re.compile(r"\b(urgent|asap|emergency|immediately|right now|hospital|accident|call me)\b", re.I)


def is_urgent(sender: str, text: str, allow: list[str] | tuple = ()) -> bool:
    """Urgent words, or a sender on your quiet-mode allow list (e.g. 'Mom', 'Professor')."""
    s = sender.casefold()
    return bool(URGENT.search(text)) or any(a.strip() and a.strip().casefold() in s for a in allow)


def approval_json(r, allow: list[str] | tuple = ()) -> dict:
    return {
        "urgent": is_urgent(r["sender"], r["original"], allow),
        "id": r["id"],
        "messageId": r["message_id"],
        "channel": r["channel"],
        "from": r["sender"],
        "original": r["original"],
        "draft": r["draft"],
        "tone": r["tone"],
        "bucket": r["bucket"],
        "bucketLabel": BUCKET_LABELS[r["bucket"]],
        "reason": r["reason"],
        "confidence": r["confidence"],
        "status": r["status"],
        "sendAt": r["send_at"],
        "createdAt": r["created_at"],
        "updatedAt": r["updated_at"],
        "snoozeUntil": r["snooze_until"],
        "autoSent": bool(r["auto_sent"]),
    }


# ===== App factory ===========================================================
def create_app(settings: Settings | None = None, drafter=None, gmail=None) -> FastAPI:
    settings = settings or Settings.from_env()
    db = DB(settings.db_path)
    drafter = drafter or get_drafter(settings.model, settings.fallbacks)
    if gmail is None and settings.gmail:
        gmail = gmail_mod.connect()  # None (with a clear log line) if not signed in yet
    # Recent replies you edited become examples of your voice for future drafts.
    drafter.learned_source = lambda: db.list_learned(limit=8)

    def learn_from(r) -> None:
        """If you changed Aide's draft before it was sent, remember your version."""
        final, ai = r["draft"], r["ai_draft"] or r["draft"]
        if r["bucket"] == "never" or len(final.strip()) < 2 or _norm(final) == _norm(ai):
            return
        db.add_learned(approval_id=r["id"], channel=r["channel"], sender=r["sender"],
                       group_name=guess_group(r["sender"]), message=r["original"], ai_draft=ai, reply=final)
        log.info("Learned from your edit on approval %s.", r["id"])

    extra: dict = {}  # helpers from extras.register(), filled in below

    def maybe_autosend(aid: int, d, channel: str, sender: str, text: str) -> None:
        """Auto-send (off unless you switch it on): only the safest replies, within a daily cap.
        It still goes through the undo window (at least 60 seconds) and shows up in Activity."""
        a = extra["autosend"]() if extra else {"enabled": False}
        if not a.get("enabled"):
            return
        allow = (db.get_setting("quiet", {}) or {}).get("allow", [])
        if (d.bucket != "auto" or d.confidence != "high" or is_urgent(sender, text, allow)
                or not db.has_replied_to(channel, sender)):  # never to someone you haven't replied to yourself
            return
        since = iso(datetime.combine(datetime.now().date(), datetime.min.time()).astimezone())
        if db.auto_sent_since(since) >= a.get("daily_cap", 10):
            log.info("Auto-send daily cap reached; approval %s waits for you.", aid)
            return
        send_at = iso(utcnow() + timedelta(seconds=max(settings.undo_seconds, 60)))
        if db.update_approval(aid, where_status=("pending",), status="sending", send_at=send_at, auto_sent=1):
            log.info("Auto-sending approval %s to %s (undo window until %s).", aid, sender, send_at)

    def ingest(channel: str, sender: str, text: str) -> int:
        """Store an incoming message, draft a reply and queue it. Returns the approval id."""
        msg_id = db.add_message(channel, sender, text)
        history = db.conversation(channel, sender, before_message_id=msg_id)
        about = extra["notes_for"](sender) if extra else ""
        d = drafter.draft(channel=channel, sender=sender, text=text, history=history, about=about)
        # Every message lands in the approval queue unless auto-send is on and it's one of the safest.
        aid = db.add_approval(message_id=msg_id, channel=channel, sender=sender, original=text, draft=d.draft,
                              tone="default", bucket=d.bucket, reason=d.reason, confidence=d.confidence)
        log.info("New %s message from %s -> approval %s [%s]", channel, sender, aid, d.bucket)
        maybe_autosend(aid, d, channel, sender, text)
        if d.bucket != "never":  # don't track dates from spam
            for dl in deadlines_mod.extract(text):
                if db.add_deadline(**dl, source="message", message_id=msg_id, sender=sender, channel=channel):
                    log.info("Found a deadline in approval %s: %s on %s", aid, dl["kind"], dl["due_date"])
        return aid

    # ----- quiet mode --------------------------------------------------------
    def quiet_state() -> dict:
        q = db.get_setting("quiet", {}) or {}
        until = q.get("until")
        active = bool(until) and parse_iso(until) > utcnow()
        allow = q.get("allow", [])
        held = 0
        if active and q.get("started"):
            held = sum(1 for r in db.approvals_since(q["started"])
                       if r["status"] == "pending" and not is_urgent(r["sender"], r["original"], allow))
        return {"active": active, "until": until if active else None, "started": q.get("started") if active else None,
                "allow": allow, "held": held}

    def aj(r) -> dict:
        return approval_json(r, (db.get_setting("quiet", {}) or {}).get("allow", []))

    poll_lock = threading.Lock()  # one inbox check at a time, so an email is never queued twice

    def poll_gmail() -> int:
        """Queue new unread inbox mail. Returns how many emails were queued."""
        if gmail is None:
            return 0
        n = 0
        with poll_lock:
            for e in gmail.fetch_new(db.gmail_seen):
                if db.gmail_seen(e.gmail_id):
                    continue
                aid = ingest("gmail", e.sender_name, e.text)
                db.add_gmail_link(db.get_approval(aid)["message_id"], gmail_id=e.gmail_id, thread_id=e.thread_id,
                                  reply_to=e.reply_to, subject=e.subject, rfc_message_id=e.rfc_message_id,
                                  references_hdr=e.references)
                n += 1
        return n

    def process_due() -> int:
        """Send every approval whose undo window has closed. Returns how many were sent."""
        n = 0
        for r in db.due_for_sending(utcnow()):
            if not db.claim_for_sending(r["id"], r["send_at"]):
                continue  # undone or re-approved in the meantime
            try:
                send_reply(db, approval_id=r["id"], channel=r["channel"], recipient=r["sender"], text=r["draft"],
                           gmail=gmail)
                db.bump_stat("handled")
                try:
                    learn_from(r)
                except Exception:  # noqa: BLE001 - learning must never block sending
                    log.exception("Couldn't record a learned example for approval %s.", r["id"])
                n += 1
            except Exception:  # noqa: BLE001 - never lose a reply silently
                log.exception("Sending approval %s failed; returning it to pending.", r["id"])
                db.update_approval(r["id"], status="pending", send_at=None)
        return n

    async def send_loop():
        while True:
            try:
                await asyncio.to_thread(process_due)
            except Exception:  # noqa: BLE001
                log.exception("send loop error")
            await asyncio.sleep(0.25)

    async def gmail_loop():
        while True:
            try:
                n = await asyncio.to_thread(poll_gmail)
                if n:
                    log.info("Queued %s new email(s) from Gmail.", n)
            except Exception:  # noqa: BLE001 - a network blip shouldn't stop the app
                log.exception("Gmail check failed; will retry.")
            await asyncio.sleep(settings.gmail_poll_seconds)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        tasks = [asyncio.create_task(send_loop())]
        if gmail is not None and settings.gmail_poll_seconds > 0:  # 0 = manual checks only (tests)
            tasks.append(asyncio.create_task(gmail_loop()))
        log.info("Aide backend ready. Drafter: %s. Gmail: %s. Undo window: %ss. DB: %s", drafter.kind,
                 "connected" if gmail is not None else "off", settings.undo_seconds, settings.db_path)
        try:
            yield
        finally:
            for t in tasks:
                t.cancel()
            db.close()

    app = FastAPI(title="Aide", lifespan=lifespan)
    app.state.db = db
    app.state.drafter = drafter
    app.state.settings = settings
    app.state.process_due = process_due
    app.state.poll_gmail = poll_gmail
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?",
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # ----- phone access on home Wi-Fi (only when started with AIDE_LAN=on) -----
    pairing = phone.Pairing(db)
    app.state.pairing = pairing
    PUBLIC_API = {"/api/pair", "/api/pair/status"}

    def is_local(request: Request) -> bool:
        return bool(request.client) and request.client.host in phone.LOCAL_HOSTS

    @app.middleware("http")
    async def lan_guard(request: Request, call_next):
        """Other devices on the network need a paired device pass for any /api call."""
        path = request.url.path
        if (settings.lan and path.startswith("/api/") and path not in PUBLIC_API
                and not is_local(request) and not pairing.is_paired(request.cookies.get(phone.COOKIE))):
            return JSONResponse({"detail": "pair"}, status_code=401)
        return await call_next(request)

    def local_only(request: Request) -> None:
        """Things like the PIN, backups and auto-send are only for this computer, never a paired phone.
        (With phone access off, Aide only listens on this computer anyway.)"""
        if settings.lan and not is_local(request):
            raise HTTPException(403, "Only available on the computer running Aide")

    extra.update(extras.register(app, db, local_only))

    # ----- "Remind me later" -------------------------------------------------------
    @app.post("/api/approvals/{approval_id}/snooze")
    def snooze(approval_id: int, body: SnoozeIn):
        r = get_or_404(approval_id)
        until = body.until if body.until.tzinfo else body.until.astimezone()
        if until <= utcnow():
            raise HTTPException(422, "Pick a time in the future")
        if not db.update_approval(approval_id, where_status=("pending",), snooze_until=iso(until)):
            conflict(r, "snooze")
        return aj(db.get_approval(approval_id))

    @app.post("/api/approvals/{approval_id}/unsnooze")
    def unsnooze(approval_id: int):
        r = get_or_404(approval_id)
        if not db.update_approval(approval_id, where_status=("pending",), snooze_until=None):
            conflict(r, "bring back")
        return aj(db.get_approval(approval_id))

    @app.get("/api/approvals/snoozed")
    def list_snoozed():
        return [aj(r) for r in db.snoozed()]

    # ----- quick capture (typed or spoken) -------------------------------------------
    @app.post("/api/capture")
    def capture(body: CaptureIn):
        """Route a quick note: a food order plans a cart, a dated deadline/exam is added to Tasks,
        anything else is kept as a note for the chat."""
        text = " ".join(body.text.split())
        if FOOD_INTENT.search(text):
            prefs = load_food_profile()
            plan = food.parse_request(FOOD_INTENT_PREFIX.sub("", text), prefs)
            if plan["items"]:
                oid = db.add_food_order(request=text, **plan)
                return {"kind": "food", "order": food_json(db.get_food_order(oid), prefs)}
        found = deadlines_mod.extract(text)
        if found:
            did = db.add_deadline(**found[0], source="manual")
            if did:
                return {"kind": "deadline", "deadline": deadline_json(db.get_deadline(did))}
        return {"kind": "note"}

    @app.get("/api/pair/status")
    def pair_status(request: Request):
        return {"paired": is_local(request) or pairing.is_paired(request.cookies.get(phone.COOKIE))}

    @app.post("/api/pair")
    def pair(body: PairIn, request: Request, response: Response):
        if not settings.lan:
            raise HTTPException(404, "Phone access is off")
        wait = pairing.locked_for()
        if wait:
            raise HTTPException(429, f"Too many wrong PINs. Try again in {wait // 60 + 1} min.")
        token = pairing.pair(body.pin, phone.device_name(request.headers.get("user-agent", "")))
        if not token:
            raise HTTPException(401, "That PIN didn't match. Check Settings → Use on your phone on your computer.")
        response.set_cookie(phone.COOKIE, token, max_age=phone.COOKIE_DAYS * 86400, httponly=True, samesite="strict")
        log.info("Paired a new device from %s.", request.client.host if request.client else "?")
        return {"paired": True}

    @app.get("/api/lan")
    def lan_info(request: Request):
        local_only(request)
        urls = [f"http://{ip}:{settings.port}" for ip in phone.lan_ips()]
        return {"enabled": settings.lan, "urls": urls, "pin": pairing.pin() if settings.lan else None,
                "devices": [{k: d[k] for k in ("id", "name", "created")} for d in pairing.devices()]}

    @app.post("/api/lan/pin")
    def lan_new_pin(request: Request):
        local_only(request)
        return {"pin": pairing.new_pin()}

    @app.delete("/api/lan/devices/{device_id}", status_code=204)
    def lan_remove_device(device_id: str, request: Request):
        local_only(request)
        if not pairing.remove(device_id):
            raise HTTPException(404, "Not found")

    @app.get("/api/lan/qr.svg")
    def lan_qr(request: Request, url: str = Query(max_length=200, pattern=r"^http://[\d.]+:\d+/?$")):
        local_only(request)
        return Response(phone.qr_svg(url), media_type="image/svg+xml", headers={"Cache-Control": "no-store"})

    def get_or_404(approval_id: int):
        r = db.get_approval(approval_id)
        if not r:
            raise HTTPException(404, "Approval not found")
        return r

    def conflict(r, action: str):
        raise HTTPException(409, f"Can't {action}: this reply is {r['status']}")

    # ----- routes ----------------------------------------------------------
    @app.get("/api/health")
    def health():
        return {"ok": True, "drafter": drafter.kind, "model": settings.model if drafter.kind == "claude" else None,
                "gmail": gmail is not None, "undoSeconds": settings.undo_seconds}

    @app.post("/api/messages", status_code=201)
    def post_message(body: MessageIn):
        channel = body.channel.strip().lower()
        if channel not in CHANNELS:
            raise HTTPException(422, f"Unknown channel '{body.channel}'. Use one of: {', '.join(CHANNELS)}")
        aid = ingest(channel, body.sender.strip(), body.text.strip())
        return aj(db.get_approval(aid))

    @app.get("/api/approvals")
    def list_approvals(status: Status | None = Query(default=None)):
        return [aj(r) for r in db.list_approvals(status)]

    @app.get("/api/approvals/{approval_id}")
    def get_approval(approval_id: int):
        return aj(get_or_404(approval_id))

    @app.patch("/api/approvals/{approval_id}")
    def edit_approval(approval_id: int, body: EditIn):
        r = get_or_404(approval_id)
        if not db.update_approval(approval_id, where_status=("pending",), draft=body.draft):
            conflict(r, "edit")
        return aj(db.get_approval(approval_id))

    @app.post("/api/approvals/{approval_id}/reject")
    def reject(approval_id: int):
        r = get_or_404(approval_id)
        if not db.update_approval(approval_id, where_status=("pending",), status="rejected", send_at=None):
            conflict(r, "reject")
        db.bump_stat("rejected")
        return aj(db.get_approval(approval_id))

    @app.post("/api/approvals/{approval_id}/regenerate")
    def regenerate(approval_id: int, body: RegenerateIn):
        r = get_or_404(approval_id)
        if r["status"] != "pending":
            conflict(r, "regenerate")
        d = drafter.draft(channel=r["channel"], sender=r["sender"], text=r["original"], tone=body.tone,
                          previous_draft=r["draft"],
                          history=db.conversation(r["channel"], r["sender"], before_message_id=r["message_id"]))
        if not db.update_approval(approval_id, where_status=("pending",), draft=d.draft, ai_draft=d.draft,
                                  tone=body.tone, confidence=d.confidence, bucket=d.bucket, reason=d.reason):
            conflict(db.get_approval(approval_id), "regenerate")
        return aj(db.get_approval(approval_id))

    @app.post("/api/approvals/{approval_id}/approve")
    def approve(approval_id: int, body: ApproveIn | None = None):
        r = get_or_404(approval_id)
        fields = {"status": "sending", "send_at": iso(utcnow() + timedelta(seconds=settings.undo_seconds))}
        if body and body.draft:
            fields["draft"] = body.draft
        if not db.update_approval(approval_id, where_status=("pending",), **fields):
            conflict(r, "approve")
        return aj(db.get_approval(approval_id))

    @app.post("/api/approvals/{approval_id}/undo")
    def undo(approval_id: int):
        r = get_or_404(approval_id)
        if r["status"] != "sending" or not r["send_at"] or parse_iso(r["send_at"]) <= utcnow():
            raise HTTPException(409, "The undo window has closed" if r["status"] in ("sending", "sent") else f"Can't undo: this reply is {r['status']}")
        # Conditional on the same send_at, so we can't undo something the sender already claimed.
        with db.lock:
            cur = db.conn.execute(
                "UPDATE approvals SET status = 'pending', send_at = NULL, updated_at = ? WHERE id = ? AND status = 'sending' AND send_at = ?",
                (iso(utcnow()), approval_id, r["send_at"]),
            )
            db.conn.commit()
        if cur.rowcount != 1:
            raise HTTPException(409, "The undo window has closed")
        return aj(db.get_approval(approval_id))

    @app.get("/api/stats")
    def stats():
        handled = db.handled_by_day()
        today = datetime.now().date()
        week_days = [today - timedelta(days=i) for i in range(6, -1, -1)]  # oldest first, today last
        handled_today = handled.get(local_day(today), 0)
        return {
            "handledToday": handled_today,
            "pending": db.count_status("pending"),
            "timeSavedMinutes": handled_today * MINUTES_PER_REPLY,
            "streakDays": streak(handled, today),
            "timeSavedWeek": [handled.get(d.isoformat(), 0) * MINUTES_PER_REPLY for d in week_days],
        }

    @app.get("/api/sent")
    def list_sent():
        return [dict(r) for r in db.list_sent()]

    # ----- activity, learning, profile, rules --------------------------------
    @app.get("/api/activity")
    def activity(limit: int = Query(default=100, ge=1, le=500)):
        """Replies that were sent or skipped, newest first."""
        return [{
            "id": r["id"],
            "channel": r["channel"],
            "from": r["sender"],
            "status": "sent" if r["status"] == "sent" else "skipped",
            "text": r["draft"],
            "original": r["original"],
            "at": r["sent_at"] or r["updated_at"],
            "transport": r["transport"],
            "edited": _norm(r["draft"]) != _norm(r["ai_draft"] or r["draft"]),
            "learned": bool(r["learned"]),
            "auto": bool(r["auto_sent"]),
        } for r in db.history(limit)]

    @app.get("/api/learned")
    def learned():
        return [{"id": r["id"], "from": r["sender"], "channel": r["channel"], "group": r["group_name"],
                 "message": r["message"], "aiDraft": r["ai_draft"], "reply": r["reply"], "at": r["created_at"]}
                for r in db.list_learned()]

    @app.delete("/api/learned/{learned_id}", status_code=204)
    def forget(learned_id: int):
        if not db.delete_learned(learned_id):
            raise HTTPException(404, "Not found")

    def profile_json(p: dict) -> dict:
        return {
            "name": p.get("name", ""),
            "formOfAddress": p.get("form_of_address", {}).get("value", ""),
            "availability": p.get("availability", {}).get("value", ""),
            "needsConfirming": [k for k in ("form_of_address", "availability") if p.get(k, {}).get("confirm")],
            "exampleReplies": len(p.get("example_replies") or []),
            "learnedReplies": len(db.list_learned()),
        }

    @app.get("/api/profile")
    def get_profile():
        return profile_json(load_profile())

    @app.patch("/api/profile")
    def patch_profile(body: ProfileIn):
        p = load_profile()
        for key, value in (("form_of_address", body.form_of_address), ("availability", body.availability)):
            if value is not None:
                p[key] = {"value": " ".join(value.split()), "confirm": False}
        save_json("style_profile.json", p)
        return profile_json(p)

    def rules_json(r: dict) -> dict:
        b = r.get("buckets", {})
        return {**{k: b.get(k, {}).get("covers", []) for k in ("auto", "ask", "never")},
                "hardRules": r.get("hard_rules", [])}

    @app.get("/api/rules")
    def get_rules():
        return rules_json(load_rules())

    # ----- quiet mode, deadlines, daily brief ------------------------------------
    @app.get("/api/quiet")
    def get_quiet():
        return quiet_state()

    @app.put("/api/quiet")
    def put_quiet(body: QuietIn):
        """Turn quiet mode on (until a time) or off (until = null), and/or set who can still reach you."""
        q = db.get_setting("quiet", {}) or {}
        if "until" in body.model_fields_set:
            if body.until is None:
                q.update(until=None, started=None)
            else:
                until = body.until if body.until.tzinfo else body.until.astimezone()
                if until <= utcnow():
                    raise HTTPException(422, "Quiet mode has to end in the future")
                if not quiet_state()["active"]:
                    q["started"] = iso(utcnow())
                q["until"] = iso(until)
        if body.allow is not None:
            q["allow"] = _clean_rules(body.allow)[:20]
        db.set_setting("quiet", q)
        return quiet_state()

    def deadline_json(r) -> dict:
        return {"id": r["id"], "title": r["title"], "kind": r["kind"],
                "kindLabel": deadlines_mod.KIND_LABEL.get(r["kind"], "Task"), "dueDate": r["due_date"],
                "dueTime": r["due_time"], "source": r["source"], "sender": r["sender"], "channel": r["channel"],
                "done": bool(r["done"])}

    @app.get("/api/deadlines")
    def list_deadlines(include_done: bool = False):
        return [deadline_json(r) for r in db.list_deadlines(include_done)]

    @app.post("/api/deadlines", status_code=201)
    def add_deadline(body: DeadlineIn):
        did = db.add_deadline(title=" ".join(body.title.split()), kind=body.kind, due_date=body.due_date.isoformat(),
                              due_time=body.due_time)
        return deadline_json(db.get_deadline(did))

    @app.patch("/api/deadlines/{deadline_id}")
    def edit_deadline(deadline_id: int, body: DeadlinePatch):
        if not db.get_deadline(deadline_id):
            raise HTTPException(404, "Not found")
        fields = {}
        for k in body.model_fields_set:
            v = getattr(body, k)
            if v is None and k != "due_time":  # only the time can be cleared
                continue
            fields[k] = int(v) if k == "done" else (v.isoformat() if isinstance(v, date) else v)
        if "title" in fields:
            fields["title"] = " ".join(fields["title"].split())
        if fields:
            db.update_deadline(deadline_id, **fields)
        return deadline_json(db.get_deadline(deadline_id))

    @app.delete("/api/deadlines/{deadline_id}", status_code=204)
    def delete_deadline(deadline_id: int):
        if not db.delete_deadline(deadline_id):
            raise HTTPException(404, "Not found")

    @app.get("/api/weekly")
    def weekly():
        """The last 7 days (today included) compared with the 7 before."""
        today = datetime.now().date()
        start = today - timedelta(days=6)
        since = iso(datetime.combine(start, datetime.min.time()).astimezone())
        w = db.week_data(since)
        week = [start + timedelta(days=i) for i in range(7)]
        per_day = [{"date": d.isoformat(), "handled": w["days"].get(d.isoformat(), (0, 0))[0]} for d in week]
        handled = sum(d["handled"] for d in per_day)
        skipped = sum(w["days"].get(d.isoformat(), (0, 0))[1] for d in week)
        prev = sum(w["days"].get((start - timedelta(days=i)).isoformat(), (0, 0))[0] for i in range(1, 8))
        waits = [(parse_iso(s) - parse_iso(c)).total_seconds() / 60 for c, s in w["reply_times"]]
        waits.sort()
        median_wait = round(waits[len(waits) // 2]) if waits else None
        busiest = max(per_day, key=lambda d: d["handled"]) if handled else None
        done = sum(1 for r in db.list_deadlines(include_done=True)
                   if r["done"] and start.isoformat() <= r["due_date"] <= (today + timedelta(days=7)).isoformat())
        return {
            "from": start.isoformat(), "to": today.isoformat(),
            "days": per_day,
            "handled": handled, "previousWeek": prev,
            "received": w["received"], "skipped": skipped, "edited": w["edited"],
            "timeSavedMinutes": handled * MINUTES_PER_REPLY,
            "medianReplyMinutes": median_wait,
            "busiestDay": busiest["date"] if busiest else None,
            "topPeople": [{"name": t["sender"], "channel": t["channel"], "messages": t["n"]} for t in w["top"]],
            "deadlinesDone": done,
        }

    @app.get("/api/brief")
    def brief():
        """Today at a glance: what needs you, what's due, and anything left open."""
        today = datetime.now().date()
        tomorrow, week_end = today + timedelta(days=1), today + timedelta(days=7)
        dls = [deadline_json(r) for r in db.list_deadlines()]
        when = lambda d: date.fromisoformat(d["dueDate"])  # noqa: E731
        overdue = [d for d in dls if when(d) < today]
        due_today = [d for d in dls if when(d) == today]
        due_tomorrow = [d for d in dls if when(d) == tomorrow]
        this_week = [d for d in dls if tomorrow < when(d) <= week_end]
        quiet = quiet_state()
        pending = db.list_approvals("pending")
        urgent = [r for r in pending if is_urgent(r["sender"], r["original"], quiet["allow"])]
        food_open = sum(1 for o in db.list_food_orders() if o["status"] in ("planned", "approved"))

        parts = []
        if pending:
            parts.append(f"{len(pending)} {'reply needs' if len(pending) == 1 else 'replies need'} you")
        if overdue:
            parts.append(f"{len(overdue)} overdue")
        if due_today:
            parts.append(f"{len(due_today)} due today")
        exams_soon = [d for d in due_tomorrow if d["kind"] == "exam"]
        if exams_soon:
            parts.append("exam tomorrow")
        elif due_tomorrow:
            parts.append(f"{len(due_tomorrow)} due tomorrow")
        study = extra["study_today"]() if extra else []
        study_left = [s for s in study if not s["done"]]
        if study_left:
            mins = sum(s["minutes"] for s in study_left)
            parts.append(f"{fmt_minutes(mins)} of study")
        return {
            "date": today.isoformat(),
            "headline": " · ".join(parts) if parts else "Nothing needs you right now.",
            "pending": len(pending),
            "snoozed": len(db.snoozed()),
            "urgent": [aj(r) for r in urgent][:3],
            "overdue": overdue, "today": due_today, "tomorrow": due_tomorrow, "thisWeek": this_week,
            "study": study,
            "foodOpen": food_open,
            "handledYesterday": db.handled_by_day().get((today - timedelta(days=1)).isoformat(), 0),
            "quiet": quiet,
        }

    # ----- food (planned in Aide, placed by Claude with the official connector) ----
    def food_json(o: dict, prefs: dict | None = None) -> dict:
        prefs = prefs or load_food_profile()
        return {
            "id": o["id"], "request": o["request"], "app": o["app"], "appLabel": food.APP_LABEL[o["app"]],
            "restaurant": o["restaurant"], "items": o["items"], "budget": o["budget"], "notes": o["notes"],
            "status": o["status"], "createdAt": o["created_at"], "updatedAt": o["updated_at"],
            "checks": food.checks(o, prefs),
            "canApprove": o["status"] == "planned" and food.can_approve(o, prefs),
            "handoffPrompt": food.handoff_prompt(o, prefs) if o["status"] in ("approved", "ordered") else None,
        }

    def food_or_404(order_id: int) -> dict:
        o = db.get_food_order(order_id)
        if not o:
            raise HTTPException(404, "Order not found")
        return o

    @app.get("/api/food/profile")
    def get_food_profile():
        return food_profile_json(load_food_profile())

    @app.patch("/api/food/profile")
    def patch_food_profile(body: FoodProfileIn):
        p = load_food_profile()
        for key in body.model_fields_set:
            value = getattr(body, key)
            if isinstance(value, str):
                value = " ".join(value.split())
            elif isinstance(value, list):
                value = _clean_rules(value)[:30]
            p[key] = value
        save_json("food_profile.json", p)
        return food_profile_json(p)

    @app.post("/api/food/orders", status_code=201)
    def plan_food_order(body: FoodRequestIn):
        prefs = load_food_profile()
        plan = food.parse_request(body.text, prefs)
        if body.app:
            plan["app"] = body.app
        oid = db.add_food_order(request=body.text.strip(), **plan)
        return food_json(db.get_food_order(oid), prefs)

    @app.get("/api/food/orders")
    def list_food_orders():
        prefs = load_food_profile()
        return [food_json(o, prefs) for o in db.list_food_orders()]

    @app.patch("/api/food/orders/{order_id}")
    def edit_food_order(order_id: int, body: FoodPatchIn):
        o = food_or_404(order_id)
        fields = {k: getattr(body, k) for k in body.model_fields_set}
        if "items" in fields:
            fields["items"] = [i.model_dump() for i in body.items or []]
        if fields.get("app") is None:
            fields.pop("app", None)
        for k in ("restaurant", "notes"):
            if k in fields:
                fields[k] = " ".join((fields[k] or "").split())
        if fields and not db.update_food_order(order_id, where_status=("planned",), **fields):
            raise HTTPException(409, f"Can't edit: this order is {o['status']}")
        return food_json(db.get_food_order(order_id))

    @app.post("/api/food/orders/{order_id}/approve")
    def approve_food_order(order_id: int):
        """You approve the planned cart. Returns the instructions to give Claude.
        Nothing is ordered here: Claude shows the real cart and waits for your 'yes, place it'."""
        o = food_or_404(order_id)
        prefs = load_food_profile()
        if o["status"] != "planned":
            raise HTTPException(409, f"Can't approve: this order is {o['status']}")
        if not food.can_approve(o, prefs):
            raise HTTPException(409, "Fix the blocked checks before approving")
        db.update_food_order(order_id, where_status=("planned",), status="approved")
        return food_json(db.get_food_order(order_id), prefs)

    @app.post("/api/food/orders/{order_id}/ordered")
    def mark_food_ordered(order_id: int):
        o = food_or_404(order_id)
        if not db.update_food_order(order_id, where_status=("approved",), status="ordered"):
            raise HTTPException(409, f"Can't mark as ordered: this order is {o['status']}")
        return food_json(db.get_food_order(order_id))

    @app.post("/api/food/orders/{order_id}/cancel")
    def cancel_food_order(order_id: int):
        """Cancels the plan in Aide. (An order already placed on Swiggy can't be cancelled from here.)"""
        o = food_or_404(order_id)
        if not db.update_food_order(order_id, where_status=("planned", "approved"), status="cancelled"):
            raise HTTPException(409, f"Can't cancel: this order is {o['status']}")
        return food_json(db.get_food_order(order_id))

    @app.put("/api/rules")
    def put_rules(body: RulesIn):
        """Edit what each bucket covers. These guide Claude's labels; the safety rules
        (money, deadlines, personal info) are enforced in code and always apply."""
        r = load_rules()
        for k in ("auto", "ask", "never"):
            r.setdefault("buckets", {}).setdefault(k, {})["covers"] = _clean_rules(getattr(body, k))
        save_json("rules.json", r)
        return rules_json(r)

    # The UI and the API share an origin. Mounted last so /api routes win.
    if settings.ui_dir.is_dir():
        app.mount("/", StaticFiles(directory=settings.ui_dir, html=True), name="ui")
    else:
        log.warning("UI folder not found at %s; serving the API only.", settings.ui_dir)

    return app


app = create_app()
