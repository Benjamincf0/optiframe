# OptiFrame — Project Context for Claude

## What this project is

OptiFrame is a mobile-first SaaS web app that lets users photograph recycled eyeglass lenses and order a custom 3D-printed frame fitted exactly to those lenses. It was originally scoped for a CodeML hackathon challenge by Santé Numérique Sans Frontières (SN-SF) — the humanitarian context matters: this is for regions where opticians are rare or unaffordable.

## Repository structure

```
optiframe/
  REQUIREMENTS.md       Full product requirements (source of truth)
  CLAUDE.md             This file
  consignes.pdf         Original French hackathon brief (reference only)
  frontend/             React + TypeScript + Tailwind + Vite (bun)
    src/
      pages/            One file per route
      components/       Shared UI (PageHeader, StepProgress, BottomBar)
```

Backend does not exist yet.

## User flow (in order)

1. **Home** — landing, QR code, "Get started"
2. **Capture** — photograph left lens, then right lens, each with a reference object (credit card / ArUco / A4) in frame for scale
3. **Processing** — upload images to backend; backend: detect reference → homography → rectify → segment (AI) → contour → A, B, perimeter
4. **Measurements** — user reviews computed dimensions; can retake or export SVG 1:1 for physical verification
5. **Face Scan** — MediaPipe Face Mesh in-browser, measures pupillary distance → auto-sets bridge width; face never sent to server
6. **Customize** — bridge width (from PD, editable), rim offset, clip clearance, frame depth; plus surface emboss pattern (Woven / Honeycomb / Brushed / Dots / None) and optional name engraving (debossed into inner right tenon)
7. **Generating** — POST to backend STL endpoint; backend builds parametric frame with pattern + engraving geometry
8. **AR Try-on** — three.js loads STL, overlays on live MediaPipe face feed in real time; user can fine-tune fit; take a snapshot
9. **Checkout** — material (PETG / PLA / ASA), shipping address, payment; backend validates mesh before charging
10. **Order Status** — Received → Printing → Shipped → Delivered; cancel while Received

## Key technical decisions

- **Face data never leaves the device.** MediaPipe WASM runs entirely in-browser. This is a hard requirement, not a nice-to-have.
- **Backend does the heavy lifting.** Lens image processing (rectification, segmentation, measurement) and STL generation both happen server-side (Python/FastAPI). The browser handles only camera I/O, face mesh, and 3D rendering.
- **Reference object is mandatory for measurement.** Without it there is no pixel/mm scale and no accurate dimensions. The user must have a credit card, A4 sheet, or ArUco marker in the frame with each lens.
- **The STL contains the engraving geometry.** The engraving is a 0.4 mm deboss into the STL mesh — not a post-process or a label. The backend generates it.
- **Asymmetric lenses are supported.** Left and right can be entirely different shapes. The frame generator handles each rim independently.
- **Clip groove in rim.** The rim inner profile includes an undercut so lenses clip in without adhesive. Clip clearance is 0.1–0.3 mm.

## Backend API surface (not yet built)

```
POST /api/measure    images + reference spec → contour polygons + A/B/perimeter
POST /api/generate   contours + params + pattern + engraving → binary STL
POST /api/orders     STL + order params + payment → order ID
GET  /api/orders/:id order status
```

## Frontend current state

All 9 pages are scaffolded with placeholder UI — no features are implemented. Navigation works end-to-end. Run with:

```bash
cd frontend
bun dev
```

## What NOT to do

- Do not send face images or landmarks to any server.
- Do not use paid APIs (OpenAI, Google Vision, etc.) in the measurement or STL pipeline.
- Do not accept WhatsApp-compressed images silently — warn the user.
- Do not skip the reference object step — measurements are meaningless without scale.
- Do not use classical thresholding alone for lens segmentation — lenses are transparent with reflections.
