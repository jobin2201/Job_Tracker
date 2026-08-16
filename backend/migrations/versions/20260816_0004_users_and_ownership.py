"""Users and per-user application ownership.

Revision ID: 20260816_0004
Revises: 20260813_0003
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260816_0004"
down_revision: Union[str, None] = "20260813_0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("google_subject", sa.String(255), nullable=False),
        sa.Column("email", sa.String(320), nullable=False, server_default=""),
        sa.Column("name", sa.String(160), nullable=False, server_default=""),
        sa.Column("picture_url", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_users_google_subject", "users", ["google_subject"], unique=True)
    op.execute(
        "INSERT INTO users (google_subject, email, name) "
        "VALUES ('legacy-local-owner', 'legacy@local', 'Existing Job Tracker Owner')"
    )
    op.add_column("applications", sa.Column("user_id", sa.Integer(), nullable=True))
    op.execute("UPDATE applications SET user_id = (SELECT id FROM users WHERE google_subject = 'legacy-local-owner')")
    op.alter_column("applications", "user_id", nullable=False)
    op.create_foreign_key("fk_applications_user_id", "applications", "users", ["user_id"], ["id"], ondelete="CASCADE")
    op.create_index("ix_applications_user_id", "applications", ["user_id"])
    op.drop_index("uq_linkedin_external_job", table_name="applications")
    op.create_index("uq_user_source_external_job", "applications", ["user_id", "source", "external_job_id"], unique=True)


def downgrade() -> None:
    op.drop_index("uq_user_source_external_job", table_name="applications")
    op.create_index("uq_linkedin_external_job", "applications", ["source", "external_job_id"], unique=True)
    op.drop_index("ix_applications_user_id", table_name="applications")
    op.drop_constraint("fk_applications_user_id", "applications", type_="foreignkey")
    op.drop_column("applications", "user_id")
    op.drop_index("ix_users_google_subject", table_name="users")
    op.drop_table("users")
