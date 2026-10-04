# OptiFrame Backend — Implementation Plan

The API contract (routes, payloads, error codes) is defined in `../CLAUDE.md` § "Backend API spec". This file covers **how** each part is built.

## Decisions (final)

| Topic | Decision |
|---|---|
| Progress screens | Synchronous requests; frontend animates status text on a timer |
| Temples | Out of scope; the STL is the frame front (rims + bridge + tenons with a hinge pin hole) |
| Payments | `FakePaymentProvider` only (`tok_fail` simulates a decline). Interface allows Stripe later |
| Sponsored orders | Optional (`OPTIFRAME_SPONSORSHIP_ENABLED`). Admin-issued codes with max uses and expiry; a valid code makes the total 0 and skips payment |
| Engraving | ≤ 8 chars, Atkinson Hyperlegible Bold, cap height ≥ 2.2 mm, 0.4 mm deboss on the back face of the right tenon |
| Accounts | Email + password (argon2), HS256 JWT bearer tokens |
| Guest-order linking | **Not** by email match. Without email verification, anyone could register a victim's email and read their address. Instead, `POST /api/me/orders/claim` with the order's access token |
| Order access token | `HMAC(secret, order_id)`, so nothing secret is stored and idempotent replays can return it |

## Packages

| Package | Used for |
|---|---|
| `fastapi`, `uvicorn[standard]`, `python-multipart` | HTTP, multipart uploads |
| `pydantic[email]`, `pydantic-settings` | Schemas and env-driven config (`OPTIFRAME_*`) |
| `numpy`, `scipy` | Array math, contour smoothing, profile sampling |
| `opencv-contrib-python-headless` | ArUco (`cv2.aruco`), quad detection, homography, warping, sub-pixel refinement |
| `pillow`, `pillow-heif` | Decoding JPEG/PNG/WebP/HEIC, EXIF orientation, JPEG quantization tables (compression heuristic) |
| `onnxruntime` | EfficientSAM-Ti inference (OpenCV Model Zoo export, Apache-2.0, 48 MB, ~0.6 s/run on Apple M-series CPU) |
| `shapely`, `pyclipper` | 2D polygons, validity checks, Clipper offsets (round joins) |
| `manifold3d` | Extrusion and booleans that produce manifold meshes by construction; slicing for deviation measurement |
| `trimesh` | Mesh validation (watertight, winding, volume, bodies) and binary STL I/O |
| `fonttools` | Glyph outlines for the engraving |
| `sqlalchemy` | ORM. SQLite by default, Postgres via `OPTIFRAME_DATABASE_URL` (`create_all` on startup) |
| `pwdlib[argon2]`, `pyjwt` | Password hashing, tokens |
| dev: `pytest`, `httpx`, `hypothesis`, `ruff` | Tests and lint |

Payment, storage and mail adapters use only the standard library (`smtplib`, filesystem). Nothing paid sits in the critical path (NFR-06).

## Layout

```
backend/
  pyproject.toml uv.lock README.md Dockerfile .env.example
  models/efficientsam_ti.onnx            fetched by `uv run optiframe-fetch-model` (sha256-checked)
  src/optiframe/
    main.py         create_app(): CORS, request-ID middleware, error handlers, lifespan (DB, model, font)
    config.py       Settings
    errors.py       AppError + error codes/messages + handlers
    ratelimit.py    in-memory per-IP sliding window for compute routes
    catalog.py      materials, colors, patterns, parameter ranges, reference presets
    schemas.py      pydantic models shared by the routes
    api/            health, options, measure, generate, quote, orders, auth, me, admin
    measurement/    imageio, reference, quality, rectify, locate, segment, refine, pipeline
    geometry/       frame (rims/bridge/tenons), patterns, engraving, validate, signing, cache, pipeline
    orders/         pricing, payments, mailer, storage, service
    db.py models.py security.py
    assets/fonts/   AtkinsonHyperlegible-Bold.ttf + OFL.txt
  tests/            synthetic scene renderer, measurement accuracy, geometry, API flows
```

## Measurement (`measurement/`)

1. **imageio**
   - Decode with Pillow and register the HEIF opener. Apply `ImageOps.exif_transpose`, convert to RGB, then to BGR uint8.
   - Reject files over 15 MB or 40 MP (`IMAGE_TOO_LARGE`) and anything that won't decode (`INVALID_IMAGE`).
   - Warnings:
     - `LOW_RESOLUTION` if the image is under 1 MP.
     - `LIKELY_COMPRESSED` if it's a JPEG with no EXIF and either a long edge of 1600/1280 px (WhatsApp) or an estimated JPEG quality under 70 (from the luminance quantization table).
