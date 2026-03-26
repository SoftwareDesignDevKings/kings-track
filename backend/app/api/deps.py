import jwt
from jwt import PyJWKClient, PyJWKClientError
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db import get_db

# Lazily initialised — created on first request so startup doesn't fail
# if SUPABASE_URL is not yet set in local dev.
_jwks_client: PyJWKClient | None = None


def _get_jwks_client() -> PyJWKClient:
    global _jwks_client
    if _jwks_client is None:
        jwks_url = f"{settings.supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json"
        _jwks_client = PyJWKClient(jwks_url, cache_keys=True)
    return _jwks_client


def _verify_jwt(token: str) -> dict:
    """Verify the Supabase JWT and return the payload."""
    try:
        client = _get_jwks_client()
        signing_key = client.get_signing_key_from_jwt(token)
        return jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256", "ES256"],
            audience="authenticated",
        )
    except (PyJWKClientError, jwt.PyJWTError, Exception):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )


async def _resolve_local_dev_user(db: AsyncSession) -> dict:
    result = await db.execute(
        text("SELECT id, email, role, created_at FROM app_users WHERE email = :email"),
        {"email": settings.local_dev_user_email},
    )
    row = result.fetchone()

    if row:
        return {"id": row[0], "email": row[1], "role": row[2], "created_at": row[3]}

    return {
        "id": 0,
        "email": settings.local_dev_user_email,
        "role": settings.local_dev_user_role,
        "created_at": None,
    }


async def require_auth(
    credentials: HTTPAuthorizationCredentials | None = Depends(HTTPBearer(auto_error=False)),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    Verify the Supabase JWT and check the user exists in app_users.
    Returns the app_user row as a dict with keys: id, email, role, created_at.
    Raises 401 if the token is invalid, 403 if the user is not registered.
    """
    if settings.local_auth_enabled:
        return await _resolve_local_dev_user(db)

    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing bearer token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    payload = _verify_jwt(credentials.credentials)
    email = payload.get("email")

    if not email:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token missing email")

    result = await db.execute(
        text("SELECT id, email, role, created_at FROM app_users WHERE email = :email"),
        {"email": email},
    )
    row = result.fetchone()

    if not row:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User not authorised — contact an administrator",
        )

    return {"id": row[0], "email": row[1], "role": row[2], "created_at": row[3]}


async def require_admin(
    user: dict = Depends(require_auth),
) -> dict:
    """Extends require_auth — additionally requires the admin role."""
    if user["role"] != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
    return user
