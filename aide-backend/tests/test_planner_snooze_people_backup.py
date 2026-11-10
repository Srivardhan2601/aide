"""Study planner, remind-me-later, people notes, search, backup/restore, auto-send, capture."""
import json
import shutil
import time
from datetime import date, datetime, timedelta

import pytest

from app import planner
from app.config import CONFIG_DIR
from app.db import iso, utcnow
from app.drafter import build_user_prompt

JSON_HDR = {"Content-Type": "application/json"}

TODAY = date(2026, 11, 9)


@pytest.fixture(autouse=True)
def temp_config(tmp_path, monkeypatch):
    d = tmp_path / "config"
    shutil.copytree(CONFIG_DIR, d)
    monkeypatch.setenv("AIDE_CONFIG_DIR", str(d))
    return d


def post(client, frm, text, channel="whatsapp"):
    return client.post("/api/messages", json={"channel": channel, "from": frm, "text": text}).json()


# ===== planner algorithm =====================================================

def subj(i, name, days, topics, mins=60):
    return {"id": i, "name": name, "exam_date": TODAY + timedelta(days=days), "topics": topics, "minutes_per_topic": mins}


def test_revision_day_before_exam_and_all_topics_fit():
    s, warn = planner.build_plan([subj(1, "DBMS", 4, ["ER", "SQL", "Normalization", "Indexing"])], TODAY, 120, set())
    assert warn == []
    assert [(x["day"], x["topic"]) for x in s if x["kind"] == "revision"] == [(TODAY + timedelta(days=3), "Full revision")]
    assert sorted(x["topic"] for x in s if x["kind"] == "study") == ["ER", "Indexing", "Normalization", "SQL"]
    for d in {x["day"] for x in s}:
        assert sum(x["minutes"] for x in s if x["day"] == d and x["kind"] == "study") <= 120
    assert all(x["day"] < TODAY + timedelta(days=4) for x in s)  # nothing on or after exam day


def test_topics_are_spread_out_not_crammed():
    s, warn = planner.build_plan([subj(1, "DBMS", 4, ["ER", "SQL", "Norm", "Txn", "Index"])], TODAY, 240, set())
    per_day = {}
    for x in s:
        if x["kind"] == "study":
            per_day[x["day"]] = per_day.get(x["day"], 0) + 1
    assert warn == [] and max(per_day.values()) <= 2 and len(per_day) == 3  # 5 topics over 3 study days


def test_nearer_exam_gets_priority_but_later_one_still_progresses():
    s, warn = planner.build_plan([subj(1, "OS", 3, ["a", "b", "c", "d"]), subj(2, "Maths", 10, list("pqrstu"))],
                                 TODAY, 180, set())
    assert warn == []
    first_two_days = [x["subject"] for x in s if x["day"] <= TODAY + timedelta(days=1) and x["kind"] == "study"]
    assert first_two_days.count("OS") >= 3
    assert {x["subject"] for x in s if x["kind"] == "study"} == {"OS", "Maths"}


def test_done_topics_are_not_rescheduled():
    done = {(1, "ER", "study"), (1, "SQL", "study")}
    s, _ = planner.build_plan([subj(1, "DBMS", 3, ["ER", "SQL", "Indexing"])], TODAY, 120, done)
    assert [x["topic"] for x in s if x["kind"] == "study"] == ["Indexing"]


def test_too_much_work_warns_instead_of_dropping():
    s, warn = planner.build_plan([subj(1, "Physics", 2, [f"ch{i}" for i in range(10)])], TODAY, 60, set())
    assert warn and "don't fit" in warn[0] and "Physics" in warn[0]


def test_no_topics_gets_default_parts_and_past_exams_ignored():
    s, _ = planner.build_plan([subj(1, "Chem", 5, []), subj(2, "Old", -1, ["x"])], TODAY, 240, set())
    assert {x["subject"] for x in s} == {"Chem"} and "Chem: part 1" in [x["topic"] for x in s]


# ===== study API =============================================================

def test_study_api_flow(client):
    exam = (date.today() + timedelta(days=5)).isoformat()
    st = client.post("/api/study/subjects", json={"name": "DBMS", "examDate": exam,
                                                  "topics": ["ER", "SQL", "sql", " Normalization "]}).json()
    assert st["subjects"][0]["topics"] == ["ER", "SQL", "Normalization"]  # cleaned + de-duplicated
    assert any(s["kind"] == "revision" for s in st["sessions"])
    today_sessions = st["today"]
    assert today_sessions and all(s["day"] == date.today().isoformat() for s in today_sessions)
    sid = today_sessions[0]["id"]
    st = client.patch(f"/api/study/sessions/{sid}", json={"done": True}).json()
    assert any(s["id"] == sid and s["done"] for s in st["sessions"])
    # Lower daily time: plan rebuilds, the done session survives.
    st = client.put("/api/study/settings", json={"dailyMinutes": 60}).json()
    assert st["settings"]["dailyMinutes"] == 60
    assert any(s["done"] and s["topic"] == today_sessions[0]["topic"] for s in st["sessions"])
    brief = client.get("/api/brief").json()
    assert "study" in brief and "of study" in brief["headline"] or not [s for s in brief["study"] if not s["done"]]
    sub_id = st["subjects"][0]["id"]
    assert client.delete(f"/api/study/subjects/{sub_id}").json()["sessions"] == []
    assert client.post("/api/study/subjects", json={"name": "x", "examDate": exam, "minutesPerTopic": 5}).status_code == 422


