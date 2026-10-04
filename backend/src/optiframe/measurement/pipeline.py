"""End-to-end lens measurement: photo + reference spec → contour, A, B, perimeter, confidence."""

import base64
from dataclasses import dataclass

import cv2
import numpy as np

from optiframe.errors import AppError
from optiframe.measurement import contour as C
from optiframe.measurement.imageio import load_image
from optiframe.measurement.locate import LENS_MAX_MM, LENS_MIN_MM, locate_lens
from optiframe.measurement.rectify import (
    MAX_TILT_DEG,
    build_plane,
    is_blurry,
    output_scale,
    warp_region,
)
from optiframe.measurement.reference import ReferenceSpec, detect_reference
from optiframe.measurement.segment import Segmenter

CROP_MARGIN_MM = 8.0
PREVIEW_MARGIN_MM = 5.0
PREVIEW_MAX_SIDE = 1200
CONTOUR_POINTS = 360


@dataclass
class LensMeasurement:
    result: dict
    warnings: list[dict]


def _choose_mask(cands, box_px, crop_shape, scale) -> tuple[np.ndarray, float] | None:
    h, w = crop_shape
    bx0, by0, bx1, by1 = box_px
    box_area = (bx1 - bx0) * (by1 - by0)
    border = max(2, int(round(1.0 * scale)))
    best, best_score = None, 0.0
    for cand in cands:
        m = C.largest_component(cand.mask)
        if m is None:
            continue
        ys, xs = np.nonzero(m)
        x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
        wmm, hmm = (x1 - x0) / scale, (y1 - y0) / scale
        if not (LENS_MIN_MM * 0.8 <= wmm <= LENS_MAX_MM and LENS_MIN_MM * 0.6 <= hmm <= LENS_MAX_MM):
            continue
        if x0 < border or y0 < border or x1 >= w - border or y1 >= h - border:
            continue  # leaked into the background
        ix0, iy0, ix1, iy1 = max(x0, bx0), max(y0, by0), min(x1, bx1), min(y1, by1)
        inter = max(0, ix1 - ix0) * max(0, iy1 - iy0)
        union = (x1 - x0) * (y1 - y0) + box_area - inter
        box_iou = inter / max(union, 1)
        if box_iou < 0.6:
            continue
        score = cand.iou * box_iou
        if score > best_score:
            best, best_score = m, score
    return (best, best_score) if best is not None else None


def _encode_jpeg(img: np.ndarray) -> str:
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 85])
    if not ok:
        raise AppError("INTERNAL_ERROR")
    return "data:image/jpeg;base64," + base64.b64encode(buf.tobytes()).decode("ascii")


