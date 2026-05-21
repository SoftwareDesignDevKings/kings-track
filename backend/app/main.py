import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.config import settings
from app.api.routes import auth, courses, sync, admin, gradeo_admin, reminders_admin, canvas_health, students, attendance
from app.cache import get_redis, close_redis
from app.db import get_db
from app.sync.engine import sync_engine
from app.reminders.engine import reminder_engine

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Only start background schedulers on long-running deployments.
    # On Vercel, syncs are triggered by Vercel Cron Jobs (see vercel.json).
    if not settings.is_serverless:
        sync_engine.start_scheduler(
            interval_hours=settings.sync_interval_hours,
            incremental_interval_minutes=settings.incremental_sync_interval_minutes,
        )
        reminder_engine.start_scheduler(
            interval_seconds=settings.reminder_scheduler_interval_seconds,
        )
    yield
    # Shutdown
    if not settings.is_serverless:
        sync_engine.stop_scheduler()
        reminder_engine.stop_scheduler()
    await close_redis()


app = FastAPI(
    title="Kings Analytics API",
    version="1.0.0",
    description="Canvas analytics dashboard for Kings school",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routes
app.include_router(courses.router, prefix="/api")
app.include_router(sync.router, prefix="/api")
app.include_router(sync.cron_router, prefix="/api")
app.include_router(admin.router, prefix="/api")
app.include_router(gradeo_admin.router, prefix="/api")
app.include_router(reminders_admin.router, prefix="/api")
app.include_router(auth.router, prefix="/api")
app.include_router(canvas_health.router, prefix="/api")
app.include_router(students.router, prefix="/api")
app.include_router(attendance.router, prefix="/api")


@app.get("/api/health")
async def health(db=Depends(get_db)):
    db_ok = False
    try:
        await db.execute(text("SELECT 1"))
        db_ok = True
    except Exception:
        pass

    redis_ok = False
    r = await get_redis()
    if r:
        try:
            await r.ping()
            redis_ok = True
        except Exception:
            pass

    return {
        "status": "ok" if db_ok else "degraded",
        "database": db_ok,
        "redis": redis_ok,
        "canvas_configured": settings.canvas_configured,
        "edstem_configured": settings.edstem_configured,
        "environment": settings.environment,
        "deployment_target": settings.deployment_target,
    }
