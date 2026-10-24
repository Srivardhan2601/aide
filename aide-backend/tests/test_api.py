import time

import pytest

from app.classifier import classify
from app.config import load_profile
from app.drafter import MockDrafter, build_system_prompt
from app.config import load_rules
from tests.conftest import UNDO_SECONDS


def post(client, channel="gmail", sender="Priya Nair", text="Thanks for sending the notes!"):
    r = client.post("/api/messages", json={"channel": channel, "from": sender, "text": text})
    assert r.status_code == 201, r.text
    return r.json()


def wait_for_status(client, aid, status, timeout=3.0):
    end = time.time() + timeout
    while time.time() < end:
        a = client.get(f"/api/approvals/{aid}").json()
        if a["status"] == status:
            return a
        time.sleep(0.05)
    raise AssertionError(f"approval {aid} never reached {status}; last={a['status']}")


# ----- full flow -------------------------------------------------------------
def test_full_approval_flow(client):
    a = post(client)
    assert a["status"] == "pending"
    assert a["bucket"] in ("auto", "ask", "never") and a["reason"]
    assert a["confidence"] in ("high", "medium", "low")
    assert a["from"] == "Priya Nair" and a["channel"] == "gmail"

    # pending list
    pending = client.get("/api/approvals", params={"status": "pending"}).json()
    assert [p["id"] for p in pending] == [a["id"]]

    # edit
    r = client.patch(f"/api/approvals/{a['id']}", json={"draft": "Thanks Priya, got them!"})
    assert r.status_code == 200 and r.json()["draft"] == "Thanks Priya, got them!"

    # regenerate with each tone
    for tone in ("shorter", "warmer", "formal"):
        r = client.post(f"/api/approvals/{a['id']}/regenerate", json={"tone": tone})
        assert r.status_code == 200, r.text
        assert r.json()["tone"] == tone and r.json()["draft"]
    assert client.post(f"/api/approvals/{a['id']}/regenerate", json={"tone": "angry"}).status_code == 422

    # approve -> sending, then undo inside the window
    r = client.post(f"/api/approvals/{a['id']}/approve")
    assert r.status_code == 200 and r.json()["status"] == "sending" and r.json()["sendAt"]
    r = client.post(f"/api/approvals/{a['id']}/undo")
    assert r.status_code == 200 and r.json()["status"] == "pending" and r.json()["sendAt"] is None
    time.sleep(UNDO_SECONDS + 0.3)
    assert client.get(f"/api/approvals/{a['id']}").json()["status"] == "pending"
    assert client.get("/api/sent").json() == []

    # approve again (with a final edit) and let the window close
    r = client.post(f"/api/approvals/{a['id']}/approve", json={"draft": "Got them, thanks!"})
    assert r.json()["status"] == "sending"
    sent = wait_for_status(client, a["id"], "sent")
    assert sent["draft"] == "Got them, thanks!"
    log = client.get("/api/sent").json()
    assert len(log) == 1 and log[0]["text"] == "Got them, thanks!" and log[0]["transport"] == "mock"

    # undo after the window fails; sent items can't be edited or re-approved
    assert client.post(f"/api/approvals/{a['id']}/undo").status_code == 409
    assert client.patch(f"/api/approvals/{a['id']}", json={"draft": "x"}).status_code == 409
    assert client.post(f"/api/approvals/{a['id']}/approve").status_code == 409

    # stats
    s = client.get("/api/stats").json()
    assert s["handledToday"] == 1 and s["timeSavedMinutes"] == 3 and s["pending"] == 0
    assert s["streakDays"] == 1 and len(s["timeSavedWeek"]) == 7 and s["timeSavedWeek"][-1] == 3


def test_reject(client):
    a = post(client, text="Pushed the latest changes, check when free.", sender="Teammate", channel="telegram")
    r = client.post(f"/api/approvals/{a['id']}/reject")
    assert r.status_code == 200 and r.json()["status"] == "rejected"
    assert client.get("/api/approvals", params={"status": "pending"}).json() == []
    assert client.post(f"/api/approvals/{a['id']}/reject").status_code == 409
    assert client.post(f"/api/approvals/{a['id']}/approve").status_code == 409
    assert client.get("/api/stats").json()["handledToday"] == 0


