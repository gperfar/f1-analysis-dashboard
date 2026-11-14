"""Small client for the OpenF1 API (https://openf1.org).

Historical data (2023 onwards) is free and needs no account, but the API
allows only 30 requests per minute and answers a burst over that with a
60-second penalty. This client:

- caches every response on disk, so a finished session is downloaded once;
- spaces requests out so it never goes over the limit;
- retries after a 429 if one happens anyway (e.g. another process using
  the same IP).
"""

import hashlib
import json
import os
import threading
import time
from collections import deque
from typing import Any, Dict, List, Optional
from urllib.parse import quote

import requests

BASE_URL = "https://api.openf1.org/v1"
CACHE_DIR = os.environ.get("OPENF1_CACHE_DIR", "./openf1_cache")

# Stay a little under OpenF1's 30 requests/minute.
MAX_REQUESTS_PER_MINUTE = 28
MIN_SECONDS_BETWEEN_REQUESTS = 0.4
REQUEST_TIMEOUT = 60
MAX_ATTEMPTS = 4


class OpenF1Error(Exception):
    """OpenF1 couldn't be reached or returned an unexpected error."""


class OpenF1Client:
    def __init__(self, base_url: str = BASE_URL, cache_dir: str = CACHE_DIR):
        self.base_url = base_url
        self.cache_dir = cache_dir
        os.makedirs(cache_dir, exist_ok=True)
        self._http = requests.Session()
        self._http.headers["User-Agent"] = "f1-charts"
        self._rate_lock = threading.Lock()
        self._sent: deque = deque()  # timestamps of recent requests

    def get(
        self,
        endpoint: str,
        params: Optional[Dict[str, Any]] = None,
        filters: Optional[List[str]] = None,
        ttl: Optional[float] = None,
    ) -> List[Dict[str, Any]]:
        """GET /v1/{endpoint} and return the list of records.

        Args:
            params: equality filters, e.g. {"session_key": 9158}
            filters: comparison filters written as OpenF1 expects them,
                e.g. ["date>=2024-03-02T15:00:00", "date<2024-03-02T15:01:00"]
            ttl: seconds a cached response stays valid; None caches forever
                (right for sessions that have finished).
        """
        url = self._build_url(f"{self.base_url}/{endpoint}", params, filters)
        return self._cached(url, ttl, lambda: self._fetch(url))

    def get_url(self, url: str, ttl: Optional[float] = None) -> Any:
        """GET any JSON URL through the same cache (used for circuit info)."""
        return self._cached(url, ttl, lambda: self._fetch(url, openf1=False))

    # -- internals ---------------------------------------------------------

    @staticmethod
    def _build_url(base: str, params, filters) -> str:
        parts = [f"{k}={quote(str(v))}" for k, v in sorted((params or {}).items())]
        parts += list(filters or [])
        return f"{base}?{'&'.join(parts)}" if parts else base

    def _cached(self, url: str, ttl: Optional[float], fetch):
        path = os.path.join(self.cache_dir, hashlib.sha1(url.encode()).hexdigest() + ".json")
        if os.path.exists(path):
            age = time.time() - os.path.getmtime(path)
            if ttl is None or age < ttl:
                with open(path) as f:
                    return json.load(f)

        data = fetch()
        if not data:
            # Don't cache empty answers: OpenF1 may still be processing the
            # session, and the data can show up later.
            return data
        tmp = f"{path}.{threading.get_ident()}.tmp"
        with open(tmp, "w") as f:
            json.dump(data, f)
        os.replace(tmp, path)
        return data

    def _wait_for_slot(self):
        with self._rate_lock:
            while True:
                now = time.monotonic()
                while self._sent and now - self._sent[0] > 60:
                    self._sent.popleft()
                wait = 0.0
                if len(self._sent) >= MAX_REQUESTS_PER_MINUTE:
                    wait = 60 - (now - self._sent[0]) + 0.1
                elif self._sent:
                    wait = MIN_SECONDS_BETWEEN_REQUESTS - (now - self._sent[-1])
                if wait <= 0:
                    self._sent.append(now)
                    return
                time.sleep(wait)

    def _fetch(self, url: str, openf1: bool = True) -> Any:
        last_error = None
        for attempt in range(MAX_ATTEMPTS):
            if openf1:
                self._wait_for_slot()
            try:
                response = self._http.get(url, timeout=REQUEST_TIMEOUT)
            except requests.RequestException as e:
                last_error = e
                time.sleep(2 * (attempt + 1))
                continue

            if response.status_code == 429:
                retry_after = int(response.headers.get("retry-after", "60"))
                print(f"OpenF1 rate limit hit, waiting {retry_after}s")
                time.sleep(retry_after)
                continue
            # OpenF1 answers 404 {"detail": "No results found."} for empty queries
            if openf1 and response.status_code == 404:
                return []
            if response.status_code >= 500:
                last_error = OpenF1Error(f"{response.status_code} from {url}")
                time.sleep(2 * (attempt + 1))
                continue
            if not response.ok:
                raise OpenF1Error(f"{response.status_code} from {url}: {response.text[:200]}")
            return response.json()

        raise OpenF1Error(f"Request failed after {MAX_ATTEMPTS} attempts: {url} ({last_error})")


client = OpenF1Client()
