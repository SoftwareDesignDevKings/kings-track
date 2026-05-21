"""Allow multiple EdStem courses per Canvas course

The original schema had a UNIQUE constraint on canvas_course_id alone,
which prevented mapping one Canvas course to multiple EdStem courses.
This migration replaces it with a composite unique constraint on
(canvas_course_id, edstem_course_id).

Revision ID: 0014
Revises: 0013
Create Date: 2026-05-21
"""
from alembic import op


revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint(
        "edstem_course_mappings_canvas_course_id_key",
        "edstem_course_mappings",
        type_="unique",
    )
    op.create_unique_constraint(
        "uq_edstem_mapping_canvas_edstem",
        "edstem_course_mappings",
        ["canvas_course_id", "edstem_course_id"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "uq_edstem_mapping_canvas_edstem",
        "edstem_course_mappings",
        type_="unique",
    )
    op.create_unique_constraint(
        "edstem_course_mappings_canvas_course_id_key",
        "edstem_course_mappings",
        ["canvas_course_id"],
    )
