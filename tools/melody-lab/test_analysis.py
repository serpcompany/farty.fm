import unittest

import numpy as np

from analysis import (
    HOP,
    SR,
    analyze_recording,
    cubic_read,
    hop_rates,
    load_library,
    note_segment,
    variable_resample,
    weighted_median,
)
from golden_cost import load
from signals import burst, faded, harmonic, padded, samples


class NoteSegment(unittest.TestCase):
    def test_finds_the_sound_from_just_before_its_onset_to_where_it_fades(self):
        start, end, pitch_end, cut = note_segment(padded(burst(), 0.2, 0.3))
        self.assertTrue(0.19 <= start / SR <= 0.2, start / SR)
        self.assertTrue(0.7 <= end / SR <= 0.75, end / SR)
        self.assertEqual(pitch_end, end)
        self.assertFalse(cut)

    def test_keeps_every_burst_and_ends_the_pitch_at_the_second_attack(self):
        two = np.concatenate([burst(), np.zeros(samples(0.15)), burst()])
        start, end, pitch_end, cut = note_segment(padded(two, 0.2, 0.3))
        self.assertTrue(cut)
        self.assertTrue(0.7 <= pitch_end / SR < 0.85, pitch_end / SR)
        self.assertTrue(1.35 <= end / SR <= 1.4, end / SR)


class PitchArithmetic(unittest.TestCase):
    def test_weighted_median_is_where_half_the_weight_lies(self):
        self.assertEqual(weighted_median(np.array([3.0, 1.0, 2.0]), np.array([1.0, 1.0, 1.0])), 2.0)
        self.assertEqual(weighted_median(np.array([1.0, 2.0, 3.0]), np.array([1.0, 1.0, 10.0])), 3.0)

    def test_cubic_read_hits_the_samples_and_interpolates_a_ramp(self):
        x = np.arange(10.0)
        self.assertTrue(np.array_equal(cubic_read(x, np.arange(1.0, 8.0)), x[1:8]))
        self.assertTrue(np.allclose(cubic_read(x, np.array([2.5, 4.25])), [2.5, 4.25]))

    def test_without_a_pitch_the_read_back_is_the_recording(self):
        x = harmonic(220.0, 0.1)
        f0 = np.full(1 + len(x) // HOP, np.nan)
        self.assertTrue(np.array_equal(variable_resample(x, f0, 1000, None), x[:1000]))
        self.assertTrue(np.array_equal(hop_rates(f0, 57.0), np.ones(len(f0))))

    def test_a_flat_fart_is_read_faster_to_hold_its_pitch(self):
        f0 = np.full(20, 220.0)
        self.assertTrue(np.allclose(hop_rates(f0, 58.0), 2 ** (1 / 12)))
        self.assertTrue(np.allclose(hop_rates(f0, 70.0), 2 ** (5 / 12)))


class AnalyzeRecording(unittest.TestCase):
    def test_a_steady_tone_is_melodic_at_its_pitch(self):
        src = analyze_recording("tone", padded(faded(harmonic(110.0, 1.0), 0.02) * 0.3, 0.1, 0.1))
        self.assertAlmostEqual(src.ref_midi, 45.0259, places=3)
        self.assertEqual(src.pitch_estimate, src.ref_midi)
        self.assertEqual((src.pitch_confidence, src.min_note_s, src.settle_s), (1.0, 0.12, 0.0))
        self.assertFalse(src.cut_at_reattack)
        self.assertAlmostEqual(src.seconds, (src.end - src.start) / SR)

    def test_noise_is_noise_like(self):
        noise = np.random.default_rng(7).standard_normal(samples(1.0)) * 0.1
        src = analyze_recording("noise", padded(faded(noise, 0.02), 0.1, 0.1))
        self.assertFalse(src.pitched)
        self.assertIsNone(src.pitch_estimate)
        self.assertEqual(src.pitch_confidence, 0.0)

    def test_matches_the_golden_analysis_of_fixture_recordings(self):
        for src in load_library({"009", "016"}):
            golden = load(f"recordings/{src.id}.json")
            with self.subTest(recording=src.id):
                gesture = golden["gesture"]
                self.assertEqual((src.start, src.end), (gesture["start_sample"], gesture["end_sample"]))
                self.assertEqual(src.pitch_end, gesture["pitch_end_sample"])
                self.assertEqual(src.start - len(src.lead_in), gesture["lead_start_sample"])
                self.assertEqual(src.ref_midi, golden["recording_pitch_midi"])
                self.assertEqual(src.pitch_estimate, golden["pitch_estimate_midi"])
                self.assertEqual(src.pitch_confidence, golden["pitch_confidence"])
                self.assertEqual(len(src.f0), golden["pitch_contour"]["frames"])
                if src.pitched:
                    self.assertEqual((src.min_note_s, src.settle_s), (golden["shortest_note_s"], golden["settle_s"]))
