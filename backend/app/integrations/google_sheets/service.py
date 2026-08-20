from datetime import datetime, timezone

from sqlalchemy.orm import Session

from ...models import GoogleSheetConnection, User
from .sheet_builder import build_user_sheets
from .tokens import decrypt_token, encrypt_token


def sync_connection(db: Session, connection: GoogleSheetConnection, user: User) -> str:
    try:
        from .client import credentials_from_token, refreshed_token, replace_sheet

        token = decrypt_token(connection.encrypted_token)
        credentials = credentials_from_token(token)
        sheets = build_user_sheets(db, user)
        spreadsheet_id, spreadsheet_url = replace_sheet(
            credentials,
            connection.spreadsheet_id,
            f"MyStratos — {user.email}",
            sheets,
        )
        connection.spreadsheet_id = spreadsheet_id
        connection.encrypted_token = encrypt_token(refreshed_token(credentials, token))
        connection.last_synced_at = datetime.now(timezone.utc)
        connection.last_sync_error = ""
        db.commit()
        return spreadsheet_url
    except Exception as exc:
        db.rollback()
        current = db.get(GoogleSheetConnection, connection.id)
        if current:
            current.last_sync_error = str(exc)[:2000]
            db.commit()
        raise
