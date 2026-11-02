"""Outgoing replies.

send_reply() is the one seam for delivery:
- Gmail messages go back through Gmail, in the original thread, when Gmail is connected
  (AIDE_GMAIL=on and you've signed in; see GMAIL_SETUP.md).
- Everything else is MOCKED: nothing leaves this machine; the reply is written to the
  `sent` table and logged. Other channels plug in here the same way.
"""
from __future__ import annotations

import logging

from .db import DB

log = logging.getLogger("aide.sender")


def send_reply(db: DB, *, approval_id: int, channel: str, recipient: str, text: str, gmail=None) -> str:
    """Deliver an approved reply. Returns the transport used. Raises if a real send fails,
    so the caller can put the reply back in the queue instead of losing it."""
    if channel == "gmail" and gmail is not None:
        link = db.gmail_link_for_approval(approval_id)
        if link is not None:
            gmail_id = gmail.send_reply(link, text)
            db.record_sent(approval_id, channel, link["reply_to"], text, "gmail")
            log.info("[GMAIL] Sent approval %s to %s (gmail id %s)", approval_id, link["reply_to"], gmail_id)
            return "gmail"
    transport = "mock"
    db.record_sent(approval_id, channel, recipient, text, transport)
    log.info("[MOCK SEND] %s -> %s (approval %s): %s", channel, recipient, approval_id, text.replace("\n", " / "))
    return transport
