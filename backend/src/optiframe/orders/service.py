"""Order lifecycle: creation (validate → price → sponsor/charge → persist), access, cancel, fulfilment."""

import hashlib
import json
import logging
import secrets
from datetime import date, datetime, timedelta

from sqlalchemy import and_, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from optiframe.catalog import STATUS_FLOW
from optiframe.config import Settings
from optiframe.db import Order, OrderEvent, SponsorCode, User, utcnow
from optiframe.errors import AppError
from optiframe.geometry.pipeline import verify_design
from optiframe.geometry.validate import check_mesh, load_stl
from optiframe.orders.adapters import LocalStorage, Mailer, PaymentProvider
from optiframe.orders.pricing import price
from optiframe.schemas import OrderCreate
from optiframe.security import check_order_token, order_access_token

log = logging.getLogger("optiframe")

_ID_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"  # no 0/O, 1/I/L


def new_order_id() -> str:
    return "OF-" + "".join(secrets.choice(_ID_ALPHABET) for _ in range(6))


def normalize_code(code: str) -> str:
    return code.strip().upper()


# ---------------------------------------------------------------------------- sponsor codes


def _code_usable_clause(now: datetime):
    return and_(SponsorCode.active.is_(True), SponsorCode.uses < SponsorCode.max_uses,
                or_(SponsorCode.expires_at.is_(None), SponsorCode.expires_at > now))


def check_sponsor_code(session: Session, settings: Settings, code: str) -> SponsorCode:
    if not settings.sponsorship_enabled:
        raise AppError("SPONSORSHIP_DISABLED")
    row = session.scalar(select(SponsorCode).where(SponsorCode.code == normalize_code(code),
                                                   _code_usable_clause(utcnow())))
    if row is None:
        raise AppError("SPONSOR_CODE_INVALID")
    return row


def _reserve_sponsor_code(session: Session, settings: Settings, code: str) -> int:
    """Atomically consume one use of a sponsor code; returns its id."""
    if not settings.sponsorship_enabled:
        raise AppError("SPONSORSHIP_DISABLED")
    norm = normalize_code(code)
    res = session.execute(update(SponsorCode).where(SponsorCode.code == norm, _code_usable_clause(utcnow()))
                          .values(uses=SponsorCode.uses + 1))
    if res.rowcount != 1:
        raise AppError("SPONSOR_CODE_INVALID")
    return session.scalar(select(SponsorCode.id).where(SponsorCode.code == norm))


# ---------------------------------------------------------------------------- serialisation


def _lens_summary(contour: list) -> dict:
    xs = [p[0] for p in contour]
    ys = [p[1] for p in contour]
    return {"A": round(max(xs) - min(xs), 1), "B": round(max(ys) - min(ys), 1)}


def order_out(order: Order) -> dict:
    return {
        "order_id": order.id,
        "status": order.status,
        "created_at": order.created_at,
        "email": order.email,
        "shipping_address": order.shipping_address,
        "specs": order.specs,
        "pricing": {
            "grams": order.grams, "material_cost": order.material_cents / 100,
            "shipping": order.shipping_cents / 100, "discount": order.discount_cents / 100,
            "total": order.total_cents / 100, "currency": order.currency,
            "sponsored": order.sponsor_code_id is not None,
        },
        "estimated_delivery": {"from_": order.delivery_from, "to": order.delivery_to},
        "tracking_number": order.tracking_number,
        "can_cancel": order.status == "received",
        "timeline": [{"status": e.status, "at": e.created_at, "note": e.note} for e in order.events],
    }


def order_link(settings: Settings, order_id: str) -> str:
    return f"{settings.frontend_url.rstrip('/')}/order/{order_id}?t={order_access_token(settings.secret_key, order_id)}"


def _confirmation_email(settings: Settings, order: Order) -> tuple[str, str]:
    total = f"{order.total_cents / 100:.2f} {order.currency}"
    body = (
        f"Thank you for your order {order.id}!\n\n"
        f"Total: {total}{' (sponsored)' if order.sponsor_code_id else ''}\n"
        f"Estimated delivery: {order.delivery_from:%d %b} – {order.delivery_to:%d %b %Y}\n\n"
        f"Track your order and download your frame file:\n{order_link(settings, order.id)}\n"
    )
    return f"OptiFrame order {order.id} confirmed", body


def _status_email(settings: Settings, order: Order) -> tuple[str, str]:
    lines = [f"Your order {order.id} is now: {order.status}."]
    if order.tracking_number:
        lines.append(f"Tracking number: {order.tracking_number}")
    lines.append(f"\nDetails: {order_link(settings, order.id)}")
    return f"OptiFrame order {order.id}: {order.status}", "\n".join(lines) + "\n"


# ---------------------------------------------------------------------------- create


def _request_hash(payload: OrderCreate, stl: bytes) -> str:
    h = hashlib.sha256(json.dumps(payload.model_dump(mode="json"), sort_keys=True).encode())
    h.update(hashlib.sha256(stl).digest())
    return h.hexdigest()


