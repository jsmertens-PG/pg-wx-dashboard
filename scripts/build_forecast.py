#!/usr/bin/env python3
"""Build data/forecast.json for the SoCal XC radar.

Pulls several weather models (HRRR, NAM, GFS, ECMWF, ICON) and three
ensembles (GFS, ECMWF, ICON) from Open-Meteo, plus the NWS San Diego
forecast discussion, then scores each launch site for each day.

Standard library only, so it runs on a bare GitHub Actions runner.

    python scripts/build_forecast.py            # live data
    python scripts/build_forecast.py --sample   # synthetic data, no network
"""
from __future__ import annotations

import argparse
import json
import math
import random
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from statistics import median

ROOT = Path(__file__).resolve().parent.parent
TZ = "America/Los_Angeles"
DAYS = 7
HOURS = range(9, 19)          # local hours considered for flying
WINDOW = 3                    # hours in the "best window"
FT = 3.28084
UA = "sd-xc-radar (personal paragliding forecast; github.com)"

# Open-Meteo model ids change occasionally, so each model lists fallbacks.
DET_MODELS = {
    "HRRR":  ["ncep_hrrr_conus", "gfs_hrrr"],
    "NAM":   ["ncep_nam_conus", "nam_conus"],
    "GFS":   ["gfs_global", "ncep_gfs025", "gfs025"],
    "ECMWF": ["ecmwf_ifs025", "ecmwf_ifs"],
    "ICON":  ["icon_global", "icon_seamless"],
}
ENS_MODELS = {
    "GFS ens":   ["gfs025", "ncep_gefs025", "gfs_seamless"],
    "ECMWF ens": ["ecmwf_ifs025"],
    "ICON ens":  ["icon_global", "icon_seamless"],
}
DET_LEVELS = [1000, 975, 950, 925, 900, 850, 800, 700, 600, 500]
ENS_LEVELS = [1000, 925, 850, 700, 500]
STD_HEIGHT_M = {1000: 110, 975: 320, 950: 540, 925: 760, 900: 990, 850: 1460,
                800: 1950, 700: 3010, 600: 4210, 500: 5570}

SURFACE_VARS = ["temperature_2m", "dew_point_2m", "precipitation", "cape",
                "cloud_cover", "wind_speed_10m", "wind_direction_10m", "wind_gusts_10m"]


# ---------------------------------------------------------------- fetching
def http_json(url: str, tries: int = 3) -> object:
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            if e.code == 400:      # bad model id or variable: don't retry
                raise
            last = e
        except Exception as e:     # network hiccup
            last = e
        time.sleep(2 * (i + 1))
    raise last  # type: ignore[misc]


def level_vars(levels):
    out = []
    for L in levels:
        out += [f"temperature_{L}hPa", f"wind_speed_{L}hPa", f"wind_direction_{L}hPa",
                f"geopotential_height_{L}hPa"]
    return out


def om_url(base, sites, model, hourly):
    q = {
        "latitude": ",".join(str(s["lat"]) for s in sites),
        "longitude": ",".join(str(s["lon"]) for s in sites),
        "hourly": ",".join(hourly),
        "models": model,
        "timezone": TZ,
        "forecast_days": DAYS,
        "wind_speed_unit": "kn",
    }
    return base + "?" + urllib.parse.urlencode(q)


def model_run_time(kind, mid):
    """Model initialisation time from Open-Meteo's per-model metadata, if available."""
    host = "api.open-meteo.com" if kind == "det" else "ensemble-api.open-meteo.com"
    try:
        meta = http_json(f"https://{host}/data/{mid}/static/meta.json", tries=1)
        t = meta.get("last_run_initialisation_time")
        return datetime.fromtimestamp(t, timezone.utc).isoformat(timespec="minutes") if t else None
    except Exception:
        return None


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="minutes")


def fetch_model(kind, name, ids, sites, log):
    """Return (model_id, [per-site hourly dict], source-info) — model_id None on failure."""
    if kind == "det":
        base, hourly = "https://api.open-meteo.com/v1/forecast", SURFACE_VARS + ["boundary_layer_height"] + level_vars(DET_LEVELS)
    else:
        base, hourly = "https://ensemble-api.open-meteo.com/v1/ensemble", SURFACE_VARS + level_vars(ENS_LEVELS)
    for mid in ids:
        for hv in (hourly, [v for v in hourly if v != "boundary_layer_height"]):
            try:
                data = http_json(om_url(base, sites, mid, hv))
                data = data if isinstance(data, list) else [data]
                log.append(f"{name}: ok ({mid})")
                info = {"name": name, "kind": "model" if kind == "det" else "ensemble",
                        "provider": "Open-Meteo", "id": mid, "status": "ok",
                        "run": model_run_time(kind, mid), "fetched": now_iso(),
                        "url": "https://open-meteo.com/en/docs" + ("" if kind == "det" else "/ensemble-api")}
                return mid, [d for d in data], info
            except urllib.error.HTTPError as e:
                log.append(f"{name}: {mid} rejected ({e.code})")
            except Exception as e:
                log.append(f"{name}: {mid} failed ({e})")
                break
    return None, None, {"name": name, "kind": "model" if kind == "det" else "ensemble",
                        "provider": "Open-Meteo", "id": ids[0], "status": "failed",
                        "run": None, "fetched": now_iso(), "url": "https://open-meteo.com/en/docs"}


