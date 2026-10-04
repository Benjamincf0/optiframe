"""Design → validated binary STL, with metadata, signature and an in-memory LRU cache."""

import hashlib
import hmac
import json
import threading
from collections import OrderedDict
from dataclasses import dataclass

import numpy as np
from shapely.geometry import Polygon

from optiframe.errors import AppError
from optiframe.geometry.frame import FrameSpec, build_frame
from optiframe.geometry.validate import check_mesh, manifold_to_trimesh, stl_bytes


@dataclass(frozen=True)
class GenerationResult:
    stl: bytes
    volume_mm3: float
    max_deviation_mm: float
    frame_width_mm: float
    lens_centers: dict
    signature: str


def canonical_design(design: dict) -> bytes:
    return json.dumps(design, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()


def sign_design(secret: str, stl: bytes, design: dict) -> str:
    msg = hashlib.sha256(stl).hexdigest().encode() + b"." + canonical_design(design)
    return hmac.new(secret.encode(), msg, hashlib.sha256).hexdigest()


def verify_design(secret: str, stl: bytes, design: dict, signature: str) -> bool:
    return hmac.compare_digest(sign_design(secret, stl, design), signature or "")


def _seat_deviation(model) -> float:
    """Hausdorff distance between each lens contour and the actual seat opening in the mesh."""
    section = model.manifold.slice(model.seat_z)
    rings = [Polygon(np.asarray(r)) for r in section.to_polygons() if len(r) >= 3]
    worst = 0.0
    for lens in (model.right_contour, model.left_contour):
        c = lens.centroid
        candidates = [r for r in rings if r.is_valid and r.contains(c) and r.area < lens.area * 1.5]
        if not candidates:
            raise AppError("MESH_INVALID", "The lens seat could not be verified in the generated mesh.")
        seat = min(candidates, key=lambda r: abs(r.area - lens.area))
        worst = max(worst, seat.exterior.hausdorff_distance(lens.exterior))
    return worst


def generate(design: dict, secret: str) -> GenerationResult:
    spec = FrameSpec(
        right=np.asarray(design["right_contour_mm"], dtype=np.float64),
        left=np.asarray(design["left_contour_mm"], dtype=np.float64),
        bridge_mm=design["bridge_mm"], depth_mm=design["depth_mm"], rim_offset_mm=design["rim_offset_mm"],
        clip_clearance_mm=design["clip_clearance_mm"], pattern=design["pattern"],
        engraving_text=design.get("engraving_text", ""),
    )
    try:
        model = build_frame(spec)
        mesh = manifold_to_trimesh(model.manifold)
    except AppError:
        raise
    except Exception as exc:
        raise AppError("GEOMETRY_FAILED") from exc
    report = check_mesh(mesh)
    if not report.ok:
        raise AppError("MESH_INVALID", details={"problems": report.problems})
    deviation = _seat_deviation(model)
    data = stl_bytes(mesh)
    return GenerationResult(
        stl=data, volume_mm3=report.volume_mm3, max_deviation_mm=deviation,
        frame_width_mm=report.extents_mm[0], lens_centers=model.lens_centers,
        signature=sign_design(secret, data, design),
    )


class GenerationCache:
    def __init__(self, size: int):
        self.size = size
        self._items: OrderedDict[str, GenerationResult] = OrderedDict()
        self._lock = threading.Lock()

    @staticmethod
    def key(design: dict) -> str:
        return hashlib.sha256(canonical_design(design)).hexdigest()

    def get(self, key: str) -> GenerationResult | None:
        with self._lock:
            item = self._items.get(key)
            if item is not None:
                self._items.move_to_end(key)
            return item

    def put(self, key: str, value: GenerationResult) -> None:
        if self.size <= 0:
            return
        with self._lock:
            self._items[key] = value
            self._items.move_to_end(key)
            while len(self._items) > self.size:
                self._items.popitem(last=False)


