import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

import numpy as np

import export_golden
import golden_cost
from analysis import read_manifest
from export_golden import Exact, noise_like_reason, plain, write
from golden_cost import arrangement_cost, load
from golden_inputs import INDEX, SONGS
from plot_env import plot_envelopes


def temp_dir(test):
    tmp = tempfile.TemporaryDirectory()
    test.addCleanup(tmp.cleanup)
    return Path(tmp.name)


class Writing(unittest.TestCase):
    def test_writes_sorted_utf8_json_with_unix_line_endings(self):
        out = temp_dir(self)
        with mock.patch.object(export_golden, "GOLDEN", out):
            write("songs/x.json", {"title": "Frère Jacques", "b": [1, 2], "a": 0.5})
        data = (out / "songs/x.json").read_bytes()
        self.assertEqual(data, '{\n  "a": 0.5,\n  "b": [\n    1,\n    2\n  ],\n  "title": "Frère Jacques"\n}\n'.encode())

    def test_rounds_every_float_not_marked_exact(self):
        self.assertEqual(plain({1: 0.12345678, "e": Exact(0.12345678), "neg": -0.0, "nan": float("nan")}),
                         {"1": 0.123457, "e": 0.12345678, "neg": 0.0, "nan": None})
        self.assertEqual(plain((np.float64(1.0000004), np.int64(3), None)), [1.0, 3, None])
        self.assertEqual(json.dumps(plain([-0.0])), "[0.0]")

    def test_why_a_recording_is_noise_like(self):
        self.assertIsNone(noise_like_reason(SimpleNamespace(pitched=True, pitch_estimate=50.0)))
        self.assertEqual(noise_like_reason(SimpleNamespace(pitched=False, pitch_estimate=None)), "no_steady_pitch")
        self.assertEqual(noise_like_reason(SimpleNamespace(pitched=False, pitch_estimate=50.0)), "failed_audition")


class GoldenCost(unittest.TestCase):
    def test_recomputes_every_golden_fit(self):
        subsets = len(load("coverage.json")["subsets"])
        with mock.patch("builtins.print"):
            checked = golden_cost.main()
        self.assertEqual(checked, len(SONGS) * (len(INDEX["libraries"]) + subsets))

    def test_rejects_a_recording_on_two_pitches_and_a_move_out_of_reach(self):
        golden = load("arrangements/full/twinkle.json")
        recordings = {r: load(f"recordings/{r}.json") for r in INDEX["recordings"]}
        per_pitch = {x["song_pitch"]: x["recording"] for x in golden["per_pitch"]}
        self.assertEqual(arrangement_cost(SONGS["twinkle"], recordings, golden["transpose"], per_pitch),
                         (0, golden["octave_moves"], golden["plan_cost"]))
        first, second = sorted(per_pitch)[:2]
        with self.assertRaisesRegex(AssertionError, "at most one pitch"):
            arrangement_cost(SONGS["twinkle"], recordings, golden["transpose"], {**per_pitch, second: per_pitch[first]})
        with self.assertRaisesRegex(AssertionError, "can't play"):
            arrangement_cost(SONGS["twinkle"], recordings, golden["transpose"] + 5, per_pitch)


class PlotEnvelopes(unittest.TestCase):
    def test_plots_each_recordings_envelope_and_gesture(self):
        out = temp_dir(self) / "envelopes.png"
        recordings = [r for r in read_manifest() if r["id"] in ("009", "016")]
        plot_envelopes(recordings, out)
        self.assertEqual(out.read_bytes()[:8], b"\x89PNG\r\n\x1a\n")
