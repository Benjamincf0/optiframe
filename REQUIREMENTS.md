# OptiFrame — Software Requirements Specification

## 1. Overview

**Product:** OptiFrame — Mobile-first SaaS web app. The user photographs two recycled eyeglass lenses and their own face. The backend measures the lenses precisely, the face scan sets the bridge width from their pupillary distance, the user customizes the frame design, and the backend generates a print-ready STL. The user previews the glasses on their live face via MediaPipe + three.js AR, then orders. The frame is 3D-printed and shipped.

**Core user flow:**
```
Capture lenses → Backend processes → Review measurements
→ Face scan (PD) → Customize frame → Backend generates STL
→ AR try-on → Checkout → Print & ship
```

---

## 2. Architecture

### Frontend
- React + TypeScript, mobile-first (430 px max-width)
- Served over HTTPS (required for camera access)
- MediaPipe Face Mesh runs entirely client-side — face frames are never transmitted to the server
- three.js renders the returned STL over the live face feed for AR try-on

### Backend
- Python server (FastAPI or equivalent)
- Receives: lens images + reference object type/dimensions
- Pipeline: detect reference object → compute homography → rectify image → run segmentation model → extract and smooth contour polygon → compute A, B, perimeter (ISO 8624 boxing) → return JSON
- Second endpoint: receives both contour polygons + all frame parameters + customization spec → generates parametric STL → returns binary file
- Face images are NEVER sent to the backend

### Data flow
```
[Phone camera]
     │
     ▼
[Frontend: capture + reference object selection]
     │  POST images + reference spec
     ▼
[Backend: rectify → segment → measure]
     │  Return: contour polygons, A, B, perimeter, scale, confidence
     ▼
[Frontend: review measurements]
     │
     ▼
[Frontend: MediaPipe face scan → compute PD client-side]
     │
     ▼
[Frontend: customization UI → user picks pattern + engraving]
     │  POST: contours + frame params + customization spec
     ▼
[Backend: generate parametric STL with engraving geometry]
     │  Return: binary STL
     ▼
[Frontend: three.js loads STL, overlays on MediaPipe face feed]
     │
     ▼
[Checkout → order placed → print → ship]
```

---

## 3. Global Non-Functional Requirements

| ID | Requirement |
|----|-------------|
| NFR-01 | The app MUST be served over HTTPS. Browsers block camera access on HTTP. |
| NFR-02 | No installation, no API key required for the measurement and try-on flow. Account required only at checkout. |
| NFR-03 | Operable one-handed on a ~6-inch screen. Chrome Android + Safari iOS, latest two major versions. |
| NFR-04 | Backend lens processing MUST complete in under 15 seconds. STL generation MUST complete in under 20 seconds. Total lens-to-try-on under 45 seconds. |
| NFR-05 | Face data MUST NOT leave the device. MediaPipe runs in-browser. No face images or landmarks are transmitted to any server. |
| NFR-06 | No paid third-party APIs in the critical path (measurement, STL generation, try-on). |
| NFR-07 | Human-readable error messages for: missing reference object, blurry photo, lens not detected, face not detected, STL generation failure. No raw stack traces shown to users. |
| NFR-08 | Touch targets minimum 44×44 px. |
| NFR-09 | The backend segmentation model MUST handle transparent lenses, specular reflections, and low-contrast edges. Classical thresholding alone is not acceptable. |
| NFR-10 | All third-party models and datasets cited with license in README. No personal data (faces, names, prescriptions) in training sets. |

---

## 4. Pages & Functional Requirements

### Page 1 — Home

**Purpose:** Entry point and orientation.

| ID | Requirement |
|----|-------------|
| FR-HOME-01 | Display app name, one-sentence value proposition, and "Get started" CTA. |
| FR-HOME-02 | Display a scannable QR code pointing to the app's HTTPS URL. |
| FR-HOME-03 | Display the complete step flow visually so users understand the full process before starting. |
| FR-HOME-04 | "How to capture" guide: show what a correct photo looks like (lens + reference object, flat surface, good lighting). |

