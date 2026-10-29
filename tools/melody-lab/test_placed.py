import unittest

from engine import PLACED_MIN_NOTE_S, melody_fit, placed
from golden_inputs import SONGS, golden_library, golden_melody

FULL = golden_library("full")
C2 = 36


def fit(song_id, sources):
    return melody_fit(golden_melody(SONGS[song_id]), sources)


class Placed(unittest.TestCase):
    def test_counts_as_melodic_at_its_note_with_the_slowest_shortest_note(self):
        noise = next(s for s in FULL if s.id == "080")
        self.assertFalse(noise.pitched)
        p = placed(noise, C2)
        self.assertTrue(p.pitched)
        self.assertEqual((p.ref_midi, p.min_note_s, p.settle_s), (36.0, PLACED_MIN_NOTE_S, 0.0))
        self.assertEqual(p.seconds, noise.seconds)

    def test_only_a_noise_like_recording_is_placed(self):
        melodic = next(s for s in FULL if s.pitched)
        with self.assertRaises(ValueError):
            placed(melodic, C2)

    def test_left_out_it_changes_nothing(self):
        melodic = [s for s in FULL if s.pitched]
        self.assertLess(len(melodic), len(FULL))
        for sid in SONGS:
            self.assertEqual(fit(sid, FULL), fit(sid, melodic), sid)

    def test_080_placed_on_c2_unlocks_all_but_amazing_which_still_needs_3_s_near_c3(self):
        lib = [placed(s, C2) if s.id == "080" else s for s in FULL]
        expected = {
            "jingle": (5, 5, 1, 1072.2936, 64),
            "row": (6, 6, 0, 602.4985, 67),
            "amazing": (5, 6, 0, 71.9576, 62),
            "auld": (7, 7, 2, 753.871, 65),
        }
        for sid, (covered, total, octaves, cost, pitch) in expected.items():
            self.assertFalse(fit(sid, FULL).unlocked, sid)
            f = fit(sid, lib)
            self.assertEqual((f.covered, f.total, f.octave_moves), (covered, total, octaves), sid)
            self.assertAlmostEqual(f.cost, cost, places=3, msg=sid)
            self.assertEqual([p for p, r in f.recording_for_pitch.items() if r == "080"], [pitch], sid)
        self.assertEqual(fit("amazing", lib).missing, [(48, 3.0)])
