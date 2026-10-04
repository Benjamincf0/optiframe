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

## Backend API spec (not yet built — full rationale in `backend/PLAN.md`)

Python 3.12 + FastAPI, managed with `uv`. All routes under `/api`. `/measure` and `/generate` are **stateless** — images are processed in memory and never stored. Only orders/accounts persist.

### Conventions

- **Error envelope** (every non-2xx): `{ "error": { "code", "message", "side"?, "details"? } }`. `message` is human-readable and shown to users; never a stack trace. `X-Request-ID` echoed on every response.
- **Auth**: bearer JWT in `Authorization` header (not cookies — frontend and backend are cross-origin and Safari iOS blocks third-party cookies).
- **Coordinates**: all contours are mm, **front view** (as seen by someone facing the wearer), +x right, +y up, origin at the lens boxing center, CCW. STL: origin at bridge center, +z toward the observer (outer face); right lens on −x, left on +x, lens box centers at x = ±(bridge/2 + A/2).
- **Capture convention**: lens photographed **convex side up**, top of lens toward top of photo. Required for correct scale (lens edge on the reference plane) and un-mirrored contours.
- Snapshot from try-on contains a face → **never** sent to the backend, not even with the order.

### Meta

| Route | Description |
|---|---|
| `GET /api/health` | Liveness + whether the segmentation model is loaded |
| `GET /api/options` | Source of truth for: reference presets (credit card 85.60×53.98, A4 297×210, ArUco dictionaries), param ranges/defaults (bridge 12–30 step 0.5 default 18, depth 3–8, rim offset 0.5–3, clip clearance 0.1–0.3), patterns, filament colors, materials + price/g, shipping fee, currency, engraving rules, whether sponsorship is enabled. Frontend must not hard-code these |

### Measurement

`POST /api/measure` — multipart: `left_image`, `right_image`, `reference` (JSON), optional `left_hint` / `right_hint` (lens placement-zone box, normalized `[x0,y0,x1,y1]`, used as segmentation prompt).

`POST /api/measure/lens` — single lens (FR-VAL-01 re-measure): `side` (`left`|`right`), `image`, `reference`, optional `hint`. Returns one `LensResult` + `warnings`.

```jsonc
// reference (discriminated union)
{"type":"credit_card"} | {"type":"a4"}
| {"type":"custom","width_mm":100,"height_mm":50}
| {"type":"aruco","dictionary":"DICT_4X4_50","marker_size_mm":40}

// response
{
  "left": LensResult, "right": LensResult,
  "asymmetric": bool,                 // |ΔA| or |ΔB| > 5 mm
  "warnings": [{"code":"LOW_RESOLUTION"|"LIKELY_COMPRESSED","side":"left","message":"..."}]
}
LensResult = {
  "contour_mm": [[x,y],...], "A": 52.3, "B": 38.1, "perimeter": 152.7,   // ISO 8624 boxing
  "box_mm": {"x_min","x_max","y_min","y_max"},
  "confidence": 0.93, "accuracy_mm": 0.4,
  "scale_px_per_mm": 10.0,            // per lens — each photo has its own reference
  "rectified_image": "data:image/jpeg;base64,...",
  "rectified_origin_mm": [x,y]        // where contour (0,0) sits in the rectified image
}
```

Errors (carry `side`): `REF_NOT_FOUND`, `LENS_NOT_FOUND`, `IMAGE_TOO_BLURRY`, `ANGLE_TOO_STEEP`, `INVALID_IMAGE`, `IMAGE_TOO_LARGE`, `PROCESSING_TIMEOUT`.

SVG 1:1 export is built **client-side** from `contour_mm` — no route.

### Generation

`POST /api/generate` — JSON in, binary STL out (`model/stl`).

```json
{ "left_contour_mm": [[x,y],...], "right_contour_mm": [[x,y],...],
  "bridge_mm": 18, "depth_mm": 5, "rim_offset_mm": 1.5, "clip_clearance_mm": 0.2,
  "pattern": "none|woven|honeycomb|brushed|dots", "engraving_text": "" }
```

- `engraving_text`: max **8 characters** (overrides the 20 in REQUIREMENTS FR-CUST-04 — 20 chars can't fit legibly on the tenon), 0.4 mm deboss, inner face of right tenon.
- Filament color is not sent (doesn't affect geometry).
- Response headers (CORS-exposed): `X-Volume-Mm3`, `X-Max-Deviation-Mm` (FR-VAL-02), `X-Frame-Width-Mm`, `X-Lens-Centers-Mm`, `X-Design-Signature` (HMAC of STL hash + params; required to place an order).
- Errors: `INVALID_CONTOUR`, `ENGRAVING_INVALID`, `GEOMETRY_FAILED`, `MESH_INVALID`, `PROCESSING_TIMEOUT`.
- Deterministic → cached by params hash; AR fine-tune regenerations are cheap.

### Pricing

`POST /api/quote` — `{ "volume_mm3", "material": "petg|pla|asa", "sponsor_code"? }` → `{ grams, price_per_g, material_cost, shipping, discount, total, currency, sponsored }`. Server is the only place pricing logic lives; orders recompute from the actual STL.

### Orders

| Route | Description |
|---|---|
| `POST /api/orders` | Multipart: `stl` + `order` JSON (generate params, `design_signature`, material, color, email, shipping address, `sponsor_code`?). Optional bearer token links to account. Honors `Idempotency-Key` header |
| `GET /api/orders/{id}` | Status, details, timeline |
| `POST /api/orders/{id}/cancel` | Only while `received`; refunds via provider |
| `GET /api/orders/{id}/stl` | Re-download STL |

- Order processing order: validate schema → verify design signature → **validate mesh** (watertight, manifold, volume > 0, fits bed; else `MESH_INVALID` "Frame mesh is invalid — please regenerate.") → recompute price → apply sponsorship → charge → persist → email.
- Returns `{ order_id, access_token, status, estimated_delivery: {from, to}, total }`.
- `GET`/`cancel`/`stl` require **either** `?t=<access_token>` (from the email link `/order/:id?t=…`) **or** the owning account's bearer token. Order IDs (`OF-7K3P9Q`) are guessable; the token is not.
- Status: `received → printing → shipped → delivered` (or `cancelled`).

**Payments**: `PaymentProvider` interface; only the **fake** provider is implemented for now (always succeeds, records a fake charge ID). Stripe later behind the same interface.

**Sponsored orders** (optional, enabled via config `SPONSORSHIP_ENABLED`): a valid `sponsor_code` makes the order free (no payment step). Codes are created by admins, belong to a sponsor (e.g. an NGO), and have a usage limit and optional expiry. Invalid/exhausted code → `SPONSOR_CODE_INVALID`.

### Accounts

| Route | Description |
|---|---|
| `POST /api/auth/register` | email + password → token |
| `POST /api/auth/login` | email + password → token |
| `GET /api/me` | Profile + saved shipping address |
| `GET /api/me/orders` | The user's orders |

Guest checkout needs only email + shipping address. Guest orders are attached to an account when that email registers. Logout is client-side (drop the token).

### Admin / fulfilment (header `X-Admin-Key`)

| Route | Description |
|---|---|
| `GET /api/admin/orders?status=` | Print queue |
| `GET /api/admin/orders/{id}/stl` | Download for printing |
| `PATCH /api/admin/orders/{id}` | Advance status, set tracking number; emails customer |
| `POST /api/admin/sponsor-codes` | Create sponsor code (sponsor name, max uses, expiry) |
| `GET /api/admin/sponsor-codes` | List codes + usage |

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