---

### Page 2 — Capture

**Purpose:** Acquire photos of the left and right lens, each alongside a known-size reference object.

| ID | Requirement |
|----|-------------|
| FR-CAP-01 | User selects which eye first: Left or Right. Nasal side of each lens MUST face toward center. |
| FR-CAP-02 | Live camera viewfinder via `getUserMedia`, filling the screen vertically. File upload fallback if camera is denied. |
| FR-CAP-03 | Before capturing, user selects the reference object type: ArUco marker (user-specified dictionary + size), credit card (85.60 × 53.98 mm), A4 sheet (297 × 210 mm), or custom (user enters width × height in mm). |
| FR-CAP-04 | Viewfinder overlay shows two placement zones: one for the lens, one for the reference object. Both must be in frame. |
| FR-CAP-05 | After each capture, show a still preview with Confirm / Retake. Only confirmed images are submitted. |
| FR-CAP-06 | Both lenses must be captured before submission. Progress shows which are done. |
| FR-CAP-07 | If image resolution is below 1 MP, warn the user. WhatsApp-compressed images MUST trigger a warning. |
| FR-CAP-08 | On confirmation of both lenses, images are uploaded to the backend. A processing screen is shown immediately. |

---

### Page 3 — Processing

**Purpose:** Loading state while the backend measures the lenses. Not skippable.

| ID | Requirement |
|----|-------------|
| FR-PROC-01 | Display an animated progress indicator with a plain-language status: "Detecting reference object…", "Correcting perspective…", "Tracing lens contour…", "Computing measurements…". |
| FR-PROC-02 | If processing fails, display a specific error with a "Retake photos" action — never a raw error. |
| FR-PROC-03 | On success, automatically navigate to the Measurements review page. |

---

### Page 4 — Measurements

**Purpose:** Show the user what the backend computed. Let them verify or retake.

| ID | Requirement |
|----|-------------|
| FR-MEAS-01 | Display for each lens: width A, height B, perimeter — all in mm to one decimal, per ISO 8624 boxing. |
| FR-MEAS-02 | Show the contour polygon drawn over the rectified lens image for each eye. |
| FR-MEAS-03 | Show the bounding rectangle over the contour with dimension arrows labeled A and B. |
| FR-MEAS-04 | If A or B differ by more than 5 mm between left and right, display an asymmetric pair notice. The frame will handle this — it's not an error. |
| FR-MEAS-05 | Display estimated accuracy (e.g., ±0.5 mm) based on reference object detection quality returned by backend. |
| FR-MEAS-06 | Provide "Export SVG (1:1)" button: downloads a scale-accurate SVG of the contour so the user can print and physically verify by placing the lens on it. |
| FR-MEAS-07 | "Retake photos" action returns to Capture and clears current results. |
| FR-MEAS-08 | "Looks good" proceeds to Face Scan. |

---

### Page 5 — Face Scan

**Purpose:** Use MediaPipe Face Mesh client-side to measure pupillary distance (PD) and auto-set the bridge width. No face data leaves the device.

| ID | Requirement |
|----|-------------|
| FR-FACE-01 | Activate the front-facing camera and run MediaPipe Face Mesh in-browser. |
| FR-FACE-02 | Display a live face feed with a landmark overlay showing both pupils and the detected nose bridge. |
| FR-FACE-03 | Require a reference scale (same credit card / ArUco held up to face, or known inter-pupillary landmark) to compute PD in mm, not just pixels. |
| FR-FACE-04 | Once PD is locked, compute and display: pupillary distance (mm), recommended bridge width (PD minus both lens A values, divided appropriately), and suggested frame total width. |
| FR-FACE-05 | User can accept the computed bridge width or override it manually (range 12–30 mm, step 0.5 mm). |
| FR-FACE-06 | Face feed and all landmarks are processed in-browser only. No image data is uploaded. |
| FR-FACE-07 | Provide a "Skip / Enter manually" option for users who decline camera access for the face scan. Bridge width defaults to 18 mm and is editable. |
| FR-FACE-08 | Show a clear privacy notice: "Your face is never uploaded. All processing happens on your device." |

