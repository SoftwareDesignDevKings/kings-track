"""
EdStem API client.

Handles:
- Bearer token auth
- Exponential retry on 429 / 5xx errors
- No pagination needed (all key endpoints return full data in one response)
"""
import asyncio
import logging
from typing import Any

import httpx

logger = logging.getLogger(__name__)


class EdStemAPIError(Exception):
    def __init__(self, status_code: int, message: str):
        self.status_code = status_code
        super().__init__(f"EdStem API error {status_code}: {message}")


class EdStemClient:
    def __init__(self, base_url: str, token: str):
        self.base_url = base_url.rstrip("/")
        self.token = token
        self._client: httpx.AsyncClient | None = None

    async def __aenter__(self):
        self._client = httpx.AsyncClient(
            timeout=httpx.Timeout(30.0),
            headers={"Authorization": f"Bearer {self.token}"},
        )
        return self

    async def __aexit__(self, *args):
        if self._client:
            await self._client.aclose()
            self._client = None

    async def _request(self, method: str, path: str, retries: int = 3, **kwargs) -> httpx.Response:
        url = path if path.startswith("http") else f"{self.base_url}{path}"
        delay = 1.0

        for attempt in range(retries):
            resp = await self._client.request(method, url, **kwargs)

            if resp.status_code == 429 or resp.status_code >= 500:
                wait = delay * (2 ** attempt)
                logger.warning("EdStem API rate limited or server error (%d). Waiting %.1fs before retry %d.",
                               resp.status_code, wait, attempt + 1)
                await asyncio.sleep(wait)
                continue

            if resp.status_code >= 400:
                raise EdStemAPIError(resp.status_code, resp.text[:200])

            return resp

        raise EdStemAPIError(429, "Exceeded retry limit")

    async def get_user_courses(self) -> list[dict[str, Any]]:
        """Return all courses the authenticated user is enrolled in."""
        resp = await self._request("GET", "/user")
        data = resp.json()
        return data.get("courses", [])

    async def get_lessons(self, course_id: int) -> dict[str, Any]:
        """Return lessons and modules for a course.

        Response shape: {"lessons": [...], "modules": [...]}
        """
        resp = await self._request("GET", f"/courses/{course_id}/lessons")
        return resp.json()

    async def get_lesson_user_summaries(self, course_id: int) -> dict[str, Any]:
        """Return per-student lesson completion data for all students in a course.

        Response shape:
        {
            "users": [{
                "user_id": int,
                "name": str,
                "email": str,
                "course_role": str,
                "completed": {"<lesson_id>": "<completed_at>", ...},
                "interactive_completed": {"<lesson_id>": "<completed_at>", ...},
                "viewed": [<lesson_id>, ...]
            }],
            "interactive_lessons": [<lesson_id>, ...]
        }
        """
        resp = await self._request(
            "GET",
            f"/courses/{course_id}/analytics/lessons/lesson_user_summaries",
            params={"tz": "Australia/Sydney"},
        )
        return resp.json()
