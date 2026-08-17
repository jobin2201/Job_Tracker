import os

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import User
from .security import read_token
from .session_policy import authenticated_session


def current_user(request: Request, db: Session = Depends(get_db)) -> User:
    session = authenticated_session(request)
    user_id = session.user_id if session else None
    authorization = request.headers.get("Authorization", "")
    if authorization.lower().startswith("bearer "):
        user_id = read_token(authorization.split(" ", 1)[1].strip())
    user = db.get(User, int(user_id)) if user_id else None
    if user:
        return user
    if os.getenv("AUTH_REQUIRED", "false").lower() != "true":
        legacy = db.scalar(select(User).where(User.google_subject == "legacy-local-owner"))
        if legacy:
            return legacy
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sign in to Job Tracker")
