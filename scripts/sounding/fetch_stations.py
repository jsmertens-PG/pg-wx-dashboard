"""Fetch this morning's (12Z) radiosondes from every upper-air station near SoCal, for the region panels.

Military sites (Edwards, Yuma) do not launch every day, so each run records which ones flew.
Writes data/sounding/stations/<STN>_latest.txt and data/sounding/stations.json:
  {"NKX": {"name", "lat", "lon", "obs": "2026-11-07T12:00Z", "file", "levels"}, ...}
Standard library only.
"""
import datetime as dt
import html
import json
import os
import re
import sys
import urllib.request

STATIONS = {   # id: (WMO, name, lat, lon)
    "NKX": ("72293", "San Diego / Miramar", 32.85, -117.12),
    "EDW": ("72381", "Edwards AFB", 34.90, -117.92),
    "VBG": ("72393", "Vandenberg", 34.75, -120.57),
    "YUM": ("74004", "Yuma Proving Ground", 32.87, -114.33),
    "VEF": ("72388", "Las Vegas", 36.05, -115.18),
}
OUT = os.path.join(os.path.dirname(__file__), "..", "..", "data", "sounding")
UA = {"User-Agent": "socal-flying-radar sounding fetch (github actions)"}


def get(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=40) as r:
        return r.read().decode("utf-8", "replace")


def uwyo(wmo, c):
    url = f"https://weather.uwyo.edu/wsgi/sounding?datetime={c:%Y-%m-%d}%20{c:%H}:00:00&id={wmo}&type=TEXT:LIST&src=UNKNOWN"
    text = html.unescape(re.sub(r"<[^>]+>", "", get(url)))
    if "HGHT" not in text or "TEMP" not in text:
        raise ValueError("no table")
    return text, url


def iem(stn, c):
    url = ("https://mesonet.agron.iastate.edu/cgi-bin/request/raob.py?"
           f"station=K{stn}&sts={c:%Y-%m-%dT%H}:00Z&ets={c:%Y-%m-%dT%H}:59Z")
    text = get(url)
    if text.count("\n") < 10:
        raise ValueError("empty")
    return text, url


def levels(text):
    return sum(1 for L in text.splitlines() if re.match(r"\s*-?\d", L))


def main():
    now = dt.datetime.now(dt.timezone.utc)
    c = now.replace(hour=12, minute=0, second=0, microsecond=0)
    if now < c + dt.timedelta(minutes=70):
        c -= dt.timedelta(days=1)
    os.makedirs(os.path.join(OUT, "stations"), exist_ok=True)
    try:
        with open(os.path.join(OUT, "stations.json")) as f:
            meta = json.load(f)
    except Exception:  # noqa: BLE001
        meta = {}
    for stn, (wmo, name, la, lo) in STATIONS.items():
        if meta.get(stn, {}).get("obs") == f"{c:%Y-%m-%dT%H}:00Z" and meta[stn].get("v") == 2:
            print(f"{stn}: have {c:%Y-%m-%d %HZ}")
            continue
        for fn, arg in ((uwyo, wmo), (iem, stn)):
            try:
                text, url = fn(arg, c)
                n = levels(text)
                if n < 10:
                    raise ValueError("too few levels")
            except Exception as e:  # noqa: BLE001
                print(f"{stn} {fn.__name__} {c:%Y-%m-%d %HZ}: {str(e)[:100]}")
                continue
            path = f"stations/{stn}_latest.txt"
            if "Observations at" not in text:
                text = f"{wmo} {stn} {name} Observations at {c:%H}Z {c:%d %b %Y}\n" + text
            with open(os.path.join(OUT, path), "w") as f:
                f.write(f"# source: {url}\n# fetched: {now:%Y-%m-%dT%H:%MZ}\n" + text)
            # the balloon's own track, where the high-resolution (BUFR) data carries positions
            try:
                csv = get(f"https://weather.uwyo.edu/wsgi/sounding?datetime={c:%Y-%m-%d}%20{c:%H}:00:00&id={wmo}&type=TEXT:CSV&src=UNKNOWN")
                head = csv.strip().splitlines()[0].lower() if csv.strip() else ""
                print(f"{stn}: csv header: {head[:160]}")
                if "lat" in head and "lon" in head:
                    with open(os.path.join(OUT, f"stations/{stn}_track.csv"), "w") as f:
                        f.write(csv)
            except Exception as e:  # noqa: BLE001
                print(f"{stn}: no csv ({str(e)[:80]})")
            meta[stn] = {"name": name, "lat": la, "lon": lo, "obs": f"{c:%Y-%m-%dT%H}:00Z", "file": path, "levels": n, "v": 2}
            print(f"{stn}: saved {c:%Y-%m-%d %HZ} ({n} lines) from {fn.__name__}")
            break
        else:
            print(f"{stn}: no launch found for {c:%Y-%m-%d %HZ}")
    with open(os.path.join(OUT, "stations.json"), "w") as f:
        json.dump(meta, f, indent=1)
    return 0


if __name__ == "__main__":
    sys.exit(main())
