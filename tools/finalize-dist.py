#!/usr/bin/env python3
"""Stamps a build version into the web bundle and writes the service worker's precache list.

Usage: finalize-dist.py <dist dir>
  - build-info.json: { version, built, files: {name: bytes} }
  - sw.js: __VERSION__ / __PRECACHE__ placeholders replaced
"""
import hashlib
import json
import os
import sys
import time


def main():
    dist = sys.argv[1]
    files = []
    for root, _dirs, names in os.walk(dist):
        for n in names:
            rel = os.path.relpath(os.path.join(root, n), dist).replace(os.sep, "/")
            if rel in ("sw.js", "build-info.json"):
                continue
            files.append(rel)
    files.sort()

    h = hashlib.sha256()
    sizes = {}
    for rel in files:
        p = os.path.join(dist, rel)
        with open(p, "rb") as f:
            data = f.read()
        h.update(rel.encode())
        h.update(hashlib.sha256(data).digest())
        sizes[rel] = len(data)
    version = h.hexdigest()[:12]

    info = {"version": version, "built": time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime()), "files": sizes}
    with open(os.path.join(dist, "build-info.json"), "w") as f:
        json.dump(info, f, indent=1)

    # Precache everything except the service worker itself; "./" covers the start URL
    precache = ["./", "build-info.json"] + files
    sw_path = os.path.join(dist, "sw.js")
    with open(sw_path) as f:
        sw = f.read()
    sw = sw.replace("__VERSION__", version).replace("__PRECACHE__", json.dumps(precache, indent=1))
    with open(sw_path, "w") as f:
        f.write(sw)

    total = sum(sizes.values())
    print(f"finalize-dist: version {version}, {len(files)} files, {total / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
