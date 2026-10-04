# OptiFrame backend

FastAPI service that measures recycled eyeglass lenses from phone photos, generates a print-ready parametric frame STL,
and takes print orders. The API contract is defined in [`../CLAUDE.md`](../CLAUDE.md) (§ Backend API spec), and the
implementation design is in [`PLAN.md`](PLAN.md). Interactive docs are served at `/api/docs`.

## Quick start

```bash
uv sync                          # Python 3.12 + dependencies
uv run optiframe-fetch-model     # downloads the segmentation model (48 MB, sha256-verified)
uv run optiframe                 # http://localhost:8000/api/docs (auto-reload in dev, binds 127.0.0.1)
uv run pytest                    # ~75 tests, ~1 min
uv run ruff check src tests
```

Configuration is read from environment variables prefixed `OPTIFRAME_` (or a `.env` file); see
[`.env.example`](.env.example). With `OPTIFRAME_ENV=prod`, the server refuses to start unless a real secret key is set.

## Connecting the frontend

The frontend calls the relative path `/api` (`frontend/src/api/client.ts`).

- **Dev**: run `uv run optiframe` here and `bun dev` in `frontend/`. Vite proxies `/api` → `http://127.0.0.1:8000`; override with `API_PROXY_TARGET` in `frontend/.env.local`. The call is same-origin, so no CORS setup is needed, and an HTTPS dev page works too: a direct call to an `http://` backend would be blocked as mixed content.
- **Prod**: either rewrite `/api/*` to the backend on the frontend host (keeps it same-origin), or build the frontend with `VITE_API_BASE_URL=https://<backend-host>/api` and add the frontend origin to `OPTIFRAME_CORS_ORIGINS`.
- `OPTIFRAME_HOST` / `OPTIFRAME_PORT` control the bind address. Set `OPTIFRAME_HOST=0.0.0.0` only to expose the API to other devices; the Dockerfile does this itself.

## Production notes

- **Persistent storage**: `OPTIFRAME_STORAGE_DIR` holds order STLs and the default SQLite DB. Mount a persistent
  volume (the Dockerfile uses `/data`), or point `OPTIFRAME_DATABASE_URL` at Postgres (`postgresql+psycopg://…`,
  which also needs `uv add psycopg[binary]`). Platform disks that are wiped on deploy (e.g. Render's free tier)
  will lose orders.
- **Single process**: the rate limiter and generation cache live in memory, so they are per process. Run one worker
  per container and scale with containers. CPU-heavy work is capped by `OPTIFRAME_MAX_CONCURRENT_JOBS`.
- **Payments**: only the fake provider exists so far (every token succeeds except `tok_fail`). Plug in a real
  provider via the `PaymentProvider` protocol in `orders/adapters.py`.
- **Email**: `OPTIFRAME_MAILER=console` logs emails. Use `smtp` and set the SMTP variables to send them.
- **Sponsored orders**: set `OPTIFRAME_SPONSORSHIP_ENABLED=true`, then create codes with
  `POST /api/admin/sponsor-codes` (header `X-Admin-Key`).

## Privacy

No route accepts face images, face landmarks or try-on snapshots. Lens photos are processed in memory and never
stored or logged. Only order data (email, shipping address, frame design, STL) is persisted.

## Third-party models, fonts and data (NFR-10)

| Asset | Source | License | Notes |
|---|---|---|---|
| EfficientSAM-Ti ONNX (`image_segmentation_efficientsam_ti_2025april.onnx`) | [OpenCV Model Zoo](https://huggingface.co/opencv/image_segmentation_efficientsam) / [EfficientSAM](https://github.com/yformer/EfficientSAM) (Xiong et al., CVPR 2024) | Apache-2.0 | Pre-trained on ImageNet-1K (SAMI) and fine-tuned on Meta's SA-1B, where faces and licence plates are blurred. No OptiFrame user data is used for training. |
| Atkinson Hyperlegible Bold | Braille Institute of America, via [Google Fonts](https://github.com/google/fonts/tree/main/ofl/atkinsonhyperlegible) | SIL OFL 1.1 (`src/optiframe/assets/fonts/OFL.txt`) | Engraving font |

All Python dependencies are open source (see `uv.lock`). Nothing paid sits in the measurement or STL pipeline.

## Accuracy

`tests/synth.py` renders synthetic photos with exact ground truth: textured table, credit card with clutter or an
ArUco marker, and a transparent lens with a bevel ring, refraction and a specular highlight, photographed through a
pinhole camera with up to 25° tilt, blur, noise and JPEG compression. The suite requires |ΔA|, |ΔB| < 0.5 mm, and
measurements currently land within about 0.45 mm.

Synthetic lenses are easier than real ones. Before relying on the ±0.5 mm claim, validate against real lenses
measured with calipers. If segmentation struggles on real transparent lenses, fine-tune the model; it sits behind
`measurement/segment.py`.
