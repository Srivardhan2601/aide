"""Gmail: read new mail into the approval queue, send approved replies in the same thread.

Off unless AIDE_GMAIL=on and you've signed in once with `python gmail_auth.py`
(see GMAIL_SETUP.md). Nothing is ever sent without your approval: an incoming email
becomes a pending draft like any other message, and only an approved reply goes out,
after the undo window.

Scopes: gmail.readonly (read your inbox) and gmail.send (send replies). Aide can't
delete, archive or modify your mail, and it doesn't mark messages as read.
"""
from __future__ import annotations

import base64
import logging
import re
from dataclasses import dataclass
from email.message import EmailMessage
from email.utils import getaddresses, parseaddr
from pathlib import Path

from .config import BACKEND_DIR

log = logging.getLogger("aide.gmail")

SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
]
SECRETS_DIR = BACKEND_DIR / "secrets"            # git-ignored
CREDENTIALS_FILE = SECRETS_DIR / "credentials.json"  # OAuth client, downloaded from Google Cloud
TOKEN_FILE = SECRETS_DIR / "token.json"              # created by gmail_auth.py

# Recent unread mail in the primary inbox. Promotions/social/updates are skipped.
DEFAULT_QUERY = "in:inbox is:unread newer_than:2d -category:promotions -category:social -category:updates"
MAX_BODY_CHARS = 8000


@dataclass
class IncomingEmail:
    gmail_id: str
    thread_id: str
    sender_name: str     # shown in Approvals
    reply_to: str        # where the reply goes
    subject: str
    rfc_message_id: str
    references: str
    text: str            # what the drafter sees


# ===== Parsing ================================================================

def _b64(data: str) -> str:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4)).decode("utf-8", errors="replace")


def _find_part(payload: dict, mime: str) -> str | None:
    if payload.get("mimeType") == mime and payload.get("body", {}).get("data"):
        return _b64(payload["body"]["data"])
    for part in payload.get("parts", []) or []:
        found = _find_part(part, mime)
        if found:
            return found
    return None


def _strip_quoted(text: str) -> str:
    """Drop the quoted history under a reply ('On ... wrote:' and '>' lines)."""
    out = []
    for line in text.splitlines():
        if re.match(r"^\s*On .{5,200} wrote:\s*$", line) or line.strip().startswith("-----Original Message"):
            break
        if line.lstrip().startswith(">"):
            continue
        out.append(line)
    return "\n".join(out).strip()


def _html_to_text(html: str) -> str:
    html = re.sub(r"(?is)<(script|style).*?</\1>", "", html)
    html = re.sub(r"(?i)<br\s*/?>|</p>|</div>", "\n", html)
    text = re.sub(r"<[^>]+>", "", html)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def parse_message(msg: dict) -> IncomingEmail:
    payload = msg.get("payload", {})
    headers = {h["name"].lower(): h["value"] for h in payload.get("headers", [])}
    from_name, from_addr = parseaddr(headers.get("from", ""))
    reply_pairs = getaddresses([headers["reply-to"]]) if headers.get("reply-to") else []
    reply_to = (reply_pairs[0][1] if reply_pairs and reply_pairs[0][1] else from_addr)

    body = _find_part(payload, "text/plain")
    if body is None:
        html = _find_part(payload, "text/html")
        body = _html_to_text(html) if html else msg.get("snippet", "")
    body = _strip_quoted(body)[:MAX_BODY_CHARS]

    subject = headers.get("subject", "").strip()
    text = f"Subject: {subject}\n\n{body}".strip() if subject else body
    return IncomingEmail(
        gmail_id=msg["id"],
        thread_id=msg.get("threadId", msg["id"]),
        sender_name=from_name or from_addr or "Unknown sender",
        reply_to=reply_to,
        subject=subject,
        rfc_message_id=headers.get("message-id", ""),
        references=headers.get("references", ""),
        text=text or "(empty email)",
    )


def build_reply(*, to: str, subject: str, body: str, in_reply_to: str, references: str) -> str:
    """A plain-text reply as a base64url 'raw' string for users.messages.send."""
    m = EmailMessage()
    m["To"] = to
    m["Subject"] = subject if re.match(r"(?i)^re:", subject) else f"Re: {subject}".strip()
    if in_reply_to:
        m["In-Reply-To"] = in_reply_to
        m["References"] = f"{references} {in_reply_to}".strip()
    m.set_content(body)
    return base64.urlsafe_b64encode(m.as_bytes()).decode()


# ===== Client ================================================================

class Gmail:
    """Thin wrapper over the Gmail API service object (injectable for tests)."""

    def __init__(self, service, query: str = DEFAULT_QUERY, max_results: int = 20):
        self.service = service
        self.query = query
        self.max_results = max_results

    def fetch_new(self, seen) -> list[IncomingEmail]:
        """Unread inbox mail Aide hasn't queued yet. `seen(gmail_id) -> bool`."""
        res = self.service.users().messages().list(userId="me", q=self.query, maxResults=self.max_results).execute()
        out = []
        for ref in res.get("messages", []) or []:
            if seen(ref["id"]):
                continue
            msg = self.service.users().messages().get(userId="me", id=ref["id"], format="full").execute()
            if "SENT" in (msg.get("labelIds") or []):
                continue  # your own message
            out.append(parse_message(msg))
        return list(reversed(out))  # oldest first

    def send_reply(self, link, text: str) -> str:
        raw = build_reply(to=link["reply_to"], subject=link["subject"], body=text,
                          in_reply_to=link["rfc_message_id"], references=link["references_hdr"])
        sent = self.service.users().messages().send(
            userId="me", body={"raw": raw, "threadId": link["thread_id"]}).execute()
        return sent.get("id", "")


def connect() -> Gmail | None:
    """Build a real client from secrets/token.json, or return None with a clear log line."""
    if not TOKEN_FILE.exists():
        log.warning("AIDE_GMAIL=on but %s is missing. Run `python gmail_auth.py` first (see GMAIL_SETUP.md).", TOKEN_FILE)
        return None
    try:
        from google.auth.transport.requests import Request
        from google.oauth2.credentials import Credentials
        from googleapiclient.discovery import build
    except ImportError:
        log.error("Gmail libraries aren't installed. Run `pip install -r requirements.txt`.")
        return None

    creds = Credentials.from_authorized_user_file(str(TOKEN_FILE), SCOPES)
    if not creds.valid:
        if creds.expired and creds.refresh_token:
            creds.refresh(Request())
            Path(TOKEN_FILE).write_text(creds.to_json(), encoding="utf-8")
        else:
            log.error("Gmail sign-in has expired. Run `python gmail_auth.py` again.")
            return None
    return Gmail(build("gmail", "v1", credentials=creds, cache_discovery=False))
