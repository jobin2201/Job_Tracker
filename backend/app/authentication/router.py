import os
from urllib.parse import quote, urlparse

from authlib.integrations.starlette_client import OAuthError
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import RedirectResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Application, User
from .dependencies import current_user
from .oauth import google_oauth
from .security import issue_token
from .session_policy import authenticated_session, record_activity, start_session


router = APIRouter(tags=["authentication"])


def _client():
    client = getattr(google_oauth, "google", None)
    if not client:
        raise HTTPException(
            status_code=503,
            detail="Google authentication is not configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to backend/.env.",
        )
    return client


def _safe_frontend_redirect(value: str) -> str:
    fallback = os.getenv("FRONTEND_URL", "http://127.0.0.1:5173").rstrip("/")
    if not value:
        return fallback

    parsed = urlparse(value)
    fallback_parsed = urlparse(fallback)
    if not parsed.scheme or not parsed.netloc or parsed.username or parsed.password:
        return fallback

    requested_origin = f"{parsed.scheme}://{parsed.netloc}".rstrip("/")
    fallback_origin = f"{fallback_parsed.scheme}://{fallback_parsed.netloc}".rstrip("/")
    local_origins = {"http://127.0.0.1:5173", "http://localhost:5173"}

    # The deployed frontend is controlled by FRONTEND_URL. Local origins stay
    # available for development without permitting an arbitrary OAuth redirect.
    if requested_origin == fallback_origin or requested_origin in local_origins:
        return value
    return fallback


@router.get("/auth/google")
async def google_login(request: Request, next: str = ""):
    request.session["auth_next"] = _safe_frontend_redirect(next)
    request.session.pop("extension_redirect", None)
    redirect_uri = os.getenv("GOOGLE_REDIRECT_URI", str(request.url_for("google_callback")))
    return await _client().authorize_redirect(request, redirect_uri)


@router.get("/auth/google/extension")
async def google_extension_login(request: Request, redirect_uri: str):
    parsed = urlparse(redirect_uri)
    if parsed.scheme != "https" or not parsed.hostname or not parsed.hostname.endswith(".chromiumapp.org"):
        raise HTTPException(status_code=400, detail="Invalid extension redirect URI")
    request.session["extension_redirect"] = redirect_uri
    request.session.pop("auth_next", None)
    callback_uri = os.getenv("GOOGLE_REDIRECT_URI", str(request.url_for("google_callback")))
    return await _client().authorize_redirect(request, callback_uri)


@router.get("/auth/google/callback", name="google_callback")
async def google_callback(request: Request, db: Session = Depends(get_db)):
    if request.session.get("google_sheets_connect_user_id"):
        from ..integrations.google_sheets import complete_google_sheets_oauth

        return await complete_google_sheets_oauth(request, db)
    try:
        token = await _client().authorize_access_token(request)
        userinfo = token.get("userinfo") or await _client().userinfo(token=token)
    except OAuthError as exc:
        raise HTTPException(status_code=400, detail=f"Google authorization failed: {exc.error}") from exc
    subject = str(userinfo.get("sub", "")).strip()
    email = str(userinfo.get("email", "")).strip().lower()
    if not subject or not email:
        raise HTTPException(status_code=400, detail="Google did not return a usable account")
    user = db.scalar(select(User).where(User.google_subject == subject))
    if not user:
        user = User(google_subject=subject, email=email)
        db.add(user)
        db.flush()
        if os.getenv("CLAIM_LEGACY_DATA_ON_FIRST_LOGIN", "true").lower() == "true":
            other_accounts = db.scalar(
                select(func.count(User.id)).where(User.google_subject != "legacy-local-owner", User.id != user.id)
            ) or 0
            legacy = db.scalar(select(User).where(User.google_subject == "legacy-local-owner"))
            if other_accounts == 0 and legacy:
                for application in db.scalars(select(Application).where(Application.user_id == legacy.id)):
                    application.user_id = user.id
    user.email = email
    user.name = str(userinfo.get("name", "")).strip()
    id_token_claims = token.get("id_token_claims") or {}
    user.picture_url = str(
        userinfo.get("picture") or token.get("picture") or id_token_claims.get("picture") or user.picture_url or ""
    ).strip()
    db.commit()
    db.refresh(user)
    start_session(request, user.id)
    extension_redirect = request.session.pop("extension_redirect", "")
    if extension_redirect:
        return RedirectResponse(f"{extension_redirect}#token={quote(issue_token(user))}")
    destination = request.session.pop("auth_next", _safe_frontend_redirect(""))
    if destination.startswith("https://"):
        # Browsers commonly block Render's cookie when the Vercel frontend
        # calls it as a third party (especially in Incognito). A short-lived,
        # signed token in the fragment is not sent to Vercel and is consumed
        # immediately by the frontend. Local development keeps cookie auth.
        return RedirectResponse(f"{destination}#auth_token={quote(issue_token(user))}")
    return RedirectResponse(destination)


@router.get("/api/auth/me")
def auth_me(user: User = Depends(current_user)):
    return {"id": user.id, "email": user.email, "name": user.name, "picture_url": user.picture_url}


@router.get("/auth/google/status")
def google_status(request: Request, db: Session = Depends(get_db)):
    session = authenticated_session(request)
    user = db.get(User, session.user_id) if session else None
    return {
        "configured": bool(os.getenv("GOOGLE_CLIENT_ID") and os.getenv("GOOGLE_CLIENT_SECRET")),
        "authenticated": user is not None,
        "user": {"email": user.email, "name": user.name, "picture_url": user.picture_url} if user else None,
    }


@router.post("/api/auth/activity", status_code=status.HTTP_204_NO_CONTENT)
def auth_activity(request: Request, user: User = Depends(current_user)):
    authorization = request.headers.get("Authorization", "")
    if not record_activity(request) and not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Your session has expired. Sign in again.")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
@router.post("/api/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
def auth_logout(request: Request):
    request.session.clear()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
