from fastapi import APIRouter, Request

from optiframe import catalog
from optiframe.geometry import frame as F

router = APIRouter(tags=["meta"])


@router.get("/health")
def health(request: Request) -> dict:
    model_loaded = request.app.state.segmenter is not None
    return {"status": "ok" if model_loaded else "degraded", "model_loaded": model_loaded}


@router.get("/options")
def options(request: Request) -> dict:
    s = request.app.state.settings
    return {
        "references": {
            **{k: {**v, "type": k} for k, v in catalog.REFERENCE_PRESETS.items()},
            "aruco": {"type": "aruco", "label": "ArUco marker", "dictionaries": catalog.ARUCO_DICTIONARIES},
            "custom": {"type": "custom", "label": "Custom rectangle"},
        },
        "params": catalog.PARAM_RANGES,
        "patterns": catalog.PATTERNS,
        "colors": catalog.COLORS,
        "materials": [
            {"id": k, "label": v["label"], "description": v["description"], "recommended": v["recommended"],
             "price_per_g": float(v["price_per_g"]), "density_g_cm3": float(v["density"])}
            for k, v in catalog.MATERIALS.items()
        ],
        "shipping_flat": float(s.shipping_flat),
        "currency": s.currency,
        "engraving": {
            "max_chars": catalog.ENGRAVING_MAX_CHARS,
            "allowed": "letters (incl. accented Latin), digits, space and " + catalog.ENGRAVING_EXTRA_CHARS.strip(),
            "depth_mm": catalog.ENGRAVING_DEPTH_MM,
            "location": "inner (back) face of the right temple tenon",
        },
        "frame": {"wall_mm": F.WALL_MM, "lip_overlap_mm": F.LIP_OVERLAP_MM, "max_width_mm": F.MAX_BED_MM},
        "sponsorship_enabled": s.sponsorship_enabled,
        "min_image_megapixels": 1.0,
    }
