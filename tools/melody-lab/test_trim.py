"""A Trim (ADR 0019): a person keeps part of a Noise-like Recording's take with two handles, and
trim_bounds() finds the fart between them as note_segment() finds a Recording's fart (ADR 0016).
trimmed() then plays only that part: Songs cut it there and melody_fit() counts its length, but
nothing re-reads its pitch, so a placed fart (placed(), ADR 0015) stays on its note.
Runs on synthetic bursts, on the golden Songs and Recordings in fixtures/golden/, and on one
Fixture Library file, Recording 065.
`apps/web/src/lib/analysis/trim.test.ts` checks the same bounds on the web.

    .venv/bin/python -I -m unittest discover -s . -p 'test_*.py'    # from tools/melody-lab
"""
import json
import sys
import unittest
from pathlib import Path

import librosa
import numpy as np

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE)]

from engine import (  # noqa: E402
    AUDIO_DIR, MANIFEST, PLACED_MIN_NOTE_S, SR, analyze_recording, lead_in_start, melody_fit, note_segment,
    placed, trim_bounds, trimmed,
)
from test_needed_seconds import INDEX, SONGS, golden_source, melody  # noqa: E402

T = np.arange(int(2.0 * SR)) / SR
C2 = 36


def burst(start, end, level=0.5):
    """A 150 Hz tone from `start` to `end` seconds, silent elsewhere."""
    return np.where((T >= start) & (T < end), level * np.sin(2 * np.pi * 150 * T), 0.0).astype(np.float32)


# A short blip, a long gap, then the fart itself: the shape a Trim is for (Recording 065's).
TAKE = burst(0.20, 0.23, 0.1) + burst(0.80, 1.40)


def fixture(rid):
    r = next(r for r in json.loads(MANIFEST.read_text())["recordings"] if r["id"] == rid)
    y, _ = librosa.load(AUDIO_DIR / r["filename"], sr=SR, mono=True)
    return y


class TrimBounds(unittest.TestCase):
    def test_finds_the_fart_between_the_handles(self):
        start, end = trim_bounds(TAKE, 0.5, 1.9)
        # The attack, 8 ms early at most one 5 ms frame more, as note_segment() finds it.
        self.assertGreaterEqual(start, 0.80 - 0.008 - 0.005 - 1e-9)
        self.assertLessEqual(start, 0.80)
        # Where it fades out: within one 50 ms window and a hop after the burst ends.
        self.assertGreater(end, 1.40)
        self.assertLess(end, 1.40 + 0.055)

    def test_always_lies_within_the_handles(self):
        for handles in [(0.0, 2.0), (0.5, 1.9), (0.9, 1.2), (0.81, 1.39), (0.1, 0.5)]:
            start, end = trim_bounds(TAKE, *handles)
            self.assertGreaterEqual(round(start * SR), round(handles[0] * SR), handles)
            self.assertLessEqual(round(end * SR), round(handles[1] * SR), handles)
            self.assertLess(start, end, handles)

    def test_the_whole_take_is_the_fart_analysis_found(self):
        start, end, _, _ = note_segment(TAKE)
        self.assertEqual(trim_bounds(TAKE, 0.0, len(TAKE) / SR), (start / SR, end / SR))

    def test_handles_on_the_blip_keep_the_blip(self):
        start, end = trim_bounds(TAKE, 0.1, 0.5)
        self.assertLessEqual(start, 0.20)
        self.assertLess(end, 0.5)

    def test_a_trim_keeps_samples(self):
        with self.assertRaises(ValueError):
            trim_bounds(TAKE, 1.0, 1.0)

    def test_recording_065(self):
        # 065 opens with a 30 ms blip at 0.59 s, 0.3 s before its two loud bursts. Analysis keeps
        # the blip, so a Song starts the note on it. Handles at 0.8 and 2.3 s keep the bursts.
        y = fixture("065")
        start, end, _, _ = note_segment(y)
        self.assertEqual((start, end), (26048, 91740))
        a, b = trim_bounds(y, 0.8, 2.3)
        self.assertEqual((round(a * SR), round(b * SR)), (39108, 91820))
        self.assertEqual(trim_bounds(y, 1.3, 1.7), (59398 / SR, 74930 / SR))


