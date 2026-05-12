"""Drop extension API key columns from app_users

Revision ID: 0012
Revises: 0011
Create Date: 2026-05-07
"""
from alembic import op
import sqlalchemy as sa

revision = '0012'
down_revision = '0011'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column('app_users', 'extension_api_key_last_used_at')
    op.drop_column('app_users', 'extension_api_key_created_at')
    op.drop_column('app_users', 'extension_api_key_hint')
    op.drop_column('app_users', 'extension_api_key_hash')


def downgrade() -> None:
    op.add_column('app_users', sa.Column('extension_api_key_hash', sa.Text(), nullable=True))
    op.add_column('app_users', sa.Column('extension_api_key_hint', sa.Text(), nullable=True))
    op.add_column('app_users', sa.Column('extension_api_key_created_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('app_users', sa.Column('extension_api_key_last_used_at', sa.DateTime(timezone=True), nullable=True))
