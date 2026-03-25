"""
Abstract base class for external data integrations.
Implement this interface when adding EdStem, Gradeo, or other integrations.
"""
from abc import ABC, abstractmethod


class IntegrationClient(ABC):
    """Base class for external data source integrations."""

    @property
    @abstractmethod
    def name(self) -> str:
        """Integration identifier (e.g. 'edstem', 'gradeo')."""
        ...

    @property
    def enabled(self) -> bool:
        """Return True only when the integration is fully configured."""
        return False

    @abstractmethod
    async def test_connection(self) -> bool:
        """Test that the integration is reachable and the credentials are valid."""
        ...

    @abstractmethod
    async def sync(self, course_id: int) -> int:
        """Sync data for a course. Returns number of records synced."""
        ...

    def status(self) -> dict:
        return {
            "name": self.name,
            "enabled": self.enabled,
            "status": "configured" if self.enabled else "not_configured",
        }
