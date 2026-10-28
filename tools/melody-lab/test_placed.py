"""A Noise-like Recording placed on a note by ear (placed(), ADR 0015) counts in melody_fit() as a
Melodic Recording whose Recording Pitch is that note; left out, it counts for nothing, as before.
Runs on the golden Songs and Recordings in fixtures/golden/, without audio.
`apps/web/src/lib/engine/auto-map.test.ts` checks the same Arrangements on the web.

    .venv/bin/python -I -m unittest discover -s . -p 'test_*.py'    # from tools/melody-lab
"""
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE)]

from engine import PLACED_MIN_NOTE_S, melody_fit, placed  # noqa: E402
from test_needed_seconds import INDEX, SONGS, golden_source, melody  # noqa: E402

FULL = [golden_source(rid) for rid in INDEX["libraries"]["full"]]
C2 = 36


def fit(song_id, sources):
    return melody_fit(melody(SONGS[song_id]), sources)


class Placed(unittest.TestCase):
    def test_counts_as_melodic_at_its_note_with_the_slowest_shortest_note(self):
        noise = next(s for s in FULL if s.id == "080")
        self.assertFalse(noise.pitched)
        p = placed(noise, C2)
        self.assertTrue(p.pitched)
        self.assertEqual((p.ref_midi, p.min_note_s, p.settle_s), (36.0, PLACED_MIN_NOTE_S, 0.0))
        self.assertEqual(p.seconds, noise.seconds)  # its own length: it still plays raw

    def test_only_a_noise_like_recording_is_placed(self):
        melodic = next(s for s in FULL if s.pitched)
        with self.assertRaises(ValueError):
            placed(melodic, C2)

    def test_left_out_it_changes_nothing(self):
        melodic = [s for s in FULL if s.pitched]
        self.assertLess(len(melodic), len(FULL))
        for sid in SONGS:
            self.assertEqual(fit(sid, FULL), fit(sid, melodic), sid)

    def test_placed_it_covers_a_note_nothing_else_does(self):
        # The full golden library leaves jingle, row, amazing and auld locked. Recording 080 is
        # Noise-like and 1.98 s long: placed on C2, it unlocks all but amazing, which still needs a
        # 3 s fart, now near C3 in another key.
        lib = [placed(s, C2) if s.id == "080" else s for s in FULL]
        expected = {  # Song: (covered, total, Octave Moves, cost, the Song pitch 080 plays)
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


if __name__ == "__main__":
    unittest.main()
