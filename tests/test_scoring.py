import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import build_forecast as bf  # noqa: E402


class SampleRun(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        out = ROOT / "tests" / "_sample.json"
        bf.main(["--sample", "--out", str(out)])
        cls.data = json.loads(out.read_text())
        out.unlink()

    def test_seven_days_all_sites(self):
        self.assertEqual(len(self.data["days"]), 7)
        ids = {s["id"] for s in self.data["sites"]}
        for d in self.data["days"]:
            self.assertEqual(set(d["sites"]), ids)

    def test_scores_are_probabilities(self):
        for d in self.data["days"]:
            for c in d["sites"].values():
                self.assertTrue(1 <= c["rating"] <= 5)
                for k in ("p_fly", "p_xc"):
                    self.assertTrue(0 <= c[k] <= 1)
                if c["xc"]:
                    self.assertGreaterEqual(c["rating"], 3.5)      # XC only when the shown number is 4+
                self.assertIn(c["label"], {"XC", "Thermal day", "Thermal", "Glass-off", "Ridge soaring", "Marginal", "No go"})

    def test_sources_have_timestamps(self):
        self.assertTrue(self.data["sources"])
        for s in self.data["sources"]:
            self.assertIn("fetched", s)
            self.assertIn("run", s)

    def test_torrey_xc_only_as_thermal_day(self):
        for d in self.data["days"]:
            c = d["sites"]["torrey"]
            if c["xc"]:
                self.assertEqual(c["label"], "Thermal day")


    def test_every_site_day_has_height_and_both_winds(self):
        for d in self.data["days"]:
            for k, c in d["sites"].items():
                keys = [f["k"] for f in c["factors"]]
                self.assertIn("Wind 1 pm", keys, (d["date"], k))
                if c.get("style") != "ridge" and k != "torrey":
                    self.assertIn("Wind aloft", keys, (d["date"], k))
                    self.assertEqual(keys[0], "Height", (d["date"], k))
                else:                       # Torrey: wind and direction only, no height bar
                    self.assertNotIn("Height", keys, (d["date"], k))

    def test_day_types_known(self):
        for d in self.data["days"]:
            r = d.get("regime")
            if r and r["type"]:
                self.assertIn(r["type"], bf.REGIMES)


class Snapshots(unittest.TestCase):
    def test_one_small_snapshot_per_day(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "f.json"
            bf.main(["--sample", "--out", str(out)])
            data = json.loads(out.read_text())
            folder = Path(tmp) / "history"
            t = bf.datetime(2026, 10, 24, 8, 0, tzinfo=bf._tz())
            self.assertIsNotNone(bf.save_snapshot(data, folder, now=t))
            self.assertIsNone(bf.save_snapshot(data, folder, now=t.replace(hour=10)))      # one per day
            self.assertIsNone(bf.save_snapshot(data, folder, now=t.replace(day=25, hour=5)))  # not before 7 am
            snap = json.loads((folder / "2026-10-24.json").read_text())
            self.assertEqual(len(snap["days"]), 7)
            self.assertLess((folder / "2026-10-24.json").stat().st_size, 40000)
            self.assertEqual(json.loads((folder / "index.json").read_text())["dates"], ["2026-10-24"])


class FreezeToday(unittest.TestCase):
    def test_today_freezes_after_noon(self):
        import tempfile
        tz = bf._tz()
        with tempfile.TemporaryDirectory() as tmp:
            prev = Path(tmp) / "f.json"
            midday = {"generated": "2026-10-27T20:30+00:00", "days": [{"date": "2026-10-27", "sites": {}, "x": "1:30pm"}]}
            prev.write_text(json.dumps(midday))
            late = {"generated": "2026-10-27T23:30+00:00", "days": [{"date": "2026-10-27", "sites": {}, "x": "evening"}]}
            bf.freeze_today(late, prev, now=bf.datetime(2026, 10, 27, 16, 30, tzinfo=tz))
            self.assertEqual(late["days"][0]["x"], "1:30pm")
            self.assertEqual(late["days"][0]["frozen_at"], "2026-10-27T20:30+00:00")
            early = {"generated": "2026-10-27T21:00+00:00", "days": [{"date": "2026-10-27", "sites": {}, "x": "new"}]}
            bf.freeze_today(early, prev, now=bf.datetime(2026, 10, 27, 14, 0, tzinfo=tz))
            self.assertEqual(early["days"][0]["x"], "new")          # before 3 pm: still updating
            self.assertTrue(bf.archive_today(late, Path(tmp) / "archive"))
            self.assertEqual(json.loads((Path(tmp) / "archive" / "index.json").read_text())["dates"], ["2026-10-27"])

    def test_morning_final_is_replaced(self):
        import tempfile
        tz = bf._tz()
        with tempfile.TemporaryDirectory() as tmp:
            prev = Path(tmp) / "f.json"
            prev.write_text(json.dumps({"generated": "2026-10-27T22:00+00:00", "days": [
                {"date": "2026-10-27", "sites": {}, "x": "10am", "frozen_at": "2026-10-27T17:00+00:00"}]}))
            cur = {"generated": "2026-10-27T22:30+00:00", "days": [{"date": "2026-10-27", "sites": {}, "x": "3:30pm"}]}
            bf.freeze_today(cur, prev, now=bf.datetime(2026, 10, 27, 15, 30, tzinfo=tz))
            self.assertEqual(cur["days"][0]["x"], "3:30pm")


class DayTypes(unittest.TestCase):
    @staticmethod
    def feats(rows):
        out, d0 = {}, bf.date(2026, 10, 20)
        for k, r in enumerate(rows):
            base = {"rain": 0.0, "t850": 12.0, "rh": 50, "s850": 8, "d850": 270, "s700": 10, "d700": 270, "sfc15": (8, 270)}
            base.update(r)
            out[(d0 + bf.timedelta(days=k)).isoformat()] = base
        return out

    def test_front_sequence(self):
        F = self.feats([{}, {"d700": 210, "s700": 20}, {"rain": 6, "t850": 10}, {"t850": 5, "d700": 300}, {"t850": 6}])
        t = list(bf.classify_days(F).values())
        self.assertEqual(t[1], "Pre-frontal")
        self.assertEqual(t[2], "Front")
        self.assertEqual(t[3], "Post-frontal")

    def test_light_rain_front_with_cooling(self):
        F = self.feats([{}, {}, {"rain": 0.8, "t850": 11}, {"t850": 8, "d700": 300}])
        t = list(bf.classify_days(F).values())
        self.assertEqual(t[1:4], ["Pre-frontal", "Front", "Post-frontal"])

    def test_santa_ana_then_switch(self):
        sa = {"d850": 60, "s850": 20, "rh": 12, "sfc15": (10, 60)}
        F = self.feats([{}, sa, sa, {"d850": 280, "s850": 6, "rh": 40}, {}])
        t = list(bf.classify_days(F).values())
        self.assertEqual(t[1:4], ["Santa Ana", "Santa Ana", "Switch day"])


class Clouds(unittest.TestCase):
    @staticmethod
    def ring(m, h, sw):
        times = [f"2026-10-29T{k:02d}:00" for k in range(24)]
        return [{"time": times, "cloud_cover_mid": [m] * 24, "cloud_cover_high": [h] * 24,
                 "shortwave_radiation": [sw if 9 <= k <= 16 else 0 for k in range(24)], "_utc_offset_h": -7} for _ in range(5)]

    def test_shade_needs_cover_and_lost_sun(self):
        site = {"id": "lb", "lat": 32.98796, "lon": -117.12232}
        thick = bf.cloud_day(site, self.ring(60, 70, 250), "2026-10-29")
        thin = bf.cloud_day(site, self.ring(10, 80, 650), "2026-10-29")
        self.assertTrue(thick[0] >= bf.SHADE_COVER and thick[1] >= bf.SHADE_SUNLOSS)
        self.assertTrue(thin[0] >= bf.SHADE_COVER and thin[1] < bf.SHADE_SUNLOSS)   # thin cirrus: no shade
        res = {"days": [{"date": "2026-10-29", "sites": {k: {} for k in bf.SD_SITES}}]}
        parents = [{"id": k, "lat": 32.9, "lon": -117.0} for k in bf.SD_SITES]
        bf.add_clouds(res, parents, {"HRRR": {k: self.ring(60, 70, 250) for k in bf.SD_SITES}, "GFS": {}})
        self.assertEqual(res["days"][0]["cloud"]["level"], "shade")


class WindowRating(unittest.TestCase):
    def test_lb_rated_on_best_midday_hour(self):
        lb = next(x for x in json.loads((ROOT / "sites.json").read_text())["sites"] if x["id"] == "lb")
        self.assertEqual(lb["style"], "window")
        # heights are top of usable lift (XC Skies style). Jerome's calls: 10-26 (~2,000 ft at noon) a 3-4,
        # 10-27 (~2,400 ft) a 4; 1,500 ft is a sled ride
        self.assertGreaterEqual(bf.ceil_level(lb, 2000), 3.0)
        self.assertGreaterEqual(bf.ceil_level(lb, 2400), 4.0)
        self.assertLess(bf.ceil_level(lb, 1500), 3.0)


class Routes(unittest.TestCase):
    def setUp(self):
        self.lb = next(x for x in json.loads((ROOT / "sites.json").read_text())["sites"] if x["id"] == "lb")

    def test_downwind_route(self):
        # wind aloft from the west at 10 kt drifts LB pilots east
        self.assertIn("east", bf.route_note(self.lb, {"a_spd": 10, "a_dir": 265}))

    def test_drift_into_airspace(self):
        # north-east wind aloft drifts LB pilots toward Miramar
        self.assertIn("Miramar", bf.route_note(self.lb, {"a_spd": 10, "a_dir": 45}))

    def test_light_drift_triangle(self):
        self.assertIn("triangle", bf.route_note(self.lb, {"a_spd": 3, "a_dir": 270}))


class Physics(unittest.TestCase):
    def test_thermal_top_inversion(self):
        # surface 20 C at 0 m, near dry-adiabatic up to 600 m, then a strong inversion
        pts = [(0, 20, 5, 270), (600, 14, 6, 270), (700, 20, 6, 270), (1500, 15, 8, 270)]
        top = bf.thermal_top_m(pts, 20, excess=1.0)
        self.assertTrue(600 < top < 700, top)

    def test_wrap_direction(self):
        self.assertTrue(bf.wrap_in(10, 330, 30))
        self.assertFalse(bf.wrap_in(90, 330, 30))

    def _launches(self):
        parents = json.loads((ROOT / "sites.json").read_text())["sites"]
        kids = [x for x in bf.expand_sites(parents) if x["parent"] == "lagunahorse" and not x.get("_hpoint")]
        return {k["launch_name"]: k for k in kids}

    def test_north_wind_aloft_kills_horse(self):
        horse = self._launches()["Horse"]
        hr = {"temperature_2m": [20], "dew_point_2m": [2], "precipitation": [0], "cape": [0], "shortwave_radiation": [650],
              "wind_speed_10m": [6], "wind_direction_10m": [240],
              "temperature_850hPa": [14], "wind_speed_850hPa": [12], "wind_direction_850hPa": [20],
              "temperature_700hPa": [2], "wind_speed_700hPa": [14], "wind_direction_700hPa": [30]}
        h = bf.score_hour(horse, hr, 0, [850, 700], 1006)
        self.assertLess(h["q"], 0.2)
        self.assertEqual(h["xc_s"], 0.0)

    def test_each_launch_takes_its_own_wind(self):
        L = self._launches()
        base = {"temperature_2m": [18], "dew_point_2m": [2], "precipitation": [0], "cape": [0], "shortwave_radiation": [600],
                "temperature_850hPa": [16], "wind_speed_850hPa": [4], "wind_direction_850hPa": [250],
                "temperature_700hPa": [4], "wind_speed_700hPa": [5], "wind_direction_700hPa": [260]}
        def launch_verdict(site, d, spd):   # put the launch at the model ground so the 10 m wind is used
            return bf.score_hour(site, dict(base, wind_speed_10m=[spd], wind_direction_10m=[d]), 0, [850, 700], site["launch_ft"] / bf.FT)["launch"]
        self.assertEqual(launch_verdict(L["Laguna"], 90, 7), "good")
        self.assertEqual(launch_verdict(L["Horse"], 260, 7), "good")
        self.assertEqual(launch_verdict(L["Horse"], 0, 10), "over the back")
        self.assertEqual(launch_verdict(L["Laguna"], 270, 10), "over the back")

    def test_torrey_cross_vs_over_the_back(self):
        base = {"temperature_2m": [18], "dew_point_2m": [8], "precipitation": [0], "cape": [0], "shortwave_radiation": [500]}
        torrey = next(x for x in json.loads((ROOT / "sites.json").read_text())["sites"] if x["id"] == "torrey")
        def v(d, spd):
            return bf.score_hour(torrey, dict(base, wind_speed_10m=[spd], wind_direction_10m=[d]), 0, [], 0)["launch"]
        self.assertEqual(v(330, 10), "cross-NW")
        self.assertEqual(v(220, 10), "cross-SW")
        self.assertEqual(v(90, 10), "over the back")

    def test_light_cross_wind_is_free(self):
        lb = next(x for x in json.loads((ROOT / "sites.json").read_text())["sites"] if x["id"] == "lb")
        base = {"temperature_2m": [24], "dew_point_2m": [5], "precipitation": [0], "cape": [0], "shortwave_radiation": [600]}
        def h(d, kt):
            return bf.score_hour(lb, dict(base, wind_speed_10m=[kt], wind_direction_10m=[d]), 0, [], 150)
        on, calm_cross, cross = h(260, 2.6), h(340, 2.6), h(340, 8)   # 3 mph on, 3 mph NNW, 9 mph NNW
        self.assertNotIn("cross", calm_cross["codes"])
        self.assertAlmostEqual(calm_cross["q"], on["q"])
        self.assertEqual(cross["launch"], "cross-N")
        self.assertLess(cross["q"], h(260, 8)["q"])

    def test_sites_have_real_positions(self):
        parents = json.loads((ROOT / "sites.json").read_text())["sites"]
        for x in bf.expand_sites(parents):
            if x.get("_hpoint"):          # height points only measure lift, they have no launch or LZ
                continue
            self.assertIsNotNone(x.get("lz_ft"), x["id"])
            self.assertLess(x["lz_ft"], x["launch_ft"], x["id"])

    def test_offshore_hour_is_no_go(self):
        site = next(x for x in json.loads((ROOT / "sites.json").read_text())["sites"] if x["id"] == "lb")   # Little Black
        hr = {"temperature_2m": [24], "dew_point_2m": [5], "precipitation": [0], "cape": [0],
              "wind_speed_10m": [12], "wind_direction_10m": [60]}
        self.assertEqual(bf.score_hour(site, hr, 0, [], 150)["q"], 0.0)


class NwsSummary(unittest.TestCase):
    def test_rule_summary_is_short_and_whole(self):
        text = (ROOT / "tests" / "fixtures" / "afd_sgx_2026-10-22.txt").read_text()
        r = bf.summary_rules(text)
        self.assertTrue(r["pattern"] and r["flying"])
        for b in r["pattern"] + r["flying"]:
            self.assertNotIn("…", b)
            self.assertNotIn("tide", b.lower())

    def test_no_key_no_llm(self):
        import os
        os.environ.pop("ANTHROPIC_API_KEY", None)
        self.assertIsNone(bf.summarize_llm("text", []))


class NwsText(unittest.TestCase):
    def test_parse_real_afd(self):
        text = (ROOT / "tests" / "fixtures" / "afd_sgx_2026-10-22.txt").read_text()
        afd = bf.parse_afd(text, "2026-10-22T11:49Z")
        self.assertIn("Showers", afd["flags"])
        self.assertIn("Thunderstorms", afd["flags"])
        self.assertIn("Wind advisory", afd["flags"])
        self.assertTrue(afd["synopsis"].startswith("Showers and a slight chance"))
        self.assertTrue(any("upper low" in x.lower() for x in afd["systems"]), afd["systems"])



class RainAndSun(unittest.TestCase):
    """Wet, grey days (Fri Oct 30, Sat Oct 31 2026) should not show 3s inland."""
    def test_rain_steps(self):
        self.assertAlmostEqual(bf.weather_steps(4.0, 0.32, False, None)[0], 3.5)
        self.assertAlmostEqual(bf.weather_steps(4.0, 0.50, False, None)[0], 3.0)
        self.assertAlmostEqual(bf.weather_steps(4.0, 0.65, True, None)[0], 2.0)

    def test_grey_wet_saturday_below_3(self):
        self.assertLess(bf.weather_steps(3.83, 0.45, True, (1.0, 0.41))[0], 2.5)   # Little Black
        self.assertLess(bf.weather_steps(3.97, 0.40, True, (1.0, 0.38))[0], 3.0)   # Blossom

    def test_thin_cirrus_costs_nothing(self):
        self.assertEqual(bf.weather_steps(4.0, 0.0, False, (0.9, 0.2))[0], 4.0)

    def test_sun_steps(self):
        self.assertAlmostEqual(bf.weather_steps(4.0, 0.0, False, (1.0, 0.40))[0], 3.5)
        self.assertAlmostEqual(bf.weather_steps(4.0, 0.0, False, (1.0, 0.60))[0], 3.0)
        self.assertAlmostEqual(bf.weather_steps(4.0, 0.0, False, (1.0, 0.80))[0], 2.5)

    def test_ridge_and_rain_ok_sites_untouched(self):
        self.assertEqual(bf.weather_steps(3.3, 0.70, True, (1.0, 0.9), rain_ok=True)[0], 3.3)
        self.assertEqual(bf.weather_steps(3.3, 0.70, True, (1.0, 0.9), ridge=True)[0], 3.3)

if __name__ == "__main__":
    unittest.main()


class Venturi(unittest.TestCase):
    def test_capped_near(self):
        from build_forecast import capped_near
        launch = 945
        inv = [(10, 20, 5, 180), (900, 14, 8, 160), (1400, 15, 10, 160), (2000, 11, 10, 160)]
        free = [(10, 20, 5, 180), (900, 14, 8, 160), (1400, 9, 10, 160), (2000, 3, 10, 160)]
        self.assertTrue(capped_near(inv, launch, 760))
        self.assertFalse(capped_near(free, launch, 760))
        self.assertTrue(capped_near(free, launch, 760, top_m=1300))


class BestFour(unittest.TestCase):
    def test_best_four_two_per_point(self):
        hrs = [(12, {"pts": [(1000, "a"), (900, "b"), (500, "c")]}), (13, {"pts": [(1100, "a"), (800, "b"), (700, "c")]}),
               (14, {"pts": [(1200, "a"), (600, "b"), (400, "c")]})]
        # a: 1200, 1100 (third reading of a skipped), b: 900, 800
        self.assertAlmostEqual(bf.best4_height(hrs), (1200 + 1100 + 900 + 800) / 4)
        self.assertIsNone(bf.best4_height([(12, {"pts": None})]))


class PostFrontalFlow(unittest.TestCase):
    def test_sw_flow_with_showers_is_not_post_frontal(self):
        F = DayTypes.feats([{"t850": 8}, {"rain": 6, "t850": 8}, {"rain": 1.0, "t850": 8, "d700": 230, "s700": 18},
                            {"rain": 1.0, "t850": 8, "d700": 230, "s700": 16}, {"rain": 12, "t850": 7}])
        t = list(bf.classify_days(F).values())
        self.assertEqual(t[1], "Front")
        self.assertEqual(t[2], "Pre/post-frontal")  # after one front, the next already moving in on a SW flow
        self.assertEqual(t[3], "Pre-frontal")
        self.assertEqual(t[4], "Front")
