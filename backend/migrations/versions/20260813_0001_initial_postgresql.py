"""Initial PostgreSQL schema.

Revision ID: 20260813_0001
Revises:
"""
from alembic import op
import sqlalchemy as sa


revision = "20260813_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "applications",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("company", sa.String(120), nullable=False),
        sa.Column("role", sa.String(160), nullable=False),
        sa.Column("location", sa.String(160), nullable=False, server_default=""),
        sa.Column("source", sa.String(80), nullable=False, server_default="LinkedIn"),
        sa.Column("external_job_id", sa.String(100), nullable=True),
        sa.Column("job_url", sa.Text(), nullable=False, server_default=""),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("status", sa.String(40), nullable=False, server_default="SAVED"),
        sa.Column("applied_at", sa.Date(), nullable=True),
        sa.Column("follow_up_at", sa.Date(), nullable=True),
        sa.Column("contact_name", sa.String(120), nullable=False, server_default=""),
        sa.Column("contact_email", sa.String(180), nullable=False, server_default=""),
        sa.Column("notes", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_applications_status", "applications", ["status"])
    op.create_index("uq_linkedin_external_job", "applications", ["source", "external_job_id"], unique=True)
    op.create_table(
        "application_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("application_id", sa.Integer(), sa.ForeignKey("applications.id", ondelete="CASCADE"), nullable=False),
        sa.Column("event_type", sa.String(80), nullable=False),
        sa.Column("old_status", sa.String(40), nullable=True),
        sa.Column("new_status", sa.String(40), nullable=True),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("event_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_events_application_event_at", "application_events", ["application_id", "event_at"])
    op.create_table(
        "linkedin_accounts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("linkedin_subject", sa.String(255), nullable=False, unique=True),
        sa.Column("name", sa.String(255), nullable=False, server_default=""),
        sa.Column("email", sa.String(255), nullable=False, server_default=""),
        sa.Column("picture_url", sa.Text(), nullable=False, server_default=""),
        sa.Column("access_token", sa.Text(), nullable=False),
        sa.Column("token_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("linkedin_accounts")
    op.drop_index("ix_events_application_event_at", table_name="application_events")
    op.drop_table("application_events")
    op.drop_index("uq_linkedin_external_job", table_name="applications")
    op.drop_index("ix_applications_status", table_name="applications")
    op.drop_table("applications")

