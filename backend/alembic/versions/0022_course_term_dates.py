"""add course term dates

Revision ID: 0022
Revises: 0021
Create Date: 2026-06-04
"""
from alembic import op
import sqlalchemy as sa

revision = "0022"
down_revision = "0021"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("courses", sa.Column("term_start_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("courses", sa.Column("term_end_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("courses", "term_end_at")
    op.drop_column("courses", "term_start_at")