def measure_lens(data: bytes, ref_spec: ReferenceSpec, hint: tuple[float, float, float, float] | None,
                 side: str, segmenter: Segmenter, *, max_pixels: int, segmentation_runs: int = 2
                 ) -> LensMeasurement:
    loaded = load_image(data, side=side, max_pixels=max_pixels)
    bgr = loaded.bgr
    h_img, w_img = bgr.shape[:2]

    ref = detect_reference(bgr, ref_spec, side=side)
    plane = build_plane(ref, (h_img, w_img))
    if plane.tilt_deg > MAX_TILT_DEG:
        raise AppError("ANGLE_TOO_STEEP", side=side, details={"tilt_deg": round(plane.tilt_deg, 1)})
    if is_blurry(plane):
        raise AppError("IMAGE_TOO_BLURRY", side=side, details={"edge_width_mm": round(plane.edge_width_mm, 2)})

    hint_mm = None
    if hint is not None:
        hx0, hy0, hx1, hy1 = hint
        corners = np.array([[hx0, hy0], [hx1, hy0], [hx1, hy1], [hx0, hy1]]) * [w_img, h_img]
        pm = plane.to_mm(corners)
        hint_mm = (pm[:, 0].min(), pm[:, 1].min(), pm[:, 0].max(), pm[:, 1].max())

    box = locate_lens(bgr, plane, hint_mm)
    if box is None:
        raise AppError("LENS_NOT_FOUND", side=side)

    scale = output_scale(plane)
    bx0, by0, bx1, by1 = box
    crop = warp_region(bgr, plane, (bx0 - CROP_MARGIN_MM, by0 - CROP_MARGIN_MM,
                                    bx1 + CROP_MARGIN_MM, by1 + CROP_MARGIN_MM), scale)
    scale = crop.scale
    box_px = tuple(crop.mm_to_px(np.array([[bx0, by0], [bx1, by1]])).ravel())

    # Segmentation runs with slightly different box prompts; their disagreement measures uncertainty.
    pads_mm = [1.5, 3.0, 0.5, 4.5][:segmentation_runs]
    masks = []
    for pad in pads_mm:
        p = pad * scale
        prompt = (box_px[0] - p, box_px[1] - p, box_px[2] + p, box_px[3] + p)
        chosen = _choose_mask(segmenter.predict_box(crop.image, prompt), box_px, crop.image.shape[:2], scale)
        if chosen is not None:
            masks.append(chosen)
    if not masks:
        raise AppError("LENS_NOT_FOUND", side=side)
    masks.sort(key=lambda m: m[1], reverse=True)
    mask = masks[0][0]
    seg_unc = (max(C.mean_boundary_distance_mm(mask, m, scale) for m, _ in masks[1:])
               if len(masks) > 1 else 0.3)

    gray = cv2.cvtColor(crop.image, cv2.COLOR_BGR2GRAY)
    pts_px, edge_support = C.refine_edge(gray, mask, scale)
    spacing_mm = C.perimeter(pts_px) / len(pts_px) / scale
    pts_px = C.smooth_closed(pts_px, sigma_samples=0.4 / max(spacing_mm, 1e-6))
    pts_px = C.resample_closed(pts_px, CONTOUR_POINTS)
    contour_mm, centre_mm = C.to_front_view_mm(crop.px_to_mm(pts_px))
    meas = C.boxing(contour_mm)

    # Uncertainty budget (mm, 1σ-ish): reference scale, blur, segmentation, floor.
    side_px = min(np.linalg.norm(ref.corners[1] - ref.corners[0]), np.linalg.norm(ref.corners[2] - ref.corners[1]))
    scale_rel = ref.corner_sigma_px * np.sqrt(2) / max(side_px, 1.0)
    scale_term = scale_rel * max(meas["A"], meas["B"])
    blur_term = 0.15 * (plane.edge_width_mm or 0.5)
    tilt_term = 0.01 * plane.tilt_deg  # residual parallax / focal-length model error grows with tilt
    res_term = 1.0 / plane.src_px_per_mm  # ~1 source pixel of edge localisation
    seg_term = np.sqrt(2) * seg_unc * (1.0 if edge_support > 0.6 else 1.5)
    accuracy = float(np.sqrt(scale_term ** 2 + blur_term ** 2 + tilt_term ** 2 + res_term ** 2 + seg_term ** 2 + 0.25 ** 2))
    accuracy = max(0.3, round(accuracy, 1))
    confidence = round(1.0 / (1.0 + (accuracy / 0.6) ** 2), 2)

    # Preview crop around the lens in the rectified plane.
    lo, hi = contour_mm.min(axis=0), contour_mm.max(axis=0)
    px0 = centre_mm[0] + lo[0] - PREVIEW_MARGIN_MM
    py0 = centre_mm[1] - hi[1] - PREVIEW_MARGIN_MM
    px1 = centre_mm[0] + hi[0] + PREVIEW_MARGIN_MM
    py1 = centre_mm[1] - lo[1] + PREVIEW_MARGIN_MM
    preview_scale = min(scale, PREVIEW_MAX_SIDE / max(px1 - px0, py1 - py0))
    preview = warp_region(bgr, plane, (px0, py0, px1, py1), preview_scale)

    result = {
        "contour_mm": [[round(float(x), 3), round(float(y), 3)] for x, y in contour_mm],
        "A": round(meas["A"], 2),
        "B": round(meas["B"], 2),
        "perimeter": round(meas["perimeter"], 2),
        "box_mm": {k: round(v, 3) for k, v in meas["box_mm"].items()},
        "confidence": confidence,
        "accuracy_mm": accuracy,
        "scale_px_per_mm": round(preview.scale, 4),
        "rectified_image": _encode_jpeg(preview.image),
        "rectified_origin_mm": [round(float(centre_mm[0] - px0), 3), round(float(centre_mm[1] - py0), 3)],
    }
    return LensMeasurement(result=result, warnings=loaded.warnings)
