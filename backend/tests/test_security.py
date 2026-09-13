import stat

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from jouleflow.config import Settings
from jouleflow.main import create_app
from jouleflow.security import LOCKOUT, MAX_FAILURES, SESSION_COOKIE

PASSWORD = "correct horse battery"


@pytest.fixture
def app_and_dir(tmp_path):
    return create_app(Settings(data_dir=tmp_path, frontend_dir=None, p1_url=None)), tmp_path


def setup_account(client, tmp_path):
    code = (tmp_path / "setup-code").read_text().strip()
    return client.post(
        "/api/auth/setup", json={"username": "owner", "password": PASSWORD, "setup_code": code}
    )


def test_api_requires_login_and_setup_needs_the_local_code(app_and_dir):
    app, tmp_path = app_and_dir
    with TestClient(app) as client:
        assert client.get("/api/auth/status").json() == {
            "setup_required": True,
            "authenticated": False,
            "username": None,
        }
        assert client.get("/api/live").status_code == 401
        assert client.put("/api/tariffs", json={"contracts": []}).status_code == 401

        wrong = client.post(
            "/api/auth/setup",
            json={"username": "intruder", "password": PASSWORD, "setup_code": "0000-0000-0000"},
        )
        assert wrong.status_code == 401

        assert setup_account(client, tmp_path).status_code == 200
        assert not (tmp_path / "setup-code").exists()
        assert client.get("/api/live").status_code == 200

        # A second setup is impossible once an account exists.
        assert setup_account.__name__  # keep linters quiet
        again = client.post(
            "/api/auth/setup",
            json={"username": "intruder", "password": PASSWORD, "setup_code": "anything"},
        )
        assert again.status_code == 401


def test_session_cookie_is_http_only_and_strict(app_and_dir):
    app, tmp_path = app_and_dir
    with TestClient(app) as client:
        cookie = setup_account(client, tmp_path).headers["set-cookie"].lower()
        assert SESSION_COOKIE in cookie and "httponly" in cookie and "samesite=strict" in cookie


def test_logout_and_password_change_end_sessions(app_and_dir):
    app, tmp_path = app_and_dir
    with TestClient(app) as client, TestClient(app) as other:
        setup_account(client, tmp_path)
        assert (
            other.post(
                "/api/auth/login", json={"username": "owner", "password": PASSWORD}
            ).status_code
            == 200
        )
        assert other.get("/api/live").status_code == 200

        short = client.post("/api/auth/password", json={"current": PASSWORD, "new": "short"})
        assert short.status_code == 400
        changed = client.post(
            "/api/auth/password", json={"current": PASSWORD, "new": "a brand new password"}
        )
        assert changed.status_code == 200
        assert client.get("/api/live").status_code == 200
        assert other.get("/api/live").status_code == 401

        client.post("/api/auth/logout")
        assert client.get("/api/live").status_code == 401


def test_failed_logins_are_rate_limited(app_and_dir):
    app, tmp_path = app_and_dir
    with TestClient(app) as client:
        setup_account(client, tmp_path)
        client.post("/api/auth/logout")
        for _ in range(MAX_FAILURES):
            bad = client.post("/api/auth/login", json={"username": "owner", "password": "nope"})
            assert bad.status_code == 401
        locked = client.post("/api/auth/login", json={"username": "owner", "password": PASSWORD})
        assert locked.status_code == 429
        assert LOCKOUT >= 60


def test_cross_origin_changes_are_rejected(app_and_dir):
    app, tmp_path = app_and_dir
    with TestClient(app) as client:
        setup_account(client, tmp_path)
        response = client.put(
            "/api/tariffs", json={"contracts": []}, headers={"origin": "http://evil.example"}
        )
        assert response.status_code == 403


def test_websocket_requires_a_session(app_and_dir):
    app, tmp_path = app_and_dir
    with TestClient(app) as client:
        with pytest.raises(WebSocketDisconnect), client.websocket_connect("/api/ws") as ws:
            ws.receive_json()


def test_stored_plug_password_is_not_sent_to_new_addresses(app_and_dir):
    app, tmp_path = app_and_dir
    with TestClient(app) as client:
        setup_account(client, tmp_path)
        saved = client.put(
            "/api/plugs/settings",
            json={
                "username": "me@example.com",
                "password": "tapo secret",
                "plugs": [{"host": "127.0.0.1:9", "name": "Boiler"}],
            },
        )
        assert saved.status_code == 200 and saved.json()["has_password"] is True
        assert "tapo secret" not in saved.text

        refused = client.post("/api/plugs/test", json={"host": "192.0.2.10"}).json()
        assert refused["code"] == "password_required"

        moved = client.put(
            "/api/plugs/settings",
            json={
                "username": "me@example.com",
                "plugs": [{"host": "192.0.2.10", "name": "Boiler"}],
            },
        )
        assert moved.status_code == 400 and moved.json()["detail"] == "password_required"


def test_data_files_are_private(app_and_dir):
    app, tmp_path = app_and_dir
    with TestClient(app) as client:
        setup_account(client, tmp_path)
        for path in (tmp_path / "jouleflow.db", tmp_path / "secret.key"):
            mode = path.stat().st_mode
            assert not mode & (stat.S_IRWXG | stat.S_IRWXO), path
