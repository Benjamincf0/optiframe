"""Mask → sub-pixel lens contour → ISO 8624 boxing measurements."""

import cv2
import numpy as np
from scipy.ndimage import gaussian_filter, gaussian_filter1d, map_coordinates, median_filter


def largest_component(mask: np.ndarray) -> np.ndarray | None:
    """Largest connected blob with interior holes filled (the lens interior may be partly unmasked)."""
    m = mask.astype(np.uint8)
    contours, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    if not contours:
        return None
    c = max(contours, key=cv2.contourArea)
    filled = np.zeros_like(m)
    cv2.drawContours(filled, [c], -1, 1, thickness=cv2.FILLED)
    return filled.astype(bool)


def mask_contour(mask: np.ndarray) -> np.ndarray:
    contours, _ = cv2.findContours(mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    c = max(contours, key=cv2.contourArea).reshape(-1, 2).astype(np.float64)
    return c


def resample_closed(pts: np.ndarray, n: int) -> np.ndarray:
    closed = np.vstack([pts, pts[:1]])
    seg = np.linalg.norm(np.diff(closed, axis=0), axis=1)
    s = np.concatenate([[0], np.cumsum(seg)])
    total = s[-1]
    t = np.linspace(0, total, n, endpoint=False)
    x = np.interp(t, s, closed[:, 0])
    y = np.interp(t, s, closed[:, 1])
    return np.stack([x, y], axis=1)


def polygon_area(pts: np.ndarray) -> float:
    x, y = pts[:, 0], pts[:, 1]
    return 0.5 * float(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1)))


def perimeter(pts: np.ndarray) -> float:
    return float(np.linalg.norm(np.diff(np.vstack([pts, pts[:1]]), axis=0), axis=1).sum())


def _outward_normals(pts: np.ndarray, mask: np.ndarray) -> np.ndarray:
    tangent = np.roll(pts, -1, axis=0) - np.roll(pts, 1, axis=0)
    tangent /= np.linalg.norm(tangent, axis=1, keepdims=True) + 1e-12
    normals = np.stack([tangent[:, 1], -tangent[:, 0]], axis=1)
    probe = np.round(pts + 3 * normals).astype(int)
    h, w = mask.shape
    probe[:, 0] = np.clip(probe[:, 0], 0, w - 1)
    probe[:, 1] = np.clip(probe[:, 1], 0, h - 1)
    inside = mask[probe[:, 1], probe[:, 0]].mean()
    return -normals if inside > 0.5 else normals


def refine_edge(gray: np.ndarray, mask: np.ndarray, scale: float, n: int = 720,
                reach_mm: float = 1.0) -> tuple[np.ndarray, float]:
    """Snap the mask boundary to the lens's outer edge gradient.

    Returns (points in px, fraction of points that found a strong edge).
    """
    pts = resample_closed(mask_contour(mask), n)
    normals = _outward_normals(pts, mask)
    g = gaussian_filter(gray.astype(np.float32), 1.0)
    gy, gx = np.gradient(g)
    mag = np.hypot(gx, gy)
    reach = reach_mm * scale
    ts = np.arange(-reach, reach + 1e-6, 0.25)
    xs = pts[:, 0:1] + normals[:, 0:1] * ts[None]
    ys = pts[:, 1:2] + normals[:, 1:2] * ts[None]
    prof = map_coordinates(mag, [ys.ravel(), xs.ravel()], order=1, mode="nearest").reshape(xs.shape)

    noise = float(np.median(mag)) + 1e-6
    shifts = np.zeros(n)
    found = np.zeros(n, bool)
    for i in range(n):
        p = prof[i]
        peaks = np.where((p[1:-1] >= p[:-2]) & (p[1:-1] >= p[2:]))[0] + 1
        if len(peaks) == 0:
            continue
        strongest = p[peaks].max()
        if strongest < max(6.0, 4 * noise):
            continue
        strong = peaks[p[peaks] >= 0.6 * strongest]
        j = int(strong.max())  # outermost strong edge = outer boundary of the lens edge band
        off = ts[j]
        y0, y1, y2 = p[j - 1], p[j], p[j + 1]
        den = y0 - 2 * y1 + y2
        if abs(den) > 1e-9:
            off += 0.5 * (y0 - y2) / den * 0.25
        shifts[i] = off
        found[i] = True
    # Robust smoothing of the correction along the contour; points without a clear edge follow neighbours.
    if found.any():
        idx = np.arange(n)
        good = idx[found]
        filled = np.interp(idx, np.concatenate([good - n, good, good + n]),
                           np.tile(shifts[found], 3))
        shifts = median_filter(filled, size=15, mode="wrap")
    shifts = np.clip(shifts, -reach, reach)
    return pts + normals * shifts[:, None], float(found.mean())


def smooth_closed(pts: np.ndarray, sigma_samples: float) -> np.ndarray:
    return np.stack([gaussian_filter1d(pts[:, 0], sigma_samples, mode="wrap"),
                     gaussian_filter1d(pts[:, 1], sigma_samples, mode="wrap")], axis=1)


def to_front_view_mm(pts_mm_ydown: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Metric (y down) → front-view lens coordinates (y up, origin at boxing centre, CCW).

    Returns (contour, box centre in metric y-down coordinates).
    """
    lo, hi = pts_mm_ydown.min(axis=0), pts_mm_ydown.max(axis=0)
    centre = (lo + hi) / 2
    out = np.stack([pts_mm_ydown[:, 0] - centre[0], -(pts_mm_ydown[:, 1] - centre[1])], axis=1)
    if polygon_area(out) < 0:
        out = out[::-1]
    return out, centre


def boxing(contour_mm: np.ndarray) -> dict:
    lo, hi = contour_mm.min(axis=0), contour_mm.max(axis=0)
    return {
        "A": float(hi[0] - lo[0]),
        "B": float(hi[1] - lo[1]),
        "perimeter": perimeter(contour_mm),
        "box_mm": {"x_min": float(lo[0]), "x_max": float(hi[0]), "y_min": float(lo[1]), "y_max": float(hi[1])},
    }


def mean_boundary_distance_mm(a: np.ndarray, b: np.ndarray, scale: float) -> float:
    """Symmetric-difference area / mean perimeter: average boundary disagreement between two masks."""
    diff = np.count_nonzero(a ^ b)
    per = 0.5 * (perimeter(mask_contour(a)) + perimeter(mask_contour(b)))
    return float(diff / max(per, 1.0) / scale)
