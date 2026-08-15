"""Application workspace and follow-up history.

Revision ID: 20260813_0002
Revises: 20260813_0001
"""
from alembic import op
import sqlalchemy as sa

revision = "20260813_0002"
down_revision = "20260813_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for name, length in [
        ("posted_text", 100), ("applicants_text", 100), ("work_type", 80),
        ("employment_type", 80), ("contact_phone", 50),
    ]:
        op.add_column("applications", sa.Column(name, sa.String(length), nullable=False, server_default=""))
    op.add_column("applications", sa.Column("contact_linkedin", sa.Text(), nullable=False, server_default=""))
    op.create_table(
        "follow_ups",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("application_id", sa.Integer(), sa.ForeignKey("applications.id", ondelete="CASCADE"), nullable=False),
        sa.Column("scheduled_for", sa.Date(), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("channel", sa.String(30), nullable=False, server_default="EMAIL"),
        sa.Column("contact_name", sa.String(120), nullable=False, server_default=""),
        sa.Column("contact_detail", sa.String(255), nullable=False, server_default=""),
        sa.Column("subject", sa.String(255), nullable=False, server_default=""),
        sa.Column("notes", sa.Text(), nullable=False, server_default=""),
        sa.Column("outcome", sa.String(255), nullable=False, server_default=""),
        sa.Column("is_completed", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_follow_ups_application_scheduled", "follow_ups", ["application_id", "scheduled_for"])


def downgrade() -> None:
    op.drop_index("ix_follow_ups_application_scheduled", table_name="follow_ups")
    op.drop_table("follow_ups")
    for name in ["contact_linkedin", "contact_phone", "employment_type", "work_type", "applicants_text", "posted_text"]:
        op.drop_column("applications", name)
