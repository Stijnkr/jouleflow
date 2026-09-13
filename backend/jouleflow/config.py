from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration, read from environment variables prefixed with JOULEFLOW_."""

    model_config = SettingsConfigDict(env_prefix="JOULEFLOW_", env_file=".env", extra="ignore")

    # Where the SQLite database lives.
    data_dir: Path = Path("./data")

    # Local timezone, used for day/week/month/year boundaries.
    timezone: str = "Europe/Amsterdam"

    # Initial P1 reader address (ESPHome/SlimmeLezer). Only used until the meter is
    # configured in the web app, which stores its settings in the database.
    p1_url: str | None = None

    # HTTP server.
    host: str = "0.0.0.0"
    port: int = 8080

    # Serve the web app over HTTPS with a local certificate authority. When enabled,
    # `port` only redirects to `https_port`.
    https: bool = False
    https_port: int = 8443

    # Built frontend to serve. Leave empty to serve the API only.
    frontend_dir: Path | None = Path(__file__).resolve().parents[2] / "frontend" / "dist"

    # Retention. Hourly and daily rollups are kept forever.
    raw_retention_days: int = 7
    minute_retention_days: int = 730

    # Seconds between batched writes of raw samples (limits SD card wear).
    flush_interval: float = 10.0

    @property
    def tls_dir(self) -> Path:
        return self.data_dir / "tls"

    @property
    def db_path(self) -> Path:
        return self.data_dir / "jouleflow.db"


settings = Settings()
