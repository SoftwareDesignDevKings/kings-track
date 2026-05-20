"""Add Gradeo assignment-based data model

Revision ID: 0007
Revises: 0006
Create Date: 2026-04-02
"""
from alembic import op
import sqlalchemy as sa

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "gradeo_class_syllabuses",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("gradeo_class_id", sa.String(), sa.ForeignKey("gradeo_classes.gradeo_class_id"), nullable=False),
        sa.Column("syllabus_id", sa.String(), nullable=False),
        sa.Column("title", sa.String()),
        sa.Column("description", sa.String()),
        sa.Column("grade", sa.Integer()),
        sa.UniqueConstraint("gradeo_class_id", "syllabus_id", name="uq_gradeo_class_syllabus"),
    )
    op.create_index("ix_gradeo_class_syllabuses_gradeo_class_id", "gradeo_class_syllabuses", ["gradeo_class_id"])
    op.create_index("ix_gradeo_class_syllabuses_syllabus_id", "gradeo_class_syllabuses", ["syllabus_id"])

    op.create_table(
        "gradeo_exam_definitions",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("gradeo_exam_id", sa.String(), nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("syllabus_id", sa.String()),
        sa.Column("syllabus_title", sa.String()),
        sa.Column("syllabus_grade", sa.String()),
        sa.Column("publish_date", sa.DateTime(timezone=True)),
        sa.Column("is_published", sa.Boolean()),
        sa.Column("discovered_at", sa.DateTime(timezone=True)),
        sa.Column("updated_at", sa.DateTime(timezone=True)),
        sa.UniqueConstraint("gradeo_exam_id"),
    )
    op.create_index("ix_gradeo_exam_definitions_gradeo_exam_id", "gradeo_exam_definitions", ["gradeo_exam_id"])
    op.create_index("ix_gradeo_exam_definitions_syllabus_id", "gradeo_exam_definitions", ["syllabus_id"])

    op.create_table(
        "gradeo_exam_sessions",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("gradeo_exam_session_id", sa.String(), nullable=False),
        sa.Column("gradeo_exam_id", sa.String(), sa.ForeignKey("gradeo_exam_definitions.gradeo_exam_id"), nullable=False),
        sa.Column("start_date", sa.DateTime(timezone=True)),
        sa.Column("end_date", sa.DateTime(timezone=True)),
        sa.Column("discovered_at", sa.DateTime(timezone=True)),
        sa.Column("updated_at", sa.DateTime(timezone=True)),
        sa.UniqueConstraint("gradeo_exam_session_id"),
    )
    op.create_index("ix_gradeo_exam_sessions_gradeo_exam_session_id", "gradeo_exam_sessions", ["gradeo_exam_session_id"])
    op.create_index("ix_gradeo_exam_sessions_gradeo_exam_id", "gradeo_exam_sessions", ["gradeo_exam_id"])

    op.create_table(
        "gradeo_class_exam_assignments",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("gradeo_class_id", sa.String(), sa.ForeignKey("gradeo_classes.gradeo_class_id"), nullable=False),
        sa.Column("gradeo_marking_session_id", sa.String(), nullable=False),
        sa.Column("gradeo_exam_id", sa.String(), sa.ForeignKey("gradeo_exam_definitions.gradeo_exam_id"), nullable=False),
        sa.Column("gradeo_exam_session_id", sa.String(), sa.ForeignKey("gradeo_exam_sessions.gradeo_exam_session_id")),
        sa.Column("exam_name", sa.String(), nullable=False),
        sa.Column("class_name", sa.String()),
        sa.Column("class_average", sa.Float()),
        sa.Column("syllabus_id", sa.String()),
        sa.Column("syllabus_title", sa.String()),
        sa.Column("syllabus_grade", sa.String()),
        sa.Column("bands", sa.String()),
        sa.Column("outcomes", sa.String()),
        sa.Column("topics", sa.String()),
        sa.Column("discovered_at", sa.DateTime(timezone=True)),
        sa.Column("updated_at", sa.DateTime(timezone=True)),
        sa.UniqueConstraint("gradeo_class_id", "gradeo_marking_session_id", name="uq_gradeo_class_exam_assignment"),
    )
    op.create_index("ix_gradeo_class_exam_assignments_gradeo_class_id", "gradeo_class_exam_assignments", ["gradeo_class_id"])
    op.create_index("ix_gradeo_class_exam_assignments_gradeo_marking_session_id", "gradeo_class_exam_assignments", ["gradeo_marking_session_id"])
    op.create_index("ix_gradeo_class_exam_assignments_gradeo_exam_id", "gradeo_class_exam_assignments", ["gradeo_exam_id"])
    op.create_index("ix_gradeo_class_exam_assignments_gradeo_exam_session_id", "gradeo_class_exam_assignments", ["gradeo_exam_session_id"])
    op.create_index("ix_gradeo_class_exam_assignments_syllabus_id", "gradeo_class_exam_assignments", ["syllabus_id"])

    op.create_table(
        "gradeo_assignment_results",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("gradeo_class_exam_assignment_id", sa.Integer(), sa.ForeignKey("gradeo_class_exam_assignments.id"), nullable=False),
        sa.Column("gradeo_student_id", sa.String(), sa.ForeignKey("gradeo_students.gradeo_student_id"), nullable=False),
        sa.Column("canvas_course_id", sa.BigInteger(), sa.ForeignKey("courses.id")),
        sa.Column("user_id", sa.BigInteger(), sa.ForeignKey("users.id")),
        sa.Column("student_name", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("exam_mark", sa.Float()),
        sa.Column("marks_available", sa.Float()),
        sa.Column("class_average", sa.Float()),
        sa.Column("answer_submitted_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("unmarked_question_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True)),
        sa.Column("last_imported_at", sa.DateTime(timezone=True)),
        sa.UniqueConstraint("gradeo_class_exam_assignment_id", "gradeo_student_id", name="uq_gradeo_assignment_result"),
    )
    op.create_index("ix_gradeo_assignment_results_gradeo_class_exam_assignment_id", "gradeo_assignment_results", ["gradeo_class_exam_assignment_id"])
    op.create_index("ix_gradeo_assignment_results_gradeo_student_id", "gradeo_assignment_results", ["gradeo_student_id"])
    op.create_index("ix_gradeo_assignment_results_canvas_course_id", "gradeo_assignment_results", ["canvas_course_id"])
    op.create_index("ix_gradeo_assignment_results_user_id", "gradeo_assignment_results", ["user_id"])

    op.create_table(
        "gradeo_assignment_question_results",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("gradeo_class_exam_assignment_id", sa.Integer(), sa.ForeignKey("gradeo_class_exam_assignments.id"), nullable=False),
        sa.Column("gradeo_student_id", sa.String(), sa.ForeignKey("gradeo_students.gradeo_student_id"), nullable=False),
        sa.Column("gradeo_question_id", sa.String()),
        sa.Column("gradeo_question_part_id", sa.String(), nullable=False),
        sa.Column("copyright_notice", sa.String()),
        sa.Column("question", sa.String()),
        sa.Column("question_part", sa.String()),
        sa.Column("question_link", sa.Text()),
        sa.Column("mark", sa.Float()),
        sa.Column("marks_available", sa.Float()),
        sa.Column("answer_submitted", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("feedback", sa.Text()),
        sa.Column("marker_name", sa.String()),
        sa.Column("marker_id", sa.String()),
        sa.Column("marking_session_link", sa.Text()),
        sa.Column("last_imported_at", sa.DateTime(timezone=True)),
        sa.UniqueConstraint(
            "gradeo_class_exam_assignment_id",
            "gradeo_student_id",
            "gradeo_question_part_id",
            name="uq_gradeo_assignment_question_result",
        ),
    )
    op.create_index(
        "ix_gaqr_assignment_id",
        "gradeo_assignment_question_results",
        ["gradeo_class_exam_assignment_id"],
    )
    op.create_index(
        "ix_gaqr_student_id",
        "gradeo_assignment_question_results",
        ["gradeo_student_id"],
    )
    op.create_index(
        "ix_gaqr_question_part_id",
        "gradeo_assignment_question_results",
        ["gradeo_question_part_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_gaqr_question_part_id",
        table_name="gradeo_assignment_question_results",
    )
    op.drop_index(
        "ix_gaqr_student_id",
        table_name="gradeo_assignment_question_results",
    )
    op.drop_index(
        "ix_gaqr_assignment_id",
        table_name="gradeo_assignment_question_results",
    )
    op.drop_table("gradeo_assignment_question_results")

    op.drop_index("ix_gradeo_assignment_results_user_id", table_name="gradeo_assignment_results")
    op.drop_index("ix_gradeo_assignment_results_canvas_course_id", table_name="gradeo_assignment_results")
    op.drop_index("ix_gradeo_assignment_results_gradeo_student_id", table_name="gradeo_assignment_results")
    op.drop_index("ix_gradeo_assignment_results_gradeo_class_exam_assignment_id", table_name="gradeo_assignment_results")
    op.drop_table("gradeo_assignment_results")

    op.drop_index("ix_gradeo_class_exam_assignments_syllabus_id", table_name="gradeo_class_exam_assignments")
    op.drop_index("ix_gradeo_class_exam_assignments_gradeo_exam_session_id", table_name="gradeo_class_exam_assignments")
    op.drop_index("ix_gradeo_class_exam_assignments_gradeo_exam_id", table_name="gradeo_class_exam_assignments")
    op.drop_index("ix_gradeo_class_exam_assignments_gradeo_marking_session_id", table_name="gradeo_class_exam_assignments")
    op.drop_index("ix_gradeo_class_exam_assignments_gradeo_class_id", table_name="gradeo_class_exam_assignments")
    op.drop_table("gradeo_class_exam_assignments")

    op.drop_index("ix_gradeo_exam_sessions_gradeo_exam_id", table_name="gradeo_exam_sessions")
    op.drop_index("ix_gradeo_exam_sessions_gradeo_exam_session_id", table_name="gradeo_exam_sessions")
    op.drop_table("gradeo_exam_sessions")

    op.drop_index("ix_gradeo_exam_definitions_syllabus_id", table_name="gradeo_exam_definitions")
    op.drop_index("ix_gradeo_exam_definitions_gradeo_exam_id", table_name="gradeo_exam_definitions")
    op.drop_table("gradeo_exam_definitions")

    op.drop_index("ix_gradeo_class_syllabuses_syllabus_id", table_name="gradeo_class_syllabuses")
    op.drop_index("ix_gradeo_class_syllabuses_gradeo_class_id", table_name="gradeo_class_syllabuses")
    op.drop_table("gradeo_class_syllabuses")
