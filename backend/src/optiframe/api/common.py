"""Shared route helpers: bounded CPU work with deadlines, size-capped uploads, JSON form fields."""

import asyncio
import threading
import time
from collections.abc import Callable

from fastapi import Request, UploadFile
from pydantic import TypeAdapter, ValidationError
from starlette.concurrency import run_in_threadpool

from optiframe.errors import AppError


async def run_compute[T](request: Request, fn: Callable[..., T], *args, timeout: float) -> T:
    """Run CPU-bound work in the threadpool, limited by a global semaphore and a deadline."""
    sem: threading.BoundedSemaphore = request.app.state.compute_sem
    deadline = time.monotonic() + timeout

    def job() -> T:
        if not sem.acquire(timeout=max(0.0, deadline - time.monotonic())):
            raise AppError("SERVICE_UNAVAILABLE", "The server is busy. Please try again in a moment.")
        try:
            if time.monotonic() > deadline:
                raise AppError("PROCESSING_TIMEOUT")
            return fn(*args)
        finally:
            sem.release()

    try:
        return await asyncio.wait_for(run_in_threadpool(job), timeout)
    except TimeoutError as exc:
        raise AppError("PROCESSING_TIMEOUT") from exc


async def read_upload(file: UploadFile, max_bytes: int, *, side: str | None = None, code: str = "IMAGE_TOO_LARGE") -> bytes:
    chunks, total = [], 0
    while chunk := await file.read(1024 * 1024):
        total += len(chunk)
        if total > max_bytes:
            raise AppError(code, side=side) if code == "IMAGE_TOO_LARGE" else AppError(code)
        chunks.append(chunk)
    data = b"".join(chunks)
    if not data:
        raise AppError("VALIDATION_ERROR", f"The uploaded file '{file.filename or 'file'}' is empty.", side=side)
    return data


def parse_json_field[T](adapter: TypeAdapter[T], raw: str, field: str) -> T:
    try:
        return adapter.validate_json(raw)
    except ValidationError as exc:
        fields = [{"field": ".".join([field, *(str(p) for p in e["loc"])]), "message": e["msg"]} for e in exc.errors()]
        raise AppError("VALIDATION_ERROR", details={"fields": fields}) from exc
