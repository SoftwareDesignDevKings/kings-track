from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_auth
from app.db import get_db

router = APIRouter(prefix="/courses/{course_id}/tracking", tags=["tracking"], dependencies=[Depends(require_auth)])


@router.get("/assignments")
async def list_trackable_assignments(course_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        text("""
            SELECT a.id, a.name, COUNT(rc.id) AS criteria_count
            FROM assignments a
            JOIN rubric_criteria rc ON rc.assignment_id = a.id
            WHERE a.course_id = :course_id AND a.workflow_state = 'published'
            GROUP BY a.id, a.name
            ORDER BY a.name
        """),
        {"course_id": course_id},
    )
    return [{"id": row[0], "name": row[1], "criteria_count": row[2]} for row in result.fetchall()]


@router.get("/{assignment_id}")
async def get_tracking_grid(
    course_id: int,
    assignment_id: int,
    db: AsyncSession = Depends(get_db),
):
    assignment_row = await db.execute(
        text("SELECT id, name FROM assignments WHERE id = :id AND course_id = :course_id"),
        {"id": assignment_id, "course_id": course_id},
    )
    assignment = assignment_row.fetchone()
    if not assignment:
        raise HTTPException(404, "Assignment not found")

    criteria_rows = await db.execute(
        text("""
            SELECT id, description, long_description, points, position
            FROM rubric_criteria
            WHERE assignment_id = :assignment_id
            ORDER BY position
        """),
        {"assignment_id": assignment_id},
    )
    criteria = [
        {"id": r[0], "description": r[1], "long_description": r[2], "points": r[3], "position": r[4]}
        for r in criteria_rows.fetchall()
    ]

    student_rows = await db.execute(
        text("""
            SELECT u.id, u.name, u.sortable_name
            FROM users u
            JOIN enrollments e ON e.user_id = u.id
            WHERE e.course_id = :course_id AND e.role = 'StudentEnrollment' AND e.enrollment_state = 'active'
            ORDER BY u.sortable_name, u.name
        """),
        {"course_id": course_id},
    )
    students = [{"id": r[0], "name": r[1], "sortable_name": r[2]} for r in student_rows.fetchall()]

    draft_snapshot = None
    draft_row = await db.execute(
        text("SELECT id, created_at, label FROM tracking_snapshots WHERE assignment_id = :aid AND committed_at IS NULL"),
        {"aid": assignment_id},
    )
    draft = draft_row.fetchone()
    if draft:
        score_rows = await db.execute(
            text("SELECT user_id, rubric_criterion_id, score, comment FROM tracking_scores WHERE snapshot_id = :sid"),
            {"sid": draft[0]},
        )
        scores: dict[str, dict[str, dict]] = {}
        for sr in score_rows.fetchall():
            uid = str(sr[0])
            cid = str(sr[1])
            scores.setdefault(uid, {})[cid] = {"score": sr[2], "comment": sr[3]}
        draft_snapshot = {"id": draft[0], "created_at": draft[1].isoformat(), "label": draft[2], "scores": scores}

    committed_rows = await db.execute(
        text("""
            SELECT id, committed_at, label
            FROM tracking_snapshots
            WHERE assignment_id = :aid AND committed_at IS NOT NULL
            ORDER BY committed_at DESC
        """),
        {"aid": assignment_id},
    )
    committed_snapshots = [
        {"id": r[0], "committed_at": r[1].isoformat(), "label": r[2]}
        for r in committed_rows.fetchall()
    ]

    return {
        "assignment": {"id": assignment[0], "name": assignment[1]},
        "criteria": criteria,
        "students": students,
        "draft_snapshot": draft_snapshot,
        "committed_snapshots": committed_snapshots,
    }


class ScoreEntry(BaseModel):
    user_id: int
    criterion_id: str
    score: int | None = None
    comment: str | None = None


class SaveScoresRequest(BaseModel):
    scores: list[ScoreEntry]


