# OptiFrame — Software Requirements Specification

## 1. Overview

**Product:** OptiFrame — Mobile-first SaaS web app that turns a photo of a recycled eyeglass lens into a custom 3D-printable frame (STL), with an integrated order workflow.

**Core user flow:** Capture lens photo → Rectify perspective → Segment lens → Measure contour → Generate frame → Preview 3D model → Download STL or place order.

---

## 2. Global Non-Functional Requirements

| ID | Requirement |
|----|-------------|
| NFR-01 | The app MUST be served over HTTPS. Camera access is blocked by browsers without it. |
| NFR-02 | The app MUST be usable with no installation, no account, and no API key for the lens-to-STL flow. |
| NFR-03 | The app MUST be operable one-handed on a ~6-inch screen (Chrome Android, Safari iOS — latest two major versions). |
| NFR-04 | The full lens-to-STL pipeline MUST complete in under 30 seconds on a mid-range smartphone. |
| NFR-05 | All image processing MUST run client-side (JS/WebAssembly) by default. A server-side Python fallback is permitted only if its URL remains live. |
| NFR-06 | No paid third-party service or closed API may appear in the critical path. |
| NFR-07 | The app MUST display a human-readable error message (not a stack trace) for: missing reference object, blurry photo, lens not detected. |
| NFR-08 | The app MUST be responsive and touch-friendly. Minimum tap target size: 44×44 px. |
| NFR-09 | No personal data (faces, names, prescriptions) may be transmitted or stored on any server without explicit user consent. |
| NFR-10 | A QR code linking to the app URL MUST be displayed on the landing page and be printable. |

---

## 3. Pages & Functional Requirements

### Page 1 — Home

**Purpose:** Entry point and orientation.

| ID | Requirement |
|----|-------------|
| FR-HOME-01 | Display the app name, a one-sentence description, and a "Start" CTA button. |
| FR-HOME-02 | Display a scannable QR code pointing to the app's own HTTPS URL. |
| FR-HOME-03 | Display step indicators (Capture → Rectify → Segment → Measure → Frame → Order) so users understand the full flow before starting. |
| FR-HOME-04 | Provide a "How it works" toggle that shows a visual summary of the capture setup (lens on plain background next to a reference object). |

---

### Page 2 — Capture

**Purpose:** Acquire photos of the left lens and right lens.

| ID | Requirement |
|----|-------------|
| FR-CAP-01 | The user MUST be able to select which eye the current lens belongs to: Left or Right. The nasal side MUST face the center of the eventual frame. |
| FR-CAP-02 | Provide a live camera viewfinder using `getUserMedia`. The viewfinder MUST fill the screen vertically on mobile. |
| FR-CAP-03 | Provide a file-upload fallback (accepts JPEG/PNG/WEBP) if camera permission is denied. |
| FR-CAP-04 | Display an in-viewfinder overlay guide showing: placement zone for the lens, placement zone for the reference object, and a reminder that both must be visible. |
| FR-CAP-05 | Support the following reference objects (user selects one before capturing): ArUco marker (configurable dictionary), standard credit card (85.60 × 53.98 mm), A4 sheet (297 × 210 mm), custom object with user-entered dimensions (width × height in mm). |
| FR-CAP-06 | After capture, display a still preview. The user MUST confirm or retake before proceeding. |
| FR-CAP-07 | Both Left and Right lens photos MUST be captured before the user can proceed to Rectification. A progress indicator shows which lenses have been captured. |
| FR-CAP-08 | Captured images MUST use the camera's full native resolution. WhatsApp-style recompressed images MUST NOT be accepted silently — if EXIF data indicates resolution below 1 MP, display a warning. |

---

### Page 3 — Rectification

**Purpose:** Detect the reference object, correct perspective, and establish the pixel-per-mm scale.

| ID | Requirement |
|----|-------------|
| FR-RECT-01 | Automatically detect the reference object in the captured image. If detection fails, display a specific error message (e.g., "Reference object not found — ensure it is fully visible and unobstructed"). |
| FR-RECT-02 | Compute a homography transform that maps the image to a top-down (orthographic) view. Apply it to produce a rectified image. |
| FR-RECT-03 | Calculate and store the scale factor in pixels per mm, derived from the detected reference object's known real-world dimensions. |
| FR-RECT-04 | Display a control image showing: the original photo with the detected reference object highlighted (bounding polygon), and the rectified result side-by-side. |
| FR-RECT-05 | Display the computed scale (px/mm) numerically so it can be sanity-checked. |
| FR-RECT-06 | If the reference object appears at an angle exceeding 45° from horizontal, warn the user that measurement accuracy may be reduced. |
| FR-RECT-07 | The user MUST be able to return to Capture from this page and retake the photo. |
| FR-RECT-08 | Both lenses must be rectified independently before proceeding. |

