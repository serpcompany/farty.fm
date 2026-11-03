import unittest

from engine import PLACED_MIN_NOTE_S, melody_fit, placed
from golden_inputs import INDEX, SONGS, golden_library, golden_melody

FULL = golden_library("full")
SMALL = [s for s in FULL if s.id in INDEX["libraries"]["small"]]
C2 = 36


def fit(song_id, sources):
    return melody_fit(golden_melody(SONGS[song_id]), sources)


def recording(rid):
    return next(s for s in FULL if s.id == rid)


class Placed(unittest.TestCase):
    def test_counts_as_melodic_at_its_note_with_the_slowest_shortest_note(self):
        noise = recording("065")
        self.assertFalse(noise.pitched)
        p = placed(noise, C2)
        self.assertTrue(p.pitched)
        self.assertEqual((p.ref_midi, p.min_note_s, p.settle_s), (36.0, PLACED_MIN_NOTE_S, 0.0))
        self.assertEqual(p.seconds, noise.seconds)

    def test_a_placement_outlasts_a_recording_pitch_the_second_window_found_later(self):
        found = recording("009")
        self.assertAlmostEqual(found.ref_midi, 30.5259, places=4)
        p = placed(found, C2)
        self.assertEqual((p.ref_midi, p.min_note_s, p.settle_s), (36.0, PLACED_MIN_NOTE_S, 0.0))
        self.assertEqual(p.seconds, found.seconds)

    def test_left_out_it_changes_nothing(self):
        melodic = [s for s in FULL if s.pitched]
        self.assertLess(len(melodic), len(FULL))
        for sid in SONGS:
            self.assertEqual(fit(sid, FULL), fit(sid, melodic), sid)

    def test_065_placed_on_c2_unlocks_jingle_and_row_on_the_small_library_but_amazing_still_needs_3_s(self):
        noise = recording("065")
        lib = [*SMALL, placed(noise, C2)]
        expected = {
            "jingle": (5, 5, 2, 260.0875, 67),
            "row": (6, 6, 2, 821.0865, 67),
        }
        for sid, (covered, total, octaves, cost, pitch) in expected.items():
            self.assertTrue(fit(sid, FULL).unlocked, sid)
            self.assertFalse(fit(sid, [*SMALL, noise]).unlocked, sid)
            f = fit(sid, lib)
            self.assertEqual((f.covered, f.total, f.octave_moves), (covered, total, octaves), sid)
            self.assertAlmostEqual(f.cost, cost, places=3, msg=sid)
            self.assertEqual([p for p, r in f.recording_for_pitch.items() if r == "065"], [pitch], sid)
        self.assertEqual(fit("amazing", lib).missing, [(50, 3.0)])
