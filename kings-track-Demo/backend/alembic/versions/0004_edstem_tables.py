"""Add EdStem tables (course mappings, lessons, lesson progress)

Revision ID: 0004
Revises: 0003
Create Date: 2026-03-26
"""
from alembic import op
import sqlalchemy as sa

revision = '0004'
down_revision = '0003'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'edstem_course_mappings',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('canvas_course_id', sa.BigInteger(), sa.ForeignKey('courses.id'), nullable=False, unique=True),
        sa.Column('edstem_course_id', sa.Integer(), nullable=False),
        sa.Column('edstem_course_name', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        'edstem_lessons',
        sa.Column('id', sa.Integer(), primary_key=True),  # EdStem lesson ID, not autoincrement
        sa.Column('edstem_course_id', sa.Integer(), nullable=False),
        sa.Column('title', sa.String(), nullable=False),
        sa.Column('module_id', sa.Integer(), nullable=True),
        sa.Column('module_name', sa.String(), nullable=True),
        sa.Column('lesson_type', sa.String(), nullable=True),
        sa.Column('is_interactive', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('slide_count', sa.Integer(), nullable=True),
        sa.Column('position', sa.Integer(), nullable=True),
        sa.Column('synced_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('ix_edstem_lessons_course_id', 'edstem_lessons', ['edstem_course_id'])

    op.create_table(
        'edstem_lesson_progress',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('edstem_course_id', sa.Integer(), nullable=False),
        sa.Column('edstem_lesson_id', sa.Integer(), sa.ForeignKey('edstem_lessons.id'), nullable=False),
        sa.Column('user_id', sa.BigInteger(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('status', sa.String(), nullable=False),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('synced_at', sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint('edstem_lesson_id', 'user_id', name='uq_edstem_lesson_progress'),
    )
    op.create_index('ix_edstem_lesson_progress_course_id', 'edstem_lesson_progress', ['edstem_course_id'])
    op.create_index('ix_edstem_lesson_progress_user_id', 'edstem_lesson_progress', ['user_id'])


def downgrade() -> None:
    op.drop_index('ix_edstem_lesson_progress_user_id', table_name='edstem_lesson_progress')
    op.drop_index('ix_edstem_lesson_progress_course_id', table_name='edstem_lesson_progress')
    op.drop_table('edstem_lesson_progress')
    op.drop_index('ix_edstem_lessons_course_id', table_name='edstem_lessons')
    op.drop_table('edstem_lessons')
    op.drop_table('edstem_course_mappings')
