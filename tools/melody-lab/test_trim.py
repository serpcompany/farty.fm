import unittest

import librosa
import numpy as np

from analysis import AUDIO_DIR, SR, analyze_recording, lead_in_start, note_segment, read_manifest
from engine import PLACED_MIN_NOTE_S, melody_fit, placed
from golden_inputs import INDEX, SONGS, golden_melody, golden_source
from signals import tone_between
from trim import trim_bounds, trimmed

C2 = 36
FRAME_S = 0.005
PRE_ROLL_S = 0.008
FADE_WINDOW_S = 0.055
SMALL_MELODIC = ("002", "016", "022", "069", "090")
TAKE_065_SAMPLES = 102400
TRIM_065 = (39108, 91820)
ONE_BURST_065 = 59398


def burst(start, end, level=0.5):
    return tone_between(start, end, 2.0, level).astype(np.float32)


BLIP_GAP_FART = burst(0.20, 0.23, 0.1) + burst(0.80, 1.40)


def fixture(rid):
    r = next(r for r in read_manifest() if r["id"] == rid)
    y, _ = librosa.load(AUDIO_DIR / r["filename"], sr=SR, mono=True)
    return y


def full_golden(rid):
    return next(s for s in map(golden_source, INDEX["libraries"]["full"]) if s.id == rid)


class TrimBounds(unittest.TestCase):
    def test_finds_the_fart_between_the_handles(self):
        start, end = trim_bounds(BLIP_GAP_FART, 0.5, 1.9)
        self.assertGreaterEqual(start, 0.80 - PRE_ROLL_S - FRAME_S - 1e-9)
        self.assertLessEqual(start, 0.80)
        self.assertGreater(end, 1.40)
        self.assertLess(end, 1.40 + FADE_WINDOW_S)

    def test_always_lies_within_the_handles(self):
        for handles in [(0.0, 2.0), (0.5, 1.9), (0.9, 1.2), (0.81, 1.39), (0.1, 0.5)]:
            start, end = trim_bounds(BLIP_GAP_FART, *handles)
            self.assertGreaterEqual(round(start * SR), round(handles[0] * SR), handles)
            self.assertLessEqual(round(end * SR), round(handles[1] * SR), handles)
            self.assertLess(start, end, handles)

    def test_the_whole_take_is_the_fart_analysis_found(self):
        start, end, _, _ = note_segment(BLIP_GAP_FART)
        self.assertEqual(trim_bounds(BLIP_GAP_FART, 0.0, len(BLIP_GAP_FART) / SR), (start / SR, end / SR))

    def test_handles_on_the_blip_keep_the_blip(self):
        start, end = trim_bounds(BLIP_GAP_FART, 0.1, 0.5)
        self.assertLessEqual(start, 0.20)
        self.assertLess(end, 0.5)

    def test_a_trim_keeps_samples(self):
        with self.assertRaises(ValueError):
            trim_bounds(BLIP_GAP_FART, 1.0, 1.0)

    def test_recording_065_keeps_its_blip_untrimmed_and_its_two_bursts_between_handles(self):
        y = fixture("065")
        start, end, _, _ = note_segment(y)
        self.assertEqual((start, end), (26048, 91740))
        a, b = trim_bounds(y, 0.8, 2.3)
        self.assertEqual((round(a * SR), round(b * SR)), TRIM_065)
        self.assertEqual(trim_bounds(y, 1.3, 1.7), (ONE_BURST_065 / SR, 74930 / SR))


