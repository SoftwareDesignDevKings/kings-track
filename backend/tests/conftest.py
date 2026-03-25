"""
Shared test fixtures.

Event-loop strategy:
- asyncpg connections are tied to the event loop that created them.
- pytest-asyncio creates a new loop per test, so pooled connections go stale.
- Solution: use NullPool for ALL test DB operations so no connections are cached.

NullPool is set up at module import time so it applies to both the async `db`
fixture and to routes that use AsyncSessionLocal directly (e.g. sync.py).

Seed/cleanup use psycopg2 (sync) — completely loop-agnostic.
"""
import os
import re
import psycopg2
import pytest
from unittest.mock import patch
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.pool import NullPool

from app.config import settings as app_settings


# ---------------------------------------------------------------------------
# NullPool session factory — shared by all tests
# ---------------------------------------------------------------------------

_test_engine = create_async_engine(app_settings.database_url, poolclass=NullPool)
_TestSessionLocal = async_sessionmaker(
    _test_engine, class_=AsyncSession, expire_on_commit=False
)


# ---------------------------------------------------------------------------
# Sync helpers — psycopg2, completely loop-agnostic
# ---------------------------------------------------------------------------

def _dsn() -> str:
    database_url = os.environ.get("DATABASE_URL", "")
    return (
        database_url
        .replace("postgresql+asyncpg://", "postgresql://")
        .replace("postgresql+psycopg2://", "postgresql://")
    )


def _sync_exec(sql: str, params: dict = None):
    """Execute raw SQL via psycopg2, translating :name → %(name)s params."""
    psycopg2_sql = re.sub(r":([a-zA-Z_][a-zA-Z0-9_]*)", r"%(\1)s", sql)
    conn = psycopg2.connect(_dsn())
    conn.autocommit = True
    try:
        with conn.cursor() as cur:
            cur.execute(psycopg2_sql, params or {})
    finally:
        conn.close()


def seed(sql: str, params: dict = None):
    _sync_exec(sql, params)


def cleanup(sql: str, params: dict = None):
    _sync_exec(sql, params)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def app_client():
    """Sync TestClient with NullPool engine and whitelist cleared.

    Patches AsyncSessionLocal in every module that uses it so all DB
    operations use NullPool — no cached connections across event loops.
    Also clears CANVAS_COURSE_WHITELIST so test-seeded courses are visible.
    """
    from fastapi.testclient import TestClient
    from app.main import app
    from app.db import get_db

    async def override_get_db():
        async with _TestSessionLocal() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db

    with patch("app.sync.engine.sync_engine.start_scheduler"), \
         patch("app.sync.engine.sync_engine.stop_scheduler"), \
         patch("app.api.routes.sync.AsyncSessionLocal", _TestSessionLocal), \
         patch("app.api.routes.courses.settings") as mock_settings:
        mock_settings.course_whitelist = []
        with TestClient(app) as client:
            yield client

    app.dependency_overrides.pop(get_db, None)


@pytest.fixture
async def db():
    """Async NullPool DB session for pure async tests (e.g. sync_submissions)."""
    async with _TestSessionLocal() as session:
        yield session
        await session.rollback()
