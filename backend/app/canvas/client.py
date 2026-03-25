"""
Canvas LMS API client.

Handles:
- Bearer token auth
- Paginated requests (RFC 5988 Link headers)
- Rate limit monitoring and back-off (X-Rate-Limit-Remaining)
- Exponential retry on 429 / 403 rate-limit errors
"""
import asyncio
import logging
from collections.abc import AsyncIterator
from typing import Any

import httpx

from app.canvas.pagination import parse_next_url

logger = logging.getLogger(__name__)

# Back off when remaining calls drop below this threshold
RATE_LIMIT_BACKOFF_THRESHOLD = 100
RATE_LIMIT_BACKOFF_DELAY = 1.0  # seconds


class CanvasAPIError(Exception):
    def __init__(self, status_code: int, message: str):
        self.status_code = status_code
        super().__init__(f"Canvas API error {status_code}: {message}")


class CanvasClient:
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

    async def _request(
        self,
        method: str,
        path: str,
        retries: int = 3,
        **kwargs,
    ) -> httpx.Response:
        # Accept either a full URL (next-page links) or a path relative to base_url
        url = path if path.startswith("http") else f"{self.base_url}{path}"
        delay = 1.0

        for attempt in range(retries):
            resp = await self._client.request(method, url, **kwargs)

            # Monitor rate limit
            remaining = resp.headers.get("X-Rate-Limit-Remaining")
            if remaining and float(remaining) < RATE_LIMIT_BACKOFF_THRESHOLD:
                logger.warning(
                    "Canvas rate limit low: %s remaining — backing off %.1fs",
                    remaining,
                    RATE_LIMIT_BACKOFF_DELAY,
                )
                await asyncio.sleep(RATE_LIMIT_BACKOFF_DELAY)

            if resp.status_code == 429 or (resp.status_code == 403 and "rate limit" in resp.text.lower()):
                wait = delay * (2 ** attempt)
                logger.warning("Rate limited by Canvas. Waiting %.1fs before retry %d.", wait, attempt + 1)
                await asyncio.sleep(wait)
                continue

            if resp.status_code >= 400:
                raise CanvasAPIError(resp.status_code, resp.text[:200])

            return resp

        raise CanvasAPIError(429, "Exceeded retry limit due to rate limiting")

    async def get_paginated(
        self,
        path: str,
        params: dict | None = None,
    ) -> AsyncIterator[dict[str, Any]]:
        """
        Yield items from a paginated Canvas endpoint.
        Follows Link header 'next' URLs automatically.
        Processes one page at a time to keep memory usage low.
        """
        url: str | None = f"{self.base_url}{path}"
        first_request = True

        while url:
            if first_request:
                resp = await self._request("GET", path, params=params)
                first_request = False
            else:
                # For subsequent pages, use the full URL from Link header
                # Route through _request() for retry/backoff/error handling
                resp = await self._request("GET", url)

            data = resp.json()
            if isinstance(data, list):
                for item in data:
                    yield item
            elif isinstance(data, dict):
                # Some endpoints wrap in a key
                for item in data.get("data", [data]):
                    yield item

            url = parse_next_url(resp.headers.get("Link"))

    # -------------------------------------------------------------------------
    # Typed convenience methods
    # -------------------------------------------------------------------------

    async def list_courses(self) -> list[dict]:
        """Return all active courses the token-holder teaches."""
        courses = []
        async for course in self.get_paginated(
            "/api/v1/courses",
            params={
                "enrollment_type": "teacher",
                "state[]": "available",
                "per_page": 100,
                "include[]": ["term", "total_students"],
            },
        ):
            courses.append(course)
        return courses

    def list_enrollments(self, course_id: int) -> AsyncIterator[dict]:
        """Yield active student enrollments including grade data."""
        return self.get_paginated(
            f"/api/v1/courses/{course_id}/enrollments",
            params={
                "type[]": "StudentEnrollment",
                "state[]": "active",
                "per_page": 100,
                "include[]": ["grades"],
            },
        )

    def list_assignments(self, course_id: int) -> AsyncIterator[dict]:
        """Yield all published assignments with their group names."""
        return self.get_paginated(
            f"/api/v1/courses/{course_id}/assignments",
            params={
                "per_page": 100,
                "include[]": ["assignment_group", "score_statistics"],
                "order_by": "position",
            },
        )

    async def list_assignment_groups(self, course_id: int) -> list[dict]:
        """Return assignment groups (needed to resolve group names)."""
        groups = []
        async for group in self.get_paginated(
            f"/api/v1/courses/{course_id}/assignment_groups",
            params={"per_page": 100},
        ):
            groups.append(group)
        return groups

    def list_submissions(self, course_id: int) -> AsyncIterator[dict]:
        """
        Yield all student submissions for all assignments in a course.
        Uses the bulk endpoint to minimise API calls.
        """
        return self.get_paginated(
            f"/api/v1/courses/{course_id}/students/submissions",
            params={
                "student_ids[]": "all",
                "per_page": 100,
                "include[]": ["assignment"],
            },
        )
