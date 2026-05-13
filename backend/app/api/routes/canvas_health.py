"""Canvas LMS reachability probe.

A lightweight HEAD/GET against the configured Canvas host that distinguishes
"Canvas itself is down" (e.g. 503 maintenance page) from auth/config errors.
The frontend polls this so it can render a global outage banner.
"""
import asyncio
import logging
import time

import httpx

from fastapi import APIRouter, Depends

from app.api.deps import require_auth
from app.config import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/canvas", tags=["canvas"], dependencies=[Depends(require_auth)])

PROBE_TIMEOUT_SECONDS = 8.0
CACHE_TTL_SECONDS = 20.0

_cache: dict | None = None
_cache_at: float = 0.0
_lock = asyncio.Lock()


def _classify(status_code: int, body_snippet: str) -> tuple[bool, str]:
    """Return (is_up, reason)."""
    # 503 = Instructure maintenance / outage
    if status_code == 503:
        return False, "maintenance"
    if status_code >= 500:
        return False, f"server_error_{status_code}"

    # When Canvas is up but the token is missing/invalid we get 401 JSON.
    # That still means Canvas itself is reachable.
    if status_code in (200, 401, 403):
        # 503 maintenance page can also be served with 200 in rare cases —
        # fall back to body sniffing.
        if "down for maintenance" in body_snippet.lower():
            return False, "maintenance"
        return True, "ok"

    # Anything else (404, 429, network) — treat as up to avoid false positives,
    # the dedicated sync error path will surface it.
    return True, f"status_{status_code}"


async def _probe() -> dict:
    if not settings.canvas_api_url:
        return {"up": False, "configured": False, "status": None, "reason": "not_configured"}

    url = f"{settings.canvas_api_url.rstrip('/')}/api/v1/courses"
    try:
        async with httpx.AsyncClient(timeout=PROBE_TIMEOUT_SECONDS) as client:
            resp = await client.get(url)
        body_snippet = resp.text[:512] if resp.text else ""
        up, reason = _classify(resp.status_code, body_snippet)
        return {
            "up": up,
            "configured": True,
            "status": resp.status_code,
            "reason": reason,
        }
    except httpx.RequestError as exc:
        logger.warning("Canvas health probe failed: %s", exc)
        return {
            "up": False,
            "configured": True,
            "status": None,
            "reason": "network_error",
        }


@router.get("/health")
async def canvas_health():
    """Cheap, cached Canvas reachability check."""
    global _cache, _cache_at
    now = time.monotonic()

    async with _lock:
        if _cache is not None and (now - _cache_at) < CACHE_TTL_SECONDS:
            return _cache

        result = await _probe()
        _cache = result
        _cache_at = now
        return result
