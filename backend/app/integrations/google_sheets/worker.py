import asyncio
import os

from sqlalchemy import select

from ...database import SessionLocal
from ...models import GoogleSheetConnection, User
from .service import sync_connection


def _sync_one(connection_id: int) -> None:
    with SessionLocal() as db:
        connection = db.get(GoogleSheetConnection, connection_id)
        user = db.get(User, connection.user_id) if connection else None
        if connection and user:
            sync_connection(db, connection, user)


async def synchronize_connected_users() -> None:
    with SessionLocal() as db:
        connection_ids = list(db.scalars(select(GoogleSheetConnection.id)))
    for connection_id in connection_ids:
        try:
            await asyncio.to_thread(_sync_one, connection_id)
        except Exception:
            # The error is stored on this user's connection. A failed mirror
            # never interrupts PostgreSQL application capture.
            continue


async def sheets_sync_worker() -> None:
    interval = max(60, int(os.getenv("GOOGLE_SHEETS_SYNC_INTERVAL_SECONDS", "300")))
    while True:
        await asyncio.sleep(interval)
        await synchronize_connected_users()
