"""Fetch the latest NKX (San Diego) radiosonde and save it as text.

Tries the University of Wyoming (TEXT:LIST), then Iowa Mesonet CSV, then SPC.
Writes data/sounding/nkx_latest.txt and an archive copy per launch.
Standard library only.
"""
import datetime as dt
import html
import json
import os
import re
import sys
import urllib.request
from zoneinfo import ZoneInfo

STN, WMO = "NKX", "72293"
OUT = os.path.join(os.path.dirname(__file__), "..", "..", "data", "sounding")
UA = {"User-Agent": "socal-flying-radar sounding fetch (github actions)"}


def get(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=40) as r:
        return r.read().decode("utf-8", "replace")


def cycles(now):
    """Latest two 00Z/12Z launches whose data should be posted (>= 70 min old)."""
    t = now - dt.timedelta(minutes=70)
    c = t.replace(hour=12 if t.hour >= 12 else 0, minute=0, second=0, microsecond=0)
    return [c, c - dt.timedelta(hours=12)]


def from_uwyo(c):
    url = ("https://weather.uwyo.edu/wsgi/sounding?datetime="
           f"{c:%Y-%m-%d}%20{c:%H}:00:00&id={WMO}&type=TEXT:LIST&src=UNKNOWN")
    raw = get(url)
    text = html.unescape(re.sub(r"<[^>]+>", "", raw))
    if "HGHT" not in text or "TEMP" not in text:
        raise ValueError("no table")
    if "Observations at" not in text:
        text = f"{WMO} {STN} San Diego Observations at {c:%H}Z {c:%d %b %Y}\n" + text
    return text, url


def from_iem(c):
    url = ("https://mesonet.agron.iastate.edu/cgi-bin/request/raob.py?"
           f"station=K{STN}&sts={c:%Y-%m-%dT%H}:00Z&ets={c:%Y-%m-%dT%H}:59Z")
    text = get(url)
    if text.count("\n") < 10:
        raise ValueError("empty")
    return text, url


def from_spc(c):
    url = f"https://www.spc.noaa.gov/exper/soundings/{c:%y%m%d%H}_OBS/{STN}.txt"
    text = get(url)
    if "%RAW%" not in text:
        raise ValueError("no RAW block")
    return text, url


def count_levels(text):
    return sum(1 for L in text.splitlines() if re.match(r"\s*-?\d", L))


def main():
    now = dt.datetime.now(dt.timezone.utc)
    os.makedirs(OUT, exist_ok=True)
    for c in cycles(now):
        for fn in (from_uwyo, from_iem, from_spc):
            try:
                text, url = fn(c)
                if count_levels(text) < 10:
                    raise ValueError("too few levels")
            except Exception as e:  # noqa: BLE001
                print(f"{fn.__name__} {c:%Y-%m-%d %HZ}: {e}")
                continue
            header = f"# source: {url}\n# fetched: {now:%Y-%m-%dT%H:%MZ}\n"
            for name in ("nkx_latest.txt", f"nkx_{c:%Y%m%d_%H}Z.txt"):
                with open(os.path.join(OUT, name), "w") as f:
                    f.write(header + text)
            print(f"saved {c:%Y-%m-%d %HZ} from {fn.__name__}")
            return 0
    print("no sounding found")
    return 1


# ---------- forecast surface high (for the highlighted thermal + confidence band) ----------
LAT, LON = 32.85, -117.12          # NKX / MCAS Miramar
TZ = "America/Los_Angeles"
ENS = {"GFS ens": ["gfs025", "gfs_seamless"], "ECMWF ens": ["ecmwf_ifs025"], "ICON ens": ["icon_global", "icon_seamless"]}
DET = {"HRRR": ["ncep_hrrr_conus", "gfs_hrrr"]}


def om(base, model):
    return (f"{base}?latitude={LAT}&longitude={LON}&hourly=temperature_2m&models={model}"
            f"&temperature_unit=fahrenheit&timezone={TZ.replace('/', '%2F')}&forecast_days=3")


def day_max(hourly, day):
    """Afternoon (10:00-17:00 local) maximum of every temperature_2m series in an Open-Meteo reply."""
    times = hourly.get("time", [])
    idx = [i for i, t in enumerate(times) if t.startswith(day) and 10 <= int(t[11:13]) <= 17]
    out = []
    for k, v in hourly.items():
        if not k.startswith("temperature_2m"):
            continue
        vals = [v[i] for i in idx if i < len(v) and v[i] is not None]
        if len(vals) >= 5:
            out.append(max(vals))
    return out


def pct(xs, q):
    xs = sorted(xs)
    i = (len(xs) - 1) * q
    lo, hi = int(i), min(int(i) + 1, len(xs) - 1)
    return xs[lo] + (xs[hi] - xs[lo]) * (i - lo)


def fetch_surface_forecast():
    now = dt.datetime.now(ZoneInfo(TZ))
    day = now.date() if now.hour < 14 else now.date() + dt.timedelta(days=1)
    d = day.isoformat()
    members, models, hrrr = [], [], None
    for name, ids in ENS.items():
        for mid in ids:
            try:
                h = json.loads(get(om("https://ensemble-api.open-meteo.com/v1/ensemble", mid)))["hourly"]
                m = day_max(h, d)
                if m:
                    members += m
                    models.append(f"{name} ({len(m)})")
                    break
            except Exception as e:  # noqa: BLE001
                print(f"forecast {name} {mid}: {e}")
    for name, ids in DET.items():
        for mid in ids:
            try:
                m = day_max(json.loads(get(om("https://api.open-meteo.com/v1/forecast", mid)))["hourly"], d)
                if m:
                    hrrr = round(m[0], 1)
                    break
            except Exception as e:  # noqa: BLE001
                print(f"forecast {name} {mid}: {e}")
    if len(members) < 5:
        print("forecast: not enough ensemble members")
        return 1
    out = {"day": d, "label": "today" if day == now.date() else "tomorrow",
           "median_f": round(pct(members, 0.5), 1), "p10_f": round(pct(members, 0.1), 1),
           "p90_f": round(pct(members, 0.9), 1), "hrrr_f": hrrr, "members": len(members),
           "models": models, "lat": LAT, "lon": LON, "window": "10:00-17:00 local",
           "source": "https://open-meteo.com/en/docs/ensemble-api",
           "fetched": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%MZ")}
    with open(os.path.join(OUT, "surface_forecast.json"), "w") as f:
        json.dump(out, f, indent=2)
    print("forecast:", out)
    return 0


if __name__ == "__main__":
    rc = main()
    try:
        fetch_surface_forecast()
    except Exception as e:  # noqa: BLE001  (forecast is optional)
        print("forecast failed:", e)
    sys.exit(rc)
