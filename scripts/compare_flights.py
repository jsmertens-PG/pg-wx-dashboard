#!/usr/bin/env python3
"""Compare the radar's morning snapshots with what was actually flown.

Flights come from either or both of:
  --igc DIR     a folder of IGC files (searched recursively), e.g. your logbook
  --csv FILE    a CSV with one flight per row, filled from any source (XContest day lists,
                club reports, notes). Columns (header row required; extra columns ignored):
                    date      YYYY-MM-DD
                    site      radar site id (lb, blossom, elsinore, torrey, lagunahorse, marshall,
                              otay, soboba, santabarbara) or a site name / short name
                    max_alt_ft  highest altitude (MSL, ft), optional
                    dist_km     free distance or XC distance (km), optional
                    dist_mi     same in miles, optional
                    duration_min  flight time, optional
                    pilot       optional

Each flight day at a site is turned into an "observed" 1-5 score with the site's own scale from
sites.json (ok_ft = 3, xc_top_ft = 4, xc_top_ft + xc_span_ft = 5, plus distance), then set
against what the radar said that morning. Days without flights are skipped: no flights does not
mean the day was bad.

Usage:
  python scripts/compare_flights.py --igc ~/logbook/igc --csv flights.csv
  python scripts/compare_flights.py --csv flights.csv --out report.md
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import re
import sys
from datetime import date
from pathlib import Path
from statistics import mean, median

ROOT = Path(__file__).resolve().parent.parent
FT = 3.28084
MATCH_KM = 3.0            # a takeoff within this distance of a launch belongs to that site


# ---------------------------------------------------------------- sites
def load_sites():
    raw = json.loads((ROOT / "sites.json").read_text())["sites"]
    launches = []   # (site id, name, lat, lon) for matching takeoffs
    for s in raw:
        for l in (s.get("launches") or [s]):
            if "lat" in l:
                launches.append((s["id"], l.get("name", s["name"]), l["lat"], l["lon"]))
    return {s["id"]: s for s in raw}, launches


def site_id(text, sites):
    t = (text or "").strip().lower()
    if t in sites:
        return t
    for k, s in sites.items():
        names = {s["name"].lower(), s.get("short", "").lower()} | {l["name"].lower() for l in s.get("launches", [])}
        if t in names or any(t and t in n for n in names):
            return k
    return None


def km(lat1, lon1, lat2, lon2):
    p = math.pi / 180
    a = (math.sin((lat2 - lat1) * p / 2) ** 2
         + math.cos(lat1 * p) * math.cos(lat2 * p) * math.sin((lon2 - lon1) * p / 2) ** 2)
    return 12742 * math.asin(math.sqrt(a))


# ---------------------------------------------------------------- flights
def parse_igc(path):
    """date, takeoff lat/lon, max GPS altitude (ft), straight distance from takeoff (km), duration (min)."""
    day, fixes = None, []
    for line in path.read_text(errors="ignore").splitlines():
        if line.startswith("HFDTE"):
            m = re.search(r"(\d{2})(\d{2})(\d{2})", line[5:])
            if m:
                dd, mm, yy = map(int, m.groups())
                day = date(2000 + yy, mm, dd)
        elif line.startswith("B") and len(line) >= 35:
            try:
                hh, mi, ss = int(line[1:3]), int(line[3:5]), int(line[5:7])
                lat = int(line[7:9]) + int(line[9:14]) / 60000
                lat = -lat if line[14] == "S" else lat
                lon = int(line[15:18]) + int(line[18:23]) / 60000
                lon = -lon if line[23] == "W" else lon
                gps = int(line[30:35])
                fixes.append((hh * 3600 + mi * 60 + ss, lat, lon, gps))
            except ValueError:
                continue
    if not day or len(fixes) < 10:
        return None
    t0, la0, lo0, _ = fixes[0]
    dur = (fixes[-1][0] - t0) % 86400 / 60
    far = max(km(la0, lo0, la, lo) for _, la, lo, _ in fixes)
    return {"date": day.isoformat(), "lat": la0, "lon": lo0, "max_alt_ft": max(f[3] for f in fixes) * FT,
            "dist_km": far, "duration_min": dur, "source": path.name}


def flights_from_igc(folder, launches):
    out, unmatched = [], 0
    for p in sorted(Path(folder).expanduser().rglob("*")):
        if p.suffix.lower() != ".igc":
            continue
        f = parse_igc(p)
        if not f:
            continue
        best = min(launches, key=lambda l: km(f["lat"], f["lon"], l[2], l[3]))
        if km(f["lat"], f["lon"], best[2], best[3]) > MATCH_KM:
            unmatched += 1
            continue
        f["site"] = best[0]
        out.append(f)
    return out, unmatched


def num(v):
    try:
        return float(str(v).replace(",", "")) if str(v).strip() else None
    except ValueError:
        return None


def flights_from_csv(path, sites):
    out, bad = [], 0
    with open(Path(path).expanduser(), newline="") as fh:
        for row in csv.DictReader(fh):
            row = {k.strip().lower(): v for k, v in row.items() if k}
            sid = site_id(row.get("site"), sites)
            if not sid or not row.get("date"):
                bad += 1
                continue
            d = num(row.get("dist_km"))
            if d is None and num(row.get("dist_mi")) is not None:
                d = num(row.get("dist_mi")) * 1.609
            out.append({"date": row["date"].strip()[:10], "site": sid, "max_alt_ft": num(row.get("max_alt_ft")),
                        "dist_km": d, "duration_min": num(row.get("duration_min")), "source": Path(path).name})
    return out, bad


# ---------------------------------------------------------------- scoring what happened
def observed_score(site, flights):
    """1-5 from the best height and distance of the day, on the site's own scale."""
    L = site["launch_ft"]
    ok = site.get("ok_ft") or L + 1500
    xc = site.get("xc_top_ft") or ok + 1000
    gr = xc + (site.get("xc_span_ft") or 1000)
    alt = max((f["max_alt_ft"] for f in flights if f.get("max_alt_ft")), default=None)
    dist = max((f["dist_km"] for f in flights if f.get("dist_km")), default=0) or 0
    dur = max((f["duration_min"] for f in flights if f.get("duration_min")), default=None)
    by_alt = None
    if alt is not None:
        pts = [(L, 1.5), (ok, 3.0), (xc, 4.0), (gr, 5.0)]
        by_alt = 1.0 if alt <= L else 5.0
        for (a, qa), (b, qb) in zip(pts, pts[1:]):
            if a < alt <= b:
                by_alt = qa + (qb - qa) * (alt - a) / (b - a)
                break
    # 5-15 km a short XC (3-4), 15 km+ a real XC (4), 100 km+ outstanding (5)
    by_dist = min(5.0, 4.0 + (dist - 15) / 85) if dist >= 15 else 3.0 + (dist - 5) / 10 if dist >= 5 else None
    by_dur = 3.0 if dur and dur >= 60 else (2.0 if dur and dur >= 20 else None)
    vals = [v for v in (by_alt, by_dist, by_dur) if v is not None]
    return (round(min(5.0, max(vals)), 2) if vals else None), alt, dist, dur


