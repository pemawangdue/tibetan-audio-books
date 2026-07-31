from dataclasses import dataclass
from functools import lru_cache

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWKClient

from .config import Settings, get_settings


@dataclass(frozen=True)
class Principal:
    user_id: str
    claims: dict


bearer = HTTPBearer(auto_error=False)


@lru_cache(maxsize=4)
def _jwks_client(issuer: str) -> PyJWKClient:
    return PyJWKClient(f"{issuer}/.well-known/jwks.json", cache_keys=True)


def current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    settings: Settings = Depends(get_settings),
) -> Principal:
    if settings.local_auth_bypass:
        user_id = (
            credentials.credentials
            if credentials and credentials.credentials.startswith("local-")
            else settings.local_user_id
        )
        return Principal(user_id=user_id, claims={"sub": user_id, "local": True})
    if credentials is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Bearer token required")
    try:
        token = credentials.credentials
        signing_key = _jwks_client(settings.cognito_issuer).get_signing_key_from_jwt(token)
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            issuer=settings.cognito_issuer,
            options={"verify_aud": False},
        )
        token_use = claims.get("token_use")
        if token_use not in {"access", "id"}:
            raise jwt.InvalidTokenError("invalid token_use")
        if token_use == "id" and claims.get("aud") != settings.cognito_app_client_id:
            raise jwt.InvalidAudienceError("invalid audience")
        if token_use == "access" and claims.get("client_id") != settings.cognito_app_client_id:
            raise jwt.InvalidAudienceError("invalid client")
        return Principal(user_id=claims["sub"], claims=claims)
    except (jwt.PyJWTError, KeyError) as exc:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc
