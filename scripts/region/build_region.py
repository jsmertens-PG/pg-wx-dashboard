"""San Diego as one soaring region (XCTherm-style region panel).

Pulls hourly model data for a handful of inland San Diego points from Open-Meteo, works out the soaring
numbers the same way the radar does (mixed-layer depth from the profile and the model PBL, W* from surface
heating, usable top of lift, cumulus base), averages the points into one region, and writes
data/region/sd.json. Standard library only.
"""
import datetime as dt
import json
import math
import os
import sys
import time
import urllib.parse
import urllib.request

TZ = "America/Los_Angeles"
OUT = os.path.join(os.path.dirname(__file__), "..", "..", "data", "region")
UA = "socal-flying-radar region panel (github actions)"
FT = 3.28084
POINTS = [  # inland San Diego, where the thermal flying happens
    ("Ramona", 33.04, -116.87), ("Alpine", 32.84, -116.77), ("Valley Center", 33.22, -117.03),
    ("Julian", 33.08, -116.60), ("Jamul", 32.72, -116.88), ("Poway", 32.98, -117.03),
    ("El Cajon Mtn", 32.90, -116.82),
]

# regions for the experimental map page: polygon [lat, lon] and representative points (name, lat, lon)
REGIONS = [
    {"id": "coast", "name": "Coast", "poly": [[33.30, -117.52], [33.30, -117.30], [33.10, -117.25], [32.95, -117.18], [32.80, -117.13],
        [32.65, -117.03], [32.54, -117.00], [32.53, -117.20], [32.70, -117.32], [32.95, -117.34], [33.15, -117.45]],
     "points": [("Torrey Pines", 32.89, -117.25), ("Del Mar", 32.96, -117.25), ("Carlsbad", 33.13, -117.31), ("Point Loma", 32.72, -117.23)]},
    {"id": "north", "name": "North inland", "poly": [[33.45, -117.38], [33.45, -116.95], [33.05, -116.95], [32.88, -116.98], [32.88, -117.15],
        [32.95, -117.18], [33.10, -117.25], [33.30, -117.30]],
     "points": [("Little Black", 32.99, -117.12), ("Escondido", 33.12, -117.08), ("Valley Center", 33.22, -117.03), ("San Marcos", 33.14, -117.17), ("Fallbrook", 33.38, -117.25)]},
    {"id": "east", "name": "East County", "poly": [[33.10, -116.95], [33.10, -116.70], [32.95, -116.62], [32.78, -116.62], [32.78, -117.12],
        [32.80, -117.13], [32.88, -117.15], [32.88, -116.98], [33.05, -116.95]],
     "points": [("Blossom", 32.88, -116.85), ("Ramona", 33.04, -116.87), ("Alpine", 32.84, -116.77), ("Lakeside", 32.86, -116.92), ("El Cajon Mtn", 32.90, -116.82)]},
    {"id": "south", "name": "Border hills", "poly": [[32.78, -117.12], [32.78, -116.72], [32.53, -116.72], [32.54, -117.00], [32.65, -117.03], [32.80, -117.13]],
     "points": [("Otay", 32.58, -116.90), ("Whale's V", 32.65, -116.89), ("Jamul", 32.72, -116.88), ("Dulzura", 32.64, -116.78)]},
    {"id": "mountains", "name": "Mountains", "poly": [[33.45, -116.95], [33.45, -116.50], [33.25, -116.45], [33.00, -116.40], [32.75, -116.33], [32.53, -116.35],
        [32.53, -116.72], [32.78, -116.72], [32.78, -116.62], [32.95, -116.62], [33.10, -116.70], [33.10, -116.95]],
     "points": [("Palomar", 33.34, -116.87), ("Julian", 33.08, -116.60), ("Cuyamaca", 32.95, -116.57), ("Laguna", 32.87, -116.43), ("Pine Valley", 32.82, -116.53)]},
    {"id": "desert", "name": "Desert", "poly": [[33.45, -116.50], [33.45, -116.08], [32.53, -116.08], [32.53, -116.35], [32.75, -116.33], [33.00, -116.40], [33.25, -116.45]],
     "points": [("Borrego Springs", 33.26, -116.37), ("Ocotillo Wells", 33.15, -116.13), ("Agua Caliente", 32.95, -116.30)]},
    {"id": "inland_empire", "name": "Elsinore / Perris", "poly": [[33.95, -117.55], [33.95, -116.80], [33.45, -116.80], [33.45, -117.38], [33.55, -117.55]],
     "points": [("Elsinore", 33.63, -117.37), ("Perris", 33.78, -117.23), ("Soboba", 33.80, -116.96), ("Temecula", 33.49, -117.15), ("Menifee", 33.70, -117.18)]},
]
LEVELS = [975, 950, 925, 900, 850, 800, 700, 600, 500]
STD_HEIGHT_M = {1000: 110, 975: 320, 950: 540, 925: 760, 900: 990, 850: 1460, 800: 1950, 700: 3010, 600: 4210, 500: 5570}
SURFACE = ["temperature_2m", "dew_point_2m", "precipitation", "precipitation_probability", "cape", "shortwave_radiation",
           "cloud_cover", "cloud_cover_low", "cloud_cover_mid", "cloud_cover_high",
           "wind_speed_10m", "wind_direction_10m", "wind_gusts_10m", "boundary_layer_height"]
