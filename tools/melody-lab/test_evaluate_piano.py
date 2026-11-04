"""evaluate_piano.py's loudness, against BS.1770-4's own reference: a 997 Hz sine whose RMS is
-23 dBFS reads -23.0 LUFS, at the rate the browser captured it in (44.1 or 48 kHz), and the gate
leaves silence out, so how long a Toot's tail or the WAV's lead-in is doesn't change it.

    .venv/bin/python -I -m unittest discover -s . -p 'test_*.py'    # from tools/melody-lab
"""
import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

from evaluate_piano import integrated_lufs  # noqa: E402


def sine(rate, seconds=5.0, amplitude=0.1):
    t = np.arange(int(rate * seconds)) / rate
    return amplitude * np.sin(2 * np.pi * 997 * t)


class LoudnessTest(unittest.TestCase):
    def test_reads_bs1770s_reference_sine(self):
        for rate in (44100, 48000):
            self.assertAlmostEqual(integrated_lufs(sine(rate), rate), -23.0, delta=0.05, msg=rate)

    def test_silence_around_the_sound_is_gated_out(self):
        rate = 48000

        def padded(seconds):
            silence = np.zeros(int(rate * seconds))
            return integrated_lufs(np.concatenate([silence, sine(rate), silence]), rate)

        # Silent blocks are gated out: only the ones that straddle an edge count, however long it is.
        self.assertAlmostEqual(padded(1), padded(10), delta=0.01)

    def test_twice_the_amplitude_is_6_db_louder(self):
        rate = 44100
        step = integrated_lufs(sine(rate, amplitude=0.2), rate) - integrated_lufs(sine(rate), rate)
        self.assertAlmostEqual(step, 6.02, delta=0.05)


if __name__ == "__main__":
    unittest.main()
