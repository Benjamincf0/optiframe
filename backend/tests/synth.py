"""Synthetic photo renderer with exact ground truth for measurement tests.

A metric "table" canvas (mm) holds a reference object and a transparent lens with a dark bevel
ring, refraction shift and a specular highlight. A pinhole camera with tilt photographs it.
"""

from dataclasses import dataclass

import cv2
import numpy as np

CANVAS_MM = (420.0, 320.0)  # width, height
CANVAS_SCALE = 10.0  # px/mm when composing


def lens_shape(a: float, b: float, n: float = 2.6, taper: float = 0.08, pts: int = 2000) -> np.ndarray:
    """Superellipse lens (front view, mm, y up) with nasal/temporal asymmetry, centred on its box."""
    t = np.linspace(0, 2 * np.pi, pts, endpoint=False)
    c, s = np.cos(t), np.sin(t)
    x = a / 2 * np.sign(c) * np.abs(c) ** (2 / n)
    y = b / 2 * np.sign(s) * np.abs(s) ** (2 / n)
    y = y * (1 + taper * x / (a / 2))
    lo, hi = np.array([x.min(), y.min()]), np.array([x.max(), y.max()])
    ctr = (lo + hi) / 2
    return np.stack([x - ctr[0], y - ctr[1]], axis=1)


@dataclass
class Scene:
    image: np.ndarray
    A: float
    B: float
    hint: tuple[float, float, float, float]
    reference: dict


