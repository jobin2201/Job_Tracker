import json
import os

from cryptography.fernet import Fernet, InvalidToken


def _cipher() -> Fernet:
    key = os.getenv("GOOGLE_TOKEN_ENCRYPTION_KEY", "").strip()
    if not key:
        raise RuntimeError("GOOGLE_TOKEN_ENCRYPTION_KEY is not configured")
    return Fernet(key.encode("ascii"))


def encrypt_token(token: dict) -> str:
    return _cipher().encrypt(json.dumps(token).encode("utf-8")).decode("ascii")


def decrypt_token(value: str) -> dict:
    try:
        return json.loads(_cipher().decrypt(value.encode("ascii")).decode("utf-8"))
    except (InvalidToken, ValueError, TypeError, json.JSONDecodeError) as exc:
        raise RuntimeError("Stored Google Sheets authorization could not be decrypted") from exc
