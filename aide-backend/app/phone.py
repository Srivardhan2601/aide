"""Use Aide from your phone on home Wi-Fi.

Off unless Aide starts with AIDE_LAN=on (start-phone.cmd). Then:
- This computer (localhost) always has full access.
- Other devices can load the app's screens, but every /api call needs a device pass.
  A phone gets one by entering the 6-digit PIN shown on this computer.
- The PIN is one-time: it changes after each successful pairing. 5 wrong PINs lock
  pairing for 10 minutes.
- Each paired phone can be removed from this computer at any time.
- Only a hash of each pass is stored.

Phones connect over HTTPS with Aide's home certificate (app/certs.py). Use it on trusted
home Wi-Fi, not public Wi-Fi.
"""
from __future__ import annotations

import hashlib
import hmac
import ipaddress
import re
import secrets
import socket
import threading
import time

from .db import DB, iso, utcnow

COOKIE = "aide_device"
COOKIE_DAYS = 90
LOCAL_HOSTS = {"127.0.0.1", "::1", "localhost"}
MAX_FAILURES, LOCKOUT_SECONDS = 5, 600
LOCAL_ORIGIN = re.compile(r"https?://(localhost|127\.0\.0\.1)(:\d+)?")
NAMED_HOSTS = {"localhost", "testserver"}  # testserver = the test client


def allowed_host(host_header: str) -> bool:
    """Aide answers only to this computer's names and private network addresses (192.168.x.x etc.),
    never to a website's domain name, so a site can't point its name at Aide (DNS rebinding)."""
    host = host_header.strip().lower()
    if host.startswith("["):  # [::1]:8000
        host = host[1:].split("]", 1)[0]
    elif host.count(":") == 1:
        host = host.split(":", 1)[0]
    if host in NAMED_HOSTS:
        return True
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return False
    return ip.is_loopback or (ip.is_private and not ip.is_link_local)


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def lan_ips() -> list[str]:
    """This computer's address(es) on the local network."""
    ips: set[str] = set()
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))  # no packet is sent; it just picks the LAN interface
            ips.add(s.getsockname()[0])
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ips.add(info[4][0])
    except OSError:
        pass
    return sorted(ip for ip in ips if not ip.startswith(("127.", "169.254.", "0.")))


class Pairing:
    def __init__(self, db: DB):
        self.db = db
        self.lock = threading.Lock()
        self.failures: list[float] = []

    # ----- PIN ---------------------------------------------------------------
    def pin(self) -> str:
        p = self.db.get_setting("pair_pin")
        return p or self.new_pin()

    def new_pin(self) -> str:
        p = f"{secrets.randbelow(10**6):06d}"
        self.db.set_setting("pair_pin", p)
        return p

    def locked_for(self) -> int:
        now = time.monotonic()
        self.failures = [t for t in self.failures if now - t < LOCKOUT_SECONDS]
        if len(self.failures) >= MAX_FAILURES:
            return int(LOCKOUT_SECONDS - (now - self.failures[0])) + 1
        return 0

    def pair(self, pin: str, name: str) -> str | None:
        """Returns a new device pass for a correct PIN, else None."""
        with self.lock:
            if self.locked_for():
                return None
            if not hmac.compare_digest(pin.strip(), self.pin()):
                self.failures.append(time.monotonic())
                return None
            token = secrets.token_urlsafe(32)
            devices = self.devices()
            devices.append({"id": secrets.token_hex(4), "hash": _hash(token), "name": name[:60] or "Phone",
                            "created": iso(utcnow())})
            self.db.set_setting("devices", devices)
            self.new_pin()  # one-time PIN
            self.failures.clear()
            return token

    # ----- devices -----------------------------------------------------------
    def devices(self) -> list[dict]:
        return self.db.get_setting("devices", []) or []

    def is_paired(self, token: str | None) -> bool:
        if not token:
            return False
        h = _hash(token)
        return any(hmac.compare_digest(d["hash"], h) for d in self.devices())

    def remove(self, device_id: str) -> bool:
        devices = self.devices()
        kept = [d for d in devices if d["id"] != device_id]
        self.db.set_setting("devices", kept)
        return len(kept) != len(devices)


def device_name(user_agent: str) -> str:
    ua = user_agent or ""
    for key, label in (("iPhone", "iPhone"), ("iPad", "iPad"), ("Android", "Android phone"),
                       ("Windows", "Windows PC"), ("Macintosh", "Mac")):
        if key in ua:
            return label
    return "Phone"


def qr_svg(text: str) -> str:
    import qrcode
    import qrcode.image.svg

    img = qrcode.make(text, image_factory=qrcode.image.svg.SvgPathImage, border=2)
    return img.to_string(encoding="unicode")
