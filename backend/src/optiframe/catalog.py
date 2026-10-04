"""Static product catalog: the single source of truth published by GET /api/options."""

from decimal import Decimal
from typing import Literal

Pattern = Literal["none", "woven", "honeycomb", "brushed", "dots"]
Material = Literal["petg", "pla", "asa"]
Color = Literal["matte_black", "tortoiseshell", "crystal", "navy", "bone", "olive"]

PATTERNS: list[dict] = [
    {"id": "none", "label": "None"},
    {"id": "woven", "label": "Woven"},
    {"id": "honeycomb", "label": "Honeycomb"},
    {"id": "brushed", "label": "Brushed"},
    {"id": "dots", "label": "Dots"},
]

COLORS: list[dict] = [
    {"id": "matte_black", "label": "Matte black", "hex": "#1c1c1e"},
    {"id": "tortoiseshell", "label": "Tortoiseshell", "hex": "#6b3e1f"},
    {"id": "crystal", "label": "Crystal", "hex": "#e6eef2", "translucent": True},
    {"id": "navy", "label": "Navy", "hex": "#1f2a44"},
    {"id": "bone", "label": "Bone", "hex": "#e9e1d0"},
    {"id": "olive", "label": "Olive", "hex": "#5b5e3a"},
]

# density in g/cm³, price per gram in currency units
MATERIALS: dict[str, dict] = {
    "petg": {"label": "PETG", "description": "Flexible and UV resistant", "recommended": True,
             "density": Decimal("1.27"), "price_per_g": Decimal("0.12")},
    "pla": {"label": "PLA", "description": "Rigid, best detail", "recommended": False,
            "density": Decimal("1.24"), "price_per_g": Decimal("0.10")},
    "asa": {"label": "ASA", "description": "Outdoor use, UV stable", "recommended": False,
            "density": Decimal("1.07"), "price_per_g": Decimal("0.15")},
}

# min, max, step, default
PARAM_RANGES: dict[str, dict] = {
    "bridge_mm": {"min": 12.0, "max": 30.0, "step": 0.5, "default": 18.0},
    "depth_mm": {"min": 3.0, "max": 8.0, "step": 0.5, "default": 5.0},
    "rim_offset_mm": {"min": 0.5, "max": 3.0, "step": 0.1, "default": 1.5},
    "clip_clearance_mm": {"min": 0.1, "max": 0.3, "step": 0.05, "default": 0.2},
}

REFERENCE_PRESETS: dict[str, dict] = {
    "credit_card": {"label": "Credit card", "width_mm": 85.60, "height_mm": 53.98},
    "a4": {"label": "A4 sheet", "width_mm": 297.0, "height_mm": 210.0},
}

ARUCO_DICTIONARIES = [
    "DICT_4X4_50", "DICT_4X4_100", "DICT_4X4_250", "DICT_4X4_1000",
    "DICT_5X5_50", "DICT_5X5_100", "DICT_5X5_250", "DICT_5X5_1000",
    "DICT_6X6_50", "DICT_6X6_100", "DICT_6X6_250", "DICT_6X6_1000",
    "DICT_7X7_50", "DICT_7X7_100", "DICT_7X7_250", "DICT_7X7_1000",
    "DICT_ARUCO_ORIGINAL",
]

ENGRAVING_MAX_CHARS = 8
# Letters (incl. common accented Latin), digits, space and a few safe punctuation marks.
# Each must also exist in the bundled font (checked at generation time).
ENGRAVING_EXTRA_CHARS = " -.'&+!?"
ENGRAVING_DEPTH_MM = 0.4

ORDER_STATUSES = ["received", "printing", "shipped", "delivered", "cancelled"]
STATUS_FLOW = ["received", "printing", "shipped", "delivered"]
