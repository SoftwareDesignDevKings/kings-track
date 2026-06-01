"""add comment to tracking_scores and make score nullable

Revision ID: 0020
Revises: 0019
"""

from alembic import op
import sqlalchemy as sa


revision = "0020"
down_revision = "0019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("tracking_scores", sa.Column("comment", sa.Text(), nullable=True))
    # A cell may now hold a comment with no score, so score becomes optional.
    op.alter_column("tracking_scores", "score", existing_type=sa.Integer(), nullable=True)


def downgrade() -> None:
    # Restore NOT NULL: default any score-less rows to 0 so the constraint holds.
    op.execute("UPDATE tracking_scores SET score = 0 WHERE score IS NULL")
    op.alter_column("tracking_scores", "score", existing_type=sa.Integer(), nullable=False)
    op.drop_column("tracking_scores", "comment")