def _table(rng: np.random.Generator, shape) -> np.ndarray:
    h, w = shape
    base = np.array(rng.uniform([90, 110, 140], [140, 160, 200]), np.float32)  # warm wood-ish BGR
    low = cv2.resize(rng.normal(0, 1, (h // 80 + 2, w // 80 + 2)).astype(np.float32), (w, h), interpolation=cv2.INTER_CUBIC)
    grain = cv2.GaussianBlur(rng.normal(0, 1, (h, w)).astype(np.float32), (0, 0), sigmaX=25, sigmaY=1.5)
    tex = 14 * low + 30 * grain
    img = base[None, None, :] + tex[:, :, None]
    return np.clip(img, 0, 255)


def _to_px(pts_mm: np.ndarray) -> np.ndarray:
    return pts_mm * CANVAS_SCALE


def _rounded_rect(cx, cy, w, h, r, angle_deg, n=24) -> np.ndarray:
    pts = []
    for qx, qy, a0 in [(w / 2 - r, h / 2 - r, 0), (-w / 2 + r, h / 2 - r, 90),
                       (-w / 2 + r, -h / 2 + r, 180), (w / 2 - r, -h / 2 + r, 270)]:
        for a in np.radians(np.linspace(a0, a0 + 90, n)):
            pts.append([qx + r * np.cos(a), qy + r * np.sin(a)])
    pts = np.array(pts)
    th = np.radians(angle_deg)
    R = np.array([[np.cos(th), -np.sin(th)], [np.sin(th), np.cos(th)]])
    return pts @ R.T + [cx, cy]


def render(seed: int = 0, *, ref: str = "credit_card", lens_a: float = 52.0, lens_b: float = 38.0,
           tilt_deg: float = 12.0, card_angle: float = 8.0, blur: float = 0.8, noise: float = 3.0,
           jpeg_quality: int = 90, image_size=(2400, 1800), px_per_mm_target: float = 7.0) -> Scene:
    rng = np.random.default_rng(seed)
    W, H = CANVAS_MM
    cw, ch = int(W * CANVAS_SCALE), int(H * CANVAS_SCALE)
    canvas = _table(rng, (ch, cw))

    # --- reference object (left part of the canvas)
    ref_center = np.array([W / 2 - 60, H / 2 + rng.uniform(-10, 10)])
    if ref == "credit_card":
        poly = _rounded_rect(*ref_center, 85.60, 53.98, 3.18, card_angle)
        color = np.array(rng.uniform([200, 200, 200], [245, 245, 245]))
        cv2.fillPoly(canvas, [np.round(_to_px(poly) * 16).astype(np.int32)], color.tolist(), cv2.LINE_AA, shift=4)
        # card clutter: stripe + "text"
        th = np.radians(card_angle)
        R = np.array([[np.cos(th), -np.sin(th)], [np.sin(th), np.cos(th)]])
        for _ in range(10):
            p = (rng.uniform([-35, -20], [35, 20]) @ R.T) + ref_center
            cv2.circle(canvas, tuple(np.round(_to_px(p)).astype(int)), int(rng.uniform(8, 25)),
                       rng.uniform(40, 160, 3).tolist(), -1, cv2.LINE_AA)
        reference = {"type": "credit_card"}
    elif ref == "aruco":
        size_mm = 40.0
        dictionary = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
        side_px = int(size_mm * CANVAS_SCALE)
        marker = cv2.aruco.generateImageMarker(dictionary, 7, side_px)
        quiet = int(8 * CANVAS_SCALE)
        tile = np.full((side_px + 2 * quiet, side_px + 2 * quiet), 255, np.uint8)
        tile[quiet:quiet + side_px, quiet:quiet + side_px] = marker
        M = cv2.getRotationMatrix2D((tile.shape[1] / 2, tile.shape[0] / 2), card_angle, 1.0)
        M[:, 2] += _to_px(ref_center) - np.array(tile.shape[::-1]) / 2
        warped = cv2.warpAffine(tile, M, (cw, ch), flags=cv2.INTER_LINEAR, borderValue=0)
        maskw = cv2.warpAffine(np.full_like(tile, 255), M, (cw, ch), flags=cv2.INTER_LINEAR, borderValue=0)
        alpha = (maskw / 255.0)[:, :, None]
        canvas = canvas * (1 - alpha) + warped[:, :, None] * alpha
        reference = {"type": "aruco", "dictionary": "DICT_4X4_50", "marker_size_mm": size_mm}
    else:
        raise ValueError(ref)

    # --- lens (right part). Front-view shape (y up) → canvas (y down).
    shape = lens_shape(lens_a, lens_b, n=rng.uniform(2.2, 3.4), taper=rng.uniform(-0.1, 0.1))
    lens_center = np.array([W / 2 + 55, H / 2 + rng.uniform(-8, 8)])
    lens_canvas = np.stack([shape[:, 0], -shape[:, 1]], axis=1) + lens_center
    A = float(np.ptp(shape[:, 0]))
    B = float(np.ptp(shape[:, 1]))

    poly_px = np.round(_to_px(lens_canvas) * 16).astype(np.int32)
    inside = np.zeros((ch, cw), np.uint8)
    cv2.fillPoly(inside, [poly_px], 255, cv2.LINE_AA, shift=4)
    inside_f = inside.astype(np.float32) / 255.0
    # refraction: slightly minified background inside the lens
    lc = _to_px(lens_center)
    Mref = cv2.getRotationMatrix2D(tuple(lc), 0, 1.04)
    refracted = cv2.warpAffine(canvas.astype(np.float32), Mref, (cw, ch), borderMode=cv2.BORDER_REFLECT)
    lens_img = refracted * 0.93 + 10
    # bevel: dark ring ~1.2 mm inside the edge, with a thin bright inner line
    ring_w = int(1.2 * CANVAS_SCALE)
    eroded = cv2.erode(inside, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * ring_w + 1, 2 * ring_w + 1)))
    ring = cv2.GaussianBlur(((inside > 127) & (eroded < 128)).astype(np.float32), (0, 0), 2.0)
    lens_img = lens_img * (1 - 0.55 * ring[:, :, None])
    inner = cv2.erode(eroded, np.ones((3, 3), np.uint8))
    line = cv2.GaussianBlur(((eroded > 127) & (inner < 128)).astype(np.float32), (0, 0), 1.5)
    lens_img = lens_img + 70 * line[:, :, None]
    # specular highlight
    hl = np.zeros((ch, cw), np.float32)
    hc = lc + _to_px(np.array([-lens_a * 0.18, -lens_b * 0.15]))
    cv2.ellipse(hl, tuple(np.round(hc).astype(int)), (int(lens_a * 2.2), int(lens_b * 1.0)), -25, 0, 360, 1.0, -1)
    hl = cv2.GaussianBlur(hl, (0, 0), 25) * inside_f
    lens_img = lens_img + 120 * hl[:, :, None]
    canvas = canvas * (1 - inside_f[:, :, None]) + lens_img * inside_f[:, :, None]
    # soft contact shadow just outside the lens
    outer = cv2.dilate(inside, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15)))
    shadow = cv2.GaussianBlur(((outer > 127) & (inside < 128)).astype(np.float32), (0, 0), 4) * 0.25
    canvas = canvas * (1 - shadow[:, :, None])
    canvas = np.clip(canvas, 0, 255).astype(np.uint8)

    # --- camera
    iw, ih = image_size
    f = 0.78 * max(iw, ih)
    K = np.array([[f, 0, iw / 2], [0, f, ih / 2], [0, 0, 1]])
    Z = f / px_per_mm_target
    t1, t2 = np.radians(tilt_deg), np.radians(rng.uniform(-0.5, 0.5) * tilt_deg)
    Rx = np.array([[1, 0, 0], [0, np.cos(t1), -np.sin(t1)], [0, np.sin(t1), np.cos(t1)]])
    Ry = np.array([[np.cos(t2), 0, np.sin(t2)], [0, 1, 0], [-np.sin(t2), 0, np.cos(t2)]])
    Rm = Rx @ Ry
    look_at = np.array([W / 2, H / 2, 0.0])
    cam_pos = look_at + Rm.T @ np.array([0, 0, -Z])
    t = -Rm @ cam_pos
    Hplane = K @ np.column_stack([Rm[:, 0], Rm[:, 1], t])  # plane mm (x, y, z=0) → image
    S = np.diag([1 / CANVAS_SCALE, 1 / CANVAS_SCALE, 1])
    Hcam = Hplane @ S
    img = cv2.warpPerspective(canvas, Hcam, (iw, ih), flags=cv2.INTER_AREA, borderValue=(40, 40, 40))

    if blur > 0:
        img = cv2.GaussianBlur(img, (0, 0), blur)
    if noise > 0:
        img = np.clip(img.astype(np.float32) + rng.normal(0, noise, img.shape), 0, 255).astype(np.uint8)
    if jpeg_quality < 100:
        _, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, jpeg_quality])
        img = cv2.imdecode(buf, cv2.IMREAD_COLOR)

    # hint: lens box + 10 mm margin, projected to the image, normalised
    margin = 10.0
    lo, hi = lens_canvas.min(axis=0) - margin, lens_canvas.max(axis=0) + margin
    box = np.array([[lo[0], lo[1]], [hi[0], lo[1]], [hi[0], hi[1]], [lo[0], hi[1]]])
    proj = cv2.perspectiveTransform(box.reshape(-1, 1, 2), Hplane).reshape(-1, 2)
    hint = (float(proj[:, 0].min() / iw), float(proj[:, 1].min() / ih),
            float(proj[:, 0].max() / iw), float(proj[:, 1].max() / ih))
    return Scene(image=img, A=A, B=B, hint=hint, reference=reference)


def encode(img: np.ndarray, quality: int = 95) -> bytes:
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, quality])
    assert ok
    return buf.tobytes()