def fetch_nws(log):
    try:
        lst = http_json("https://api.weather.gov/products/types/AFD/locations/SGX")
        pid = lst["@graph"][0]["id"]
        prod = http_json(f"https://api.weather.gov/products/{pid}")
        log.append("NWS AFD: ok")
        return parse_afd(prod.get("productText", ""), prod.get("issuanceTime"))
    except Exception as e:
        log.append(f"NWS AFD: failed ({e})")
        return None



# ---------------------------------------------------------------- NWS text
FLAG_PATTERNS = [
    ("Thunderstorms", r"thunderstorm|TSRA"),
    ("Wind advisory", r"wind advisory|high wind"),
    ("Offshore / Santa Ana", r"offshore|santa ana"),
    ("Red flag", r"red flag"),
    ("Showers", r"shower"),
    ("Marine layer", r"marine layer|low clouds and fog"),
]
# sentences about the weather systems: lows, troughs, ridges, fronts, flow
SYSTEM_PAT = re.compile(r"\b(upper[- ]level|upper low|low pressure|trough|ridge|high pressure|front\b|frontal|"
                        r"shortwave|short wave|closed low|offshore|onshore|santa ana|marine layer|"
                        r"northwest flow|westerly flow|southwest flow|flow aloft|flow will turn)", re.I)


def _section(text, name):
    m = re.search(r"\n\." + name + r"[^\n]*?\.\.\.(.*?)(?:\n&&|\n\.[A-Z][A-Z /]+\.\.\.)", text, re.S)
    return re.sub(r"\s+", " ", m.group(1)).strip() if m else ""


def _sentences(par):
    return [s.strip() for s in re.split(r"(?<=[.!?])\s+(?=[A-Z])", par) if s.strip()]


def parse_afd(text, issued):
    synopsis = _section(text, "SYNOPSIS")
    aviation = _section(text, "AVIATION")
    body = " ".join(_section(text, n) for n in ("SHORT TERM", "DISCUSSION", "LONG TERM"))
    systems, seen = [], set()
    for s in _sentences(body):
        if SYSTEM_PAT.search(s) and len(s) < 260 and s.lower() not in seen and not s.startswith("..."):
            systems.append(s)
            seen.add(s.lower())
        if len(systems) >= 4:
            break
    flags = [label for label, pat in FLAG_PATTERNS if re.search(pat, synopsis + " " + aviation, re.I)]
    adv = re.search(r"WATCHES/WARNINGS/ADVISORIES\.\.\.(.*?)\n\$\$", text, re.S)
    advisories = re.sub(r"\s+", " ", adv.group(1)).strip() if adv else ""
    if re.search(r"wind advisory|high wind", advisories, re.I) and "Wind advisory" not in flags:
        flags.append("Wind advisory")
    return {"issued": issued, "synopsis": synopsis, "systems": systems, "aviation": aviation[:900],
            "advisories": advisories, "flags": flags,
            "url": "https://forecast.weather.gov/product.php?site=SGX&issuedby=SGX&product=AFD"}


# ---------------------------------------------------------------- physics helpers
def wrap_in(d, lo, hi):
    d %= 360
    return lo <= d <= hi if lo <= hi else (d >= lo or d <= hi)


def angdiff(a, b):
    return abs((a - b + 180) % 360 - 180)


def compass(d):
    return ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"][int((d % 360) / 22.5 + 0.5) % 16]


def compass_word(d):
    return {"N": "north", "NE": "north-east", "E": "east", "SE": "south-east", "S": "south", "SW": "south-west",
            "W": "west", "NW": "north-west"}[["N", "NE", "E", "SE", "S", "SW", "W", "NW"][int((d % 360) / 45 + 0.5) % 8]]


def clamp(x, lo=0.0, hi=1.0):
    return max(lo, min(hi, x))


def _at(hr, key, i):
    v = hr.get(key)
    return v[i] if v is not None and i < len(v) else None


def profile(hr, i, levels, elev_m):
    """Sorted [(height_m, temp_C, wspd_kt, wdir)] from the surface up."""
    pts = []
    t2 = _at(hr, "temperature_2m", i)
    if t2 is not None:
        pts.append((elev_m + 2, t2, _at(hr, "wind_speed_10m", i), _at(hr, "wind_direction_10m", i)))
    for L in levels:
        t = _at(hr, f"temperature_{L}hPa", i)
        if t is None:
            continue
        z = _at(hr, f"geopotential_height_{L}hPa", i) or STD_HEIGHT_M[L]
        if z <= elev_m + 50:
            continue
        pts.append((z, t, _at(hr, f"wind_speed_{L}hPa", i), _at(hr, f"wind_direction_{L}hPa", i)))
    return sorted(pts)


def thermal_top_m(pts, t2, excess=1.0):
    """Height where a dry-adiabatic surface parcel (t2+excess) meets the environment."""
    if not pts or t2 is None:
        return None
    z0 = pts[0][0]
    prev = None
    for z, t, *_ in pts:
        parcel = t2 + excess - 0.0098 * (z - z0)
        diff = parcel - t
        if prev is not None and diff <= 0 < prev[1]:
            pz, pd = prev
            return pz + (z - pz) * pd / (pd - diff)
        prev = (z, diff)
    return pts[-1][0] if prev and prev[1] > 0 else z0


def _uv(s, d):
    return s * math.sin(math.radians(d)), s * math.cos(math.radians(d))