def test_undo_requires_sending(client):
    a = post(client)
    assert client.post(f"/api/approvals/{a['id']}/undo").status_code == 409


def test_validation(client):
    assert client.post("/api/messages", json={"channel": "fax", "from": "A", "text": "hi"}).status_code == 422
    assert client.post("/api/messages", json={"channel": "gmail", "from": "A", "text": ""}).status_code == 422
    assert client.get("/api/approvals/999").status_code == 404
    assert client.get("/api/approvals", params={"status": "bogus"}).status_code == 422


def test_stats_empty(client):
    s = client.get("/api/stats").json()
    assert s == {"handledToday": 0, "pending": 0, "timeSavedMinutes": 0, "streakDays": 0, "timeSavedWeek": [0] * 7}


def test_health_reports_mock(client):
    h = client.get("/api/health").json()
    assert h["ok"] and h["drafter"] == "mock"


def test_ui_is_served(client):
    r = client.get("/")
    assert r.status_code == 200 and "<title>Aide</title>" in r.text


# ----- bucket classification on all 10 fixtures ------------------------------
def test_fixture_count(samples):
    assert len(samples) == 10


@pytest.mark.parametrize("text,bucket,category", [
    ("Can you lend me 2,000 rupees till Friday?", "ask", "money"),
    ("Share your bank account number to receive the refund", "never", "personal_info"),
    ("Thanks, the photos are yours to keep!", "auto", "thanks"),
    ("qwerty zxcv", "ask", "general"),
])
def test_classifier_extra_cases(text, bucket, category):
    c = classify(text)
    assert (c.bucket, c.category) == (bucket, category)


@pytest.mark.parametrize("i", range(10))
def test_classifier_buckets(samples, i):
    s = samples[i]
    assert classify(s["text"], s["from"]).bucket == s["expected_bucket"], s


def test_api_buckets_and_hard_rules(client, samples):
    by_text = {}
    for s in samples:
        a = post(client, s["channel"], s["from"], s["text"])
        assert a["bucket"] == s["expected_bucket"], (s, a)
        assert a["status"] == "pending"  # everything lands in the queue for now
        by_text[s["text"]] = a
    assert len(client.get("/api/approvals", params={"status": "pending"}).json()) == 10

    money = by_text["Bro can you send me ₹2,000? I'll return it Sunday."]["draft"].lower()
    assert "sending" not in money and "sent" not in money and "check" in money  # non-committal, no agreement

    spam = by_text["Hi, send me your address and phone number for the prize."]
    assert "don't share" in spam["draft"].lower() and "spam" in spam["reason"].lower()

    deadline = by_text["Can you get the report done by Monday?"]["draft"].lower()
    assert "confirm" in deadline and "monday" not in deadline  # never agrees to the deadline

    emotional = by_text["Had a really rough day. Everything feels like too much."]
    assert emotional["bucket"] == "ask" and "sorry" in emotional["draft"].lower()


# ----- prompt building -------------------------------------------------------
def test_prompt_handles_empty_examples():
    profile = load_profile()
    assert profile["example_replies"] == []
    prompt = build_system_prompt(profile, load_rules())
    assert "No real example replies" in prompt
    assert "Sri Vardhan" in prompt
    assert "Never agree to send, lend or transfer money" in prompt


def test_prompt_includes_examples_when_present():
    profile = load_profile()
    profile["example_replies"] = [{"to": "friend", "message": "lunch?", "reply": "yes!"}]
    prompt = build_system_prompt(profile, load_rules())
    assert "<examples>" in prompt and "yes!" in prompt


def test_mock_drafter_is_deterministic():
    d = MockDrafter()
    a = d.draft(channel="gmail", sender="Professor", text="Please confirm you'll attend Friday's 11 AM review.")
    b = d.draft(channel="gmail", sender="Professor", text="Please confirm you'll attend Friday's 11 AM review.")
    assert a == b and a.draft.startswith("Good morning Professor")
