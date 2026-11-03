"""A note shorter than the gap before the next note (GAP_S) has no time left to sound, not a
negative time (#332). A negative slot made unsettled_cost() about -1e8 a note, so melody_fit()'s
penalties no longer ranked choices: it crashed with a TypeError on Bolero's ornaments, or left a
pitch uncovered that a Recording covers. Runs without audio.
`apps/web/src/lib/engine/auto-map.test.ts` checks the same on the web.

    .venv/bin/python -I -m unittest discover -s . -p 'test_*.py'    # from tools/melody-lab
"""
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE)]

from engine import GAP_S, TOO_SHORT_COST, TOO_SHORT_COST_PER_S, UNSETTLED_COST, melody_fit  # noqa: E402
from melody import Melody, Note  # noqa: E402
from test_needed_seconds import samples, source  # noqa: E402

BPM = 120
ORNAMENT = 0.02  # beats: 10 ms at BPM, shorter than GAP_S
MIN_NOTE_S = 0.1
SETTLE_S = 0.05


def recording(rid, midi):
    return source(rid, float(midi), samples(1.0), MIN_NOTE_S, SETTLE_S)


class ShortNotes(unittest.TestCase):
    def test_the_ornament_is_shorter_than_the_gap(self):
        self.assertLess(ORNAMENT * 60 / BPM, GAP_S)

    def test_two_ornaments_on_one_recording_leave_one_pitch_uncovered(self):
        """The smallest melody that crashed in key() before #332, as Bolero did."""
        song = Melody("ornaments", BPM, 4, [Note(0, ORNAMENT, 60), Note(ORNAMENT, ORNAMENT, 61)], [])
        fit = melody_fit(song, [recording("a", 60)])
        self.assertEqual((fit.transpose, fit.recording_for_pitch, fit.octave_moves), (0, {60: "a", 61: None}, 0))
        # an ornament sounds for no time: too short to settle, with nothing played unsettled
        self.assertEqual(fit.cost, TOO_SHORT_COST + TOO_SHORT_COST_PER_S * MIN_NOTE_S)
        self.assertEqual(fit.missing, [(61, 0.0)])

    def test_an_ornament_keeps_its_recording(self):
        """Before #332 this left the ornament uncovered and moved the other note an octave."""
        song = Melody("ornament", BPM, 4, [Note(0, ORNAMENT, 60), Note(ORNAMENT, 1.0, 66)], [])
        fit = melody_fit(song, [recording("a", 60), recording("b", 66)])
        self.assertEqual((fit.transpose, fit.recording_for_pitch, fit.octave_moves), (0, {60: "a", 66: "b"}, 0))
        self.assertEqual(fit.longest_note_s[60], 0.0)
        held = 1.0 * 60 / BPM - GAP_S
        self.assertAlmostEqual(fit.cost, TOO_SHORT_COST + TOO_SHORT_COST_PER_S * MIN_NOTE_S
                               + UNSETTLED_COST * SETTLE_S / held, places=9)


if __name__ == "__main__":
    unittest.main()
