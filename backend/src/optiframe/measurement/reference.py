"""Reference object detection: ArUco markers and known-size rectangles (card, A4, custom).

Returns the reference's four image corners ordered clockwise on screen, with side 0→1 mapping to
the reference *width*, so that the metric homography never mirrors the image.
"""

from dataclasses import dataclass

import cv2
import numpy as np
from scipy.ndimage import gaussian_filter, map_coordinates

from optiframe.errors import AppError


@dataclass(frozen=True)
class ReferenceSpec:
    kind: str  # "aruco" | "rect"
    width_mm: float
    height_mm: float
    aruco_dictionary: str | None = None


@dataclass
class DetectedReference:
    corners: np.ndarray  # (4, 2) float64, image px, clockwise on screen, side 0→1 = width
    width_mm: float
    height_mm: float
    corner_sigma_px: float  # localisation uncertainty of a corner
    edge_width_px: float | None  # 10–90 % edge rise, for blur assessment
    px_per_mm: float  # source resolution at the reference
    is_marker: bool = False  # printed markers carry a white quiet zone around them


# ---------------------------------------------------------------------------- helpers


def order_clockwise(pts: np.ndarray) -> np.ndarray:
    """Order 4 points clockwise as seen on screen (image y axis points down)."""
    c = pts.mean(axis=0)
    ang = np.arctan2(pts[:, 1] - c[1], pts[:, 0] - c[0])
    pts = pts[np.argsort(ang)]
    # start at the top-left-most point for determinism
    start = int(np.argmin(pts[:, 0] + pts[:, 1]))
    return np.roll(pts, -start, axis=0)


def _orient_to_width(pts: np.ndarray, width_mm: float, height_mm: float) -> np.ndarray:
    """Rotate the corner order so side 0→1 is the side matching width_mm."""
    s01 = np.linalg.norm(pts[1] - pts[0]) + np.linalg.norm(pts[3] - pts[2])
    s12 = np.linalg.norm(pts[2] - pts[1]) + np.linalg.norm(pts[0] - pts[3])
    first_is_long = s01 >= s12
    want_long = width_mm >= height_mm
    return pts if first_is_long == want_long else np.roll(pts, -1, axis=0)


def _line_intersection(l1: tuple[np.ndarray, np.ndarray], l2: tuple[np.ndarray, np.ndarray]) -> np.ndarray | None:
    (p, d), (q, e) = l1, l2
    a = np.array([[d[0], -e[0]], [d[1], -e[1]]])
    if abs(np.linalg.det(a)) < 1e-9:
        return None
    t = np.linalg.solve(a, q - p)
    return p + t[0] * d


