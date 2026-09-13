import ipaddress
import ssl
import stat

import pytest
from cryptography import x509
from fastapi.testclient import TestClient

from jouleflow.main import https_redirect_app
from jouleflow.tls import describe, ensure_certificates, paths

NAMES = ["jouleflow.local", "localhost"]
ADDRESSES = [ipaddress.ip_address("127.0.0.1"), ipaddress.ip_address("192.168.3.151")]


def test_certificates_are_created_constrained_and_private(tmp_path):
    p = ensure_certificates(tmp_path, NAMES, ADDRESSES)
    ca = x509.load_pem_x509_certificate(p.ca_cert.read_bytes())
    server = x509.load_pem_x509_certificate(p.cert.read_bytes())

    constraints = ca.extensions.get_extension_for_class(x509.NameConstraints).value
    assert x509.DNSName("local") in constraints.permitted_subtrees
    assert ca.extensions.get_extension_for_class(x509.BasicConstraints).value.ca

    san = server.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
    assert set(san.get_values_for_type(x509.DNSName)) == set(NAMES)
    assert ipaddress.ip_address("192.168.3.151") in san.get_values_for_type(x509.IPAddress)
    assert (server.not_valid_after_utc - server.not_valid_before_utc).days <= 398

    for key in (p.ca_key, p.key):
        assert not key.stat().st_mode & (stat.S_IRWXG | stat.S_IRWXO)

    # A client that trusts the CA accepts the server certificate for the device name.
    context = ssl.create_default_context(cafile=str(p.ca_cert))
    context.load_cert_chain(p.cert, p.key)  # the pair matches
    assert describe(tmp_path)["ca_fingerprint"].count(":") == 31


def test_server_certificate_is_reissued_when_the_address_changes(tmp_path):
    ensure_certificates(tmp_path, NAMES, ADDRESSES)
    ca_before = paths(tmp_path).ca_cert.read_bytes()
    cert_before = paths(tmp_path).cert.read_bytes()

    ensure_certificates(tmp_path, NAMES, ADDRESSES)
    assert paths(tmp_path).cert.read_bytes() == cert_before

    ensure_certificates(tmp_path, NAMES, [ipaddress.ip_address("192.168.3.200")])
    assert paths(tmp_path).cert.read_bytes() != cert_before
    assert paths(tmp_path).ca_cert.read_bytes() == ca_before


@pytest.mark.parametrize(
    ("https_port", "url", "expected"),
    [
        (
            443,
            "http://jouleflow.local/history?period=day",
            "https://jouleflow.local/history?period=day",
        ),
        (8443, "http://192.168.3.151:8080/", "https://192.168.3.151:8443/"),
    ],
)
def test_http_redirects_to_https(https_port, url, expected):
    client = TestClient(https_redirect_app(https_port), base_url=url.rsplit("/", 1)[0])
    response = client.get(url, follow_redirects=False)
    assert response.status_code == 308
    assert response.headers["location"] == expected
