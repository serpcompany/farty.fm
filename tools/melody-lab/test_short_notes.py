import unittest

from engine import GAP_S, TOO_SHORT_COST, TOO_SHORT_COST_PER_S, UNSETTLED_COST, melody_fit
from golden_inputs import source
from melody import Melody, Note
from signals import samples

BPM = 120
ORNAMENT_BEATS = 0.02
MIN_NOTE_S = 0.1
SETTLE_S = 0.05


def recording(rid, midi):
    return source(rid, float(midi), samples(1.0), MIN_NOTE_S, SETTLE_S)


class ShortNotes(unittest.TestCase):
    def test_the_ornament_is_shorter_than_the_gap(self):
        self.assertLess(ORNAMENT_BEATS * 60 / BPM, GAP_S)

    def test_two_ornaments_on_one_recording_leave_one_pitch_uncovered(self):
        song = Melody("ornaments", BPM, 4, [Note(0, ORNAMENT_BEATS, 60), Note(ORNAMENT_BEATS, ORNAMENT_BEATS, 61)], [])
        fit = melody_fit(song, [recording("a", 60)])
        self.assertEqual((fit.transpose, fit.recording_for_pitch, fit.octave_moves), (0, {60: "a", 61: None}, 0))
        self.assertEqual(fit.cost, TOO_SHORT_COST + TOO_SHORT_COST_PER_S * MIN_NOTE_S)
        self.assertEqual(fit.missing, [(61, 0.0)])

    def test_an_ornament_keeps_its_recording(self):
        song = Melody("ornament", BPM, 4, [Note(0, ORNAMENT_BEATS, 60), Note(ORNAMENT_BEATS, 1.0, 66)], [])
        fit = melody_fit(song, [recording("a", 60), recording("b", 66)])
        self.assertEqual((fit.transpose, fit.recording_for_pitch, fit.octave_moves), (0, {60: "a", 66: "b"}, 0))
        self.assertEqual(fit.longest_note_s[60], 0.0)
        held = 1.0 * 60 / BPM - GAP_S
        self.assertAlmostEqual(fit.cost, TOO_SHORT_COST + TOO_SHORT_COST_PER_S * MIN_NOTE_S
                               + UNSETTLED_COST * SETTLE_S / held, places=9)