def _edge_rise_width(profile: np.ndarray, step: float) -> float | None:
    """10–90 % rise distance of a step-edge intensity profile (None if the edge is too weak)."""
    n = len(profile)
    k = max(2, n // 6)
    lo, hi = profile[:k].mean(), profile[-k:].mean()
    if abs(hi - lo) < 20:
        return None
    norm = (profile - lo) / (hi - lo)
    i10 = np.argmax(norm >= 0.1)
    i90 = np.argmax(norm >= 0.9)
    if norm[i10] < 0.1 or norm[i90] < 0.9 or i90 < i10:
        return None
    return float((i90 - i10) * step)


def refine_quad(gray: np.ndarray, corners: np.ndarray, *, margin: float = 0.12, samples: int = 24,
                reach_frac: float = 0.015) -> tuple[np.ndarray, float, float | None]:
    """Refine corners by fitting a line to each side's strongest gradient.

    Avoids the corner regions (rounded card corners) and returns
    (corners, rms_residual_px, median_edge_rise_width_px).
    """
    g = gaussian_filter(gray.astype(np.float32), 1.0)
    gy, gx = np.gradient(g)
    lines, residuals, widths = [], [], []
    for i in range(4):
        a, b = corners[i], corners[(i + 1) % 4]
        d = b - a
        length = float(np.linalg.norm(d))
        if length < 10:
            return corners, 99.0, None
        d = d / length
        n = np.array([-d[1], d[0]])
        reach = 3.0 + reach_frac * length
        ts = np.arange(-reach, reach + 1e-6, 0.25)
        pts = []
        for f in np.linspace(margin, 1 - margin, samples):
            base = a + (b - a) * f
            xs = base[0] + n[0] * ts
            ys = base[1] + n[1] * ts
            grad = map_coordinates(gx, [ys, xs], order=1, mode="nearest") * n[0] + \
                map_coordinates(gy, [ys, xs], order=1, mode="nearest") * n[1]
            mag = np.abs(grad)
            j = int(np.argmax(mag))
            if mag[j] < 2.0:
                continue
            off = ts[j]
            if 0 < j < len(ts) - 1:
                y0, y1, y2 = mag[j - 1], mag[j], mag[j + 1]
                den = y0 - 2 * y1 + y2
                if abs(den) > 1e-9:
                    off += 0.5 * (y0 - y2) / den * 0.25
            pts.append(base + n * off)
            prof = map_coordinates(g, [ys, xs], order=1, mode="nearest")
            if grad[j] < 0:
                prof = prof[::-1]
            w = _edge_rise_width(prof, 0.25)
            if w is not None:
                widths.append(w)
        if len(pts) < samples // 2:
            return corners, 99.0, None
        arr = np.array(pts, dtype=np.float32)
        vx, vy, x0, y0 = cv2.fitLine(arr, cv2.DIST_HUBER, 0, 0.01, 0.01).ravel()
        direction, origin = np.array([vx, vy], dtype=np.float64), np.array([x0, y0], dtype=np.float64)
        normal = np.array([-direction[1], direction[0]])
        residuals.extend(((arr - origin) @ normal).tolist())
        lines.append((origin, direction))
    refined = []
    for i in range(4):
        p = _line_intersection(lines[(i - 1) % 4], lines[i])
        if p is None:
            return corners, 99.0, None
        refined.append(p)
    refined = np.array(refined)
    # Refinement must not move corners wildly; otherwise keep the coarse estimate.
    if np.max(np.linalg.norm(refined - corners, axis=1)) > 0.05 * np.linalg.norm(corners[2] - corners[0]) + 5:
        return corners, 99.0, (float(np.median(widths)) if widths else None)
    rms = float(np.sqrt(np.mean(np.square(residuals)))) if residuals else 99.0
    return refined, rms, (float(np.median(widths)) if widths else None)


def _px_per_mm(corners: np.ndarray, width_mm: float, height_mm: float) -> float:
    area_px = abs(cv2.contourArea(corners.astype(np.float32)))
    return float(np.sqrt(area_px / (width_mm * height_mm)))


# ---------------------------------------------------------------------------- ArUco


def _detect_aruco(gray: np.ndarray, spec: ReferenceSpec) -> DetectedReference | None:
    dictionary = cv2.aruco.getPredefinedDictionary(getattr(cv2.aruco, spec.aruco_dictionary))
    params = cv2.aruco.DetectorParameters()
    params.cornerRefinementMethod = cv2.aruco.CORNER_REFINE_SUBPIX
    detector = cv2.aruco.ArucoDetector(dictionary, params)
    corners, ids, _ = detector.detectMarkers(gray)
    if ids is None or len(corners) == 0:
        # Large photos with small markers: retry on a downscaled copy, then refine at full res.
        scale = 1600 / max(gray.shape)
        if scale >= 1:
            return None
        small = cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
        corners, ids, _ = detector.detectMarkers(small)
        if ids is None or len(corners) == 0:
            return None
        corners = [c / scale for c in corners]
        refined = []
        for c in corners:
            c = c.reshape(-1, 1, 2).astype(np.float32)
            cv2.cornerSubPix(gray, c, (7, 7), (-1, -1),
                             (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 40, 0.01))
            refined.append(c.reshape(1, 4, 2))
        corners = refined
    best = max(corners, key=lambda c: abs(cv2.contourArea(c.reshape(4, 2).astype(np.float32))))
    pts = best.reshape(4, 2).astype(np.float64)  # TL, TR, BR, BL in marker frame: clockwise on screen
    _, _, edge_w = refine_quad(gray, pts, margin=0.1, samples=16)
    return DetectedReference(
        corners=pts, width_mm=spec.width_mm, height_mm=spec.height_mm,
        corner_sigma_px=0.3, edge_width_px=edge_w, px_per_mm=_px_per_mm(pts, spec.width_mm, spec.height_mm),
        is_marker=True,
    )


# ---------------------------------------------------------------------------- rectangles


def _quad_candidates(gray_small: np.ndarray, bgr_small: np.ndarray) -> list[np.ndarray]:
    blurred = cv2.GaussianBlur(gray_small, (5, 5), 0)
    binaries = []
    # Edge thresholds must follow edge *strength*, not brightness: a white card on a light desk has edges of only
    # a few grey levels in a very bright image. Several sensitivity levels; the scoring picks the best quad.
    # Edges in colour channels too: a tinted card can match the desk's brightness and differ only in hue.
    lab = cv2.cvtColor(cv2.GaussianBlur(bgr_small, (5, 5), 0), cv2.COLOR_BGR2LAB)
    channels = [blurred, lab[:, :, 1], lab[:, :, 2]]
    close = cv2.getStructuringElement(cv2.MORPH_RECT, (9, 9))  # bridges gaps from glare / weak edge segments
    for lo, hi in ((8, 24), (20, 60), (45, 135)):
        edges = np.zeros_like(blurred)
        for ch in channels:
            edges |= cv2.Canny(ch, lo, hi)
        binaries.append(cv2.dilate(edges, np.ones((3, 3), np.uint8)))
        binaries.append(cv2.morphologyEx(edges, cv2.MORPH_CLOSE, close))
    eq = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8)).apply(blurred)
    binaries.append(cv2.dilate(cv2.Canny(eq, 30, 90), np.ones((3, 3), np.uint8)))
    _, otsu = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    binaries += [otsu, 255 - otsu]
    sat = cv2.cvtColor(bgr_small, cv2.COLOR_BGR2HSV)[:, :, 1]
    _, sat_otsu = cv2.threshold(cv2.GaussianBlur(sat, (5, 5), 0), 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    binaries += [sat_otsu, 255 - sat_otsu]
    adaptive = cv2.adaptiveThreshold(blurred, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 51, 5)
    binaries.append(255 - adaptive)

    img_area = gray_small.shape[0] * gray_small.shape[1]
    quads = []
    for b in binaries:
        contours, _ = cv2.findContours(b, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
        for c in contours:
            area = cv2.contourArea(c)
            if area < 0.004 * img_area or area > 0.97 * img_area:
                continue
            hull = cv2.convexHull(c)
            if len(hull) < 4:  # approxPolyN asserts on hulls with fewer points than sides
                continue
            # Exactly 4 sides (rounded corners and gap-closing make fixed-epsilon approxPolyDP return 5–8 vertices).
            approx = cv2.approxPolyN(hull, 4, ensure_convex=True).reshape(-1, 2)  # returned as (1, 4, 2)
            if len(approx) != 4:
                continue
            quad_area = cv2.contourArea(approx)
            # The quad must explain the shape: rectangles fill it, ellipses (lenses) and blobs don't.
            if quad_area <= 0 or not 0.9 <= cv2.contourArea(hull) / quad_area <= 1.02:
                continue
            quads.append(approx.astype(np.float64))
    return quads


def metric_aspect(quad: np.ndarray, image_shape: tuple[int, int]) -> float:
    """True side ratio (side 0→1 / side 1→2) of a rectangle seen in perspective.

    Uses a pinhole model with a typical phone focal length: K⁻¹·H(unit square → quad) = λ[W·r1, H·r2, t].
    """
    h, w = image_shape
    f = 0.78 * max(w, h)
    K = np.array([[f, 0, w / 2], [0, f, h / 2], [0, 0, 1]])
    sq = np.array([[0, 0], [1, 0], [1, 1], [0, 1]], dtype=np.float32)
    H = cv2.getPerspectiveTransform(sq, quad.astype(np.float32))
    M = np.linalg.inv(K) @ H
    return float(np.linalg.norm(M[:, 0]) / max(np.linalg.norm(M[:, 1]), 1e-12))


MAX_SAM_REFERENCE_PROMPTS = 4


def _sam_quad_candidates(bgr_small: np.ndarray, segmenter) -> list[np.ndarray]:
    """Fallback for references whose outline is too faint/broken to trace: segment salient blobs with the model.

    Blobs are regions whose colour differs from the dominant background; each is prompted with its innermost point,
    and every returned mask that is well explained by a 4-sided polygon becomes a candidate quad.
    """
    h, w = bgr_small.shape[:2]
    lab = cv2.cvtColor(cv2.GaussianBlur(bgr_small, (9, 9), 0), cv2.COLOR_BGR2LAB).astype(np.float32)
    bg = np.median(lab.reshape(-1, 3), axis=0)
    dist = np.linalg.norm(lab - bg, axis=2)
    dist8 = np.clip(dist * (255.0 / max(float(np.percentile(dist, 99.5)), 1.0)), 0, 255).astype(np.uint8)
    _, fg = cv2.threshold(dist8, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    fg = cv2.morphologyEx(fg, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    n, labels, stats, _ = cv2.connectedComponentsWithStats(fg)
    blobs = [i for i in range(1, n) if 0.003 * h * w <= stats[i, cv2.CC_STAT_AREA] <= 0.5 * h * w]
    blobs = sorted(blobs, key=lambda i: stats[i, cv2.CC_STAT_AREA], reverse=True)[:MAX_SAM_REFERENCE_PROMPTS]
    quads = []
    for i in blobs:
        comp = (labels == i).astype(np.uint8)
        dt = cv2.distanceTransform(comp, cv2.DIST_L2, 5)
        y, x = np.unravel_index(int(np.argmax(dt)), dt.shape)
        for cand in segmenter.predict_point(bgr_small, (float(x), float(y))):
            m = cand.mask.astype(np.uint8)
            contours, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            if not contours:
                continue
            c = max(contours, key=cv2.contourArea)
            area = cv2.contourArea(c)
            if area < 0.003 * h * w:
                continue
            hull = cv2.convexHull(c)
            if len(hull) < 4:
                continue
            approx = cv2.approxPolyN(hull, 4, ensure_convex=True).reshape(-1, 2)
            quad_area = cv2.contourArea(approx)
            if len(approx) == 4 and quad_area > 0 and 0.93 <= area / quad_area <= 1.02:
                quads.append(approx.astype(np.float64))
    return quads


def _detect_rect(gray: np.ndarray, bgr: np.ndarray, spec: ReferenceSpec, segmenter=None) -> DetectedReference | None:
    scale = min(1.0, 1600 / max(gray.shape))
    gray_s = cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA) if scale < 1 else gray
    bgr_s = cv2.resize(bgr, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA) if scale < 1 else bgr
    expected = max(spec.width_mm, spec.height_mm) / min(spec.width_mm, spec.height_mm)
    img_area = gray_s.shape[0] * gray_s.shape[1]

    best = _best_quad(_quad_candidates(gray_s, bgr_s), scale, gray.shape, expected, img_area)
    if best is None and segmenter is not None:
        best = _best_quad(_sam_quad_candidates(bgr_s, segmenter), scale, gray.shape, expected, img_area)
    if best is None:
        return None
    return _finish_rect(gray, best, scale, spec)


def _best_quad(quads, scale, full_shape, expected, img_area) -> np.ndarray | None:
    ordered = [order_clockwise(q) for q in quads]

    def bbox_iou(a: np.ndarray, b: np.ndarray) -> float:
        ax0, ay0 = a.min(axis=0)
        ax1, ay1 = a.max(axis=0)
        bx0, by0 = b.min(axis=0)
        bx1, by1 = b.max(axis=0)
        inter = max(0.0, min(ax1, bx1) - max(ax0, bx0)) * max(0.0, min(ay1, by1) - max(ay0, by0))
        area_a = (ax1 - ax0) * (ay1 - ay0)
        area_b = (bx1 - bx0) * (by1 - by0)
        union = area_a + area_b - inter
        return inter / union if union > 0 else 0.0

    best, best_score = None, 0.0
    for q in ordered:
        ratio = metric_aspect(q / scale, full_shape)
        ratio = max(ratio, 1 / ratio)
        aspect_err = abs(np.log(ratio / expected))
        if aspect_err > 0.1:
            continue
        # angles close to 90° (allowing perspective)
        cosines = []
        for i in range(4):
            u, v = q[i - 1] - q[i], q[(i + 1) % 4] - q[i]
            cosines.append(abs(u @ v) / (np.linalg.norm(u) * np.linalg.norm(v) + 1e-9))
        if max(cosines) > 0.5:
            continue
        area_frac = cv2.contourArea(q.astype(np.float32)) / img_area
        # Prefer a rectangle supported by several independent edge/color passes.
        # In busy photos, a card-plus-lens boundary can mimic the card's aspect
        # ratio and be larger; the actual card produces a tight cluster of
        # nearly identical proposals.
        votes = sum(bbox_iou(q, other) >= 0.8 for other in ordered)
        score = np.exp(-(aspect_err / 0.08) ** 2) * (1 - max(cosines)) * np.sqrt(area_frac * votes)
        if score > best_score:
            best, best_score = q, score
    return best


def _finish_rect(gray: np.ndarray, best: np.ndarray, scale: float, spec: ReferenceSpec) -> DetectedReference:
    coarse = best / scale
    # Coarse quads can sit several px off the edge (gap-closing fattens outlines): a wide pass to find the edge,
    # then a tight pass so neighbouring structures (print on the card, desk texture) can't pull the line.
    refined, rms, edge_w = refine_quad(gray, coarse, reach_frac=0.05)
    if rms <= 3.0:
        refined, rms, edge_w = refine_quad(gray, refined)
    if rms > 3.0:
        refined, rms = coarse, 2.0 / scale  # coarse corners are good to ~1 downscaled px
    pts = _orient_to_width(order_clockwise(refined), spec.width_mm, spec.height_mm)
    return DetectedReference(
        corners=pts, width_mm=spec.width_mm, height_mm=spec.height_mm,
        corner_sigma_px=max(0.3, rms), edge_width_px=edge_w,
        px_per_mm=_px_per_mm(pts, spec.width_mm, spec.height_mm),
    )


def detect_reference(bgr: np.ndarray, spec: ReferenceSpec, *, side: str | None = None,
                     segmenter=None) -> DetectedReference:
    """`segmenter` (optional) enables the model-based fallback for faint rectangle references."""
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    found = _detect_aruco(gray, spec) if spec.kind == "aruco" else _detect_rect(gray, bgr, spec, segmenter)
    if found is None:
        raise AppError("REF_NOT_FOUND", side=side)
    return found
