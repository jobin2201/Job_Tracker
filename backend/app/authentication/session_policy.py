import os
import time
from dataclasses import dataclass

from fastapi import Request


IDLE_TIMEOUT_SECONDS = int(os.getenv("AUTH_IDLE_TIMEOUT_SECONDS", "900"))
ACCESS_SESSION_SECONDS = int(os.getenv("AUTH_ACCESS_SESSION_SECONDS", "1800"))
ABSOLUTE_SESSION_SECONDS = int(os.getenv("AUTH_ABSOLUTE_SESSION_SECONDS", "3600"))


@dataclass(frozen=True)
class SessionState:
    user_id: int
    started_at: int
    last_activity_at: int


def start_session(request: Request, user_id: int) -> None:
    now = int(time.time())
    request.session["user_id"] = user_id
    request.session["auth_started_at"] = now
    request.session["auth_last_activity_at"] = now


def authenticated_session(request: Request) -> SessionState | None:
    try:
        state = SessionState(
            user_id=int(request.session["user_id"]),
            started_at=int(request.session["auth_started_at"]),
            last_activity_at=int(request.session["auth_last_activity_at"]),
        )
    except (KeyError, TypeError, ValueError):
        if request.session.get("user_id"):
            request.session.clear()
        return None

    now = int(time.time())
    idle_expired = now - state.last_activity_at >= IDLE_TIMEOUT_SECONDS
    absolute_expired = now - state.started_at >= ABSOLUTE_SESSION_SECONDS
    if idle_expired or absolute_expired:
        request.session.clear()
        return None
    return state


def record_activity(request: Request) -> bool:
    state = authenticated_session(request)
    if not state:
        return False
    request.session["auth_last_activity_at"] = int(time.time())
    return True
