"""Gmail flow against a fake Gmail service: nothing real is read or sent."""
import base64
import email
import time

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.drafter import MockDrafter
from app.gmail import Gmail, build_reply, parse_message
from app.main import create_app


def b64(s: str) -> str:
    return base64.urlsafe_b64encode(s.encode()).decode().rstrip("=")


def gmail_msg(gid, *, frm, subject, body, html=False, labels=("INBOX", "UNREAD"), reply_to=None):
    headers = [{"name": "From", "value": frm}, {"name": "Subject", "value": subject},
               {"name": "Message-ID", "value": f"<{gid}@mail.example>"}]
    if reply_to:
        headers.append({"name": "Reply-To", "value": reply_to})
    part = {"mimeType": "text/html" if html else "text/plain", "body": {"data": b64(body)}}
    return {"id": gid, "threadId": f"t-{gid}", "labelIds": list(labels), "snippet": body[:40],
            "payload": {"mimeType": "multipart/alternative", "headers": headers, "parts": [part]}}


class _Req:
    def __init__(self, value):
        self.value = value

    def execute(self):
        return self.value


class FakeGmailService:
    def __init__(self, inbox):
        self.inbox = {m["id"]: m for m in inbox}
        self.sent = []

    def users(self):
        return self

    def messages(self):
        return self

    def list(self, userId, q, maxResults):
        return _Req({"messages": [{"id": i} for i in reversed(list(self.inbox))]})  # newest first, like Gmail

    def get(self, userId, id, format):
        return _Req(self.inbox[id])

    def send(self, userId, body):
        self.sent.append(body)
        return _Req({"id": f"sent-{len(self.sent)}"})


@pytest.fixture
def inbox():
    return [
        gmail_msg("m1", frm="Prof. Rao <rao@uni.edu>", subject="Review on Friday",
                  body="Please confirm you'll attend Friday's 11 AM review.\n\nOn Mon, Prof wrote:\n> old stuff"),
        gmail_msg("m2", frm="Prize Team <win@spam.biz>", subject="You won!",
                  body="<p>Send me your <b>address</b> and phone number for the prize.</p>", html=True),
        gmail_msg("m3", frm="Me <sri@example.com>", subject="My own mail", body="hi", labels=("SENT",)),
    ]


@pytest.fixture
def gmail_app(tmp_path, inbox):
    service = FakeGmailService(inbox)
    # gmail_poll_seconds=0: no background loop, the tests trigger each inbox check themselves.
    app = create_app(Settings(db_path=tmp_path / "g.db", undo_seconds=0.3, gmail_poll_seconds=0),
                     drafter=MockDrafter(), gmail=Gmail(service))
    with TestClient(app) as c:
        yield c, app, service


def test_parse_plain_and_html():
    e = parse_message(gmail_msg("x", frm="Priya Nair <priya@acme.com>", subject="Hi",
                                body="Can we move it?\n> quoted line", reply_to="team@acme.com"))
    assert (e.sender_name, e.reply_to, e.thread_id) == ("Priya Nair", "team@acme.com", "t-x")
    assert e.text == "Subject: Hi\n\nCan we move it?"
    h = parse_message(gmail_msg("y", frm="a@b.com", subject="", body="<p>Hello<br>there</p>", html=True))
    assert h.sender_name == "a@b.com" and h.text == "Hello\nthere"


def test_poll_queues_new_mail_once_and_skips_own(gmail_app):
    c, app, _ = gmail_app
    assert app.state.poll_gmail() == 2       # m3 is your own sent mail
    assert app.state.poll_gmail() == 0       # already seen: no duplicates
    pending = c.get("/api/approvals", params={"status": "pending"}).json()
    by_from = {a["from"]: a for a in pending}
    assert set(by_from) == {"Prof. Rao", "Prize Team"}
    assert by_from["Prof. Rao"]["channel"] == "gmail"
    assert by_from["Prof. Rao"]["bucket"] == "auto"
    assert "old stuff" not in by_from["Prof. Rao"]["original"]   # quoted history stripped
    assert by_from["Prize Team"]["bucket"] == "never"


def test_approved_gmail_reply_goes_back_in_thread(gmail_app):
    c, app, service = gmail_app
    app.state.poll_gmail()
    a = next(x for x in c.get("/api/approvals").json() if x["from"] == "Prof. Rao")
    c.post(f"/api/approvals/{a['id']}/approve", json={"draft": "Good morning Professor, I'll be there."})
    assert service.sent == []                 # nothing goes out during the undo window
    time.sleep(0.4)
    app.state.process_due()
    assert len(service.sent) == 1
    body = service.sent[0]
    assert body["threadId"] == "t-m1"
    m = email.message_from_bytes(base64.urlsafe_b64decode(body["raw"]))
    assert m["To"] == "rao@uni.edu"
    assert m["Subject"] == "Re: Review on Friday"
    assert m["In-Reply-To"] == "<m1@mail.example>"
    assert "I'll be there" in m.get_payload(decode=True).decode()
    sent = c.get("/api/sent").json()
    assert sent[-1]["transport"] == "gmail" and sent[-1]["recipient"] == "rao@uni.edu"


def test_undo_means_gmail_never_sends(gmail_app):
    c, app, service = gmail_app
    app.state.poll_gmail()
    a = c.get("/api/approvals").json()[0]
    c.post(f"/api/approvals/{a['id']}/approve")
    assert c.post(f"/api/approvals/{a['id']}/undo").status_code == 200
    time.sleep(0.4)
    app.state.process_due()
    assert service.sent == []


def test_failed_send_returns_reply_to_queue(gmail_app):
    c, app, service = gmail_app
    app.state.poll_gmail()

    def boom(userId, body):
        raise RuntimeError("network down")

    service.send = boom
    a = c.get("/api/approvals").json()[0]
    c.post(f"/api/approvals/{a['id']}/approve")
    time.sleep(0.4)
    app.state.process_due()
    assert c.get(f"/api/approvals/{a['id']}").json()["status"] == "pending"   # not lost


def test_pasted_gmail_message_without_link_stays_mocked(gmail_app):
    c, app, service = gmail_app
    a = c.post("/api/messages", json={"channel": "gmail", "from": "Teammate", "text": "Standup moved to 4 PM today."}).json()
    c.post(f"/api/approvals/{a['id']}/approve")
    time.sleep(0.4)
    app.state.process_due()
    assert service.sent == [] and c.get("/api/sent").json()[-1]["transport"] == "mock"


def test_concurrent_checks_never_queue_an_email_twice(gmail_app):
    import threading

    c, app, _ = gmail_app
    threads = [threading.Thread(target=app.state.poll_gmail) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert len(c.get("/api/approvals").json()) == 2


def test_reply_subject_not_doubled():
    raw = build_reply(to="a@b.com", subject="Re: Plans", body="ok", in_reply_to="", references="")
    assert email.message_from_bytes(base64.urlsafe_b64decode(raw))["Subject"] == "Re: Plans"


def test_gmail_off_by_default(client):
    assert client.get("/api/health").json()["gmail"] is False
