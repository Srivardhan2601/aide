"""Learning from your edits, the Activity history, and editing the profile and rules."""
import json
import shutil
import time

import pytest

from app.config import CONFIG_DIR
from app.drafter import build_system_prompt
from app.db import DB


@pytest.fixture(autouse=True)
def temp_config(tmp_path, monkeypatch):
    """Work on a copy of config/, so tests never touch your real profile and rules."""
    d = tmp_path / "config"
    shutil.copytree(CONFIG_DIR, d)
    monkeypatch.setenv("AIDE_CONFIG_DIR", str(d))
    return d


def post(client, frm="Teammate", text="Standup moved to 4 PM today.", channel="slack"):
    return client.post("/api/messages", json={"channel": channel, "from": frm, "text": text}).json()


def send(client, aid, draft=None):
    client.post(f"/api/approvals/{aid}/approve", json={"draft": draft} if draft else None)
    time.sleep(0.7)
    client.app_ref.state.process_due()


def test_edited_reply_is_learned(client):
    a = post(client)
    send(client, a["id"], draft="noted, see u at 4")
    learned = client.get("/api/learned").json()
    assert len(learned) == 1
    assert learned[0]["reply"] == "noted, see u at 4"
    assert learned[0]["aiDraft"] == a["draft"]
    assert learned[0]["group"] == "teammates"


def test_edit_via_patch_is_learned_too(client):
    a = post(client)
    client.patch(f"/api/approvals/{a['id']}", json={"draft": "ok cool, 4 it is"})
    send(client, a["id"])
    assert [x["reply"] for x in client.get("/api/learned").json()] == ["ok cool, 4 it is"]


def test_unedited_or_whitespace_only_changes_are_not_learned(client):
    a = post(client)
    send(client, a["id"])
    b = post(client)
    send(client, b["id"], draft="  " + b["draft"].upper() + "  ")  # same words
    assert client.get("/api/learned").json() == []


def test_regenerated_draft_counts_as_aide_not_you(client):
    a = post(client)
    r = client.post(f"/api/approvals/{a['id']}/regenerate", json={"tone": "shorter"}).json()
    send(client, a["id"])  # sent exactly as regenerated
    assert client.get("/api/learned").json() == []
    assert r["draft"]


def test_spam_replies_are_never_learned(client):
    a = post(client, frm="Unknown number", text="Send me your address and phone number for the prize.")
    send(client, a["id"], draft="No thanks.")
    assert client.get("/api/learned").json() == []


def test_skipped_drafts_are_not_learned(client):
    a = post(client)
    client.patch(f"/api/approvals/{a['id']}", json={"draft": "something else"})
    client.post(f"/api/approvals/{a['id']}/reject")
    assert client.get("/api/learned").json() == []


def test_forget_a_learned_reply(client):
    a = post(client)
    send(client, a["id"], draft="noted!")
    lid = client.get("/api/learned").json()[0]["id"]
    assert client.delete(f"/api/learned/{lid}").status_code == 204
    assert client.get("/api/learned").json() == []
    assert client.delete(f"/api/learned/{lid}").status_code == 404


def test_learned_examples_reach_the_prompt(client):
    a = post(client, frm="Close friend", text="Had a really rough day.", channel="whatsapp")
    send(client, a["id"], draft="ugh sorry man, call me tonight?")
    from app.config import load_profile, load_rules
    learned = client.app_ref.state.db.list_learned(limit=8)
    prompt = build_system_prompt(load_profile(), load_rules(), learned)
    assert "ugh sorry man, call me tonight?" in prompt
    assert "Had a really rough day." in prompt


def test_activity_lists_sent_and_skipped(client):
    a = post(client)
    b = post(client, frm="Friend", text="Bro can you send me ₹2,000?", channel="whatsapp")
    send(client, a["id"], draft="noted!")
    client.post(f"/api/approvals/{b['id']}/reject")
    items = client.get("/api/activity").json()
    by_id = {i["id"]: i for i in items}
    assert by_id[a["id"]]["status"] == "sent" and by_id[a["id"]]["edited"] and by_id[a["id"]]["learned"]
    assert by_id[a["id"]]["transport"] == "mock"
    assert by_id[b["id"]]["status"] == "skipped" and not by_id[b["id"]]["learned"]
    assert len(items) == 2


def test_profile_read_and_update(client, temp_config):
    p = client.get("/api/profile").json()
    assert p["name"] == "Sri Vardhan" and set(p["needsConfirming"]) == {"form_of_address", "availability"}
    r = client.patch("/api/profile", json={"formOfAddress": "Sri", "availability": "after 6 PM on weekdays"})
    assert r.status_code == 200
    body = r.json()
    assert body["formOfAddress"] == "Sri" and body["availability"] == "after 6 PM on weekdays"
    assert body["needsConfirming"] == []
    saved = json.loads((temp_config / "style_profile.json").read_text(encoding="utf-8"))
    assert saved["form_of_address"]["value"] == "Sri"
    assert saved["writing_style"]  # other settings untouched
    assert client.patch("/api/profile", json={"formOfAddress": ""}).status_code == 422


def test_rules_read_and_update(client, temp_config):
    r = client.get("/api/rules").json()
    assert r["auto"] and r["ask"] and r["never"] and r["hardRules"]
    new = {"auto": ["thank-you notes", "Thank-you notes", "  meeting   confirmations "],
           "ask": ["anything with money"], "never": ["share my address"]}
    out = client.put("/api/rules", json=new).json()
    assert out["auto"] == ["thank-you notes", "meeting confirmations"]  # cleaned + de-duplicated
    assert out["hardRules"] == r["hardRules"]                           # safety rules can't be edited here
    saved = json.loads((temp_config / "rules.json").read_text(encoding="utf-8"))
    assert saved["buckets"]["ask"]["covers"] == ["anything with money"]
    assert client.put("/api/rules", json={"auto": ["x"] * 31}).status_code == 422


def test_real_config_untouched_by_tests():
    real = json.loads((CONFIG_DIR / "style_profile.json").read_text(encoding="utf-8"))
    assert real["form_of_address"]["value"] == "Sri Vardhan"


def test_old_database_gets_migrated(tmp_path):
    import sqlite3
    path = tmp_path / "old.db"
    con = sqlite3.connect(path)
    con.executescript("""CREATE TABLE approvals (id INTEGER PRIMARY KEY, message_id INTEGER, channel TEXT, sender TEXT,
        original TEXT, draft TEXT, tone TEXT, bucket TEXT, reason TEXT, confidence TEXT, status TEXT, send_at TEXT,
        created_at TEXT, updated_at TEXT);
        INSERT INTO approvals VALUES (1, 1, 'slack', 'x', 'hi', 'hello', 'default', 'auto', '', 'high', 'pending', NULL, 't', 't');""")
    con.commit()
    con.close()
    db = DB(path)
    assert db.get_approval(1)["ai_draft"] == "hello"
    db.close()
