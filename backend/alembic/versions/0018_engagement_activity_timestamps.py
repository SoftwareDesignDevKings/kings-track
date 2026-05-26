"""Add last_page_view_at and last_participation_at to canvas_engagement

Revision ID: 0018
Revises: 0017
Create Date: 2026-05-27
"""

from alembic import op
import sqlalchemy as sa


revision = "0018"
down_revision = "0017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("canvas_engagement", sa.Column("last_page_view_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("canvas_engagement", sa.Column("last_participation_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("canvas_engagement", "last_participation_at")
    op.drop_column("canvas_engagement", "last_page_view_at")
