"""SQLite storage: incoming messages, the approval queue, sent replies and daily stats."""
from __future__ import annotations

import json
import sqlite3
import threading
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    channel     TEXT NOT NULL,
    sender      TEXT NOT NULL,
    text        TEXT NOT NULL,
    received_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS approvals (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id  INTEGER NOT NULL REFERENCES messages(id),
    channel     TEXT NOT NULL,
    sender      TEXT NOT NULL,
    original    TEXT NOT NULL,
    draft       TEXT NOT NULL,
    tone        TEXT NOT NULL DEFAULT 'default',
    bucket      TEXT NOT NULL CHECK (bucket IN ('auto', 'ask', 'never')),
    reason      TEXT NOT NULL DEFAULT '',
    confidence  TEXT NOT NULL CHECK (confidence IN ('high', 'medium', 'low')),
    status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'rejected')),
    send_at     TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(status);

CREATE TABLE IF NOT EXISTS sent (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    approval_id INTEGER NOT NULL REFERENCES approvals(id),
    channel     TEXT NOT NULL,
    recipient   TEXT NOT NULL,
    text        TEXT NOT NULL,
    transport   TEXT NOT NULL,
    sent_at     TEXT NOT NULL
);

-- Replies you edited before sending: Aide's draft vs what you actually sent.
-- The most recent ones are shown to Claude as examples of your voice.
CREATE TABLE IF NOT EXISTS learned_examples (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    approval_id INTEGER NOT NULL UNIQUE REFERENCES approvals(id),
    channel     TEXT NOT NULL,
    sender      TEXT NOT NULL,
    group_name  TEXT NOT NULL,
    message     TEXT NOT NULL,
    ai_draft    TEXT NOT NULL,
    reply       TEXT NOT NULL,
    created_at  TEXT NOT NULL
);

-- Food carts planned in Aide. Placed by Claude with the official Swiggy/Zomato connector.
-- status: planned (editable) -> approved (handed to Claude) -> ordered | cancelled
CREATE TABLE IF NOT EXISTS food_orders (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    request     TEXT NOT NULL,             -- what you typed
    app         TEXT NOT NULL CHECK (app IN ('swiggy', 'zomato')),
    restaurant  TEXT NOT NULL DEFAULT '',
    items       TEXT NOT NULL,             -- JSON: [{name, qty, notes}]
    budget      INTEGER,
    notes       TEXT NOT NULL DEFAULT '',
    status      TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'approved', 'ordered', 'cancelled')),
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

-- Deadlines, exams, meetings and payments: found in messages, or added by you.
CREATE TABLE IF NOT EXISTS deadlines (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    kind        TEXT NOT NULL CHECK (kind IN ('exam', 'assignment', 'meeting', 'payment', 'other')),
    due_date    TEXT NOT NULL,             -- local YYYY-MM-DD
    due_time    TEXT,                      -- local HH:MM, optional
    source      TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'message')),
    message_id  INTEGER REFERENCES messages(id),
    sender      TEXT NOT NULL DEFAULT '',
    channel     TEXT NOT NULL DEFAULT '',
    done        INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL,
    UNIQUE (message_id, due_date, kind)
);

-- Exam study planner: subjects (with exam date and topics) and the day-by-day sessions built from them.
CREATE TABLE IF NOT EXISTS study_subjects (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    name              TEXT NOT NULL,
    exam_date         TEXT NOT NULL,            -- local YYYY-MM-DD
    topics            TEXT NOT NULL,            -- JSON list of topic names
    minutes_per_topic INTEGER NOT NULL DEFAULT 60,
    created_at        TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS study_sessions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    subject_id  INTEGER NOT NULL REFERENCES study_subjects(id) ON DELETE CASCADE,
    subject     TEXT NOT NULL,
    topic       TEXT NOT NULL,
    kind        TEXT NOT NULL CHECK (kind IN ('study', 'revision')),
    day         TEXT NOT NULL,                  -- local YYYY-MM-DD
    minutes     INTEGER NOT NULL,
    done        INTEGER NOT NULL DEFAULT 0
);

-- Notes about people, used when drafting replies to them.
CREATE TABLE IF NOT EXISTS people (
    name        TEXT PRIMARY KEY COLLATE NOCASE,
    notes       TEXT NOT NULL DEFAULT '',
    updated_at  TEXT NOT NULL
);

