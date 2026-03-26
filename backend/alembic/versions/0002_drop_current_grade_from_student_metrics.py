"""drop current_grade from student_metrics

Revision ID: 0002
Revises: 0001
Create Date: 2026-03-26
"""
from alembic import op
import sqlalchemy as sa

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    column_names = {column["name"] for column in inspector.get_columns("student_metrics")}
    if "current_grade" in column_names:
        op.drop_column("student_metrics", "current_grade")


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    column_names = {column["name"] for column in inspector.get_columns("student_metrics")}
    if "current_grade" not in column_names:
        op.add_column("student_metrics", sa.Column("current_grade", sa.String()))
