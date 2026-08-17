from contextlib import contextmanager
from typing import Iterator

import psycopg2
from psycopg2.extras import RealDictCursor

from .config import Settings


class ReadOnlyJobTracker:
    def __init__(self, settings: Settings):
        self.settings = settings

    @contextmanager
    def _connection(self) -> Iterator:
        connection = psycopg2.connect(
            host=self.settings.postgres_host,
            port=self.settings.postgres_port,
            dbname=self.settings.postgres_db,
            user=self.settings.postgres_user,
            password=self.settings.postgres_password,
            cursor_factory=RealDictCursor,
        )
        connection.set_session(readonly=True, autocommit=False)
        try:
            yield connection
        finally:
            connection.rollback()
            connection.close()

    @staticmethod
    def _rows(cursor, query: str, parameters: tuple) -> list[dict]:
        cursor.execute(query, parameters)
        return [dict(row) for row in cursor.fetchall()]

    def snapshot(self) -> dict[str, list[dict] | dict]:
        with self._connection() as connection, connection.cursor() as cursor:
            cursor.execute("SELECT id, email, name FROM users WHERE lower(email) = %s", (self.settings.user_email,))
            user = cursor.fetchone()
            if not user:
                raise ValueError(f"No Job Tracker user exists for {self.settings.user_email}")
            user_id = user["id"]
            applications = self._rows(cursor, """
                SELECT * FROM applications WHERE user_id = %s
                ORDER BY created_at DESC, id DESC
            """, (user_id,))
            contacts = self._rows(cursor, """
                SELECT c.*, a.company, a.role
                FROM application_contacts c
                JOIN applications a ON a.id = c.application_id
                WHERE a.user_id = %s ORDER BY c.created_at DESC, c.id DESC
            """, (user_id,))
            follow_ups = self._rows(cursor, """
                SELECT f.*, a.company, a.role, a.source
                FROM follow_ups f
                JOIN applications a ON a.id = f.application_id
                WHERE a.user_id = %s ORDER BY f.scheduled_for, f.id
            """, (user_id,))
            events = self._rows(cursor, """
                SELECT e.*, a.company, a.role, a.source
                FROM application_events e
                JOIN applications a ON a.id = e.application_id
                WHERE a.user_id = %s ORDER BY e.event_at DESC, e.id DESC
            """, (user_id,))
            return {
                "user": dict(user),
                "applications": applications,
                "contacts": contacts,
                "follow_ups": follow_ups,
                "events": events,
            }