def interp_wind(pts, z):
    """Wind (kt, dir) at height z, linear between profile points."""
    good = [(pz, s, d) for pz, _t, s, d in pts if s is not None and d is not None]
    if not good:
        return None, None
    if z <= good[0][0]:
        return good[0][1], good[0][2]
    for (z1, s1, d1), (z2, s2, d2) in zip(good, good[1:]):
        if z1 <= z <= z2:
            f = (z - z1) / (z2 - z1)
            u1, v1 = _uv(s1, d1)
            u2, v2 = _uv(s2, d2)
            u, v = u1 + f * (u2 - u1), v1 + f * (v2 - v1)
            return math.hypot(u, v), (math.degrees(math.atan2(u, v)) + 360) % 360
    return good[-1][1], good[-1][2]


def layer_wind(pts, z_lo, z_hi):
    """(max speed, mean-vector speed, mean-vector dir) between two heights."""
    samples = [interp_wind(pts, z_lo + (z_hi - z_lo) * k / 4) for k in range(5)] if z_hi > z_lo else [interp_wind(pts, z_lo)]
    samples = [(s, d) for s, d in samples if s is not None and d is not None]
    if not samples:
        return None, None, None
    u = sum(_uv(s, d)[0] for s, d in samples) / len(samples)
    v = sum(_uv(s, d)[1] for s, d in samples) / len(samples)
    return max(s for s, _ in samples), math.hypot(u, v), (math.degrees(math.atan2(u, v)) + 360) % 360


# ---------------------------------------------------------------- scoring
REASON_TEXT = {
    "rain": "showers or storms", "showers": "showers nearby", "cape": "overdevelopment risk",
    "otb": "wind from behind launch", "windy": "too windy on launch", "strong": "strong on launch",
    "light": "too light to soar", "aloft": "strong wind aloft", "aloftdir": "wrong wind aloft",
    "lid": "low lid",
}


def score_hour(site, hr, i, levels, elev_m):
    """One hour, one model run. q = how good it is to be flying (0-1)."""
    t2 = _at(hr, "temperature_2m", i)
    if t2 is None:
        return None
    td = _at(hr, "dew_point_2m", i)
    pr = _at(hr, "precipitation", i) or 0.0
    cape = _at(hr, "cape", i) or 0.0
    pts = profile(hr, i, levels, elev_m)
    launch_m = site["launch_ft"] / FT
    top = thermal_top_m(pts, t2)
    blh = _at(hr, "boundary_layer_height", i)
    if blh is not None and top is not None:      # blend parcel top with the model's own mixing height
        top = 0.5 * top + 0.5 * (elev_m + blh)
    base = elev_m + 125 * max(0.0, t2 - td) if td is not None else None
    cands = [v for v in (top, base) if v is not None]
    usable = min(cands) if cands else None
    agl = (usable - launch_m) if usable is not None else None

    # launch wind: 10 m wind for low sites, profile wind for high launches
    if launch_m - elev_m > 250:
        lw, ld = interp_wind(pts, launch_m)
    else:
        lw, ld = _at(hr, "wind_speed_10m", i), _at(hr, "wind_direction_10m", i)
    lw_mph = lw * 1.15078 if lw is not None else None
    # wind through the lift band (launch to top of lift, at least 600 m above launch)
    z_hi = max(launch_m + 600, usable or 0)
    a_max, a_spd, a_dir = layer_wind(pts, launch_m + 150, z_hi)

    codes, q = [], 1.0
    # rain / convection
    if pr >= 1.0 or (cape >= 1000 and pr >= 0.3):
        q = 0.0; codes.append("rain")
    elif pr >= 0.3:
        q *= 0.6; codes.append("showers")
    elif pr >= 0.1:
        q *= 0.85; codes.append("showers")
    elif cape >= 2000:
        q *= 0.75; codes.append("cape")
    # launch wind
    lo, hi = site["wind_mph"]
    on = None
    if lw_mph is not None and ld is not None:
        on = wrap_in(ld, *site["dir"])
        if not on and lw_mph > 5:
            q = 0.0; codes.append("otb")
        elif lw_mph > hi + 5:
            q = 0.0; codes.append("windy")
        elif lw_mph > hi:
            q *= 0.5; codes.append("strong")
        elif lw_mph < lo and site["kind"] == "ridge":
            q *= 0.3; codes.append("light")
    # wind aloft: strength, and direction (north/east components kill most SoCal sites)
    if a_max is not None and a_max > site["aloft_max_kt"]:
        q *= clamp(1 - (a_max - site["aloft_max_kt"]) / 10)
        codes.append("aloft")
    if a_spd is not None and a_dir is not None and site.get("aloft_bad") and wrap_in(a_dir, *site["aloft_bad"]):
        if a_spd >= 6:
            q *= clamp(1 - (a_spd - 4) / 8) * 0.5
            codes.append("aloftdir")
    if site["kind"] == "convergence" and a_spd is not None and a_spd > 10:
        q *= clamp(1 - (a_spd - 10) / 10)          # synoptic wind blows the convergence line away
        codes.append("aloft")
    t700 = _at(hr, "temperature_700hPa", i)
    cold_aloft = t700 is not None and t700 <= 1.0
    # lift
    if site["kind"] != "ridge":
        lift = clamp(((agl or 0) - 250) / (1100 - 250)) if agl is not None else 0.3
        q *= 0.15 + 0.85 * lift
        if agl is not None and agl < 450:
            codes.append("lid")
    # XC strength this hour (0 = no XC)
    xc_s = 0.0
    t850 = _at(hr, "temperature_850hPa", i)
    # at the coast the marine layer caps thermals unless cold air aloft makes the air unstable
    coast_ok = site["kind"] != "ridge" or ((t850 is not None and t850 <= 9.0) or (t700 is not None and t700 <= 0.0))
    if site.get("xc_top_ft") and coast_ok and usable is not None and q >= 0.5 and pr < 0.3 and "aloftdir" not in codes:
        over = usable * FT - site["xc_top_ft"]
        if over >= 0:
            wind_f = 1.0 if a_max is None or a_max <= site["aloft_max_kt"] - 3 else 0.8
            xc_s = (0.35 + 0.65 * clamp(over / site.get("xc_span_ft", 2500))) * wind_f
    # glass-off: smooth onshore flow on launch, no rain, nothing strong aloft
    glass = (on is True and lw_mph is not None and 3 <= lw_mph <= 13 and pr < 0.05 and cape < 500
             and "aloftdir" not in codes and (a_max is None or a_max <= site["aloft_max_kt"]))
    return {"q": q, "xc_s": xc_s, "glass": glass, "cold": cold_aloft, "top": top, "base": base, "usable": usable, "agl": agl,
            "lw": lw_mph, "ld": ld, "a_max": a_max, "a_spd": a_spd, "a_dir": a_dir,
            "pr": pr, "cape": cape, "cloud": _at(hr, "cloud_cover", i), "codes": codes}


