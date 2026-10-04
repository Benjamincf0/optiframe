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
    # Thresholds from the gradient distribution (not brightness): clear lenses on light desks have faint edges.
    gx = cv2.Sobel(blurred, cv2.CV_32F, 1, 0)
    gy = cv2.Sobel(blurred, cv2.CV_32F, 0, 1)
    mag = np.hypot(gx, gy)
    vals = mag[allowed > 0]
    hi = float(np.clip(np.percentile(vals, 93), 12, 200)) if vals.size else 40.0
    edges = cv2.Canny(blurred, int(0.4 * hi), int(hi))
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


# Four contour proposals can all be fragments of a reflective lens on a textured
# surface.  Keep room for one independent Hough proposal as well: the segmenter
# still verifies every proposal before it is accepted.
MAX_CANDIDATES = 5
Box = tuple[float, float, float, float]


def _box_iou(a: Box, b: Box) -> float:
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union > 0 else 0.0


def locate_lens(bgr: np.ndarray, plane: Plane, hint_mm: Box | None) -> list[Box]:
    """Candidate lens boxes (x0, y0, x1, y1) in metric mm, best first.

    Candidates are only *proposals*: the caller verifies each with the segmentation model. With a hint, boxes inside
    the hint come first, followed by whole-photo candidates (the lens may not be where the user was told to put it).
    """
    if hint_mm is None:
        # Circle detection is deliberately only a *proposal* fallback for very
        # faint, round lenses.  EfficientSAM still verifies the result below in
        # the pipeline, so this does not turn classical edge detection into the
        # measuring algorithm.
        edges = _locate(bgr, plane, None)
        circles = _circle_candidates(bgr, plane)
        # Preserve the established contour proposals first.  The Hough path is
        # a fallback: on textured scenes it can return plausible circles that
        # are unrelated to the lens.
        out = edges[:]
        for box in circles:
            if all(_box_iou(box, existing) < 0.5 for existing in out):
                out.append(box)
        return out[:MAX_CANDIDATES]
    out = _locate(bgr, plane, hint_mm)[:2]  # leave room for whole-photo candidates
    for box in _locate(bgr, plane, None):
        if all(_box_iou(box, o) < 0.5 for o in out):
            out.append(box)
    hx0, hy0, hx1, hy1 = hint_mm
    if LENS_MIN_MM <= hx1 - hx0 <= LENS_MAX_MM + 20 and LENS_MIN_MM * 0.6 <= hy1 - hy0 <= LENS_MAX_MM + 20:
        out.append(hint_mm)
    return out[:MAX_CANDIDATES]


def _circle_candidates(bgr: np.ndarray, plane: Plane) -> list[Box]:
    """Return plausible circular-lens boxes as prompts for the segmenter.

    Clear lenses on a pale surface can have an outline too weak for the normal
    closed-contour locator, while still forming a stable Hough circle.  This is
    intentionally conservative and only supplies boxes; mask scoring remains
    responsible for accepting a lens.
    """
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape
    scale = min(1.0, 1600.0 / max(h, w))
    if scale < 1.0:
        gray = cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    small_h, small_w = gray.shape
    radius_min = max(20, int(min(small_h, small_w) * 0.10))
    radius_max = int(min(small_h, small_w) * 0.48)
    if radius_max <= radius_min:
        return []
    circles = cv2.HoughCircles(cv2.medianBlur(gray, 5), cv2.HOUGH_GRADIENT, 1.2,
                               minDist=max(40, int(min(small_h, small_w) * 0.20)),
                               param1=100, param2=30, minRadius=radius_min, maxRadius=radius_max)
    if circles is None:
        return []
    out: list[Box] = []
    ref = plane.ref_polygon_mm
    for cx, cy, radius in circles[0]:
        corners_px = np.array([[cx - radius, cy - radius], [cx + radius, cy + radius]], dtype=np.float64) / scale
        metric = plane.to_mm(corners_px)
        box = (float(metric[:, 0].min()), float(metric[:, 1].min()),
               float(metric[:, 0].max()), float(metric[:, 1].max()))
        width, height = box[2] - box[0], box[3] - box[1]
        if not (LENS_MIN_MM * 0.8 <= width <= LENS_MAX_MM and LENS_MIN_MM * 0.6 <= height <= LENS_MAX_MM):
            continue
        # A card's rounded corners can also produce a circle; never prompt the
        # segmenter with a circle centred on the reference itself.
        centre = np.array([[(box[0] + box[2]) / 2, (box[1] + box[3]) / 2]], dtype=np.float32)
        if cv2.pointPolygonTest(ref.astype(np.float32), tuple(centre[0]), False) >= 0:
            continue
        if all(_box_iou(box, existing) < 0.5 for existing in out):
            out.append(box)
        if len(out) == MAX_CANDIDATES:
            break
    return out


def _locate(bgr: np.ndarray, plane: Plane, hint_mm: Box | None) -> list[Box]:
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
    boxes: list[Box] = []
    for _, (x0, y0, x1, y1) in _candidates(gray, allowed, warp.scale):
        p = warp.px_to_mm(np.array([[x0, y0], [x1, y1]], dtype=np.float64))
        box = (float(p[0, 0]), float(p[0, 1]), float(p[1, 0]), float(p[1, 1]))
        if all(_box_iou(box, b) < 0.5 for b in boxes):
            boxes.append(box)
        if len(boxes) == MAX_CANDIDATES:
            break
    return boxes
