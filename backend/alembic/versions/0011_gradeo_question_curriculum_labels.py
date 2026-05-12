"""Add Gradeo question curriculum labels

Revision ID: 0011
Revises: 0010
Create Date: 2026-05-12
"""

from alembic import op
import sqlalchemy as sa


revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("gradeo_assignment_question_results", sa.Column("bands", sa.String()))
    op.add_column("gradeo_assignment_question_results", sa.Column("outcomes", sa.String()))
    op.add_column("gradeo_assignment_question_results", sa.Column("topics", sa.String()))


def downgrade() -> None:
    op.drop_column("gradeo_assignment_question_results", "topics")
    op.drop_column("gradeo_assignment_question_results", "outcomes")
    op.drop_column("gradeo_assignment_question_results", "bands")