def best_block(hours, n, key):
    """(mean, start_index) of the best n-hour block by key, preferring early afternoon on ties."""
    best, start = -1.0, 0
    for k in range(len(hours) - n + 1):
        m = sum(s[key] for _, s in hours[k:k + n]) / n - 0.002 * abs(hours[k][0] + n / 2 - 13.5)
        if m > best:
            best, start = m, k
    return max(0.0, best), start


def assess_day(site, hr, idxs, levels, elev_m):
    """Rate one day for one model run on the 0-10 scale."""
    hours = [(h, score_hour(site, hr, i, levels, elev_m)) for h, i in idxs]
    hours = [(h, s) for h, s in hours if s is not None]
    if len(hours) < WINDOW:
        return None
    local, k = best_block(hours, WINDOW, "q")
    blk = [s for _, s in hours[k:k + WINDOW]]
    # XC: best 4-hour block with at least 3 XC hours
    xc_day, xk = 0.0, 0
    if len(hours) >= 4:
        xc_day, xk = best_block(hours, 4, "xc_s")
        if sum(1 for _, s in hours[xk:xk + 4] if s["xc_s"] > 0) < 3:
            xc_day = 0.0
    late = [(h, s) for h, s in hours if h >= 16]
    glass_hours = [h for h, s in late if s["glass"]]
    glass_ok = len(late) >= 2 and len(glass_hours) >= 2
    early_rain = sum(s["pr"] for h, s in hours if h <= 11)
    window_rain = sum(s["pr"] for s in blk)
    cold = sum(1 for s in blk if s["cold"]) >= 2
    postfrontal = (early_rain >= 0.3 or cold) and window_rain < 0.3 and local >= 0.45

    xc_hours = sum(1 for _, s in hours if s["xc_s"] > 0)
    rating = 5.0 * local                              # a good local day tops out at 5
    if xc_day > 0:                                    # XC days: ~6 short/low, 7-8 solid, 9 big
        rating = max(rating, 5.0 + 4.0 * xc_day * clamp(xc_hours / 5))
        rating = max(rating, 5.8)
    if glass_ok and rating < 3.8:
        rating = 3.8                                  # a reliable evening glass-off is a nice day
    lift_agl = median([s["agl"] for s in blk if s["agl"] is not None] or [0])

    if xc_day > 0:
        label = "Thermal day" if site["kind"] == "ridge" else "XC"
    elif glass_ok and site["kind"] != "ridge" and (rating <= 3.9 or lift_agl < 500 or hours[k][0] >= 15):
        label = "Glass-off"
    elif site["kind"] == "ridge" and local >= 0.5:
        label = "Ridge soaring"
    elif rating >= 3.5:
        label = "Thermal"
    elif rating >= 2:
        label = "Marginal"
    else:
        label = "No go"
    codes = {}
    for s in (blk if local >= 0.25 else [s for _, s in hours]):
        for c in s["codes"]:
            codes[c] = codes.get(c, 0) + 1
    prio = ["rain", "otb", "windy", "aloftdir", "aloft", "lid", "strong", "light", "showers", "cape"]
    codes = sorted(codes, key=lambda c: (-(codes[c] >= 2), prio.index(c) if c in prio else 99))

    def med(key, block=blk):
        v = [s[key] for s in block if s[key] is not None]
        return median(v) if v else None
    xblk = [s for _, s in hours[xk:xk + 4]]
    # mean drift through the lift band during the window that matters
    drift_blk = xblk if xc_day > 0 else blk
    du = [_uv(s["a_spd"], s["a_dir"]) for s in drift_blk if s["a_spd"] is not None and s["a_dir"] is not None]
    a_spd = a_dir = None
    if du:
        u, v = sum(x for x, _ in du) / len(du), sum(y for _, y in du) / len(du)
        a_spd, a_dir = math.hypot(u, v), (math.degrees(math.atan2(u, v)) + 360) % 360
    return {
        "rating": rating, "local": local, "xc_day": xc_day, "label": label, "codes": codes,
        "postfrontal": postfrontal, "glass": glass_ok, "glass_hours": glass_hours,
        "start": hours[k][0], "xc_start": hours[xk][0] if xc_day > 0 else None,
        "top": med("usable", xblk if xc_day > 0 else blk), "base": med("base"), "lw": med("lw"), "ld": med("ld"),
        "a_max": med("a_max"), "a_spd": a_spd, "a_dir": a_dir,
        "pr": sum(s["pr"] for _, s in hours), "cape": max(s["cape"] for _, s in hours), "cloud": med("cloud"),
        "hourly": [{"h": h, "q": round(s["q"], 2), "xc": s["xc_s"] > 0, "glass": s["glass"],
                    "top_ft": round(s["usable"] * FT) if s["usable"] else None,
                    "lw": round(s["lw"]) if s["lw"] is not None else None,
                    "ld": round(s["ld"]) if s["ld"] is not None else None,
                    "pr": round(s["pr"], 1)} for h, s in hours],
    }


