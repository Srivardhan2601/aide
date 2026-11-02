"""Aide backend: FastAPI app with the draft + approval queue API, serving aide-ui at "/".

Run:  uvicorn app.main:app --port 8000
"""
from __future__ import annotations

import asyncio
import logging
import threading
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from typing import Literal

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field

from .config import BUCKET_LABELS, CHANNELS, MINUTES_PER_REPLY, Settings
from .db import DB, iso, local_day, parse_iso, streak, utcnow
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


def approval_json(r) -> dict:
    return {
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
    }


# ===== App factory ===========================================================
def create_app(settings: Settings | None = None, drafter=None, gmail=None) -> FastAPI:
    settings = settings or Settings.from_env()
    db = DB(settings.db_path)
    drafter = drafter or get_drafter(settings.model, settings.fallbacks)
    if gmail is None and settings.gmail:
        gmail = gmail_mod.connect()  # None (with a clear log line) if not signed in yet

    def ingest(channel: str, sender: str, text: str) -> int:
        """Store an incoming message, draft a reply and queue it. Returns the approval id."""
        msg_id = db.add_message(channel, sender, text)
        d = drafter.draft(channel=channel, sender=sender, text=text)
        # For now every message lands in the approval queue, whatever its bucket.
        aid = db.add_approval(message_id=msg_id, channel=channel, sender=sender, original=text, draft=d.draft,
                              tone="default", bucket=d.bucket, reason=d.reason, confidence=d.confidence)
        log.info("New %s message from %s -> approval %s [%s]", channel, sender, aid, d.bucket)
        return aid

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
        return approval_json(db.get_approval(aid))

    @app.get("/api/approvals")
    def list_approvals(status: Status | None = Query(default=None)):
        return [approval_json(r) for r in db.list_approvals(status)]

    @app.get("/api/approvals/{approval_id}")
    def get_approval(approval_id: int):
        return approval_json(get_or_404(approval_id))

    @app.patch("/api/approvals/{approval_id}")
    def edit_approval(approval_id: int, body: EditIn):
        r = get_or_404(approval_id)
        if not db.update_approval(approval_id, where_status=("pending",), draft=body.draft):
            conflict(r, "edit")
        return approval_json(db.get_approval(approval_id))

    @app.post("/api/approvals/{approval_id}/reject")
    def reject(approval_id: int):
        r = get_or_404(approval_id)
        if not db.update_approval(approval_id, where_status=("pending",), status="rejected", send_at=None):
            conflict(r, "reject")
        db.bump_stat("rejected")
        return approval_json(db.get_approval(approval_id))

    @app.post("/api/approvals/{approval_id}/regenerate")
    def regenerate(approval_id: int, body: RegenerateIn):
        r = get_or_404(approval_id)
        if r["status"] != "pending":
            conflict(r, "regenerate")
        d = drafter.draft(channel=r["channel"], sender=r["sender"], text=r["original"], tone=body.tone,
                          previous_draft=r["draft"])
        if not db.update_approval(approval_id, where_status=("pending",), draft=d.draft, tone=body.tone,
                                  confidence=d.confidence, bucket=d.bucket, reason=d.reason):
            conflict(db.get_approval(approval_id), "regenerate")
        return approval_json(db.get_approval(approval_id))

    @app.post("/api/approvals/{approval_id}/approve")
    def approve(approval_id: int, body: ApproveIn | None = None):
        r = get_or_404(approval_id)
        fields = {"status": "sending", "send_at": iso(utcnow() + timedelta(seconds=settings.undo_seconds))}
        if body and body.draft:
            fields["draft"] = body.draft
        if not db.update_approval(approval_id, where_status=("pending",), **fields):
            conflict(r, "approve")
        return approval_json(db.get_approval(approval_id))

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
        return approval_json(db.get_approval(approval_id))

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

    # The UI and the API share an origin. Mounted last so /api routes win.
    if settings.ui_dir.is_dir():
        app.mount("/", StaticFiles(directory=settings.ui_dir, html=True), name="ui")
    else:
        log.warning("UI folder not found at %s; serving the API only.", settings.ui_dir)

    return app


app = create_app()