def create_order(session: Session, settings: Settings, *, payload: OrderCreate, stl: bytes, user: User | None,
                 idempotency_key: str | None, payments: PaymentProvider, storage: LocalStorage
                 ) -> tuple[Order, bool]:
    """Returns (order, replayed). Mesh is validated before any charge (FR-CHK-06)."""
    req_hash = _request_hash(payload, stl)
    if idempotency_key:
        existing = session.scalar(select(Order).where(Order.idempotency_key == idempotency_key))
        if existing is not None:
            if existing.request_hash != req_hash:
                raise AppError("IDEMPOTENCY_CONFLICT")
            return existing, True

    design = payload.design.model_dump(mode="json")
    if not verify_design(settings.secret_key, stl, design, payload.design_signature):
        raise AppError("DESIGN_SIGNATURE_INVALID")
    mesh = load_stl(stl)
    report = check_mesh(mesh) if mesh is not None else None
    if report is None or not report.ok:
        raise AppError("MESH_INVALID", details={"problems": report.problems if report else ["unreadable STL"]})

    sponsor_id = None
    if payload.sponsor_code:
        sponsor_id = _reserve_sponsor_code(session, settings, payload.sponsor_code)
    pricing = price(report.volume_mm3, payload.material, settings, sponsored=sponsor_id is not None)

    charge_ref = None
    if pricing.total_cents > 0:
        if payload.payment is None:
            session.rollback()
            raise AppError("PAYMENT_REQUIRED")
        charge_ref = payments.charge(pricing.total_cents, pricing.currency, payload.payment.token,
                                     "OptiFrame custom frame")

    today = date.today()
    lead = settings.production_days
    stl_sha = hashlib.sha256(stl).hexdigest()
    specs = {
        "left_lens": _lens_summary(design["left_contour_mm"]),
        "right_lens": _lens_summary(design["right_contour_mm"]),
        **{k: design[k] for k in ("bridge_mm", "depth_mm", "rim_offset_mm", "clip_clearance_mm", "pattern",
                                  "engraving_text")},
        "material": payload.material, "color": payload.color,
    }
    stored_key = None
    try:
        for _ in range(5):
            order_id = new_order_id()
            if session.get(Order, order_id) is None:
                break
        stored_key = f"orders/{order_id}.stl"
        storage.put(stored_key, stl)
        order = Order(
            id=order_id, user_id=user.id if user else None, email=str(payload.email).lower(),
            shipping_address=payload.shipping_address.model_dump(mode="json"), design=design, specs=specs,
            material=payload.material, color=payload.color, volume_mm3=report.volume_mm3, grams=pricing.grams,
            material_cents=pricing.material_cents, shipping_cents=pricing.shipping_cents,
            discount_cents=pricing.discount_cents, total_cents=pricing.total_cents, currency=pricing.currency,
            status="received", sponsor_code_id=sponsor_id,
            payment_provider=payments.name if charge_ref else None, payment_ref=charge_ref,
            stl_key=stored_key, stl_sha256=stl_sha,
            delivery_from=today + timedelta(days=lead + settings.shipping_days_min),
            delivery_to=today + timedelta(days=lead + settings.shipping_days_max),
            idempotency_key=idempotency_key, request_hash=req_hash,
        )
        order.events.append(OrderEvent(status="received", note="Order placed"))
        session.add(order)
        if user is not None:
            user.shipping_address = order.shipping_address
        session.commit()
    except Exception as exc:
        session.rollback()
        if charge_ref:
            payments.refund(charge_ref, pricing.total_cents)
        if stored_key:
            storage.delete(stored_key)
        if isinstance(exc, IntegrityError) and idempotency_key:
            existing = session.scalar(select(Order).where(Order.idempotency_key == idempotency_key))
            if existing is not None and existing.request_hash == req_hash:
                return existing, True
            raise AppError("IDEMPOTENCY_CONFLICT") from exc
        raise
    return order, False


# ---------------------------------------------------------------------------- access / cancel / fulfil


def get_accessible_order(session: Session, settings: Settings, order_id: str, token: str | None,
                         user: User | None) -> Order:
    order = session.get(Order, order_id.upper())
    if order is None:
        raise AppError("ORDER_NOT_FOUND")
    owner_ok = user is not None and order.user_id == user.id
    if not owner_ok and not check_order_token(settings.secret_key, order.id, token):
        raise AppError("ORDER_NOT_FOUND")  # don't reveal that the order exists
    return order


def cancel_order(session: Session, payments: PaymentProvider, order: Order) -> Order:
    # Conditional update guards against a concurrent status change (e.g. admin starts printing).
    res = session.execute(update(Order).where(Order.id == order.id, Order.status == "received")
                          .values(status="cancelled", updated_at=utcnow()))
    if res.rowcount != 1:
        session.rollback()
        raise AppError("ORDER_NOT_CANCELLABLE")
    if order.payment_ref:
        order.refund_ref = payments.refund(order.payment_ref, order.total_cents)
    if order.sponsor_code_id:
        session.execute(update(SponsorCode).where(SponsorCode.id == order.sponsor_code_id, SponsorCode.uses > 0)
                        .values(uses=SponsorCode.uses - 1))
    order.events.append(OrderEvent(status="cancelled", note="Cancelled by customer"))
    session.commit()
    session.refresh(order)
    return order


def advance_order(session: Session, order: Order, status: str | None, tracking: str | None,
                  note: str | None) -> bool:
    """Admin update. Returns True if the status changed."""
    changed = False
    if status is not None and status != order.status:
        if order.status not in STATUS_FLOW or STATUS_FLOW.index(status) <= STATUS_FLOW.index(order.status):
            raise AppError("INVALID_STATUS_TRANSITION",
                           f"Can't move an order from '{order.status}' to '{status}'.")
        res = session.execute(update(Order).where(Order.id == order.id, Order.status == order.status)
                              .values(status=status, updated_at=utcnow()))
        if res.rowcount != 1:
            session.rollback()
            raise AppError("INVALID_STATUS_TRANSITION", "The order changed meanwhile; reload and retry.")
        order.events.append(OrderEvent(status=status, note=note))
        changed = True
    if tracking is not None:
        order.tracking_number = tracking
    session.commit()
    session.refresh(order)
    return changed


def notify(mailer: Mailer, settings: Settings, order: Order, kind: str) -> None:
    subject, body = (_confirmation_email if kind == "confirmation" else _status_email)(settings, order)
    mailer.send(order.email, subject, body)
