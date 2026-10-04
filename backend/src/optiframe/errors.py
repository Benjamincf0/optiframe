"""Uniform error envelope: {"error": {"code", "message", "side"?, "details"?}}."""

import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

log = logging.getLogger("optiframe")

# code -> (http status, default human-readable message)
ERRORS: dict[str, tuple[int, str]] = {
    # measurement
    "REF_NOT_FOUND": (422, "We couldn't find the reference object. Make sure it's flat, fully visible, and all four corners are in the photo."),
    "LENS_NOT_FOUND": (422, "We couldn't find the lens. Place it inside the lens zone on a plain, contrasting surface and retake the photo."),
    "IMAGE_TOO_BLURRY": (422, "The photo is too blurry to measure accurately. Hold the phone steady and tap to focus before capturing."),
    "ANGLE_TOO_STEEP": (422, "The photo was taken at too steep an angle. Hold the phone directly above the lens, parallel to the table."),
    "INVALID_IMAGE": (422, "This file couldn't be read as an image. Please use a JPEG, PNG, WebP or HEIC photo."),
    "IMAGE_TOO_LARGE": (413, "This photo is too large. Please use an image under 15 MB."),
    # generation
    "INVALID_CONTOUR": (422, "The lens outline is invalid. Please retake the lens photos."),
    "ENGRAVING_INVALID": (422, "This engraving can't be printed. Use up to 8 letters, numbers or simple punctuation."),
    "GEOMETRY_FAILED": (500, "We couldn't build a frame for these settings. Try adjusting the frame parameters."),
    "MESH_INVALID": (422, "Frame mesh is invalid — please regenerate."),
    # commerce
    "DESIGN_SIGNATURE_INVALID": (422, "This frame file doesn't match the design. Please regenerate the frame."),
    "SPONSOR_CODE_INVALID": (422, "This sponsor code is invalid, expired, or fully used."),
    "SPONSORSHIP_DISABLED": (422, "Sponsored orders are not available."),
    "PAYMENT_REQUIRED": (422, "Payment details are required for this order."),
    "PAYMENT_FAILED": (402, "Your payment was declined. Please try another payment method."),
    "ORDER_NOT_FOUND": (404, "We couldn't find this order."),
    "ORDER_NOT_CANCELLABLE": (409, "This order can no longer be cancelled because printing has started."),
    "INVALID_STATUS_TRANSITION": (409, "This status change is not allowed."),
    "IDEMPOTENCY_CONFLICT": (409, "This request was already submitted with different details."),
    # auth
    "EMAIL_TAKEN": (409, "An account with this email already exists."),
    "INVALID_CREDENTIALS": (401, "Incorrect email or password."),
    "UNAUTHORIZED": (401, "Please sign in to continue."),
    "FORBIDDEN": (403, "You don't have access to this resource."),
    # generic
    "VALIDATION_ERROR": (422, "Some fields are invalid."),
    "NOT_FOUND": (404, "Not found."),
    "METHOD_NOT_ALLOWED": (405, "Method not allowed."),
    "PAYLOAD_TOO_LARGE": (413, "The upload is too large."),
    "RATE_LIMITED": (429, "Too many requests. Please wait a minute and try again."),
    "PROCESSING_TIMEOUT": (503, "Processing took too long. Please try again."),
    "SERVICE_UNAVAILABLE": (503, "The service is temporarily unavailable. Please try again shortly."),
    "INTERNAL_ERROR": (500, "Something went wrong on our side. Please try again."),
}


class AppError(Exception):
    def __init__(
        self,
        code: str,
        message: str | None = None,
        *,
        side: str | None = None,
        details: dict[str, Any] | None = None,
        status: int | None = None,
    ):
        default_status, default_message = ERRORS[code]
        self.code = code
        self.status = status or default_status
        self.message = message or default_message
        self.side = side
        self.details = details or {}
        super().__init__(f"{code}: {self.message}")


def error_body(code: str, message: str, side: str | None = None, details: dict | None = None) -> dict:
    err: dict[str, Any] = {"code": code, "message": message}
    if side:
        err["side"] = side
    if details:
        err["details"] = details
    return {"error": err}


_HTTP_CODES = {404: "NOT_FOUND", 405: "METHOD_NOT_ALLOWED", 413: "PAYLOAD_TOO_LARGE", 401: "UNAUTHORIZED", 403: "FORBIDDEN"}


def install_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(request: Request, exc: AppError):
        log.warning("%s %s -> %d %s%s %s%s", request.method, request.url.path, exc.status, exc.code,
                    f" side={exc.side}" if exc.side else "", exc.message,
                    f" details={exc.details}" if exc.details else "")
        return JSONResponse(error_body(exc.code, exc.message, exc.side, exc.details), status_code=exc.status)

    @app.exception_handler(RequestValidationError)
    async def _validation(request: Request, exc: RequestValidationError):
        fields = [
            {"field": ".".join(str(p) for p in e.get("loc", ()) if p not in ("body",)), "message": e.get("msg", "")}
            for e in exc.errors()
        ]
        code, (status, message) = "VALIDATION_ERROR", ERRORS["VALIDATION_ERROR"]
        log.warning("%s %s -> %d %s fields=%s", request.method, request.url.path, status, code, fields)
        return JSONResponse(error_body(code, message, details={"fields": fields}), status_code=status)

    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, exc: StarletteHTTPException):
        code = _HTTP_CODES.get(exc.status_code, "INTERNAL_ERROR" if exc.status_code >= 500 else "VALIDATION_ERROR")
        message = ERRORS[code][1]
        return JSONResponse(error_body(code, message), status_code=exc.status_code, headers=getattr(exc, "headers", None))

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception):
        log.exception("Unhandled error on %s %s (request %s)", request.method, request.url.path,
                      getattr(request.state, "request_id", "-"))
        status, message = ERRORS["INTERNAL_ERROR"]
        return JSONResponse(error_body("INTERNAL_ERROR", message), status_code=status)
