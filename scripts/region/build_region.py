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
    {"id": "north", "name": "North County", "poly": [[33.45, -117.38], [33.45, -116.95], [33.05, -116.95], [32.88, -116.98], [32.88, -117.15],
        [32.95, -117.18], [33.10, -117.25], [33.30, -117.30]],
     "points": [("Little Black", 32.99, -117.12), ("Escondido", 33.12, -117.08), ("Valley Center", 33.22, -117.03), ("San Marcos", 33.14, -117.17), ("Fallbrook", 33.38, -117.25)]},
    {"id": "east", "name": "East County", "poly": [[33.10, -116.95], [33.10, -116.70], [32.95, -116.62], [32.78, -116.62], [32.78, -117.12],
        [32.80, -117.13], [32.88, -117.15], [32.88, -116.98], [33.05, -116.95]],
     "points": [("Blossom", 32.88, -116.85), ("Ramona", 33.04, -116.87), ("Alpine", 32.84, -116.77), ("Lakeside", 32.86, -116.92), ("El Cajon Mtn", 32.90, -116.82)]},
    {"id": "south", "name": "South Bay / Border", "poly": [[32.78, -117.12], [32.78, -116.72], [32.53, -116.72], [32.54, -117.00], [32.65, -117.03], [32.80, -117.13]],
     "points": [("Otay", 32.58, -116.90), ("Whale's V", 32.65, -116.89), ("Jamul", 32.72, -116.88), ("Dulzura", 32.64, -116.78)]},
    {"id": "mountains", "name": "Mountains", "poly": [[33.45, -116.95], [33.45, -116.50], [33.25, -116.45], [33.00, -116.40], [32.75, -116.33], [32.53, -116.35],
        [32.53, -116.72], [32.78, -116.72], [32.78, -116.62], [32.95, -116.62], [33.10, -116.70], [33.10, -116.95]],
     "points": [("Palomar", 33.34, -116.87), ("Julian", 33.08, -116.60), ("Cuyamaca", 32.95, -116.57), ("Laguna", 32.87, -116.43), ("Pine Valley", 32.82, -116.53)]},
    {"id": "desert", "name": "Desert", "poly": [[33.45, -116.50], [33.45, -116.08], [32.53, -116.08], [32.53, -116.35], [32.75, -116.33], [33.00, -116.40], [33.25, -116.45]],
     "points": [("Borrego Springs", 33.26, -116.37), ("Ocotillo Wells", 33.15, -116.13), ("Agua Caliente", 32.95, -116.30)]},
    {"id": "palmsj", "name": "Palm Springs / San Jacinto", "poly": [[34.05, -116.80], [34.05, -116.00], [33.45, -116.00], [33.45, -116.80]],
     "points": [("San Jacinto", 33.81, -116.68), ("Anza", 33.555, -116.67), ("Palm Springs", 33.83, -116.55)],
     # no launch: scored on its own terms (high desert-mountain lift: good days top out 8-14k ft, light wind aloft)
     "score": {"top_lo": 6000, "top_span": 7000, "climb_full": 2.5, "wind_key": "w10k", "wind_ok": 12}},
    {"id": "marshall", "name": "Marshall", "poly": [[34.36, -117.62], [34.36, -117.02], [34.10, -117.02], [33.95, -117.10], [33.95, -117.55], [34.05, -117.62]],
     "points": [("Marshall", 34.21, -117.30), ("Crestline", 34.24, -117.29), ("Cajon / Devore", 34.22, -117.40), ("Lytle Creek", 34.22, -117.48), ("Highland foothills", 34.15, -117.17)]},
    {"id": "inland_empire", "name": "Inland Empire", "poly": [[33.95, -117.55], [33.95, -116.80], [33.45, -116.80], [33.45, -117.38], [33.55, -117.55]],
     "points": [("Elsinore", 33.63, -117.37), ("Perris", 33.78, -117.23), ("Soboba", 33.80, -116.96), ("Temecula", 33.49, -117.15), ("Menifee", 33.70, -117.18)]},
]
LEVELS = [975, 950, 925, 900, 850, 800, 700, 600, 500]
STD_HEIGHT_M = {1000: 110, 975: 320, 950: 540, 925: 760, 900: 990, 850: 1460, 800: 1950, 700: 3010, 600: 4210, 500: 5570}
SURFACE = ["temperature_2m", "dew_point_2m", "precipitation", "precipitation_probability", "cape", "shortwave_radiation",
           "cloud_cover", "cloud_cover_low", "cloud_cover_mid", "cloud_cover_high",
           "wind_speed_10m", "wind_direction_10m", "wind_gusts_10m", "boundary_layer_height"]
LEVEL_VARS = [f"{v}_{p}hPa" for p in LEVELS for v in ("temperature", "geopotential_height")] + \
             [f"{v}_{p}hPa" for p in (850, 700) for v in ("wind_speed", "wind_direction")]
