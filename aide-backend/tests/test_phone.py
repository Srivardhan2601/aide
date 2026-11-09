"""Phone access on home Wi-Fi: PIN pairing, device passes, and what stays laptop-only."""
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.drafter import MockDrafter
from app.main import create_app

LAPTOP = ("127.0.0.1", 50000)
PHONE = ("192.168.1.20", 50000)
STRANGER = ("192.168.1.66", 50000)


@pytest.fixture
def lan(tmp_path):
    app = create_app(Settings(db_path=tmp_path / "p.db", lan=True), drafter=MockDrafter())
    with TestClient(app, client=LAPTOP) as laptop, TestClient(app, client=PHONE) as phone_c, \
            TestClient(app, client=STRANGER) as stranger:
        yield app, laptop, phone_c, stranger


def test_laptop_has_full_access_and_sees_pin(lan):
    _, laptop, _, _ = lan
    assert laptop.get("/api/approvals").status_code == 200
    info = laptop.get("/api/lan").json()
    assert info["enabled"] and len(info["pin"]) == 6 and info["devices"] == []


def test_unpaired_device_gets_no_data(lan):
    _, _, phone_c, _ = lan
    for path in ("/api/approvals", "/api/brief", "/api/learned", "/api/food/orders", "/api/deadlines"):
        r = phone_c.get(path)
        assert r.status_code == 401 and r.json()["detail"] == "pair", path
    assert phone_c.post("/api/messages", json={"channel": "gmail", "from": "x", "text": "y"}).status_code == 401
    assert phone_c.get("/").status_code == 200                       # the app shell itself loads
    assert phone_c.get("/api/pair/status").json() == {"paired": False}


def test_pairing_with_pin(lan):
    _, laptop, phone_c, stranger = lan
    pin = laptop.get("/api/lan").json()["pin"]
    r = phone_c.post("/api/pair", json={"pin": pin}, headers={"user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)"})
    assert r.status_code == 200 and "httponly" in r.headers["set-cookie"].lower()
    assert phone_c.get("/api/approvals").status_code == 200          # paired: works now
    assert stranger.get("/api/approvals").status_code == 401         # others still locked out
    devices = laptop.get("/api/lan").json()["devices"]
    assert [d["name"] for d in devices] == ["iPhone"]
    # One-time PIN: it changed, so the old one can't pair a second device.
    assert laptop.get("/api/lan").json()["pin"] != pin
    assert stranger.post("/api/pair", json={"pin": pin}).status_code == 401


def test_phone_cannot_see_pin_or_manage_devices(lan):
    _, laptop, phone_c, _ = lan
    phone_c.post("/api/pair", json={"pin": laptop.get("/api/lan").json()["pin"]})
    assert phone_c.get("/api/lan").status_code == 403
    assert phone_c.post("/api/lan/pin").status_code == 403
    assert phone_c.get("/api/lan/qr.svg", params={"url": "https://192.168.1.5:8443"}).status_code == 403


def test_removing_a_device_revokes_it(lan):
    _, laptop, phone_c, _ = lan
    phone_c.post("/api/pair", json={"pin": laptop.get("/api/lan").json()["pin"]})
    dev = laptop.get("/api/lan").json()["devices"][0]
    assert laptop.delete(f"/api/lan/devices/{dev['id']}").status_code == 204
    assert phone_c.get("/api/approvals").status_code == 401


def test_wrong_pins_lock_pairing(lan):
    _, laptop, _, stranger = lan
    real = laptop.get("/api/lan").json()["pin"]
    wrong = "000000" if real != "000000" else "111111"
    for _ in range(5):
        assert stranger.post("/api/pair", json={"pin": wrong}).status_code == 401
    r = stranger.post("/api/pair", json={"pin": real})              # even the right PIN is refused now
    assert r.status_code == 429 and "Try again" in r.json()["detail"]
    assert stranger.post("/api/pair", json={"pin": "12ab56"}).status_code == 422


def test_forged_cookie_is_rejected(lan):
    _, _, phone_c, _ = lan
    phone_c.cookies.set("aide_device", "made-up-token")
    assert phone_c.get("/api/approvals").status_code == 401


def test_qr_code(lan):
    _, laptop, _, _ = lan
    r = laptop.get("/api/lan/qr.svg", params={"url": "https://192.168.1.5:8443"})
    assert r.status_code == 200 and r.headers["content-type"].startswith("image/svg+xml") and "<svg" in r.text
    assert laptop.get("/api/lan/qr.svg", params={"url": "javascript:alert(1)"}).status_code == 422


def test_off_by_default(client):
    assert client.post("/api/pair", json={"pin": "123456"}).status_code == 404
