#!/usr/bin/env python3
"""Redraw the site charts in measure.html ("Where the radar measures") from sites.json."""
import html, json, math, re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
S = {s["id"]: s for s in json.loads((ROOT / "sites.json").read_text())["sites"]}
BIG = ["lb", "blossom", "elsinore", "lagunahorse"]
SMALL = ["torrey", "otay", "whalesv", "soboba", "marshall"]
EXP = ["santabarbara", "owens"]   # experimental: areas for a flying trip


def xy(lat, lon, lat0, lon0):
    return ((lon - lon0) * 111.0 * math.cos(math.radians(lat0)), (lat - lat0) * 111.0)


def arcs(a, b):
    """Split a compass sector a->b (clockwise) into (start, end) pieces."""
    return [(a % 360, a % 360 + (b - a) % 360)] if (b - a) % 360 else [(0, 360)]


def sectors(s, l):
    """(start, end, cls) wedges for one launch: green = within 20 deg of the face, yellow = the rest of the
    accepted sector plus any cross sectors."""
    w = l.get("dir") or s.get("dir")
    if not w or (w[1] - w[0]) % 360 == 0:
        return []
    span = (w[1] - w[0]) % 360
    face = s.get("face") if s.get("face") is not None and not l.get("dir") else (w[0] + span / 2)
    fo = (face - w[0]) % 360
    g0, g1 = w[0] + max(0, fo - 20), w[0] + min(span, fo + 20)
    out = [(w[0], g0, "acc"), (g0, g1, "pref"), (g1, w[0] + span, "acc")]
    if not l.get("dir"):
        out += [(c[0], c[0] + (c[1] - c[0]) % 360, "acc") for c in s.get("cross") or []]
    return [o for o in out if o[1] - o[0] > 0.5]


def wedge(X, Y, r, a0, a1, cls):
    pt = lambda a: (X + r * math.sin(math.radians(a)), Y - r * math.cos(math.radians(a)))
    (x0, y0), (x1, y1) = pt(a0), pt(a1)
    big = 1 if a1 - a0 > 180 else 0
    return (f'<path d="M{X:.1f} {Y:.1f} L{x0:.1f} {y0:.1f} A{r:.1f} {r:.1f} 0 {big} 1 {x1:.1f} {y1:.1f} Z" '
            f'class="sec {cls}"/>')


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
    step = 10 if ext < 40 else 25
    for r in range(step, int(ext) + 1, step):
        o.append(f'<circle cx="{W/2}" cy="{W/2}" r="{r*R:.1f}" class="ring"/><text x="{W/2+r*R*0.707+3:.1f}" '
                 f'y="{W/2-r*R*0.707-3:.1f}" class="km">{r} km</text>')
    o.append(f'<line x1="{W/2}" y1="{pad/2}" x2="{W/2}" y2="{W-pad/2}" class="axis"/><line x1="{pad/2}" y1="{W/2}" '
             f'x2="{W-pad/2}" y2="{W/2}" class="axis"/><text x="{W/2}" y="{pad/2-4}" class="north">N</text>')
    wr = 34 if sid in EXP else (62 if big else 44)     # trip areas span tens of km: smaller wedges
    for l, ((x, y), _) in zip(launches, L):
        X, Y = P(x, y)
        o += [wedge(X, Y, wr, a0, a1, c) for a0, a1, c in sectors(s, l)]
    near = lambda x, y: any(math.hypot(x - a, y - b) < 3 for (a, b), _ in L)
    for (x, y), n in pts:
        X, Y = P(x, y)
        o.append(f'<circle cx="{X:.1f}" cy="{Y:.1f}" r="{9 if big else 7}" class="pt"/>')
        if n.endswith("launch") or any(math.hypot(x - a, y - b) < 0.2 for (a, b), _ in L):
            continue                                  # the point at a launch: the launch name says it
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
        if sid in EXP:                                # trip areas: points are spread out, label each one below it
            anchor, dx, dy = "start", 8, -12
        o.append(f'<text x="{X+dx:.1f}" y="{Y+dy:.1f}" text-anchor="{anchor}" class="pl">{html.escape(n)}</text>')
    for (x, y), n in L:
        X, Y = P(x, y)
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
    exp = "".join(chart(x, True) for x in EXP if x in S)
    page = re.sub(r'<div class="grid big">.*?</div>\n<h2>', lambda m: f'<div class="grid big">{big}</div>\n<h2>', page, flags=re.S)
    page = re.sub(r'<div class="grid small">.*?</div>\n(<h2 class="exp">|</main>)',
                  lambda m: f'<div class="grid small">{small}</div>\n{m.group(1)}', page, flags=re.S)
    block = ('<h2 class="exp">Experimental · areas for a flying trip</h2>\n'
             '<p class="expnote">Work in progress: several launches per area, measured along the terrain between them. '
             'The rating takes the best launch of the day.</p>\n'
             f'<div class="grid big exp">{exp}</div>\n')
    if '<h2 class="exp">' in page:
        page = re.sub(r'<h2 class="exp">.*?<div class="grid big exp">.*?</div>\n', lambda m: block, page, flags=re.S)
    else:
        page = page.replace('</main>', block + '</main>', 1)
    p.write_text(page)
    print("measure.html redrawn")


if __name__ == "__main__":
    main()
