"""Other websites open in your browser can't use Aide (CSRF), and website names can't point at it (DNS rebinding)."""
import json

import pytest

from app.phone import allowed_host

EVIL = {"Origin": "https://evil.example"}


def new_approval(client) -> int:
    r = client.post("/api/messages", json={"channel": "whatsapp", "from": "Rahul", "text": "hey are you free?"})
    assert r.status_code == 201
    return r.json()["id"]


def test_other_website_cannot_approve_reject_or_undo(client):
    aid = new_approval(client)
    for action in ("approve", "reject", "undo", "unsnooze"):
        r = client.post(f"/api/approvals/{aid}/{action}", headers=EVIL)
        assert r.status_code == 403, action
    assert client.get(f"/api/approvals/{aid}").json()["status"] == "pending"


def test_other_website_cannot_restore_a_backup(client):
    # The classic attack: a hidden <form enctype="text/plain"> posting fake JSON.
    fake = json.dumps({"app": "aide", "version": 1, "tables": {}})
    r = client.post("/api/backup/restore", content=fake, headers={**EVIL, "Content-Type": "text/plain"})
    assert r.status_code == 403
    # Even without an Origin header, a plain form can't send JSON.
    r = client.post("/api/backup/restore", content=fake, headers={"Content-Type": "text/plain"})
    assert r.status_code == 415


def test_cross_site_fetch_without_origin_is_blocked(client):
    aid = new_approval(client)
    r = client.post(f"/api/approvals/{aid}/approve", headers={"Sec-Fetch-Site": "cross-site"})
    assert r.status_code == 403
    assert client.get(f"/api/approvals/{aid}").json()["status"] == "pending"


@pytest.mark.parametrize("origin", ["http://testserver", "http://localhost:8000", "http://127.0.0.1:5173"])
def test_aides_own_pages_still_work(client, origin):
    aid = new_approval(client)
    r = client.post(f"/api/approvals/{aid}/reject", headers={"Origin": origin, "Sec-Fetch-Site": "same-origin"})
    assert r.status_code == 200 and r.json()["status"] == "rejected"


def test_website_names_are_refused(client):
    # DNS rebinding: evil.example pointed at 127.0.0.1 would arrive with Host: evil.example
    assert client.get("/api/approvals", headers={"Host": "evil.example:8000"}).status_code == 403
    assert client.get("/api/approvals", headers={"Host": "localhost:8000"}).status_code == 200


@pytest.mark.parametrize("host,ok", [
    ("localhost:8000", True), ("127.0.0.1:8000", True), ("[::1]:8000", True), ("192.168.1.5:8443", True),
    ("10.0.0.7:8443", True), ("172.20.1.1:8443", True), ("LOCALHOST", True),
    ("evil.example", False), ("evil.example:8000", False), ("8.8.8.8:8000", False), ("169.254.1.1", False),
    ("", False), ("localhost.evil.example", False),
])
def test_allowed_host(host, ok):
    assert allowed_host(host) is ok


def test_undo_clears_the_auto_send_mark(client):
    db = client.app_ref.state.db
    aid = new_approval(client)
    db.update_approval(aid, where_status=("pending",), status="sending", auto_sent=1,
                       send_at="2999-01-01T00:00:00+00:00")
    assert client.post(f"/api/approvals/{aid}/undo").status_code == 200
    assert client.get(f"/api/approvals/{aid}").json()["autoSent"] is False


def test_gmail_reply_headers_are_one_line():
    from app.gmail import build_reply
    raw = build_reply(to="a@example.com", subject="Lab\r\n record", body="ok", in_reply_to="<x@y>\n", references="")
    assert raw  # used to raise "Header values may not contain linefeed"
