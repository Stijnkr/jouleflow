import asyncio

import pytest

from jouleflow.plugs import CredentialsRequired, PlugConfig, PlugManager, PlugSettingsUpdate
from jouleflow.security import SecretBox
from jouleflow.storage import Storage


@pytest.fixture
def manager(tmp_path):
    storage = Storage(tmp_path / "plugs.db")
    manager = PlugManager(storage, raw_retention_days=7, secrets=SecretBox(tmp_path / "secret.key"))
    yield manager
    storage.close()


def insert(manager, plug_id, start, seconds, power, step=10):
    with manager.storage._lock:
        manager.storage._db.executemany(
            "INSERT OR REPLACE INTO plug_samples VALUES (?, ?, ?, 230, ?, 1)",
            [(plug_id, start + i, power, power / 230) for i in range(0, seconds + 1, step)],
        )


def test_password_is_kept_but_never_exposed(manager):
    plug = PlugConfig(host="192.168.3.15", name="Boiler")
    asyncio.run(
        manager.update_settings(
            PlugSettingsUpdate(username="me@example.com", password="secret", plugs=[plug])
        )
    )
    public = manager.public_settings()
    assert public == {
        "username": "me@example.com",
        "has_password": True,
        "plugs": [plug.model_dump()],
    }
    # Saving without a password keeps the stored one.
    asyncio.run(
        manager.update_settings(PlugSettingsUpdate(username="me@example.com", plugs=[plug]))
    )
    assert manager.settings.password == "secret"
    assert manager.states[plug.id].display_name == "Boiler"


def test_energy_is_integrated_from_power_and_rolled_up_hourly(manager):
    hour = 1_789_300_800  # a whole hour
    manager.settings.plugs = [PlugConfig(id="boiler", host="x")]
    manager._sync_states()
    insert(manager, "boiler", hour, 3600, power=2000)  # 2 kW for an hour
    insert(manager, "boiler", hour + 3600, 1800, power=1000)  # then 1 kW for half an hour

    manager.rollup(hour + 3600 + 1800)
    row = manager.storage.query_one("SELECT * FROM plug_agg_1h WHERE plug_id = 'boiler'")
    assert row["energy"] == pytest.approx(2.0, abs=0.02)
    assert row["power_max"] == 2000

    total = manager.energy_between(hour, hour + 3600 + 1800)
    assert total["boiler"] == pytest.approx(2.5, abs=0.05)


def test_gaps_are_not_counted_as_energy(manager):
    hour = 1_789_300_800
    manager.settings.plugs = [PlugConfig(id="p", host="x")]
    manager._sync_states()
    insert(manager, "p", hour, 60, power=1000)
    insert(manager, "p", hour + 1800, 60, power=1000)  # offline for ~30 minutes in between
    manager.rollup(hour + 3600)
    energy = manager.storage.query_one("SELECT energy FROM plug_agg_1h")["energy"]
    assert energy == pytest.approx(1000 * 120 / 3_600_000, abs=1e-4)


def test_password_is_encrypted_and_only_reused_for_saved_addresses(manager):
    boiler = PlugConfig(host="192.168.3.15", name="Boiler")
    asyncio.run(
        manager.update_settings(
            PlugSettingsUpdate(username="me@example.com", password="secret", plugs=[boiler])
        )
    )
    raw = manager.storage.query_one("SELECT value FROM meta WHERE key = 'setting:plugs'")["value"]
    assert "secret" not in raw and "password_enc" in raw

    # A new address without re-entering the password is refused.
    other = PlugConfig(host="192.168.3.99", name="Evil")
    with pytest.raises(CredentialsRequired):
        asyncio.run(
            manager.update_settings(
                PlugSettingsUpdate(username="me@example.com", plugs=[boiler, other])
            )
        )
    # So is changing the account name.
    with pytest.raises(CredentialsRequired):
        asyncio.run(
            manager.update_settings(PlugSettingsUpdate(username="x@example.com", plugs=[boiler]))
        )
    # Re-entering the password allows it.
    asyncio.run(
        manager.update_settings(
            PlugSettingsUpdate(username="me@example.com", password="secret", plugs=[boiler, other])
        )
    )
    assert manager.saved_hosts() == {"192.168.3.15", "192.168.3.99"}


def test_plain_text_password_from_older_versions_is_encrypted_on_load(tmp_path):
    storage = Storage(tmp_path / "old.db")
    storage.set_setting("plugs", {"username": "me@example.com", "password": "secret", "plugs": []})
    manager = PlugManager(storage, 7, SecretBox(tmp_path / "secret.key"))
    assert manager.settings.password == "secret"
    raw = storage.query_one("SELECT value FROM meta WHERE key = 'setting:plugs'")["value"]
    assert "secret" not in raw
    storage.close()
