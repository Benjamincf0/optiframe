import asyncio
from functools import partial
from typing import Literal

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile
from pydantic import TypeAdapter

from optiframe.api.common import parse_json_field, read_upload, run_compute
from optiframe.catalog import REFERENCE_PRESETS
from optiframe.errors import AppError
from optiframe.measurement.pipeline import LensMeasurement, measure_lens
from optiframe.measurement.reference import ReferenceSpec
from optiframe.ratelimit import rate_limited
from optiframe.schemas import Hint, MeasureLensResponse, MeasureResponse, Reference

router = APIRouter(tags=["measurement"], dependencies=[Depends(rate_limited)])

_reference_adapter = TypeAdapter(Reference)
_hint_adapter = TypeAdapter(tuple[float, float, float, float])
ASYMMETRY_MM = 5.0


def _reference_spec(raw: str) -> ReferenceSpec:
    ref = parse_json_field(_reference_adapter, raw, "reference")
    if ref.type in REFERENCE_PRESETS:
        p = REFERENCE_PRESETS[ref.type]
        return ReferenceSpec("rect", p["width_mm"], p["height_mm"])
    if ref.type == "custom":
        return ReferenceSpec("rect", ref.width_mm, ref.height_mm)
    return ReferenceSpec("aruco", ref.marker_size_mm, ref.marker_size_mm, ref.dictionary)


def _hint(raw: str | None, field: str) -> tuple[float, float, float, float] | None:
    if not raw:
        return None
    box = parse_json_field(_hint_adapter, raw, field)
    try:
        return Hint(box=box).box
    except ValueError as exc:
        raise AppError("VALIDATION_ERROR", details={"fields": [{"field": field, "message": str(exc)}]}) from exc


async def _measure_one(request: Request, data: bytes, ref: ReferenceSpec, hint, side: str) -> LensMeasurement:
    s = request.app.state.settings
    segmenter = request.app.state.segmenter
    if segmenter is None:
        raise AppError("SERVICE_UNAVAILABLE", "Lens measurement is temporarily unavailable.")
    job = partial(measure_lens, data, ref, hint, side, segmenter, max_pixels=s.max_image_pixels,
                  segmentation_runs=s.segmentation_runs)
    return await run_compute(request, job, timeout=s.measure_timeout_s)


@router.post("/measure", response_model=MeasureResponse)
async def measure(
    request: Request,
    left_image: UploadFile = File(...),
    right_image: UploadFile = File(...),
    reference: str = Form(..., description='JSON, e.g. {"type":"credit_card"}'),
    left_hint: str | None = Form(None, description="JSON [x0,y0,x1,y1], normalised"),
    right_hint: str | None = Form(None, description="JSON [x0,y0,x1,y1], normalised"),
):
    s = request.app.state.settings
    ref = _reference_spec(reference)
    hints = {"left": _hint(left_hint, "left_hint"), "right": _hint(right_hint, "right_hint")}
    left = await read_upload(left_image, s.max_image_bytes, side="left")
    right = await read_upload(right_image, s.max_image_bytes, side="right")
    results = await asyncio.gather(
        _measure_one(request, left, ref, hints["left"], "left"),
        _measure_one(request, right, ref, hints["right"], "right"),
        return_exceptions=True,
    )
    for r in results:  # report the left lens's error first, deterministically
        if isinstance(r, BaseException):
            raise r
    lm, rm = results
    asym = (abs(lm.result["A"] - rm.result["A"]) > ASYMMETRY_MM or
            abs(lm.result["B"] - rm.result["B"]) > ASYMMETRY_MM)
    return {"left": lm.result, "right": rm.result, "asymmetric": asym, "warnings": lm.warnings + rm.warnings}


@router.post("/measure/lens", response_model=MeasureLensResponse)
async def measure_single(
    request: Request,
    side: Literal["left", "right"] = Form(...),
    image: UploadFile = File(...),
    reference: str = Form(...),
    hint: str | None = Form(None),
):
    s = request.app.state.settings
    ref = _reference_spec(reference)
    h = _hint(hint, "hint")
    data = await read_upload(image, s.max_image_bytes, side=side)
    m = await _measure_one(request, data, ref, h, side)
    return {"side": side, "lens": m.result, "warnings": m.warnings}