@router.post("/{assignment_id}/scores")
async def save_scores(
    course_id: int,
    assignment_id: int,
    body: SaveScoresRequest,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_auth),
):
    for entry in body.scores:
        if entry.score is not None and (entry.score < 0 or entry.score > 3):
            raise HTTPException(400, f"Score must be 0-3, got {entry.score}")

    draft_row = await db.execute(
        text("SELECT id FROM tracking_snapshots WHERE assignment_id = :aid AND committed_at IS NULL"),
        {"aid": assignment_id},
    )
    draft = draft_row.fetchone()

    if draft:
        snapshot_id = draft[0]
    else:
        now = datetime.now(timezone.utc)
        result = await db.execute(
            text("""
                INSERT INTO tracking_snapshots (assignment_id, created_by_email, created_at)
                VALUES (:aid, :email, :now)
                RETURNING id
            """),
            {"aid": assignment_id, "email": user["email"], "now": now},
        )
        snapshot_id = result.fetchone()[0]

    for entry in body.scores:
        comment = entry.comment.strip() if entry.comment and entry.comment.strip() else None
        # A cell with neither a score nor a comment is empty — remove the row entirely.
        if entry.score is None and comment is None:
            await db.execute(
                text("""
                    DELETE FROM tracking_scores
                    WHERE snapshot_id = :sid AND user_id = :uid AND rubric_criterion_id = :cid
                """),
                {"sid": snapshot_id, "uid": entry.user_id, "cid": entry.criterion_id},
            )
            continue
        await db.execute(
            text("""
                INSERT INTO tracking_scores (snapshot_id, user_id, rubric_criterion_id, score, comment)
                VALUES (:sid, :uid, :cid, :score, :comment)
                ON CONFLICT (snapshot_id, user_id, rubric_criterion_id)
                DO UPDATE SET score = EXCLUDED.score, comment = EXCLUDED.comment
            """),
            {"sid": snapshot_id, "uid": entry.user_id, "cid": entry.criterion_id, "score": entry.score, "comment": comment},
        )

    await db.commit()
    return {"snapshot_id": snapshot_id, "saved": len(body.scores)}


class CommitRequest(BaseModel):
    label: str | None = None


@router.post("/{assignment_id}/commit")
async def commit_snapshot(
    course_id: int,
    assignment_id: int,
    body: CommitRequest,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_auth),
):
    draft_row = await db.execute(
        text("SELECT id FROM tracking_snapshots WHERE assignment_id = :aid AND committed_at IS NULL"),
        {"aid": assignment_id},
    )
    draft = draft_row.fetchone()
    if not draft:
        raise HTTPException(404, "No draft snapshot to commit")

    now = datetime.now(timezone.utc)
    committed_id = draft[0]
    await db.execute(
        text("UPDATE tracking_snapshots SET committed_at = :now, label = :label WHERE id = :id"),
        {"now": now, "label": body.label, "id": committed_id},
    )

    # Recording a snapshot freezes a point-in-time copy but the teacher keeps working,
    # so seed a fresh draft pre-populated with the just-committed scores to carry forward.
    new_draft_result = await db.execute(
        text("""
            INSERT INTO tracking_snapshots (assignment_id, created_by_email, created_at)
            VALUES (:aid, :email, :now)
            RETURNING id
        """),
        {"aid": assignment_id, "email": user["email"], "now": now},
    )
    new_draft_id = new_draft_result.fetchone()[0]
    await db.execute(
        text("""
            INSERT INTO tracking_scores (snapshot_id, user_id, rubric_criterion_id, score, comment)
            SELECT :new_draft_id, user_id, rubric_criterion_id, score, comment
            FROM tracking_scores
            WHERE snapshot_id = :committed_id
        """),
        {"new_draft_id": new_draft_id, "committed_id": committed_id},
    )

    await db.commit()
    return {"id": committed_id, "committed_at": now.isoformat(), "label": body.label}


@router.get("/{assignment_id}/snapshots/{snapshot_id}")
async def get_snapshot(
    course_id: int,
    assignment_id: int,
    snapshot_id: int,
    db: AsyncSession = Depends(get_db),
):
    snap_row = await db.execute(
        text("SELECT id, committed_at, label FROM tracking_snapshots WHERE id = :id AND assignment_id = :aid"),
        {"id": snapshot_id, "aid": assignment_id},
    )
    snap = snap_row.fetchone()
    if not snap:
        raise HTTPException(404, "Snapshot not found")

    score_rows = await db.execute(
        text("SELECT user_id, rubric_criterion_id, score, comment FROM tracking_scores WHERE snapshot_id = :sid"),
        {"sid": snapshot_id},
    )
    scores: dict[str, dict[str, dict]] = {}
    for sr in score_rows.fetchall():
        uid = str(sr[0])
        cid = str(sr[1])
        scores.setdefault(uid, {})[cid] = {"score": sr[2], "comment": sr[3]}

    return {
        "id": snap[0],
        "committed_at": snap[1].isoformat() if snap[1] else None,
        "label": snap[2],
        "scores": scores,
    }
