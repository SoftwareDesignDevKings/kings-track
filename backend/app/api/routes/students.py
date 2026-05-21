"""Student API routes — list, search, and full profile."""
import logging
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.api.deps import require_auth
from app.attendance.service import get_student_profile, get_all_students_with_stats, get_student_learning_overview, get_student_academic_breakdown

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/students",
    tags=["students"],
    dependencies=[Depends(require_auth)],
)


@router.get("")
async def list_students(db: AsyncSession = Depends(get_db)):
    """List all enrolled students with aggregated metrics and concern flags."""
    return await get_all_students_with_stats(db)


@router.get("/{user_id}/profile")
async def student_profile(user_id: int, db: AsyncSession = Depends(get_db)):
    """Full cross-course student profile with academics, attendance, and concern flagging."""
    profile = await get_student_profile(db, user_id)
    if not profile:
        raise HTTPException(status_code=404, detail="Student not found")
    return profile


@router.get("/{user_id}/learning-overview")
async def student_learning_overview(user_id: int, db: AsyncSession = Depends(get_db)):
    """Per-platform learning breakdowns: Canvas groups, EdStem modules, Gradeo exams."""
    return await get_student_learning_overview(db, user_id)


@router.get("/{user_id}/academic-breakdown")
async def student_academic_breakdown(user_id: int, db: AsyncSession = Depends(get_db)):
    """Per-assignment academic progression grouped by syllabus unit."""
    return await get_student_academic_breakdown(db, user_id)
