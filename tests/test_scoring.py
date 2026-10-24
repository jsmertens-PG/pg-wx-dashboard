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
                self.assertTrue(0 <= c["rating"] <= 10)
                for k in ("p_fly", "p_xc"):
                    self.assertTrue(0 <= c[k] <= 1)
                if c["xc"]:
                    self.assertGreaterEqual(c["rating"], 6.0)      # XC only on a 6+ day
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


class Routes(unittest.TestCase):
    def setUp(self):
        self.lb = json.loads((ROOT / "sites.json").read_text())["sites"][0]

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

    def test_north_wind_aloft_kills_laguna_horse(self):
        sites = json.loads((ROOT / "sites.json").read_text())["sites"]
        lag = next(x for x in sites if x["id"] == "lagunahorse")
        hr = {"temperature_2m": [20], "dew_point_2m": [2], "precipitation": [0], "cape": [0],
              "wind_speed_10m": [6], "wind_direction_10m": [240],
              "temperature_850hPa": [14], "wind_speed_850hPa": [12], "wind_direction_850hPa": [20],
              "temperature_700hPa": [2], "wind_speed_700hPa": [14], "wind_direction_700hPa": [30]}
        h = bf.score_hour(lag, hr, 0, [850, 700], 1300)
        self.assertLess(h["q"], 0.2)
        self.assertEqual(h["xc_s"], 0.0)

    def test_laguna_horse_takes_either_wind(self):
        # Horse faces west, Laguna east: either wind is on, a north wind is over the back
        sites = json.loads((ROOT / "sites.json").read_text())["sites"]
        lag = next(x for x in sites if x["id"] == "lagunahorse")
        base = {"temperature_2m": [18], "dew_point_2m": [2], "precipitation": [0], "cape": [0], "shortwave_radiation": [600],
                "temperature_850hPa": [16], "wind_speed_850hPa": [4], "wind_direction_850hPa": [90],
                "temperature_700hPa": [4], "wind_speed_700hPa": [5], "wind_direction_700hPa": [100]}
        east = bf.score_hour(lag, dict(base, wind_speed_10m=[6], wind_direction_10m=[90]), 0, [850, 700], 1676)
        west = bf.score_hour(lag, dict(base, wind_speed_10m=[8], wind_direction_10m=[260]), 0, [850, 700], 1676)
        north = bf.score_hour(lag, dict(base, wind_speed_10m=[10], wind_direction_10m=[0]), 0, [850, 700], 1676)
        self.assertNotIn("otb", east["codes"])
        self.assertNotIn("otb", west["codes"])
        self.assertIn("otb", north["codes"])
        self.assertEqual(north["launch"], "over the back")

    def test_offshore_hour_is_no_go(self):
        site = json.loads((ROOT / "sites.json").read_text())["sites"][0]   # Little Black
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


if __name__ == "__main__":
    unittest.main()
