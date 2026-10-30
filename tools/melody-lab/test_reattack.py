"""Checks the re-attack bar (evaluate.py, ADR 0012 as ADR 0016 redefines it): a note counts when the
render holds a re-attack that the dry stretch of the note's own fart doesn't have within
REATTACK_MATCH_S, wherever in the note it falls. A fart's own second burst alone isn't counted.
Runs on synthetic bursts, without audio files.

    .venv/bin/python -I -m unittest discover -s . -p 'test_*.py'    # from tools/melody-lab
"""
import sys
import unittest
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE)]

from evaluate import SR, added_reattacks, reattacks  # noqa: E402

T = np.arange(int(1.2 * SR)) / SR


def burst(start, end, level=0.8):
    """A 150 Hz tone from `start` to `end` seconds, silent elsewhere."""
    return np.where((T >= start) & (T < end), level * np.sin(2 * np.pi * 150 * T), 0.0)


SINGLE = burst(0.0, 0.20)
TWO_BURSTS = burst(0.0, 0.20) + burst(0.30, 0.50)  # a fart with its own second burst, like 002, 084 or 032
RETRIGGER = burst(0.70, 0.90)  # the renderer playing the fart again later in the same note


class ReattacksTest(unittest.TestCase):
    def test_every_reattack_is_listed(self):
        three = TWO_BURSTS + RETRIGGER
        found = reattacks(three)
        self.assertEqual(len(found), 2)
        self.assertAlmostEqual(found[0], 0.30, delta=0.03)
        self.assertAlmostEqual(found[1], 0.70, delta=0.03)

    def test_a_single_burst_has_none(self):
        self.assertEqual(reattacks(SINGLE), [])


class AddedReattacksTest(unittest.TestCase):
    def test_a_retriggered_two_burst_fart_is_caught(self):
        added = added_reattacks(TWO_BURSTS + RETRIGGER, TWO_BURSTS)
        self.assertEqual(len(added), 1)
        self.assertAlmostEqual(added[0], 0.70, delta=0.03)

    def test_a_retriggered_single_burst_fart_is_caught(self):
        added = added_reattacks(SINGLE + RETRIGGER, SINGLE)
        self.assertEqual(len(added), 1)
        self.assertAlmostEqual(added[0], 0.70, delta=0.03)

    def test_a_farts_own_second_burst_alone_is_not_counted(self):
        self.assertEqual(added_reattacks(TWO_BURSTS, TWO_BURSTS), [])
        self.assertEqual(added_reattacks(0.5 * TWO_BURSTS, TWO_BURSTS), [])  # played quieter


if __name__ == "__main__":
    unittest.main()
