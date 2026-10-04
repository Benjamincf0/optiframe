"""Find a tight bounding box around the lens in the metric plane, used as the segmentation prompt.

This only *locates* the lens. The outline itself comes from the segmentation model.
"""

import cv2
import numpy as np

from optiframe.measurement.rectify import Plane, warp_region

OVERVIEW_SCALE = 2.0  # px/mm
OVERVIEW_HALF_MM = 250.0
LENS_MIN_MM, LENS_MAX_MM = 25.0, 90.0
SMALL_REFERENCE_MM = 150.0  # references smaller than this can't have the lens on top of them


def _reference_mask(plane: Plane, warp, shape) -> np.ndarray:
    mask = np.zeros(shape, np.uint8)
    poly_px = warp.mm_to_px(plane.ref_polygon_mm).astype(np.int32)
    size = np.ptp(plane.ref_polygon_mm, axis=0).max()
    # Markers are printed with a white quiet zone (often ~25 % of the marker size) that must be masked too.
    pad_mm = 6.0 + (0.4 * size if plane.ref_is_marker else 0.0)
    pad = int(round(pad_mm * warp.scale))
    if size <= SMALL_REFERENCE_MM:
        cv2.fillPoly(mask, [poly_px], 255)
        mask = cv2.dilate(mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * pad + 1, 2 * pad + 1)))
    else:
        cv2.polylines(mask, [poly_px], True, 255, thickness=2 * pad)
    return mask


def _candidates(gray: np.ndarray, allowed: np.ndarray, scale: float) -> list[tuple[float, tuple]]:
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    med = float(np.median(blurred[allowed > 0])) if np.any(allowed) else 128.0
    edges = cv2.Canny(blurred, int(max(8, 0.33 * med)), int(min(255, max(30, 0.9 * med))))
    edges[allowed == 0] = 0
    k = max(3, int(round(1.5 * scale)) | 1)
    closed = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))
    contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    out = []
    for c in contours:
        x, y, w, h = cv2.boundingRect(c)
        wmm, hmm = w / scale, h / scale
        if not (LENS_MIN_MM * 0.8 <= wmm <= LENS_MAX_MM and LENS_MIN_MM * 0.6 <= hmm <= LENS_MAX_MM):
            continue
        if not 0.45 <= wmm / hmm <= 2.6:
            continue
        hull = cv2.convexHull(c)
        fill = cv2.contourArea(hull) / float(w * h)
        if fill < 0.5:
            continue
        # How much of the hull boundary is backed by edges: lenses produce a closed ring.
        ring = np.zeros_like(edges)
        cv2.drawContours(ring, [hull], -1, 255, thickness=max(3, k))
        support = float(np.count_nonzero(edges & ring)) / max(1.0, cv2.arcLength(hull, True))
        score = fill * min(1.0, support) * np.sqrt(wmm * hmm)
        out.append((score, (x, y, x + w, y + h)))
    return sorted(out, reverse=True)


def locate_lens(bgr: np.ndarray, plane: Plane, hint_mm: tuple[float, float, float, float] | None
                ) -> tuple[float, float, float, float] | None:
    """Return the lens box (x0, y0, x1, y1) in metric mm, or None."""
    if hint_mm is not None:
        hx0, hy0, hx1, hy1 = hint_mm
        pad = 6.0
        region = (hx0 - pad, hy0 - pad, hx1 + pad, hy1 + pad)
    else:
        cx, cy = plane.ref_center_mm
        region = (cx - OVERVIEW_HALF_MM, cy - OVERVIEW_HALF_MM, cx + OVERVIEW_HALF_MM, cy + OVERVIEW_HALF_MM)

    warp = warp_region(bgr, plane, region, OVERVIEW_SCALE if hint_mm is None else 4.0)
    gray = cv2.cvtColor(warp.image, cv2.COLOR_BGR2GRAY)
    allowed = cv2.erode(warp.valid, np.ones((7, 7), np.uint8))
    allowed[_reference_mask(plane, warp, gray.shape) > 0] = 0
    cands = _candidates(gray, allowed, warp.scale)
    if cands:
        x0, y0, x1, y1 = cands[0][1]
        p = warp.px_to_mm(np.array([[x0, y0], [x1, y1]], dtype=np.float64))
        return (p[0, 0], p[0, 1], p[1, 0], p[1, 1])
    if hint_mm is not None:
        hx0, hy0, hx1, hy1 = hint_mm
        if LENS_MIN_MM <= hx1 - hx0 <= LENS_MAX_MM + 20 and LENS_MIN_MM * 0.6 <= hy1 - hy0 <= LENS_MAX_MM + 20:
            return hint_mm
    return None
