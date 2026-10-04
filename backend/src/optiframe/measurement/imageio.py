"""Decode uploaded photos into BGR arrays and flag low-quality sources."""

import io
from dataclasses import dataclass, field

import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError
from pillow_heif import register_heif_opener

from optiframe.errors import AppError

register_heif_opener()

# Standard IJG luminance quantization table (quality 50). Only its sum is used, so order doesn't matter.
_STD_LUMA = np.array([
    16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55,
    14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62,
    18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92,
    49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99,
], dtype=np.float64)
_STD_LUMA_SUM = float(_STD_LUMA.sum())

# Long-edge sizes produced by messaging apps when they recompress photos (WhatsApp standard quality).
_MESSAGING_LONG_EDGES = {1600, 1280}


@dataclass
class LoadedImage:
    bgr: np.ndarray
    warnings: list[dict] = field(default_factory=list)


def estimate_jpeg_quality(img: Image.Image) -> float | None:
    """Estimate IJG quality from the luminance quantization table (None if not a JPEG)."""
    q = getattr(img, "quantization", None)
    if not q or 0 not in q:
        return None
    table = np.array(q[0], dtype=np.float64)
    if table.size != 64:
        return None
    scale = table.sum() / _STD_LUMA_SUM * 100.0  # IJG scale factor in percent
    if scale <= 100:
        return float(np.clip((200.0 - scale) / 2.0, 1, 100))
    return float(np.clip(5000.0 / scale, 1, 100))


def load_image(data: bytes, *, side: str | None, max_pixels: int) -> LoadedImage:
    try:
        img = Image.open(io.BytesIO(data))
        width, height = img.size
        if width * height > max_pixels:
            raise AppError("IMAGE_TOO_LARGE", f"This photo has more than {max_pixels // 1_000_000} megapixels.", side=side)
        fmt = img.format
        has_exif = bool(img.getexif())
        quality = estimate_jpeg_quality(img) if fmt == "JPEG" else None
        img = ImageOps.exif_transpose(img)
        img = img.convert("RGB")
    except AppError:
        raise
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as exc:
        raise AppError("INVALID_IMAGE", side=side) from exc

    rgb = np.asarray(img)
    bgr = np.ascontiguousarray(rgb[:, :, ::-1])
    warnings: list[dict] = []
    if width * height < 1_000_000:
        warnings.append({
            "code": "LOW_RESOLUTION", "side": side,
            "message": "This photo is below 1 megapixel, so measurements will be less accurate. Use the camera directly instead of a forwarded image.",
        })
    long_edge = max(width, height)
    if fmt == "JPEG" and not has_exif and (long_edge in _MESSAGING_LONG_EDGES or (quality is not None and quality < 70)):
        warnings.append({
            "code": "LIKELY_COMPRESSED", "side": side,
            "message": "This photo looks compressed by a messaging app (e.g. WhatsApp), which reduces accuracy. Use the original photo if you can.",
        })
    return LoadedImage(bgr=bgr, warnings=warnings)
