import json

from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response

from optiframe.api.common import run_compute
from optiframe.errors import AppError
from optiframe.geometry import engraving
from optiframe.geometry.pipeline import GenerationCache, GenerationResult, generate
from optiframe.ratelimit import rate_limited
from optiframe.schemas import Design

router = APIRouter(tags=["generation"])

STL_HEADERS = ["X-Volume-Mm3", "X-Max-Deviation-Mm", "X-Frame-Width-Mm", "X-Lens-Centers-Mm", "X-Design-Signature",
               "Content-Disposition"]


def _response(r: GenerationResult) -> Response:
    return Response(content=r.stl, media_type="model/stl", headers={
        "X-Volume-Mm3": f"{r.volume_mm3:.1f}",
        "X-Max-Deviation-Mm": f"{r.max_deviation_mm:.3f}",
        "X-Frame-Width-Mm": f"{r.frame_width_mm:.2f}",
        "X-Lens-Centers-Mm": json.dumps(r.lens_centers, separators=(",", ":")),
        "X-Design-Signature": r.signature,
        "Content-Disposition": 'attachment; filename="optiframe-frame.stl"',
    })


@router.post("/generate", response_class=Response, dependencies=[Depends(rate_limited)], responses={
    200: {"content": {"model/stl": {}}, "description": "Binary STL with metadata headers"}})
async def generate_stl(request: Request, design: Design):
    s = request.app.state.settings
    if design.engraving_text and (msg := engraving.validate_text(design.engraving_text)):
        raise AppError("ENGRAVING_INVALID", msg)
    d = design.model_dump(mode="json")
    cache: GenerationCache = request.app.state.generation_cache
    key = cache.key(d)
    result = cache.get(key)
    if result is None:
        result = await run_compute(request, generate, d, s.secret_key, timeout=s.generate_timeout_s)
        cache.put(key, result)
    return _response(result)
