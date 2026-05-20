"""Add meetings and attendance_records tables for Teams attendance tracking

Revision ID: 0013
Revises: 0012
Create Date: 2026-05-08
"""
from alembic import op
import sqlalchemy as sa

revision = '0013'
down_revision = '0012'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'meetings',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('teams_meeting_id', sa.String(255), nullable=False),
        sa.Column('title', sa.String(500), nullable=True),
        sa.Column('start_time', sa.DateTime(timezone=True), nullable=False),
        sa.Column('end_time', sa.DateTime(timezone=True), nullable=False),
        sa.Column('organizer_email', sa.String(255), nullable=True),
        sa.Column('class_code', sa.String(50), nullable=True),
        sa.Column('course_id', sa.BigInteger(), sa.ForeignKey('courses.id'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('teams_meeting_id'),
    )
    op.create_index('ix_meetings_class_code', 'meetings', ['class_code'])
    op.create_index('ix_meetings_course_id', 'meetings', ['course_id'])
    op.create_index('ix_meetings_start_time', 'meetings', ['start_time'])

    op.create_table(
        'attendance_records',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('meeting_id', sa.Integer(), sa.ForeignKey('meetings.id', ondelete='CASCADE'), nullable=False),
        sa.Column('user_id', sa.BigInteger(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('join_time', sa.DateTime(timezone=True), nullable=False),
        sa.Column('leave_time', sa.DateTime(timezone=True), nullable=True),
        sa.Column('duration_minutes', sa.Integer(), nullable=True),
        sa.Column('status', sa.String(20), server_default='present'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('meeting_id', 'user_id', 'join_time', name='uq_attendance_record'),
    )
    op.create_index('ix_attendance_records_meeting_id', 'attendance_records', ['meeting_id'])
    op.create_index('ix_attendance_records_user_id', 'attendance_records', ['user_id'])
    op.create_index('ix_attendance_records_status', 'attendance_records', ['status'])


def downgrade() -> None:
    op.drop_table('attendance_records')
    op.drop_table('meetings')