# same models and logic as the radar (scripts/build_forecast.py): HRRR + RRFS where they reach, then the
# global models; per day: HRRR x2 + RRFS x1; RRFS-led days RRFS x2 + globals together x1; else median of globals
MODELS = [("HRRR", ["ncep_hrrr_conus", "gfs_hrrr"], 3), ("RRFS", ["ncep_rrfs_conus", "rrfs_conus", "ncep_rrfs"], 4),
          ("GFS", ["gfs_global", "ncep_gfs025", "gfs025"], 7), ("ECMWF", ["ecmwf_ifs025", "ecmwf_ifs"], 7),
          ("ICON", ["icon_global", "icon_seamless"], 7)]
HIRES, GLOBAL = ("HRRR", "RRFS"), ("ECMWF", "GFS", "ICON")
HIRES_W = {"HRRR": 2, "RRFS": 1}
REUSE_H = 5.5                      # like the radar: global models fetched again only when older than this
MODEL_WEIGHT = {"HRRR": 3, "RRFS": 3, "ECMWF": 1, "GFS": 1, "ICON": 1}


def rating_models(names):
    names = list(names)
    if "HRRR" in names:
        return [n for n in names if n in HIRES]
    if "RRFS" in names:
        return [n for n in names if n == "RRFS" or n in GLOBAL]
    g = [n for n in names if n in GLOBAL]
    return g or names


def model_weight(name, names):
    names = list(names)
    if "HRRR" in names:
        return HIRES_W.get(name, 1)
    if "RRFS" in names:
        n_glob = sum(1 for n in names if n in GLOBAL)
        return 2.0 if name == "RRFS" else 1.0 / max(1, n_glob)
    return MODEL_WEIGHT.get(name, 1)


def wcombine(pairs, mean_mode):
    """pairs [(value, weight)] -> weighted mean (HRRR/RRFS days) or weighted median (global-only days)."""
    pairs = [(v, w) for v, w in pairs if v is not None]
    if not pairs:
        return None
    if mean_mode:
        return sum(v * w for v, w in pairs) / sum(w for _, w in pairs)
    pairs.sort()
    half, acc = sum(w for _, w in pairs) / 2, 0
    for v, w in pairs:
        acc += w
        if acc >= half:
            return v
    return pairs[-1][0]


def blend_hours(per_model):
    """{model: region_hour} -> one region_hour with the radar's weights."""
    names = rating_models([m for m, v in per_model.items() if v])
    if not names:
        return None
    mean_mode = "HRRR" in names or "RRFS" in names
    W = {m: model_weight(m, names) for m in names}
    hs = {m: per_model[m] for m in names}
    tot = sum(W.values())
    num = lambda k, r=1: (lambda v: None if v is None else round(v, r) if r else round(v))(wcombine([(h[k], W[m]) for m, h in hs.items()], mean_mode))
    def wind(k):
        ps = [(h[k][0], h[k][1], W[m]) for m, h in hs.items() if h[k] and h[k][0] is not None and h[k][1] is not None]
        if not ps:
            return [None, None]
        u = sum(w * math.sin(math.radians(d)) for d, _, w in ps); v = sum(w * math.cos(math.radians(d)) for d, _, w in ps)
        return [round(math.degrees(math.atan2(u, v))) % 360, round(sum(sp * w for _, sp, w in ps) / sum(w for *_, w in ps))]
    grid = {}
    for z in set().union(*[h["grid"].keys() for h in hs.values()]):
        cw = sum(W[m] for m, h in hs.items() if h["grid"].get(z) == "c")
        vals = [(h["grid"][z], W[m]) for m, h in hs.items() if isinstance(h["grid"].get(z), (int, float))]
        have = cw + sum(w for _, w in vals)
        if have < tot / 2:
            continue                      # most models have no thermal (or cloud) at this height
        if cw >= have / 2:
            grid[z] = "c"
        else:
            grid[z] = round(wcombine(vals, mean_mode) * 2) / 2
    sfc = wind("sfc")
    gust = wcombine([(h["sfc"][2], W[m]) for m, h in hs.items()], True)
    bases = [(h["base_ft"], W[m]) for m, h in hs.items() if h["base_ft"]]
    out = {"climb": num("climb"), "climb_max": num("climb_max"), "wstar": num("wstar", 2),
           "top_ft": round(wcombine([(h["top_ft"], W[m]) for m, h in hs.items()], mean_mode) / 100) * 100,
           "top_max_ft": round(wcombine([(h["top_max_ft"], W[m]) for m, h in hs.items()], mean_mode) / 100) * 100,
           "base_ft": round(wcombine(bases, True) / 100) * 100 if bases else None,
           "cu": num("cu", 2), "t_f": num("t_f", 0), "cloud": num("cloud", 0), "cl_mh": num("cl_mh", 0),
           "rain_mm": num("rain_mm"), "rain_p": num("rain_p", 0), "cape": num("cape", 0),
           "sfc": [sfc[0], sfc[1], round(gust) if gust is not None else None], "w5k": wind("w5k"), "w10k": wind("w10k"),
           "okta": [round(wcombine([(h["okta"][i], W[m]) for m, h in hs.items()], True) or 0) for i in range(3)],
           "grid": grid, "models": names}
    return out


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


