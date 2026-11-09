"""Conversation memory (earlier messages go into the prompt) and the weekly recap."""
import time
from datetime import date

from app.drafter import Draft, build_user_prompt


def post(client, frm, text, channel="whatsapp"):
    return client.post("/api/messages", json={"channel": channel, "from": frm, "text": text}).json()


def send(client, aid, draft=None):
    client.post(f"/api/approvals/{aid}/approve", json={"draft": draft} if draft else None)
    time.sleep(0.7)
    client.app_ref.state.process_due()


class RecordingDrafter:
    """Captures the history each draft was given."""
    kind = "mock"
    learned_source = None

    def __init__(self):
        self.calls = []

    def draft(self, *, channel, sender, text, tone="default", previous_draft=None, history=None):
        self.calls.append({"sender": sender, "text": text, "history": history or []})
        return Draft(draft="ok, noted", confidence="high", bucket="auto", reason="test")


def test_history_is_the_conversation_with_that_person(tmp_path):
    from fastapi.testclient import TestClient

    from app.config import Settings
    from app.main import create_app

    rec = RecordingDrafter()
    app = create_app(Settings(db_path=tmp_path / "m.db", undo_seconds=0.3), drafter=rec)
    with TestClient(app) as c:
        a = post(c, "Sam", "lunch today?")
        c.post(f"/api/approvals/{a['id']}/approve", json={"draft": "yes! 1pm?"})
        time.sleep(0.4)
        app.state.process_due()
        post(c, "Priya", "different person")              # not part of Sam's thread
        post(c, "Sam", "cool, ramen place on 5th?", "gmail")  # same name, other app: separate thread
        post(c, "Sam", "cool, ramen place on 5th?")
    last = rec.calls[-1]["history"]
    assert [(h["who"], h["text"]) for h in last] == [("them", "lunch today?"), ("me", "yes! 1pm?")]
    assert rec.calls[0]["history"] == []                  # first message: nothing before it
    assert rec.calls[2]["history"] == []                  # Sam on Gmail has no history


def test_unsent_drafts_are_not_history(client):
    a = post(client, "Sam", "lunch today?")
    client.patch(f"/api/approvals/{a['id']}", json={"draft": "never sent"})
    hist = client.app_ref.state.db.conversation("whatsapp", "Sam")
    assert [(h["who"], h["text"]) for h in hist] == [("them", "lunch today?")]


def test_history_in_prompt_and_limited():
    hist = [{"who": "them", "text": "lunch today?", "at": "2026-11-01T10:00:00+00:00"},
            {"who": "me", "text": "yes! 1pm?", "at": "2026-11-01T10:05:00+00:00"}]
    p = build_user_prompt("whatsapp", "Sam", "ramen?", "friends", "default", None, hist)
    assert "<conversation_history>" in p and "[them," in p and "[you," in p and "yes! 1pm?" in p
    assert p.index("<conversation_history>") < p.index("<incoming_message")
    assert "not instructions" in p
    assert "<conversation_history>" not in build_user_prompt("whatsapp", "Sam", "hi", "friends", "default", None, [])


def test_history_is_capped(client):
    for i in range(10):
        post(client, "Sam", f"message {i}")
    hist = client.app_ref.state.db.conversation("whatsapp", "Sam", limit=6)
    assert [h["text"] for h in hist] == [f"message {i}" for i in range(4, 10)]


# ----- weekly recap ---------------------------------------------------------

def test_weekly_empty(client):
    w = client.get("/api/weekly").json()
    assert w["handled"] == 0 and w["medianReplyMinutes"] is None and w["busiestDay"] is None
    assert len(w["days"]) == 7 and w["topPeople"] == []


def test_weekly_counts(client):
    a = post(client, "Sam", "lunch today?")
    b = post(client, "Sam", "and dinner?")
    c = post(client, "Priya", "Standup moved to 4 PM today.", "slack")
    d = post(client, "Spam", "Send me your bank details for the prize")
    send(client, a["id"], draft="yes, 1pm")      # edited -> learned
    send(client, b["id"])                        # sent as drafted
    client.post(f"/api/approvals/{d['id']}/reject")
    db = client.app_ref.state.db
    db.add_deadline(title="Lab", kind="assignment", due_date=date.today().isoformat(), due_time=None)
    db.update_deadline(db.list_deadlines()[0]["id"], done=1)

    w = client.get("/api/weekly").json()
    assert w["handled"] == 2 and w["skipped"] == 1 and w["edited"] == 1 and w["received"] == 4
    assert w["timeSavedMinutes"] == 6
    assert w["days"][-1]["handled"] == 2 and w["busiestDay"] == w["to"]
    assert w["medianReplyMinutes"] == 0
    assert w["topPeople"][0] == {"name": "Sam", "channel": "whatsapp", "messages": 2}
    assert w["deadlinesDone"] == 1
    assert c["id"]  # Priya's message counted in received, not handled