2. **reference**
   - ArUco: `cv2.aruco.ArucoDetector` with the requested dictionary, sub-pixel corner refinement, largest marker wins.
   - Rectangles (card/A4/custom): several binarizations (Canny on gray, adaptive threshold, Otsu on saturation) → external contours → convex quads of plausible area.
   - Corner refinement fits a line to each of the 4 sides (dropping points near the corners), so the card's rounded corners don't bias the result. Corners are the line intersections.
   - Quads are scored on rectangularity, corner angles, area and **perspective-corrected aspect ratio** (recovered with the pinhole model, tolerance ±10 %). Comparing raw side ratios instead accepted the table edge as a card in a tilted photo.
   - Corners are ordered clockwise from the image so the homography never mirrors. The long side maps to the long dimension.
   - Fails with `REF_NOT_FOUND`.
3. **quality**
   - Tilt: decompose the homography with an assumed phone focal length (0.8 × long edge in px) to get the plane normal. Tilt over 40° → `ANGLE_TOO_STEEP`.
   - Sharpness: 10–90 % edge-rise width sampled across the reference sides. `IMAGE_TOO_BLURRY` only if it's over 0.8 mm **and** over 5 px. A sharp low-resolution photo has wide edges in mm but isn't blurry; it gets the `LOW_RESOLUTION` warning instead.
   - Both feed into `accuracy_mm`.
4. **rectify**
   - Metric homography to `s` px/mm, where `s` is the source resolution at the reference, clamped to 6–12.
   - Rotate so the **photo's** horizontal stays horizontal (the convention is "lens top toward photo top", not "aligned with the card").
   - Warp only the region of interest.
5. **locate**
   - With a hint: project the hint box into the metric plane.
   - Without one: build a 2 px/mm overview, mask out the reference (its interior for small references, plus 40 % of the marker size for ArUco quiet zones; only its border band for large ones like A4, since the lens may sit on the sheet), and pick a closed edge blob 25–90 mm in size.
   - The result is a tight box used as the SAM prompt. This classical step only *locates* the lens; segmentation is done by the model (NFR-09).
6. **segment**
   - Crop the rectified image to box + 8 mm. Run EfficientSAM with a box prompt (labels 2/3), plus a second run with a jittered box.
   - Choose among the 3 output masks: highest predicted IoU, filtered to a single blob of plausible size that doesn't touch the crop border.
   - Mask disagreement between runs → `seg_uncertainty_mm`.
   - Implausible mask → `LENS_NOT_FOUND`.
7. **refine**
   - Resample the mask contour to 720 points and compute normals.
   - Sample the gradient-magnitude profile ±1 mm along each normal and take the outermost strong peak with a parabolic sub-pixel fit.
   - Median-filter the shifts and clamp them. Weak gradients keep the SAM point.
   - Periodic Gaussian smoothing (σ ≈ 0.4 mm), then resample to 360 points.
8. **output**
   - Convert to mm with y up, centred on the box, CCW.
   - A, B and perimeter come from the boxing system (photo-horizontal).
   - `accuracy_mm` = √(scale² + blur² + tilt² + resolution² + seg² + 0.25²), rounded, minimum 0.3. Here tilt = 0.01 mm/°, resolution = 1 source px, and seg = disagreement between the two prompt runs. `confidence` = 1 / (1 + (acc/0.6)²).
   - The rectified crop is a base64 JPEG. Contour point (x, y) maps to pixel ((ox + x)·s, (oy − y)·s).

Both lenses run concurrently in the threadpool. The whole request runs under a semaphore and a 15 s timeout.

## Generation (`geometry/`)

Units are mm. z = 0 is the back face (print bed) and z = depth is the outer face. Front view: +x is the observer's right. The right lens sits at x = −(bridge/2 + A_R/2), the left at +(bridge/2 + A_L/2), and box centres at y = 0.

1. **Validate contours**
   - Shapely: valid, simple, 16–4000 points, A 20–80 mm, B 15–70 mm.
   - Re-centre on the box and orient CCW.
2. **Rim cross-section** (Clipper round-join offsets of each placed contour)
   - `seat` = contour + clearance
   - `front_open` = contour − 0.8 (front retaining lip)
   - `undercut_open` = contour − 0.3 (back snap lip, which makes the clip-in undercut)
   - `outer` = contour + clearance + 1.2 + rim_offset (rim_offset = extra rim width beyond the 1.2 mm structural wall)
3. **Bridge**
   - A 4 mm tall band at y = 0.3·min(B)/2.
   - It extends to where the horizontal line meets each lens's nasal edge, +1 mm, so it always joins both rims.
4. **Tenons**
   - A rounded block at each temporal side at the bridge height, 7 mm tall, protruding 10 mm. **Both** are lengthened (symmetrically) when the engraving needs room.
   - A Ø1.6 mm hinge-pin hole runs along y near the tip.
