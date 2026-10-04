"""Small in-memory sliding-window rate limiter for anonymous compute routes (per process)."""

import threading
import time
from collections import defaultdict, deque

from fastapi import Request

from optiframe.errors import AppError


class RateLimiter:
    def __init__(self, per_minute: int):
        self.per_minute = per_minute
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def check(self, key: str) -> None:
        if self.per_minute <= 0:
            return
        now = time.monotonic()
        with self._lock:
            q = self._hits[key]
            while q and now - q[0] > 60:
                q.popleft()
            if len(q) >= self.per_minute:
                raise AppError("RATE_LIMITED")
            q.append(now)
            if len(self._hits) > 10_000:  # bound memory under many distinct clients
                for k in [k for k, v in self._hits.items() if not v or now - v[-1] > 60]:
                    del self._hits[k]


def rate_limited(request: Request) -> None:
    client = request.client.host if request.client else "unknown"
    request.app.state.rate_limiter.check(client)
