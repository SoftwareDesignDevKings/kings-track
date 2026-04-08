from __future__ import annotations

import logging
from datetime import datetime, timezone
from pathlib import Path
import re

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_admin
from app.db import get_db
from app.gradeo.importer import (
    cleanup_invalid_gradeo_classes,
    get_student_directory_status,
    import_class_batch,
    preflight_class_import,
    refresh_discovered_classes,
    refresh_student_directory,
    upsert_gradeo_class,
)
from app.gradeo.matcher import find_course_candidates, get_whitelisted_courses, unique_course_candidate
from app.gradeo.source import extension_source_adapter

router = APIRouter(prefix="/admin/gradeo", tags=["gradeo-admin"], dependencies=[Depends(require_admin)])
logger = logging.getLogger("app.gradeo.extension")
SNAPSHOT_DIR = Path("/app/debug_snapshots/gradeo")


def _to_iso(value):
    if value is None:
        return None
    return value.isoformat() if hasattr(value, "isoformat") else str(value)


class GradeoDirectoryStudentIn(BaseModel):
    gradeo_student_id: str
    name: str
    email: EmailStr


class GradeoDirectoryRefreshIn(BaseModel):
    extension_version: str | None = None
    students: list[GradeoDirectoryStudentIn]


class GradeoDiscoveredClassIn(BaseModel):
    gradeo_class_id: str
    name: str
    syllabus_title: str | None = None
    syllabuses: list[dict] = []
    teacher_count: int | None = None
    student_count: int | None = None


class GradeoClassDiscoveryIn(BaseModel):
    extension_version: str | None = None
    classes: list[GradeoDiscoveredClassIn]


class GradeoMappingIn(BaseModel):
    canvas_course_id: int
    gradeo_class_id: str
    gradeo_class_name: str


class GradeoImportQuestionRowIn(BaseModel):
    exam_name: str
    gradeo_exam_id: str
    gradeo_exam_session_id: str | None = None
    gradeo_marking_session_id: str | None = None
    gradeo_class_id: str | None = None
    class_name: str | None = None
    class_average: float | str | None = None
    syllabus_id: str | None = None
    question: str | None = None
    gradeo_question_id: str | None = None
    question_part: str | None = None
    gradeo_question_part_id: str
    question_link: str | None = None
    mark: float | str | None = None
    marks_available: float | str | None = None
    answer_submitted: bool | str = False
    feedback: str | None = None
    marker_name: str | None = None
    marker_id: str | None = None
    marking_session_link: str | None = None
    exam_mark: float | str | None = None
    syllabus_title: str | None = None
    syllabus_grade: str | None = None
    bands: list[str] | str | None = None
    outcomes: list[str] | str | None = None
    topics: list[str] | str | None = None
    copyright_notice: str | None = None


class GradeoImportExamRowIn(BaseModel):
    exam_name: str
    gradeo_exam_id: str
    gradeo_exam_session_id: str | None = None
    gradeo_marking_session_id: str | None = None
    gradeo_class_id: str | None = None
    class_name: str | None = None
    class_average: float | str | None = None
    exam_mark: float | str | None = None
    marks_available: float | str | None = None
    status: str | None = None
    answer_submitted: bool | str = False
    syllabus_id: str | None = None
    syllabus_title: str | None = None
    syllabus_grade: str | None = None
    bands: list[str] | str | None = None
    outcomes: list[str] | str | None = None
    topics: list[str] | str | None = None
    marking_session_id: str | None = None
    exam_answer_sheet_id: str | None = None
    exam_session_start_date: str | None = None
    exam_session_max_time_seconds: float | str | None = None
    student_group_mark_average: float | str | None = None


class GradeoImportStudentIn(BaseModel):
    gradeo_student_id: str
    student_name: str
    rows: list[GradeoImportQuestionRowIn] = []
    exam_rows: list[GradeoImportExamRowIn] = []


class GradeoImportPreflightIn(BaseModel):
    gradeo_class_id: str
    gradeo_class_name: str


class GradeoImportBatchIn(GradeoImportPreflightIn):
    extension_version: str | None = None
    students: list[GradeoImportStudentIn]


class GradeoExtensionLogIn(BaseModel):
    timestamp: str | None = None
    scope: str
    event: str
    details: dict | None = None


