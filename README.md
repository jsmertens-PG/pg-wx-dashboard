# SoCal Flying Radar

A one-page, 7-day outlook for the main Southern California paragliding launches: Little Black, Blossom, Elsinore, Torrey, Laguna/Horse, Marshall/Crestline, Otay, Soboba and Santa Barbara.

The top of the page has the weather story from the NWS San Diego discussion (synopsis, the systems moving through, and flags). Below that, each day gets a full-width card. The home sites (Little Black, Blossom, Elsinore) get large panels, Torrey gets a row, and Laguna/Horse, Marshall, Otay and Soboba get a compact strip. Each site shows a 0–10 rating with a coloured bar, a label (XC, Thermal, Glass-off, Ridge soaring, Marginal, No go), and a short note: an XC direction, the glass-off time, or why the day doesn't work. Tap a site for details: lift, cloudbase, winds, rain, an hour-by-hour strip, and what each model says.

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
| Soaring Predictor summary tables (South Cal, Santa Barbara) | soaringpredictor.info | Reference ceiling for the next 3 days (▼ on the thermal-height bar) |
| NWS San Diego forecast discussion | api.weather.gov | Flags (showers, thunderstorms, offshore, wind advisory) and synopsis |

All of these are free and need no keys. Soaring Predictor, XC Skies and the Holfuy stations need logins or paid keys, so the page links to them under "Check by hand".

## How a day is rated

The rating runs from 0 to 10. A nice local thermal or glass-off day is about 3.5–5 (green). XC days start at 6: about 6 is a short or low XC, 7–8 a solid one, 9 a big day.

For each model run, each hour from 9 am to 6 pm is checked at each launch:

- **Rain or storms:** 0.5 mm/h or more, or CAPE with showers, is a no-go. Light showers or high CAPE reduce the rating.
- **Launch wind:** it must be inside the site's direction window. Wind from behind launch above 5 mph is a no-go, as is wind well over the site's limit.
- **Wind aloft:** both strength and direction through the lift band. Each site has an `aloft_bad` range (for example north and east for Laguna/Horse). Wind aloft from that range above about 6 kt mostly kills the hour and rules out XC.
- **Lift:** thermal strength (W*) comes from the sunshine and the depth of the mixed layer (the lower of a dry surface parcel and the model's boundary-layer height). A paraglider only uses the part of that layer where thermals beat its sink rate, the idea behind Soaring Predictor's Hcrit: about half on weak days, most of it on strong ones, never above cloudbase. Height over launch and thermal strength drive the rating. Torrey is rated on ridge wind instead.
- **XC:** lift above the site's `xc_top_ft` with no rain and no bad wind aloft. The XC rating grows with the height above that threshold and with how many hours it lasts.
- **Glass-off:** at least two of the last hours before sunset with smooth onshore wind on launch (3–13 mph), no rain and nothing strong aloft. Labelled Glass-off only when there's no real midday thermal window.
- **Showers:** the share of ensemble runs with rain at the site during flying hours. 20% or more adds a "showers around" tag; the same number drives the rain bar.

The day's rating is a weighted median of the regular models: HRRR and RRFS ×3, NAM ×2, GFS/ECMWF/ICON ×1 (`MODEL_WEIGHT` in the script). Models without sunshine data (NAM on Open-Meteo) get a clear-sky estimate from sun height and their own cloud cover. The ensembles (coarser, without boundary-layer height) are recentred on that median and give the chance of a flyable or XC day. **XC** appears when the rating is at least 6 and at least 40% of the runs agree. The XC note suggests a direction from the drift and the site's `routes`, and warns when the drift heads into a `blocked` direction (airspace, the border).

## Tuning

`sites.json` holds every launch's coordinates, elevation, wind window, limits and XC height. **The values are starting estimates. Check the coordinates and elevations against the SDHGPA guide and your tracks.** The quickest improvement after that is comparing the radar with days you actually flew, then adjusting the limits.

Run locally:

```
python scripts/build_forecast.py            # live data (needs internet)
python scripts/build_forecast.py --sample   # synthetic data for testing the page
python -m unittest discover -s tests
python -m http.server                        # then open http://localhost:8000
```

## Known limits

- Model terrain is smoothed, so launch winds at small hills (Little Black, Torrey) are approximate. The sea breeze and the convergence lines are the parts the models handle worst.
- Showers on post-frontal days are hit-or-miss. A "split" note means the models disagree; check the radar on the day.
- Open-Meteo sometimes renames model ids. The script tries fallbacks, and the Sources table shows which id was used or whether a model failed.

## Next steps

- Backtest: score past days with Open-Meteo's historical forecasts and compare with the flights in the IGC logbook, so the thresholds come from data.
- Add the NWS soaring forecast (top of lift and mixing height per area) as another source.
