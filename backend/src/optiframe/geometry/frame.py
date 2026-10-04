"""Parametric frame front: two independent rims with a clip-in groove, bridge, tenons, pattern, engraving.

Coordinates (mm): front view, origin at bridge centre, +x observer's right, +y up, +z toward the observer.
z = 0 is the back face (print bed side), z = depth the outer face. The wearer's right lens sits at −x.

Rim cross-section, back to front:
  [0, UNDERCUT_T]               opening = contour − UNDERCUT_OVERLAP   (snap lip: the clip-in undercut)
  [UNDERCUT_T, depth − LIP_T]   opening = contour + clip_clearance     (lens seat / groove)
  [depth − LIP_T, depth]        opening = contour − LIP_OVERLAP        (front retaining lip)
"""

from dataclasses import dataclass

import numpy as np
from manifold3d import Manifold, OpType
from shapely import affinity
from shapely.geometry import LineString, Polygon, box
from shapely.ops import unary_union

from optiframe.catalog import ENGRAVING_DEPTH_MM
from optiframe.errors import AppError
from optiframe.geometry import engraving
from optiframe.geometry.patterns import EMBOSS_HEIGHT_MM, pattern_geometry
from optiframe.geometry.shapes import extrude, offset, opening, polygons_of

WALL_MM = 1.2  # structural rim wall beyond the seat; rim_offset adds to this
LIP_OVERLAP_MM = 0.8
LIP_T_MM = 0.8
UNDERCUT_OVERLAP_MM = 0.3
UNDERCUT_T_MM = 0.6
BRIDGE_HEIGHT_MM = 4.0
TENON_HEIGHT_MM = 7.0
TENON_LENGTH_MM = 10.0
TENON_RADIUS_MM = 1.5
HINGE_HOLE_D_MM = 1.6
HINGE_FROM_TIP_MM = 2.5
HINGE_ZONE_MM = 4.8  # tenon tip region kept clear of engraving
ENGRAVING_CAP_MM = 2.2
ENGRAVING_MARGIN_MM = 0.6
PATTERN_INSET_MM = 0.4
OVERLAP = 0.05  # small overlaps make unions robust
MAX_BED_MM = 220.0


@dataclass
class FrameSpec:
    right: np.ndarray  # wearer's right lens contour (front view, mm)
    left: np.ndarray
    bridge_mm: float
    depth_mm: float
    rim_offset_mm: float
    clip_clearance_mm: float
    pattern: str
    engraving_text: str


@dataclass
class FrameModel:
    manifold: Manifold
    right_contour: Polygon  # placed lens contours
    left_contour: Polygon
    lens_centers: dict
    seat_z: float


def prepare_contour(pts: np.ndarray, side: str) -> Polygon:
    """Validate a lens contour and centre it on its boxing centre."""
    pts = np.asarray(pts, dtype=np.float64)
    if pts.ndim != 2 or pts.shape[1] != 2 or not (16 <= len(pts) <= 4000) or not np.all(np.isfinite(pts)):
        raise AppError("INVALID_CONTOUR", "Lens outline must have 16–4000 points.", side=side)
    if np.allclose(pts[0], pts[-1]):
        pts = pts[:-1]
    poly = Polygon(pts)
    if not poly.is_valid or poly.area <= 0:
        raise AppError("INVALID_CONTOUR", "Lens outline crosses itself.", side=side)
    minx, miny, maxx, maxy = poly.bounds
    a, b = maxx - minx, maxy - miny
    if not (20 <= a <= 80 and 15 <= b <= 70):
        raise AppError("INVALID_CONTOUR", f"Lens size {a:.1f} × {b:.1f} mm is outside the supported range.", side=side)
    poly = affinity.translate(poly, -(minx + maxx) / 2, -(miny + maxy) / 2)
    return poly


def _x_extent_at(poly: Polygon, y: float) -> tuple[float, float]:
    minx, _, maxx, _ = poly.bounds
    hit = poly.intersection(LineString([(minx - 1, y), (maxx + 1, y)]))
    if hit.is_empty:
        raise AppError("GEOMETRY_FAILED", "Lens outline is too irregular to attach the bridge.")
    xs = np.asarray([c[0] for g in getattr(hit, "geoms", [hit]) for c in g.coords])
    return float(xs.min()), float(xs.max())


def _rounded_box(x0, y0, x1, y1, r) -> Polygon:
    return box(x0 + r, y0 + r, x1 - r, y1 - r).buffer(r, quad_segs=8)


