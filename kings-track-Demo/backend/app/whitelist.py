from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def get_effective_whitelist(db: AsyncSession) -> list[int]:
    """Return whitelisted course IDs from DB. Empty list means no courses are whitelisted."""
    result = await db.execute(text("SELECT course_id FROM course_whitelist ORDER BY course_id"))
    return [row[0] for row in result.fetchall()]
