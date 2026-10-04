"""Surface emboss tiles. Feature sizes are chosen to be printable with a 0.4 mm FDM nozzle."""

import math

from shapely.geometry import MultiPolygon, Point, Polygon, box
from shapely.geometry.base import BaseGeometry
from shapely.ops import unary_union

from optiframe.geometry.shapes import opening

EMBOSS_HEIGHT_MM = 0.4
MIN_FEATURE_RADIUS = 0.2  # features thinner than 0.4 mm are removed
MIN_PIECE_AREA = 0.15  # mm²


def _dots(b) -> BaseGeometry:
    x0, y0, x1, y1 = b
    pitch, r = 2.0, 0.5
    row_h = pitch * math.sqrt(3) / 2
    dots, j, y = [], 0, y0
    while y <= y1 + pitch:
        x = x0 + (pitch / 2 if j % 2 else 0)
        while x <= x1 + pitch:
            dots.append(Point(x, y).buffer(r, quad_segs=4))
            x += pitch
        y += row_h
        j += 1
    return unary_union(dots)


def _honeycomb(b) -> BaseGeometry:
    x0, y0, x1, y1 = b
    side, wall = 1.4, 0.6
    w, h = math.sqrt(3) * side, 1.5 * side
    cells, j, y = [], 0, y0 - side
    while y <= y1 + side:
        x = x0 - w + (w / 2 if j % 2 else 0)
        while x <= x1 + w:
            cells.append(Polygon([(x + side * math.cos(math.radians(30 + 60 * k)),
                                   y + side * math.sin(math.radians(30 + 60 * k))) for k in range(6)]))
            x += w
        y += h
        j += 1
    return unary_union([c.exterior for c in cells]).buffer(wall / 2, quad_segs=2)


def _brushed(b) -> BaseGeometry:
    x0, y0, x1, y1 = b
    pitch, width = 1.4, 0.6
    lines, y = [], y0
    while y <= y1:
        lines.append(box(x0 - 1, y, x1 + 1, y + width))
        y += pitch
    return unary_union(lines)


def _woven(b) -> BaseGeometry:
    """Basket weave: alternating cells of two horizontal / two vertical dashes."""
    x0, y0, x1, y1 = b
    cell, dash_l, dash_w = 3.0, 2.4, 0.7
    pad = (cell - dash_l) / 2
    gap = (cell - 2 * dash_w) / 3
    pieces = []
    i = 0
    x = x0
    while x <= x1 + cell:
        j, y = 0, y0
        while y <= y1 + cell:
            if (i + j) % 2 == 0:
                pieces += [box(x + pad, y + gap, x + pad + dash_l, y + gap + dash_w),
                           box(x + pad, y + 2 * gap + dash_w, x + pad + dash_l, y + 2 * gap + 2 * dash_w)]
            else:
                pieces += [box(x + gap, y + pad, x + gap + dash_w, y + pad + dash_l),
                           box(x + 2 * gap + dash_w, y + pad, x + 2 * gap + 2 * dash_w, y + pad + dash_l)]
            y += cell
            j += 1
        x += cell
        i += 1
    return unary_union(pieces)


_TILES = {"dots": _dots, "honeycomb": _honeycomb, "brushed": _brushed, "woven": _woven}


def pattern_geometry(name: str, region: BaseGeometry) -> BaseGeometry:
    """Pattern clipped to `region`, with unprintable slivers removed."""
    if name == "none" or region.is_empty:
        return Polygon()
    tile = _TILES[name](region.bounds)
    clipped = opening(tile.intersection(region), MIN_FEATURE_RADIUS)
    polys = [p for p in getattr(clipped, "geoms", [clipped]) if isinstance(p, Polygon) and p.area >= MIN_PIECE_AREA]
    return MultiPolygon(polys) if polys else Polygon()