GRID_FT = list(range(1000, 16001, 500))


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


def score(hr, p=None):
    """1-5 thermal soaring score for one hour (climb and height first; wind and rain take away).
    p: optional per-region tuning (top_lo, top_span, climb_full, wind_key, wind_ok) for regions scored on their own terms."""
    if not hr:
        return None
    p = p or {}
    top_lo, top_span, climb_full = p.get("top_lo", 3000), p.get("top_span", 5000), p.get("climb_full", 2.0)
    s = 1 + 2.2 * clamp(hr["climb"] / climb_full, 0, 1) + 1.8 * clamp((hr["top_ft"] - top_lo) / top_span, 0, 1)
    wk, ok = p.get("wind_key"), p.get("wind_ok", 15)
    w = max(hr["w5k"][1] or 0, hr["sfc"][1] or 0, (hr[wk][1] or 0) if wk else 0)
    if w > ok:
        s -= min(1.5, (w - ok) / 8)
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


def build_days(data, idx, today, now_local, name, acc):
    """acc[date][hour][model] = region_hour for the points at positions idx of a multi-point reply."""
    times = data[0]["hourly"]["time"]
    for i, t in enumerate(times):
        d, hh = t[:10], int(t[11:13])
        if hh not in HOURS:
            continue
        k = (dt.date.fromisoformat(d) - today).days
        if k < 0 or k > 6 or (k == 0 and now_local.hour >= 19):   # 7 days like the radar; after 7 pm today is over
            continue
        ps = [point_hour(data[j]["hourly"], i, data[j].get("elevation") or 300) for j in idx]
        rh = region_hour(ps)
        if rh:
            acc.setdefault(d, {}).setdefault(str(hh), {})[name] = rh


def blend_days(acc, sp=None):
    """Per day: the models that cover most of the flying day decide (like the radar), blended hour by hour."""
    by_day = {}
    for d, hours in acc.items():
        counts = {}
        for hm in hours.values():
            for m in hm:
                counts[m] = counts.get(m, 0) + 1
        covering = [m for m, n in counts.items() if n >= 8]
        used = rating_models(covering)
        day = {"date": d, "model": " + ".join(m for m in ("HRRR", "RRFS", "GFS", "ECMWF", "ICON") if m in used) if used else "-",
               "models": used, "hours": {}}
        for hh, hm in hours.items():
            rh = blend_hours({m: v for m, v in hm.items() if m in used})
            if rh:
                rh["score"] = score(rh, sp)
                day["hours"][hh] = rh
        by_day[d] = day
    return by_day


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
    acc = {gid: {} for gid, _ in groups}
    models_used, debug = {}, {}
    cache_dir = os.path.join(os.path.dirname(__file__), "..", "..", "cache", "region")
    os.makedirs(cache_dir, exist_ok=True)
    key = ",".join(f"{la},{lo}" for _, la, lo in allpts)
    for name, ids, days in MODELS:
        data = None
        cpath = os.path.join(cache_dir, f"{name}.json")
        if name in GLOBAL:     # global models update ~6-hourly: reuse a fresh enough copy (Open-Meteo budget)
            try:
                with open(cpath) as f:
                    c = json.load(f)
                if c.get("key") == key and time.time() - c["t"] < REUSE_H * 3600:
                    data, models_used[name] = c["data"], c["mid"]
                    print(f"{name}: reused ({(time.time() - c['t']) / 3600:.1f} h old)")
            except Exception:  # noqa: BLE001
                data = None
        for mid in ([] if data else ids):
            data = fetch(mid, days, allpts)
            if data and len(data) == len(allpts) and data[0].get("hourly", {}).get("temperature_2m"):
                models_used[name] = mid
                if name in GLOBAL:
                    with open(cpath, "w") as f:
                        json.dump({"t": time.time(), "mid": mid, "key": key, "data": data}, f)
                break
            data = None
        if not data:
            print(f"{name}: no data")
            continue
        debug[name] = sorted(k for k, v in data[0]["hourly"].items() if any(x is not None for x in v))
        for gid, _ in groups:
            build_days(data, idx[gid], today, now_local, name, acc[gid])
    sps = {r["id"]: r.get("score") for r in REGIONS}
    by = {gid: blend_days(acc[gid], sps.get(gid)) for gid, _ in groups}
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
        regs.append({"id": r["id"], "name": r["name"], "title": r["name"].upper(), "poly": r["poly"], "own_score": bool(r.get("score")),
                     "points": [{"name": n, "lat": la, "lon": lo} for n, la, lo in r["points"]],
                     "days": finish(by[r["id"]], today)})
        for dd in regs[-1]["days"]:
            print(r["id"], dd["date"], dd["model"], json.dumps(dd["summary"]))
    with open(os.path.join(OUT, "regions.json"), "w") as f:
        json.dump({"generated": gen, "models": models_used, "source": "https://open-meteo.com", "regions": regs}, f, separators=(",", ":"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
