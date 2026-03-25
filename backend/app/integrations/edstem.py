"""
EdStem integration — placeholder.

EdStem is a discussion forum platform used alongside Canvas.
Future implementation will sync:
- Thread participation counts per student per course
- Response quality metrics
- Discussion activity timelines

TODO: Implement when EdStem API access is available.
API docs: https://edstem.org/api (requires institutional access)
"""
from app.integrations.base import IntegrationClient


class EdStemClient(IntegrationClient):
    name = "edstem"

    async def test_connection(self) -> bool:
        raise NotImplementedError("EdStem integration not yet available")

    async def sync(self, course_id: int) -> int:
        raise NotImplementedError("EdStem integration not yet available")


edstem_client = EdStemClient()
