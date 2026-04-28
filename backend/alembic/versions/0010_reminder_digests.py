"""Add reminder digest tables and contact models

Revision ID: 0010
Revises: 0009
Create Date: 2026-04-28
"""
from alembic import op
import sqlalchemy as sa

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "schools",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("name", name="uq_schools_name"),
    )

    op.create_table(
        "student_school_links",
        sa.Column("user_id", sa.BigInteger(), sa.ForeignKey("users.id"), primary_key=True),
        sa.Column("school_id", sa.Integer(), sa.ForeignKey("schools.id"), nullable=False),
        sa.Column("linked_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_student_school_links_school_id", "student_school_links", ["school_id"])

    op.create_table(
        "guardian_contacts",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.BigInteger(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("name", sa.Text()),
        sa.Column("email", sa.Text(), nullable=False),
        sa.Column("relationship_label", sa.Text()),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("user_id", "email", name="uq_guardian_contact_user_email"),
    )
    op.create_index("ix_guardian_contacts_user_id", "guardian_contacts", ["user_id"])

    op.create_table(
        "school_contacts",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("school_id", sa.Integer(), sa.ForeignKey("schools.id"), nullable=False),
        sa.Column("name", sa.Text()),
        sa.Column("email", sa.Text(), nullable=False),
        sa.Column("role_label", sa.Text()),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("school_id", "email", name="uq_school_contact_school_email"),
    )
    op.create_index("ix_school_contacts_school_id", "school_contacts", ["school_id"])

    op.create_table(
        "reminder_runs",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("scheduled_for", sa.DateTime(timezone=True), nullable=False),
        sa.Column("triggered_by", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("student_recipient_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("guardian_recipient_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("school_recipient_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("delivery_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("started_at", sa.DateTime(timezone=True)),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
        sa.Column("error_message", sa.Text()),
    )
    op.create_index("ix_reminder_runs_scheduled_for", "reminder_runs", ["scheduled_for"])

    op.create_table(
        "reminder_deliveries",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("run_id", sa.Integer(), sa.ForeignKey("reminder_runs.id")),
        sa.Column("scheduled_for", sa.DateTime(timezone=True), nullable=False),
        sa.Column("recipient_type", sa.Text(), nullable=False),
        sa.Column("recipient_id", sa.Text(), nullable=False),
        sa.Column("user_id", sa.BigInteger(), sa.ForeignKey("users.id")),
        sa.Column("school_id", sa.Integer(), sa.ForeignKey("schools.id")),
        sa.Column("email", sa.Text()),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("subject", sa.Text(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("item_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("attempted_at", sa.DateTime(timezone=True)),
        sa.Column("sent_at", sa.DateTime(timezone=True)),
        sa.Column("provider_response", sa.Text()),
        sa.Column("error_message", sa.Text()),
        sa.UniqueConstraint("recipient_type", "recipient_id", "scheduled_for", name="uq_reminder_delivery_window"),
    )
    op.create_index("ix_reminder_deliveries_run_id", "reminder_deliveries", ["run_id"])
    op.create_index("ix_reminder_deliveries_scheduled_for", "reminder_deliveries", ["scheduled_for"])
    op.create_index("ix_reminder_deliveries_user_id", "reminder_deliveries", ["user_id"])
    op.create_index("ix_reminder_deliveries_school_id", "reminder_deliveries", ["school_id"])


def downgrade() -> None:
    op.drop_index("ix_reminder_deliveries_school_id", table_name="reminder_deliveries")
    op.drop_index("ix_reminder_deliveries_user_id", table_name="reminder_deliveries")
    op.drop_index("ix_reminder_deliveries_scheduled_for", table_name="reminder_deliveries")
    op.drop_index("ix_reminder_deliveries_run_id", table_name="reminder_deliveries")
    op.drop_table("reminder_deliveries")

    op.drop_index("ix_reminder_runs_scheduled_for", table_name="reminder_runs")
    op.drop_table("reminder_runs")

    op.drop_index("ix_school_contacts_school_id", table_name="school_contacts")
    op.drop_table("school_contacts")

    op.drop_index("ix_guardian_contacts_user_id", table_name="guardian_contacts")
    op.drop_table("guardian_contacts")

    op.drop_index("ix_student_school_links_school_id", table_name="student_school_links")
    op.drop_table("student_school_links")

    op.drop_table("schools")
