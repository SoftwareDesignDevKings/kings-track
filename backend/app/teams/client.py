"""
Microsoft Graph API client for Teams attendance data.

Handles:
- OAuth 2.0 client credentials flow (app-only, no user login)
- Token caching and refresh
- Calendar event discovery for meeting organizers
- Online meeting attendance reports and records
"""
import logging
import time
from typing import Any

import httpx

logger = logging.getLogger(__name__)

GRAPH_BASE = "https://graph.microsoft.com/v1.0"
TOKEN_URL = "https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token"


class GraphAPIError(Exception):
    def __init__(self, status_code: int, message: str):
        self.status_code = status_code
        super().__init__(f"Graph API error {status_code}: {message}")


class MSGraphClient:
    def __init__(self, tenant_id: str, client_id: str, client_secret: str):
        self.tenant_id = tenant_id
        self.client_id = client_id
        self.client_secret = client_secret
        self._client: httpx.AsyncClient | None = None
        self._token: str | None = None
        self._token_expires_at: float = 0

    async def __aenter__(self):
        self._client = httpx.AsyncClient(timeout=httpx.Timeout(30.0))
        await self._ensure_token()
        return self

    async def __aexit__(self, *args):
        if self._client:
            await self._client.aclose()
            self._client = None

    async def _ensure_token(self) -> None:
        """Acquire or refresh the OAuth2 token via client credentials flow."""
        if self._token and time.time() < self._token_expires_at - 60:
            return

        url = TOKEN_URL.format(tenant_id=self.tenant_id)
        data = {
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "scope": "https://graph.microsoft.com/.default",
            "grant_type": "client_credentials",
        }

        resp = await self._client.post(url, data=data)
        if resp.status_code != 200:
            body = resp.text
            raise GraphAPIError(resp.status_code, f"Token acquisition failed: {body}")

        token_data = resp.json()
        self._token = token_data["access_token"]
        self._token_expires_at = time.time() + token_data.get("expires_in", 3600)
        logger.info("Graph API token acquired (expires in %ds)", token_data.get("expires_in", 0))

    async def _request(self, method: str, path: str, **kwargs) -> dict[str, Any]:
        """Make an authenticated request to the Graph API."""
        await self._ensure_token()
        url = f"{GRAPH_BASE}{path}" if path.startswith("/") else path
        headers = {"Authorization": f"Bearer {self._token}"}

        resp = await self._client.request(method, url, headers=headers, **kwargs)

        if resp.status_code == 401:
            self._token = None
            await self._ensure_token()
            headers = {"Authorization": f"Bearer {self._token}"}
            resp = await self._client.request(method, url, headers=headers, **kwargs)

        if resp.status_code >= 400:
            raise GraphAPIError(resp.status_code, resp.text[:500])

        if resp.status_code == 204:
            return {}
        return resp.json()

    async def get(self, path: str, **kwargs) -> dict[str, Any]:
        return await self._request("GET", path, **kwargs)

    async def get_all(self, path: str, **kwargs) -> list[dict]:
        """Follow @odata.nextLink pagination to collect all results."""
        results = []
        url = f"{GRAPH_BASE}{path}" if path.startswith("/") else path

        while url:
            data = await self._request("GET", url, **kwargs)
            results.extend(data.get("value", []))
            url = data.get("@odata.nextLink")

        return results

    # ── Convenience methods ──────────────────────────────────────────

    async def get_user_id(self, email: str) -> str | None:
        """Resolve a user email to an Azure AD object ID."""
        try:
            data = await self.get(f"/users/{email}")
            return data.get("id")
        except GraphAPIError as exc:
            if exc.status_code == 404:
                return None
            raise

    async def get_calendar_events(
        self, user_id: str, start: str, end: str
    ) -> list[dict]:
        """Get calendar events for a user within a date range.

        Args:
            user_id: Azure AD user ID or UPN (email).
            start: ISO 8601 datetime string.
            end: ISO 8601 datetime string.
        """
        return await self.get_all(
            f"/users/{user_id}/calendarView",
            params={"startDateTime": start, "endDateTime": end, "$top": "100"},
        )

    async def get_online_meeting_by_join_url(
        self, user_id: str, join_url: str
    ) -> dict | None:
        """Look up an online meeting by its join URL."""
        try:
            data = await self.get(
                f"/users/{user_id}/onlineMeetings",
                params={"$filter": f"joinWebUrl eq '{join_url}'"},
            )
            items = data.get("value", [])
            return items[0] if items else None
        except GraphAPIError:
            return None

    async def get_attendance_reports(
        self, user_id: str, meeting_id: str
    ) -> list[dict]:
        """Get attendance reports for an online meeting, including records."""
        try:
            return await self.get_all(
                f"/users/{user_id}/onlineMeetings/{meeting_id}/attendanceReports",
            )
        except GraphAPIError as exc:
            logger.warning("Failed to get attendance reports for meeting %s: %s", meeting_id, exc)
            return []

    async def get_attendance_records(
        self, user_id: str, meeting_id: str, report_id: str
    ) -> list[dict]:
        """Get individual attendance records from a report."""
        try:
            return await self.get_all(
                f"/users/{user_id}/onlineMeetings/{meeting_id}"
                f"/attendanceReports/{report_id}/attendanceRecords",
            )
        except GraphAPIError as exc:
            logger.warning("Failed to get attendance records: %s", exc)
            return []
