"""Passwords, JWT bearer tokens, order access tokens and admin key checks."""

import base64
import hashlib
import hmac
from datetime import UTC, datetime, timedelta

import jwt
from fastapi import Depends, Header, Request
from pwdlib import PasswordHash
from sqlalchemy.orm import Session

from optiframe.db import User, get_session
from optiframe.errors import AppError

_hasher = PasswordHash.recommended()
# Verified against when the email is unknown, so login timing doesn't reveal which emails exist.
_DUMMY_HASH = _hasher.hash("timing-equaliser-not-a-real-password")


def hash_password(pw: str) -> str:
    return _hasher.hash(pw)


def verify_password(pw: str, hashed: str | None) -> bool:
    if hashed is None:
        _hasher.verify(pw, _DUMMY_HASH)
        return False
    return _hasher.verify(pw, hashed)


def issue_token(secret: str, user_id: int, ttl_hours: int) -> tuple[str, datetime]:
    exp = datetime.now(UTC) + timedelta(hours=ttl_hours)
    token = jwt.encode({"sub": str(user_id), "exp": exp, "typ": "access"}, secret, algorithm="HS256")
    return token, exp


def order_access_token(secret: str, order_id: str) -> str:
    mac = hmac.new(secret.encode(), b"order-access:" + order_id.encode(), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(mac[:24]).decode().rstrip("=")


def check_order_token(secret: str, order_id: str, token: str | None) -> bool:
    return bool(token) and hmac.compare_digest(order_access_token(secret, order_id), token)


def _bearer(authorization: str | None) -> str | None:
    if not authorization:
        return None
    scheme, _, value = authorization.partition(" ")
    return value.strip() if scheme.lower() == "bearer" and value.strip() else None


def optional_user(request: Request, authorization: str | None = Header(default=None),
                  session: Session = Depends(get_session)) -> User | None:
    token = _bearer(authorization)
    if token is None:
        return None
    secret = request.app.state.settings.secret_key
    try:
        payload = jwt.decode(token, secret, algorithms=["HS256"], options={"require": ["exp", "sub"]})
    except jwt.PyJWTError as exc:
        raise AppError("UNAUTHORIZED", "Your session has expired. Please sign in again.") from exc
    if payload.get("typ") != "access":
        raise AppError("UNAUTHORIZED")
    user = session.get(User, int(payload["sub"]))
    if user is None:
        raise AppError("UNAUTHORIZED")
    return user


def current_user(user: User | None = Depends(optional_user)) -> User:
    if user is None:
        raise AppError("UNAUTHORIZED")
    return user


def require_admin(request: Request, x_admin_key: str | None = Header(default=None)) -> None:
    expected = request.app.state.settings.admin_api_key
    if not expected:
        raise AppError("FORBIDDEN", "Admin access is not configured.")
    if not x_admin_key or not hmac.compare_digest(expected, x_admin_key):
        raise AppError("FORBIDDEN")
