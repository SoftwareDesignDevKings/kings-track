"""
Gradeo integration status.

Gradeo data currently enters the system through the browser-extension import
pipeline in ``app.gradeo``. This module keeps the integrations surface intact so
we can later add a real API-backed client without changing call sites that rely
on the integration registry.
"""
from app.integrations.base import IntegrationClient


class GradeoClient(IntegrationClient):
    name = "gradeo"

    @property
    def enabled(self) -> bool:
        # The current Gradeo path is extension-driven, so backend API credentials
        # are not required for the integration to be considered available.
        return True

    async def test_connection(self) -> bool:
        return True

    async def sync(self, course_id: int) -> int:
        raise NotImplementedError("Gradeo sync runs through the extension import pipeline")


gradeo_client = GradeoClient()
