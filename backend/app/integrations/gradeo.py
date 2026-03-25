"""
Gradeo integration — placeholder.

Gradeo is used for cycle-based quizzes at Kings.
Future implementation will:
- Link Gradeo quiz assignments to curriculum cycles
- Sync Gradeo-specific completion and score data
- Feed into the Curriculum Progress tab (Phase 3)

TODO: Implement when Gradeo API access is available.
"""
from app.integrations.base import IntegrationClient


class GradeoClient(IntegrationClient):
    name = "gradeo"

    async def test_connection(self) -> bool:
        raise NotImplementedError("Gradeo integration not yet available")

    async def sync(self, course_id: int) -> int:
        raise NotImplementedError("Gradeo integration not yet available")


gradeo_client = GradeoClient()
