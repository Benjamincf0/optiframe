import secrets

from fastapi import APIRouter, BackgroundTasks, Depends, Query, Request
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from optiframe.catalog import ORDER_STATUSES
from optiframe.db import Order, SponsorCode, get_session
from optiframe.errors import AppError
from optiframe.orders import service
from optiframe.schemas import AdminOrderUpdate, OrderOut, SponsorCodeCreate, SponsorCodeOut, SponsorCodeUpdate
from optiframe.security import require_admin

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])


def _order(session: Session, order_id: str) -> Order:
    o = session.get(Order, order_id.upper())
    if o is None:
        raise AppError("ORDER_NOT_FOUND")
    return o


@router.get("/orders", response_model=list[OrderOut])
def list_orders(status: str | None = Query(None), limit: int = Query(50, ge=1, le=500),
                offset: int = Query(0, ge=0), session: Session = Depends(get_session)):
    q = select(Order).order_by(Order.created_at.asc())
    if status is not None:
        if status not in ORDER_STATUSES:
            raise AppError("VALIDATION_ERROR", f"status must be one of {', '.join(ORDER_STATUSES)}")
        q = q.where(Order.status == status)
    return [service.order_out(o) for o in session.scalars(q.limit(limit).offset(offset))]


@router.get("/orders/{order_id}/stl", response_class=Response, responses={200: {"content": {"model/stl": {}}}})
def order_stl(order_id: str, request: Request, session: Session = Depends(get_session)):
    o = _order(session, order_id)
    return Response(request.app.state.storage.get(o.stl_key), media_type="model/stl",
                    headers={"Content-Disposition": f'attachment; filename="{o.id}.stl"'})


@router.patch("/orders/{order_id}", response_model=OrderOut)
def update_order(order_id: str, body: AdminOrderUpdate, request: Request, background: BackgroundTasks,
                 session: Session = Depends(get_session)):
    st = request.app.state
    o = _order(session, order_id)
    if service.advance_order(session, o, body.status, body.tracking_number, body.note):
        background.add_task(service.notify, st.mailer, st.settings, o, "status")
    return service.order_out(o)


def _code_out(c: SponsorCode) -> dict:
    return {k: getattr(c, k) for k in ("code", "sponsor_name", "max_uses", "uses", "expires_at", "active",
                                       "created_at")}


@router.post("/sponsor-codes", response_model=SponsorCodeOut, status_code=201)
def create_code(body: SponsorCodeCreate, session: Session = Depends(get_session)):
    code = service.normalize_code(body.code) if body.code else "SPN-" + secrets.token_hex(4).upper()
    c = SponsorCode(code=code, sponsor_name=body.sponsor_name, max_uses=body.max_uses, expires_at=body.expires_at)
    session.add(c)
    try:
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        raise AppError("VALIDATION_ERROR", "This sponsor code already exists.", status=409) from exc
    return _code_out(c)


@router.get("/sponsor-codes", response_model=list[SponsorCodeOut])
def list_codes(session: Session = Depends(get_session)):
    return [_code_out(c) for c in session.scalars(select(SponsorCode).order_by(SponsorCode.created_at.desc()))]


@router.patch("/sponsor-codes/{code}", response_model=SponsorCodeOut)
def update_code(code: str, body: SponsorCodeUpdate, session: Session = Depends(get_session)):
    c = session.scalar(select(SponsorCode).where(SponsorCode.code == service.normalize_code(code)))
    if c is None:
        raise AppError("NOT_FOUND", "Sponsor code not found.")
    c.active = body.active
    session.commit()
    return _code_out(c)
