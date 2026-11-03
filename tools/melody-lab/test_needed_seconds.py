import unittest

from analysis import SR
from engine import GAP_S, fills, melody_fit, needed_seconds
from golden_cost import load
from golden_inputs import INDEX, SONGS, golden_library, golden_melody, source
from signals import samples


class NeededSeconds(unittest.TestCase):
    def test_states_the_shortest_tenth_that_fills_every_pitch(self):
        n = 0
        for sid, song in SONGS.items():
            spb = 60 / song["bpm"]
            for p in sorted({x["pitch"] for x in song["notes"]}):
                longest = max(x["dur"] * spb - GAP_S for x in song["notes"] if x["pitch"] == p)
                needed = needed_seconds(longest)
                self.assertTrue(fills(samples(needed) / SR, longest), (sid, p, needed))
                self.assertFalse(fills(samples(needed - 0.1) / SR, longest), (sid, p, needed))
                n += 1
        self.assertGreater(n, 70)

    def test_a_fart_as_long_as_stated_unlocks_the_song(self):
        locked = locked_in_golden = 0
        for library in INDEX["libraries"]:
            sources = golden_library(library)
            for sid, song in SONGS.items():
                golden = load(f"arrangements/{library}/{sid}.json")
                locked_in_golden += not golden["unlocked"]
                fit = melody_fit(golden_melody(song), sources)
                if fit.unlocked:
                    continue
                locked += 1
                missing = [{"target_midi": m, "seconds": s} for m, s in fit.missing]
                self.assertEqual(missing, golden["missing"], (library, sid))
                for from_note in (-3, 3, -12, 12):
                    farts = [source(f"new-{m}", m + from_note, samples(s), 0.1, 0.0) for m, s in fit.missing]
                    after = melody_fit(golden_melody(song), sources + farts)
                    self.assertTrue(after.unlocked, (library, sid, from_note, fit.missing))
        self.assertEqual(locked, locked_in_golden)
        self.assertGreater(locked, 0)
