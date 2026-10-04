FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
COPY --from=ghcr.io/astral-sh/uv:0.12 /uv /usr/local/bin/uv
# onnxruntime needs libgomp at runtime (opencv-headless needs no GUI libs)
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY pyproject.toml uv.lock README.md ./
RUN uv sync --frozen --no-dev --no-install-project
COPY src ./src
RUN uv sync --frozen --no-dev && uv run --no-sync optiframe-fetch-model

ENV OPTIFRAME_ENV=prod OPTIFRAME_STORAGE_DIR=/data/storage OPTIFRAME_DATABASE_URL=sqlite:////data/optiframe.db
VOLUME /data
EXPOSE 8000
# FORWARDED_ALLOW_IPS lets uvicorn trust the platform proxy's X-Forwarded-For (needed for per-IP rate limits)
CMD ["sh", "-c", "uv run --no-sync uvicorn --factory optiframe.main:create_app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips=${FORWARDED_ALLOW_IPS:-*}"]