LEVEL_VARS = [f"{v}_{p}hPa" for p in LEVELS for v in ("temperature", "geopotential_height")] + \
             [f"{v}_{p}hPa" for p in (850, 700) for v in ("wind_speed", "wind_direction")]
# short range: HRRR (today, tomorrow); then GFS
MODELS = [("HRRR", ["ncep_hrrr_conus", "gfs_hrrr"], 2), ("GFS", ["gfs_seamless", "gfs_global", "gfs025"], 4)]
HOURS = range(7, 20)


def http_json(url, tries=3):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=90) as r:
                return json.loads(r.read().decode())
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(4 * (i + 1))
    raise last


def fetch(model, days, points=None):
    points = points or POINTS
    """Return list of per-point Open-Meteo replies, dropping variables the model lacks."""
    hourly = SURFACE + ["sensible_heat_flux"] + LEVEL_VARS
    for attempt in range(3):
        q = {"latitude": ",".join(str(p[1]) for p in points), "longitude": ",".join(str(p[2]) for p in points),
             "hourly": ",".join(hourly), "models": model, "timezone": TZ, "forecast_days": days, "wind_speed_unit": "mph"}
        try:
            d = http_json("https://api.open-meteo.com/v1/forecast?" + urllib.parse.urlencode(q))
            return d if isinstance(d, list) else [d]
        except Exception as e:  # noqa: BLE001
            msg = str(e)
            print(f"{model}: {msg[:160]}")
            # drop optional variables and try again
            hourly = [v for v in hourly if v not in ("sensible_heat_flux", "precipitation_probability", "boundary_layer_height")] \
                if attempt == 0 else [v for v in hourly if "geopotential" not in v]
    return None


def at(h, k, i):
    v = (h.get(k) or [None] * (i + 1))
    return v[i] if i < len(v) else None


def profile(h, i, elev_m):
    pts = []
    for p in LEVELS:
        t = at(h, f"temperature_{p}hPa", i)
        z = at(h, f"geopotential_height_{p}hPa", i) or STD_HEIGHT_M[p]
        if t is not None and z > elev_m:
            pts.append((z, t))
    return sorted(pts)


def parcel_top(pts, t2, z0, excess=0.5):
    """Height where a dry parcel from the surface (+excess) stops being warmer than the air."""
    prev = (z0, t2)
    for z, t in pts:
        par = t2 + excess - 9.8 * (z - z0) / 1000
        if par <= t:
            z1, te1 = prev
            par1 = t2 + excess - 9.8 * (z1 - z0) / 1000
            d1, d2 = par1 - te1, par - t
            return z1 + (z - z1) * (d1 / (d1 - d2)) if d1 != d2 else z
        prev = (z, t)
    return pts[-1][0] if pts else None