5. **Solid**
   - The frame outline is the union of the outers, bridge and tenons.
   - Layers:
     - [0, 0.6]: outline − undercut_open
     - [0.6, depth − 0.8]: outline − seat
     - [depth − 0.8, depth]: outline − front_open
   - The layers are extruded and unioned with manifold3d.
6. **Pattern**
   - Tiles are generated with shapely:
     - honeycomb: hex cells, 0.6 mm walls
     - dots: Ø1.0 on a 2.0 mm hex grid
     - brushed: 0.6 mm lines at 1.4 mm pitch
     - woven: alternating 2.4 × 0.7 dashes in a basket weave
   - Clip to the front face (outline − front_open, inset by 0.4 mm), drop slivers under 0.15 mm², then emboss 0.4 mm on top.
7. **Engraving**
   - fontTools glyph outlines are flattened. Rings are combined even-odd, so holes in letters like "o" and "e" come out right.
   - Text is laid out by advance width, scaled to fit the tenon (cap height ≥ 2.2 mm), and mirrored so it reads from behind.
   - It's subtracted 0.4 mm into z = 0 on the right tenon. If it won't fit → `ENGRAVING_INVALID`.
8. **Validate**
   - trimesh must report watertight, winding-consistent, volume > 0, a single body, and a fit within 200 × 200 mm.
   - Max deviation: slice the mesh at mid-seat height and compute the Hausdorff distance between each seat hole and its lens contour.
9. **Output**
   - Binary STL, plus headers for volume, deviation, frame width and lens centres.
   - `X-Design-Signature` = HMAC(secret, sha256(stl) ‖ canonical(design JSON)).
   - The result is cached in an LRU keyed by the canonical design.

## Orders (`orders/`, `models.py`)

- **Tables:**
  - `users`: email unique, lowercase; password hash; name; saved address
  - `orders`: public id `OF-XXXXXX`; email; address; design JSON; specs; material/colour; volume/grams; prices in integer **cents**; status; sponsor code; payment ref; STL key and sha256; delivery window; tracking; idempotency key and request hash
  - `order_events`: the status timeline
  - `sponsor_codes`
- **Pricing:** `Decimal`. grams = volume × density. material = grams × price/g, rounded half-up to cents, plus flat shipping.
- **`POST /orders` pipeline:**
  1. Parse and validate.
  2. Idempotency replay (same key with a different body → 409).
  3. Verify the signature.
  4. Load the STL and validate the mesh (`MESH_INVALID`).
  5. Recompute the price.
  6. Reserve the sponsor code (row update `uses < max_uses`).
  7. Charge (skipped when the total is 0).
  8. Store the STL.
  9. Commit.
  10. Send the email in a background task.
- **Cancel:** only while `received`. Refunds the charge, releases the sponsor use and logs an event.
- **Admin:** status moves forward only (`received → printing → shipped → delivered`). Each change emails the customer.
- **Storage:** local directory (`OPTIFRAME_STORAGE_DIR`). For hosts with ephemeral disks, mount a volume (e.g. Fly volume). An S3 adapter can sit behind the same interface later.
- **Mailer:** console (default) or SMTP via env.

## Cross-cutting

- Error envelope for `AppError`, validation errors, HTTP errors and unhandled exceptions. Traces only go to the logs.
- `X-Request-ID` on every response.
- CORS allow-list from env, with the custom headers exposed.
- Upload size caps are enforced while streaming.
- Per-IP rate limit on `/measure`, `/measure/lens`, `/generate`.
- In `prod`, startup refuses to run with the default secret key.
- Images and STL bytes are never logged.

## Status

Implemented and tested: 75 tests, ruff clean. Synthetic accuracy is within 0.45 mm. Measurement takes ~2 s per lens on Apple-silicon CPU; generation 0.2–0.6 s. The Dockerfile has **not** been built yet (no Docker daemon was available).

## Tests

- **Synthetic scene renderer:**
  - Textured table, a credit card with clutter or an ArUco marker, and a transparent lens with an edge ring, refraction shift and a specular highlight.
  - Random homography tilt, blur, noise and JPEG compression.
  - Ground-truth A and B are known.
  - Pass criterion: |ΔA|, |ΔB| < 0.5 mm.
- **Geometry:** several lens shapes (incl. an asymmetric pair) × every pattern × engraving on/off × range extremes. Each must be manifold, a single body, and finish in < 20 s.
- **API:**
  - options, measure, and the error envelope
  - generate, quote
  - guest/account/sponsored orders
  - access control, idempotency, cancel
  - admin transitions
  - tampered STL → rejected