def test_missed_session_moves_forward(client):
    db = client.app_ref.state.db
    exam = (date.today() + timedelta(days=6)).isoformat()
    client.post("/api/study/subjects", json={"name": "OS", "examDate": exam, "topics": ["Paging", "Deadlocks"]})
    # Pretend "Paging" was planned for yesterday and missed.
    with db.lock:
        db.conn.execute("UPDATE study_sessions SET day = ? WHERE topic = 'Paging'", ((date.today() - timedelta(days=1)).isoformat(),))
        db.conn.commit()
    st = client.post("/api/study/replan").json()
    paging = [s for s in st["sessions"] if s["topic"] == "Paging"]
    assert len(paging) == 1 and paging[0]["day"] >= date.today().isoformat()


def test_exam_suggestions_from_deadlines(client):
    post(client, "Prof. Rao", "Mid-sem exam tomorrow at 2pm in hall B", "gmail")
    st = client.get("/api/study").json()
    assert st["suggestions"] and st["suggestions"][0]["dueDate"] == (date.today() + timedelta(days=1)).isoformat()


# ===== remind me later =======================================================

def test_snooze_hides_until_time(client):
    a = post(client, "Sam", "lunch today?")
    later = (datetime.now() + timedelta(hours=3)).astimezone().isoformat()
    r = client.post(f"/api/approvals/{a['id']}/snooze", json={"until": later}).json()
    assert r["snoozeUntil"]
    assert client.get("/api/approvals", params={"status": "pending"}).json() == []
    assert [x["id"] for x in client.get("/api/approvals/snoozed").json()] == [a["id"]]
    assert client.get("/api/stats").json()["pending"] == 0
    assert client.get("/api/brief").json()["snoozed"] == 1
    client.post(f"/api/approvals/{a['id']}/unsnooze")
    assert [x["id"] for x in client.get("/api/approvals", params={"status": "pending"}).json()] == [a["id"]]
    past = (datetime.now() - timedelta(hours=1)).astimezone().isoformat()
    assert client.post(f"/api/approvals/{a['id']}/snooze", json={"until": past}).status_code == 422


def test_snooze_expires_by_itself(client):
    a = post(client, "Sam", "lunch today?")
    db = client.app_ref.state.db
    db.update_approval(a["id"], snooze_until=iso(utcnow() - timedelta(minutes=1)))  # the app stores UTC
    assert [x["id"] for x in client.get("/api/approvals", params={"status": "pending"}).json()] == [a["id"]]


# ===== people notes ==========================================================

def test_people_notes_reach_the_prompt(client):
    post(client, "Prof. Rao", "Please confirm you'll attend Friday's review.", "gmail")
    assert client.put("/api/people/Prof. Rao", json={"notes": "Prefers formal emails. Teaches DBMS."}).status_code == 200
    people = client.get("/api/people").json()
    assert people[0]["name"] == "Prof. Rao" and "formal" in people[0]["notes"] and people[0]["channels"] == ["gmail"]
    p = build_user_prompt("gmail", "Prof. Rao", "hi", "professors", "default", None, [], "Prefers formal emails.")
    assert "<about_sender>" in p and "Prefers formal emails." in p
    client.put("/api/people/Prof. Rao", json={"notes": ""})
    assert client.get("/api/people").json()[0]["notes"] == ""


def test_notes_are_passed_when_drafting(tmp_path):
    from fastapi.testclient import TestClient

    from app.config import Settings
    from app.drafter import Draft
    from app.main import create_app

    seen = {}

    class Rec:
        kind = "mock"
        learned_source = None

        def draft(self, **kw):
            seen.update(kw)
            return Draft(draft="ok", confidence="high", bucket="auto", reason="x")

    app = create_app(Settings(db_path=tmp_path / "n.db"), drafter=Rec())
    with TestClient(app) as c:
        c.put("/api/people/Sam", json={"notes": "Roommate, very casual"})
        post(c, "sam", "lunch?")  # name match is case-insensitive
    assert seen["about"] == "Roommate, very casual"


# ===== search ================================================================

