import os
from typing import Optional

from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from ..models import User


TOKEN_MAX_AGE = int(os.getenv("AUTH_TOKEN_MAX_AGE_SECONDS", "1800"))


def _serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(
        os.getenv("SESSION_SECRET", "local-development-only"),
        salt="job-tracker-auth",
    )


def issue_token(user: User) -> str:
    # Signed tokens are integrity-protected but not encrypted. Only include the
    # minimum identifier needed to resolve the authenticated user.
    return _serializer().dumps({"user_id": user.id})


def read_token(token: str) -> Optional[int]:
    try:
        payload = _serializer().loads(token, max_age=TOKEN_MAX_AGE)
        return int(payload["user_id"])
    except (BadSignature, SignatureExpired, KeyError, TypeError, ValueError):
        return None
