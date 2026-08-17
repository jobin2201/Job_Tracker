from dataclasses import dataclass
from pathlib import Path
import os

from dotenv import load_dotenv


ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")


@dataclass(frozen=True)
class Settings:
    postgres_host: str = os.getenv("POSTGRES_HOST", "localhost")
    postgres_port: int = int(os.getenv("POSTGRES_PORT", "5432"))
    postgres_db: str = os.getenv("POSTGRES_DB", "job_tracker")
    postgres_user: str = os.getenv("POSTGRES_USER", "postgres")
    postgres_password: str = os.getenv("POSTGRES_PASSWORD", "")
    user_email: str = os.getenv("MIRROR_USER_EMAIL", "").strip().lower()
    client_secrets_file: Path = ROOT / os.getenv("GOOGLE_CLIENT_SECRETS_FILE", "credentials/client_secret.json")
    token_file: Path = ROOT / os.getenv("GOOGLE_TOKEN_FILE", "credentials/token.json")
    spreadsheet_id: str = os.getenv("GOOGLE_SPREADSHEET_ID", "").strip()
    state_file: Path = ROOT / "state" / "spreadsheet.json"
    application_numbers_file: Path = ROOT / "state" / "application_numbers.json"
    groq_cache_file: Path = ROOT / "state" / "groq_enrichment.json"
    groq_api_key: str = os.getenv("GROQ_API_KEY", "").strip()
    groq_model: str = os.getenv("GROQ_MODEL", "").strip()
    sync_interval_seconds: int = max(30, int(os.getenv("SYNC_INTERVAL_SECONDS", "300")))

    def validate_database(self) -> None:
        if not self.user_email:
            raise ValueError("MIRROR_USER_EMAIL is required")
        if not self.postgres_password:
            raise ValueError("POSTGRES_PASSWORD is required")
