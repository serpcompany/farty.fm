"""Checks where Beats play (engine.plan_beats, ADR 0014) and how render() mixes them: one
Noise-like Recording raw on each bar line, in turn, under the melody, and nothing at all when
the library has no Noise-like Recording.

    .venv/bin/python -I -m unittest discover -s . -p 'test_*.py'
"""
import unittest

import numpy as np

from engine import BEAT_DB, GAP_S, SR, Assignment, Source, plan_beats, render
from melody import Melody, Note


def source(rid, seconds, pitched, level=0.1, seed=0):
    """A Recording of `seconds` of noise; Melodic when `pitched` (render() reads no pitch)."""
    audio = np.random.default_rng(seed).uniform(-level, level, int(seconds * SR))
    return Source(rid, False, audio, np.zeros(1), 60.0 if pitched else None, 1.0, -20.0)


def song(bar_lines, notes, bpm=120):
    return Melody("test", bpm, 4, [Note(*n) for n in notes], bar_lines)


class PlanBeatsTest(unittest.TestCase):
    def test_one_beat_per_bar_line_to_the_next(self):
        m = song([0, 4, 8], [(0, 4, 60), (4, 4, 62), (8, 2, 64)])
        beats = plan_beats(m, [source("010", 1, True), source("065", 1, False)])
        self.assertEqual([(b.bar, b.source_id, b.start, b.dur) for b in beats],
                         [(0, "065", 0, 4), (1, "065", 4, 4), (2, "065", 8, 2)])  # the last to the Song's end

    def test_a_pickup_gets_no_beat(self):
        m = song([1, 4, 7], [(0, 1, 60), (1, 3, 62), (4, 3, 64), (7, 3, 65)])
        self.assertEqual([b.start for b in plan_beats(m, [source("065", 1, False)])], [1, 4, 7])

    def test_several_take_turns_in_id_order(self):
        m = song([0, 3, 6, 9, 12], [(0, 15, 60)])
        lib = [source("090", 1, True), source("103", 1, False), source("009", 1, False), source("065", 1, False)]
        self.assertEqual([b.source_id for b in plan_beats(m, lib)], ["009", "065", "103", "009", "065"])

    def test_none_without_a_noise_like_recording(self):
        m = song([0, 4], [(0, 8, 60)])
        self.assertEqual(plan_beats(m, [source("010", 1, True), source("090", 1, True)]), [])
        self.assertEqual(plan_beats(m, []), [])


class RenderBeatsTest(unittest.TestCase):
    def setUp(self):
        self.m = song([0, 4], [(0, 2, 60), (2, 2, 62), (4, 4, 64)])
        self.melodic = source("010", 3, True, seed=1)
        self.noise = source("065", 3, False, level=0.3, seed=2)
        self.lib = [self.melodic, self.noise]
        self.asg = [Assignment(i, "010", 60, 0.0) for i in range(3)]

    def test_no_beats_renders_as_before(self):
        a, ev_a = render(self.m, self.lib, self.asg)
        b, ev_b = render(self.m, self.lib, self.asg, beats=plan_beats(self.m, [self.melodic]))
        self.assertTrue(np.array_equal(a, b))
        self.assertEqual(ev_a, ev_b)

    def test_beats_play_raw_on_the_bar_lines(self):
        beats = plan_beats(self.m, self.lib)
        _, ev = render(self.m, self.lib, self.asg, beats=beats)
        self.assertEqual([e["note_index"] for e in ev if "beat" not in e], [0, 1, 2])
        played = [e for e in ev if "beat" in e]
        self.assertEqual([(e["beat"], e["source_id"], e["start_s"]) for e in played], [(0, "065", 0.0), (1, "065", 2.0)])
        # to the next bar line less the gap (2 s - 25 ms), the last to the Song's end; both shorter than the fart
        self.assertEqual([e["len_s"] for e in played], [round(int((2 - GAP_S) * SR) / SR, 3)] * 2)

    def test_a_beat_is_beat_db_under_a_note_without_accent(self):
        # The same fart as a note off the bar line and as a Beat: the levels differ by BEAT_DB only.
        lib = [self.noise, source("010", 3, True, level=0.3, seed=2)]
        m = song([0, 4], [(1, 3, 60), (4, 4, 62)])
        _, ev = render(m, lib, [Assignment(0, "010", 60, 0.0)], beats=plan_beats(m, lib))
        note, beat = ev[0], ev[1]
        self.assertEqual(beat["start_s"], 0.0)
        self.assertAlmostEqual(beat["gain_db"] - note["gain_db"], BEAT_DB, delta=0.15)

    def test_a_beat_is_the_fart_from_its_start(self):
        # Only a Beat sounds: the render, before the limiter, is the fart's own samples, faded and scaled.
        m = song([0], [(0, 4, 60)])
        audio, ev = render(m, [self.noise], [], beats=plan_beats(m, [self.noise]))
        n = int(ev[0]["len_s"] * SR)
        mid = slice(int(0.01 * SR), n - int(0.04 * SR))  # past the fade-in, before the fade-out
        mixed = np.arctanh(audio[mid] / 0.89 * np.tanh(1.2))  # undo the limiter
        fart = self.noise.audio[mid]
        scale = np.dot(mixed, fart) / np.dot(fart, fart)
        self.assertGreater(scale, 0)
        self.assertLess(np.max(np.abs(mixed - scale * fart)), 1e-9)


if __name__ == "__main__":
    unittest.main()
