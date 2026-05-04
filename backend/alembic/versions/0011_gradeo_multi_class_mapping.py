"""Allow multiple Gradeo classes to map to the same Canvas course

Revision ID: 0011
Revises: 0010
Create Date: 2026-05-04
"""

from alembic import op

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint(
        "gradeo_class_mappings_canvas_course_id_key",
        "gradeo_class_mappings",
        type_="unique",
    )


def downgrade() -> None:
    op.create_unique_constraint(
        "gradeo_class_mappings_canvas_course_id_key",
        "gradeo_class_mappings",
        ["canvas_course_id"],
    )