def route_note(site, a):
    """Where to go on an XC day, from the drift through the lift band."""
    routes, blocked = site.get("routes", []), site.get("blocked", [])
    spd, frm = a.get("a_spd"), a.get("a_dir")
    if spd is None or frm is None or not routes:
        return "XC"
    if spd < 5:
        return f"light drift: triangle or out-and-return, {routes[0]['text'].split(' to ')[0].split(' toward ')[0]} first"
    to = (frm + 180) % 360
    for b in blocked:
        if wrap_in(to, b["from"], b["to"]):
            alt = min(routes, key=lambda r: angdiff(r["to"], to))
            return f"drift {compass_word(to)} into {b['why']}: go crosswind {alt['text']}"
    best = min(routes, key=lambda r: angdiff(r["to"], to))
    if angdiff(best["to"], to) <= 60:
        return f"downwind {best['text']}"
    return f"drift {compass_word(to)}: crosswind {best['text']}"


def note_for(site, a, xc):
    if a is None:
        return "no data"
    if xc and site["kind"] == "ridge":
        top = f"{round(a['top'] * FT / 100) * 100:,} ft" if a.get("top") else "well above the cliffs"
        wind = f", {compass(a['ld'])} {round(a['lw'])} mph" if a.get("lw") is not None and a.get("ld") is not None else ""
        return f"cold air aloft, thermals to about {top}{wind}"
    if xc:
        return route_note(site, a)
    if a["label"] == "Glass-off":
        g = a["glass_hours"]
        return f"evening glass-off {g[0] - 12}–{g[-1] - 11} pm" if g else "evening glass-off"
    why = [REASON_TEXT[c] for c in a["codes"] if c in REASON_TEXT]
    if a["codes"] and a["codes"][0] == "aloftdir" and a["a_dir"] is not None:
        why[0] = f"{compass(a['a_dir'])} wind aloft"
    if a["codes"] and a["codes"][0] == "lid" and a["top"] is not None:
        why[0] = f"low lid, {round(a['top'] * FT / 100) * 100:,} ft"
    if a["label"] in ("Thermal", "Ridge soaring"):
        bits = []
        if site["kind"] != "ridge" and a["top"] is not None:
            bits.append(f"local, lift to {round(a['top'] * FT / 100) * 100:,} ft")
        if site["kind"] == "ridge" and a["lw"] is not None and a["ld"] is not None:
            bits.append(f"{compass(a['ld'])} {round(a['lw'])} mph")
        bits.append(f"best {fmt_h(a['start'])}–{fmt_h(a['start'] + WINDOW)}")
        if a["glass"] and site["kind"] != "ridge":
            bits.append("glass-off later")
        return ", ".join(bits)
    return why[0] if why else "not flyable"


def fmt_h(h):
    return f"{h - 12 if h > 12 else h}{'pm' if h >= 12 else 'am'}"


# ---------------------------------------------------------------- per-model plumbing
def day_index(hr):
    out = {}
    for i, ts in enumerate(hr.get("time", [])):
        dt = datetime.fromisoformat(ts)
        if dt.hour in HOURS:
            out.setdefault(dt.date().isoformat(), []).append((dt.hour, i))
    return out


def member_series(hr):
    members = {"control": {}}
    for k, v in hr.items():
        m = re.match(r"(.+)_member(\d+)$", k)
        if m:
            members.setdefault(m.group(2), {})[m.group(1)] = v
        else:
            members["control"][k] = v
    for mem in members.values():
        mem.setdefault("time", hr.get("time", []))
    return [m for m in members.values() if "temperature_2m" in m]


