from fastapi import APIRouter, Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.api.deps import require_auth, _verify_entra_jwt
from app.config import settings

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/me")
async def get_current_user(user: dict = Depends(require_auth)):
    return {
        **user,
        "created_at": user["created_at"].isoformat() if user["created_at"] else None,
        "auth_source": user.get("auth_source"),
        "auth_mode": settings.auth_mode,
        "local_auth": settings.local_auth_enabled,
    }


@router.get("/entra-debug")
async def entra_debug(
    credentials: HTTPAuthorizationCredentials = Depends(HTTPBearer()),
):
    """Temporary endpoint to test Entra token validation without app_users lookup.

    Remove once Entra auth is confirmed working in production.
    """
    payload = _verify_entra_jwt(credentials.credentials)
    return {
        "oid": payload.get("oid"),
        "preferred_username": payload.get("preferred_username"),
        "groups": payload.get("groups", []),
        "name": payload.get("name"),
        "tid": payload.get("tid"),
    }
