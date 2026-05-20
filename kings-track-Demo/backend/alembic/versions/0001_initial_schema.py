"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-03-25
"""
from alembic import op
import sqlalchemy as sa

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "courses",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("course_code", sa.String()),
        sa.Column("workflow_state", sa.String()),
        sa.Column("account_id", sa.BigInteger()),
        sa.Column("term_id", sa.BigInteger()),
        sa.Column("total_students", sa.Integer(), default=0),
        sa.Column("synced_at", sa.DateTime(timezone=True)),
    )

    op.create_table(
        "users",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("sortable_name", sa.String()),
        sa.Column("email", sa.String()),
        sa.Column("sis_id", sa.String()),
    )
    op.create_index("ix_users_sis_id", "users", ["sis_id"])

    op.create_table(
        "enrollments",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("course_id", sa.BigInteger(), sa.ForeignKey("courses.id"), nullable=False),
        sa.Column("user_id", sa.BigInteger(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("role", sa.String()),
        sa.Column("enrollment_state", sa.String()),
        sa.Column("last_activity_at", sa.DateTime(timezone=True)),
        sa.Column("current_score", sa.Float()),
        sa.Column("current_grade", sa.String()),
        sa.Column("final_score", sa.Float()),
        sa.Column("final_grade", sa.String()),
    )
    op.create_index("ix_enrollments_course_id", "enrollments", ["course_id"])
    op.create_index("ix_enrollments_user_id", "enrollments", ["user_id"])
    op.create_unique_constraint("uq_enrollment", "enrollments", ["course_id", "user_id", "role"])

    op.create_table(
        "assignments",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("course_id", sa.BigInteger(), sa.ForeignKey("courses.id"), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("assignment_group_name", sa.String()),
        sa.Column("assignment_group_id", sa.BigInteger()),
        sa.Column("points_possible", sa.Float()),
        sa.Column("due_at", sa.DateTime(timezone=True)),
        sa.Column("unlock_at", sa.DateTime(timezone=True)),
        sa.Column("position", sa.Integer()),
        sa.Column("workflow_state", sa.String()),
        sa.Column("submission_types", sa.String()),
        sa.Column("synced_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_assignments_course_id", "assignments", ["course_id"])

    op.create_table(
        "submissions",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("assignment_id", sa.BigInteger(), sa.ForeignKey("assignments.id"), nullable=False),
        sa.Column("user_id", sa.BigInteger(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("course_id", sa.BigInteger(), sa.ForeignKey("courses.id"), nullable=False),
        sa.Column("score", sa.Float()),
        sa.Column("grade", sa.String()),
        sa.Column("workflow_state", sa.String()),
        sa.Column("submitted_at", sa.DateTime(timezone=True)),
        sa.Column("graded_at", sa.DateTime(timezone=True)),
        sa.Column("late", sa.Boolean(), default=False),
        sa.Column("missing", sa.Boolean(), default=False),
        sa.Column("excused", sa.Boolean()),
        sa.Column("attempt", sa.BigInteger()),
        sa.Column("synced_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_submissions_assignment_id", "submissions", ["assignment_id"])
    op.create_index("ix_submissions_user_id", "submissions", ["user_id"])
    op.create_index("ix_submissions_course_id", "submissions", ["course_id"])
    op.create_unique_constraint("uq_submission", "submissions", ["assignment_id", "user_id"])

    op.create_table(
        "student_metrics",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("course_id", sa.BigInteger(), sa.ForeignKey("courses.id"), nullable=False),
        sa.Column("user_id", sa.BigInteger(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("completion_rate", sa.Float()),
        sa.Column("on_time_rate", sa.Float()),
        sa.Column("current_score", sa.Float()),
        sa.Column("current_grade", sa.String()),
        sa.Column("computed_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_student_metrics_course_id", "student_metrics", ["course_id"])
    op.create_unique_constraint("uq_student_metrics", "student_metrics", ["course_id", "user_id"])

    op.create_table(
        "sync_log",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("entity_type", sa.String(), nullable=False),
        sa.Column("course_id", sa.BigInteger()),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("records_synced", sa.Integer(), default=0),
        sa.Column("started_at", sa.DateTime(timezone=True)),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
        sa.Column("error_message", sa.Text()),
    )


def downgrade() -> None:
    op.drop_table("sync_log")
    op.drop_table("student_metrics")
    op.drop_table("submissions")
    op.drop_table("assignments")
    op.drop_table("enrollments")
    op.drop_table("users")
    op.drop_table("courses")
