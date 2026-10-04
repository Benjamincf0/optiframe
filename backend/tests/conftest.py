import json
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient
from synth import lens_shape

from optiframe.config import BACKEND_ROOT, Settings
from optiframe.main import create_app
from optiframe.measurement.segment import Segmenter

MODEL = BACKEND_ROOT / "models" / "efficientsam_ti.onnx"
ADMIN_KEY = "test-admin-key"
SECRET = "test-secret-key-0123456789abcdef0123456789"


@pytest.fixture(scope="session")
def segmenter() -> Segmenter:
    if not MODEL.exists():
        pytest.skip("segmentation model missing — run `uv run optiframe-fetch-model`")
    return Segmenter(MODEL)


def make_settings(tmp: Path, **overrides) -> Settings:
    values = dict(
        secret_key=SECRET, admin_api_key=ADMIN_KEY, database_url=f"sqlite:///{tmp / 'test.db'}",
        storage_dir=tmp / "storage", model_path=MODEL, rate_limit_per_minute=0, sponsorship_enabled=True,
    )
    return Settings(**(values | overrides))


@pytest.fixture
def settings(tmp_path) -> Settings:
    return make_settings(tmp_path)


@pytest.fixture
def client(settings, segmenter):
    app = create_app(settings, load_model=False)
    app.state.segmenter = segmenter
    with TestClient(app) as c:
        yield c


@pytest.fixture
def client_no_model(settings):
    app = create_app(settings, load_model=False)
    with TestClient(app) as c:
        yield c


def contour(a=52.0, b=38.0, taper=0.08, n=2.6) -> list[list[float]]:
    return np.round(lens_shape(a, b, n, taper, pts=360), 3).tolist()


def design(**kw) -> dict:
    d = {
        "left_contour_mm": contour(taper=-0.08), "right_contour_mm": contour(),
        "bridge_mm": 18.0, "depth_mm": 5.0, "rim_offset_mm": 1.5, "clip_clearance_mm": 0.2,
        "pattern": "none", "engraving_text": "",
    }
    d.update(kw)
    return d


ADDRESS = {"name": "Awa Diallo", "line1": "12 Rue de la Paix", "city": "Dakar", "postal_code": "10200",
           "country": "sn"}


def order_payload(d: dict, signature: str, **kw) -> dict:
    p = {"design": d, "design_signature": signature, "material": "petg", "color": "navy",
         "email": "Awa@Example.org", "shipping_address": ADDRESS, "payment": {"provider": "fake", "token": "tok_ok"}}
    p.update(kw)
    return p


def post_order(client, stl: bytes, payload: dict, headers=None):
    return client.post("/api/orders", files={"stl": ("frame.stl", stl, "model/stl")},
                       data={"order": json.dumps(payload)}, headers=headers or {})
