"""Store course name/code in whitelist, drop FK dependency on courses table

Revision ID: 0005
Revises: 0004
Create Date: 2026-03-26
"""
from alembic import op
import sqlalchemy as sa

revision = '0005'
down_revision = '0004'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('course_whitelist', sa.Column('name', sa.Text(), nullable=True))
    op.add_column('course_whitelist', sa.Column('course_code', sa.Text(), nullable=True))
    op.drop_constraint('course_whitelist_course_id_fkey', 'course_whitelist', type_='foreignkey')


def downgrade() -> None:
    op.create_foreign_key(
        'course_whitelist_course_id_fkey', 'course_whitelist', 'courses', ['course_id'], ['id']
    )
    op.drop_column('course_whitelist', 'course_code')
    op.drop_column('course_whitelist', 'name')