def build(sites, det, ens, nws, log, sample=False, sources=None):
    days = {}
    for name, (mid, data, *_i) in det.items():
        if not data:
            continue
        for s, d in zip(sites, data):
            hr, elev = d.get("hourly", {}), d.get("elevation", 0) or 0
            for dstr, idxs in day_index(hr).items():
                a = assess_day(s, hr, idxs, DET_LEVELS, elev)
                if a:
                    days.setdefault(dstr, {}).setdefault(s["id"], {"det": {}, "ens": []})["det"][name] = a
    for name, (mid, data, *_i) in ens.items():
        if not data:
            continue
        for s, d in zip(sites, data):
            hr, elev = d.get("hourly", {}), d.get("elevation", 0) or 0
            for mem in member_series(hr):
                for dstr, idxs in day_index(mem).items():
                    a = assess_day(s, mem, idxs, ENS_LEVELS, elev)
                    if a:
                        days.setdefault(dstr, {}).setdefault(s["id"], {"det": {}, "ens": []})["ens"].append(a)

    out_days = []
    for dstr in sorted(days)[:DAYS]:
        drow = {"date": dstr, "sites": {}}
        for s in sites:
            cell = days[dstr].get(s["id"])
            if not cell or (not cell["det"] and not cell["ens"]):
                continue
            det_r = {k: v["rating"] for k, v in cell["det"].items()}
            runs = list(cell["det"].values()) + cell["ens"]
            parts = []
            if det_r:
                parts.append(median(det_r.values()))
            if cell["ens"]:
                parts.append(sum(a["rating"] for a in cell["ens"]) / len(cell["ens"]))
            rating = sum(parts) / len(parts)
            pool = cell["ens"] or list(cell["det"].values())
            p_fly = sum(a["rating"] >= 3.5 for a in pool) / len(pool)
            p_xc = sum(a["xc_day"] > 0 for a in pool) / len(pool)
            det_xc = sum(a["xc_day"] > 0 for a in cell["det"].values()) / max(1, len(cell["det"]))
            xc = bool(s.get("xc_top_ft")) and rating >= 6.0 and p_xc >= 0.4 and det_xc >= 0.4
            # detail model: highest resolution one that agrees with the blend, else the closest
            order = [m for m in ("HRRR", "NAM", "ECMWF", "GFS", "ICON") if m in cell["det"]]
            close = [m for m in order if abs(det_r[m] - rating) <= 1.0]
            lead_name = close[0] if close else (min(order, key=lambda m: abs(det_r[m] - rating)) if order else None)
            lead = cell["det"].get(lead_name) if lead_name else None
            label = lead["label"] if lead else "–"
            xc_label = "Thermal day" if s["kind"] == "ridge" else "XC"
            if label in ("XC", "Thermal day") and not xc:
                label = ("Ridge soaring" if s["kind"] == "ridge" else "Thermal") if rating >= 3.5 else "Marginal"
            if xc:
                label = xc_label
            if rating < 2 and label not in ("No go",):
                label = "No go"
            tags = []
            if lead and lead["postfrontal"]:
                tags.append("post-frontal")
            if lead and lead["glass"] and label in ("Thermal", "Marginal") and s["kind"] != "ridge":
                tags.append("glass-off")
            spread = (max(det_r.values()) - min(det_r.values())) if len(det_r) > 1 else 0
            lead_for_note = dict(lead, label=label) if lead else None
            drow["sites"][s["id"]] = {
                "rating": round(rating, 1), "label": label, "tags": tags, "xc": xc,
                "note": note_for(s, lead_for_note, xc),
                "p_fly": round(p_fly, 2), "p_xc": round(p_xc, 2),
                "agree": "split" if spread >= 3 else ("mixed" if spread >= 1.5 else "agree"),
                "models": {k: round(v, 1) for k, v in det_r.items()},
                "n_members": len(cell["ens"]), "lead": lead_name,
                "window": f"{fmt_h(lead['start'])}–{fmt_h(lead['start'] + WINDOW)}" if lead else None,
                "top_ft": round(lead["top"] * FT, -2) if lead and lead["top"] else None,
                "base_ft": round(lead["base"] * FT, -2) if lead and lead["base"] else None,
                "wind": f"{compass(lead['ld'])} {round(lead['lw'])}" if lead and lead["lw"] is not None and lead["ld"] is not None else None,
                "aloft": f"{compass(lead['a_dir'])} {round(lead['a_spd'])}" if lead and lead["a_spd"] is not None else None,
                "aloft_max_kt": round(lead["a_max"]) if lead and lead["a_max"] is not None else None,
                "rain_mm": round(lead["pr"], 1) if lead else None,
                "cape": round(lead["cape"]) if lead else None,
                "hourly": lead["hourly"] if lead else [],
            }
        if drow["sites"]:
            main = [k for k in drow["sites"] if next(x for x in sites if x["id"] == k).get("tier") == "main"] or list(drow["sites"])
            drow["best"] = max(drow["sites"], key=lambda k: drow["sites"][k]["rating"])
            drow["best_main"] = max(main, key=lambda k: drow["sites"][k]["rating"])
            drow["headline"] = headline(sites, drow)
            out_days.append(drow)

    return {
        "generated": now_iso(), "sample": sample,
        "models": {k: v[0] for k, v in det.items() if v[0]},
        "ensembles": {k: v[0] for k, v in ens.items() if v[0]},
        "log": log, "sources": sources or [], "nws": nws,
        "sites": [{k: s.get(k) for k in ("id", "name", "short", "tier", "launch_ft", "kind", "xc_top_ft", "note")} for s in sites],
        "days": out_days,
    }


