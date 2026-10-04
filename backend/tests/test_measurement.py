"""Measurement accuracy on synthetic photos with exact ground truth, plus failure modes."""

import io
import time

import cv2
import numpy as np
import pytest
from PIL import Image
from synth import encode, render

from optiframe.errors import AppError
from optiframe.measurement.imageio import load_image
from optiframe.measurement.pipeline import measure_lens
from optiframe.measurement.reference import ReferenceSpec

CARD = ReferenceSpec("rect", 85.60, 53.98)
ARUCO = ReferenceSpec("aruco", 40.0, 40.0, "DICT_4X4_50")
SPECS = {"credit_card": CARD, "aruco": ARUCO}
TOLERANCE_MM = 0.5


def _measure(scene, spec, segmenter, use_hint=True, side="left"):
    return measure_lens(encode(scene.image), spec, scene.hint if use_hint else None, side, segmenter,
                        max_pixels=40_000_000)


@pytest.mark.parametrize(("seed", "ref", "tilt", "use_hint", "a", "b"), [
    (0, "credit_card", 10, True, 46, 34),
    (1, "credit_card", 25, False, 49, 35),
    (2, "aruco", 15, True, 52, 36),
    (3, "aruco", 5, False, 55, 37),
    (4, "credit_card", 0, True, 58, 38),
    (10, "credit_card", 18, True, 50, 30),
    (11, "aruco", 22, True, 44, 40),
    (12, "credit_card", 8, False, 62, 42),
])
def test_accuracy(segmenter, seed, ref, tilt, use_hint, a, b):
    scene = render(seed, ref=ref, tilt_deg=tilt, lens_a=a, lens_b=b, card_angle=(-1) ** seed * 3 * seed)
    t = time.monotonic()
    m = _measure(scene, SPECS[ref], segmenter, use_hint)
    elapsed = time.monotonic() - t
    r = m.result
    assert abs(r["A"] - scene.A) < TOLERANCE_MM, (r["A"], scene.A)
    assert abs(r["B"] - scene.B) < TOLERANCE_MM, (r["B"], scene.B)
    assert elapsed < 7.5  # half the 15 s budget per lens
    # contract
    pts = np.array(r["contour_mm"])
    assert len(pts) == 360
    assert abs(np.ptp(pts[:, 0]) - r["A"]) < 0.01 and abs(np.ptp(pts[:, 1]) - r["B"]) < 0.01
    assert abs((pts.min(0) + pts.max(0)).sum()) < 0.01  # centred on the boxing centre
    x, y = pts[:, 0], pts[:, 1]
    assert np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1)) > 0  # CCW
    assert r["rectified_image"].startswith("data:image/jpeg;base64,")
    assert 0 < r["confidence"] <= 1 and r["accuracy_mm"] >= 0.3
    assert r["perimeter"] > 2 * (r["A"] + r["B"]) * 0.75


def test_rectified_overlay_alignment(segmenter):
    """Contour mapped through rectified_origin_mm/scale must land on the lens edge in the preview image."""
    import base64

    scene = render(20, tilt_deg=12)
    r = _measure(scene, CARD, segmenter).result
    img = cv2.imdecode(np.frombuffer(base64.b64decode(r["rectified_image"].split(",")[1]), np.uint8), cv2.IMREAD_GRAYSCALE)
    s, (ox, oy) = r["scale_px_per_mm"], r["rectified_origin_mm"]
    pts = np.array(r["contour_mm"])
    px = np.stack([(ox + pts[:, 0]) * s, (oy - pts[:, 1]) * s], axis=1)
    assert (px >= 0).all() and (px[:, 0] < img.shape[1]).all() and (px[:, 1] < img.shape[0]).all()
    # the dark bevel ring sits just inside the contour: sampled 0.6 mm inward it is darker than 1.5 mm outward
    c = px.mean(axis=0)
    d = (px - c) / np.linalg.norm(px - c, axis=1, keepdims=True)
    inner = px - d * 0.6 * s
    outer = px + d * 1.5 * s
    sample = lambda p: img[np.clip(p[:, 1].astype(int), 0, img.shape[0] - 1), np.clip(p[:, 0].astype(int), 0, img.shape[1] - 1)]  # noqa: E731
    assert np.median(sample(inner)) < np.median(sample(outer))


