"""Allow multiple EdStem courses per Canvas course

The original schema had a UNIQUE constraint on canvas_course_id alone,
which prevented mapping one Canvas course to multiple EdStem courses.
This migration replaces it with a composite unique constraint on
(canvas_course_id, edstem_course_id).

Revision ID: 0015
Revises: 0014
Create Date: 2026-05-21
"""
from alembic import op
from sqlalchemy import text


revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None


def _find_unique_constraint(conn, table, columns):
    """Find the name of a unique constraint covering exactly the given columns."""
    row = conn.execute(
        text("""
            SELECT con.conname
            FROM pg_constraint con
            JOIN pg_class rel ON rel.oid = con.conrelid
            JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
            WHERE rel.relname = :table
              AND nsp.nspname = 'public'
              AND con.contype = 'u'
              AND (
                  SELECT array_agg(att.attname ORDER BY att.attnum)
                  FROM unnest(con.conkey) AS k(col)
                  JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = k.col
              ) = :columns
        """),
        {"table": table, "columns": columns},
    ).fetchone()
    return row[0] if row else None


def upgrade() -> None:
    conn = op.get_bind()

    # Drop any single-column unique on canvas_course_id (name varies by environment)
    old_name = _find_unique_constraint(conn, "edstem_course_mappings", ["canvas_course_id"])
    if old_name:
        op.drop_constraint(old_name, "edstem_course_mappings", type_="unique")

    # Create composite constraint if not already present
    existing = _find_unique_constraint(
        conn, "edstem_course_mappings", ["canvas_course_id", "edstem_course_id"]
    )
    if not existing:
        op.create_unique_constraint(
            "uq_edstem_mapping_canvas_edstem",
            "edstem_course_mappings",
            ["canvas_course_id", "edstem_course_id"],
        )


def downgrade() -> None:
    conn = op.get_bind()

    existing = _find_unique_constraint(
        conn, "edstem_course_mappings", ["canvas_course_id", "edstem_course_id"]
    )
    if existing:
        op.drop_constraint(existing, "edstem_course_mappings", type_="unique")

    old = _find_unique_constraint(conn, "edstem_course_mappings", ["canvas_course_id"])
    if not old:
        op.create_unique_constraint(
            "edstem_course_mappings_canvas_course_id_key",
            "edstem_course_mappings",
            ["canvas_course_id"],
        )
