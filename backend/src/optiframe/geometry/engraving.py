"""Text → shapely outlines using the bundled font (Atkinson Hyperlegible Bold, SIL OFL 1.1).

Layout uses glyph advance widths (no GPOS kerning), which is adequate for ≤ 8 characters.
"""

from functools import lru_cache
from pathlib import Path

from fontTools.pens.basePen import BasePen
from fontTools.ttLib import TTFont
from shapely import affinity
from shapely.geometry import MultiPolygon, Polygon
from shapely.ops import unary_union

from optiframe.catalog import ENGRAVING_EXTRA_CHARS, ENGRAVING_MAX_CHARS

FONT_PATH = Path(__file__).resolve().parents[1] / "assets" / "fonts" / "AtkinsonHyperlegible-Bold.ttf"
CURVE_STEPS = 8


class _FlattenPen(BasePen):
    def __init__(self, glyph_set):
        super().__init__(glyph_set)
        self.contours: list[list[tuple[float, float]]] = []
        self._cur: list[tuple[float, float]] = []

    def _moveTo(self, pt):
        self._cur = [pt]

    def _lineTo(self, pt):
        self._cur.append(pt)

    def _curveToOne(self, p1, p2, p3):
        p0 = self._cur[-1]
        for i in range(1, CURVE_STEPS + 1):
            t = i / CURVE_STEPS
            mt = 1 - t
            self._cur.append((
                mt**3 * p0[0] + 3 * mt**2 * t * p1[0] + 3 * mt * t**2 * p2[0] + t**3 * p3[0],
                mt**3 * p0[1] + 3 * mt**2 * t * p1[1] + 3 * mt * t**2 * p2[1] + t**3 * p3[1],
            ))

    def _qCurveToOne(self, p1, p2):
        p0 = self._cur[-1]
        for i in range(1, CURVE_STEPS + 1):
            t = i / CURVE_STEPS
            mt = 1 - t
            self._cur.append((mt**2 * p0[0] + 2 * mt * t * p1[0] + t**2 * p2[0],
                              mt**2 * p0[1] + 2 * mt * t * p1[1] + t**2 * p2[1]))

    def _closePath(self):
        if len(self._cur) >= 3:
            self.contours.append(self._cur)
        self._cur = []

    _endPath = _closePath


@lru_cache(maxsize=1)
def _font() -> TTFont:
    return TTFont(str(FONT_PATH))


def font_metrics() -> tuple[int, int]:
    f = _font()
    return f["head"].unitsPerEm, f["OS/2"].sCapHeight


def unsupported_chars(text: str) -> list[str]:
    cmap = _font().getBestCmap()
    bad = []
    for ch in text:
        allowed = ch.isdigit() or ch in ENGRAVING_EXTRA_CHARS or (ch.isalpha() and ord(ch) <= 0x024F)
        if not allowed or ord(ch) not in cmap:
            bad.append(ch)
    return bad


def validate_text(text: str) -> str | None:
    """Return an error message, or None if the text can be engraved."""
    if len(text) > ENGRAVING_MAX_CHARS:
        return f"Engraving can be at most {ENGRAVING_MAX_CHARS} characters."
    bad = unsupported_chars(text)
    if bad:
        return f"These characters can't be engraved: {' '.join(sorted(set(bad)))}"
    return None


@lru_cache(maxsize=256)
def _glyph_outline(char: str) -> tuple[Polygon | MultiPolygon, int]:
    f = _font()
    gs = f.getGlyphSet()
    name = f.getBestCmap()[ord(char)]
    pen = _FlattenPen(gs)
    gs[name].draw(pen)
    geom = Polygon()
    for c in pen.contours:
        ring = Polygon(c).buffer(0)
        geom = geom.symmetric_difference(ring)  # even-odd: counters (holes) cancel out
    advance = f["hmtx"][name][0]
    return geom, advance


def text_geometry(text: str, cap_height_mm: float) -> tuple[Polygon | MultiPolygon, float]:
    """Outline of `text` with the baseline at y=0 and the left edge at x=0. Returns (geometry, width_mm)."""
    upem, cap = font_metrics()
    s = cap_height_mm / cap
    parts, x = [], 0.0
    for ch in text:
        g, adv = _glyph_outline(ch)
        if not g.is_empty:
            parts.append(affinity.translate(affinity.scale(g, s, s, origin=(0, 0)), x, 0))
        x += adv * s
    geom = unary_union(parts) if parts else Polygon()
    if geom.is_empty:
        return geom, 0.0
    minx, _, maxx, _ = geom.bounds
    return affinity.translate(geom, -minx, 0), maxx - minx