---

### Page 4 — Segmentation

**Purpose:** Isolate the lens contour from the rectified image.

| ID | Requirement |
|----|-------------|
| FR-SEG-01 | Run segmentation automatically on the rectified image upon page load. Display a loading indicator during processing. |
| FR-SEG-02 | The segmentation pipeline MUST handle transparent lenses, specular reflections, and low-contrast edges. A trained or fine-tuned segmentation model (e.g., SAM, ONNX-exported) MUST be used to handle difficult cases; classical thresholding alone is insufficient. |
| FR-SEG-03 | The model MUST run in-browser (ONNX Runtime Web or TensorFlow.js). Server-side inference is permitted as a fallback. |
| FR-SEG-04 | Output the lens contour as a smoothed polygon — a list of (x, y) points in pixel coordinates. |
| FR-SEG-05 | Display a control overlay showing the contour drawn on top of the rectified image. The overlay color MUST be clearly visible (e.g., bright green) on both light and dark backgrounds. |
| FR-SEG-06 | If no lens is detected, display: "Lens not found — ensure the lens is on a plain background with no objects overlapping it." |
| FR-SEG-07 | Allow the user to manually adjust the contour by dragging control points, as an override for difficult cases. |
| FR-SEG-08 | Run segmentation independently for Left and Right lens images. Both results are shown on this page with a tab or carousel to switch between them. |
| FR-SEG-09 | Provide a "Re-run segmentation" button if the user is unsatisfied with the automatic result. |

---

### Page 5 — Measurement

**Purpose:** Convert the pixel contour to real-world millimeter dimensions and display results.

| ID | Requirement |
|----|-------------|
| FR-MEAS-01 | Convert the smoothed pixel contour to mm using the scale factor computed in FR-RECT-03. |
| FR-MEAS-02 | Apply the ISO 8624 boxing system: compute and display width A (horizontal span of the bounding box), height B (vertical span of the bounding box), and perimeter of the contour, all in mm with one decimal precision. |
| FR-MEAS-03 | Display results for Left and Right lens side-by-side. Visually flag if A or B differ by more than 5 mm between the two lenses (asymmetric pair). |
| FR-MEAS-04 | Display the bounding rectangle overlaid on the lens contour image, with labeled dimension arrows for A and B. |
| FR-MEAS-05 | Provide a "Export contour as SVG" button that downloads a 1:1 scale SVG of the lens contour (1 px = 1 mm, so a 40 mm lens produces a 40 px-wide path in a 40×40 mm SVG). |
| FR-MEAS-06 | Store the contour polygon (as a list of mm-coordinate points) in app state for use in frame generation. |
| FR-MEAS-07 | Display measurement confidence or estimated accuracy (e.g., "±0.5 mm based on reference object detection quality"). |

---

### Page 6 — Frame Design

**Purpose:** Generate a parametric 3D glasses frame from the two lens contours.

| ID | Requirement |
|----|-------------|
| FR-FRAME-01 | Display a configuration panel with the following inputs: Bridge width (default: 18 mm, range: 12–30 mm, step: 0.5 mm), Frame depth / thickness (default: 5 mm, range: 3–8 mm), Rim offset — outward expansion from lens contour (default: 1.5 mm, range: 0.5–3 mm), Clip clearance — gap between lens and rim inner edge (default: 0.2 mm, range: 0.1–0.3 mm). |
| FR-FRAME-02 | Generate a parametric frame face from: left contour offset outward by rim offset, right contour offset outward by rim offset, a bridge connecting the two rims at the configured width, temple peg attachment points (tenons) on the outer edges of each rim. |
| FR-FRAME-03 | The rim inner profile MUST include a clip groove or slight undercut to allow lens clipping without adhesive. |
| FR-FRAME-04 | Render an interactive 3D preview of the generated frame using three.js. The preview MUST support pinch-to-zoom and drag-to-rotate. |
| FR-FRAME-05 | The 3D preview MUST show both rims in correct relative position, the bridge, and the temple tenons. |
| FR-FRAME-06 | Support asymmetric lens shapes — left and right contours may be entirely different shapes. |
| FR-FRAME-07 | Re-generate and re-render the 3D preview automatically when any configuration parameter changes (debounced at 500 ms). |
| FR-FRAME-08 | Display a warning if the generated frame is not printable without excessive supports (e.g., large overhanging surfaces without bridging). |
| FR-FRAME-09 | Display a validation overlay: the lens contour superimposed on the rim inner profile, with the gap in mm labeled. |

---

