import logging
from contextlib import asynccontextmanager
from time import perf_counter
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.api.routes import auth, courses, sync, admin, gradeo_admin
from app.sync.engine import sync_engine

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
request_logger = logging.getLogger("app.http")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    sync_engine.start_scheduler(
        interval_hours=settings.sync_interval_hours,
        incremental_interval_minutes=settings.incremental_sync_interval_minutes,
    )
    yield
    # Shutdown
    sync_engine.stop_scheduler()


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


@app.middleware("http")
async def log_extension_requests(request: Request, call_next):
    request_id = request.headers.get("X-Extension-Request-Id") or uuid4().hex[:12]
    request.state.request_id = request_id
    path = request.url.path
    should_log = (
        path.startswith("/api/admin/gradeo")
        or path == "/api/auth/me"
    )
    started_at = perf_counter()

    if should_log:
        request_logger.info(
            "request_started request_id=%s method=%s path=%s has_extension_key=%s user_agent=%s",
            request_id,
            request.method,
            path,
            bool(request.headers.get("X-Extension-Api-Key")),
            request.headers.get("user-agent", "")[:120],
        )

    try:
        response = await call_next(request)
    except Exception:
        duration_ms = round((perf_counter() - started_at) * 1000, 1)
        if should_log:
            request_logger.exception(
                "request_failed request_id=%s method=%s path=%s duration_ms=%s",
                request_id,
                request.method,
                path,
                duration_ms,
            )
        raise

    response.headers["X-Request-Id"] = request_id
    if should_log:
        duration_ms = round((perf_counter() - started_at) * 1000, 1)
        request_logger.info(
            "request_completed request_id=%s method=%s path=%s status_code=%s duration_ms=%s",
            request_id,
            request.method,
            path,
            response.status_code,
            duration_ms,
        )
    return response

# Routes
app.include_router(courses.router, prefix="/api")
app.include_router(sync.router, prefix="/api")
app.include_router(admin.router, prefix="/api")
app.include_router(gradeo_admin.router, prefix="/api")
app.include_router(auth.router, prefix="/api")


@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "canvas_configured": settings.canvas_configured,
        "edstem_configured": settings.edstem_configured,
    }
