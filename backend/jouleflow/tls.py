"""HTTPS for the local network.

Public certificate authorities can't issue certificates for names like `jouleflow.local`,
so Jouleflow runs its own small certificate authority:

- The CA is created once. It is limited with X.509 name constraints to `.local` names,
  `localhost` and private IP ranges, so even a leaked CA key can't be used to impersonate
  public websites. Users install `ca.crt` on their devices to trust Jouleflow.
- The server certificate covers the device's hostname and IP addresses. It is renewed
  automatically when it nears expiry or when the addresses change.

Private keys are written with owner-only permissions.
"""

from __future__ import annotations

import datetime as dt
import ipaddress
import logging
import os
import socket
from dataclasses import dataclass
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID

log = logging.getLogger(__name__)

CA_DAYS = 10 * 365
# Browsers reject server certificates valid for longer than 398 days.
SERVER_DAYS = 397
RENEW_BEFORE_DAYS = 30

PRIVATE_NETWORKS = [
    ipaddress.ip_network(n)
    for n in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "127.0.0.0/8", "169.254.0.0/16")
]


@dataclass(frozen=True)
class TlsPaths:
    ca_cert: Path
    ca_key: Path
    cert: Path
    key: Path


def paths(directory: Path) -> TlsPaths:
    return TlsPaths(
        ca_cert=directory / "ca.crt",
        ca_key=directory / "ca.key",
        cert=directory / "server.crt",
        key=directory / "server.key",
    )


def local_names() -> tuple[list[str], list[ipaddress.IPv4Address]]:
    """Hostnames and private IPv4 addresses this device is reachable on."""
    hostname = socket.gethostname().split(".")[0].lower()
    names = [f"{hostname}.local", "localhost"]
    addresses = {ipaddress.ip_address("127.0.0.1")}
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            addresses.add(ipaddress.ip_address(info[4][0]))
    except OSError:
        pass
    try:
        # The address used for outgoing traffic; no packets are actually sent.
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("192.0.2.1", 9))
            addresses.add(ipaddress.ip_address(s.getsockname()[0]))
    except OSError:
        pass
    private = sorted(
        (a for a in addresses if any(a in n for n in PRIVATE_NETWORKS)), key=lambda a: int(a)
    )
    return names, private


def _write_private(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    tmp = path.with_suffix(path.suffix + ".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "wb") as f:
        f.write(data)
    tmp.replace(path)


def _key_pem(key: ec.EllipticCurvePrivateKey) -> bytes:
    return key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                             serialization.NoEncryption())  # fmt: skip


def _now() -> dt.datetime:
    return dt.datetime.now(dt.UTC)


def _create_ca(p: TlsPaths, hostname: str) -> tuple[x509.Certificate, ec.EllipticCurvePrivateKey]:
    key = ec.generate_private_key(ec.SECP256R1())
    name = x509.Name([
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Jouleflow"),
        x509.NameAttribute(NameOID.COMMON_NAME, f"Jouleflow local CA ({hostname})"),
    ])  # fmt: skip
    now = _now()
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - dt.timedelta(minutes=5))
        .not_valid_after(now + dt.timedelta(days=CA_DAYS))
        .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
        .add_extension(
            x509.KeyUsage(
                digital_signature=False,
                content_commitment=False,
                key_encipherment=False,
                data_encipherment=False,
                key_agreement=False,
                key_cert_sign=True,
                crl_sign=True,
                encipher_only=False,
                decipher_only=False,
            ),
            critical=True,
        )  # fmt: skip
        .add_extension(
            x509.NameConstraints(
                permitted_subtrees=[
                    x509.DNSName("local"),
                    x509.DNSName("localhost"),
                    *(x509.IPAddress(n) for n in PRIVATE_NETWORKS),
                ],
                excluded_subtrees=None,
            ),
            critical=True,
        )
        .add_extension(x509.SubjectKeyIdentifier.from_public_key(key.public_key()), critical=False)
        .sign(key, hashes.SHA256())
    )
    _write_private(p.ca_key, _key_pem(key))
    p.ca_cert.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    log.info("Created local certificate authority %s", fingerprint(cert))
    return cert, key


