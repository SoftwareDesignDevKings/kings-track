"""Add extension API key columns to app_users

Revision ID: 0008
Revises: 0007
Create Date: 2026-04-08
"""
from alembic import op
import sqlalchemy as sa

revision = '0008'
down_revision = '0007'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('app_users', sa.Column('extension_api_key_hash', sa.Text(), nullable=True))
    op.add_column('app_users', sa.Column('extension_api_key_hint', sa.Text(), nullable=True))
    op.add_column('app_users', sa.Column('extension_api_key_created_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('app_users', sa.Column('extension_api_key_last_used_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column('app_users', 'extension_api_key_last_used_at')
    op.drop_column('app_users', 'extension_api_key_created_at')
    op.drop_column('app_users', 'extension_api_key_hint')
    op.drop_column('app_users', 'extension_api_key_hash')
