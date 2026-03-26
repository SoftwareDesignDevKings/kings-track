"""Add app_users and course_whitelist tables

Revision ID: 0003
Revises: 0002
Create Date: 2026-03-26
"""
from alembic import op
import sqlalchemy as sa

revision = '0003'
down_revision = '0002'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'app_users',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('email', sa.Text(), nullable=False, unique=True),
        sa.Column('role', sa.Text(), nullable=False, server_default='teacher'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('ix_app_users_email', 'app_users', ['email'])

    op.create_table(
        'course_whitelist',
        sa.Column('course_id', sa.BigInteger(), sa.ForeignKey('courses.id'), primary_key=True),
        sa.Column('added_by', sa.Integer(), sa.ForeignKey('app_users.id'), nullable=True),
        sa.Column('added_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table('course_whitelist')
    op.drop_index('ix_app_users_email', table_name='app_users')
    op.drop_table('app_users')
