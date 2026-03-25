import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.integrations import INTEGRATIONS
from app.api.routes import courses, sync
from app.sync.engine import sync_engine

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    sync_engine.start_scheduler(interval_hours=settings.sync_interval_hours)
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

# Routes
app.include_router(courses.router, prefix="/api")
app.include_router(sync.router, prefix="/api")


@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "canvas_configured": settings.canvas_configured,
        "integrations": [i.status() for i in INTEGRATIONS],
    }
