"""Add Gradeo question curriculum labels

Revision ID: 0013
Revises: 0012
Create Date: 2026-05-12
"""

from alembic import op
import sqlalchemy as sa


revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Use IF NOT EXISTS — these columns may already exist if migration was partially applied
    op.execute("ALTER TABLE gradeo_assignment_question_results ADD COLUMN IF NOT EXISTS bands VARCHAR")
    op.execute("ALTER TABLE gradeo_assignment_question_results ADD COLUMN IF NOT EXISTS outcomes VARCHAR")
    op.execute("ALTER TABLE gradeo_assignment_question_results ADD COLUMN IF NOT EXISTS topics VARCHAR")


def downgrade() -> None:
    op.drop_column("gradeo_assignment_question_results", "topics")
    op.drop_column("gradeo_assignment_question_results", "outcomes")
    op.drop_column("gradeo_assignment_question_results", "bands")