def test_blurry_photo_rejected(segmenter):
    scene = render(5, blur=5.0)
    with pytest.raises(AppError) as e:
        _measure(scene, CARD, segmenter, side="right")
    assert e.value.code == "IMAGE_TOO_BLURRY" and e.value.side == "right"


def test_steep_angle_rejected(segmenter):
    scene = render(6, tilt_deg=55)
    with pytest.raises(AppError) as e:
        _measure(scene, CARD, segmenter)
    assert e.value.code == "ANGLE_TOO_STEEP"


def test_reference_not_found(segmenter):
    scene = render(7)  # credit card scene, but an ArUco marker is requested
    with pytest.raises(AppError) as e:
        _measure(scene, ARUCO, segmenter)
    assert e.value.code == "REF_NOT_FOUND"


def test_lens_not_found(segmenter):
    scene = render(8)
    img = scene.image.copy()
    h, w = img.shape[:2]
    img[:, int(w * 0.52):] = cv2.GaussianBlur(img[:, int(w * 0.52):], (0, 0), 1)  # keep texture
    img[:, int(w * 0.55):] = img[:, int(w * 0.55) - 1:int(w * 0.55)]  # smear out the lens region
    with pytest.raises(AppError) as e:
        measure_lens(encode(img), CARD, None, "left", segmenter, max_pixels=40_000_000)
    assert e.value.code == "LENS_NOT_FOUND"


def test_low_resolution_still_measures_with_warning(segmenter):
    scene = render(9, image_size=(1000, 750), px_per_mm_target=3)
    m = _measure(scene, CARD, segmenter)
    assert [w["code"] for w in m.warnings] == ["LOW_RESOLUTION"]
    assert abs(m.result["A"] - scene.A) < 0.8 and abs(m.result["B"] - scene.B) < 0.8
    assert m.result["accuracy_mm"] >= 0.4  # honest about the lower resolution


# ---------------------------------------------------------------------------- image decoding


def test_invalid_image():
    with pytest.raises(AppError) as e:
        load_image(b"not an image", side="left", max_pixels=40_000_000)
    assert e.value.code == "INVALID_IMAGE"


def test_too_many_pixels():
    buf = io.BytesIO()
    Image.new("RGB", (3000, 3000)).save(buf, "PNG")
    with pytest.raises(AppError) as e:
        load_image(buf.getvalue(), side="left", max_pixels=5_000_000)
    assert e.value.code == "IMAGE_TOO_LARGE"


def test_exif_orientation_applied():
    img = Image.new("RGB", (400, 300), "white")
    exif = img.getexif()
    exif[0x0112] = 6  # rotate 90° CW on display
    buf = io.BytesIO()
    img.save(buf, "JPEG", exif=exif.tobytes())
    loaded = load_image(buf.getvalue(), side=None, max_pixels=40_000_000)
    assert loaded.bgr.shape[:2] == (400, 300)


def test_messaging_app_compression_warning():
    buf = io.BytesIO()
    Image.new("RGB", (1600, 1200), "gray").save(buf, "JPEG", quality=80)  # no EXIF, WhatsApp size
    codes = [w["code"] for w in load_image(buf.getvalue(), side="left", max_pixels=40_000_000).warnings]
    assert "LIKELY_COMPRESSED" in codes


def test_camera_jpeg_not_flagged():
    img = Image.new("RGB", (4032, 3024), "gray")
    exif = img.getexif()
    exif[0x010F] = "Phone"
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=92, exif=exif.tobytes())
    assert load_image(buf.getvalue(), side="left", max_pixels=40_000_000).warnings == []
