from fastapi import APIRouter, Depends

from app.api.deps import require_auth
from app.config import settings

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/me")
async def get_current_user(user: dict = Depends(require_auth)):
    return {
        **user,
        "created_at": user["created_at"].isoformat() if user["created_at"] else None,
        "auth_mode": settings.auth_mode,
        "local_auth": settings.local_auth_enabled,
    }
