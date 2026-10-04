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
  backend/              Python 3.12 + FastAPI (uv) — see backend/README.md and backend/PLAN.md
    src/optiframe/
      api/              Route modules (meta, measure, generate, orders, accounts, admin)
      measurement/      Photo → reference → homography → EfficientSAM segmentation → contour → A/B
      geometry/         Parametric frame (rims, groove, bridge, tenons), patterns, engraving, mesh checks
      orders/           Pricing, order lifecycle, payment/mail/storage adapters
    tests/              Synthetic-photo accuracy tests, geometry property tests, API flow tests
```

Backend commands (from `backend/`): `uv sync`, `uv run optiframe-fetch-model` (once), `uv run optiframe` (dev server on http://127.0.0.1:8000, docs at `/api/docs`), `uv run pytest`, `uv run ruff check src tests`.

**Frontend ↔ backend**: the frontend always calls the relative path `/api`. In dev, `frontend/vite.config.ts` proxies `/api` to `http://127.0.0.1:8000` (override with `API_PROXY_TARGET` in `frontend/.env.local`), so run both servers and nothing else is needed. In prod, either rewrite `/api/*` to the backend on the frontend host, or build with `VITE_API_BASE_URL=https://<backend>/api` and add the frontend origin to `OPTIFRAME_CORS_ORIGINS`.

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

## Backend API spec (implemented in `backend/`; design notes in `backend/PLAN.md`)

Python 3.12 + FastAPI, managed with `uv`. All routes under `/api`. `/measure` and `/generate` are **stateless** — images are processed in memory and never stored. Only orders/accounts persist.

### Conventions

- **Error envelope** (every non-2xx): `{ "error": { "code", "message", "side"?, "details"? } }`. `message` is human-readable and shown to users; never a stack trace. `X-Request-ID` echoed on every response.
- **Auth**: bearer JWT in `Authorization` header (not cookies — frontend and backend are cross-origin and Safari iOS blocks third-party cookies).
- **Coordinates**: all contours are mm, **front view** (as seen by someone facing the wearer), +x right, +y up, origin at the lens boxing center, CCW. STL: origin at bridge center, +z toward the observer (outer face); right lens on −x, left on +x, lens box centers at x = ±(bridge/2 + A/2).
- **Capture convention**: lens photographed **convex side up**, top of lens toward top of photo. Required for correct scale (lens edge on the reference plane) and un-mirrored contours.
- Snapshot from try-on contains a face → **never** sent to the backend, not even with the order.
- Requests are synchronous (no job polling). The Processing/Generating screens animate their status text client-side.
- `/measure*` and `/generate` are rate-limited per IP (429 `RATE_LIMITED`). The server may return 503 `SERVICE_UNAVAILABLE` when busy or when the model isn't loaded.

### Meta

| Route | Description |
|---|---|
| `GET /api/health` | Liveness + whether the segmentation model is loaded |
| `GET /api/options` | Source of truth for: reference presets (credit card 85.60×53.98, A4 297×210, ArUco dictionaries), param ranges/defaults (bridge 12–30 step 0.5 default 18, depth 3–8, rim offset 0.5–3, clip clearance 0.1–0.3), patterns, filament colors, materials + price/g, shipping fee, currency, engraving rules, whether sponsorship is enabled. Frontend must not hard-code these |

### Measurement

`POST /api/measure` — multipart: `left_image`, `right_image`, `reference` (JSON), optional `left_hint` / `right_hint` (lens placement-zone box, normalized `[x0,y0,x1,y1]`, used as segmentation prompt).

`POST /api/measure/lens` — single lens (FR-VAL-01 re-measure): `side` (`left`|`right`), `image`, `reference`, optional `hint`. Returns `{ "side", "lens": LensResult, "warnings": [...] }`.

