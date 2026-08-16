import os
from typing import Optional

from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from ..models import User


TOKEN_MAX_AGE = int(os.getenv("AUTH_TOKEN_MAX_AGE_SECONDS", "2592000"))


def _serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(
        os.getenv("SESSION_SECRET", "local-development-only"),
        salt="job-tracker-auth",
    )


def issue_token(user: User) -> str:
    return _serializer().dumps({"user_id": user.id, "google_subject": user.google_subject})


def read_token(token: str) -> Optional[int]:
    try:
        payload = _serializer().loads(token, max_age=TOKEN_MAX_AGE)
        return int(payload["user_id"])
    except (BadSignature, SignatureExpired, KeyError, TypeError, ValueError):
        return None
