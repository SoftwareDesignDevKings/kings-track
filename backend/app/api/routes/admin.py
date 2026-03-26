from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.canvas.client import CanvasClient
from app.config import settings
from app.db import get_db
from app.api.deps import require_admin

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])


# ---------------------------------------------------------------------------
# User management
# ---------------------------------------------------------------------------

class UserIn(BaseModel):
    email: EmailStr
    role: str = "teacher"


@router.get("/users")
async def list_users(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        text("SELECT id, email, role, created_at FROM app_users ORDER BY created_at")
    )
    return [
        {"id": r[0], "email": r[1], "role": r[2], "created_at": r[3].isoformat() if r[3] else None}
        for r in result.fetchall()
    ]


@router.post("/users", status_code=status.HTTP_201_CREATED)
async def add_user(body: UserIn, db: AsyncSession = Depends(get_db)):
    if body.role not in ("admin", "teacher"):
        raise HTTPException(status_code=400, detail="role must be 'admin' or 'teacher'")
    try:
        await db.execute(
            text("INSERT INTO app_users (email, role) VALUES (:email, :role)"),
            {"email": body.email, "role": body.role},
        )
        await db.commit()
    except Exception:
        await db.rollback()
        raise HTTPException(status_code=409, detail="User already exists")
    return {"email": body.email, "role": body.role}


@router.delete("/users/{email}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_user(email: str, db: AsyncSession = Depends(get_db)):
    await db.execute(text("DELETE FROM app_users WHERE email = :email"), {"email": email})
    await db.commit()


# ---------------------------------------------------------------------------
# Course whitelist management
# ---------------------------------------------------------------------------

@router.get("/whitelist")
async def list_whitelist(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        text("""
            SELECT cw.course_id, c.name, c.course_code, cw.added_at
            FROM course_whitelist cw
            JOIN courses c ON c.id = cw.course_id
            ORDER BY c.name
        """)
    )
    return [
        {"course_id": r[0], "name": r[1], "course_code": r[2], "added_at": r[3].isoformat() if r[3] else None}
        for r in result.fetchall()
    ]


@router.get("/whitelist/available")
async def list_available_courses():
    """Fetch all courses directly from Canvas so admin can pick which to whitelist."""
    if not settings.canvas_configured:
        raise HTTPException(status_code=503, detail="Canvas API not configured")
    async with CanvasClient(settings.canvas_api_url, settings.canvas_api_token) as canvas:
        courses = await canvas.list_courses()
    return [
        {"id": c["id"], "name": c.get("name", ""), "course_code": c.get("course_code")}
        for c in sorted(courses, key=lambda c: c.get("name", ""))
    ]


class WhitelistIn(BaseModel):
    course_id: int


@router.post("/whitelist", status_code=status.HTTP_201_CREATED)
async def add_to_whitelist(
    body: WhitelistIn,
    user: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    added_by_result = await db.execute(
        text("SELECT id FROM app_users WHERE email = :email"), {"email": user["email"]}
    )
    added_by = added_by_result.scalar()
    try:
        await db.execute(
            text("INSERT INTO course_whitelist (course_id, added_by) VALUES (:course_id, :added_by)"),
            {"course_id": body.course_id, "added_by": added_by},
        )
        await db.commit()
    except Exception:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Course already in whitelist")
    return {"course_id": body.course_id}


@router.delete("/whitelist/{course_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_from_whitelist(course_id: int, db: AsyncSession = Depends(get_db)):
    await db.execute(
        text("DELETE FROM course_whitelist WHERE course_id = :course_id"), {"course_id": course_id}
    )
    await db.commit()
