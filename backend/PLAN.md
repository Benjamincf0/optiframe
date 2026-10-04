# OptiFrame Backend — Implementation Plan

Status: **draft for review**. Nothing is built yet. Open decisions are in §9.

---

## 1. Principles

1. **Stateless compute, stateful orders.** `/measure` and `/generate` store nothing. Images are processed in memory and discarded. The only persistent data is orders and accounts.
2. **No face data, ever.** No route accepts face images, landmarks, or try-on snapshots. The snapshot (FR-CHK-02) shows a face, so it stays in the browser and is **not** part of the order payload.
3. **The server owns validation and pricing.** Parameter ranges, enums, prices, and mesh validity are decided server-side. `GET /api/options` publishes them so the frontend doesn't hard-code a copy.
4. **Same contract for every error.** Every non-2xx response has the same JSON envelope with a stable `code` and a human-readable `message` (NFR-07). There are no stack traces in responses.
5. **Keep to the latency budgets.** Measure < 15 s, generate < 20 s (NFR-04). Models load once at startup, CPU-bound work runs off the event loop, and a server-side timeout returns a clean error instead of hanging.

---

## 2. Stack

| Concern | Choice | Why |
|---|---|---|
| Project / deps | `uv`, Python 3.12, `src/` layout | Requested; 3.12 has wheels for every native dep below |
| Web | FastAPI, uvicorn, python-multipart, pydantic v2, pydantic-settings | |
| Image I/O | Pillow + `pillow-heif` | iPhone file-upload fallback produces HEIC; **EXIF orientation must be applied** or phone photos come in rotated |
| CV | `opencv-contrib-python-headless` | `contrib` is needed for `cv2.aruco`; headless because there's no GUI on the server. Must not be installed next to `opencv-python` |
| Segmentation | `onnxruntime` (CPU) + a SAM-family **small** model (MobileSAM / EfficientSAM / SAM2-tiny, chosen in M2 by benchmark) | SAM ViT-H on CPU won't meet 15 s or fit in hosting RAM. Kept behind an interface so a fine-tuned model can replace it |
| 2D geometry | `shapely`, `pyclipper` | Offsetting is required to use Clipper |
| 3D geometry | `manifold3d` (booleans/extrusion), `trimesh` (validation, STL export, volume) | manifold3d produces manifold output by construction, which is the core STL requirement |
| Text | `fonttools` + a bundled OFL sans-serif TTF (e.g. Inter) | Glyph outlines → shapely polygons → extrude. License goes in the README (NFR-10) |
| DB | SQLAlchemy 2.0 + Alembic; SQLite for dev, Postgres for prod | |
| File storage | `Storage` interface: local disk (dev) / S3-compatible such as R2 (prod) | Render's free-tier disk is ephemeral, so order STLs must not live only there |
| Auth | pwdlib (argon2) + PyJWT **bearer tokens** | Frontend (Vercel) and backend (Render/Fly) are on different origins. Safari iOS blocks third-party cookies, so cookie sessions would break on a target browser |
| Payments | `PaymentProvider` interface: `fake` (dev) and `stripe` | See §9 |
| Email | `Mailer` interface: console (dev) and SMTP/Resend | |
| Quality | ruff, pytest, hypothesis, httpx `TestClient` | |

---

## 3. Routes

All routes are under `/api`. Every one of them is needed by at least one requirement; the table says which.

### 3.1 Meta

| Method & path | Purpose | Req |
|---|---|---|
| `GET /api/health` | Liveness check. Also reports whether the ONNX model loaded | hosting |
| `GET /api/options` | Single source of truth for reference presets (credit card 85.60×53.98, A4 297×210, supported ArUco dictionaries), parameter ranges/defaults (bridge 12–30 step 0.5 default 18, depth 3–8, rim offset 0.5–3, clip clearance 0.1–0.3), patterns, filament colors (≥6), materials with price/g, shipping fee, currency, engraving rules (max 20 chars, allowed charset) | FR-CAP-03, FR-FACE-05/07, FR-CUST-01..04, FR-CHK-03 |

### 3.2 Measurement

| Method & path | Purpose | Req |
|---|---|---|
| `POST /api/measure` | Both lenses. Multipart: `left_image`, `right_image`, `reference` (JSON), optional `left_hint` / `right_hint` (lens placement-zone box from the capture overlay, normalized coordinates; used as the segmentation prompt) | §5, FR-CAP-08, FR-PROC, FR-MEAS |
| `POST /api/measure/lens` | One lens, same pipeline. Multipart: `side`, `image`, `reference`, `hint` | **FR-VAL-01** (second photo of the same lens → delta). Without this route the client would have to re-upload both images |