### Page 7 — Export

**Purpose:** Download the STL file and share results.

| ID | Requirement |
|----|-------------|
| FR-EXP-01 | Provide a "Download STL" button that exports the full frame (both rims, bridge, tenons) as a single valid binary STL file. |
| FR-EXP-02 | The exported STL MUST be a closed, manifold mesh (no holes, no non-manifold edges). |
| FR-EXP-03 | The STL MUST be printable without excessive supports on standard FDM printers (default orientation: frame lying flat). |
| FR-EXP-04 | Display the STL file size and estimated print weight at 1.24 g/cm³ (PETG density). |
| FR-EXP-05 | Provide a "Download left SVG contour" and "Download right SVG contour" button (1:1 scale, for physical verification). |
| FR-EXP-06 | Provide a "Share" button that generates a link or QR code for the current session state (lenses + frame parameters), if state is stored client-side. |
| FR-EXP-07 | Display a step-by-step recap panel: original photo thumbnail → rectified image → segmented contour → measurement table → frame preview. |
| FR-EXP-08 | Provide a "Proceed to Order" CTA button that passes the frame parameters and STL to the Order page. |

---

### Page 8 — Order

**Purpose:** Allow the user to order the 3D-printed frame through a fulfillment provider.

| ID | Requirement |
|----|-------------|
| FR-ORD-01 | Display an order summary: left lens dimensions (A × B mm), right lens dimensions (A × B mm), bridge width, rim offset, clip clearance, estimated print time and weight. |
| FR-ORD-02 | Display a thumbnail of the 3D frame preview. |
| FR-ORD-03 | Allow the user to select a print material from a predefined list (e.g., PETG — recommended, PLA, ASA) with a short description of each (flexibility, UV resistance, etc.). |
| FR-ORD-04 | Allow the user to select a frame color from a set of available filament colors, displayed as swatches. |
| FR-ORD-05 | Display pricing: per-gram cost × estimated weight + flat shipping fee. Pricing MUST be shown before account creation. |
| FR-ORD-06 | Require account creation or guest checkout before payment. Guest checkout MUST require only: email address and shipping address. |
| FR-ORD-07 | On checkout, the STL file and order parameters MUST be submitted to the backend. The user MUST receive a confirmation email with order ID and estimated delivery window. |
| FR-ORD-08 | The order confirmation page MUST display the order ID, the submitted STL parameters, and a link to re-download the STL. |
| FR-ORD-09 | An order status page MUST be accessible via the confirmation email link, showing: Received → Printing → Shipped → Delivered. |
| FR-ORD-10 | The STL file MUST be validated server-side (closed mesh check) before the order is accepted. If invalid, return a specific error: "Frame mesh is invalid — please regenerate the frame and try again." |
| FR-ORD-11 | Users MUST be able to cancel an order before it enters the Printing status. |

---

## 4. Validation & Bonus Features

| ID | Requirement |
|----|-------------|
| FR-VAL-01 | (Bonus) Display an overlay on the Frame Design page that superimposes the measured lens contour and the inner rim circle, and shows the maximum deviation in mm. |
| FR-VAL-02 | (Bonus) On the Measurement page, allow the user to capture a second photo of the same lens and display the difference in A and B between the two captures (repeatability check). |
| FR-VAL-03 | (Bonus) If both captures agree within 0.5 mm on A and B, display a "High confidence" badge on the measurement. |

---

## 5. Technical Stack Requirements

| Concern | Requirement |
|---------|-------------|
| Image processing | OpenCV.js or equivalent, running in-browser |
| ArUco detection | js-aruco2 or OpenCV.js ArUco module |
| Polygon offsetting | Clipper.js (for rim outward expansion) |
| 3D preview | three.js |
| 3D geometry / STL export | manifold-3d or JSCAD |
| AI segmentation (client) | ONNX Runtime Web or TensorFlow.js with exported model weights |
| AI training (offline) | PyTorch or TensorFlow on Colab/Kaggle, exported to ONNX or TFLite |
| Hosting | HTTPS-capable static host (Vercel, Netlify, GitHub Pages, etc.) |
| No locked-in paid APIs in the lens-to-STL path | All AI models and libraries MUST have cited open-source licenses |

---

## 6. Page Map

```
/               Home (QR code, start)
/capture        Capture (left + right lens photos)
/rectify        Rectification (perspective correction, scale)
/segment        Segmentation (AI contour extraction)
/measure        Measurement (A, B, perimeter in mm, SVG export)
/frame          Frame Design (parametric 3D frame config + preview)
/export         Export (STL download, SVG download, share)
/order          Order (material, color, pricing, checkout)
/order/:id      Order Status (tracking)
```
