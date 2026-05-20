"""Add Gradeo import tables

Revision ID: 0006
Revises: 0005
Create Date: 2026-03-31
"""
from alembic import op
import sqlalchemy as sa

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "gradeo_classes",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("gradeo_class_id", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("normalized_name", sa.String(), nullable=False),
        sa.Column("discovered_at", sa.DateTime(timezone=True)),
        sa.Column("last_seen_at", sa.DateTime(timezone=True)),
        sa.UniqueConstraint("gradeo_class_id"),
    )
    op.create_index("ix_gradeo_classes_gradeo_class_id", "gradeo_classes", ["gradeo_class_id"])
    op.create_index("ix_gradeo_classes_normalized_name", "gradeo_classes", ["normalized_name"])

    op.create_table(
        "gradeo_students",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("gradeo_student_id", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("email", sa.String(), nullable=False),
        sa.Column("matched_user_id", sa.BigInteger(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("directory_synced_at", sa.DateTime(timezone=True)),
        sa.Column("last_seen_at", sa.DateTime(timezone=True)),
        sa.UniqueConstraint("gradeo_student_id"),
    )
    op.create_index("ix_gradeo_students_gradeo_student_id", "gradeo_students", ["gradeo_student_id"])
    op.create_index("ix_gradeo_students_email", "gradeo_students", ["email"])
    op.create_index("ix_gradeo_students_matched_user_id", "gradeo_students", ["matched_user_id"])

    op.create_table(
        "gradeo_exams",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("gradeo_exam_id", sa.String(), nullable=False),
        sa.Column("gradeo_class_id", sa.String(), nullable=False),
        sa.Column("exam_name", sa.String(), nullable=False),
        sa.Column("class_name", sa.String()),
        sa.Column("class_average", sa.Float()),
        sa.Column("syllabus_title", sa.String()),
        sa.Column("syllabus_grade", sa.String()),
        sa.Column("bands", sa.String()),
        sa.Column("outcomes", sa.String()),
        sa.Column("topics", sa.String()),
        sa.Column("discovered_at", sa.DateTime(timezone=True)),
        sa.Column("updated_at", sa.DateTime(timezone=True)),
        sa.UniqueConstraint("gradeo_exam_id"),
    )
    op.create_index("ix_gradeo_exams_gradeo_exam_id", "gradeo_exams", ["gradeo_exam_id"])
    op.create_index("ix_gradeo_exams_gradeo_class_id", "gradeo_exams", ["gradeo_class_id"])

    op.create_table(
        "gradeo_class_mappings",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("canvas_course_id", sa.BigInteger(), sa.ForeignKey("courses.id"), nullable=False),
        sa.Column("gradeo_class_id", sa.String(), sa.ForeignKey("gradeo_classes.gradeo_class_id"), nullable=False),
        sa.Column("gradeo_class_name", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True)),
        sa.UniqueConstraint("canvas_course_id"),
        sa.UniqueConstraint("gradeo_class_id"),
    )
    op.create_index("ix_gradeo_class_mappings_canvas_course_id", "gradeo_class_mappings", ["canvas_course_id"])
    op.create_index("ix_gradeo_class_mappings_gradeo_class_id", "gradeo_class_mappings", ["gradeo_class_id"])

    op.create_table(
        "gradeo_exam_results",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("gradeo_exam_id", sa.String(), sa.ForeignKey("gradeo_exams.gradeo_exam_id"), nullable=False),
        sa.Column("gradeo_student_id", sa.String(), sa.ForeignKey("gradeo_students.gradeo_student_id"), nullable=False),
        sa.Column("canvas_course_id", sa.BigInteger(), sa.ForeignKey("courses.id"), nullable=True),
        sa.Column("user_id", sa.BigInteger(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("student_name", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("exam_mark", sa.Float()),
        sa.Column("marks_available", sa.Float()),
        sa.Column("class_average", sa.Float()),
        sa.Column("answer_submitted_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("unmarked_question_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True)),
        sa.Column("last_imported_at", sa.DateTime(timezone=True)),
        sa.UniqueConstraint("gradeo_exam_id", "gradeo_student_id", name="uq_gradeo_exam_result"),
    )
    op.create_index("ix_gradeo_exam_results_gradeo_exam_id", "gradeo_exam_results", ["gradeo_exam_id"])
    op.create_index("ix_gradeo_exam_results_gradeo_student_id", "gradeo_exam_results", ["gradeo_student_id"])
    op.create_index("ix_gradeo_exam_results_canvas_course_id", "gradeo_exam_results", ["canvas_course_id"])
    op.create_index("ix_gradeo_exam_results_user_id", "gradeo_exam_results", ["user_id"])

    op.create_table(
        "gradeo_question_results",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("gradeo_exam_id", sa.String(), sa.ForeignKey("gradeo_exams.gradeo_exam_id"), nullable=False),
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
            "gradeo_exam_id",
            "gradeo_student_id",
            "gradeo_question_part_id",
            name="uq_gradeo_question_result",
        ),
    )
    op.create_index("ix_gradeo_question_results_gradeo_exam_id", "gradeo_question_results", ["gradeo_exam_id"])
    op.create_index(
        "ix_gradeo_question_results_gradeo_student_id",
        "gradeo_question_results",
        ["gradeo_student_id"],
    )
    op.create_index(
        "ix_gradeo_question_results_gradeo_question_part_id",
        "gradeo_question_results",
        ["gradeo_question_part_id"],
    )

    op.create_table(
        "gradeo_import_runs",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("run_type", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("canvas_course_id", sa.BigInteger()),
        sa.Column("gradeo_class_id", sa.String()),
        sa.Column("gradeo_class_name", sa.String()),
        sa.Column("triggered_by", sa.String()),
        sa.Column("source_type", sa.String()),
        sa.Column("extension_version", sa.String()),
        sa.Column("processed_students", sa.Integer(), server_default="0", nullable=False),
        sa.Column("matched_students", sa.Integer(), server_default="0", nullable=False),
        sa.Column("imported_exams", sa.Integer(), server_default="0", nullable=False),
        sa.Column("imported_question_results", sa.Integer(), server_default="0", nullable=False),
        sa.Column("unmatched_students", sa.Integer(), server_default="0", nullable=False),
        sa.Column("skipped_students", sa.Integer(), server_default="0", nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True)),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
        sa.Column("error_message", sa.Text()),
    )
    op.create_index("ix_gradeo_import_runs_run_type", "gradeo_import_runs", ["run_type"])
    op.create_index("ix_gradeo_import_runs_status", "gradeo_import_runs", ["status"])
    op.create_index("ix_gradeo_import_runs_canvas_course_id", "gradeo_import_runs", ["canvas_course_id"])
    op.create_index("ix_gradeo_import_runs_gradeo_class_id", "gradeo_import_runs", ["gradeo_class_id"])


def downgrade() -> None:
    op.drop_index("ix_gradeo_import_runs_gradeo_class_id", table_name="gradeo_import_runs")
    op.drop_index("ix_gradeo_import_runs_canvas_course_id", table_name="gradeo_import_runs")
    op.drop_index("ix_gradeo_import_runs_status", table_name="gradeo_import_runs")
    op.drop_index("ix_gradeo_import_runs_run_type", table_name="gradeo_import_runs")
    op.drop_table("gradeo_import_runs")

    op.drop_index(
        "ix_gradeo_question_results_gradeo_question_part_id",
        table_name="gradeo_question_results",
    )
    op.drop_index("ix_gradeo_question_results_gradeo_student_id", table_name="gradeo_question_results")
    op.drop_index("ix_gradeo_question_results_gradeo_exam_id", table_name="gradeo_question_results")
    op.drop_table("gradeo_question_results")

    op.drop_index("ix_gradeo_exam_results_user_id", table_name="gradeo_exam_results")
    op.drop_index("ix_gradeo_exam_results_canvas_course_id", table_name="gradeo_exam_results")
    op.drop_index("ix_gradeo_exam_results_gradeo_student_id", table_name="gradeo_exam_results")
    op.drop_index("ix_gradeo_exam_results_gradeo_exam_id", table_name="gradeo_exam_results")
    op.drop_table("gradeo_exam_results")

    op.drop_index("ix_gradeo_class_mappings_gradeo_class_id", table_name="gradeo_class_mappings")
    op.drop_index("ix_gradeo_class_mappings_canvas_course_id", table_name="gradeo_class_mappings")
    op.drop_table("gradeo_class_mappings")

    op.drop_index("ix_gradeo_exams_gradeo_class_id", table_name="gradeo_exams")
    op.drop_index("ix_gradeo_exams_gradeo_exam_id", table_name="gradeo_exams")
    op.drop_table("gradeo_exams")

    op.drop_index("ix_gradeo_students_matched_user_id", table_name="gradeo_students")
    op.drop_index("ix_gradeo_students_email", table_name="gradeo_students")
    op.drop_index("ix_gradeo_students_gradeo_student_id", table_name="gradeo_students")
    op.drop_table("gradeo_students")

    op.drop_index("ix_gradeo_classes_normalized_name", table_name="gradeo_classes")
    op.drop_index("ix_gradeo_classes_gradeo_class_id", table_name="gradeo_classes")
    op.drop_table("gradeo_classes")
