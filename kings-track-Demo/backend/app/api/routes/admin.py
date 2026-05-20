from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.canvas.client import CanvasClient
from app.edstem.client import EdStemClient
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
            SELECT cw.course_id, cw.name, cw.course_code, cw.added_at
            FROM course_whitelist cw
            ORDER BY cw.name
        """)
    )
    return [
        {"course_id": r[0], "name": r[1] or "", "course_code": r[2], "added_at": r[3].isoformat() if r[3] else None}
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
    name: str = ""
    course_code: str | None = None


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
    await db.execute(
        text("""
            INSERT INTO course_whitelist (course_id, name, course_code, added_by)
            VALUES (:course_id, :name, :course_code, :added_by)
            ON CONFLICT (course_id) DO UPDATE SET
                name = EXCLUDED.name,
                course_code = EXCLUDED.course_code
        """),
        {"course_id": body.course_id, "name": body.name, "course_code": body.course_code, "added_by": added_by},
    )
    await db.commit()

    # Auto-match to EdStem course by course_code if EdStem is configured and
    # no mapping already exists for this canvas course.
    edstem_matched: dict | None = None
    if settings.edstem_configured and body.course_code:
        existing = await db.execute(
            text("SELECT edstem_course_id FROM edstem_course_mappings WHERE canvas_course_id = :cid"),
            {"cid": body.course_id},
        )
        if not existing.fetchone():
            try:
                async with EdStemClient(settings.edstem_api_url, settings.edstem_api_token) as edstem:
                    ed_courses = await edstem.get_user_courses()
                match = next(
                    (item["course"] for item in ed_courses if item.get("course")
                     and item["course"].get("code", "").strip() == body.course_code.strip()),
                    None,
                )
                if match:
                    await db.execute(
                        text("""
                            INSERT INTO edstem_course_mappings (canvas_course_id, edstem_course_id, edstem_course_name)
                            VALUES (:canvas_course_id, :edstem_course_id, :edstem_course_name)
                            ON CONFLICT (canvas_course_id) DO NOTHING
                        """),
                        {
                            "canvas_course_id": body.course_id,
                            "edstem_course_id": match["id"],
                            "edstem_course_name": match.get("name", ""),
                        },
                    )
                    await db.commit()
                    edstem_matched = {"edstem_course_id": match["id"], "edstem_course_name": match.get("name", "")}
            except Exception:
                pass  # EdStem auto-match is best-effort; don't fail the whitelist add

    return {"course_id": body.course_id, "edstem_matched": edstem_matched}


@router.delete("/whitelist/{course_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_from_whitelist(course_id: int, db: AsyncSession = Depends(get_db)):
    await db.execute(
        text("DELETE FROM course_whitelist WHERE course_id = :course_id"), {"course_id": course_id}
    )
    await db.commit()


# ---------------------------------------------------------------------------
# EdStem course mapping management
# ---------------------------------------------------------------------------

class EdStemMappingIn(BaseModel):
    canvas_course_id: int
    edstem_course_id: int
    edstem_course_name: str = ""


@router.get("/edstem-mappings")
async def list_edstem_mappings(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        text("""
            SELECT m.canvas_course_id, c.name AS canvas_course_name,
                   m.edstem_course_id, m.edstem_course_name, m.created_at
            FROM edstem_course_mappings m
            JOIN courses c ON c.id = m.canvas_course_id
            ORDER BY c.name
        """)
    )
    return [
        {
            "canvas_course_id": r[0],
            "canvas_course_name": r[1],
            "edstem_course_id": r[2],
            "edstem_course_name": r[3],
            "created_at": r[4].isoformat() if r[4] else None,
        }
        for r in result.fetchall()
    ]


@router.get("/edstem-courses")
async def list_edstem_courses():
    """Fetch all courses from EdStem so admin can pick which to map."""
    if not settings.edstem_configured:
        raise HTTPException(status_code=503, detail="EdStem API not configured")
    async with EdStemClient(settings.edstem_api_url, settings.edstem_api_token) as edstem:
        courses_data = await edstem.get_user_courses()
    return [
        {
            "id": c["course"]["id"],
            "name": c["course"].get("name", ""),
            "code": c["course"].get("code", ""),
        }
        for c in sorted(courses_data, key=lambda c: c["course"].get("name", ""))
        if c.get("course")
    ]


@router.post("/edstem-mappings/auto-match")
async def auto_match_edstem_mappings(db: AsyncSession = Depends(get_db)):
    """Match all whitelisted courses without an EdStem mapping by course_code."""
    if not settings.edstem_configured:
        raise HTTPException(status_code=503, detail="EdStem API not configured")

    # Whitelisted courses with a course_code that have no existing mapping
    result = await db.execute(text("""
        SELECT cw.course_id, cw.course_code
        FROM course_whitelist cw
        LEFT JOIN edstem_course_mappings em ON em.canvas_course_id = cw.course_id
        WHERE cw.course_code IS NOT NULL AND em.canvas_course_id IS NULL
    """))
    unmatched = result.fetchall()

    if not unmatched:
        return {"matched": [], "unmatched": []}

    async with EdStemClient(settings.edstem_api_url, settings.edstem_api_token) as edstem:
        ed_courses = await edstem.get_user_courses()

    ed_by_code = {
        item["course"]["code"].strip(): item["course"]
        for item in ed_courses
        if item.get("course") and item["course"].get("code")
    }

    matched = []
    unmatched_codes = []
    for canvas_course_id, course_code in unmatched:
        ed_course = ed_by_code.get(course_code.strip())
        if ed_course:
            await db.execute(
                text("""
                    INSERT INTO edstem_course_mappings (canvas_course_id, edstem_course_id, edstem_course_name)
                    VALUES (:canvas_course_id, :edstem_course_id, :edstem_course_name)
                    ON CONFLICT (canvas_course_id) DO NOTHING
                """),
                {
                    "canvas_course_id": canvas_course_id,
                    "edstem_course_id": ed_course["id"],
                    "edstem_course_name": ed_course.get("name", ""),
                },
            )
            matched.append({"canvas_course_id": canvas_course_id, "course_code": course_code, "edstem_course_id": ed_course["id"], "edstem_course_name": ed_course.get("name", "")})
        else:
            unmatched_codes.append(course_code)

    await db.commit()
    return {"matched": matched, "unmatched": unmatched_codes}


@router.post("/edstem-mappings", status_code=status.HTTP_201_CREATED)
async def create_edstem_mapping(body: EdStemMappingIn, db: AsyncSession = Depends(get_db)):
    await db.execute(
        text("""
            INSERT INTO edstem_course_mappings (canvas_course_id, edstem_course_id, edstem_course_name)
            VALUES (:canvas_course_id, :edstem_course_id, :edstem_course_name)
            ON CONFLICT (canvas_course_id) DO UPDATE SET
                edstem_course_id = EXCLUDED.edstem_course_id,
                edstem_course_name = EXCLUDED.edstem_course_name
        """),
        {
            "canvas_course_id": body.canvas_course_id,
            "edstem_course_id": body.edstem_course_id,
            "edstem_course_name": body.edstem_course_name,
        },
    )
    await db.commit()
    return {
        "canvas_course_id": body.canvas_course_id,
        "edstem_course_id": body.edstem_course_id,
        "edstem_course_name": body.edstem_course_name,
    }


@router.delete("/edstem-mappings/{canvas_course_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_edstem_mapping(canvas_course_id: int, db: AsyncSession = Depends(get_db)):
    await db.execute(
        text("DELETE FROM edstem_course_mappings WHERE canvas_course_id = :cid"),
        {"cid": canvas_course_id},
    )
    await db.commit()