def clamp(v, a, b):
    return max(a, min(b, v))


def point_hour(h, i, elev_m):
    t2, td = at(h, "temperature_2m", i), at(h, "dew_point_2m", i)
    if t2 is None:
        return None
    sw = max(0.0, at(h, "shortwave_radiation", i) or 0.0)
    pts = profile(h, i, elev_m)
    top = parcel_top(pts, t2, elev_m)
    zi = max(0.0, (top or elev_m) - elev_m)
    blh = at(h, "boundary_layer_height", i)
    if blh:
        zi = min(zi, blh) if pts else blh
    shf = at(h, "sensible_heat_flux", i)
    heat = clamp(abs(shf), 0.10 * sw, 0.60 * sw) if (shf is not None and sw > 50) else 0.30 * sw
    wstar = (9.81 / (t2 + 273.15) * heat / 1200.0 * zi) ** (1 / 3) if zi > 0 and heat > 0 else 0.0
    wstar_h = (9.81 / (t2 + 273.15) * 0.30 * sw / 1200.0 * zi) ** (1 / 3) if zi > 0 and sw > 0 else 0.0
    usable = elev_m + zi * clamp(0.4 + 0.2 * (wstar_h - 1.0), 0.3, 0.8)
    base = elev_m + 125 * max(0.0, t2 - td) if td is not None else None
    cu = base is not None and base < elev_m + zi and sw > 100
    cape = at(h, "cape", i) or 0
    ctop = (base + min(2500.0, 300.0 + cape * 1.0)) if cu else None   # shallow cu, deeper with CAPE (m)
    if base is not None:
        usable = min(usable, base)
    climb = max(0.0, 1.4 * wstar - 1.1)
    return {"t": t2, "td": td, "wstar": wstar, "climb": climb, "top": usable, "base": base, "cu": cu, "ctop": ctop,
            "zi": zi, "elev": elev_m, "cape": at(h, "cape", i) or 0, "rain": max(0.0, at(h, "precipitation", i) or 0),
            "rain_p": at(h, "precipitation_probability", i),
            "cloud": at(h, "cloud_cover", i), "cl_low": at(h, "cloud_cover_low", i),
            "cl_mh": max(at(h, "cloud_cover_mid", i) or 0, at(h, "cloud_cover_high", i) or 0),
            "cl_mid": at(h, "cloud_cover_mid", i), "cl_high": at(h, "cloud_cover_high", i),
            "sfc": (at(h, "wind_direction_10m", i), at(h, "wind_speed_10m", i), at(h, "wind_gusts_10m", i)),
            "w850": (at(h, "wind_direction_850hPa", i), at(h, "wind_speed_850hPa", i)),
            "w700": (at(h, "wind_direction_700hPa", i), at(h, "wind_speed_700hPa", i))}


def vec_mean(pairs):
    pairs = [(d, s) for d, s in pairs if d is not None and s is not None]
    if not pairs:
        return None, None
    u = sum(s * math.sin(math.radians(d)) for d, s in pairs) / len(pairs)
    v = sum(s * math.cos(math.radians(d)) for d, s in pairs) / len(pairs)
    spd = sum(s for _, s in pairs) / len(pairs)            # mean speed (not vector speed: shear between points)
    return round(math.degrees(math.atan2(u, v))) % 360, round(spd)


def mean(xs):
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else None


GRID_FT = list(range(1000, 14001, 500))


def climb_at(p, z_m):
    """Expected paraglider climb (m/s) at height z in this point's thermals: Lenschow-type W(z) profile
    scaled by W*, times a core factor, minus glider sink (same constants as the radar's climb rate)."""
    if p["zi"] <= 0 or p["wstar"] < 0.3:
        return None
    x = (z_m - p["elev"]) / p["zi"]
    if x <= 0.03 or x > 0.97:
        return None
    if p["cu"] and p["base"] is not None and z_m > p["base"]:
        return None
    w = p["wstar"] * 2.4 * x ** (1 / 3) * (1 - 1.1 * x)
    return max(0.0, 1.4 * w - 1.1)


