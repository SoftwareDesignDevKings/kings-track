import jwt
from jwt import PyJWKClient, PyJWKClientError
import logging

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db import get_db

logger = logging.getLogger("app.auth")

# ---------------------------------------------------------------------------
# Supabase JWKS (lazily initialised)
# ---------------------------------------------------------------------------
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


# ---------------------------------------------------------------------------
# Microsoft Entra ID JWKS (lazily initialised)
# ---------------------------------------------------------------------------
_entra_jwks_client: PyJWKClient | None = None


def _get_entra_jwks_client() -> PyJWKClient:
    global _entra_jwks_client
    if _entra_jwks_client is None:
        jwks_url = (
            f"https://login.microsoftonline.com/"
            f"{settings.entra_tenant_id}/discovery/v2.0/keys"
        )
        _entra_jwks_client = PyJWKClient(jwks_url, cache_keys=True)
    return _entra_jwks_client


def _verify_entra_jwt(token: str) -> dict:
    """Verify a Microsoft Entra ID JWT and return the payload."""
    try:
        client = _get_entra_jwks_client()
        signing_key = client.get_signing_key_from_jwt(token)
        return jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            audience=settings.entra_client_id,
            issuer=f"https://login.microsoftonline.com/{settings.entra_tenant_id}/v2.0",
        )
    except (PyJWKClientError, jwt.PyJWTError, Exception) as exc:
        logger.warning("Entra JWT validation failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )


def _resolve_entra_role(payload: dict) -> str:
    """Map Entra group memberships to app role.

    The 'groups' claim contains Azure AD group object IDs.
    Falls back to 'teacher' if no admin group match.
    """
    groups = payload.get("groups", [])
    if settings.entra_admin_group_id and settings.entra_admin_group_id in groups:
        return "admin"
    return "teacher"


# ---------------------------------------------------------------------------
# Local dev user
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# Auth dependencies
# ---------------------------------------------------------------------------

async def require_auth(
    credentials: HTTPAuthorizationCredentials | None = Depends(HTTPBearer(auto_error=False)),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    Verify the bearer JWT and return the app_user as a dict.

    Supports three auth modes (set via AUTH_MODE env var):
      - local:    bypass JWT, use configured dev user
      - entra:    validate via Microsoft Entra ID JWKS, auto-provision user
      - supabase: validate via Supabase JWKS, require pre-registered user
    """
    if settings.local_auth_enabled:
        return await _resolve_local_dev_user(db)

    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing bearer token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = credentials.credentials

    # --- Entra ID path ---
    if settings.entra_auth_enabled:
        payload = _verify_entra_jwt(token)
        email = payload.get("preferred_username") or payload.get("email")
        if not email:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token missing email claim",
            )
        email = email.lower()
        oid = payload.get("oid", "")
        entra_role = _resolve_entra_role(payload)

        # Upsert: auto-provision on first login, sync role on every login
        await db.execute(
            text(
                "INSERT INTO app_users (email, role) VALUES (:email, :role) "
                "ON CONFLICT (email) DO UPDATE SET role = :role"
            ),
            {"email": email, "role": entra_role},
        )
        await db.commit()

        result = await db.execute(
            text("SELECT id, email, role, created_at FROM app_users WHERE email = :email"),
            {"email": email},
        )
        row = result.fetchone()
        return {
            "id": row[0],
            "email": row[1],
            "role": row[2],
            "created_at": row[3],
            "auth_source": "entra",
            "entra_oid": oid,
        }

    # --- Supabase path (default) ---
    payload = _verify_jwt(token)
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
