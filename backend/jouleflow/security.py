"""Authentication for the web app and encryption of stored secrets.

- One local account. It is created on first start with a one-time setup code that is
  only readable on the device itself (logs and `setup-code` in the data directory), so
  nobody else on the network can claim the installation first.
- Passwords are hashed with scrypt. Sessions are random tokens stored hashed in the
  database and sent as an HttpOnly, SameSite=Strict cookie.
- Failed logins are rate limited per client address.
- Third-party secrets (like a TP-Link password) are encrypted with a key kept in a
  separate file, so a copy of the database alone does not reveal them.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import os
import secrets
import stat
import time
from collections import defaultdict, deque
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken

from .storage import Storage

log = logging.getLogger(__name__)

SESSION_COOKIE = "jouleflow_session"
SESSION_DAYS = 30
MIN_PASSWORD_LENGTH = 10

# Allow a few mistakes, then slow down guessing a lot.
MAX_FAILURES = 5
FAILURE_WINDOW = 15 * 60
LOCKOUT = 5 * 60

SCHEMA = """
CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    created INTEGER NOT NULL,
    expires INTEGER NOT NULL
) WITHOUT ROWID;
"""


def restrict_permissions(path: Path, directory: bool = False) -> None:
    """Make a file or directory accessible to the owning user only."""
    try:
        path.chmod(0o700 if directory else 0o600)
    except OSError as exc:
        log.warning("Could not restrict permissions on %s: %s", path, exc)


def _hash_password(password: str, salt: bytes) -> str:
    digest = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1, dklen=32)
    return f"scrypt${salt.hex()}${digest.hex()}"


def _verify_password(password: str, stored: str) -> bool:
    try:
        _, salt_hex, _ = stored.split("$")
    except ValueError:
        return False
    return hmac.compare_digest(_hash_password(password, bytes.fromhex(salt_hex)), stored)


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class SecretBox:
    """Encrypts small secrets with a key stored next to (not inside) the database."""

    def __init__(self, key_path: Path) -> None:
        if not key_path.exists():
            key_path.parent.mkdir(parents=True, exist_ok=True)
            fd = os.open(key_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "wb") as f:
                f.write(Fernet.generate_key())
        restrict_permissions(key_path)
        self._fernet = Fernet(key_path.read_bytes().strip())

    def encrypt(self, value: str) -> str:
        return self._fernet.encrypt(value.encode()).decode() if value else ""

    def decrypt(self, value: str) -> str:
        if not value:
            return ""
        try:
            return self._fernet.decrypt(value.encode()).decode()
        except InvalidToken:
            log.error("Could not decrypt a stored secret; was the key file replaced?")
            return ""


class Auth:
    def __init__(self, storage: Storage, data_dir: Path) -> None:
        self.storage = storage
        self.data_dir = data_dir
        with storage._lock:  # noqa: SLF001 - one-off schema setup
            storage._db.executescript(SCHEMA)  # noqa: SLF001
        self._failures: dict[str, deque[float]] = defaultdict(deque)
        self._locked_until: dict[str, float] = {}
        self.setup_code: str | None = None
        if not self.has_account():
            self._create_setup_code()

    # ------------------------------------------------------------------ account

    def has_account(self) -> bool:
        return bool((self.storage.get_setting("account") or {}).get("password_hash"))

    def username(self) -> str | None:
        return (self.storage.get_setting("account") or {}).get("username")

    def _create_setup_code(self) -> None:
        self.setup_code = "-".join(secrets.token_hex(2).upper() for _ in range(3))
        path = self.data_dir / "setup-code"
        path.write_text(self.setup_code + "\n")
        restrict_permissions(path)
        log.warning(
            "No Jouleflow account yet. Open the web app and use setup code %s "
            "(also in %s) to create one.",
            self.setup_code,
            path,
        )

    def create_account(self, username: str, password: str, setup_code: str) -> None:
        if self.has_account() or self.setup_code is None:
            raise PermissionError("account_exists")
        if not hmac.compare_digest(setup_code.strip().upper(), self.setup_code):
            raise PermissionError("invalid_setup_code")
        self._set_password(username, password)
        self.setup_code = None
        (self.data_dir / "setup-code").unlink(missing_ok=True)

    def change_password(self, current: str, new: str) -> None:
        account = self.storage.get_setting("account") or {}
        if not _verify_password(current, account.get("password_hash", "")):
            raise PermissionError("invalid_credentials")
        self._set_password(account["username"], new)
        # Sign out everywhere else after a password change.
        with self.storage._lock:  # noqa: SLF001
            self.storage._db.execute("DELETE FROM sessions")  # noqa: SLF001

    def _set_password(self, username: str, password: str) -> None:
        username = username.strip()
        if not username:
            raise ValueError("username_required")
        if len(password) < MIN_PASSWORD_LENGTH:
            raise ValueError("password_too_short")
        self.storage.set_setting(
            "account",
            {"username": username, "password_hash": _hash_password(password, os.urandom(16))},
        )

    # ------------------------------------------------------------------ login & sessions

    def _is_locked(self, client: str, now: float) -> bool:
        return self._locked_until.get(client, 0) > now

    def login(self, username: str, password: str, client: str) -> str:
        now = time.time()
        if self._is_locked(client, now):
            raise PermissionError("too_many_attempts")
        account = self.storage.get_setting("account") or {}
        valid = hmac.compare_digest(username.strip(), account.get("username", "")) and (
            _verify_password(password, account.get("password_hash", ""))
        )
        if not valid:
            failures = self._failures[client]
            failures.append(now)
            while failures and now - failures[0] > FAILURE_WINDOW:
                failures.popleft()
            if len(failures) >= MAX_FAILURES:
                self._locked_until[client] = now + LOCKOUT
                failures.clear()
                log.warning("Too many failed logins from %s; locked for %ss", client, LOCKOUT)
            raise PermissionError("invalid_credentials")
        self._failures.pop(client, None)
        return self._create_session(account["username"])

    def _create_session(self, username: str) -> str:
        token = secrets.token_urlsafe(32)
        now = int(time.time())
        with self.storage._lock:  # noqa: SLF001
            db = self.storage._db  # noqa: SLF001
            db.execute("DELETE FROM sessions WHERE expires < ?", (now,))
            db.execute(
                "INSERT INTO sessions VALUES (?, ?, ?, ?)",
                (_token_hash(token), username, now, now + SESSION_DAYS * 86400),
            )
        return token

    def session_user(self, token: str | None) -> str | None:
        if not token:
            return None
        row = self.storage.query_one(
            "SELECT username, expires FROM sessions WHERE token_hash = ?", (_token_hash(token),)
        )
        if row is None or row["expires"] < time.time():
            return None
        return row["username"]

    def logout(self, token: str | None) -> None:
        if token:
            with self.storage._lock:  # noqa: SLF001
                self.storage._db.execute(  # noqa: SLF001
                    "DELETE FROM sessions WHERE token_hash = ?", (_token_hash(token),)
                )


def is_private(path: Path) -> bool:
    """True when neither group nor others have any access."""
    return not (path.stat().st_mode & (stat.S_IRWXG | stat.S_IRWXO))
