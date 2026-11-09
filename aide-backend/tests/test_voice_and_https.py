"""Talk mode, hands-free reply commands, edit-by-voice, and the phone HTTPS certificate."""
import ipaddress
import ssl
from datetime import date, datetime, timedelta

import pytest
from cryptography import x509
from fastapi.testclient import TestClient

from app import certs, voice
from app.config import Settings
from app.drafter import MockDrafter, build_user_prompt
from app.main import create_app

NOW = datetime(2026, 11, 4, 10, 0)  # a Wednesday


# ----- understanding what you said ------------------------------------------------
@pytest.mark.parametrize("text,intent", [
    ("What's on today?", "brief"),
    ("Give me my summary", "brief"),
    ("What should I study today?", "study"),
    ("When is my next exam?", "exam"),
    ("When's the DBMS viva", "exam"),
    ("What's due this week", "due"),
    ("Any new messages?", "messages"),
    ("Who messaged me", "messages"),
    ("Go through my replies", "replies"),
    ("Read my messages", "replies"),
    ("Remind me to submit the lab record on Friday", "add"),
    ("Order 2 masala dosa from MTR", "food"),
    ("Thanks", "stop"),
    ("What can you do", "help"),
    ("Blah blah purple", "unknown"),
])
def test_talk_intents(text, intent):
    assert voice.talk_intent(text) == intent


def test_reminder_parsing():
    r = voice.parse_reminder("Remind me to submit the lab record on Friday at 5 pm", NOW)
    assert r == {"title": "Submit the lab record", "kind": "assignment", "due_date": "2026-11-06", "due_time": "17:00"}
    r = voice.parse_reminder("remind me to call mom tomorrow", NOW)
    assert (r["title"], r["kind"], r["due_date"]) == ("Call mom", "meeting", "2026-11-05")
    r = voice.parse_reminder("Add pay hostel fees by 15th", NOW)
    assert (r["title"], r["kind"], r["due_date"]) == ("Pay hostel fees", "payment", "2026-11-15")
    assert voice.parse_reminder("remind me to buy a charger", NOW) is None  # no day: ask again


@pytest.mark.parametrize("text,cmd", [
    ("Send it", "send"), ("Approve", "send"), ("Looks good", "send"),
    ("Next", "next"), ("Skip", "next"), ("Not now", "next"),
    ("Don't send that", "reject"), ("Ignore it", "reject"),
    ("Say I'll send it tonight", "edit"), ("Make it shorter", "edit"), ("More formal", "edit"),
    ("Tell him I'm busy till Friday", "edit"),
    ("Later", "later"), ("Remind me after my exam", "later"), ("Tomorrow", "later"),
    ("Read it again", "repeat"), ("Stop", "stop"), ("I'm done", "stop"),
    ("hmm what", "unknown"),
])
def test_reply_commands(text, cmd):
    assert voice.reply_command(text)["cmd"] == cmd


def test_reply_command_details():
    assert voice.reply_command("Change it") == {"cmd": "edit", "instruction": ""}  # ask what to change
    assert voice.reply_command("Say I'll send it tonight")["instruction"] == "Say I'll send it tonight"
    assert voice.reply_command("Remind me after my exam")["when"] == "exam"
    assert voice.reply_command("Later tonight")["when"] == "evening"
    assert voice.reply_command("Later")["when"] == "tomorrow"
    assert [voice.confirm_answer(t) for t in ("Yes", "yeah send it", "No", "wait", "banana")] == \
        ["yes", "yes", "no", "no", "unknown"]


def test_spoken_dates_and_times():
    today = date(2026, 11, 4)
    assert voice.when_words(today, today) == "today"
    assert voice.when_words(date(2026, 11, 5), today) == "tomorrow"
    assert voice.when_words(date(2026, 11, 6), today) == "on Friday"
    assert voice.when_words(date(2026, 11, 20), today) == "on Friday, Nov 20"
    assert voice.time_words("14:00") == " at 2 PM" and voice.time_words("09:30") == " at 9:30 AM"
    assert voice.minutes_words(90) == "an hour and a half" and voice.minutes_words(150) == "2 hours 30 minutes"


# ----- talk API -----------------------------------------------------------------
def talk(client, text):
    return client.post("/api/voice/talk", json={"text": text}).json()


def msg(client, frm, text, channel="whatsapp"):
    return client.post("/api/messages", json={"channel": channel, "from": frm, "text": text}).json()


