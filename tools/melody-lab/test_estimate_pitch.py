import unittest

import librosa
import numpy as np

from analysis import HOP, PITCH_WINDOW_S, SR, estimate_pitch, load_library

WINDOW = int(PITCH_WINDOW_S * SR / HOP)


def contour(frames, voiced, hz, level_db=0.0):
    f0 = np.full(frames, np.nan)
    f0[voiced] = hz
    rms = np.ones(frames)
    rms[voiced] = 10 ** (level_db / 20)
    return f0, rms


class SecondWindow(unittest.TestCase):
    def test_a_few_quiet_frames_at_the_end_of_a_short_burst_are_no_note(self):
        n_body = int(0.257 * SR)
        f0, rms = contour(45, slice(41, 45), 45.0, level_db=-48)
        self.assertEqual(estimate_pitch(f0, rms, n_body, 0)[0], None)
        midi, conf = estimate_pitch(f0, rms, n_body, 41)
        self.assertIsNone(midi)
        self.assertAlmostEqual(conf, 4 / 45, places=6)

    def test_counts_coverage_against_the_whole_window_when_the_burst_is_longer(self):
        n_body = 169 * HOP
        f0, rms = contour(169, slice(50, 80), 49.0)
        midi, conf = estimate_pitch(f0, rms, n_body, 50)
        self.assertAlmostEqual(conf, 30 / WINDOW, places=6)
        self.assertAlmostEqual(midi, float(librosa.hz_to_midi(49.0)), places=6)


class OwnerFart(unittest.TestCase):
    def test_the_owners_fart_107_has_no_note(self):
        (src,) = load_library({"107"})
        self.assertIsNone(src.pitch_estimate)
        self.assertFalse(src.pitched)
        self.assertEqual(src.pitch_confidence, 0.09)
