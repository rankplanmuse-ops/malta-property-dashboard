#!/usr/bin/env python3
"""Download every listing photo once, resize it, and store a local WebP copy
under img/ so the standalone dashboard stops hotlinking maltapark.com and
Rentola's CDN. File name = first 12 hex chars of sha1(source URL), so it is
stable across dataset re-sorts and dedupes repeated URLs.

Idempotent: existing files are skipped, so the daily sync only fetches photos
for genuinely new listings. Failures are written to tools/last-fetch-failures.json
and those listings keep their remote URL in the generated data.
"""
import hashlib
import json
import os
import re
import subprocess
import sys
import urllib.parse
from concurrent.futures import ThreadPoolExecutor

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.expanduser("~/workspace/malta-dashboard/listings.json")
IMG_DIR = os.path.join(ROOT, "img")
MAX_W = 900
QUALITY = 76
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"


def name_for(url):
    return hashlib.sha1(url.encode("utf-8")).hexdigest()[:12] + ".webp"


def origin_of(url):
    """img2.rentola.com proxy URLs embed the real photo URL, URL-encoded, at
    the end of the path. The proxy rejects many of them with HTTP 400 while
    the origin still serves the photo, so fall back to the origin."""
    m = re.search(r"(https?%3A%2F%2F.+)$", url)
    return urllib.parse.unquote(m.group(1)) if m else None


def curl_to(url, dest):
    return subprocess.run(
        ["curl", "-sS", "-L", "--fail", "--max-time", "40", "-A", UA, "-o", dest, url],
        capture_output=True, text=True, timeout=60,
    )


def fetch_one(url):
    target = os.path.join(IMG_DIR, name_for(url))
    if os.path.exists(target) and os.path.getsize(target) > 0:
        return (url, "skip", None)
    tmp = target + ".part"
    try:
        r = curl_to(url, tmp)
        if r.returncode != 0 and "rentola" in url:
            origin = origin_of(url)
            if origin and origin != url:
                r = curl_to(origin, tmp)
        if r.returncode != 0:
            return (url, "fail", (r.stderr or "curl error").strip()[:160])
        with Image.open(tmp) as im:
            im = im.convert("RGB")
            if im.width > MAX_W:
                im = im.resize((MAX_W, round(im.height * MAX_W / im.width)), Image.LANCZOS)
            im.save(target, "WEBP", quality=QUALITY, method=4)
        return (url, "ok", None)
    except Exception as e:  # PIL errors on non-image payloads land here
        return (url, "fail", str(e)[:160])
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


def main():
    os.makedirs(IMG_DIR, exist_ok=True)
    with open(SRC) as f:
        data = json.load(f)
    urls = sorted({u for x in data for u in (x.get("images") or [])})
    print("unique image urls:", len(urls), flush=True)
    ok = skip = 0
    failures = []
    with ThreadPoolExecutor(max_workers=6) as ex:
        for url, status, err in ex.map(fetch_one, urls):
            if status == "ok":
                ok += 1
            elif status == "skip":
                skip += 1
            else:
                failures.append({"url": url, "error": err})
    with open(os.path.join(HERE, "last-fetch-failures.json"), "w") as f:
        json.dump(failures, f, indent=1)
    total = sum(os.path.getsize(os.path.join(IMG_DIR, n)) for n in os.listdir(IMG_DIR))
    print("downloaded:", ok, "| already present:", skip, "| failed:", len(failures))
    print("img/ total MB:", round(total / 1048576, 1), "| files:", len(os.listdir(IMG_DIR)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