---

### Page 6 — Customize

**Purpose:** Let the user personalize the frame's appearance before STL generation.

| ID | Requirement |
|----|-------------|
| FR-CUST-01 | **Frame geometry parameters:** expose bridge width (carried from Face Scan, editable), frame depth (3–8 mm), rim offset (0.5–3 mm), clip clearance (0.1–0.3 mm). |
| FR-CUST-02 | **Color / filament:** user picks a filament color from a palette of swatches (minimum 6: matte black, tortoiseshell, crystal, navy, bone, olive). This drives the print material selection at checkout. |
| FR-CUST-03 | **Surface pattern:** user picks from a set of preset surface texture/emboss patterns applied to the outer face of the frame. Minimum presets: None, Woven, Honeycomb, Brushed, Dots. The pattern is applied as a surface emboss in the STL geometry — not a painted texture. |
| FR-CUST-04 | **Name engraving:** optional text field (max 20 characters). The text is debossed into the inner surface of the right temple tenon. Font is fixed (a clean sans-serif). Preview shows the engraving placement. |
| FR-CUST-05 | All customization options are reflected in a live 2D schematic preview on this page. Full 3D preview is on the Try-on page after STL generation. |
| FR-CUST-06 | "Generate frame" CTA submits both lens contours + all frame parameters + surface pattern spec + engraving text to the backend STL generation endpoint. Navigates to a generation loading screen. |

---

### Page 7 — Generating

**Purpose:** Loading state during STL generation. Not skippable.

| ID | Requirement |
|----|-------------|
| FR-GEN-01 | Display progress status: "Building rim profiles…", "Adding bridge…", "Applying surface pattern…", "Engraving text…", "Finalizing mesh…". |
| FR-GEN-02 | On success, STL binary is received and stored in browser memory. Navigate automatically to Try-on. |
| FR-GEN-03 | On failure, display a specific error and a "Try again" action that returns to Customize with all settings preserved. |

---

### Page 8 — AR Try-on

**Purpose:** Show the user how the glasses will look on their face using the real STL and their live camera feed.

| ID | Requirement |
|----|-------------|
| FR-AR-01 | Activate front-facing camera. Run MediaPipe Face Mesh in-browser to track face landmarks in real time. |
| FR-AR-02 | Load the received STL into three.js. Scale and position the frame mesh to align with the detected eye positions and nose bridge landmark. |
| FR-AR-03 | The three.js frame mesh MUST be updated every frame to follow face movement (tracking). |
| FR-AR-04 | Display frame in the user's chosen filament color as a solid material in three.js. |
| FR-AR-05 | Allow the user to fine-tune fit from this screen: bridge width ± adjustment (shifts rims apart/together), vertical position adjustment (moves frame up/down on face). Changes re-trigger STL generation if they exceed 1 mm delta. |
| FR-AR-06 | Provide a "Take snapshot" button to capture a still of the try-on for the user's reference. Snapshot is saved locally only. |
| FR-AR-07 | "Download STL" button available at all times on this page. |
| FR-AR-08 | "Proceed to checkout" CTA is the primary action. |
| FR-AR-09 | Face feed is never uploaded. All landmark computation is client-side. |

---

### Page 9 — Checkout

**Purpose:** Collect material selection, shipping info, and payment to place the print order.

| ID | Requirement |
|----|-------------|
| FR-CHK-01 | Display order summary: left lens (A × B mm), right lens (A × B mm), bridge width, surface pattern, engraving text (if any), filament color. |
| FR-CHK-02 | Display frame try-on snapshot (if taken) or the 3D wireframe thumbnail. |
| FR-CHK-03 | Material selection: PETG (recommended — flexible, UV resistant), PLA (rigid, best detail), ASA (outdoor, UV stable). Price per gram shown for each. |
| FR-CHK-04 | Price breakdown displayed before any account step: print weight × price/g + flat shipping. |
| FR-CHK-05 | Guest checkout: email + shipping address only. Account checkout for returning users. |
| FR-CHK-06 | On submit: STL binary + order parameters POSTed to backend. Backend validates mesh (closed, manifold) before accepting payment. If invalid: "Frame mesh is invalid — please regenerate." |
| FR-CHK-07 | Confirmation: order ID + estimated delivery shown on screen and emailed. |
| FR-CHK-08 | "Download STL" available on confirmation page. |

