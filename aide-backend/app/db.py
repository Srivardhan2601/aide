"""SQLite storage: incoming messages, the approval queue, sent replies and daily stats."""
from __future__ import annotations

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
        self.conn.commit()

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
                """INSERT INTO approvals (message_id, channel, sender, original, draft, tone, bucket,
                                          reason, confidence, status, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)""",
                (message_id, channel, sender, original, draft, tone, bucket, reason, confidence, now, now),
            )
            self.conn.commit()
            return cur.lastrowid

    def get_approval(self, approval_id: int) -> sqlite3.Row | None:
        with self.lock:
            return self.conn.execute("SELECT * FROM approvals WHERE id = ?", (approval_id,)).fetchone()

    def list_approvals(self, status: str | None = None) -> list[sqlite3.Row]:
        with self.lock:
            if status:
                return self.conn.execute(
                    "SELECT * FROM approvals WHERE status = ? ORDER BY created_at, id", (status,)).fetchall()
            return self.conn.execute("SELECT * FROM approvals ORDER BY created_at, id").fetchall()

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
