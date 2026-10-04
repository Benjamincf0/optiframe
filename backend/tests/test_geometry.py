"""Frame generation: every combination must yield a single, closed, manifold, printable mesh."""

import time

import numpy as np
import pytest
from conftest import contour, design
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st
from synth import lens_shape

from optiframe.errors import AppError
from optiframe.geometry.frame import prepare_contour
from optiframe.geometry.pipeline import generate, sign_design, verify_design
from optiframe.geometry.validate import check_mesh, load_stl

SECRET = "s"


def _ok(d: dict):
    t = time.monotonic()
    r = generate(d, SECRET)
    assert time.monotonic() - t < 20
    mesh = load_stl(r.stl)
    report = check_mesh(mesh)
    assert report.ok, report.problems
    assert abs(report.volume_mm3 - r.volume_mm3) < 1.0
    return r


@pytest.mark.parametrize("pattern", ["none", "woven", "honeycomb", "brushed", "dots"])
@pytest.mark.parametrize("text", ["", "Amélie", "JO-8"])
def test_patterns_and_engraving(pattern, text):
    r = _ok(design(pattern=pattern, engraving_text=text))
    assert abs(r.max_deviation_mm - 0.2) < 0.05  # seat = contour + clip clearance
    assert verify_design(SECRET, r.stl, design(pattern=pattern, engraving_text=text), r.signature)


def test_pattern_and_engraving_change_geometry():
    base = _ok(design())
    embossed = _ok(design(pattern="dots"))
    engraved = _ok(design(engraving_text="I"))  # narrow enough not to lengthen the tenon
    assert embossed.volume_mm3 > base.volume_mm3  # emboss adds material
    # the 0.4 mm deboss removes material: an "I" at 2.2 mm cap height is ~0.5 mm × 2.2 mm
    removed = base.volume_mm3 - engraved.volume_mm3
    assert 0.2 < removed < 1.0


def test_long_engraving_lengthens_both_tenons_symmetrically():
    base = _ok(design())
    long = _ok(design(engraving_text="WWWWWWWW"))
    assert long.frame_width_mm > base.frame_width_mm
    assert long.lens_centers == base.lens_centers


@pytest.mark.parametrize("params", [
    {"bridge_mm": 12.0, "depth_mm": 3.0, "rim_offset_mm": 0.5, "clip_clearance_mm": 0.1},
    {"bridge_mm": 30.0, "depth_mm": 8.0, "rim_offset_mm": 3.0, "clip_clearance_mm": 0.3},
    {"bridge_mm": 12.0, "depth_mm": 8.0, "rim_offset_mm": 3.0, "clip_clearance_mm": 0.3},
])
def test_parameter_extremes(params):
    r = _ok(design(pattern="honeycomb", engraving_text="EXTREME", **params))
    assert abs(r.max_deviation_mm - params["clip_clearance_mm"]) < 0.05


def test_asymmetric_pair_and_lens_centres():
    d = design(left_contour_mm=contour(44, 32, taper=-0.1, n=2.2), right_contour_mm=contour(58, 41, n=3.2),
               bridge_mm=20)
    r = _ok(d)
    # box centres at ±(bridge/2 + A/2); wearer's right lens on −x
    assert r.lens_centers["right"][0] == pytest.approx(-(10 + 29), abs=0.01)
    assert r.lens_centers["left"][0] == pytest.approx(10 + 22, abs=0.01)


def test_uncentred_input_contours_are_recentred():
    shifted = (np.array(contour()) + [7.5, -3.0]).tolist()
    a = _ok(design(right_contour_mm=shifted))
    b = _ok(design())
    assert a.volume_mm3 == pytest.approx(b.volume_mm3, rel=1e-4)


def test_self_intersecting_contour_rejected():
    bow = [[np.cos(t) * 25, np.sin(2 * t) * 15] for t in np.linspace(0, 2 * np.pi, 40, endpoint=False)]
    with pytest.raises(AppError) as e:
        generate(design(left_contour_mm=bow), SECRET)
    assert e.value.code == "INVALID_CONTOUR" and e.value.side == "left"


def test_single_area_contour_repaired_before_generation():
    # A traced edge can contain a tiny self-touch after coordinates are rounded
    # for the JSON response.  Shapely repairs this to one polygon; it must not
    # be rejected after the user has already approved the preview.
    traced = np.array([
        [-25, -20], [0, -20], [25, -20], [25, 0], [25, 20], [10, 20],
        [0, 20], [0, 19.999], [0, 20], [-10, 20], [-25, 20], [-25, 0],
        [-25, -10], [-25, -20], [-25, -20], [-25, -20],
    ])
    assert prepare_contour(traced, "left").is_valid


def test_implausible_lens_size_rejected():
    with pytest.raises(AppError) as e:
        generate(design(right_contour_mm=contour(120, 30)), SECRET)
    assert e.value.code == "INVALID_CONTOUR"


def test_signature_binds_stl_and_design():
    d = design()
    r = generate(d, SECRET)
    assert sign_design(SECRET, r.stl, d) == r.signature
    assert not verify_design(SECRET, r.stl + b"x", d, r.signature)
    assert not verify_design(SECRET, r.stl, design(bridge_mm=19.0), r.signature)
    assert not verify_design("other", r.stl, d, r.signature)


@settings(max_examples=12, deadline=None, suppress_health_check=[HealthCheck.too_slow])
@given(
    a=st.floats(36, 62), ratio=st.floats(0.55, 0.85), n=st.floats(2.0, 4.0), taper=st.floats(-0.15, 0.15),
    a2=st.floats(36, 62), bridge=st.floats(12, 30), depth=st.floats(3, 8), rim=st.floats(0.5, 3),
    pattern=st.sampled_from(["none", "woven", "honeycomb", "brushed", "dots"]),
)
def test_random_designs_are_printable(a, ratio, n, taper, a2, bridge, depth, rim, pattern):
    left = np.round(lens_shape(a, a * ratio, n, taper, pts=360), 3).tolist()
    right = np.round(lens_shape(a2, a2 * ratio, n, -taper, pts=360), 3).tolist()
    _ok(design(left_contour_mm=left, right_contour_mm=right, bridge_mm=round(bridge, 1), depth_mm=round(depth, 1),
               rim_offset_mm=round(rim, 1), pattern=pattern, engraving_text="Hypo"))