def build_frame(spec: FrameSpec) -> FrameModel:
    right = prepare_contour(spec.right, "right")
    left = prepare_contour(spec.left, "left")
    a_r = right.bounds[2] - right.bounds[0]
    a_l = left.bounds[2] - left.bounds[0]
    b_min = min(right.bounds[3] - right.bounds[1], left.bounds[3] - left.bounds[1])
    xr = -(spec.bridge_mm / 2 + a_r / 2)
    xl = spec.bridge_mm / 2 + a_l / 2
    right = affinity.translate(right, xr, 0)
    left = affinity.translate(left, xl, 0)

    depth, clear = spec.depth_mm, spec.clip_clearance_mm
    rim = clear + WALL_MM + spec.rim_offset_mm
    outer = [offset(c, rim) for c in (right, left)]
    seat = unary_union([offset(c, clear) for c in (right, left)])
    front_open = unary_union([offset(c, -LIP_OVERLAP_MM) for c in (right, left)])
    under_open = unary_union([offset(c, -UNDERCUT_OVERLAP_MM) for c in (right, left)])

    # Bridge: a band between the nasal edges at the upper third of the lenses.
    y_c = 0.3 * b_min / 2
    _, r_nasal = _x_extent_at(right, y_c)
    l_nasal, _ = _x_extent_at(left, y_c)
    bridge = box(r_nasal - 1.0, y_c - BRIDGE_HEIGHT_MM / 2, l_nasal + 1.0, y_c + BRIDGE_HEIGHT_MM / 2)

    # Tenons at the temporal sides; lengthened (symmetrically) if the engraving needs room.
    text = spec.engraving_text.strip()
    text_geom, text_w = (engraving.text_geometry(text, ENGRAVING_CAP_MM) if text else (Polygon(), 0.0))
    tenon_len = max(TENON_LENGTH_MM, text_w + HINGE_ZONE_MM + 2 * ENGRAVING_MARGIN_MM)
    r_temporal, _ = _x_extent_at(right, y_c)
    _, l_temporal = _x_extent_at(left, y_c)
    r_outer_x = outer[0].bounds[0]
    l_outer_x = outer[1].bounds[2]
    y0, y1 = y_c - TENON_HEIGHT_MM / 2, y_c + TENON_HEIGHT_MM / 2
    r_tip, l_tip = r_outer_x - tenon_len, l_outer_x + tenon_len
    tenon_r = unary_union([_rounded_box(r_tip, y0, r_outer_x, y1, TENON_RADIUS_MM),
                           box(r_outer_x - OVERLAP, y0, r_temporal + 1.0, y1)])
    tenon_l = unary_union([_rounded_box(l_outer_x, y0, l_tip, y1, TENON_RADIUS_MM),
                           box(l_temporal - 1.0, y0, l_outer_x + OVERLAP, y1)])

    outline = unary_union([*outer, bridge, tenon_r, tenon_l])
    if len(polygons_of(outline)) != 1:
        raise AppError("GEOMETRY_FAILED", "The bridge could not connect both rims with these settings.")
    width = outline.bounds[2] - outline.bounds[0]
    if width > MAX_BED_MM:
        raise AppError("GEOMETRY_FAILED", f"The frame would be {width:.0f} mm wide, larger than the printer bed.")

    z1, z2 = UNDERCUT_T_MM, depth - LIP_T_MM
    solid = Manifold.batch_boolean([
        extrude(outline.difference(under_open), 0.0, z1 + OVERLAP),
        extrude(outline.difference(seat), z1, z2 + OVERLAP),
        extrude(outline.difference(front_open), z2, depth),
    ], OpType.Add)

    # Surface emboss on the outer face.
    if spec.pattern != "none":
        face = outline.difference(front_open).buffer(-PATTERN_INSET_MM, quad_segs=4)
        pat = pattern_geometry(spec.pattern, face)
        if not pat.is_empty:
            solid = solid + extrude(pat, depth - OVERLAP, depth + EMBOSS_HEIGHT_MM)

    # Hinge pin holes (along y) near each tenon tip.
    for tip, sign in ((r_tip, 1.0), (l_tip, -1.0)):
        hole = Manifold.cylinder(TENON_HEIGHT_MM + 2, HINGE_HOLE_D_MM / 2, HINGE_HOLE_D_MM / 2, 24)
        hole = hole.rotate((-90.0, 0.0, 0.0)).translate((tip + sign * HINGE_FROM_TIP_MM, y0 - 1, depth / 2))
        solid = solid - hole

    # Engraving: debossed into the back face (z = 0) of the right tenon, mirrored to read from behind.
    if text:
        region = box(r_tip + HINGE_ZONE_MM, y0 + ENGRAVING_MARGIN_MM, r_outer_x - ENGRAVING_MARGIN_MM,
                     y1 - ENGRAVING_MARGIN_MM)
        tx0, ty0, tx1, ty1 = text_geom.bounds
        cx, cy = (region.bounds[0] + region.bounds[2]) / 2, y_c
        placed = affinity.scale(text_geom, -1.0, 1.0, origin=((tx0 + tx1) / 2, 0))  # mirror for back view
        placed = affinity.translate(placed, cx - (tx0 + tx1) / 2, cy - (ty0 + ty1) / 2)
        placed = opening(placed, 0.12)
        if not region.buffer(1e-6).contains(placed):
            raise AppError("ENGRAVING_INVALID", "The engraving doesn't fit on the temple tenon.")
        solid = solid - extrude(placed, -OVERLAP, ENGRAVING_DEPTH_MM)

    return FrameModel(manifold=solid, right_contour=right, left_contour=left,
                      lens_centers={"right": [round(xr, 3), 0.0], "left": [round(xl, 3), 0.0]},
                      seat_z=(z1 + z2) / 2)
