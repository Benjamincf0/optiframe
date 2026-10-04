/**
 * Export a lens contour polygon (in mm) as a 1:1 SVG.
 * 1 user unit = 1 mm, so SVG viewBox dimensions equal real-world mm dimensions.
 * The user can print this at 100% scale and place the physical lens on top to verify.
 */
export function exportContourSVG(
  contour: [number, number][],
  side: 'left' | 'right',
  A: number,
  B: number,
): void {
  if (!contour.length) return

  const xs = contour.map(p => p[0])
  const ys = contour.map(p => p[1])
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  const maxX = Math.max(...xs)
  const maxY = Math.max(...ys)

  const pad = 2 // mm padding
  const w = maxX - minX + pad * 2
  const h = maxY - minY + pad * 2

  // Translate contour to start at (pad, pad)
  const pts = contour
    .map(([x, y]) => `${(x - minX + pad).toFixed(3)},${(y - minY + pad).toFixed(3)}`)
    .join(' ')

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     viewBox="0 0 ${w.toFixed(3)} ${h.toFixed(3)}"
     width="${w.toFixed(3)}mm"
     height="${h.toFixed(3)}mm">
  <title>OptiFrame ${side} lens contour — 1:1 scale</title>
  <desc>A=${A.toFixed(1)}mm B=${B.toFixed(1)}mm. Print at 100% — do not scale to fit.</desc>

  <!-- Outer reference rectangle -->
  <rect x="${pad}" y="${pad}" width="${A.toFixed(3)}" height="${B.toFixed(3)}"
        fill="none" stroke="#2563eb" stroke-width="0.3" stroke-dasharray="2 1"/>

  <!-- Lens contour — place the physical lens on this outline -->
  <polygon points="${pts}"
           fill="none" stroke="#111" stroke-width="0.5" stroke-linejoin="round"/>

  <!-- Labels -->
  <text x="${(w / 2).toFixed(1)}" y="${(h - 0.3).toFixed(1)}"
        font-family="sans-serif" font-size="2.5" text-anchor="middle" fill="#2563eb">
    A = ${A.toFixed(1)} mm
  </text>
  <text x="0.5" y="${(h / 2).toFixed(1)}"
        font-family="sans-serif" font-size="2.5" text-anchor="middle" fill="#2563eb"
        transform="rotate(-90 0.5 ${(h / 2).toFixed(1)})">
    B = ${B.toFixed(1)} mm
  </text>
  <text x="${(w / 2).toFixed(1)}" y="2"
        font-family="sans-serif" font-size="2" text-anchor="middle" fill="#71717a">
    ${side.toUpperCase()} — PRINT AT 100% — DO NOT SCALE
  </text>
</svg>`

  const blob = new Blob([svg], { type: 'image/svg+xml' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `optiframe-${side}-contour.svg`
  a.click()
  URL.revokeObjectURL(url)
}
