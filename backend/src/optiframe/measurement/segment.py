"""EfficientSAM-Ti (ONNX) box-prompted segmentation.

Model: OpenCV Model Zoo `image_segmentation_efficientsam_ti_2025april.onnx` (Apache-2.0).
Inputs: batched_images [1,3,1024,1024] RGB in [0,1]; batched_point_coords [1,1,6,2];
batched_point_labels [1,1,6] (1 = foreground point, 2/3 = box top-left/bottom-right, -1 = padding).
Outputs: output_masks [1,1,3,1024,1024] logits; iou_predictions [1,1,3].
"""

import logging
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

log = logging.getLogger("optiframe")

INPUT_SIZE = 1024
MAX_POINTS = 6


@dataclass
class MaskCandidate:
    mask: np.ndarray  # bool, same size as the input image
    iou: float


class Segmenter:
    def __init__(self, model_path: Path):
        import onnxruntime as ort

        opts = ort.SessionOptions()
        opts.log_severity_level = 3
        self.session = ort.InferenceSession(str(model_path), opts, providers=["CPUExecutionProvider"])

    def predict_box(self, bgr: np.ndarray, box: tuple[float, float, float, float]) -> list[MaskCandidate]:
        return self.predict(bgr, [(box[0], box[1]), (box[2], box[3])], [2, 3])

    def predict_point(self, bgr: np.ndarray, point: tuple[float, float]) -> list[MaskCandidate]:
        return self.predict(bgr, [point], [1])

    def predict(self, bgr: np.ndarray, points: list[tuple[float, float]], point_labels: list[int]
                ) -> list[MaskCandidate]:
        h, w = bgr.shape[:2]
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        resized = cv2.resize(rgb, (INPUT_SIZE, INPUT_SIZE), interpolation=cv2.INTER_AREA)
        image = (resized.astype(np.float32) / 255.0).transpose(2, 0, 1)[None]
        sx, sy = INPUT_SIZE / w, INPUT_SIZE / h
        coords = np.zeros((1, 1, MAX_POINTS, 2), np.float32)
        labels = np.full((1, 1, MAX_POINTS), -1, np.float32)
        for i, ((x, y), lab) in enumerate(zip(points, point_labels, strict=True)):
            coords[0, 0, i] = [x * sx, y * sy]
            labels[0, 0, i] = lab
        masks, ious = self.session.run(None, {
            "batched_images": image, "batched_point_coords": coords, "batched_point_labels": labels,
        })
        out = []
        for logits, iou in zip(masks[0, 0], ious[0, 0], strict=True):
            m = cv2.resize(logits.astype(np.float32), (w, h), interpolation=cv2.INTER_LINEAR) > 0
            out.append(MaskCandidate(mask=m, iou=float(iou)))
        return out


def load_segmenter(model_path: Path) -> Segmenter | None:
    if not model_path.exists():
        log.error("Segmentation model not found at %s — run `uv run optiframe-fetch-model`", model_path)
        return None
    try:
        return Segmenter(model_path)
    except Exception:
        log.exception("Failed to load segmentation model")
        return None
