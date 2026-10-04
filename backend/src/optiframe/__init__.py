"""OptiFrame backend."""

import hashlib
import sys
import urllib.request

MODEL_URL = ("https://huggingface.co/opencv/image_segmentation_efficientsam/resolve/main/"
             "image_segmentation_efficientsam_ti_2025april.onnx")
MODEL_SHA256 = "4eb496e0a7259d435b49b66faf1754aa45a5c382a34558ddda9a8c6fe5915d77"


def main() -> None:
    """Run the API server (`uv run optiframe`)."""
    import uvicorn

    from optiframe.config import get_settings

    s = get_settings()
    shown = "localhost" if s.host in ("127.0.0.1", "0.0.0.0", "::") else s.host
    print(f"OptiFrame API → http://{shown}:{s.port}/api  (docs: http://{shown}:{s.port}/api/docs)", flush=True)
    if s.host in ("0.0.0.0", "::"):
        print("  bound to all interfaces (reachable from other devices on this network)", flush=True)
    uvicorn.run("optiframe.main:create_app", factory=True, host=s.host, port=s.port, reload=s.env == "dev",
                proxy_headers=True)


def fetch_model() -> None:
    """Download the segmentation model and verify its checksum (`uv run optiframe-fetch-model`)."""
    from optiframe.config import get_settings

    dest = get_settings().model_path
    if dest.exists() and hashlib.sha256(dest.read_bytes()).hexdigest() == MODEL_SHA256:
        print(f"Model already present at {dest}")
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(".part")
    print(f"Downloading {MODEL_URL}")
    urllib.request.urlretrieve(MODEL_URL, tmp)
    digest = hashlib.sha256(tmp.read_bytes()).hexdigest()
    if digest != MODEL_SHA256:
        tmp.unlink()
        sys.exit(f"Checksum mismatch: expected {MODEL_SHA256}, got {digest}")
    tmp.replace(dest)
    print(f"Saved model to {dest}")
