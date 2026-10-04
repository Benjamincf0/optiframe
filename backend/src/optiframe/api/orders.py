from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, Header, Query, Request, UploadFile
from fastapi.responses import JSONResponse, Response
from pydantic import TypeAdapter
from sqlalchemy.orm import Session

from optiframe.api.common import parse_json_field, read_upload, run_compute
from optiframe.db import User, get_session
from optiframe.orders import service
from optiframe.orders.pricing import price
from optiframe.schemas import OrderCreate, OrderCreated, OrderOut, Quote, QuoteRequest
from optiframe.security import optional_user, order_access_token

router = APIRouter(tags=["orders"])

_order_adapter = TypeAdapter(OrderCreate)


def _token(t: str | None = Query(None, description="Order access token from the confirmation link"),
           x_order_token: str | None = Header(None)) -> str | None:
    return t or x_order_token


@router.post("/quote", response_model=Quote)
def quote(body: QuoteRequest, request: Request, session: Session = Depends(get_session)):
    s = request.app.state.settings
    sponsored = False
    if body.sponsor_code:
        service.check_sponsor_code(session, s, body.sponsor_code)
        sponsored = True
    return price(body.volume_mm3, body.material, s, sponsored=sponsored).as_quote()


@router.post("/orders", response_model=OrderCreated, status_code=201,
             responses={200: {"model": OrderCreated, "description": "Idempotent replay of an existing order"}})
async def create_order(
    request: Request,
    background: BackgroundTasks,
    stl: UploadFile = File(..., description="Binary STL returned by /api/generate"),
    order: str = Form(..., description="OrderCreate JSON"),
    idempotency_key: str | None = Header(None, max_length=255),
    user: User | None = Depends(optional_user),
    session: Session = Depends(get_session),
):
    s = request.app.state.settings
    payload = parse_json_field(_order_adapter, order, "order")
    data = await read_upload(stl, s.max_stl_bytes, code="PAYLOAD_TOO_LARGE")
    st = request.app.state

    def work():
        return service.create_order(session, s, payload=payload, stl=data, user=user,
                                    idempotency_key=idempotency_key, payments=st.payments, storage=st.storage)

    created, replayed = await run_compute(request, work, timeout=s.generate_timeout_s)
    if not replayed:
        background.add_task(service.notify, st.mailer, s, created, "confirmation")
    body = OrderCreated.model_validate(
        {**service.order_out(created), "access_token": order_access_token(s.secret_key, created.id)})
    return JSONResponse(body.model_dump(mode="json", by_alias=True), status_code=200 if replayed else 201)


@router.get("/orders/{order_id}", response_model=OrderOut)
def get_order(order_id: str, request: Request, token: str | None = Depends(_token),
              user: User | None = Depends(optional_user), session: Session = Depends(get_session)):
    o = service.get_accessible_order(session, request.app.state.settings, order_id, token, user)
    return service.order_out(o)


@router.post("/orders/{order_id}/cancel", response_model=OrderOut)
def cancel(order_id: str, request: Request, background: BackgroundTasks, token: str | None = Depends(_token),
           user: User | None = Depends(optional_user), session: Session = Depends(get_session)):
    st = request.app.state
    o = service.get_accessible_order(session, st.settings, order_id, token, user)
    o = service.cancel_order(session, st.payments, o)
    background.add_task(service.notify, st.mailer, st.settings, o, "status")
    return service.order_out(o)


@router.get("/orders/{order_id}/stl", response_class=Response,
            responses={200: {"content": {"model/stl": {}}}})
def download_stl(order_id: str, request: Request, token: str | None = Depends(_token),
                 user: User | None = Depends(optional_user), session: Session = Depends(get_session)):
    st = request.app.state
    o = service.get_accessible_order(session, st.settings, order_id, token, user)
    return Response(st.storage.get(o.stl_key), media_type="model/stl",
                    headers={"Content-Disposition": f'attachment; filename="{o.id}.stl"'})
