import unittest

import numpy as np

from analysis import SR
from engine import plan, render
from evaluate import BAR, bar_problems, contour_share, evaluate, has_reattack, metrics_line, sounding_share
from golden_inputs import source
from melody import Melody, Note
from signals import burst, faded, harmonic, samples


class Bar(unittest.TestCase):
    def test_the_renderers_bar(self):
        ok = {"within_50c_of_fart_pct": 94, "onsets_on_time_pct": 95, "notes_with_retrigger": 0}
        self.assertEqual(bar_problems(ok, BAR), [])
        self.assertEqual(bar_problems({**ok, "within_50c_of_fart_pct": 93}), ["in50cFart 93% < 94%"])
        self.assertEqual(bar_problems({**ok, "onsets_on_time_pct": 94}), ["onTime 94% < 95%"])
        self.assertEqual(bar_problems({**ok, "notes_with_retrigger": 1}), ["1 notes re-attack"])


class Readings(unittest.TestCase):
    def test_contour_counts_the_steps_heard_moving_the_melodys_way(self):
        self.assertEqual(contour_share([60, 62, 62, 59], [60.1, 61.9, None, 58.0]), 0.5)
        self.assertEqual(contour_share([60, 62, 59], [61.0, 60.0, 58.0]), 0.5)
        self.assertIsNone(contour_share([60, 60], [60.0, 61.0]))

    def test_sounding_share_is_the_part_of_a_note_that_sounds(self):
        half = np.concatenate([harmonic(220.0, 0.5) * 0.3, np.zeros(samples(0.5))])
        self.assertAlmostEqual(sounding_share(half), 0.5, delta=0.03)
        self.assertEqual(sounding_share(np.zeros(10)), 0.0)

    def test_a_second_attack_inside_a_note(self):
        self.assertFalse(has_reattack(burst()))
        self.assertTrue(has_reattack(np.concatenate([burst(), np.zeros(samples(0.15)), burst()])))
        self.assertFalse(has_reattack(burst(0.05)))

    def test_metrics_line(self):
        r = {"notes": 8, "within_50c_of_fart_pct": 100, "onsets_on_time_pct": 100, "notes_with_retrigger": 0,
             "within_50c_pct": 25, "median_abs_cents": 87.25, "contour_pct": 71, "distinct_recordings": 4,
             "sounding_pct": 92, "notes_mostly_silent": 0}
        self.assertEqual(
            metrics_line("twinkle", -27, r, 1, "PASS"),
            "twinkle      T=-27 notes=  8 in50cFart=100% onTime=100% reatk=0 PASS | in50c= 25% med= 87.2c contour=71%"
            " recs=4 octaveMoves=1 sounding=92% mostlySilent=0",
        )
        self.assertIn("reatk=0 | in50c", metrics_line("twinkle", -27, r, 1))


class Evaluate(unittest.TestCase):
    def test_a_render_of_steady_farts_passes_the_bar(self):
        sources = [source(rid, pitch, samples(1.0), 0.12, 0.0, audio=faded(harmonic(hz, 1.0), 0.01) * 0.3)
                   for rid, pitch, hz in (("a", 45.0259, 110.0), ("b", 49.0259, 138.59), ("c", 52.0259, 164.81))]
        notes = [Note(float(i), 1.0, p) for i, p in enumerate([57, 61, 64, 61, 57, 64])]
        melody = Melody("test", 100.0, 4, notes, [0.0, 4.0])
        _, assignments = plan(melody, sources)
        audio, events = render(melody, sources, assignments)
        r = evaluate(audio, melody, events, melody.bpm, sources)
        self.assertEqual(bar_problems(r), [])
        self.assertEqual((r["within_50c_of_fart_pct"], r["notes_with_retrigger"], r["distinct_recordings"]), (100, 0, 3))
        self.assertEqual([p["i"] for p in r["per_note"]], list(range(6)))
        self.assertTrue(all(abs(p["fart_cents"]) <= 2 for p in r["per_note"]))
        self.assertEqual(r["notes"], 6)
        self.assertEqual(len(audio), int((melody.length_beats * 0.6 + 1.0) * SR))