class GradeoExtensionSnapshotIn(BaseModel):
    page: str
    title: str | None = None
    scope: str
    reason: str
    html: str
    metadata: dict | None = None


@router.get("/student-directory")
async def get_gradeo_student_directory_status(db: AsyncSession = Depends(get_db)):
    status_data = await get_student_directory_status(db)
    return {
        "last_synced_at": _to_iso(status_data["last_synced_at"]),
        "matched_students": status_data["matched_students"],
        "stale": status_data["stale"],
    }


@router.post("/student-directory", status_code=status.HTTP_201_CREATED)
async def post_gradeo_student_directory(
    body: GradeoDirectoryRefreshIn,
    user: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    logger.info(
        "student_directory_payload user=%s count=%s sample=%s",
        user["email"],
        len(body.students),
        [
            {
                "gradeo_student_id": student.gradeo_student_id,
                "name": student.name,
                "email": student.email,
            }
            for student in body.students[:5]
        ],
    )
    summary = await refresh_student_directory(
        db,
        students=[student.model_dump() for student in body.students],
        triggered_by=user["email"],
        extension_version=body.extension_version,
    )
    await db.commit()
    return {
        **summary,
        "last_synced_at": _to_iso(summary["last_synced_at"]),
    }


@router.post("/extension-log", status_code=status.HTTP_202_ACCEPTED)
async def ingest_gradeo_extension_log(
    body: GradeoExtensionLogIn,
    user: dict = Depends(require_admin),
):
    logger.info(
        "extension_log scope=%s event=%s user=%s timestamp=%s details=%s",
        body.scope,
        body.event,
        user["email"],
        body.timestamp,
        body.details or {},
    )
    return {"accepted": True}


@router.post("/extension-snapshot", status_code=status.HTTP_201_CREATED)
async def ingest_gradeo_extension_snapshot(
    body: GradeoExtensionSnapshotIn,
    user: dict = Depends(require_admin),
):
    SNAPSHOT_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    slug = re.sub(r"[^a-zA-Z0-9_-]+", "-", f"{body.scope}-{body.reason}").strip("-").lower() or "snapshot"
    filename = f"{timestamp}-{slug}.html"
    path = SNAPSHOT_DIR / filename
    path.write_text(body.html, encoding="utf-8")

    logger.info(
        "extension_snapshot scope=%s reason=%s user=%s page=%s path=%s metadata=%s",
        body.scope,
        body.reason,
        user["email"],
        body.page,
        str(path),
        body.metadata or {},
    )
    return {
        "saved": True,
        "path": str(path),
        "filename": filename,
    }


@router.get("/classes")
async def list_gradeo_classes(db: AsyncSession = Depends(get_db)):
    await cleanup_invalid_gradeo_classes(db)
    await db.commit()
    result = await db.execute(
        text(
            """
            SELECT
                gc.gradeo_class_id,
                gc.name,
                gc.discovered_at,
                gc.last_seen_at,
                gcm.canvas_course_id,
                cw.name AS canvas_course_name,
                cw.course_code AS canvas_course_code,
                (
                    SELECT MAX(gir.completed_at)
                    FROM gradeo_import_runs gir
                    WHERE gir.run_type = 'class_import'
                      AND gir.status = 'completed'
                      AND gir.gradeo_class_id = gc.gradeo_class_id
                ) AS last_imported_at
            FROM gradeo_classes gc
            LEFT JOIN gradeo_class_mappings gcm ON gcm.gradeo_class_id = gc.gradeo_class_id
            LEFT JOIN course_whitelist cw ON cw.course_id = gcm.canvas_course_id
            ORDER BY gc.name
            """
        )
    )
    classes = result.fetchall()
    courses = await get_whitelisted_courses(db)

    return [
        {
            "gradeo_class_id": row[0],
            "name": row[1],
            "discovered_at": _to_iso(row[2]),
            "last_seen_at": _to_iso(row[3]),
            "canvas_course_id": row[4],
            "canvas_course_name": row[5],
            "canvas_course_code": row[6],
            "last_imported_at": _to_iso(row[7]),
            "suggested_course": unique_course_candidate(row[1], courses),
            "candidate_courses": find_course_candidates(row[1], courses),
        }
        for row in classes
    ]


@router.post("/classes", status_code=status.HTTP_201_CREATED)
async def post_gradeo_classes(
    body: GradeoClassDiscoveryIn,
    user: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    logger.info(
        "class_directory_payload user=%s count=%s sample=%s",
        user["email"],
        len(body.classes),
        [
            {
                "gradeo_class_id": gradeo_class.gradeo_class_id,
                "name": gradeo_class.name,
                "syllabus_title": gradeo_class.syllabus_title,
                "syllabuses": gradeo_class.syllabuses,
                "teacher_count": gradeo_class.teacher_count,
                "student_count": gradeo_class.student_count,
            }
            for gradeo_class in body.classes[:5]
        ],
    )
    summary = await refresh_discovered_classes(
        db,
        classes=[gradeo_class.model_dump() for gradeo_class in body.classes],
        triggered_by=user["email"],
        extension_version=body.extension_version,
    )
    await db.commit()
    return {
        **summary,
        "last_synced_at": _to_iso(summary["last_synced_at"]),
    }


@router.get("/mappings")
async def list_gradeo_mappings(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        text(
            """
            SELECT
                gcm.canvas_course_id,
                cw.name AS canvas_course_name,
                cw.course_code AS canvas_course_code,
                gcm.gradeo_class_id,
                gcm.gradeo_class_name,
                gcm.created_at
            FROM gradeo_class_mappings gcm
            JOIN course_whitelist cw ON cw.course_id = gcm.canvas_course_id
            ORDER BY cw.name
            """
        )
    )
    return [
        {
            "canvas_course_id": row[0],
            "canvas_course_name": row[1],
            "canvas_course_code": row[2],
            "gradeo_class_id": row[3],
            "gradeo_class_name": row[4],
            "created_at": _to_iso(row[5]),
        }
        for row in result.fetchall()
    ]


@router.post("/mappings", status_code=status.HTTP_201_CREATED)
async def create_gradeo_mapping(body: GradeoMappingIn, db: AsyncSession = Depends(get_db)):
    whitelist_result = await db.execute(
        text("SELECT 1 FROM course_whitelist WHERE course_id = :course_id"),
        {"course_id": body.canvas_course_id},
    )
    if not whitelist_result.fetchone():
        raise HTTPException(status_code=400, detail="Canvas course must be whitelisted before linking Gradeo")

    try:
        await upsert_gradeo_class(db, body.gradeo_class_id, body.gradeo_class_name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    await db.execute(
        text(
            """
            DELETE FROM gradeo_class_mappings
            WHERE canvas_course_id = :canvas_course_id OR gradeo_class_id = :gradeo_class_id
            """
        ),
        {
            "canvas_course_id": body.canvas_course_id,
            "gradeo_class_id": body.gradeo_class_id,
        },
    )
    await db.execute(
        text(
            """
            INSERT INTO gradeo_class_mappings (canvas_course_id, gradeo_class_id, gradeo_class_name, created_at)
            VALUES (:canvas_course_id, :gradeo_class_id, :gradeo_class_name, NOW())
            """
        ),
        body.model_dump(),
    )
    await db.commit()
    return body.model_dump()


@router.delete("/mappings/{canvas_course_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_gradeo_mapping(canvas_course_id: int, db: AsyncSession = Depends(get_db)):
    await db.execute(
        text("DELETE FROM gradeo_class_mappings WHERE canvas_course_id = :canvas_course_id"),
        {"canvas_course_id": canvas_course_id},
    )
    await db.commit()


@router.post("/mappings/auto-match")
async def auto_match_gradeo_mappings(db: AsyncSession = Depends(get_db)):
    await cleanup_invalid_gradeo_classes(db)
    await db.commit()
    class_rows = await db.execute(
        text(
            """
            SELECT gc.gradeo_class_id, gc.name
            FROM gradeo_classes gc
            LEFT JOIN gradeo_class_mappings gcm ON gcm.gradeo_class_id = gc.gradeo_class_id
            WHERE gcm.gradeo_class_id IS NULL
            ORDER BY gc.name
            """
        )
    )
    courses = await get_whitelisted_courses(db)
    existing_mapping_rows = await db.execute(text("SELECT canvas_course_id FROM gradeo_class_mappings"))
    occupied_canvas_course_ids = {row[0] for row in existing_mapping_rows.fetchall()}
    matched: list[dict] = []
    unmatched: list[dict] = []

    for gradeo_class_id, gradeo_class_name in class_rows.fetchall():
        candidate = unique_course_candidate(gradeo_class_name, courses)
        if not candidate or candidate["course_id"] in occupied_canvas_course_ids:
            unmatched.append(
                {
                    "gradeo_class_id": gradeo_class_id,
                    "gradeo_class_name": gradeo_class_name,
                    "candidate_courses": find_course_candidates(gradeo_class_name, courses),
                }
            )
            continue

        await db.execute(
            text(
                """
                INSERT INTO gradeo_class_mappings (canvas_course_id, gradeo_class_id, gradeo_class_name, created_at)
                VALUES (:canvas_course_id, :gradeo_class_id, :gradeo_class_name, NOW())
                ON CONFLICT (canvas_course_id) DO UPDATE SET
                    gradeo_class_id = EXCLUDED.gradeo_class_id,
                    gradeo_class_name = EXCLUDED.gradeo_class_name
                """
            ),
            {
                "canvas_course_id": candidate["course_id"],
                "gradeo_class_id": gradeo_class_id,
                "gradeo_class_name": gradeo_class_name,
            },
        )
        matched.append(
            {
                "canvas_course_id": candidate["course_id"],
                "canvas_course_name": candidate["name"],
                "gradeo_class_id": gradeo_class_id,
                "gradeo_class_name": gradeo_class_name,
            }
        )
        occupied_canvas_course_ids.add(candidate["course_id"])

    await db.commit()
    return {"matched": matched, "unmatched": unmatched}


@router.post("/imports/preflight")
async def preflight_gradeo_import(body: GradeoImportPreflightIn, db: AsyncSession = Depends(get_db)):
    try:
        preflight = await preflight_class_import(
            db,
            gradeo_class_id=body.gradeo_class_id,
            gradeo_class_name=body.gradeo_class_name,
        )
    except ValueError as exc:
        await db.rollback()
        raise HTTPException(status_code=400, detail=str(exc))
    await db.commit()
    return {
        **preflight,
        "student_directory_last_synced_at": _to_iso(preflight["student_directory_last_synced_at"]),
    }


@router.post("/imports", status_code=status.HTTP_201_CREATED)
async def create_gradeo_import(
    body: GradeoImportBatchIn,
    user: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    batch = extension_source_adapter.to_import_batch(
        gradeo_class_id=body.gradeo_class_id,
        gradeo_class_name=body.gradeo_class_name,
        extension_version=body.extension_version,
        students=[student.model_dump() for student in body.students],
    )
    try:
        summary = await import_class_batch(db, batch=batch, triggered_by=user["email"])
    except ValueError as exc:
        await db.rollback()
        raise HTTPException(status_code=400, detail=str(exc))
    await db.commit()
    return summary


@router.get("/import-runs")
async def list_gradeo_import_runs(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        text(
            """
            SELECT
                id,
                run_type,
                status,
                canvas_course_id,
                gradeo_class_id,
                gradeo_class_name,
                triggered_by,
                source_type,
                extension_version,
                processed_students,
                matched_students,
                imported_exams,
                imported_question_results,
                unmatched_students,
                skipped_students,
                started_at,
                completed_at,
                error_message
            FROM gradeo_import_runs
            ORDER BY id DESC
            LIMIT 20
            """
        )
    )
    return [
        {
            "id": row[0],
            "run_type": row[1],
            "status": row[2],
            "canvas_course_id": row[3],
            "gradeo_class_id": row[4],
            "gradeo_class_name": row[5],
            "triggered_by": row[6],
            "source_type": row[7],
            "extension_version": row[8],
            "processed_students": row[9],
            "matched_students": row[10],
            "imported_exams": row[11],
            "imported_question_results": row[12],
            "unmatched_students": row[13],
            "skipped_students": row[14],
            "started_at": _to_iso(row[15]),
            "completed_at": _to_iso(row[16]),
            "error_message": row[17],
        }
        for row in result.fetchall()
    ]