def test_search_everywhere(client):
    post(client, "Prof. Rao", "DBMS viva on the 12th", "gmail")
    client.post("/api/food/orders", json={"text": "2 masala dosa from MTR"})
    client.put("/api/people/Prof. Rao", json={"notes": "teaches DBMS"})
    client.post("/api/study/subjects", json={"name": "DBMS", "examDate": (date.today() + timedelta(days=9)).isoformat()})
    r = client.get("/api/search", params={"q": "dbms"}).json()
    assert r["messages"] and r["people"] and r["study"]
    assert client.get("/api/search", params={"q": "masala"}).json()["food"]
    assert client.get("/api/search", params={"q": "x"}).status_code == 422


# ===== backup / restore ======================================================

def test_backup_and_restore_roundtrip(client, tmp_path, monkeypatch):
    from app import extras
    monkeypatch.setattr(extras, "BACKUP_DIR", tmp_path / "backups")
    post(client, "Sam", "lunch today?")
    client.put("/api/people/Sam", json={"notes": "roommate"})
    client.app_ref.state.db.set_setting("pair_pin", "123456")      # must never be exported
    r = client.get("/api/backup")
    assert r.status_code == 200 and "attachment" in r.headers["content-disposition"]
    data = r.json()
    assert data["app"] == "aide" and data["tables"]["messages"][0]["sender"] == "Sam"
    assert all(k["key"] != "pair_pin" for k in data["tables"]["kv"])
    assert "style_profile.json" in data["config"]

    post(client, "Priya", "something new after the backup")
    out = client.post("/api/backup/restore", content=json.dumps(data), headers=JSON_HDR).json()
    assert out["restored"]["messages"] == 1 and out["safetyCopy"].startswith("before-restore-")
    assert (tmp_path / "backups" / out["safetyCopy"]).exists()
    senders = [m["from"] for m in client.get("/api/approvals").json()]
    assert senders == ["Sam"]
    assert client.app_ref.state.db.get_setting("pair_pin") == "123456"  # untouched by restore


def test_bad_backup_changes_nothing(client, tmp_path, monkeypatch):
    from app import extras
    monkeypatch.setattr(extras, "BACKUP_DIR", tmp_path / "backups")
    post(client, "Sam", "lunch today?")
    assert client.post("/api/backup/restore", content=b"not json", headers=JSON_HDR).status_code == 422
    assert client.post("/api/backup/restore", content=json.dumps({"app": "other"}), headers=JSON_HDR).status_code == 422
    bad = {"app": "aide", "version": 1, "tables": {"messages": [{"id": 1, "nonsense": 1}]}}
    assert client.post("/api/backup/restore", content=json.dumps(bad), headers=JSON_HDR).status_code == 422
    assert [m["from"] for m in client.get("/api/approvals").json()] == ["Sam"]


# ===== auto-send =============================================================

def test_autosend_off_by_default(client):
    assert client.get("/api/autosend").json()["enabled"] is False
    a = post(client, "Teammate", "Standup moved to 4 PM today.", "slack")
    assert a["status"] == "pending"


def test_autosend_only_safe_replies_to_known_people(client):
    client.put("/api/autosend", json={"enabled": True, "dailyCap": 2})
    first = post(client, "Teammate", "Standup moved to 4 PM today.", "slack")
    assert first["status"] == "pending"                       # never auto-send to someone you haven't replied to
    client.post(f"/api/approvals/{first['id']}/approve")
    time.sleep(0.7)
    client.app_ref.state.process_due()
    second = post(client, "Teammate", "Standup moved to 5 PM.", "slack")
    assert second["status"] == "sending" and second["autoSent"]  # safe + known person
    money = post(client, "Teammate", "can you send me ₹500?", "slack")
    assert money["status"] == "pending"                       # money is never auto-sent
    urgent = post(client, "Teammate", "URGENT call me, standup moved", "slack")
    assert urgent["status"] == "pending"                      # urgent ones are for you
    third = post(client, "Teammate", "Standup moved to 6 PM.", "slack")
    fourth = post(client, "Teammate", "Standup moved to 7 PM.", "slack")
    assert third["status"] == "sending" and fourth["status"] == "pending"  # daily cap of 2
    # Undo still works on an auto-sent reply.
    assert client.post(f"/api/approvals/{third['id']}/undo").json()["status"] == "pending"


# ===== quick capture (voice) =================================================

def test_capture_routes_food_deadlines_and_notes(client):
    f = client.post("/api/capture", json={"text": "order 2 masala dosa from MTR"}).json()
    assert f["kind"] == "food" and f["order"]["items"] == [{"name": "Masala dosa", "qty": 2, "notes": ""}]
    d = client.post("/api/capture", json={"text": "DBMS exam tomorrow at 10 am"}).json()
    assert d["kind"] == "deadline" and d["deadline"]["kind"] == "exam" and d["deadline"]["dueTime"] == "10:00"
    n = client.post("/api/capture", json={"text": "remember to call mom"}).json()
    assert n["kind"] == "note"
    x = client.post("/api/capture", json={"text": "in order to submit the report by Monday"}).json()
    assert x["kind"] == "deadline"  # 'in order to' isn't food