Hints are strongly recommended (send the capture overlay's lens zone). Without one, the server searches the photo for the lens, which is less robust. Images up to 15 MB / 40 MP; JPEG, PNG, WebP or HEIC; EXIF orientation is applied.

```jsonc
// reference (discriminated union)
{"type":"credit_card"} | {"type":"a4"}
| {"type":"custom","width_mm":100,"height_mm":50}
| {"type":"aruco","dictionary":"DICT_4X4_50","marker_size_mm":40}

// response
{
  "left": LensResult, "right": LensResult,
  "asymmetric": bool,                 // |ΔA| or |ΔB| > 5 mm
  "warnings": [{"code":"LOW_RESOLUTION"|"LIKELY_COMPRESSED"|"FAINT_EDGE","side":"left","message":"..."}]
}
LensResult = {
  "contour_mm": [[x,y],...], "A": 52.3, "B": 38.1, "perimeter": 152.7,   // ISO 8624 boxing
  "box_mm": {"x_min","x_max","y_min","y_max"},
  "confidence": 0.93, "accuracy_mm": 0.4,
  "scale_px_per_mm": 10.0,            // px/mm of rectified_image (per lens — each photo has its own reference)
  "rectified_image": "data:image/jpeg;base64,...",   // perspective-corrected crop around the lens
  "rectified_origin_mm": [ox, oy]     // contour point (x, y) is at pixel ((ox + x)·s, (oy − y)·s), s = scale_px_per_mm
}
```

The contour is centred on its boxing centre, CCW, 360 points. A/B use the photo's horizontal axis.

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
- Filament color is not sent (doesn't affect geometry). Unknown fields are rejected (422).
- Contours may be in any position; the server re-centres each on its boxing centre. Valid: 16–4000 points, not self-intersecting, A 20–80 mm, B 15–70 mm.
- The STL is the frame **front only** (rims with clip groove, bridge, two tenons with a Ø1.6 mm hinge-pin hole). Temples are out of scope. `rim_offset_mm` is extra rim width on top of a fixed 1.2 mm structural wall. Long engravings lengthen both tenons symmetrically; 8 wide letters add ~40 mm to the frame width.
- `X-Lens-Centers-Mm` is JSON: `{"right":[x,y],"left":[x,y]}`.
- Response headers (CORS-exposed): `X-Volume-Mm3`, `X-Max-Deviation-Mm` (FR-VAL-02), `X-Frame-Width-Mm`, `X-Lens-Centers-Mm`, `X-Design-Signature` (HMAC of STL hash + params; required to place an order).
- Errors: `INVALID_CONTOUR`, `ENGRAVING_INVALID`, `GEOMETRY_FAILED`, `MESH_INVALID`, `PROCESSING_TIMEOUT`.
- Deterministic → cached by params hash; AR fine-tune regenerations are cheap.

### Pricing

`POST /api/quote` — `{ "volume_mm3", "material": "petg|pla|asa", "sponsor_code"? }` → `{ grams, price_per_g, material_cost, shipping, discount, total, currency, sponsored }`. Server is the only place pricing logic lives; orders recompute from the actual STL.

### Orders

| Route | Description |
|---|---|
| `POST /api/orders` | Multipart: `stl` (exact bytes from `/generate`) + `order` JSON (below). Optional bearer token links to account. Honors `Idempotency-Key` header |
| `GET /api/orders/{id}` | Status, details (`specs`, `pricing`, `estimated_delivery` `{from,to}`, `tracking_number`, `can_cancel`), timeline |
| `POST /api/orders/{id}/cancel` | Only while `received`; refunds via provider |
| `GET /api/orders/{id}/stl` | Re-download STL |

```jsonc
// order
{ "design": { /* exactly the JSON body sent to /api/generate */ },
  "design_signature": "<X-Design-Signature>",
  "material": "petg|pla|asa", "color": "matte_black|tortoiseshell|crystal|navy|bone|olive",
  "email": "a@b.c",
  "shipping_address": {"name","line1","line2"?,"city","postal_code","region"?,"country":"SN","phone"?},
  "payment": {"provider":"fake","token":"tok_..."},   // omit when sponsored; "tok_fail" simulates a decline
  "sponsor_code": "SNSF-2026"? }
```

- Order processing order: validate schema → verify design signature → **validate mesh** (watertight, manifold, volume > 0, fits bed; else `MESH_INVALID` "Frame mesh is invalid — please regenerate.") → recompute price → apply sponsorship → charge → persist → email.
- Returns the full order (same shape as `GET /api/orders/{id}`) plus `access_token`. Prices are in currency units, e.g. `pricing.total`.
- `GET`/`cancel`/`stl` require **either** `?t=<access_token>` (or header `X-Order-Token`; from the email link `/order/:id?t=…`) **or** the owning account's bearer token. Order IDs (`OF-7K3P9Q`) are guessable; the token is not. A wrong or missing token returns 404 `ORDER_NOT_FOUND`, so order existence isn't revealed.
- Status codes: 201 for a new order, 200 for an idempotent replay (same `Idempotency-Key` + same body). Same key with a different body → 409 `IDEMPOTENCY_CONFLICT`.
- Other errors: `DESIGN_SIGNATURE_INVALID` (STL or design doesn't match what `/generate` returned), `PAYMENT_REQUIRED`, `PAYMENT_FAILED` (402), `SPONSOR_CODE_INVALID`, `SPONSORSHIP_DISABLED`, `ORDER_NOT_CANCELLABLE` (409).
- Status: `received → printing → shipped → delivered` (or `cancelled`).

**Payments**: `PaymentProvider` interface; only the **fake** provider is implemented for now (every token succeeds except `tok_fail`; records a fake charge ID). Stripe later behind the same interface.

**Sponsored orders** (optional, enabled via config `OPTIFRAME_SPONSORSHIP_ENABLED`): a valid `sponsor_code` makes the order free (no payment step). Codes are created by admins, belong to a sponsor (e.g. an NGO), and have a usage limit and optional expiry. Invalid/exhausted code → `SPONSOR_CODE_INVALID`.

### Accounts

| Route | Description |
|---|---|
| `POST /api/auth/register` | email + password → token |
| `POST /api/auth/login` | email + password → token |
| `GET /api/me` | Profile + saved shipping address |
| `GET /api/me/orders` | The user's orders |

| `PATCH /api/me` | Update `name` / `shipping_address` |
| `POST /api/me/orders/claim` | `{order_id, access_token}` → attach a guest order to the signed-in account |

Guest checkout needs only email + shipping address. Guest orders are **not** auto-attached by matching email: emails aren't verified, so that would let anyone register someone else's address and read their orders. They are attached via `/me/orders/claim` with the order's access token. Account checkout saves the shipping address to the profile. Tokens last 24 h. Logout is client-side (drop the token). Errors: `EMAIL_TAKEN` (409), `INVALID_CREDENTIALS` (401), `UNAUTHORIZED` (401).

### Admin / fulfilment (header `X-Admin-Key`)

| Route | Description |
|---|---|
| `GET /api/admin/orders?status=` | Print queue |
| `GET /api/admin/orders/{id}/stl` | Download for printing |
| `PATCH /api/admin/orders/{id}` | Advance status, set tracking number; emails customer |
| `POST /api/admin/sponsor-codes` | Create sponsor code (sponsor name, optional code (auto-generated otherwise), max uses, expiry). Codes are case-insensitive |
| `GET /api/admin/sponsor-codes` | List codes + usage |
| `PATCH /api/admin/sponsor-codes/{code}` | `{active}`: enable/disable a code |

Admin routes return 403 when `OPTIFRAME_ADMIN_API_KEY` is unset.

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
