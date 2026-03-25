"""drop current_grade from student_metrics

Revision ID: 0002
Revises: 0001
Create Date: 2026-03-26
"""
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column("student_metrics", "current_grade")


def downgrade() -> None:
    import sqlalchemy as sa
    op.add_column("student_metrics", sa.Column("current_grade", sa.String()))
