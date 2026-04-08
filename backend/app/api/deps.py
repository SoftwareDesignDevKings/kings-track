import jwt
from jwt import PyJWKClient, PyJWKClientError
from hashlib import sha256
import logging
from time import perf_counter

from fastapi import Depends, Header, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db import get_db

logger = logging.getLogger("app.auth")

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
        return {
            "id": row[0],
            "email": row[1],
            "role": row[2],
            "created_at": row[3],
            "auth_source": "local",
        }

    return {
        "id": 0,
        "email": settings.local_dev_user_email,
        "role": settings.local_dev_user_role,
        "created_at": None,
        "auth_source": "local",
    }


def _hash_extension_api_key(api_key: str) -> str:
    return sha256(api_key.encode("utf-8")).hexdigest()


async def _resolve_extension_api_key_user(api_key: str, db: AsyncSession) -> dict | None:
    started_at = perf_counter()
    result = await db.execute(
        text("""
            SELECT id, email, role, created_at
            FROM app_users
            WHERE extension_api_key_hash = :key_hash
        """),
        {"key_hash": _hash_extension_api_key(api_key)},
    )
    row = result.fetchone()
    if not row:
        logger.info(
            "extension_key_lookup_result found=false duration_ms=%s",
            round((perf_counter() - started_at) * 1000, 1),
        )
        return None

    await db.execute(
        text("""
            UPDATE app_users
            SET extension_api_key_last_used_at = CURRENT_TIMESTAMP
            WHERE id = :user_id
        """),
        {"user_id": row[0]},
    )
    await db.commit()
    logger.info(
        "extension_key_lookup_result found=true user_id=%s email=%s duration_ms=%s",
        row[0],
        row[1],
        round((perf_counter() - started_at) * 1000, 1),
    )

    return {
        "id": row[0],
        "email": row[1],
        "role": row[2],
        "created_at": row[3],
        "auth_source": "extension_api_key",
    }


async def require_auth(
    credentials: HTTPAuthorizationCredentials | None = Depends(HTTPBearer(auto_error=False)),
    extension_api_key: str | None = Header(default=None, alias="X-Extension-Api-Key"),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    Verify the Supabase JWT and check the user exists in app_users.
    Returns the app_user row as a dict with keys: id, email, role, created_at.
    Raises 401 if the token is invalid, 403 if the user is not registered.
    """
    if extension_api_key:
        auth_started_at = perf_counter()
        logger.info("require_auth_extension_key_started")
        user = await _resolve_extension_api_key_user(extension_api_key, db)
        if user:
            logger.info(
                "require_auth_extension_key_succeeded email=%s duration_ms=%s",
                user["email"],
                round((perf_counter() - auth_started_at) * 1000, 1),
            )
            return user
        logger.info(
            "require_auth_extension_key_failed duration_ms=%s",
            round((perf_counter() - auth_started_at) * 1000, 1),
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid extension API key",
        )

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

    return {"id": row[0], "email": row[1], "role": row[2], "created_at": row[3], "auth_source": "supabase"}


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
