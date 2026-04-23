"""Store Canvas assignment group position on assignments.

Revision ID: 0009
Revises: 0008
"""
from alembic import op
import sqlalchemy as sa


revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("assignments")}
    if "assignment_group_position" not in columns:
        op.add_column("assignments", sa.Column("assignment_group_position", sa.Integer(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("assignments")}
    if "assignment_group_position" in columns:
        op.drop_column("assignments", "assignment_group_position")