def headline(sites, d):
    """One sentence for the day, led by the main sites (LB, Blossom, Elsinore)."""
    by = {s["id"]: s for s in sites}
    cells = d["sites"]
    main = [s["id"] for s in sites if s.get("tier") == "main" and s["id"] in cells]
    xc = sorted([k for k in cells if cells[k]["xc"] and by[k]["kind"] != "ridge"], key=lambda k: -cells[k]["rating"])
    ridge_xc = [k for k in cells if cells[k]["xc"] and by[k]["kind"] == "ridge"]
    special = "".join(f" {by[k]['short']} thermal day: {cells[k]['note']}." for k in ridge_xc)
    if xc:
        k = next((m for m in xc if m in main), xc[0])
        others = [by[x]["short"] for x in xc if x != k]
        return (f"XC day. {by[k]['short']} {cells[k]['rating']:.1f}: {cells[k]['note']}"
                + (f". Also XC: {', '.join(others)}" if others else "") + "." + special)
    good = [k for k in main if cells[k]["rating"] >= 3.5]
    tail = special
    if "torrey" in cells and cells["torrey"]["rating"] >= 3.5 and not ridge_xc:
        tail = f" Torrey: {cells['torrey']['note']}."
    if good:
        parts = [f"{by[k]['short']} {cells[k]['note']}" if cells[k]["label"] == "Glass-off"
                 else f"{by[k]['short']} {cells[k]['label'].lower()} ({cells[k]['note']})" for k in good]
        return "Local day. " + "; ".join(parts) + "." + tail
    if main:
        k = max(main, key=lambda m: cells[m]["rating"])
        return f"Poor at the main sites ({cells[k]['note']})." + tail
    return "No data."


