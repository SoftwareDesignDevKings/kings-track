"""Namespace rubric_criteria.id per assignment to avoid cross-assignment collisions

Canvas rubric criterion ids (e.g. "_3514", "blank") are only unique within a
rubric, not globally. The same rubric is reused across assignments/sections, so
the raw id collided on rubric_criteria's global primary key: whichever assignment
synced first claimed the id, and later assignments (e.g. course 12SENX) ended up
with zero criteria — and therefore no Tracking tab.

This migration rewrites existing ids to the namespaced form "<assignment_id>:<id>"
and updates the tracking_scores foreign key to match, preserving existing scores.
Going forward sync_assignments writes the namespaced id directly. A re-sync is
required afterwards to populate criteria for assignments that previously collided.

Revision ID: 0021
Revises: 0020
Create Date: 2026-06-03
"""

from alembic import op


revision = "0021"
down_revision = "0020"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Drop the FK so we can rewrite ids on both sides, then restore it.
    op.drop_constraint("tracking_scores_rubric_criterion_id_fkey", "tracking_scores", type_="foreignkey")

    # Rewrite child references first (while rubric_criteria.id is still the bare id).
    op.execute(
        """
        UPDATE tracking_scores ts
        SET rubric_criterion_id = rc.assignment_id::text || ':' || rc.id
        FROM rubric_criteria rc
        WHERE ts.rubric_criterion_id = rc.id
        """
    )

    # Rewrite the criteria ids themselves.
    op.execute("UPDATE rubric_criteria SET id = assignment_id::text || ':' || id")

    op.create_foreign_key(
        "tracking_scores_rubric_criterion_id_fkey",
        "tracking_scores",
        "rubric_criteria",
        ["rubric_criterion_id"],
        ["id"],
    )


def downgrade() -> None:
    # Best-effort reverse: strip the "<assignment_id>:" prefix.
    op.drop_constraint("tracking_scores_rubric_criterion_id_fkey", "tracking_scores", type_="foreignkey")

    op.execute(
        """
        UPDATE tracking_scores
        SET rubric_criterion_id = split_part(rubric_criterion_id, ':', 2)
        WHERE rubric_criterion_id LIKE '%:%'
        """
    )
    op.execute(
        """
        UPDATE rubric_criteria
        SET id = split_part(id, ':', 2)
        WHERE id LIKE '%:%'
        """
    )

    op.create_foreign_key(
        "tracking_scores_rubric_criterion_id_fkey",
        "tracking_scores",
        "rubric_criteria",
        ["rubric_criterion_id"],
        ["id"],
    )
