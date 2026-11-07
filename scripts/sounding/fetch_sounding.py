"""Fetch the latest NKX (San Diego) radiosonde and save it as text.

Tries the University of Wyoming (TEXT:LIST), then Iowa Mesonet CSV, then SPC.
Writes data/sounding/nkx_latest.txt and an archive copy per launch.
Standard library only.
"""
import datetime as dt
import html
import os
import re
import sys
import urllib.request

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


if __name__ == "__main__":
    sys.exit(main())
