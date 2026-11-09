"""HTTPS for phone access on home Wi-Fi.

Phones only allow the microphone, notifications and "install as app" on secure (HTTPS) pages.
So start-phone.cmd serves Aide to the phone over HTTPS with a certificate made on this computer:

- A small "home CA" is created once. It is limited (X.509 name constraints) to private network
  addresses (10.x, 172.16-31.x, 192.168.x) and to no real domain names, so even if its key
  leaked it couldn't vouch for a real website. Install it on your phone once to remove the
  "connection not private" warning.
- The server certificate (for this computer's Wi-Fi address) is renewed automatically when the
  address changes or the certificate gets close to expiring.

Everything lives in aide-backend/certs/ (git-ignored). Delete that folder to start over.
"""
from __future__ import annotations

import ipaddress
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID

CERT_DIR = Path(os.environ.get("AIDE_CERT_DIR", Path(__file__).resolve().parent.parent / "certs"))
PRIVATE_NETS = [ipaddress.ip_network(n) for n in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16")]
NO_DOMAINS = "aide.invalid"  # the only DNS name the CA may sign (it can never resolve)
SERVER_CN = "Aide on home Wi-Fi"


def _paths(d: Path) -> dict[str, Path]:
    return {"ca_key": d / "ca.key", "ca_crt": d / "ca.crt", "key": d / "server.key", "crt": d / "server.crt"}


def private_ips(ips: list[str]) -> list[str]:
    out = []
    for ip in ips:
        try:
            a = ipaddress.ip_address(ip)
        except ValueError:
            continue
        if a.version == 4 and any(a in n for n in PRIVATE_NETS):
            out.append(ip)
    return sorted(set(out))


def _write_key(path: Path, key) -> None:
    path.write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                       serialization.NoEncryption()))
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass


def _load_ca(p: dict[str, Path]):
    if p["ca_key"].exists() and p["ca_crt"].exists():
        key = serialization.load_pem_private_key(p["ca_key"].read_bytes(), password=None)
        crt = x509.load_pem_x509_certificate(p["ca_crt"].read_bytes())
        if crt.not_valid_after_utc > datetime.now(timezone.utc) + timedelta(days=30):
            return key, crt
    now = datetime.now(timezone.utc)
    key = ec.generate_private_key(ec.SECP256R1())
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Aide home CA (home Wi-Fi only)"),
                      x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Aide on this computer")])
    crt = (x509.CertificateBuilder()
           .subject_name(name).issuer_name(name).public_key(key.public_key())
           .serial_number(x509.random_serial_number())
           .not_valid_before(now - timedelta(minutes=5)).not_valid_after(now + timedelta(days=3650))
           .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
           .add_extension(x509.KeyUsage(digital_signature=False, content_commitment=False, key_encipherment=False,
                                        data_encipherment=False, key_agreement=False, key_cert_sign=True,
                                        crl_sign=True, encipher_only=False, decipher_only=False), critical=True)
           .add_extension(x509.NameConstraints(
               permitted_subtrees=[x509.IPAddress(n) for n in PRIVATE_NETS] + [x509.DNSName(NO_DOMAINS)],
               excluded_subtrees=None), critical=True)
           .add_extension(x509.SubjectKeyIdentifier.from_public_key(key.public_key()), critical=False)
           .sign(key, hashes.SHA256()))
    _write_key(p["ca_key"], key)
    p["ca_crt"].write_bytes(crt.public_bytes(serialization.Encoding.PEM))
    for k in ("key", "crt"):  # an old server certificate was signed by the old CA
        p[k].unlink(missing_ok=True)
    return key, crt


def _server_ok(p: dict[str, Path], ips: list[str], ca_crt) -> bool:
    if not (p["key"].exists() and p["crt"].exists()):
        return False
    crt = x509.load_pem_x509_certificate(p["crt"].read_bytes())
    if (crt.issuer != ca_crt.subject or crt.not_valid_after_utc < datetime.now(timezone.utc) + timedelta(days=30)
            or crt.subject.get_attributes_for_oid(NameOID.COMMON_NAME)[0].value != SERVER_CN):
        return False
    have = {str(a) for a in crt.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
            .get_values_for_type(x509.IPAddress)}
    return set(ips) <= have


def ensure(ips: list[str], cert_dir: Path | None = None) -> dict[str, Path]:
    """Make sure there's a CA and a server certificate covering `ips` (private ones only).
    Returns the file paths: ca_crt, crt, key (plus ca_key)."""
    d = Path(cert_dir or CERT_DIR)
    d.mkdir(parents=True, exist_ok=True)
    p = _paths(d)
    ca_key, ca_crt = _load_ca(p)
    ips = private_ips(ips)
    if _server_ok(p, ips, ca_crt):
        return p
    now = datetime.now(timezone.utc)
    key = ec.generate_private_key(ec.SECP256R1())
    sans = [x509.IPAddress(ipaddress.ip_address(ip)) for ip in ips] or [x509.DNSName(NO_DOMAINS)]
    crt = (x509.CertificateBuilder()
           # Not the IP: a CN that looks like a host name is checked against the CA's domain limits and fails.
           .subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, SERVER_CN)]))
           .issuer_name(ca_crt.subject).public_key(key.public_key())
           .serial_number(x509.random_serial_number())
           .not_valid_before(now - timedelta(minutes=5)).not_valid_after(now + timedelta(days=365))
           .add_extension(x509.SubjectAlternativeName(sans), critical=False)
           .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
           .add_extension(x509.KeyUsage(digital_signature=True, content_commitment=False, key_encipherment=False,
                                        data_encipherment=False, key_agreement=False, key_cert_sign=False,
                                        crl_sign=False, encipher_only=False, decipher_only=False), critical=True)
           .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=False)
           .add_extension(x509.SubjectKeyIdentifier.from_public_key(key.public_key()), critical=False)
           .add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(ca_key.public_key()), critical=False)
           .sign(ca_key, hashes.SHA256()))
    _write_key(p["key"], key)
    # Send the CA along with the server certificate, so phones can build the chain.
    p["crt"].write_bytes(crt.public_bytes(serialization.Encoding.PEM) + ca_crt.public_bytes(serialization.Encoding.PEM))
    return p


def ca_der(cert_dir: Path | None = None) -> bytes | None:
    """The home CA certificate (public, safe to share) in the format phones install most easily."""
    path = _paths(Path(cert_dir or CERT_DIR))["ca_crt"]
    if not path.exists():
        return None
    return x509.load_pem_x509_certificate(path.read_bytes()).public_bytes(serialization.Encoding.DER)


def ca_fingerprint(cert_dir: Path | None = None) -> str | None:
    """Short SHA-256 fingerprint, so you can check the phone installed the right certificate."""
    der = ca_der(cert_dir)
    if not der:
        return None
    import hashlib
    h = hashlib.sha256(der).hexdigest().upper()
    return ":".join(h[i:i + 2] for i in range(0, 16, 2))
