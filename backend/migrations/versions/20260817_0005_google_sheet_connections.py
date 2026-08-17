"""Per-user Google Sheets connections.

Revision ID: 20260817_0005
Revises: 20260816_0004
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260817_0005"
down_revision: Union[str, None] = "20260816_0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "google_sheet_connections",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("google_account_email", sa.String(320), nullable=False),
        sa.Column("spreadsheet_id", sa.String(255), nullable=False, server_default=""),
        sa.Column("encrypted_token", sa.Text(), nullable=False),
        sa.Column("last_sync_error", sa.Text(), nullable=False, server_default=""),
        sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("user_id", name="uq_google_sheet_connections_user_id"),
    )
    op.create_index("ix_google_sheet_connections_user_id", "google_sheet_connections", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_google_sheet_connections_user_id", table_name="google_sheet_connections")
    op.drop_table("google_sheet_connections")