class Trimmed(unittest.TestCase):
    def setUp(self):
        self.noise = next(s for s in map(golden_source, INDEX["libraries"]["full"]) if s.id == "065")
        self.take = np.zeros(102400, dtype=np.float32)  # 065's take, 2.32 s: melody_fit() reads lengths only

    def test_plays_only_the_trim(self):
        y = np.arange(1000, dtype=np.float32)
        t = trimmed(self.noise, y, 100 / SR, 400 / SR)
        np.testing.assert_array_equal(t.audio, y[100:400])
        self.assertEqual((t.start, t.end, t.seconds), (100, 400, 300 / SR))

    def test_finds_its_lead_in_between_the_handles(self):
        # A quiet lead-in 60 ms before the fart's attack (#287), and the blip 0.6 s before that.
        y = burst(0.20, 0.23, 0.1) + burst(0.74, 0.80, 0.02) + burst(0.80, 1.40)
        start, end = trim_bounds(y, 0.5, 1.9)
        t = trimmed(self.noise, y, start, end, handles=(0.5, 1.9))
        a = round(start * SR)
        self.assertEqual(a - len(t.lead_in), round(0.5 * SR) + lead_in_start(y[round(0.5 * SR) : round(1.9 * SR)], a - round(0.5 * SR)))
        np.testing.assert_array_equal(t.lead_in, y[a - len(t.lead_in) : a])
        # It reaches back to the quiet sound, 8 ms before it, and no further.
        self.assertAlmostEqual(len(t.lead_in) / SR, start - 0.74 + 0.008, delta=0.006)

        # A start handle inside that sound cuts the lead-in there: nothing before a handle plays.
        start, end = trim_bounds(y, 0.77, 1.9)
        t = trimmed(self.noise, y, start, end, handles=(0.77, 1.9))
        self.assertGreaterEqual(round(start * SR) - len(t.lead_in), round(0.77 * SR))
        self.assertGreater(len(t.lead_in), 0)

        # Without its handles, a Trim has no room for one.
        self.assertEqual(len(trimmed(self.noise, y, start, end).lead_in), 0)

    def test_on_065_the_lead_in_never_reaches_the_blip(self):
        # Untrimmed, 065's fart starts at the blip. Trimmed at 0.8 s, nothing before 0.8 s plays.
        y = fixture("065")
        src = analyze_recording("065", y)
        start, end = trim_bounds(y, 0.8, 2.3)
        t = trimmed(src, y, start, end, handles=(0.8, 2.3))
        self.assertGreaterEqual(t.start - len(t.lead_in), round(0.8 * SR))
        self.assertLess(src.start - len(src.lead_in), round(0.8 * SR))

    def test_keeps_the_note_it_was_placed_on(self):
        t = placed(trimmed(self.noise, self.take, 39108 / SR, 91820 / SR), C2)
        self.assertEqual((t.ref_midi, t.min_note_s, t.settle_s), (36.0, PLACED_MIN_NOTE_S, 0.0))
        self.assertEqual(t.seconds, (91820 - 39108) / SR)
        self.assertLess(t.seconds, self.noise.seconds)

    def test_only_a_noise_like_recording_is_trimmed(self):
        melodic = next(s for s in map(golden_source, INDEX["libraries"]["full"]) if s.pitched)
        with self.assertRaises(ValueError):
            trimmed(melodic, self.take, 0.1, 0.5)

    def test_a_placed_recording_keeps_its_trim_when_a_later_analysis_finds_a_pitch(self):
        # 009 was Noise-like until the second pitch window (#282, ADR 0017) found it near G1. Placed
        # on C2 and trimmed, it keeps both: the user chose them.
        found = next(s for s in map(golden_source, INDEX["libraries"]["full"]) if s.id == "009")
        self.assertTrue(found.pitched)
        y = np.arange(1000, dtype=np.float32)
        t = placed(trimmed(found, y, 100 / SR, 400 / SR, placed_by_ear=True), C2)
        np.testing.assert_array_equal(t.audio, y[100:400])
        self.assertEqual((t.ref_midi, t.start, t.end), (36.0, 100, 400))

    def test_melody_fit_counts_the_trimmed_length(self):
        # The small library's Melodic Recordings and 065 placed on C2: Mary and the Saints unlock
        # with the whole fart (1.49 s) and with the trim at 0.89 to 2.08 s (1.20 s), on 065. A trim
        # to one burst, 0.25 s, is too short for the note it played, and both lock again.
        small = [golden_source(rid) for rid in ("002", "016", "022", "069", "090")]
        self.assertTrue(all(s.pitched for s in small))
        whole = placed(self.noise, C2)
        kept = placed(trimmed(self.noise, self.take, 39108 / SR, 91820 / SR), C2)
        burst_only = placed(trimmed(self.noise, self.take, 59398 / SR, 59398 / SR + 0.25), C2)
        for sid in ("mary", "saints"):
            m = melody(SONGS[sid])
            self.assertFalse(melody_fit(m, small).unlocked, sid)
            for lib in ([*small, whole], [*small, kept]):
                f = melody_fit(m, lib)
                self.assertTrue(f.unlocked, sid)
                self.assertIn("065", f.recording_for_pitch.values(), sid)
            self.assertFalse(melody_fit(m, [*small, burst_only]).unlocked, sid)


if __name__ == "__main__":
    unittest.main()
