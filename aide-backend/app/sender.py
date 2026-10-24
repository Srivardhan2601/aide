"""Outgoing replies.

send_reply() is the one seam for real delivery. Today every channel is MOCKED: nothing leaves
this machine; the reply is written to the `sent` table and logged.

To add Gmail later: write a `_send_gmail(recipient, text, thread_id)` that uses the Gmail API,
and route `channel == "gmail"` to it below. Keep the mock as the default for other channels.
"""
from __future__ import annotations

import logging

from .db import DB

log = logging.getLogger("aide.sender")


def send_reply(db: DB, *, approval_id: int, channel: str, recipient: str, text: str) -> str:
    """Deliver an approved reply. Returns the transport used."""
    # if channel == "gmail" and GMAIL_ENABLED:   # TODO(gmail): real sending goes here
    #     return _send_gmail(recipient, text)
    transport = "mock"
    db.record_sent(approval_id, channel, recipient, text, transport)
    log.info("[MOCK SEND] %s -> %s (approval %s): %s", channel, recipient, approval_id, text.replace("\n", " / "))
    return transport