`reference` is a discriminated union (cleaner than separate `reference_type` and `reference_dims_mm` fields, which can't nest in multipart anyway):
```json
{"type":"credit_card"} | {"type":"a4"} |
{"type":"custom","width_mm":100,"height_mm":50} |
{"type":"aruco","dictionary":"DICT_4X4_50","marker_size_mm":40}
```

Response:
```jsonc
{
  "left":  LensResult,
  "right": LensResult,
  "asymmetric": true,          // |ΔA| or |ΔB| > 5 mm (FR-MEAS-04); the client could compute this, the server includes it for convenience
  "warnings": [ {"code":"LOW_RESOLUTION","side":"left","message":"..."} ]
}
LensResult = {
  "contour_mm": [[x,y], ...],  // closed, CCW, origin = boxing center, front-view coordinates (§6)
  "A": 52.3, "B": 38.1, "perimeter": 152.7,   // mm, ISO 8624 boxing
  "box_mm": {"x_min":..,"x_max":..,"y_min":..,"y_max":..},   // FR-MEAS-03
  "confidence": 0.93,          // 0–1
  "accuracy_mm": 0.4,          // ± estimate shown to the user (FR-MEAS-05)
  "scale_px_per_mm": 10.0,     // **per lens**; each photo has its own reference
  "rectified_image": "data:image/jpeg;base64,...",   // cropped around the lens (FR-MEAS-02)
  "rectified_origin_mm": [x,y] // where contour (0,0) falls in the image, so the overlay lines up exactly
}
```

**Changes from REQUIREMENTS §5, with reasons:**
- `scale_px_per_mm` moves from top level to each lens. The two photos have independent references and homographies, so a single shared scale would be wrong.
- `rectified_image` is added. Without it, FR-MEAS-02 ("contour drawn over the rectified lens image") can't be done: the client only has the unrectified photo.

Error codes: the spec's `REF_NOT_FOUND`, `LENS_NOT_FOUND`, `IMAGE_TOO_BLURRY`, `ANGLE_TOO_STEEP`, plus `INVALID_IMAGE` (decode failure or unsupported format), `IMAGE_TOO_LARGE` (> 15 MB or > 40 MP), `PROCESSING_TIMEOUT`. Each error carries `side` so the UI can say *which* photo to retake.

Non-blocking `warnings`: `LOW_RESOLUTION` (< 1 MP) and `LIKELY_COMPRESSED` (EXIF stripped + typical messaging-app dimensions such as a 1600 px long edge + high JPEG quantization). These back up the client-side check from FR-CAP-07; they don't replace it.

**SVG export (FR-MEAS-06 / VAL-03)** has no route. The client builds it from `contour_mm` with `width="…mm"` and a viewBox in mm. A server round-trip would add nothing.

### 3.3 Generation

| Method & path | Purpose | Req |
|---|---|---|
| `POST /api/generate` | JSON in, binary STL out (`model/stl`) | §5, FR-CUST-06, FR-GEN, FR-AR-05 (re-tuning calls it again) |

Request (all fields validated against `/api/options` ranges):
```json
{ "left_contour_mm": [[x,y],...], "right_contour_mm": [[x,y],...],
  "bridge_mm": 18, "depth_mm": 5, "rim_offset_mm": 1.5, "clip_clearance_mm": 0.2,
  "pattern": "none|woven|honeycomb|brushed|dots", "engraving_text": "" }
```
Filament color isn't sent because it doesn't change geometry.

Response headers (listed in CORS `expose_headers`):
- `X-Volume-Mm3`: used for the quote/weight (FR-CHK-04)
- `X-Max-Deviation-Mm`: measured contour vs. generated rim seat (FR-VAL-02)
- `X-Design-Signature`: HMAC(secret, sha256(STL) ‖ canonical params). See orders.
- `X-Frame-Width-Mm`, `X-Lens-Centers-Mm`: anchors for three.js alignment (FR-AR-02), in the coordinate system from §6

Error codes: `INVALID_CONTOUR` (self-intersecting, < 16 points, or implausible size), `ENGRAVING_INVALID` (too long, unsupported glyph, or won't fit legibly), `GEOMETRY_FAILED`, `MESH_INVALID`, `PROCESSING_TIMEOUT`.

Generation is deterministic, so results are cached in an LRU keyed by the params hash. AR re-tuning back and forth then costs nothing.

### 3.4 Pricing

| Method & path | Purpose | Req |
|---|---|---|
| `POST /api/quote` | `{volume_mm3, material}` → `{grams, price_per_g, material_cost, shipping, total, currency}` | FR-CHK-03/04: price shown **before** any account step. Keeps the pricing formula only on the server; the order endpoint recalculates it from the real STL |

Weight = volume × density (PLA 1.24, PETG 1.27, ASA 1.07 g/cm³), assuming solid prints since frame walls are too thin for meaningful infill.

### 3.5 Orders

| Method & path | Purpose | Req |
|---|---|---|
| `POST /api/orders` | Multipart: `stl` + `order` JSON (generate params, design signature, material, color, email, shipping address, payment fields). Optional bearer token links it to an account. Supports `Idempotency-Key` header | FR-CHK-05/06/07 |
| `GET /api/orders/{id}` | Status + details + timeline | FR-ORD-01/02/03 |
| `POST /api/orders/{id}/cancel` | Only while status is `received`; also refunds | FR-ORD-04 |
| `GET /api/orders/{id}/stl` | Re-download the STL | FR-CHK-08, FR-ORD-05 |

`POST /api/orders` runs in this order:
1. Validate the schema.
2. Verify the design signature, so only our generator's output can be ordered and the STL matches the stated params.
3. **Validate the mesh**: watertight, winding-consistent, positive volume, no degenerate faces, fits the printer bed. Failure returns `MESH_INVALID` → "Frame mesh is invalid — please regenerate."
4. Recalculate the price server-side.
5. **Only then** create the charge.
6. Persist the order and the STL.
7. Send the email.
8. Return `{order_id, access_token, status, estimated_delivery: {from, to}, total}`.

**Order access control.** Order IDs are human-readable (`OF-7K3P9Q`) and therefore guessable, so `GET`, `cancel` and `stl` require **either** the order's secret `access_token` (included in the email link, `/order/OF-7K3P9Q?t=…`) **or** a bearer token for the account that owns the order. Without this check, anyone could enumerate orders and read other people's names and addresses.

### 3.6 Accounts (FR-CHK-05 "account checkout", FR-ORD-01 "from any account")

| Method & path | Purpose |
|---|---|
| `POST /api/auth/register` | email + password → token |
| `POST /api/auth/login` | → token |
| `GET /api/me` | profile + saved shipping address |
| `GET /api/me/orders` | the user's orders |

Guest orders placed with an email are attached to the account when that email registers. Logout happens on the client (drop the token); the tokens are short-lived JWTs.

### 3.7 Fulfilment / admin

Without these routes the order tracker never moves past "Received".

| Method & path | Purpose |
|---|---|
| `GET /api/admin/orders?status=` | Print queue |
| `GET /api/admin/orders/{id}/stl` | Download for printing |
| `PATCH /api/admin/orders/{id}` | Move status `received → printing → shipped → delivered`, add tracking number. Each transition emails the customer |

Protected by an admin API key header. A real admin UI is out of scope.

### 3.8 Webhook (only if Stripe is chosen)

`POST /api/webhooks/payments`: confirms payment asynchronously and handles 3-D Secure / SCA.

---

## 4. Error envelope

```json
{ "error": { "code": "REF_NOT_FOUND", "message": "We couldn't find the credit card in your left-lens photo. Make sure all four corners are visible.", "side": "left", "details": {} } }
```
- Pydantic `RequestValidationError` is mapped to `VALIDATION_ERROR` with per-field messages.
- Unhandled exceptions become `INTERNAL_ERROR` with a generic message. The full trace and a request ID go to the logs only.
- The `X-Request-ID` header is echoed so bug reports can be traced.

---

## 5. Measurement pipeline (`POST /api/measure`)

Both lenses are processed in parallel in a thread pool.

1. **Load**: decode the image, apply EXIF transpose, convert HEIC, check size and resolution, and add warnings.
2. **Detect reference**
   - ArUco: `cv2.aruco.ArucoDetector`, then sub-pixel corners.
   - Card / A4 / custom: edge map → quadrilateral candidates → score by aspect ratio (± tolerance) and area → corner refinement with line fitting, which handles the card's rounded corners.
   - Returns `REF_NOT_FOUND` if nothing is found.
3. **Quality gates**
   - Variance of the Laplacian on the reference region (normalized for scale) → `IMAGE_TOO_BLURRY`.
   - Decompose the homography to get the camera tilt; > ~35° → `ANGLE_TOO_STEEP`.
4. **Homography + rectify**: map the reference corners to a metric plane at a fixed 10 px/mm, then warp only the region around the lens.
5. **Segment**: ONNX SAM-family model prompted with the placement-zone box, or with the region next to the reference if no hint was given. Mask → largest component → `LENS_NOT_FOUND` if the area or shape is implausible. Classical thresholding is never used alone (NFR-09).
6. **Refine the edge**: SAM masks are low-resolution, so each boundary point is snapped to the strongest gradient along its normal in the full-res rectified image. This step is what makes ±0.5 mm reachable.
7. **Smooth**: Savitzky–Golay / Fourier low-pass on the closed contour, then resample to ~360 evenly spaced points.
8. **Measure**: boxing system aligned to the photo's horizontal axis (§6). A = box width, B = box height, perimeter = polygon length.
9. **Estimate confidence**: combine reference reprojection error, blur score, mask stability (IoU across 2–3 jittered prompts) and edge-gradient strength into `confidence` and `accuracy_mm`.

**Accuracy test harness (built in M2, before tuning)**: synthetic scenes rendered with a known lens polygon, a reference object at random poses, plus blur, glare and noise. The pass criterion is |ΔA|, |ΔB| < 0.5 mm. Real photos of lenses measured with calipers are added as they become available.

---

## 6. Coordinate conventions (shared contract with the frontend)

- **Capture convention**: lens placed **convex (front) side up**. This matters for two reasons:
  1. The lens edge then rests on the table, i.e. on the reference plane, so the planar homography is valid. With the concave side up, the edge sits several mm above the plane and gets mis-scaled.
  2. The photo shows the front view, so the contour isn't mirrored.
- The top edge of the lens points toward the top of the photo, and the nasal side points toward the centre, per FR-CAP-01. The capture overlay must show this.
- `contour_mm` is in **front view** (as an observer facing the wearer sees it): +x right, +y up, origin at the boxing center, CCW.
- **STL coordinates**: front view, origin at bridge center, +x to the observer's right, +y up, +z toward the observer (outer face). Units are mm. Lens box centers are at x = ±(bridge/2 + A/2) (right lens on −x). three.js uses these anchors to place the frame.

---

## 7. Generation pipeline (`POST /api/generate`)

1. **Validate contours**: simple polygon, plausible size, then reorient to CCW.
2. **Rim profiles** (pyclipper offsets per lens, independently, which handles asymmetric pairs):
   - The lens seat is the contour + clip clearance.
   - The retaining lip is the contour − lip depth, so the lens clips in from the back past a small undercut/groove.
   - The outer rim is the contour + rim offset + wall.
3. **Front**: union of both rims and the bridge (spanning `bridge_mm` between the nasal edges, with nose-pad geometry). End pieces/tenons sit at the temporal sides. Then extrude to `depth_mm` with manifold3d.
4. **Surface pattern**: a 2D tile (hex, weave, lines, dots) clipped to the front outline minus a margin, embossed ~0.3–0.4 mm on the outer (+z) face and unioned in. Raised geometry, not a texture (FR-CUST-03).
5. **Engraving**: glyph outlines from fontTools, kerned, scaled so the cap height stays ≥ ~2.5 mm. That's roughly the FDM legibility limit with a 0.4 mm nozzle. Subtract 0.4 mm into the inner face of the right tenon. If the text can't fit legibly, return `ENGRAVING_INVALID`; never produce an unreadable result silently. See §9 Q3.
6. **Validate + export**: check with trimesh (watertight, consistent winding, volume > 0, bed fit), compute the max deviation of the seat from the input contour, then write a binary STL.

**Print orientation**: the back face goes on the bed, so the emboss faces up and needs no supports. The groove is a shallow horizontal overhang that bridges fine. Tenons are in-plane end pieces within the frame depth, not posts sticking out backward, so the whole front prints flat without supports.

**Test matrix**: hypothesis-generated contours (ellipses, rounded rects, aviator-like shapes, asymmetric pairs) × every pattern × engraving on/off × parameter range extremes. Every combination must be manifold and finish in < 20 s.

---

## 8. Layout & milestones

```
backend/
  pyproject.toml  uv.lock  .python-version  README.md (model/font/dataset licenses)
  alembic/  models/ (ONNX, fetched by script; not committed)  assets/fonts/
  src/optiframe/
    main.py            app factory, CORS, lifespan (load ONNX once), error handlers
    config.py          pydantic-settings (env-driven)
    errors.py          AppError + codes + messages
    api/               health, options, measure, generate, quote, orders, auth, me, admin, webhooks
    schemas/           pydantic request/response models (also generate the frontend TS types via openapi-typescript)
    measurement/       io, reference, quality, rectify, segment, contour, boxing
    geometry/          rim, bridge, tenon, patterns/, engraving, assemble, validate, export, signing
    orders/            service, pricing, payments/, mailer/, storage/
    db/                models, session
  tests/               unit + synthetic-image accuracy + geometry property tests + API tests
```

Ops: CORS allow-list from env. Upload limits. A concurrency semaphore on measure/generate, because they are CPU-heavy and shouldn't starve the server. Simple per-IP rate limiting on anonymous compute routes. Images are never written to logs.

| Milestone | Scope | Done when |
|---|---|---|
| **M1 Skeleton** | uv project, config, error envelope, `/health`, `/options`, CORS, CI-style `uv run pytest` + ruff | Frontend can call `/options` |
| **M2 Measure** | Reference detection (ArUco first, then card/A4/custom), rectify, segmentation model benchmark + integration, refinement, boxing, both measure routes, synthetic accuracy suite | ±0.5 mm on the synthetic suite, < 15 s on target hardware |
| **M3 Generate** | Rims, bridge, tenons, extrusion, then patterns, then engraving, validation, signing, cache | Property tests all manifold, < 20 s |
| **M4 Orders** | DB + migrations, quote, orders + access tokens, fake payments, console mailer, accounts, admin routes | End-to-end order with the fake provider |
| **M5 Hardening** | Stripe/email adapters (if chosen), rate limits, Dockerfile, deploy config | Deployed on Render/Fly |

M2 comes before M3 even though it's harder, because segmentation of transparent lenses is the biggest project risk and needs to be tested first.

---

## 9. Open decisions

1. **Progress reporting (FR-PROC-01, FR-GEN-01).** The spec defines synchronous request/response, which can't report real stage progress.
   - *Recommended*: keep it synchronous and have the client step through the status messages on a timer. This is stateless, works on any host, and the budgets are short.
   - *Alternative*: job endpoints (`POST` → 202 + job ID, `GET /api/jobs/{id}` with the current stage) for real progress. This needs a shared job store (Redis) once there's more than one worker.
2. **Payments.**
   - *Recommended*: build the `fake` provider now with Stripe behind the same interface (PaymentIntent created after mesh validation, plus webhook).
   - Does SN-SF's humanitarian context need non-card options, or free orders sponsored by an NGO?
3. **Engraving location.** 20 characters at a legible ≥ 2.5 mm cap height needs ~40–45 mm of flat surface. A typical tenon/end piece is only ~10–15 mm.
   - *Recommended*: also generate temples (Q4) and engrave on the inner face of the right temple.
   - *Otherwise*: cap the length at what fits on the tenon (~8 chars).
4. **Temples (arms).** The spec only mentions the front, bridge and tenons, yet the product ships glasses.
   - *Recommended*: generate the front plus two temples as separate bodies laid flat in the same STL, with a print-in-place or pin hinge, and a temple length parameter (default 140 mm, range 120–155).
   - This also has to fit the printer bed.
5. **Accounts.**
   - *Recommended*: email + password with bearer JWT.
   - *Alternative*: passwordless magic link, which needs working email from day one.
6. **Spec errors to fix in REQUIREMENTS.md** (frontend, but they affect the parameters the backend receives):
   - FR-FACE-04's bridge formula "PD minus both lens A values" gives a negative number (63 − 52 − 52). The correct formula is **DBL = PD − (A_L + A_R)/2**, assuming the optical centres are at the box centres. For prescription lenses, optical-centre decentration is ignored; this is acceptable for v1 but should be documented.
   - The frontend pages (`Rectify`, `Segment`, `FrameDesign`, `Export`, …) don't match the REQUIREMENTS page map, even though CLAUDE.md says they do.
