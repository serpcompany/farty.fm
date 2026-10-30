"""Checks the Recording Pitch estimate's two windows (engine.py estimate_pitch(), ADR 0017): the
second window counts its coverage as the head does, so a few quiet frames at the end of a short
first burst never make a note (#295, the owner-3 case): on synthetic contours, and on the owner's
fart 107 from the Fixture Library.

    .venv/bin/python -I -m unittest discover -s . -p 'test_*.py'    # from tools/melody-lab
"""
import sys
import unittest
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE)]

import engine as E  # noqa: E402

WINDOW = int(E.PITCH_WINDOW_S * E.SR / E.HOP)


def contour(frames, voiced, hz, level_db=0.0):
    """`frames` contour frames, voiced at `hz` over the slice `voiced`, the rest loud and unvoiced."""
    f0 = np.full(frames, np.nan)
    f0[voiced] = hz
    rms = np.ones(frames)
    rms[voiced] = 10 ** (level_db / 20)
    return f0, rms


class SecondWindowTest(unittest.TestCase):
    def test_a_few_quiet_frames_at_the_end_of_a_short_burst_are_no_note(self):
        # owner-3: a 0.257 s first burst (45 frames), voiced only in its last 4, at pYIN's 45 Hz floor
        n_body = int(0.257 * E.SR)
        f0, rms = contour(45, slice(41, 45), 45.0, level_db=-48)
        self.assertEqual(E.estimate_pitch(f0, rms, n_body, 0)[0], None)
        midi, conf = E.estimate_pitch(f0, rms, n_body, 41)
        self.assertIsNone(midi)
        self.assertAlmostEqual(conf, 4 / 45, places=6)

    def test_counts_coverage_against_the_whole_window_when_the_burst_is_longer(self):
        # 009's shape: a long first burst whose tone starts late and fills part of the window
        n_body = 169 * E.HOP
        f0, rms = contour(169, slice(50, 80), 49.0)
        midi, conf = E.estimate_pitch(f0, rms, n_body, 50)
        self.assertAlmostEqual(conf, 30 / WINDOW, places=6)
        self.assertAlmostEqual(midi, float(E.librosa.hz_to_midi(49.0)), places=6)


class OwnerFartTest(unittest.TestCase):
    def test_the_owners_fart_107_has_no_note(self):
        # owner-3 in #295's measurement, from the Fixture Library: the false 45 Hz note's case
        (src,) = E.load_library({"107"})
        self.assertIsNone(src.pitch_estimate)
        self.assertFalse(src.pitched)
        self.assertEqual(src.pitch_confidence, 0.09)


if __name__ == "__main__":
    unittest.main()
