"""Multiple application contacts.

Revision ID: 20260813_0003
Revises: 20260813_0002
"""
from alembic import op
import sqlalchemy as sa

revision = "20260813_0003"
down_revision = "20260813_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "application_contacts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("application_id", sa.Integer(), sa.ForeignKey("applications.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("title", sa.String(180), nullable=False, server_default=""),
        sa.Column("relationship", sa.String(50), nullable=False, server_default=""),
        sa.Column("email", sa.String(180), nullable=False, server_default=""),
        sa.Column("phone", sa.String(50), nullable=False, server_default=""),
        sa.Column("linkedin_url", sa.Text(), nullable=False, server_default=""),
        sa.Column("notes", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("application_contacts")
