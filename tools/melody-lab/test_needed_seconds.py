"""The length a locked Song says it needs ("Needs a fart near F3 (3.0 s)", needed_seconds()) unlocks
it (#227): a fart that long, 3 semitones below or above the note or an octave away, covers it.
Songs play every fart at its own length (ADR 0012), so its pitch doesn't change the length it
needs. Runs melody_fit() on the golden Songs and Recordings in fixtures/golden/, without audio.
`apps/web/src/lib/engine/auto-map.test.ts` checks the same on the web.

    .venv/bin/python -I -m unittest discover -s . -p 'test_*.py'    # from tools/melody-lab
"""
import json
import sys
import unittest
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE)]

from engine import GAP_S, ROOT, SR, Source, fills, melody_fit, needed_seconds  # noqa: E402
from melody import Melody, Note  # noqa: E402

GOLDEN = ROOT / "fixtures/golden"


def load(rel):
    return json.loads((GOLDEN / rel).read_text())


INDEX = load("index.json")
SONGS = {s["id"]: load(f"songs/{s['id']}.json") for s in INDEX["songs"]}


def melody(song):
    notes = [Note(n["start"], n["dur"], n["pitch"]) for n in song["notes"]]
    return Melody(song["title"], song["bpm"], song["beats_per_bar"], notes, song["bar_lines"])


def source(rid, ref_midi, samples, min_note_s, settle_s):
    """A Source as melody_fit() reads it: its id, Recording Pitch, length in samples and the
    analysis its costs use. The audio is silent: melody_fit() only measures its length."""
    return Source(rid, False, np.zeros(samples, dtype=np.float32), np.zeros(0), ref_midi, 1.0, 0.0,
                  min_note_s=min_note_s, settle_s=settle_s)


def golden_source(rid):
    r = load(f"recordings/{rid}.json")
    g = r["gesture"]
    if not r["melodic"]:
        return source(rid, None, g["end_sample"] - g["start_sample"], 0.0, 0.0)
    return source(rid, r["recording_pitch_midi"], g["end_sample"] - g["start_sample"],
                  r["shortest_note_s"], r["settle_s"])


def samples(seconds):
    """A fart of `seconds`, in whole samples, as Recording Analysis measures one."""
    return round(seconds * SR)


class NeededSeconds(unittest.TestCase):
    def test_states_the_shortest_tenth_that_fills_every_pitch(self):
        n = 0
        for sid, song in SONGS.items():
            spb = 60 / song["bpm"]
            for p in sorted({x["pitch"] for x in song["notes"]}):
                # As melody_fit() measures a pitch's longest note, to the last bit.
                longest = max(x["dur"] * spb - GAP_S for x in song["notes"] if x["pitch"] == p)
                needed = needed_seconds(longest)
                self.assertTrue(fills(samples(needed) / SR, longest), (sid, p, needed))
                self.assertFalse(fills(samples(needed - 0.1) / SR, longest), (sid, p, needed))
                n += 1
        self.assertGreater(n, 70)

    def test_a_fart_as_long_as_stated_unlocks_the_song(self):
        locked = locked_in_golden = 0
        for library, ids in INDEX["libraries"].items():
            sources = [golden_source(rid) for rid in ids]
            for sid, song in SONGS.items():
                golden = load(f"arrangements/{library}/{sid}.json")
                locked_in_golden += not golden["unlocked"]
                fit = melody_fit(melody(song), sources)
                if fit.unlocked:
                    continue
                locked += 1
                missing = [{"target_midi": m, "seconds": s} for m, s in fit.missing]
                self.assertEqual(missing, golden["missing"], (library, sid))
                for from_note in (-3, 3, -12, 12):
                    farts = [source(f"new-{m}", m + from_note, samples(s), 0.1, 0.0) for m, s in fit.missing]
                    after = melody_fit(melody(song), sources + farts)
                    self.assertTrue(after.unlocked, (library, sid, from_note, fit.missing))
        self.assertEqual(locked, locked_in_golden)
        self.assertGreater(locked, 0)


if __name__ == "__main__":
    unittest.main()