def _create_server_cert(
    p: TlsPaths,
    ca_cert: x509.Certificate,
    ca_key: ec.EllipticCurvePrivateKey,
    names: list[str],
    addresses: list[ipaddress.IPv4Address],
) -> None:
    key = ec.generate_private_key(ec.SECP256R1())
    now = _now()
    cert = (
        x509.CertificateBuilder()
        .subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, names[0])]))
        .issuer_name(ca_cert.subject)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - dt.timedelta(minutes=5))
        .not_valid_after(now + dt.timedelta(days=SERVER_DAYS))
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .add_extension(
            x509.SubjectAlternativeName(
                [*(x509.DNSName(n) for n in names), *(x509.IPAddress(a) for a in addresses)]
            ),
            critical=False,
        )
        .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=False)
        .add_extension(
            x509.KeyUsage(
                digital_signature=True,
                content_commitment=False,
                key_encipherment=False,
                data_encipherment=False,
                key_agreement=False,
                key_cert_sign=False,
                crl_sign=False,
                encipher_only=False,
                decipher_only=False,
            ),
            critical=True,
        )  # fmt: skip
        .add_extension(
            x509.AuthorityKeyIdentifier.from_issuer_public_key(ca_key.public_key()),
            critical=False,
        )
        .sign(ca_key, hashes.SHA256())
    )
    _write_private(p.key, _key_pem(key))
    # Serve the chain so clients that trust the CA can verify it.
    p.cert.write_bytes(
        cert.public_bytes(serialization.Encoding.PEM)
        + ca_cert.public_bytes(serialization.Encoding.PEM)
    )
    log.info("Issued HTTPS certificate for %s", ", ".join([*names, *map(str, addresses)]))


def _needs_new_server_cert(p: TlsPaths, names: list[str], addresses: list) -> bool:
    if not (p.cert.exists() and p.key.exists()):
        return True
    cert = x509.load_pem_x509_certificate(p.cert.read_bytes())
    if cert.not_valid_after_utc - _now() < dt.timedelta(days=RENEW_BEFORE_DAYS):
        return True
    san = cert.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
    current = set(san.get_values_for_type(x509.DNSName)) | {
        str(a) for a in san.get_values_for_type(x509.IPAddress)
    }
    return current != set(names) | {str(a) for a in addresses}


def ensure_certificates(
    directory: Path,
    names: list[str] | None = None,
    addresses: list[ipaddress.IPv4Address] | None = None,
) -> TlsPaths:
    """Create or renew the CA and server certificate as needed."""
    if names is None or addresses is None:
        detected_names, detected_addresses = local_names()
        names = names or detected_names
        addresses = addresses if addresses is not None else detected_addresses
    p = paths(directory)
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    if p.ca_cert.exists() and p.ca_key.exists():
        ca_cert = x509.load_pem_x509_certificate(p.ca_cert.read_bytes())
        ca_key = serialization.load_pem_private_key(p.ca_key.read_bytes(), password=None)
        assert isinstance(ca_key, ec.EllipticCurvePrivateKey)
    else:
        ca_cert, ca_key = _create_ca(p, names[0].removesuffix(".local"))
    if _needs_new_server_cert(p, names, addresses):
        _create_server_cert(p, ca_cert, ca_key, names, addresses)
    return p


def fingerprint(cert: x509.Certificate) -> str:
    digest = cert.fingerprint(hashes.SHA256()).hex().upper()
    return ":".join(digest[i : i + 2] for i in range(0, len(digest), 2))


def describe(directory: Path) -> dict | None:
    p = paths(directory)
    if not (p.ca_cert.exists() and p.cert.exists()):
        return None
    ca = x509.load_pem_x509_certificate(p.ca_cert.read_bytes())
    server = x509.load_pem_x509_certificate(p.cert.read_bytes())
    san = server.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
    return {
        "ca_fingerprint": fingerprint(ca),
        "ca_expires": ca.not_valid_after_utc.date().isoformat(),
        "server_expires": server.not_valid_after_utc.date().isoformat(),
        "names": [
            *san.get_values_for_type(x509.DNSName),
            *(str(a) for a in san.get_values_for_type(x509.IPAddress)),
        ],
    }
