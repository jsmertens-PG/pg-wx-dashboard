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
    {"id": "east", "name": "East County", "poly": [[33.22, -116.95], [33.22, -116.66], [33.10, -116.70], [32.95, -116.62], [32.78, -116.62], [32.78, -117.12],
        [32.80, -117.13], [32.88, -117.15], [32.88, -116.98], [33.05, -116.95]],
     "points": [("Blossom", 32.88, -116.85), ("Ramona", 33.04, -116.87), ("Alpine", 32.84, -116.77), ("Lakeside", 32.86, -116.92), ("El Cajon Mtn", 32.90, -116.82)]},
    {"id": "south", "name": "South Bay / Border", "poly": [[32.78, -117.12], [32.78, -116.72], [32.53, -116.72], [32.54, -117.00], [32.65, -117.03], [32.80, -117.13]],
     "points": [("Otay", 32.58, -116.90), ("Whale's V", 32.65, -116.89), ("Jamul", 32.72, -116.88), ("Dulzura", 32.64, -116.78)]},
    {"id": "palomar", "name": "Palomar", "poly": [[33.45, -116.95], [33.45, -116.66], [33.22, -116.66], [33.22, -116.95]],
     "points": [("Palomar summit", 33.36, -116.84), ("Palomar N", 33.42, -116.82), ("Palomar E", 33.33, -116.75),
                ("Palomar S", 33.28, -116.86), ("Palomar W", 33.33, -116.92)],
     # no launch: own score - OK once tops reach ~5k ft, good above 7k, lighter wind better
     "score": {"top_lo": 3000, "top_span": 5000, "climb_full": 2.0, "wind_key": "w5k", "wind_ok": 10}},
    {"id": "mountains", "name": "Mountains", "poly": [[33.45, -116.66], [33.45, -116.50], [33.25, -116.45], [33.00, -116.40], [32.75, -116.33], [32.53, -116.35],
        [32.53, -116.72], [32.78, -116.72], [32.78, -116.62], [32.95, -116.62], [33.10, -116.70], [33.22, -116.66]],
     "points": [("Hot Springs Mtn", 33.31, -116.58), ("Julian", 33.08, -116.60), ("Cuyamaca", 32.95, -116.57), ("Laguna", 32.93, -116.48), ("Horse / Fuzz", 32.77, -116.48)]},
    {"id": "desert", "name": "Desert", "poly": [[33.45, -116.50], [33.45, -116.08], [32.53, -116.08], [32.53, -116.35], [32.75, -116.33], [33.00, -116.40], [33.25, -116.45]],
     "points": [("Borrego Springs", 33.26, -116.37), ("Ocotillo Wells", 33.15, -116.13), ("Agua Caliente", 32.95, -116.30)]},
    {"id": "palmsj", "name": "Palm Springs / San Jacinto", "poly": [[34.05, -116.80], [34.05, -116.00], [33.45, -116.00], [33.45, -116.80]],
     "points": [("San Jacinto", 33.81, -116.68), ("Anza", 33.555, -116.67), ("Palm Springs", 33.83, -116.55)],
     # no launch: scored on its own terms (high desert-mountain lift: good days top out 8-14k ft, light wind aloft)
     "score": {"top_lo": 6000, "top_span": 7000, "climb_full": 2.5, "wind_key": "w10k", "wind_ok": 12}},
    {"id": "marshall", "name": "Marshall", "poly": [[34.36, -117.62], [34.36, -116.65], [34.05, -116.65], [34.05, -116.80], [33.95, -116.80], [33.95, -117.55], [34.05, -117.62]],
     "points": [("Marshall", 34.21, -117.30), ("Crestline", 34.24, -117.29), ("Cajon / Devore", 34.22, -117.40), ("Lytle Creek", 34.22, -117.48), ("Highland foothills", 34.15, -117.17), ("San Gorgonio slopes", 34.08, -116.90)]},
    {"id": "inland_empire", "name": "Inland Empire", "poly": [[33.95, -117.55], [33.95, -116.80], [33.45, -116.80], [33.45, -117.38], [33.55, -117.55]],
     "points": [("Elsinore", 33.63, -117.37), ("Perris", 33.78, -117.23), ("Soboba", 33.80, -116.96), ("Temecula", 33.49, -117.15), ("Menifee", 33.70, -117.18)]},
]
LEVELS = [950, 925, 850, 700, 600, 500]    # enough for the mixed-layer top; fewer variables keep the Open-Meteo budget
STD_HEIGHT_M = {1000: 110, 975: 320, 950: 540, 925: 760, 900: 990, 850: 1460, 800: 1950, 700: 3010, 600: 4210, 500: 5570}
SURFACE = ["temperature_2m", "dew_point_2m", "precipitation", "cape", "shortwave_radiation",
           "cloud_cover_low", "cloud_cover_mid", "cloud_cover_high",
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
SLOW = {"palomar", "desert", "palmsj"}   # no launch: every model only every REUSE_H (like the radar's trip areas)
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
            hourly = [v for v in hourly if v not in ("sensible_heat_flux", "boundary_layer_height")] \
                if attempt == 0 else [v for v in hourly if "geopotential" not in v]
    return None


def at(h, k, i):
    v = (h.get(k) or [None] * (i + 1))
    return v[i] if i < len(v) else None


# Per-region tuning (Regtherm-style), neutral unless flights say otherwise.
#   frac: share of the sunshine that heats the air when a model has no surface heat flux (radar: 0.40 inland, 0.30 coast)
#   heat: multiplies the heating (drier/barer ground > 1, irrigated or marine-cooled < 1)
#   climb_off: m/s added to the climb rate
TUNE_DEFAULT = {"frac": 0.40, "heat": 1.0, "climb_off": 0.0}
TUNE = {"coast": {"frac": 0.30}}


def tune(rid):
    return {**TUNE_DEFAULT, **TUNE.get(rid, {})}


# this morning's weather balloons: each region blends the closest one that flew today into today's mixing depth
# (the 6 model levels miss the inversions a sounding resolves); weight 0.5 at the station, fading to 0 at 300 km
SND_MAX_KM, SND_W0 = 300.0, 0.5


def parse_sounding(txt):
    import re
    pts, last = [], -1e9
    for line in txt.splitlines():
        nums = re.findall(r"-?\d+(?:\.\d+)?", line.replace(",", " "))
        if len(nums) < 3:
            continue
        p_, z, tc = float(nums[0]), float(nums[1]), float(nums[2])
        if not (100 <= p_ <= 1100) or tc < -150 or z < -100 or z <= last or z > 7000:
            continue
        pts.append((z, tc))
        last = z
    return pts if len(pts) > 10 else None


def load_soundings(today):
    """{station: (lat, lon, [(z_m, t_c)])} for every balloon launched this morning (12Z = 4-5 am local)."""
    base = os.path.join(os.path.dirname(__file__), "..", "..", "data", "sounding")
    out = {}
    try:
        with open(os.path.join(base, "stations.json")) as f:
            meta = json.load(f)
    except Exception:  # noqa: BLE001
        meta = {}
    for stn, m in meta.items():
        try:
            obs = dt.datetime.strptime(m["obs"], "%Y-%m-%dT%H:%MZ").replace(tzinfo=dt.timezone.utc)
            if obs.astimezone(__import__("zoneinfo").ZoneInfo(TZ)).date() != today:
                continue
            with open(os.path.join(base, m["file"])) as f:
                pts = parse_sounding(f.read())
            if pts:
                out[stn] = (m["lat"], m["lon"], pts)
        except Exception:  # noqa: BLE001
            continue
    return out


def km(la1, lo1, la2, lo2):
    x = (lo2 - lo1) * math.cos(math.radians((la1 + la2) / 2)) * 111.2
    return math.hypot(x, (la2 - la1) * 111.2)


def region_sounding(r, snds):
    """(profile, weight, station, km) of the closest balloon that flew today, or None."""
    la = sum(p[1] for p in r["points"]) / len(r["points"])
    lo = sum(p[2] for p in r["points"]) / len(r["points"])
    best = min(((km(la, lo, v[0], v[1]), k) for k, v in snds.items()), default=None)
    if not best or best[0] > SND_MAX_KM:
        return None
    d, k = best
    return snds[k][2], round(SND_W0 * (1 - d / SND_MAX_KM), 2), k, round(d)


def load_terrain():
    try:
        with open(os.path.join(OUT, "terrain.json")) as f:
            return json.load(f).get("regions", {})
    except Exception:  # noqa: BLE001
        return {}


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


def point_hour(h, i, elev_m, tn=None, snd=None):
    tn = tn or TUNE_DEFAULT
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
    if snd:                                   # this morning's observed profile resolves the inversion the 6 levels miss
        sp = [(z, t) for z, t in snd[0] if z > elev_m + 20]
        st = parcel_top(sp, t2, elev_m) if sp else None
        if st is not None:
            zi = (1 - snd[1]) * zi + snd[1] * max(0.0, st - elev_m)
    shf = at(h, "sensible_heat_flux", i)
    heat = clamp(abs(shf), 0.10 * sw, 0.60 * sw) if (shf is not None and sw > 50) else tn["frac"] * sw
    heat *= tn["heat"]
    wstar = (9.81 / (t2 + 273.15) * heat / 1200.0 * zi) ** (1 / 3) if zi > 0 and heat > 0 else 0.0
    wstar_h = (9.81 / (t2 + 273.15) * 0.30 * sw / 1200.0 * zi) ** (1 / 3) if zi > 0 and sw > 0 else 0.0
    usable = elev_m + zi * clamp(0.4 + 0.2 * (wstar_h - 1.0), 0.3, 0.8)
    base = elev_m + 125 * max(0.0, t2 - td) if td is not None else None
    cu = base is not None and base < elev_m + zi and sw > 100
    cape = at(h, "cape", i) or 0
    ctop = (base + min(2500.0, 300.0 + cape * 1.0)) if cu else None   # shallow cu, deeper with CAPE (m)
    if base is not None:
        usable = min(usable, base)
    climb = max(0.0, 1.4 * wstar - 1.1 + tn["climb_off"])
    return {"climb_off": tn["climb_off"], "t": t2, "td": td, "wstar": wstar, "climb": climb, "top": usable, "base": base, "cu": cu, "ctop": ctop,
            "zi": zi, "elev": elev_m, "cape": at(h, "cape", i) or 0, "rain": max(0.0, at(h, "precipitation", i) or 0),
            "rain_p": None,
            "cloud": max(at(h, "cloud_cover_low", i) or 0, at(h, "cloud_cover_mid", i) or 0, at(h, "cloud_cover_high", i) or 0),
            "cl_low": at(h, "cloud_cover_low", i),
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


GRID_FT = list(range(0, 16001, 500))   # key = band's lower edge; sampled mid-band, from sea level up


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
    return max(0.0, 1.4 * w - 1.1 + p.get("climb_off", 0.0))


def terrain_entries(ps, terr):
    """(probe, ground height m, area weight) for every 500 ft ground bucket each probe stands for.
    The mixed-layer top and cloud base stay at the probe's height above sea level; W* scales with the local depth."""
    out = []
    for p, tp in zip(ps, terr):
        if not p:
            continue
        for b, w in (tp.get("hist") or {}).items():
            e = (int(b) + 250) / FT
            top = p["elev"] + p["zi"]
            zi = max(0.0, top - e)
            ws = p["wstar"] * (zi / p["zi"]) ** (1 / 3) if p["zi"] > 0 and zi > 0 else 0.0
            out.append(({**p, "elev": e, "zi": zi, "wstar": ws}, e, w))
    return out


def region_grid(ps, terr=None):
    """Climb per 500 ft band. With terrain: every bit of ground lifts its own thermals (Regtherm-style
    area-elevation weighting); a band shows once 8% of the region's ground lies below it."""
    cells = {}
    ent = terrain_entries(ps, terr) if terr and len(terr) == len(ps) else None
    if not ent:
        ent = [(p, p["elev"], 1.0) for p in ps if p]
    tot = sum(w for _, _, w in ent) or 1.0
    for zft in GRID_FT:
        z = (zft + 250) / FT   # middle of the band zft..zft+500
        below = [(p, w) for p, e, w in ent if e < z]
        wb = sum(w for _, w in below)
        if not below or wb / tot < (0.08 if terr else 0.0):
            continue
        wc = sum(w for p, w in below if p["cu"] and p["base"] is not None and p["base"] <= z <= (p["ctop"] or p["base"]))
        if wc >= 0.4 * wb:
            cells[str(zft)] = "c"
            continue
        got = [(climb_at(p, z), w) for p, w in below]
        got = [(v, w) for v, w in got if v is not None]
        wg = sum(w for _, w in got)
        if wg >= 0.4 * wb:
            cells[str(zft)] = round(sum(v * w for v, w in got) / wg * 2) / 2
    return cells


def region_hour(ps, terr=None):
    grid = region_grid(ps, terr)
    wts = [sum((t.get("hist") or {}).values()) for p, t in zip(ps, terr) if p] if terr and len(terr) == len(ps) else None
    ps = [p for p in ps if p]
    if not ps:
        return None
    if not wts or sum(wts) <= 0:
        wts = [1.0] * len(ps)

    def M(xs):   # area-weighted region mean: a probe counts as much ground as it stands for
        pairs = [(x, w) for x, w in zip(xs, wts) if x is not None]
        sw_ = sum(w for _, w in pairs)
        return sum(x * w for x, w in pairs) / sw_ if pairs and sw_ > 0 else None

    cu_share = sum(1 for p in ps if p["cu"]) / len(ps)
    bases = [p["base"] for p in ps if p["cu"] and p["base"] is not None]
    sfc = vec_mean([(p["sfc"][0], p["sfc"][1]) for p in ps])
    gust = M([p["sfc"][2] for p in ps])
    return {
        "climb": round(M([p["climb"] for p in ps]), 1),
        "climb_max": round(max(p["climb"] for p in ps), 1),
        "wstar": round(M([p["wstar"] for p in ps]), 2),
        "top_ft": round(M([p["top"] for p in ps]) * FT / 100) * 100,
        "top_max_ft": round(max(p["top"] for p in ps) * FT / 100) * 100,
        "base_ft": round(mean(bases) * FT / 100) * 100 if bases else None,
        "cu": round(cu_share, 2),
        "t_f": round(M([p["t"] for p in ps]) * 9 / 5 + 32),
        "cloud": round(M([p["cloud"] for p in ps]) or 0),
        "cl_mh": round(M([p["cl_mh"] for p in ps]) or 0),
        "rain_mm": round(M([p["rain"] for p in ps]), 1),
        "rain_p": round(M([p["rain_p"] for p in ps])) if M([p["rain_p"] for p in ps]) is not None else None,
        "cape": round(M([p["cape"] for p in ps])),
        "sfc": [sfc[0], sfc[1], round(gust) if gust is not None else None],
        "w5k": list(vec_mean([p["w850"] for p in ps])),
        "w10k": list(vec_mean([p["w700"] for p in ps])),
        "okta": [round((M([p["cl_low"] for p in ps]) or 0) / 12.5),
                 round((M([at_mid(p) for p in ps]) or 0) / 12.5),
                 round((M([p["cl_high"] for p in ps]) or 0) / 12.5)],
        "grid": grid,
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


def build_days(data, idx, today, now_local, name, acc, gid=None, snd=None, terr=None):
    """acc[date][hour][model] = region_hour for the points at positions idx of a multi-point reply."""
    times = data[0]["hourly"]["time"]
    for i, t in enumerate(times):
        d, hh = t[:10], int(t[11:13])
        if hh not in HOURS:
            continue
        k = (dt.date.fromisoformat(d) - today).days
        if k < 0 or k > 6 or (k == 0 and now_local.hour >= 19):   # 7 days like the radar; after 7 pm today is over
            continue
        sk = snd if k == 0 else None
        ps = [point_hour(data[j]["hourly"], i, data[j].get("elevation") or 300, tune(gid), sk) for j in idx]
        rh = region_hour(ps, terr)
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


# quiet reference lines in the panel: the region's launches (from the radar's sites.json), or a peak where it has none
REGION_SITES = {"coast": ["torrey"], "north": ["lb"], "east": ["blossom"], "south": ["otay", "whalesv"], "mountains": ["lagunahorse"],
                "inland_empire": ["elsinore", "soboba"], "marshall": ["marshall"]}
REGION_PEAK = {"palomar": ("Palomar Mtn", 6140), "desert": ("Villager Pk", 5756), "palmsj": ("San Jacinto Pk", 10834)}


RSND, TERR, SND_USED = {}, {}, {}
ELEV = {}   # probe ground height (ft) from the model replies


SHORT = {"Little Black": "LB 300 launch", "Blossom Valley": "Blossom", "Otay Mesa": "Otay", "Lake Elsinore": "Elsinore", "Horse Canyon": "Horse"}


def terrain_floor(r):
    """Lowest band the panel shows: where 8% of the region's ground lies below (or the lowest probe)."""
    pr = (TERR.get(r["id"]) or {}).get("probes")
    if pr:
        h = {}
        for t in pr:
            for b, w in (t.get("hist") or {}).items():
                h[int(b)] = h.get(int(b), 0) + w
        acc = 0.0
        for b in sorted(h):
            acc += h[b]
            if acc >= 0.08:
                return b
    return int(min([ELEV[(la, lo)] for _, la, lo in r["points"] if ELEV.get((la, lo)) is not None] or [500]) // 500 * 500)


EXTRA_MARKS = {"north": [{"name": "LB tower", "ft": 1550}]}   # Black Mountain tower launch (summit ~1,554 ft)


def region_marks(rid):
    if rid in REGION_PEAK:
        n, ft = REGION_PEAK[rid]
        return [{"name": n, "ft": ft, "kind": "peak"}]
    try:
        with open(os.path.join(os.path.dirname(__file__), "..", "..", "sites.json")) as f:
            sj = json.load(f)
    except Exception:  # noqa: BLE001
        return []
    sites = sj.get("sites", sj) if isinstance(sj, dict) else sj
    out = []
    for site in sites:
        if site.get("id") not in REGION_SITES.get(rid, []):
            continue
        subs = [x for v in site.values() if isinstance(v, list) for x in v if isinstance(x, dict) and x.get("launch_ft") and x.get("name")]
        for x in (subs or [site]):
            out.append({"name": SHORT.get(x.get("short") or x["name"], x.get("short") or x["name"]), "ft": x["launch_ft"], "kind": "launch"})
    out += [dict(m, kind="launch") for m in EXTRA_MARKS.get(rid, [])]
    seen, uniq = set(), []
    for m in sorted(out, key=lambda m: (m["ft"], len(m["name"]))):
        if m["ft"] not in seen:
            seen.add(m["ft"]); uniq.append(m)
    return uniq


def main():
    os.makedirs(OUT, exist_ok=True)
    now_local = dt.datetime.now(dt.timezone.utc).astimezone(__import__("zoneinfo").ZoneInfo(TZ))
    today = now_local.date()
    groups = [(r["id"], r["points"]) for r in REGIONS]
    groups = [g for g in groups if g[0] not in SLOW] + [g for g in groups if g[0] in SLOW]   # fast regions first
    allpts, idx = [], {}
    for gid, pts in groups:
        idx[gid] = list(range(len(allpts), len(allpts) + len(pts)))
        allpts += pts
    acc = {gid: {} for gid, _ in groups}
    global RSND, TERR
    snds, TERR = load_soundings(today), load_terrain()
    RSND = {}
    for r in REGIONS:
        rs = region_sounding(r, snds)
        if rs:
            RSND[r["id"]] = rs[:2]
            SND_USED[r["id"]] = {"station": rs[2], "km": rs[3], "weight": rs[1]}
    print(f"balloons today: {sorted(snds) or 'none'}; per region: {SND_USED}; terrain: {len(TERR)} regions")
    models_used, debug = {}, {}
    cache_dir = os.path.join(os.path.dirname(__file__), "..", "..", "cache", "region")
    os.makedirs(cache_dir, exist_ok=True)
    fast = [p for gid, pts in groups if gid not in SLOW for p in pts]
    slow = [p for gid, pts in groups if gid in SLOW for p in pts]

    def get(name, ids, days, pts, tag, reuse):
        """Fetch one model for a set of points, or reuse a cached copy younger than REUSE_H (Open-Meteo budget)."""
        if not pts:
            return [], None
        cpath, key = os.path.join(cache_dir, f"{name}_{tag}.json"), ",".join(f"{la},{lo}" for _, la, lo in pts)
        if reuse:
            try:
                with open(cpath) as f:
                    c = json.load(f)
                if c.get("key") == key and time.time() - c["t"] < REUSE_H * 3600:
                    print(f"{name}/{tag}: reused ({(time.time() - c['t']) / 3600:.1f} h old)")
                    return c["data"], c["mid"]
            except Exception:  # noqa: BLE001
                pass
        for mid in ids:
            d = fetch(mid, days, pts)
            if d and len(d) == len(pts) and d[0].get("hourly", {}).get("temperature_2m"):
                with open(cpath, "w") as f:
                    json.dump({"t": time.time(), "mid": mid, "key": key, "data": d}, f)
                return d, mid
        return None, None

    for name, ids, days in MODELS:
        # global models: reused everywhere; HRRR/RRFS: every run for the main regions, every REUSE_H for the slow ones
        df, mid1 = get(name, ids, days, fast, "fast", name in GLOBAL)
        ds, mid2 = get(name, ids, days, slow, "slow", True)
        if df is None or ds is None:
            print(f"{name}: no data")
            continue
        data = df + ds
        for (_, la, lo), d in zip(fast + slow, data):
            if d.get("elevation") is not None and (la, lo) not in ELEV:
                ELEV[(la, lo)] = round(d["elevation"] * FT)
        models_used[name] = mid1 or mid2
        debug[name] = sorted(k for k, v in data[0]["hourly"].items() if any(x is not None for x in v))
        for gid, _ in groups:
            build_days(data, idx[gid], today, now_local, name, acc[gid], gid, RSND.get(gid), (TERR.get(gid) or {}).get("probes"))
    sps = {r["id"]: r.get("score") for r in REGIONS}
    by = {gid: blend_days(acc[gid], sps.get(gid)) for gid, _ in groups}
    gen = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%MZ")
    regs = []
    for r in REGIONS:
        regs.append({"id": r["id"], "name": r["name"], "title": r["name"].upper(), "poly": r["poly"], "own_score": bool(r.get("score")),
                     "points": [{"name": n, "lat": la, "lon": lo, "elev_ft": ELEV.get((la, lo))} for n, la, lo in r["points"]],
                     "floor_ft": terrain_floor(r) ,
                     "marks": region_marks(r["id"]),
                     "sounding": SND_USED.get(r["id"]),
                     "days": finish(by[r["id"]], today)})
        for dd in regs[-1]["days"]:
            print(r["id"], dd["date"], dd["model"], json.dumps(dd["summary"]))
    if not any(r["days"] for r in regs):
        print("no region data")
        return 1
    with open(os.path.join(OUT, "regions.json"), "w") as f:
        json.dump({"generated": gen, "models": models_used, "source": "https://open-meteo.com", "regions": regs}, f, separators=(",", ":"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
