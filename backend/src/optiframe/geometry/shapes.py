"""2D helpers: Clipper offsets and shapely ↔ manifold3d conversion."""

import numpy as np
import pyclipper
from manifold3d import CrossSection, FillRule, Manifold
from shapely.geometry import MultiPolygon, Polygon
from shapely.geometry.base import BaseGeometry
from shapely.ops import unary_union

CLIPPER_SCALE = 1000.0  # µm integer grid


def offset(poly: Polygon, delta: float) -> Polygon | MultiPolygon:
    """Round-join offset (positive = outward) using Clipper."""
    pco = pyclipper.PyclipperOffset(2.0, 0.01 * CLIPPER_SCALE)  # arcs within 10 µm
    rings = [np.asarray(poly.exterior.coords)[:-1]] + [np.asarray(r.coords)[:-1] for r in poly.interiors]
    for ring in rings:
        pco.AddPath(pyclipper.scale_to_clipper(ring.tolist(), CLIPPER_SCALE), pyclipper.JT_ROUND,
                    pyclipper.ET_CLOSEDPOLYGON)
    tree = pco.Execute2(delta * CLIPPER_SCALE)
    return _polytree_to_shapely(tree)


def _polytree_to_shapely(tree) -> Polygon | MultiPolygon:
    polys = []

    def walk(node):
        for child in node.Childs:
            if not child.IsHole:
                shell = np.array(pyclipper.scale_from_clipper(child.Contour, CLIPPER_SCALE))
                holes = [np.array(pyclipper.scale_from_clipper(h.Contour, CLIPPER_SCALE)) for h in child.Childs]
                if len(shell) >= 3:
                    polys.append(Polygon(shell, [h for h in holes if len(h) >= 3]))
                for h in child.Childs:
                    walk(h)

    walk(tree)
    return unary_union(polys) if polys else Polygon()


def polygons_of(geom: BaseGeometry) -> list[Polygon]:
    if geom.is_empty:
        return []
    if isinstance(geom, Polygon):
        return [geom]
    if isinstance(geom, MultiPolygon):
        return list(geom.geoms)
    return [g for g in getattr(geom, "geoms", []) if isinstance(g, Polygon) and not g.is_empty]


def to_cross_section(geom: BaseGeometry) -> CrossSection:
    contours = []
    for p in polygons_of(geom):
        contours.append(np.asarray(p.exterior.coords, dtype=np.float64)[:-1])
        contours.extend(np.asarray(r.coords, dtype=np.float64)[:-1] for r in p.interiors)
    return CrossSection(contours, FillRule.EvenOdd)


def extrude(geom: BaseGeometry, z0: float, z1: float) -> Manifold:
    cs = to_cross_section(geom)
    return Manifold.extrude(cs, z1 - z0).translate((0.0, 0.0, z0))


def opening(geom: BaseGeometry, r: float) -> BaseGeometry:
    """Morphological opening: removes features thinner than 2r (unprintable slivers)."""
    return geom.buffer(-r, quad_segs=4).buffer(r, quad_segs=4)