class Trimmed(unittest.TestCase):
    def setUp(self):
        self.noise = full_golden("065")
        self.take = np.zeros(TAKE_065_SAMPLES, dtype=np.float32)

    def trimmed_065(self):
        return trimmed(self.noise, self.take, TRIM_065[0] / SR, TRIM_065[1] / SR)

    def test_plays_only_the_trim(self):
        y = np.arange(1000, dtype=np.float32)
        t = trimmed(self.noise, y, 100 / SR, 400 / SR)
        np.testing.assert_array_equal(t.audio, y[100:400])
        self.assertEqual((t.start, t.end, t.seconds), (100, 400, 300 / SR))

    def test_finds_its_lead_in_between_the_handles_and_never_before_them(self):
        y = burst(0.20, 0.23, 0.1) + burst(0.74, 0.80, 0.02) + burst(0.80, 1.40)
        handle = round(0.5 * SR)
        start, end = trim_bounds(y, 0.5, 1.9)
        t = trimmed(self.noise, y, start, end, handles=(0.5, 1.9))
        a = round(start * SR)
        self.assertEqual(a - len(t.lead_in), handle + lead_in_start(y[handle : round(1.9 * SR)], a - handle))
        np.testing.assert_array_equal(t.lead_in, y[a - len(t.lead_in) : a])
        self.assertAlmostEqual(len(t.lead_in) / SR, start - 0.74 + PRE_ROLL_S, delta=0.006)

        start, end = trim_bounds(y, 0.77, 1.9)
        t = trimmed(self.noise, y, start, end, handles=(0.77, 1.9))
        self.assertGreaterEqual(round(start * SR) - len(t.lead_in), round(0.77 * SR))
        self.assertGreater(len(t.lead_in), 0)

        self.assertEqual(len(trimmed(self.noise, y, start, end).lead_in), 0)

    def test_on_065_the_lead_in_never_reaches_the_blip(self):
        y = fixture("065")
        src = analyze_recording("065", y)
        start, end = trim_bounds(y, 0.8, 2.3)
        t = trimmed(src, y, start, end, handles=(0.8, 2.3))
        self.assertGreaterEqual(t.start - len(t.lead_in), round(0.8 * SR))
        self.assertLess(src.start - len(src.lead_in), round(0.8 * SR))

    def test_keeps_the_note_it_was_placed_on(self):
        t = placed(self.trimmed_065(), C2)
        self.assertEqual((t.ref_midi, t.min_note_s, t.settle_s), (36.0, PLACED_MIN_NOTE_S, 0.0))
        self.assertEqual(t.seconds, (TRIM_065[1] - TRIM_065[0]) / SR)
        self.assertLess(t.seconds, self.noise.seconds)

    def test_a_melodic_recording_keeps_its_pitch_shortest_note_and_settle_time(self):
        melodic = full_golden("002")
        self.assertTrue(melodic.pitched)
        y = np.arange(1000, dtype=np.float32)
        t = trimmed(melodic, y, 100 / SR, 400 / SR)
        np.testing.assert_array_equal(t.audio, y[100:400])
        self.assertEqual((t.start, t.end), (100, 400))
        self.assertEqual(
            (t.ref_midi, t.min_note_s, t.settle_s), (melodic.ref_midi, melodic.min_note_s, melodic.settle_s)
        )

    def test_a_placed_recording_keeps_its_trim_when_a_later_analysis_finds_a_pitch(self):
        found = full_golden("009")
        self.assertTrue(found.pitched)
        y = np.arange(1000, dtype=np.float32)
        t = placed(trimmed(found, y, 100 / SR, 400 / SR), C2)
        np.testing.assert_array_equal(t.audio, y[100:400])
        self.assertEqual((t.ref_midi, t.start, t.end), (36.0, 100, 400))

    def test_melody_fit_counts_the_trimmed_length(self):
        small = [golden_source(rid) for rid in SMALL_MELODIC]
        self.assertTrue(all(s.pitched for s in small))
        whole = placed(self.noise, C2)
        kept = placed(self.trimmed_065(), C2)
        burst_only = placed(trimmed(self.noise, self.take, ONE_BURST_065 / SR, ONE_BURST_065 / SR + 0.25), C2)
        for sid in ("mary", "saints"):
            m = golden_melody(SONGS[sid])
            self.assertFalse(melody_fit(m, small).unlocked, sid)
            for lib in ([*small, whole], [*small, kept]):
                f = melody_fit(m, lib)
                self.assertTrue(f.unlocked, sid)
                self.assertIn("065", f.recording_for_pitch.values(), sid)
            self.assertFalse(melody_fit(m, [*small, burst_only]).unlocked, sid)

    def test_melody_fit_counts_a_melodic_trim(self):
        small = [golden_source(rid) for rid in SMALL_MELODIC]
        noise = placed(self.trimmed_065(), C2)
        m = golden_melody(SONGS["mary"])
        whole = melody_fit(m, [*small, noise])
        self.assertIn("002", whole.recording_for_pitch.values())
        take = np.zeros(round(4.2 * SR), dtype=np.float32)
        for seconds, plays in ((1.5, True), (0.5, False)):
            cut = [trimmed(s, take, 0.15, 0.15 + seconds) if s.id == "002" else s for s in small]
            self.assertAlmostEqual(cut[0].seconds, seconds, delta=1 / SR)
            fit = melody_fit(m, [*cut, noise])
            self.assertEqual("002" in fit.recording_for_pitch.values(), plays, seconds)