# ---------------------------------------------------------------- sample data
def sample_response(sites, levels, members=0, horizon_h=DAYS * 24, seed=1):
    """Synthetic Open-Meteo-shaped responses, for building/testing offline."""
    rnd = random.Random(seed)
    start = datetime.combine(date.today(), datetime.min.time())
    times = [(start + timedelta(hours=h)).strftime("%Y-%m-%dT%H:%M") for h in range(DAYS * 24)]
    # day regimes: 0 showery post-frontal, 1 post-frontal good, 2 offshore lid, 3 weak ridge, 4 good, 5 windy, 6 good
    regimes = ["showery", "postfrontal", "offshore", "ridge", "good", "windy", "glassoff"]
    out = []
    for si, s in enumerate(sites):
        elev = s["launch_ft"] / FT * rnd.uniform(0.5, 0.9)
        hourly = {"time": times}
        def series(fn):
            return [None if h >= horizon_h else fn(h) for h in range(len(times))]
        def reg(h):
            return regimes[(h // 24) % 7]
        def diurnal(h):
            return max(0.0, math.sin(math.pi * ((h % 24) - 7) / 12)) if 7 <= h % 24 <= 19 else 0.0
        def mem_noise():
            return rnd.gauss(0, 1.0)
        variants = [None] + list(range(1, members + 1)) if members else [None]
        for m in variants:
            sfx = "" if m is None else f"_member{m:02d}"
            off = {r: rnd.gauss(0, 1.2) for r in regimes}
            def t2(h, off=off):
                base = {"showery": 17, "postfrontal": 19, "offshore": 23, "ridge": 26, "good": 22, "windy": 18, "glassoff": 24}[reg(h)]
                return base + off[reg(h)] + 7 * diurnal(h) - 2.5 * (s["launch_ft"] > 3000)
            hourly["temperature_2m" + sfx] = series(lambda h: round(t2(h), 1))
            hourly["dew_point_2m" + sfx] = series(lambda h: round({"showery": 15, "postfrontal": 11, "offshore": 3, "ridge": 12, "good": 9, "windy": 8, "glassoff": 13}[reg(h)] + off[reg(h)] * 0.5, 1))
            hourly["precipitation" + sfx] = series(lambda h: round(max(0, rnd.gauss(0.8, 0.5) if reg(h) == "showery" and h % 24 < 12 else (rnd.gauss(0.1, 0.25) if reg(h) == "showery" else 0)), 1))
            hourly["cape" + sfx] = series(lambda h: round(max(0, {"showery": 600, "postfrontal": 300}.get(reg(h), 50) * diurnal(h) + rnd.gauss(0, 80))))
            hourly["cloud_cover" + sfx] = series(lambda h: {"showery": 85, "postfrontal": 40, "offshore": 5, "ridge": 10, "good": 25, "windy": 30, "glassoff": 5}[reg(h)])
            def sfc_dir(h):
                if reg(h) == "offshore" and (h % 24) < 13:
                    return 50
                return 270 if s["id"] != "elsinore" else (90 if diurnal(h) > 0.3 else 270)
            hourly["wind_speed_10m" + sfx] = series(lambda h: round({"windy": 14, "offshore": 8}.get(reg(h), 6) * (0.5 + diurnal(h)) + rnd.gauss(0, 1), 1))
            hourly["wind_direction_10m" + sfx] = series(lambda h: sfc_dir(h) + rnd.gauss(0, 10))
            hourly["wind_gusts_10m" + sfx] = series(lambda h: 15)
            if not members:
                hourly["boundary_layer_height"] = series(lambda h: round(({"showery": 700, "postfrontal": 1400, "offshore": 350, "ridge": 450, "good": 1300, "windy": 900, "glassoff": 300}[reg(h)]) * diurnal(h) + 100))
            for L in levels:
                z = STD_HEIGHT_M[L]
                lapse = {"showery": 7.5, "postfrontal": 8.5, "offshore": 3.0, "ridge": 4.0, "good": 7.8, "windy": 7.0, "glassoff": 3.0}
                inv = {"offshore": 600, "ridge": 700, "glassoff": 450}
                def tl(h, z=z):
                    t0 = t2(h) - 3 * diurnal(h)
                    r = reg(h)
                    zz = z - 100
                    t = t0 - lapse[r] / 1000 * zz
                    if r in inv and zz > inv[r]:
                        t += 4
                    return round(t, 1)
                hourly[f"temperature_{L}hPa{sfx}"] = series(tl)
                hourly[f"wind_speed_{L}hPa{sfx}"] = series(lambda h, z=z: round({"windy": 25, "offshore": 15}.get(reg(h), 9) * (0.6 + z / 5000) + rnd.gauss(0, 2), 1))
                hourly[f"wind_direction_{L}hPa{sfx}"] = series(lambda h: {"offshore": 40, "postfrontal": 300, "showery": 230}.get(reg(h), 280))
                hourly[f"geopotential_height_{L}hPa{sfx}"] = series(lambda h, z=z: z)
        out.append({"latitude": s["lat"], "longitude": s["lon"], "elevation": round(elev), "hourly": hourly})
    return out


def sample_sources(det, ens):
    t = now_iso()
    run = (datetime.now(timezone.utc) - timedelta(hours=3)).replace(minute=0).isoformat(timespec="minutes")
    out = [{"name": n, "kind": "model", "provider": "Open-Meteo (sample)", "id": n.lower(), "status": "sample",
            "run": run, "fetched": t, "url": "https://open-meteo.com/en/docs"} for n in det]
    out += [{"name": n, "kind": "ensemble", "provider": "Open-Meteo (sample)", "id": n.lower(), "status": "sample",
             "run": run, "fetched": t, "url": "https://open-meteo.com/en/docs/ensemble-api"} for n in ens]
    out.append({"name": "NWS San Diego forecast discussion", "kind": "text", "provider": "NWS (sample)", "id": "AFD SGX",
                "status": "sample", "run": run, "fetched": t,
                "url": "https://forecast.weather.gov/product.php?site=SGX&issuedby=SGX&product=AFD"})
    return out


def sample_nws():
    return {"issued": datetime.now(timezone.utc).isoformat(timespec="minutes"),
            "synopsis": "SAMPLE TEXT. Showers and a slight chance of thunderstorms through Friday morning, ending from the northwest. Dry and warmer for the weekend with weak offshore flow Saturday morning.",
            "systems": ["SAMPLE. The upper low near Point Conception moves northeast into Nevada this evening.",
                        "SAMPLE. A shortwave on its west side develops into a closed low over southern California late Friday.",
                        "SAMPLE. Offshore flow Saturday with north to northeast winds in the mornings; weakening Sunday."],
            "aviation": "SAMPLE. SCT SHRA and isolated TSRA decreasing after 15Z. Bases 3500-4500 ft MSL.",
            "advisories": "CA...None.", "flags": ["Showers", "Thunderstorms", "Offshore / Santa Ana"],
            "url": "https://forecast.weather.gov/product.php?site=SGX&issuedby=SGX&product=AFD"}


# ---------------------------------------------------------------- main
def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--sample", action="store_true", help="synthetic data, no network")
    ap.add_argument("--out", default=str(ROOT / "data" / "forecast.json"))
    args = ap.parse_args(argv)
    sites = json.loads((ROOT / "sites.json").read_text())["sites"]
    log = []
    if args.sample:
        det = {"HRRR": ("sample", sample_response(sites, DET_LEVELS, horizon_h=48, seed=1), None),
               "NAM": ("sample", sample_response(sites, DET_LEVELS, horizon_h=60, seed=2), None),
               "GFS": ("sample", sample_response(sites, DET_LEVELS, seed=3), None),
               "ECMWF": ("sample", sample_response(sites, DET_LEVELS, seed=4), None),
               "ICON": ("sample", sample_response(sites, DET_LEVELS, seed=5), None)}
        ens = {"GFS ens": ("sample", sample_response(sites, ENS_LEVELS, members=10, seed=6), None),
               "ECMWF ens": ("sample", sample_response(sites, ENS_LEVELS, members=10, seed=7), None)}
        nws = sample_nws()
        log.append("sample data")
        sources = sample_sources(det, ens)
    else:
        det = {n: fetch_model("det", n, ids, sites, log) for n, ids in DET_MODELS.items()}
        ens = {n: fetch_model("ens", n, ids, sites, log) for n, ids in ENS_MODELS.items()}
        nws = fetch_nws(log)
        sources = [v[2] for v in det.values()] + [v[2] for v in ens.values()]
        sources.append({"name": "NWS San Diego forecast discussion", "kind": "text", "provider": "NWS",
                        "id": "AFD SGX", "status": "ok" if nws else "failed",
                        "run": nws.get("issued") if nws else None, "fetched": now_iso(),
                        "url": "https://forecast.weather.gov/product.php?site=SGX&issuedby=SGX&product=AFD"})
        if not any(v[1] for v in det.values()):
            print("\n".join(log), file=sys.stderr)
            sys.exit("No model data retrieved; keeping the previous forecast.json")
    result = build(sites, det, ens, nws, log, sample=args.sample, sources=sources)
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(result, indent=1))
    print("\n".join(log))
    print(f"wrote {args.out}: {len(result['days'])} days")


if __name__ == "__main__":
    main()
