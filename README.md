# SoCal Flying Radar

A one-page, 7-day outlook for the main Southern California paragliding launches: Little Black, Blossom, Elsinore, Torrey, Laguna/Horse, Marshall/Crestline, Otay, Soboba and Santa Barbara.

The top of the page has the weather story from the NWS San Diego discussion. Below it, each day gets a card led by its day type (Front, Pre-frontal, Post-frontal, Santa Ana, Switch day). The home sites (Little Black, Blossom, Elsinore) come first, then Torrey, then Laguna/Horse, Marshall, Otay, Soboba and Santa Barbara. Each site shows a 1–5 rating with a coloured bar, a label (XC, Thermal day, Thermal, Glass-off, Ridge soaring, Marginal, No go), tags (XC window, glass-off, showers around) and, when the day doesn't work, the reason. Tap a site for the height (RRFS and HRRR in one bar), winds, rain and model agreement. XC routes are left to Skysight / XC Skies.

A GitHub Action rebuilds the data every two hours. The page shows every source used, when each model run was made, when it was fetched, and when the data was processed.

## Setup (about 5 minutes)

1. Create a new repository on GitHub, for example `socal-flying-radar`. Make it **public** so GitHub Pages is free. A private repo needs a paid plan for Pages.
2. Upload everything in this folder, including the hidden `.github` folder and `.nojekyll`. The simplest way is **Add file → Upload files**, dragging the whole folder in.
3. **Settings → Pages → Build and deployment**: set Source to *Deploy from a branch*, then pick `main` and `/ (root)`.
4. **Settings → Actions → General → Workflow permissions**: choose *Read and write permissions*. The job needs this to commit the new data.
5. **Actions → Update forecast → Run workflow**, to get the first real forecast without waiting.
6. Open `https://<your-user>.github.io/<repo>/` and add it to your phone's home screen.

The repo ships with sample data, so the page works from the first upload. A banner says it's sample data until the first real run replaces it.

## Data sources

| What | Source | Used for |
|---|---|---|
| HRRR (3 km, hourly, 18–48 h) | Open-Meteo | Today and tomorrow: lift, cloudbase, CAPE, gusts |
| NAM (3 km, 60 h) | Open-Meteo | Today and tomorrow, cross-check |
| GFS, ECMWF IFS, ICON | Open-Meteo | Days 1–7 |
| GFS, ECMWF and ICON ensembles (~120 runs) | Open-Meteo ensemble API | The "flyable %" and XC chance |
| NWS San Diego forecast discussion | api.weather.gov | Flags (showers, thunderstorms, offshore, wind advisory) and synopsis |

All of these are free and need no keys. Soaring Predictor, XC Skies and the Holfuy stations need logins or paid keys, so the page links to them under "Check by hand".

## How a day is rated

Ratings run **1–5**: 1 no go, 2 marginal, 3 a good local day or a nice glass-off, 4 a real XC window, 5 outstanding. What counts depends on the site's `style` in `sites.json`:

- **window** (Little Black, Blossom, Otay): the best single hour inside the site's `window` (11 am–1 pm) decides. That is the short slot to get up and out before wind and stability kill it; the rest of the afternoon doesn't count against the day. Glass-off is rated on its own (3 for a good one) and the better of the two counts.
- **convergence** (Elsinore, Laguna/Horse): XC only. Without convergence (real on-launch flow, nothing bad aloft, lift above `xc_top_ft`) the rating caps at 2.
- **ridge** (Torrey): 2–3 for ridge soaring, 4–5 on a thermal day (cold air aloft, lift to 1,200 ft and more).
- **thermal** (Marshall, Santa Barbara, Soboba): the best two hours inside the site's window (Soboba 1–4 pm).

Heights map onto the scale through each site's ceilings: `ok_ft` is 3, `xc_top_ft` is 4, `xc_top_ft + xc_span_ft` is 5. An hour also needs a usable launch wind (gusts over `gust_mph` hurt), no rain, and acceptable wind aloft; without real XC conditions an hour can't score above 3.5.

**Day type.** Each day also gets a region-wide type from the models (three days of history plus the forecast at Little Black, Blossom and Elsinore): **Front** (regional rain with cooling), **Post-frontal** (the days after: colder air at 850 hPa, W–NW flow), **Pre-frontal** (S–SW flow aloft ahead of a front), **Santa Ana** (NE–E flow at 850 hPa with dry air) and **Switch day** (the day Santa Ana ends). The models vote with the same weights as the rating; "maybe" means they disagree.

The day's rating is a weighted median of the regular models: HRRR and RRFS ×3, NAM ×2, GFS/ECMWF/ICON ×1 (`MODEL_WEIGHT`). The ensembles are recentred on that median and give the chance of a flyable (2.5+) or XC (3.5+) day. Height bars show RRFS and HRRR; past their range a rough global-model height is shown.

## Tuning

`sites.json` holds every launch's coordinates, elevation, wind window, limits and three ceilings (MSL) that scale the height bars: `ok_ft` (a decent local day, half bar), `xc_top_ft` (XC starts, three-quarter bar) and `xc_top_ft + xc_span_ft` (a great XC day, full bar). For example Little Black 2,500 / 3,000 / 4,500 ft, Elsinore 5,000 / 7,000 / 10,000 ft, Laguna/Horse 7,000 / 10,000 / 12,000 ft. `gust_mph` (15 inland, 24 at Torrey) is where gusts start to cost; 5 mph above it is close to a no-go. **The values are starting estimates. Check the coordinates and elevations against the SDHGPA guide and your tracks.** The quickest improvement after that is comparing the radar with days you actually flew, then adjusting the limits.

Run locally:

```
python scripts/build_forecast.py            # live data (needs internet)
python scripts/build_forecast.py --sample   # synthetic data for testing the page
python -m unittest discover -s tests
python -m http.server                        # then open http://localhost:8000
```

## Checking the radar against real flights

Every morning (first run from 7 am) the radar keeps a small copy of its forecast in `data/history/<date>.json`; the **Snapshots** button at the bottom of the page lists them. `scripts/compare_flights.py` sets those snapshots against what was actually flown and suggests calibration changes:

```
python scripts/compare_flights.py --igc ~/logbook/igc           # your own IGC files, matched to sites by takeoff position
python scripts/compare_flights.py --csv flights.csv --out report.md
```

The CSV takes one flight per row with `date, site` and any of `max_alt_ft, dist_km, dist_mi, duration_min, pilot`, so it can be filled from XContest day lists, club reports or notes. Each day at a site gets an observed 1–5 score on the site's own scale (height, distance, duration); days without flights are skipped.

## Known limits

- Model terrain is smoothed, so launch winds at small hills (Little Black, Torrey) are approximate. The sea breeze and the convergence lines are the parts the models handle worst.
- Showers on post-frontal days are hit-or-miss. A "split" note means the models disagree; check the radar on the day.
- Open-Meteo sometimes renames model ids. The script tries fallbacks, and the Sources table shows which id was used or whether a model failed.

## Next steps

- Backtest: score past days with Open-Meteo's historical forecasts and compare with the flights in the IGC logbook, so the thresholds come from data.
- Add the NWS soaring forecast (top of lift and mixing height per area) as another source.
