"""Bearer / X-Api-Key auth. Key never logged."""
from __future__ import annotations
from fastapi import Header, HTTPException, status

def make_auth_dependency(expected_key: str):
    async def require_api_key(
        authorization: str | None = Header(default=None),
        x_api_key: str | None = Header(default=None, alias="X-Api-Key"),
    ) -> None:
        token = None
        if authorization and authorization.lower().startswith("bearer "):
            token = authorization[7:].strip()
        elif x_api_key:
            token = x_api_key.strip()
        if not token or token != expected_key:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="invalid or missing API key",
            )
    return require_api_key