def test_talk_answers_from_your_data(client):
    assert "Nothing needs you" in talk(client, "what's on today")["say"]
    assert talk(client, "go through my replies")["say"] == "No replies are waiting. You're all caught up."
    msg(client, "Rahul", "Are you coming to the fest?")
    msg(client, "Professor", "Please send the report", "gmail")
    a = talk(client, "any new messages")
    assert "2 replies are waiting: Rahul on WhatsApp and Professor on Gmail" in a["say"]
    r = talk(client, "go through my replies")
    assert r["action"] == "replies" and "2 replies" in r["say"]
    assert "2 replies need you" in talk(client, "what's my day look like")["say"]
    assert talk(client, "thanks")["end"] is True
    assert talk(client, "purple monkey")["intent"] == "unknown"


def test_talk_adds_reminders_and_plans_food(client):
    friday = date.today() + timedelta(days=(4 - date.today().weekday()) % 7 or 7)
    a = talk(client, "Remind me to submit the lab record on Friday")
    assert a["say"].startswith("Added: Submit the lab record,") and a["view"] == "tasks"
    dl = client.get("/api/deadlines").json()
    assert [(d["title"], d["dueDate"]) for d in dl] == [("Submit the lab record", friday.isoformat())]
    assert "already on your list" in talk(client, "Remind me to submit the lab record on Friday")["say"]
    assert "When is it due" in talk(client, "remind me to buy a charger")["say"]
    f = talk(client, "order 2 masala dosa from MTR")
    assert "masala dosa" in f["say"].lower() and "never place orders by voice" in f["say"] and f["view"] == "food"
    assert client.get("/api/food/orders").json()[0]["status"] == "planned"  # planned, not ordered


def test_talk_study_and_exams(client):
    assert "don't have a study plan" in talk(client, "what should I study")["say"]
    assert "any upcoming exams" in talk(client, "when is my next exam")["say"]
    exam_day = date.today() + timedelta(days=5)
    client.post("/api/study/subjects", json={"name": "DBMS", "examDate": exam_day.isoformat(),
                                             "topics": ["Normalization", "Transactions", "Indexing"]})
    client.post("/api/deadlines", json={"title": "OS lab exam", "kind": "exam",
                                        "dueDate": (date.today() + timedelta(days=9)).isoformat(), "dueTime": "14:00"})
    s = talk(client, "what should I study today")
    assert s["say"].startswith("Today you have") and "DBMS" in s["say"]
    e = talk(client, "when is my next exam")
    assert e["say"].startswith("Your next exam is DBMS exam") and "in 5 days" in e["say"] and "OS lab exam" in e["say"]
    o = talk(client, "when is my OS exam")
    assert o["say"].startswith("Your OS lab exam is") and "at 2 PM" in o["say"]


def test_voice_command_api(client):
    r = client.post("/api/voice/command", json={"text": "yes send it"}).json()
    assert r["cmd"] == "send" and r["confirm"] == "yes"
    assert client.post("/api/voice/command", json={"text": ""}).status_code == 422


# ----- edit a draft by voice -------------------------------------------------------
def test_revise_draft(client):
    a = msg(client, "Rahul", "Can you share the notes?")
    longer = client.post(f"/api/approvals/{a['id']}/revise", json={"instruction": "say I'll send them tonight"}).json()
    assert longer["draft"].endswith("I'll send them tonight.") and longer["draft"].startswith(a["draft"].rstrip())
    shorter = client.post(f"/api/approvals/{a['id']}/revise", json={"instruction": "make it shorter"}).json()
    assert len(shorter["draft"]) < len(longer["draft"])
    same = client.post(f"/api/approvals/{a['id']}/revise", json={"instruction": "use a pirate voice"}).json()
    assert same["draft"] == shorter["draft"] and "simple changes" in same["reason"]
    client.post(f"/api/approvals/{a['id']}/reject")
    assert client.post(f"/api/approvals/{a['id']}/revise", json={"instruction": "shorter"}).status_code == 409


def test_claude_prompt_carries_the_instruction():
    p = build_user_prompt("whatsapp", "Rahul", "notes?", "friends", "default", "Sure!", instruction="say tonight")
    assert "<user_change>\nsay tonight\n</user_change>" in p and "never from the sender" in p
    assert "<user_change>" not in build_user_prompt("whatsapp", "Rahul", "notes?", "friends", "shorter", "Sure!")


def test_revise_keeps_the_safety_floor(client):
    a = msg(client, "Unknown number", "Send me 5000 rupees urgently")
    r = client.post(f"/api/approvals/{a['id']}/revise", json={"instruction": "say ok I'll send the money now"}).json()
    assert r["bucket"] == a["bucket"] != "auto"  # an edit never loosens the label


# ----- phone HTTPS ------------------------------------------------------------------
def handshake(p, address):
    """TLS handshake in memory, like a phone that installed the home CA. None if it succeeds."""
    server_ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    server_ctx.load_cert_chain(p["crt"], p["key"])
    client_ctx = ssl.create_default_context(cafile=str(p["ca_crt"]))
    c_in, c_out, s_in, s_out = ssl.MemoryBIO(), ssl.MemoryBIO(), ssl.MemoryBIO(), ssl.MemoryBIO()
    client = client_ctx.wrap_bio(c_in, c_out, server_hostname=address)
    server = server_ctx.wrap_bio(s_in, s_out, server_side=True)
    done = {"c": False, "s": False}
    for _ in range(10):
        for name, side, out_bio, peer_in in (("c", client, c_out, s_in), ("s", server, s_out, c_in)):
            if not done[name]:
                try:
                    side.do_handshake()
                    done[name] = True
                except ssl.SSLWantReadError:
                    pass
                except ssl.SSLError as e:
                    if name == "c":
                        return str(e)
                    raise
            data = out_bio.read()
            if data:
                peer_in.write(data)
        if all(done.values()):
            return None
    return "handshake did not finish"


def test_certificates(tmp_path):
    p = certs.ensure(["192.168.1.20", "127.0.0.1", "8.8.8.8", "bad"], tmp_path)
    ca = x509.load_pem_x509_certificate(p["ca_crt"].read_bytes())
    leaf = x509.load_pem_x509_certificate(p["crt"].read_bytes())
    # The home CA can only vouch for private addresses and a name that never resolves.
    nc = ca.extensions.get_extension_for_class(x509.NameConstraints)
    assert nc.critical
    permitted = {str(n.value) for n in nc.value.permitted_subtrees}
    assert permitted == {"10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "aide.invalid"}
    assert ca.extensions.get_extension_for_class(x509.BasicConstraints).value.path_length == 0
    ips = leaf.extensions.get_extension_for_class(x509.SubjectAlternativeName).value.get_values_for_type(x509.IPAddress)
    assert ips == [ipaddress.ip_address("192.168.1.20")]  # public and loopback addresses left out
    leaf.verify_directly_issued_by(ca)
    # A real TLS handshake: a client trusting only the home CA accepts it (name limits included).
    assert handshake(p, "192.168.1.20") is None
    assert "mismatch" in handshake(p, "192.168.1.99")  # wrong address is refused
    # Same address: reused. New address: a new server certificate from the same CA.
    before = p["crt"].read_bytes()
    assert certs.ensure(["192.168.1.20"], tmp_path)["crt"].read_bytes() == before
    certs.ensure(["192.168.1.21"], tmp_path)
    assert p["crt"].read_bytes() != before and p["ca_crt"].read_bytes() == ca.public_bytes(
        __import__("cryptography.hazmat.primitives.serialization", fromlist=["Encoding"]).Encoding.PEM)
    assert certs.ca_fingerprint(tmp_path).count(":") == 7


def test_phone_links_are_https(tmp_path, monkeypatch):
    monkeypatch.setattr(certs, "CERT_DIR", tmp_path / "certs")
    monkeypatch.setattr("app.phone.lan_ips", lambda: ["192.168.1.20", "8.8.8.8"])
    certs.ensure(["192.168.1.20"])
    app = create_app(Settings(db_path=tmp_path / "p.db", lan=True), drafter=MockDrafter())
    with TestClient(app, client=("127.0.0.1", 5000)) as laptop:
        info = laptop.get("/api/lan").json()
        assert info["urls"] == ["https://192.168.1.20:8443"] and info["caFingerprint"]
        assert laptop.get("/api/lan/qr.svg", params={"url": "https://192.168.1.20:8443"}).status_code == 200
        assert laptop.get("/api/lan/qr.svg", params={"url": "http://192.168.1.20:8000"}).status_code == 422
        r = laptop.get("/aide-home-ca.crt")
        assert r.status_code == 200 and r.headers["content-type"] == "application/x-x509-ca-cert"
        x509.load_der_x509_certificate(r.content)
    with TestClient(app, client=("192.168.1.50", 5000)) as phone_c:  # an unpaired phone can still get the CA
        assert phone_c.get("/aide-home-ca.crt").status_code == 200
        assert phone_c.get("/api/brief").status_code == 401


def test_pairing_cookie_is_secure_over_https(tmp_path):
    app = create_app(Settings(db_path=tmp_path / "p.db", lan=True), drafter=MockDrafter())
    with TestClient(app, client=("127.0.0.1", 5000)) as laptop, \
            TestClient(app, base_url="https://192.168.1.20:8443", client=("192.168.1.50", 5000)) as phone_c:
        pin = laptop.get("/api/lan").json()["pin"]
        r = phone_c.post("/api/pair", json={"pin": pin})
        assert r.status_code == 200 and "secure" in r.headers["set-cookie"].lower()


def test_ca_download_is_off_without_phone_access(client):
    assert client.get("/aide-home-ca.crt").status_code == 404
