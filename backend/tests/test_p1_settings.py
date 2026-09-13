import pytest
from fastapi.testclient import TestClient

from jouleflow.config import Settings
from jouleflow.drivers.esphome_p1 import normalize_url
from jouleflow.main import create_app
from jouleflow.storage import Storage


@pytest.fixture
def client(tmp_path):
    app = create_app(Settings(data_dir=tmp_path, frontend_dir=None, p1_url=None))
    with TestClient(app) as c:
        code = (tmp_path / "setup-code").read_text().strip()
        response = c.post(
            "/api/auth/setup",
            json={"username": "owner", "password": "long enough password", "setup_code": code},
        )
        assert response.status_code == 200
        yield c


def test_normalize_url():
    assert normalize_url("192.168.1.5") == "http://192.168.1.5"
    assert normalize_url(" http://slimmelezer.local/ ") == "http://slimmelezer.local"
    with pytest.raises(ValueError):
        normalize_url("")
    with pytest.raises(ValueError):
        normalize_url("ftp://meter")


def test_settings_roundtrip(tmp_path):
    storage = Storage(tmp_path / "s.db")
    assert storage.get_setting("p1") is None
    storage.set_setting("p1", {"driver": "esphome", "options": {"host": "10.0.0.2"}})
    assert storage.get_setting("p1") == {"driver": "esphome", "options": {"host": "10.0.0.2"}}
    storage.close()


def test_unconfigured_then_save_config(client, tmp_path):
    assert client.get("/api/p1/config").json()["configured"] is False
    drivers = client.get("/api/p1/drivers").json()
    assert {d["id"] for d in drivers} >= {"esphome", "homewizard", "serial"}
    assert next(d for d in drivers if d["id"] == "esphome")["available"] is True

    assert (
        client.put("/api/p1/config", json={"driver": "esphome", "options": {}}).status_code == 400
    )
    assert client.put("/api/p1/config", json={"driver": "nope", "options": {}}).status_code == 400

    saved = client.put(
        "/api/p1/config", json={"driver": "esphome", "options": {"host": "127.0.0.1:9"}}
    )
    assert saved.status_code == 200
    assert saved.json()["connection"].endswith("127.0.0.1:9")
    assert client.get("/api/p1/config").json() == {
        "configured": True,
        "driver": "esphome",
        "options": {"host": "127.0.0.1:9"},
    }


def test_probe_reports_unreachable_reader(client):
    result = client.post(
        "/api/p1/test", json={"driver": "esphome", "options": {"host": "127.0.0.1:9"}}
    ).json()
    assert result["ok"] is False
    assert "127.0.0.1:9" in result["error"]
    assert result["code"] in {"connect_failed", "no_response"}
