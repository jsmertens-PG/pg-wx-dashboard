#!/usr/bin/env python3
"""Redraw the site charts in measure.html ("Where the radar measures") from sites.json."""
import html, json, math, re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
S = {s["id"]: s for s in json.loads((ROOT / "sites.json").read_text())["sites"]}
BIG = ["lb", "blossom", "elsinore", "lagunahorse"]
SMALL = ["torrey", "otay", "whalesv", "soboba", "marshall", "santabarbara", "owens"]


def xy(lat, lon, lat0, lon0):
    return ((lon - lon0) * 111.0 * math.cos(math.radians(lat0)), (lat - lat0) * 111.0)


def chart(sid, big):
    s = S[sid]
    launches = s.get("launches") or [{"name": s["short"], "lat": s["lat"], "lon": s["lon"]}]
    hp = s.get("height_points") or []
    lat0 = sum(l["lat"] for l in launches) / len(launches)
    lon0 = sum(l["lon"] for l in launches) / len(launches)
    pts = [(xy(p["lat"], p["lon"], lat0, lon0), p["name"]) for p in hp]
    L = [(xy(l["lat"], l["lon"], lat0, lon0), l["name"]) for l in launches]
    ext = max([12] + [max(abs(a), abs(b)) for (a, b), _ in pts + L]) + 4
    W = 520 if big else 300
    pad = 34
    R = (W / 2 - pad) / ext
    P = lambda x, y: (W / 2 + x * R, W / 2 - y * R)
    o = [f'<svg viewBox="0 0 {W} {W}" role="img" aria-label="Measuring points for {html.escape(s["name"])}">']
    for r in range(10, int(ext) + 1, 10):
        o.append(f'<circle cx="{W/2}" cy="{W/2}" r="{r*R:.1f}" class="ring"/><text x="{W/2+r*R*0.707+3:.1f}" '
                 f'y="{W/2-r*R*0.707-3:.1f}" class="km">{r} km</text>')
    o.append(f'<line x1="{W/2}" y1="{pad/2}" x2="{W/2}" y2="{W-pad/2}" class="axis"/><line x1="{pad/2}" y1="{W/2}" '
             f'x2="{W-pad/2}" y2="{W/2}" class="axis"/><text x="{W/2}" y="{pad/2-4}" class="north">N</text>')
    near = lambda x, y: any(math.hypot(x - a, y - b) < 3 for (a, b), _ in L)
    for (x, y), n in pts:
        X, Y = P(x, y)
        o.append(f'<circle cx="{X:.1f}" cy="{Y:.1f}" r="{6 if big else 5}" class="pt"/>')
        if n.endswith("launch"):
            continue
        if near(x, y):
            anchor, dx, dy = "start", 14, 4
        else:
            anchor, dx = ("start", 10) if x >= 0 else ("end", -10)
            if abs(x) < 1:
                anchor, dx = "middle", 0
            dy = -10 if y >= 0 else 18
            if abs(y) < 1:
                dy = 4
        if anchor == "start" and X + dx > W - 110:
            anchor, dx, dy = "end", -10, 18
        o.append(f'<text x="{X+dx:.1f}" y="{Y+dy:.1f}" text-anchor="{anchor}" class="pl">{html.escape(n)}</text>')
    for (x, y), n in L:
        X, Y = P(x, y)
        o.append(f'<path d="M{X:.1f} {Y-10:.1f} L{X+9:.1f} {Y+6:.1f} L{X-9:.1f} {Y+6:.1f} Z" class="launch"/>')
        o.append(f'<text x="{X-14:.1f}" y="{Y+5:.1f}" text-anchor="end" class="ll">{html.escape(n)}</text>' if len(L) > 1
                 else f'<text x="{X:.1f}" y="{Y+22:.1f}" class="ll" text-anchor="middle">{html.escape(n)}</text>')
    o.append("</svg>")
    note = f"{len(hp)} height points · wind from the launch" if hp else "wind and height from the launch point only"
    return (f'<figure class="site {"big" if big else "small"}"><figcaption><b>{html.escape(s["name"])}</b>'
            f'<span>{note}</span></figcaption>{"".join(o)}</figure>')


def main():
    p = ROOT / "measure.html"
    page = p.read_text()
    big = "".join(chart(x, True) for x in BIG if x in S)
    small = "".join(chart(x, False) for x in SMALL if x in S)
    page = re.sub(r'<div class="grid big">.*?</div>\n<h2>', lambda m: f'<div class="grid big">{big}</div>\n<h2>', page, flags=re.S)
    page = re.sub(r'<div class="grid small">.*?</div>\n</main>', lambda m: f'<div class="grid small">{small}</div>\n</main>', page, flags=re.S)
    p.write_text(page)
    print("measure.html redrawn")


if __name__ == "__main__":
    main()
