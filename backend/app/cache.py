from __future__ import annotations

import logging

import redis.asyncio as redis

from app.config import settings

logger = logging.getLogger(__name__)

_redis_client: redis.Redis | None = None
_init_attempted: bool = False


async def get_redis() -> redis.Redis | None:
    """Return the shared Redis client, creating it on first call.

    Returns None if Redis is not configured or unreachable.
    Within a single warm Vercel instance the client is reused across
    invocations. On cold start the connection is re-established.
    """
    global _redis_client, _init_attempted

    if _init_attempted:
        return _redis_client

    _init_attempted = True

    if not settings.redis_configured:
        logger.info("REDIS_URL not set — running without Redis")
        return None

    try:
        _redis_client = redis.from_url(
            settings.redis_url,
            decode_responses=True,
            socket_connect_timeout=3,
            socket_timeout=5,
        )
        await _redis_client.ping()
        logger.info("Redis connected")
    except Exception:
        logger.warning("Redis unavailable, continuing without cache")
        _redis_client = None

    return _redis_client


async def close_redis() -> None:
    """Explicitly close the Redis connection (used in long-running deployments)."""
    global _redis_client, _init_attempted
    if _redis_client:
        await _redis_client.close()
        _redis_client = None
    _init_attempted = False
