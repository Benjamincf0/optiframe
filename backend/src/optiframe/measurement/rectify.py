"""Metric homography, perspective quality checks and rectified warps.

Metric plane: millimetres, x right, y down (image-like), rotated so that the *photo's* horizontal
direction stays horizontal (capture convention: lens top toward photo top).
"""

from dataclasses import dataclass

import cv2
import numpy as np

from optiframe.measurement.reference import DetectedReference

MAX_TILT_DEG = 40.0
# Blurry = edges wider than this in mm AND in px (a sharp edge at low resolution is wide in mm but not blur).
# At phone-scale resolutions a clean but anti-aliased card edge is commonly
# 0.8–0.9 mm wide after rectification.  Keep the pixel guard, but leave a small
# margin so these photos are measured (with their uncertainty reflected) rather
# than rejected as motion blur.
MAX_EDGE_WIDTH_MM = 1.0
MAX_EDGE_WIDTH_PX = 5.0


@dataclass
class Plane:
    H: np.ndarray  # image px -> metric mm (3x3)
    image_shape: tuple[int, int]
    ref_polygon_mm: np.ndarray  # (4, 2)
    ref_center_mm: np.ndarray
    tilt_deg: float
    edge_width_mm: float | None
    edge_width_px: float | None
    src_px_per_mm: float
    ref_is_marker: bool = False

    def to_mm(self, pts_px: np.ndarray) -> np.ndarray:
        return cv2.perspectiveTransform(pts_px.reshape(-1, 1, 2).astype(np.float64), self.H).reshape(-1, 2)

    def to_px(self, pts_mm: np.ndarray) -> np.ndarray:
        return cv2.perspectiveTransform(pts_mm.reshape(-1, 1, 2).astype(np.float64), np.linalg.inv(self.H)).reshape(-1, 2)


def estimate_tilt_deg(H_mm_to_px: np.ndarray, image_shape: tuple[int, int]) -> float:
    """Camera tilt relative to the reference plane, assuming a typical phone focal length."""
    h, w = image_shape
    f = 0.78 * max(w, h)
    K = np.array([[f, 0, w / 2], [0, f, h / 2], [0, 0, 1]])
    M = np.linalg.inv(K) @ H_mm_to_px
    r1, r2 = M[:, 0], M[:, 1]
    r1 = r1 / np.linalg.norm(r1)
    r2 = r2 / np.linalg.norm(r2)
    n = np.cross(r1, r2)
    n /= np.linalg.norm(n)
    return float(np.degrees(np.arccos(min(1.0, abs(n[2])))))


def build_plane(ref: DetectedReference, image_shape: tuple[int, int]) -> Plane:
    W, Hh = ref.width_mm, ref.height_mm
    dst = np.array([[0, 0], [W, 0], [W, Hh], [0, Hh]], dtype=np.float64)
    H = cv2.getPerspectiveTransform(ref.corners.astype(np.float32), dst.astype(np.float32)).astype(np.float64)

    # Rotate the metric plane so the photo's horizontal axis (at the reference) stays horizontal.
    c_px = ref.corners.mean(axis=0)
    probe = np.array([c_px, c_px + [50.0, 0.0]])
    p = cv2.perspectiveTransform(probe.reshape(-1, 1, 2), H).reshape(-1, 2)
    theta = np.arctan2(p[1, 1] - p[0, 1], p[1, 0] - p[0, 0])
    c, s = np.cos(-theta), np.sin(-theta)
    R = np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])
    H = R @ H
    poly = cv2.perspectiveTransform(ref.corners.reshape(-1, 1, 2).astype(np.float64), H).reshape(-1, 2)

    tilt = estimate_tilt_deg(np.linalg.inv(H), image_shape)
    edge_mm = ref.edge_width_px / ref.px_per_mm if ref.edge_width_px is not None else None
    return Plane(H=H, image_shape=image_shape, ref_polygon_mm=poly, ref_center_mm=poly.mean(axis=0),
                 tilt_deg=tilt, edge_width_mm=edge_mm, edge_width_px=ref.edge_width_px, src_px_per_mm=ref.px_per_mm,
                 ref_is_marker=ref.is_marker)


def is_blurry(plane: "Plane") -> bool:
    if plane.edge_width_mm is None or plane.edge_width_px is None:
        return False
    return plane.edge_width_mm > MAX_EDGE_WIDTH_MM and plane.edge_width_px > MAX_EDGE_WIDTH_PX


@dataclass
class Warp:
    image: np.ndarray
    valid: np.ndarray  # uint8 mask of pixels that came from inside the photo
    x0_mm: float
    y0_mm: float
    scale: float  # px per mm

    def px_to_mm(self, pts: np.ndarray) -> np.ndarray:
        return pts / self.scale + np.array([self.x0_mm, self.y0_mm])

    def mm_to_px(self, pts: np.ndarray) -> np.ndarray:
        return (pts - np.array([self.x0_mm, self.y0_mm])) * self.scale


def warp_region(bgr: np.ndarray, plane: Plane, box_mm: tuple[float, float, float, float], scale: float,
                max_side: int = 3000) -> Warp:
    x0, y0, x1, y1 = box_mm
    scale = min(scale, max_side / max(x1 - x0, y1 - y0))
    w, h = int(round((x1 - x0) * scale)), int(round((y1 - y0) * scale))
    T = np.array([[scale, 0, -x0 * scale], [0, scale, -y0 * scale], [0, 0, 1]])
    M = T @ plane.H
    img = cv2.warpPerspective(bgr, M, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_CONSTANT)
    ones = np.full(bgr.shape[:2], 255, np.uint8)
    valid = cv2.warpPerspective(ones, M, (w, h), flags=cv2.INTER_NEAREST, borderMode=cv2.BORDER_CONSTANT)
    return Warp(image=img, valid=valid, x0_mm=x0, y0_mm=y0, scale=scale)


def output_scale(plane: Plane) -> float:
    """Rectified resolution: roughly the source resolution, clamped to a useful range."""
    return float(np.clip(plane.src_px_per_mm, 6.0, 12.0))