-- Small app settings (quiet mode, ...), stored as JSON values.
CREATE TABLE IF NOT EXISTS kv (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Where a Gmail message came from, so an approved reply goes back into the same thread.
CREATE TABLE IF NOT EXISTS gmail_links (
    message_id     INTEGER PRIMARY KEY REFERENCES messages(id),
    gmail_id       TEXT NOT NULL UNIQUE,
    thread_id      TEXT NOT NULL,
    reply_to       TEXT NOT NULL,   -- address the reply goes to
    subject        TEXT NOT NULL DEFAULT '',
    rfc_message_id TEXT NOT NULL DEFAULT '',  -- Message-ID header, for In-Reply-To
    references_hdr TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS daily_stats (
    day      TEXT PRIMARY KEY,          -- local date, YYYY-MM-DD
    handled  INTEGER NOT NULL DEFAULT 0, -- replies sent
    rejected INTEGER NOT NULL DEFAULT 0  -- drafts skipped
);
"""


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat(timespec="milliseconds")


def parse_iso(s: str) -> datetime:
    return datetime.fromisoformat(s)


def local_day(d: date | None = None) -> str:
    return (d or datetime.now().date()).isoformat()


class DB:
    """One connection guarded by a lock. Plenty for a single-user assistant."""

    def __init__(self, path: Path | str):
        self.path = str(path)
        self.lock = threading.RLock()
        self.conn = sqlite3.connect(self.path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA foreign_keys = ON")
        if self.path != ":memory:":
            self.conn.execute("PRAGMA journal_mode = WAL")
        self.conn.executescript(SCHEMA)
        self._migrate()
        self.conn.commit()

    def _migrate(self) -> None:
        """Add columns that older databases don't have yet."""
        cols = {r["name"] for r in self.conn.execute("PRAGMA table_info(approvals)")}
        if "snooze_until" not in cols:  # "Remind me later": hidden from the queue until this time (UTC ISO)
            self.conn.execute("ALTER TABLE approvals ADD COLUMN snooze_until TEXT")
        if "auto_sent" not in cols:     # sent by auto-send rather than by you
            self.conn.execute("ALTER TABLE approvals ADD COLUMN auto_sent INTEGER NOT NULL DEFAULT 0")
        if "ai_draft" not in cols:
            # Aide's latest draft, kept separately so we can tell when you edited it.
            self.conn.execute("ALTER TABLE approvals ADD COLUMN ai_draft TEXT")
            self.conn.execute("UPDATE approvals SET ai_draft = draft WHERE ai_draft IS NULL")

    def close(self) -> None:
        with self.lock:
            self.conn.close()

    # ----- messages & approvals -------------------------------------------
    def add_message(self, channel: str, sender: str, text: str) -> int:
        with self.lock:
            cur = self.conn.execute(
                "INSERT INTO messages (channel, sender, text, received_at) VALUES (?, ?, ?, ?)",
                (channel, sender, text, iso(utcnow())),
            )
            self.conn.commit()
            return cur.lastrowid

    def add_approval(self, *, message_id: int, channel: str, sender: str, original: str,
                     draft: str, tone: str, bucket: str, reason: str, confidence: str) -> int:
        now = iso(utcnow())
        with self.lock:
            cur = self.conn.execute(
                """INSERT INTO approvals (message_id, channel, sender, original, draft, ai_draft, tone, bucket,
                                          reason, confidence, status, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)""",
                (message_id, channel, sender, original, draft, draft, tone, bucket, reason, confidence, now, now),
            )
            self.conn.commit()
            return cur.lastrowid

    def get_approval(self, approval_id: int) -> sqlite3.Row | None:
        with self.lock:
            return self.conn.execute("SELECT * FROM approvals WHERE id = ?", (approval_id,)).fetchone()

    def list_approvals(self, status: str | None = None, include_snoozed: bool = False) -> list[sqlite3.Row]:
        """Pending replies that are snoozed ("remind me later") are left out until their time comes."""
        with self.lock:
            if status == "pending" and not include_snoozed:
                return self.conn.execute(
                    """SELECT * FROM approvals WHERE status = 'pending' AND (snooze_until IS NULL OR snooze_until <= ?)
                       ORDER BY created_at, id""", (iso(utcnow()),)).fetchall()
            if status:
                return self.conn.execute(
                    "SELECT * FROM approvals WHERE status = ? ORDER BY created_at, id", (status,)).fetchall()
            return self.conn.execute("SELECT * FROM approvals ORDER BY created_at, id").fetchall()

    def snoozed(self) -> list[sqlite3.Row]:
        with self.lock:
            return self.conn.execute(
                "SELECT * FROM approvals WHERE status = 'pending' AND snooze_until > ? ORDER BY snooze_until",
                (iso(utcnow()),)).fetchall()

    def has_replied_to(self, channel: str, sender: str) -> bool:
        with self.lock:
            return self.conn.execute(
                """SELECT 1 FROM sent s JOIN approvals a ON a.id = s.approval_id
                   WHERE a.channel = ? AND a.sender = ? LIMIT 1""", (channel, sender)).fetchone() is not None

    def auto_sent_since(self, since_iso: str) -> int:
        with self.lock:
            return self.conn.execute("SELECT COUNT(*) FROM approvals WHERE auto_sent = 1 AND created_at >= ?",
                                     (since_iso,)).fetchone()[0]

    def update_approval(self, approval_id: int, *, where_status: tuple[str, ...] | None = None, **fields) -> bool:
        """Update fields; with where_status, only if the row is currently in one of those states.
        Returns True when a row changed (this is how state transitions stay race-free)."""
        fields["updated_at"] = iso(utcnow())
        cols = ", ".join(f"{k} = ?" for k in fields)
        sql = f"UPDATE approvals SET {cols} WHERE id = ?"
        params: list = [*fields.values(), approval_id]
        if where_status:
            sql += f" AND status IN ({', '.join('?' for _ in where_status)})"
            params += list(where_status)
        with self.lock:
            cur = self.conn.execute(sql, params)
            self.conn.commit()
            return cur.rowcount == 1

    def due_for_sending(self, now: datetime) -> list[sqlite3.Row]:
        with self.lock:
            rows = self.conn.execute("SELECT * FROM approvals WHERE status = 'sending'").fetchall()
        return [r for r in rows if r["send_at"] and parse_iso(r["send_at"]) <= now]

    def claim_for_sending(self, approval_id: int, send_at: str) -> bool:
        """Move sending -> sent only if nobody undid or re-approved it in the meantime."""
        with self.lock:
            cur = self.conn.execute(
                "UPDATE approvals SET status = 'sent', updated_at = ? WHERE id = ? AND status = 'sending' AND send_at = ?",
                (iso(utcnow()), approval_id, send_at),
            )
            self.conn.commit()
            return cur.rowcount == 1

    def record_sent(self, approval_id: int, channel: str, recipient: str, text: str, transport: str) -> None:
        with self.lock:
            self.conn.execute(
                "INSERT INTO sent (approval_id, channel, recipient, text, transport, sent_at) VALUES (?, ?, ?, ?, ?, ?)",
                (approval_id, channel, recipient, text, transport, iso(utcnow())),
            )
            self.conn.commit()

    def list_sent(self) -> list[sqlite3.Row]:
        with self.lock:
            return self.conn.execute("SELECT * FROM sent ORDER BY id").fetchall()

    # ----- learning from edits ----------------------------------------------
    def add_learned(self, *, approval_id: int, channel: str, sender: str, group_name: str,
                    message: str, ai_draft: str, reply: str) -> None:
        with self.lock:
            self.conn.execute(
                """INSERT OR IGNORE INTO learned_examples
                   (approval_id, channel, sender, group_name, message, ai_draft, reply, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (approval_id, channel, sender, group_name, message, ai_draft, reply, iso(utcnow())),
            )
            self.conn.commit()

    def list_learned(self, limit: int | None = None) -> list[sqlite3.Row]:
        """Newest first."""
        with self.lock:
            sql = "SELECT * FROM learned_examples ORDER BY created_at DESC, id DESC"
            return self.conn.execute(sql + (" LIMIT ?" if limit else ""), (limit,) if limit else ()).fetchall()

    def delete_learned(self, learned_id: int) -> bool:
        with self.lock:
            cur = self.conn.execute("DELETE FROM learned_examples WHERE id = ?", (learned_id,))
            self.conn.commit()
            return cur.rowcount == 1

    # ----- food orders ------------------------------------------------------
    def add_food_order(self, *, request: str, app: str, restaurant: str, items: list, budget: int | None, notes: str) -> int:
        now = iso(utcnow())
        with self.lock:
            cur = self.conn.execute(
                """INSERT INTO food_orders (request, app, restaurant, items, budget, notes, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (request, app, restaurant, json.dumps(items, ensure_ascii=False), budget, notes, now, now))
            self.conn.commit()
            return cur.lastrowid

    def get_food_order(self, order_id: int) -> dict | None:
        with self.lock:
            r = self.conn.execute("SELECT * FROM food_orders WHERE id = ?", (order_id,)).fetchone()
        return self._food(r) if r else None

    def list_food_orders(self, limit: int = 30) -> list[dict]:
        with self.lock:
            rows = self.conn.execute("SELECT * FROM food_orders ORDER BY created_at DESC, id DESC LIMIT ?", (limit,)).fetchall()
        return [self._food(r) for r in rows]

    def update_food_order(self, order_id: int, *, where_status: tuple[str, ...], **fields) -> bool:
        if "items" in fields:
            fields["items"] = json.dumps(fields["items"], ensure_ascii=False)
        fields["updated_at"] = iso(utcnow())
        cols = ", ".join(f"{k} = ?" for k in fields)
        marks = ", ".join("?" for _ in where_status)
        with self.lock:
            cur = self.conn.execute(f"UPDATE food_orders SET {cols} WHERE id = ? AND status IN ({marks})",
                                    (*fields.values(), order_id, *where_status))
            self.conn.commit()
            return cur.rowcount == 1

    @staticmethod
    def _food(r: sqlite3.Row) -> dict:
        d = dict(r)
        d["items"] = json.loads(d["items"])
        return d

    # ----- weekly recap -----------------------------------------------------
    def week_data(self, since_iso: str) -> dict:
        """Raw numbers for the weekly recap, for everything since `since_iso` (UTC)."""
        with self.lock:
            reply_times = self.conn.execute(
                """SELECT a.created_at, s.sent_at FROM sent s JOIN approvals a ON a.id = s.approval_id
                   WHERE s.sent_at >= ?""", (since_iso,)).fetchall()
            top = self.conn.execute(
                """SELECT sender, channel, COUNT(*) AS n FROM messages WHERE received_at >= ?
                   GROUP BY sender, channel ORDER BY n DESC, MAX(received_at) DESC LIMIT 3""", (since_iso,)).fetchall()
            edited = self.conn.execute("SELECT COUNT(*) FROM learned_examples WHERE created_at >= ?", (since_iso,)).fetchone()[0]
            received = self.conn.execute("SELECT COUNT(*) FROM messages WHERE received_at >= ?", (since_iso,)).fetchone()[0]
            days = {r["day"]: (r["handled"], r["rejected"]) for r in self.conn.execute("SELECT * FROM daily_stats")}
        return {"reply_times": [(r["created_at"], r["sent_at"]) for r in reply_times],
                "top": [dict(r) for r in top], "edited": edited, "received": received, "days": days}

    # ----- conversation memory ----------------------------------------------
    def conversation(self, channel: str, sender: str, before_message_id: int | None = None, limit: int = 6) -> list[dict]:
        """Recent back-and-forth with one person on one app, oldest first:
        their messages and the replies you actually sent (not unsent drafts)."""
        before = before_message_id or 2**62
        with self.lock:
            rows = self.conn.execute(
                """SELECT 'them' AS who, m.text AS text, m.received_at AS at FROM messages m
                     WHERE m.channel = ? AND m.sender = ? AND m.id < ?
                   UNION ALL
                   SELECT 'me', s.text, s.sent_at FROM sent s JOIN approvals a ON a.id = s.approval_id
                     WHERE a.channel = ? AND a.sender = ? AND a.message_id < ?
                   ORDER BY at DESC LIMIT ?""",
                (channel, sender, before, channel, sender, before, limit)).fetchall()
        return [dict(r) for r in reversed(rows)]

    # ----- deadlines --------------------------------------------------------
    def add_deadline(self, *, title: str, kind: str, due_date: str, due_time: str | None, source: str = "manual",
                     message_id: int | None = None, sender: str = "", channel: str = "") -> int | None:
        with self.lock:
            cur = self.conn.execute(
                """INSERT OR IGNORE INTO deadlines (title, kind, due_date, due_time, source, message_id, sender, channel, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (title, kind, due_date, due_time, source, message_id, sender, channel, iso(utcnow())))
            self.conn.commit()
            return cur.lastrowid if cur.rowcount else None

    def list_deadlines(self, include_done: bool = False) -> list[sqlite3.Row]:
        with self.lock:
            sql = "SELECT * FROM deadlines" + ("" if include_done else " WHERE done = 0")
            return self.conn.execute(sql + " ORDER BY due_date, COALESCE(due_time, '99:99'), id").fetchall()

    def get_deadline(self, deadline_id: int) -> sqlite3.Row | None:
        with self.lock:
            return self.conn.execute("SELECT * FROM deadlines WHERE id = ?", (deadline_id,)).fetchone()

    def update_deadline(self, deadline_id: int, **fields) -> bool:
        cols = ", ".join(f"{k} = ?" for k in fields)
        with self.lock:
            cur = self.conn.execute(f"UPDATE deadlines SET {cols} WHERE id = ?", (*fields.values(), deadline_id))
            self.conn.commit()
            return cur.rowcount == 1

    def delete_deadline(self, deadline_id: int) -> bool:
        with self.lock:
            cur = self.conn.execute("DELETE FROM deadlines WHERE id = ?", (deadline_id,))
            self.conn.commit()
            return cur.rowcount == 1

    # ----- settings ---------------------------------------------------------
    def get_setting(self, key: str, default=None):
        with self.lock:
            r = self.conn.execute("SELECT value FROM kv WHERE key = ?", (key,)).fetchone()
        return json.loads(r["value"]) if r else default

    def set_setting(self, key: str, value) -> None:
        with self.lock:
            self.conn.execute("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                              (key, json.dumps(value)))
            self.conn.commit()

    def approvals_since(self, since_iso: str) -> list[sqlite3.Row]:
        with self.lock:
            return self.conn.execute("SELECT * FROM approvals WHERE created_at >= ? ORDER BY created_at", (since_iso,)).fetchall()

    # ----- history ----------------------------------------------------------
    def history(self, limit: int = 100) -> list[sqlite3.Row]:
        """Sent and skipped replies, newest first, for the Activity screen."""
        with self.lock:
            return self.conn.execute(
                """SELECT a.*, s.transport, s.sent_at,
                          EXISTS(SELECT 1 FROM learned_examples l WHERE l.approval_id = a.id) AS learned
                   FROM approvals a LEFT JOIN sent s ON s.approval_id = a.id
                   WHERE a.status IN ('sent', 'rejected')
                   ORDER BY a.updated_at DESC, a.id DESC LIMIT ?""", (limit,)).fetchall()

    # ----- gmail ------------------------------------------------------------
    def gmail_seen(self, gmail_id: str) -> bool:
        with self.lock:
            return self.conn.execute("SELECT 1 FROM gmail_links WHERE gmail_id = ?", (gmail_id,)).fetchone() is not None

    def add_gmail_link(self, message_id: int, *, gmail_id: str, thread_id: str, reply_to: str,
                       subject: str, rfc_message_id: str, references_hdr: str) -> None:
        with self.lock:
            self.conn.execute(
                """INSERT INTO gmail_links (message_id, gmail_id, thread_id, reply_to, subject, rfc_message_id, references_hdr)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (message_id, gmail_id, thread_id, reply_to, subject, rfc_message_id, references_hdr),
            )
            self.conn.commit()

    def gmail_link_for_approval(self, approval_id: int) -> sqlite3.Row | None:
        with self.lock:
            return self.conn.execute(
                "SELECT g.* FROM gmail_links g JOIN approvals a ON a.message_id = g.message_id WHERE a.id = ?",
                (approval_id,)).fetchone()

    # ----- stats ------------------------------------------------------------
    def bump_stat(self, column: str, day: str | None = None) -> None:
        assert column in ("handled", "rejected")
        day = day or local_day()
        with self.lock:
            self.conn.execute("INSERT OR IGNORE INTO daily_stats (day) VALUES (?)", (day,))
            self.conn.execute(f"UPDATE daily_stats SET {column} = {column} + 1 WHERE day = ?", (day,))
            self.conn.commit()

    def handled_by_day(self) -> dict[str, int]:
        with self.lock:
            rows = self.conn.execute("SELECT day, handled FROM daily_stats").fetchall()
        return {r["day"]: r["handled"] for r in rows}

    def count_status(self, status: str) -> int:
        if status == "pending":
            return len(self.list_approvals("pending"))  # not counting snoozed ones
        with self.lock:
            return self.conn.execute("SELECT COUNT(*) FROM approvals WHERE status = ?", (status,)).fetchone()[0]


def streak(handled: dict[str, int], today: date) -> int:
    """Consecutive days with at least one handled reply, ending today
    (or yesterday, so the streak doesn't read 0 first thing in the morning)."""
    day = today if handled.get(today.isoformat(), 0) > 0 else today - timedelta(days=1)
    n = 0
    while handled.get(day.isoformat(), 0) > 0:
        n += 1
        day -= timedelta(days=1)
    return n
