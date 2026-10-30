"""A Recording placed on a note by ear (placed(), ADR 0015) counts in melody_fit() as a Melodic
Recording whose Recording Pitch is that note; left out, it counts for nothing, as before. A placement
outlasts a later analysis that finds a Recording Pitch (ADR 0017).
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
SMALL = [s for s in FULL if s.id in INDEX["libraries"]["small"]]
C2 = 36


def fit(song_id, sources):
    return melody_fit(melody(SONGS[song_id]), sources)


def recording(rid):
    return next(s for s in FULL if s.id == rid)


class Placed(unittest.TestCase):
    def test_counts_as_melodic_at_its_note_with_the_slowest_shortest_note(self):
        noise = recording("065")
        self.assertFalse(noise.pitched)
        p = placed(noise, C2)
        self.assertTrue(p.pitched)
        self.assertEqual((p.ref_midi, p.min_note_s, p.settle_s), (36.0, PLACED_MIN_NOTE_S, 0.0))
        self.assertEqual(p.seconds, noise.seconds)  # its own length: it still plays raw

    def test_a_placement_outlasts_a_recording_pitch_found_later(self):
        # 009 was Noise-like until the second pitch window (#282) found it near G1.
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

    def test_placed_it_covers_a_note_nothing_else_does(self):
        # The full golden library unlocks every golden Song, and no Noise-like fixture placed on
        # C2 to B4 unlocks one more Song without 002, its longest fart. The small library, all
        # Melodic, leaves jingle and row locked. Recording 065 is Noise-like and 1.49 s long:
        # placed on C2, it unlocks both, but not amazing, which still needs a 3 s fart.
        noise = recording("065")
        lib = [*SMALL, placed(noise, C2)]
        expected = {  # Song: (covered, total, Octave Moves, cost, the Song pitch 065 plays)
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


if __name__ == "__main__":
    unittest.main()
