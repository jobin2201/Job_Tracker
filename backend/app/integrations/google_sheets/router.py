import os
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from ...authentication.dependencies import current_user
from ...authentication.oauth import google_oauth
from ...database import get_db
from ...models import GoogleSheetConnection, User
from .service import sync_connection
from .tokens import decrypt_token, encrypt_token


router = APIRouter(prefix="/api/google-sheets", tags=["google-sheets"])


def _client():
    client = getattr(google_oauth, "google_sheets", None)
    if not client:
        raise HTTPException(status_code=503, detail="Google Sheets OAuth is not configured")
    return client


def _connection(db: Session, user_id: int) -> GoogleSheetConnection | None:
    return db.scalar(select(GoogleSheetConnection).where(GoogleSheetConnection.user_id == user_id))


def _frontend_url(query: str = "") -> str:
    base = os.getenv("FRONTEND_URL", "http://127.0.0.1:5173")
    return f"{base}{query}"


@router.get("/connect")
async def connect_google_sheets(request: Request, user: User = Depends(current_user)):
    request.session["google_sheets_connect_user_id"] = user.id
    redirect_uri = os.getenv("GOOGLE_REDIRECT_URI", str(request.url_for("google_callback")))
    return await _client().authorize_redirect(
        request,
        redirect_uri,
        access_type="offline",
        prompt="consent",
        include_granted_scopes="true",
    )


async def complete_google_sheets_oauth(request: Request, db: Session) -> RedirectResponse:
    user_id = request.session.pop("google_sheets_connect_user_id", None)
    user = db.get(User, int(user_id)) if user_id else None
    if not user:
        return RedirectResponse(_frontend_url("?sheets=expired"))
    try:
        token = await _client().authorize_access_token(request)
        userinfo = token.get("userinfo") or await _client().userinfo(token=token)
        google_email = str(userinfo.get("email", "")).strip().lower()
        if google_email != user.email.strip().lower():
            raise ValueError("Connect Google Sheets using the same Google account as MyStratos")
        existing = _connection(db, user.id)
        if existing and not token.get("refresh_token"):
            previous = decrypt_token(existing.encrypted_token)
            token["refresh_token"] = previous.get("refresh_token")
        if not token.get("refresh_token"):
            raise ValueError("Google did not provide offline access; reconnect and approve access")
        connection = existing or GoogleSheetConnection(user_id=user.id, google_account_email=google_email, encrypted_token="")
        connection.google_account_email = google_email
        connection.encrypted_token = encrypt_token({
            "access_token": token.get("access_token"),
            "refresh_token": token.get("refresh_token"),
            "expires_at": token.get("expires_at"),
            "scope": token.get("scope", ""),
        })
        connection.last_sync_error = ""
        db.add(connection)
        db.commit()
        db.refresh(connection)
        sync_connection(db, connection, user)
        return RedirectResponse(_frontend_url("?sheets=connected"))
    except Exception as exc:
        db.rollback()
        return RedirectResponse(_frontend_url(f"?sheets_error={quote(str(exc)[:300])}"))


@router.get("/status")
def sheets_status(db: Session = Depends(get_db), user: User = Depends(current_user)):
    connection = _connection(db, user.id)
    if not connection:
        return {"connected": False}
    return {
        "connected": True,
        "google_account_email": connection.google_account_email,
        "spreadsheet_url": f"https://docs.google.com/spreadsheets/d/{connection.spreadsheet_id}" if connection.spreadsheet_id else "",
        "last_synced_at": connection.last_synced_at,
        "last_sync_error": connection.last_sync_error,
    }


@router.post("/sync")
def sheets_sync(db: Session = Depends(get_db), user: User = Depends(current_user)):
    connection = _connection(db, user.id)
    if not connection:
        raise HTTPException(status_code=404, detail="Connect Google Sheets first")
    try:
        url = sync_connection(db, connection, user)
        return {"ok": True, "spreadsheet_url": url, "last_synced_at": connection.last_synced_at}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Google Sheets sync failed: {exc}") from exc


@router.post("/disconnect", status_code=status.HTTP_204_NO_CONTENT)
def sheets_disconnect(db: Session = Depends(get_db), user: User = Depends(current_user)):
    connection = _connection(db, user.id)
    if connection:
        db.delete(connection)
        db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