def radar_height_ft(text):
    nums = [float(x.replace(",", "")) for x in re.findall(r"\d[\d,]*", text or "")]
    return mean(nums) if nums else None


# ---------------------------------------------------------------- report
def compare(history, flights, sites):
    days = {}
    for f in flights:
        days.setdefault((f["date"], f["site"]), []).append(f)
    rows = []
    for (d, sid), fl in sorted(days.items()):
        snap_path = history / f"{d}.json"
        if not snap_path.exists():
            continue
        snap = json.loads(snap_path.read_text())
        day = next((x for x in snap["days"] if x["date"] == d), None)
        cell = day and day["sites"].get(sid)
        if not cell:
            continue
        obs, alt, dist, dur = observed_score(sites[sid], fl)
        if obs is None:
            continue
        rows.append({"date": d, "site": sid, "type": day.get("type"), "radar": cell["r"], "label": cell["label"],
                     "radar_ft": radar_height_ft(cell.get("height")), "obs": obs, "alt": alt, "dist": dist,
                     "n": len(fl)})
    return rows


def suggestions(rows, sites):
    out = []
    for sid in sorted({r["site"] for r in rows}):
        rs = [r for r in rows if r["site"] == sid]
        diff = [r["radar"] - r["obs"] for r in rs]
        hb = [r["alt"] - r["radar_ft"] for r in rs if r["alt"] and r["radar_ft"]]
        line = f"- **{sites[sid]['short']}** ({len(rs)} days): radar {'+' if mean(diff) >= 0 else ''}{mean(diff):.1f} vs flown on average"
        if hb:
            line += f"; best climbs were {median(hb):+,.0f} ft from the radar height (median)"
        if len(rs) < 5:
            line += " — too few days to change anything yet."
        elif abs(median(hb or [0])) > 400:
            line += f" — consider shifting the height calibration by about {median(hb):+,.0f} ft for this site."
        elif abs(mean(diff)) > 0.6:
            line += f" — the rating runs {'high' if mean(diff) > 0 else 'low'}; check ok_ft / xc_top_ft in sites.json."
        else:
            line += " — looks well calibrated."
        out.append(line)
    return out


def report(rows, sites, notes):
    if not rows:
        return "No flight days matched a snapshot yet.\n" + "".join(f"\n{n}" for n in notes)
    lines = ["# Radar vs flights", "", *notes, "",
             "| Date | Site | Day type | Radar | Flown | Radar height | Best alt | Best dist | Flights |",
             "|---|---|---|---|---|---|---|---|---|"]
    for r in rows:
        rh = f"{r['radar_ft']:,.0f}" if r["radar_ft"] else "–"
        al = f"{r['alt']:,.0f}" if r["alt"] else "–"
        lines.append(f"| {r['date']} | {sites[r['site']]['short']} | {r['type'] or ''} | {r['radar']:.1f} {r['label']} "
                     f"| {r['obs']:.1f} | {rh} | {al} | {r['dist']:.0f} km | {r['n']} |")
    lines += ["", "## Suggestions", "", *suggestions(rows, sites), ""]
    return "\n".join(lines)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--igc", action="append", default=[], help="folder of IGC files (repeatable)")
    ap.add_argument("--csv", action="append", default=[], help="CSV of flights (repeatable)")
    ap.add_argument("--history", default=str(ROOT / "data" / "history"))
    ap.add_argument("--out", help="write the report here (markdown); default prints it")
    args = ap.parse_args(argv)
    sites, launches = load_sites()
    flights, notes = [], []
    for folder in args.igc:
        f, unmatched = flights_from_igc(folder, launches)
        flights += f
        notes.append(f"- {len(f)} IGC flights from {folder} matched a site ({unmatched} elsewhere).")
    for path in args.csv:
        f, bad = flights_from_csv(path, sites)
        flights += f
        notes.append(f"- {len(f)} CSV flights from {path}" + (f" ({bad} rows skipped: unknown site or no date)." if bad else "."))
    if not flights:
        sys.exit("No flights given: use --igc and/or --csv.")
    text = report(compare(Path(args.history), flights, sites), sites, notes)
    if args.out:
        Path(args.out).write_text(text)
        print(f"wrote {args.out}")
    else:
        print(text)


if __name__ == "__main__":
    main()
