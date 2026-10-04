from decimal import Decimal
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_ROOT = Path(__file__).resolve().parents[2]
DEV_SECRET = "dev-insecure-secret-change-me"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="OPTIFRAME_", env_file=".env", extra="ignore")

    env: Literal["dev", "prod"] = "dev"
    # Bind address for `uv run optiframe`. Localhost by default: in dev the frontend reaches the API through
    # the Vite proxy (/api → http://127.0.0.1:8000). Use 0.0.0.0 only to expose it on the network (Docker does).
    host: str = "127.0.0.1"
    port: int = 8000
    secret_key: str = DEV_SECRET
    admin_api_key: str = ""  # empty = admin routes disabled
    cors_origins: list[str] = ["http://localhost:5173", "https://localhost:5173"]
    frontend_url: str = "http://localhost:5173"

    database_url: str = f"sqlite:///{BACKEND_ROOT / 'optiframe.db'}"
    storage_dir: Path = BACKEND_ROOT / "storage"
    model_path: Path = BACKEND_ROOT / "models" / "efficientsam_ti.onnx"

    # Dev only: save lens photos that fail measurement here (with the error code in the filename) to debug them.
    debug_dump_dir: Path | None = None

    # Compute limits
    max_image_bytes: int = 15 * 1024 * 1024
    max_image_pixels: int = 40_000_000
    max_stl_bytes: int = 60 * 1024 * 1024
    measure_timeout_s: float = 15.0
    generate_timeout_s: float = 20.0
    max_concurrent_jobs: int = 2
    segmentation_runs: int = Field(default=2, ge=1, le=4)
    rate_limit_per_minute: int = 20  # per IP, compute routes only; 0 disables
    generate_cache_size: int = 32

    # Auth
    jwt_ttl_hours: int = 24

    # Commerce
    currency: str = "EUR"
    shipping_flat: Decimal = Decimal("6.90")
    production_days: int = 3
    shipping_days_min: int = 5
    shipping_days_max: int = 10
    sponsorship_enabled: bool = False

    # Mail: "console" logs emails; "smtp" sends them
    mailer: Literal["console", "smtp"] = "console"
    mail_from: str = "OptiFrame <orders@optiframe.local>"
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_starttls: bool = True

    @model_validator(mode="after")
    def _check_prod(self) -> "Settings":
        if self.env == "prod" and (self.secret_key == DEV_SECRET or len(self.secret_key) < 32):
            raise ValueError("OPTIFRAME_SECRET_KEY must be set to a random value of 32+ chars in prod")
        if self.env == "prod" and self.debug_dump_dir is not None:
            raise ValueError("OPTIFRAME_DEBUG_DUMP_DIR must not be set in prod (it stores user photos)")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
