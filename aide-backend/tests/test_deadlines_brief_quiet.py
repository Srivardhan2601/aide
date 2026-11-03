"""Deadline finder, the Deadlines API, the daily brief and quiet mode."""
from datetime import date, datetime, timedelta

import pytest

from app.deadlines import extract

# Fixed "now": Wednesday 4 Nov 2026, 10:00.
NOW = datetime(2026, 11, 4, 10, 0)


def one(text):
    found = extract(text, NOW)
    return (found[0]["kind"], found[0]["due_date"], found[0]["due_time"]) if found else None


@pytest.mark.parametrize("text,expected", [
    ("Can you get the report done by Monday?", ("assignment", "2026-11-09", None)),
    ("Please confirm you'll attend Friday's 11 AM review.", ("meeting", "2026-11-06", "11:00")),
    ("Standup moved to 4 PM today.", ("meeting", "2026-11-04", "16:00")),
    ("Reminder: DBMS viva on 12th, be there by 9:30 am", ("exam", "2026-11-12", "09:30")),
    ("Your invoice #4821 is due on Nov 15.", ("payment", "2026-11-15", None)),
    ("Assignment 3 submission by 20/11, before midnight", ("assignment", "2026-11-20", "23:59")),
    ("Mid-sem exam tomorrow at 2pm in hall B", ("exam", "2026-11-05", "14:00")),
    ("Lab record due day after tomorrow", ("assignment", "2026-11-06", None)),
    ("Project demo next wednesday 3:00 pm", ("meeting", "2026-11-11", "15:00")),
    ("Fees due 5 Jan", ("payment", "2027-01-05", None)),           # already passed this year -> next year
    ("Quiz on the 2nd", ("exam", "2026-12-02", None)),              # the 2nd has passed -> next month
    ("Subject: Thesis draft\n\nPlease submit by Friday EOD", ("assignment", "2026-11-06", "23:59")),
])
def test_finds_deadlines(text, expected):
    assert one(text) == expected


@pytest.mark.parametrize("text", [
    "Loved your last post! Where did you learn design?",        # no date, no purpose
    "Let's catch up on Friday!",                                 # date but nothing it's for
    "I sat through the whole lecture",                           # 'sat' isn't Saturday
    "Takes 1-2 days for the report",                             # '1-2' isn't a date
    "Best 1st year project I've seen",                           # '1st' isn't a date
    "The exam was on 3rd Nov",                                   # already over
])
def test_ignores_non_deadlines(text):
    assert extract(text, NOW) == []


def test_title_uses_subject_or_first_sentence():
    assert extract("Subject: Thesis draft\n\nPlease submit by Friday", NOW)[0]["title"] == "Thesis draft"
    assert extract("Can you get the report done by Monday? Thanks!", NOW)[0]["title"] == "Can you get the report done by Monday?"


# ----- API ------------------------------------------------------------------

def post(client, frm, text, channel="gmail"):
    return client.post("/api/messages", json={"channel": channel, "from": frm, "text": text}).json()


def test_messages_create_deadlines_once(client):
    post(client, "Team lead", "Can you get the report done by Monday?", "slack")
    post(client, "Professor", "Mid-sem exam tomorrow at 2pm in hall B")
    post(client, "Friend", "lol ok")  # nothing
    dl = client.get("/api/deadlines").json()
    assert sorted((d["kind"], d["sender"]) for d in dl) == [("assignment", "Team lead"), ("exam", "Professor")]
    assert all(d["source"] == "message" for d in dl)


def test_spam_dates_are_ignored(client):
    post(client, "Unknown number", "Send me your bank details by Friday to claim the prize fee")
    assert client.get("/api/deadlines").json() == []


def test_manual_deadline_crud(client):
    d = client.post("/api/deadlines", json={"title": "Physics exam", "kind": "exam",
                                            "dueDate": (date.today() + timedelta(days=3)).isoformat(), "dueTime": "09:00"}).json()
    assert d["kindLabel"] == "Exam" and d["source"] == "manual"
    d = client.patch(f"/api/deadlines/{d['id']}", json={"done": True}).json()
    assert d["done"] is True
    assert client.get("/api/deadlines").json() == []
    assert len(client.get("/api/deadlines", params={"include_done": True}).json()) == 1
    assert client.patch(f"/api/deadlines/{d['id']}", json={"dueTime": None}).json()["dueTime"] is None
    assert client.delete(f"/api/deadlines/{d['id']}").status_code == 204
    assert client.post("/api/deadlines", json={"title": "x", "dueDate": "2026-13-01"}).status_code == 422
    assert client.post("/api/deadlines", json={"title": "x", "dueDate": "2026-12-01", "dueTime": "25:00"}).status_code == 422


def test_brief(client):
    today = date.today()
    client.post("/api/deadlines", json={"title": "Lab record", "kind": "assignment", "dueDate": today.isoformat()})
    client.post("/api/deadlines", json={"title": "DBMS viva", "kind": "exam", "dueDate": (today + timedelta(days=1)).isoformat()})
    client.post("/api/deadlines", json={"title": "Fees", "kind": "payment", "dueDate": (today + timedelta(days=4)).isoformat()})
    post(client, "Friend", "Bro can you send me ₹2,000?", "whatsapp")
    b = client.get("/api/brief").json()
    assert b["headline"] == "1 reply needs you · 1 due today · exam tomorrow"
    assert [d["title"] for d in b["today"]] == ["Lab record"]
    assert [d["title"] for d in b["tomorrow"]] == ["DBMS viva"]
    assert [d["title"] for d in b["thisWeek"]] == ["Fees"]
    assert b["pending"] == 1 and b["quiet"]["active"] is False


def test_brief_when_nothing_is_due(client):
    assert client.get("/api/brief").json()["headline"] == "Nothing needs you right now."


def test_quiet_mode_and_urgent(client):
    until = (datetime.now() + timedelta(hours=2)).astimezone().isoformat()
    q = client.put("/api/quiet", json={"until": until, "allow": ["Mom", "mom", "Professor"]}).json()
    assert q["active"] and q["allow"] == ["Mom", "Professor"]
    a = post(client, "Friend", "Standup moved to 4 PM today.")
    b = post(client, "Mom", "Call when free")                         # allow-listed sender
    c = post(client, "Teammate", "URGENT: server is down, call me")   # urgent words
    assert (a["urgent"], b["urgent"], c["urgent"]) == (False, True, True)
    q = client.get("/api/quiet").json()
    assert q["held"] == 1                                             # only the non-urgent one was held
    off = client.put("/api/quiet", json={"until": None}).json()
    assert off["active"] is False and off["allow"] == ["Mom", "Professor"]  # allow list kept for next time
    past = (datetime.now() - timedelta(hours=1)).astimezone().isoformat()
    assert client.put("/api/quiet", json={"until": past}).status_code == 422
