"""Add rubric_criteria, tracking_snapshots, tracking_scores tables

Revision ID: 0019
Revises: 0018
Create Date: 2026-05-27
"""

from alembic import op
import sqlalchemy as sa


revision = "0019"
down_revision = "0018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "rubric_criteria",
        sa.Column("id", sa.String, primary_key=True),
        sa.Column("assignment_id", sa.BigInteger, sa.ForeignKey("assignments.id"), nullable=False, index=True),
        sa.Column("description", sa.String, nullable=False),
        sa.Column("long_description", sa.String, nullable=True),
        sa.Column("points", sa.Float, nullable=True),
        sa.Column("position", sa.Integer, nullable=False, server_default="0"),
        sa.Column("synced_at", sa.DateTime(timezone=True), nullable=True),
    )

    op.create_table(
        "tracking_snapshots",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("assignment_id", sa.BigInteger, sa.ForeignKey("assignments.id"), nullable=False, index=True),
        sa.Column("created_by_email", sa.String, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("committed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("label", sa.String, nullable=True),
    )

    op.create_index(
        "uq_one_draft_per_assignment",
        "tracking_snapshots",
        ["assignment_id"],
        unique=True,
        postgresql_where=sa.text("committed_at IS NULL"),
    )

    op.create_table(
        "tracking_scores",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("snapshot_id", sa.Integer, sa.ForeignKey("tracking_snapshots.id"), nullable=False, index=True),
        sa.Column("user_id", sa.BigInteger, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("rubric_criterion_id", sa.String, sa.ForeignKey("rubric_criteria.id"), nullable=False),
        sa.Column("score", sa.Integer, nullable=False),
        sa.UniqueConstraint("snapshot_id", "user_id", "rubric_criterion_id", name="uq_score_per_cell"),
    )


def downgrade() -> None:
    op.drop_table("tracking_scores")
    op.drop_index("uq_one_draft_per_assignment", table_name="tracking_snapshots")
    op.drop_table("tracking_snapshots")
    op.drop_table("rubric_criteria")
