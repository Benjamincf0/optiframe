"""FastAPI application factory."""

import logging
import threading
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from optiframe.api import accounts, admin, generate, measure, meta, orders
from optiframe.config import Settings, get_settings
from optiframe.db import Database
from optiframe.errors import install_handlers
from optiframe.geometry.pipeline import GenerationCache
from optiframe.measurement.segment import load_segmenter
from optiframe.orders.adapters import FakePaymentProvider, LocalStorage, make_mailer
from optiframe.ratelimit import RateLimiter

log = logging.getLogger("optiframe")


def create_app(settings: Settings | None = None, *, load_model: bool = True) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.db.create_all()
        if load_model and app.state.segmenter is None:
            app.state.segmenter = load_segmenter(settings.model_path)
        if settings.secret_key == "dev-insecure-secret-change-me":
            log.warning("Using the development secret key. Set OPTIFRAME_SECRET_KEY before deploying.")
        yield
        app.state.db.engine.dispose()

    app = FastAPI(title="OptiFrame API", version="0.1.0", lifespan=lifespan,
                  docs_url="/api/docs", openapi_url="/api/openapi.json", redoc_url=None)
    app.state.settings = settings
    app.state.db = Database(settings.database_url)
    app.state.segmenter = None
    app.state.storage = LocalStorage(settings.storage_dir)
    app.state.payments = FakePaymentProvider()
    app.state.mailer = make_mailer(settings)
    app.state.compute_sem = threading.BoundedSemaphore(settings.max_concurrent_jobs)
    app.state.rate_limiter = RateLimiter(settings.rate_limit_per_minute)
    app.state.generation_cache = GenerationCache(settings.generate_cache_size)

    install_handlers(app)

    @app.middleware("http")
    async def request_id(request: Request, call_next):
        rid = request.headers.get("x-request-id") or uuid.uuid4().hex
        request.state.request_id = rid[:64]
        response = await call_next(request)
        response.headers["X-Request-ID"] = request.state.request_id
        return response

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST", "PATCH", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "Idempotency-Key", "X-Order-Token", "X-Admin-Key",
                       "X-Request-ID"],
        expose_headers=[*generate.STL_HEADERS, "X-Request-ID"],
        max_age=600,
    )

    for r in (meta.router, measure.router, generate.router, orders.router, accounts.router, admin.router):
        app.include_router(r, prefix="/api")
    return app

