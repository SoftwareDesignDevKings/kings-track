import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.api.routes import auth, courses, sync, admin, gradeo_admin, reminders_admin, canvas_health, attendance, students
from app.sync.engine import sync_engine
from app.reminders.engine import reminder_engine
from app.attendance.watcher import attendance_watcher

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    sync_engine.start_scheduler(
        interval_hours=settings.sync_interval_hours,
        incremental_interval_minutes=settings.incremental_sync_interval_minutes,
    )
    reminder_engine.start_scheduler(
        interval_seconds=settings.reminder_scheduler_interval_seconds,
    )
    # Start attendance watcher if configured
    if settings.watch_enabled and settings.watch_folder:
        attendance_watcher.start(settings.watch_folder, settings.processed_folder)
    yield
    # Shutdown
    sync_engine.stop_scheduler()
    reminder_engine.stop_scheduler()
    if attendance_watcher.running:
        attendance_watcher.stop()


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
app.include_router(admin.router, prefix="/api")
app.include_router(gradeo_admin.router, prefix="/api")
app.include_router(reminders_admin.router, prefix="/api")
app.include_router(auth.router, prefix="/api")
app.include_router(canvas_health.router, prefix="/api")
app.include_router(attendance.router, prefix="/api")
app.include_router(students.router, prefix="/api")


@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "canvas_configured": settings.canvas_configured,
        "edstem_configured": settings.edstem_configured,
    }
