from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from optiframe.db import Order, User, get_session
from optiframe.errors import AppError
from optiframe.orders import service
from optiframe.schemas import Login, OrderClaim, OrderOut, Register, TokenOut, UserOut, UserUpdate
from optiframe.security import current_user, hash_password, issue_token, verify_password

router = APIRouter(tags=["accounts"])


def _user_out(u: User) -> dict:
    return {"id": u.id, "email": u.email, "name": u.name, "shipping_address": u.shipping_address}


def _token_out(request: Request, u: User) -> dict:
    s = request.app.state.settings
    token, exp = issue_token(s.secret_key, u.id, s.jwt_ttl_hours)
    return {"access_token": token, "expires_at": exp, "user": _user_out(u)}


@router.post("/auth/register", response_model=TokenOut, status_code=201)
def register(body: Register, request: Request, session: Session = Depends(get_session)):
    email = str(body.email).lower()
    if session.scalar(select(User).where(User.email == email)) is not None:
        raise AppError("EMAIL_TAKEN")
    user = User(email=email, password_hash=hash_password(body.password), name=body.name)
    session.add(user)
    try:
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        raise AppError("EMAIL_TAKEN") from exc
    return _token_out(request, user)


@router.post("/auth/login", response_model=TokenOut)
def login(body: Login, request: Request, session: Session = Depends(get_session)):
    user = session.scalar(select(User).where(User.email == str(body.email).lower()))
    if not verify_password(body.password, user.password_hash if user else None):
        raise AppError("INVALID_CREDENTIALS")
    return _token_out(request, user)


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(current_user)):
    return _user_out(user)


@router.patch("/me", response_model=UserOut)
def update_me(body: UserUpdate, user: User = Depends(current_user), session: Session = Depends(get_session)):
    fields = body.model_fields_set
    if "name" in fields:
        user.name = body.name
    if "shipping_address" in fields:
        user.shipping_address = body.shipping_address.model_dump(mode="json") if body.shipping_address else None
    session.commit()
    return _user_out(user)


@router.get("/me/orders", response_model=list[OrderOut])
def my_orders(user: User = Depends(current_user), session: Session = Depends(get_session)):
    orders = session.scalars(select(Order).where(Order.user_id == user.id).order_by(Order.created_at.desc()))
    return [service.order_out(o) for o in orders]


@router.post("/me/orders/claim", response_model=OrderOut)
def claim_order(body: OrderClaim, request: Request, user: User = Depends(current_user),
                session: Session = Depends(get_session)):
    """Attach a guest order to the signed-in account. Requires the order's access token (proof of ownership)."""
    order = service.get_accessible_order(session, request.app.state.settings, body.order_id, body.access_token, None)
    if order.user_id is not None and order.user_id != user.id:
        raise AppError("FORBIDDEN", "This order belongs to another account.")
    order.user_id = user.id
    session.commit()
    return service.order_out(order)
