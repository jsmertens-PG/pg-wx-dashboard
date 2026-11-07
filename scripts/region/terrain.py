"""One-time terrain sampling for the region panels (Regtherm-style area-elevation weighting).

For every region polygon: sample ground height on a ~2.5 km grid (Open-Meteo elevation API, 100 points per call),
give each cell to its nearest probe point, and store per probe a histogram of ground heights in 500 ft buckets.
build_region.py then lets each probe's thermals rise from all the ground it stands for, weighted by area.
Re-runs only when the polygons or probe points change.
"""
import hashlib
import json
import math
import os
import sys
import urllib.parse

sys.path.insert(0, os.path.dirname(__file__))
from build_region import REGIONS, FT, http_json  # noqa: E402

OUT = os.path.join(os.path.dirname(__file__), "..", "..", "data", "region", "terrain.json")
STEP = 0.025   # degrees, about 2.5 km


def inside(la, lo, poly):
    c = False
    for k in range(len(poly)):
        a, b = poly[k], poly[k - 1]
        if (a[0] > la) != (b[0] > la) and lo < (b[1] - a[1]) * (la - a[0]) / (b[0] - a[0]) + a[1]:
            c = not c
    return c


def key():
    return hashlib.sha1(json.dumps(["v2-land-only"] + [[r["id"], r["poly"], r["points"]] for r in REGIONS]).encode()).hexdigest()[:12]


def main():
    k = key()
    try:
        with open(OUT) as f:
            if json.load(f).get("key") == k:
                print("terrain: up to date")
                return 0
    except Exception:  # noqa: BLE001
        pass
    cells = []   # (region index, lat, lon)
    for ri, r in enumerate(REGIONS):
        las = [p[0] for p in r["poly"]]
        los = [p[1] for p in r["poly"]]
        la = math.floor(min(las) / STEP) * STEP + STEP / 2
        while la < max(las):
            lo = math.floor(min(los) / STEP) * STEP + STEP / 2
            while lo < max(los):
                if inside(la, lo, r["poly"]):
                    cells.append((ri, round(la, 4), round(lo, 4)))
                lo += STEP
            la += STEP
    print(f"terrain: {len(cells)} cells")
    elev = []
    for s in range(0, len(cells), 100):
        chunk = cells[s:s + 100]
        q = {"latitude": ",".join(str(c[1]) for c in chunk), "longitude": ",".join(str(c[2]) for c in chunk)}
        try:
            d = http_json("https://api.open-meteo.com/v1/elevation?" + urllib.parse.urlencode(q))
        except Exception as e:  # noqa: BLE001
            print(f"terrain: elevation fetch failed ({str(e)[:120]}); keeping the old file")
            return 0
        elev += d["elevation"]
    out = {"key": k, "step_deg": STEP, "regions": {}}
    for ri, r in enumerate(REGIONS):
        pts = r["points"]
        hist = [{} for _ in pts]
        n = 0
        for (cri, la, lo), e in zip(cells, elev):
            if cri != ri or e is None or e <= 1:   # sea (and the bay) is not ground
                continue
            cl = math.cos(math.radians(la))
            j = min(range(len(pts)), key=lambda j: (pts[j][1] - la) ** 2 + ((pts[j][2] - lo) * cl) ** 2)
            b = str(int(max(0, e) * FT // 500 * 500))
            hist[j][b] = hist[j].get(b, 0) + 1
            n += 1
        if not n:
            continue
        out["regions"][r["id"]] = {"cells": n, "probes": [{"name": p[0], "hist": {b: round(c / n, 4) for b, c in sorted(h.items(), key=lambda x: int(x[0]))}}
                                                          for p, h in zip(pts, hist)]}
        share = [round(sum(h.values()) / n, 2) for h in hist]
        print(r["id"], n, "cells, probe shares", share)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