def region_grid(ps):
    cells = {}
    for zft in GRID_FT:
        z = zft / FT
        above = [p for p in ps if p["elev"] < z]
        if len(above) < max(2, len(ps) // 2):
            continue
        cl = [p for p in above if p["cu"] and p["base"] is not None and p["base"] <= z <= (p["ctop"] or p["base"])]
        if len(cl) >= 0.4 * len(above):
            cells[str(zft)] = "c"
            continue
        vals = [climb_at(p, z) for p in above]
        got = [v for v in vals if v is not None]
        if len(got) >= 0.4 * len(above):
            cells[str(zft)] = round(sum(got) / len(got) * 2) / 2
    return cells


def region_hour(ps):
    ps = [p for p in ps if p]
    if not ps:
        return None
    cu_share = sum(1 for p in ps if p["cu"]) / len(ps)
    bases = [p["base"] for p in ps if p["cu"] and p["base"] is not None]
    sfc = vec_mean([(p["sfc"][0], p["sfc"][1]) for p in ps])
    gust = mean([p["sfc"][2] for p in ps])
    return {
        "climb": round(mean([p["climb"] for p in ps]), 1),
        "climb_max": round(max(p["climb"] for p in ps), 1),
        "wstar": round(mean([p["wstar"] for p in ps]), 2),
        "top_ft": round(mean([p["top"] for p in ps]) * FT / 100) * 100,
        "top_max_ft": round(max(p["top"] for p in ps) * FT / 100) * 100,
        "base_ft": round(mean(bases) * FT / 100) * 100 if bases else None,
        "cu": round(cu_share, 2),
        "t_f": round(mean([p["t"] for p in ps]) * 9 / 5 + 32),
        "cloud": round(mean([p["cloud"] for p in ps]) or 0),
        "cl_mh": round(mean([p["cl_mh"] for p in ps]) or 0),
        "rain_mm": round(mean([p["rain"] for p in ps]), 1),
        "rain_p": round(mean([p["rain_p"] for p in ps])) if mean([p["rain_p"] for p in ps]) is not None else None,
        "cape": round(mean([p["cape"] for p in ps])),
        "sfc": [sfc[0], sfc[1], round(gust) if gust is not None else None],
        "w5k": list(vec_mean([p["w850"] for p in ps])),
        "w10k": list(vec_mean([p["w700"] for p in ps])),
        "okta": [round((mean([p["cl_low"] for p in ps]) or 0) / 12.5),
                 round((mean([at_mid(p) for p in ps]) or 0) / 12.5),
                 round((mean([p["cl_high"] for p in ps]) or 0) / 12.5)],
        "grid": region_grid(ps),
    }


def at_mid(p):
    return p.get("cl_mid")


def score(hr):
    """1-5 thermal soaring score for one hour (climb and height first; wind and rain take away)."""
    if not hr:
        return None
    s = 1 + 2.2 * clamp(hr["climb"] / 2.0, 0, 1) + 1.8 * clamp((hr["top_ft"] - 3000) / 5000, 0, 1)
    w = max(hr["w5k"][1] or 0, hr["sfc"][1] or 0)
    if w > 15:
        s -= min(1.5, (w - 15) / 8)
    if (hr["rain_mm"] or 0) >= 0.3:
        s -= 1.5
    if hr["cl_mh"] > 70:
        s -= 0.5
    return round(clamp(s, 1, 5), 1)


def summarize(hours):
    good = {h: v for h, v in hours.items() if v and v["score"] is not None}
    if not good:
        return None
    # best 3-hour window by score
    best, bw = -1, None
    hs = sorted(good)
    for k in range(len(hs) - 2):
        win = hs[k:k + 3]
        if win[-1] - win[0] != 2:
            continue
        sc = sum(good[h]["score"] for h in win) / 3
        if sc > best:
            best, bw = sc, win
    if not bw:
        bw = [max(good, key=lambda h: good[h]["score"])]
        best = good[bw[0]]["score"]
    w = [good[h] for h in bw]
    return {"window": [bw[0], bw[-1]], "score": round(best, 1),
            "climb": round(mean([x["climb"] for x in w]), 1), "top_ft": round(mean([x["top_ft"] for x in w]) / 100) * 100,
            "cu": mean([x["cu"] for x in w]) >= 0.5,
            "base_ft": round(mean([x["base_ft"] for x in w if x["base_ft"]]) / 100) * 100 if any(x["base_ft"] for x in w) else None,
            "w5k": w[len(w) // 2]["w5k"], "high_f": max(v["t_f"] for v in good.values())}


def build_days(data, idx, today, now_local, name, by_day):
    """Fill by_day {date: day} for the points at positions idx of a multi-point reply."""
    times = data[0]["hourly"]["time"]
    for i, t in enumerate(times):
        d, hh = t[:10], int(t[11:13])
        if hh not in HOURS:
            continue
        k = (dt.date.fromisoformat(d) - today).days
        if k < 0 or k > 3 or (k == 0 and now_local.hour >= 19):   # after 7 pm today is over
            continue
        if d in by_day and by_day[d]["model"] != name:
            continue        # HRRR wins for the days it covers
        if name == "HRRR" and k > 1:
            continue
        ps = [point_hour(data[j]["hourly"], i, data[j].get("elevation") or 300) for j in idx]
        rh = region_hour(ps)
        if rh:
            rh["score"] = score(rh)
            by_day.setdefault(d, {"date": d, "model": name, "hours": {}})["hours"][str(hh)] = rh


def finish(by_day, today):
    days = []
    for d in sorted(by_day):
        day = by_day[d]
        k = (dt.date.fromisoformat(d) - today).days
        day["label"] = ["Today", "Tomorrow"][k] if k < 2 else dt.date.fromisoformat(d).strftime("%A")
        day["summary"] = summarize({int(h): v for h, v in day["hours"].items()})
        days.append(day)
    return days


def main():
    os.makedirs(OUT, exist_ok=True)
    now_local = dt.datetime.now(dt.timezone.utc).astimezone(__import__("zoneinfo").ZoneInfo(TZ))
    today = now_local.date()
    groups = [("sd", POINTS)] + [(r["id"], r["points"]) for r in REGIONS]
    allpts, idx = [], {}
    for gid, pts in groups:
        idx[gid] = list(range(len(allpts), len(allpts) + len(pts)))
        allpts += pts
    by = {gid: {} for gid, _ in groups}
    models_used, debug = {}, {}
    for name, ids, days in MODELS:
        data = None
        for mid in ids:
            data = fetch(mid, days, allpts)
            if data and len(data) == len(allpts) and data[0].get("hourly", {}).get("temperature_2m"):
                models_used[name] = mid
                break
            data = None
        if not data:
            print(f"{name}: no data")
            continue
        debug[name] = sorted(k for k, v in data[0]["hourly"].items() if any(x is not None for x in v))
        for gid, _ in groups:
            build_days(data, idx[gid], today, now_local, name, by[gid])
    gen = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%MZ")
    sd_days = finish(by["sd"], today)
    if not sd_days:
        print("no region data")
        return 1
    with open(os.path.join(OUT, "sd.json"), "w") as f:
        json.dump({"generated": gen, "region": "San Diego inland", "title": "SAN DIEGO",
                   "points": [{"name": n, "lat": la, "lon": lo} for n, la, lo in POINTS], "models": models_used,
                   "source": "https://open-meteo.com", "variables": debug, "days": sd_days}, f, indent=1)
    regs = []
    for r in REGIONS:
        regs.append({"id": r["id"], "name": r["name"], "title": r["name"].upper(), "poly": r["poly"],
                     "points": [{"name": n, "lat": la, "lon": lo} for n, la, lo in r["points"]],
                     "days": finish(by[r["id"]], today)})
        for dd in regs[-1]["days"]:
            print(r["id"], dd["date"], dd["model"], json.dumps(dd["summary"]))
    with open(os.path.join(OUT, "regions.json"), "w") as f:
        json.dump({"generated": gen, "models": models_used, "source": "https://open-meteo.com", "regions": regs}, f, separators=(",", ":"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