---

### Page 10 — Order Status

**Purpose:** Let the user track their order.

| ID | Requirement |
|----|-------------|
| FR-ORD-01 | Accessible from confirmation email link and from any account. |
| FR-ORD-02 | Show status tracker: Received → Printing → Shipped → Delivered. |
| FR-ORD-03 | Show order details: frame specs, material, color, engraving. |
| FR-ORD-04 | Cancel order available while status is Received. |
| FR-ORD-05 | Re-download STL available at any status. |

---

## 5. Backend API Requirements

### POST /api/measure
- Input: `left_image` (multipart), `right_image` (multipart), `reference_type` (string), `reference_dims_mm` (object)
- Process: detect reference object → homography → rectify → segment → smooth contour → compute A, B, perimeter
- Output JSON: `{ left: { contour_mm: [[x,y],...], A, B, perimeter, confidence }, right: { ... }, scale_px_per_mm }`
- Error codes: `REF_NOT_FOUND`, `LENS_NOT_FOUND`, `IMAGE_TOO_BLURRY`, `ANGLE_TOO_STEEP`

### POST /api/generate
- Input JSON: `{ left_contour_mm, right_contour_mm, bridge_mm, depth_mm, rim_offset_mm, clip_clearance_mm, pattern: string, engraving_text: string }`
- Process: offset contours (Clipper) → extrude rims → add bridge + tenons → apply surface emboss pattern geometry → deboss engraving text → validate mesh → export binary STL
- Output: `application/octet-stream` binary STL
- The generated STL MUST be a closed, manifold mesh printable flat on FDM without excessive supports
- Engraving: text debossed 0.4 mm into the inner right tenon surface, using a fixed sans-serif font

### POST /api/orders
- Input: STL binary + order params + payment token
- Validates mesh before charging
- Returns: order ID, estimated delivery window

---

## 6. Validation & Bonus Features

| ID | Requirement |
|----|-------------|
| FR-VAL-01 | On the Measurements page, user can submit a second photo of the same lens and see the delta in A and B between the two captures. If delta < 0.5 mm, show "High confidence" badge. |
| FR-VAL-02 | On AR Try-on, overlay the contour polygon (from measurement) on the rendered frame rim and show the max deviation in mm to verify the STL matches the lens. |
| FR-VAL-03 | SVG export at 1:1 scale for physical lens-on-paper verification. |

---

## 7. Page Map

```
/                   Home
/capture            Capture (left + right lenses, reference object)
/processing         Backend measurement loading state
/measurements       Review A, B, perimeter, contour overlays
/face-scan          MediaPipe PD measurement → bridge width
/customize          Frame geometry + surface pattern + engraving
/generating         Backend STL generation loading state
/try-on             AR preview (MediaPipe face + three.js STL)
/checkout           Material, address, payment
/order/:id          Order status tracker
```

---

## 8. Technical Stack

| Layer | Technology |
|-------|------------|
| Frontend framework | React + TypeScript |
| Routing | React Router v6 |
| Styling | Tailwind CSS |
| Camera / face mesh | MediaPipe Face Mesh (WASM, in-browser) |
| 3D rendering + AR | three.js |
| Reference object detection | OpenCV.js or js-aruco2 (client-side, pre-upload validation only) |
| Backend language | Python (FastAPI) |
| Segmentation model | SAM or fine-tuned equivalent, PyTorch, exported to ONNX for server inference |
| Contour offsetting | Clipper (Python, server-side) |
| STL geometry | manifold or trimesh + shapely (server-side) |
| Hosting (frontend) | Vercel / Netlify / GitHub Pages |
| Hosting (backend) | Render / Fly.io / Railway |
