"""A fart's quiet lead-in plays before its note's beat (#287): the attack lands on the beat, the
lead-in plays just before it, in the rest before the note, never in the gap after the note before
nor before the Song's start, and the level is still set from the attack. The lead-in is the sound
joined to the attack, so room noise before a gap isn't, and it is at most 0.25 s. Runs render() on synthetic farts, and on Recording 009
placed by ear on G3, whose G3 opening comes before its attack.
`apps/web/src/lib/engine/renderer.test.ts` checks the same on the web.

    .venv/bin/python -I -m unittest discover -s . -p 'test_*.py'    # from tools/melody-lab
"""
import sys
import unittest
from pathlib import Path

import librosa
import numpy as np

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE)]

from engine import SR, Assignment, Source, lead_in_start, load_library, placed, plan, render  # noqa: E402
from evaluate import bar_problems, evaluate  # noqa: E402
from melody import Melody, Note, load_catalog  # noqa: E402

G3 = 55
BPM = 60.0  # one beat is one second


def fart(rid, lead_s, body_s, lead=0.02, level=0.5):
    """A fart that opens on a quiet lead_s lead-in, then holds `level` for body_s."""
    return Source(rid, False, np.full(int(body_s * SR), level), np.zeros(0), None, 0.0, 0.0,
                  lead_in=np.full(int(lead_s * SR), lead))


def song(notes):
    """Notes as (start, dur) in beats, at 60 bpm, with no bar lines (so no accents)."""
    return Melody("t", BPM, 4, [Note(s, d, 60) for s, d in notes], [])


def assign(ids):
    return [Assignment(i, rid, 60, 0.0) for i, rid in enumerate(ids)]


def beat(n):
    return int(n.start * SR)


class LeadInStart(unittest.TestCase):
    def test_a_quiet_sound_before_the_attack_is_the_lead_in(self):
        y = np.concatenate([np.zeros(SR // 10), np.full(SR // 5, 0.05), np.full(SR // 2, 0.5)])  # 20 dB down
        hop = int(0.005 * SR)
        attack = SR // 10 + SR // 5 - int(0.008 * SR)  # note_segment()'s start on this take
        start = lead_in_start(y, attack)
        self.assertAlmostEqual(start / SR, 0.1 - 0.008, delta=hop / SR)  # its quiet sound, from 8 ms before it

    def test_a_fart_that_opens_loud_has_a_frame_at_most(self):
        y = np.concatenate([np.zeros(SR // 10), np.full(SR // 2, 0.5)])
        attack = SR // 10 - int(0.008 * SR)
        self.assertLessEqual(attack - lead_in_start(y, attack), int(0.005 * SR))  # one 5 ms frame at most

    def test_a_short_gap_stays_in_the_lead_in(self):
        # a 30 ms dip 54 dB down inside the lead-in, as between two puffs of one fart
        y = np.concatenate([np.zeros(SR // 10), np.full(SR // 10, 0.05), np.full(int(0.03 * SR), 0.001),
                            np.full(SR // 20, 0.05), np.full(SR // 2, 0.5)])
        attack = SR // 10 + SR // 10 + int(0.03 * SR) + SR // 20 - int(0.008 * SR)
        self.assertAlmostEqual(lead_in_start(y, attack) / SR, 0.1 - 0.008, delta=0.005)

    def test_a_sound_before_a_longer_gap_is_room_noise(self):
        # As on the owner's phone takes (#295): a bump of room noise 20 dB down, then 0.3 s of quieter
        # noise 40 dB down, then the fart. The bump isn't the fart's, so the lead-in is a frame at most.
        y = np.concatenate([np.full(SR, 0.005), np.full(SR // 10, 0.05), np.full(int(0.3 * SR), 0.005),
                            np.full(SR // 2, 0.5)])
        attack = SR + SR // 10 + int(0.3 * SR) - int(0.008 * SR)
        self.assertLessEqual(attack - lead_in_start(y, attack), int(0.005 * SR))

    def test_the_lead_in_is_at_most_a_quarter_second(self):
        # room noise loud enough (20 dB down) to join the attack, for 1 s before it
        y = np.concatenate([np.full(SR, 0.05), np.full(SR // 2, 0.5)])
        attack = SR - int(0.008 * SR)
        self.assertEqual(attack - lead_in_start(y, attack), int(0.25 * SR))


class Placement(unittest.TestCase):
    # a: 0.5 s with a 0.3 s lead-in; b: 2 s, so it fills its note and leaves only the gap.
    # Note 0 starts 0.1 s in; a half-beat rest comes after it, none after note 1 and 0.2 s after note 2.
    A, B = fart("a", 0.3, 0.5), fart("b", 0.3, 2.0)
    M = song([(0.1, 0.5), (1.1, 1), (2.1, 0.8), (3.1, 1)])
    MIX, EVENTS = render(M, [A, B], assign(["a", "a", "b", "a"]))
    FADE_IN = int(0.003 * SR)

    def test_every_attack_lands_on_its_beat(self):
        for n, e in zip(self.M.notes, self.EVENTS):
            self.assertEqual(e["start_s"], round(n.start, 3))
            at = beat(n)
            lead = round(e["lead_s"] * SR)
            loud = np.abs(self.MIX[at - lead : at + 500]) >= 0.5 * np.abs(self.MIX[at + 500])
            first = int(np.argmax(loud)) - lead
            if lead:
                self.assertEqual(first, 0, n)  # the first loud sample is the beat
            else:
                self.assertTrue(0 <= first <= self.FADE_IN, n)  # within the fade-in from the beat

    def test_the_lead_in_plays_in_the_rest_before_the_beat(self):
        # cut at the Song's start; all of it in a half-beat rest; none after a legato note (the gap
        # stays silent); the 0.2 s of a rest shorter than it
        expected = [0.1, 0.3, 0.0, 0.2]
        written_end = [0] + [int((n.start + n.dur) * SR) for n in self.M.notes[:-1]]
        for n, e, want, until in zip(self.M.notes, self.EVENTS, expected, written_end):
            self.assertAlmostEqual(e["lead_s"], want, delta=0.001)
            self.assertGreaterEqual(beat(n) - round(e["lead_s"] * SR), until - 1, n)  # never before the note before ends
            if want:
                self.assertGreater(np.abs(self.MIX[beat(n) - round(e["lead_s"] * SR) + 200]), 0, n)  # it sounds

    def test_silence_stays_where_nothing_reaches(self):
        # a's first note stops at 0.575 s (its half beat less the gap) and its next lead-in starts at 0.8 s
        self.assertEqual(np.abs(self.MIX[int(0.58 * SR) : int(0.79 * SR)]).max(), 0.0)
        # the gap after note 1 (2.075 to 2.1 s) stays silent: b's lead-in doesn't fill it
        self.assertEqual(np.abs(self.MIX[int(2.076 * SR) : int(2.1 * SR)]).max(), 0.0)

    def test_the_level_is_set_from_the_attack(self):
        # Read from the start of the lead-in, its quiet 0.3 s would set the note 28 dB louder.
        # Only the 3 ms fade-in, now on the lead-in instead of the attack, moves it, by 0.1 dB.
        _, alone = render(song([(1, 1)]), [fart("a", 0.0, 0.5)], assign(["a"]))
        self.assertAlmostEqual(self.EVENTS[1]["gain_db"], alone[0]["gain_db"], delta=0.1)

    def test_a_fart_with_no_lead_in_plays_as_before(self):
        _, events = render(song([(1, 1)]), [fart("a", 0.0, 0.5)], assign(["a"]))
        self.assertEqual((events[0]["start_s"], events[0]["len_s"], events[0]["lead_s"]), (1.0, 0.5, 0.0))

    def test_notes_out_of_start_order_place_the_same(self):
        # The same notes, written last first: each lead-in is still limited by the note that starts
        # just before it, and the events come back in start order. renderer.test.ts gives the port
        # the same notes in the same order, and it returns them in the order given.
        order = [3, 1, 0, 2]
        m = song([(self.M.notes[i].start, self.M.notes[i].dur) for i in order])
        ids = ["a", "a", "b", "a"]
        mix, events = render(m, [self.A, self.B], [Assignment(k, ids[i], 60, 0.0) for k, i in enumerate(order)])
        self.assertEqual([e["note_index"] for e in events], [2, 1, 3, 0])
        strip = lambda e: {k: v for k, v in e.items() if k != "note_index"}  # noqa: E731
        self.assertEqual([strip(e) for e in events], [strip(e) for e in self.EVENTS])
        self.assertTrue(np.array_equal(mix, self.MIX))

    def test_a_fart_played_past_its_written_end_holds_back_the_next_lead_in(self):
        # A 0.05-beat note still plays 60 ms of its fart, past its written end (1.05 s), so the next
        # note's lead-in starts where that fart stops (1.06 s): 0.24 s of its 0.3 s, not 0.25 s.
        mix, events = render(song([(1, 0.05), (1.3, 1)]), [self.A], assign(["a", "a"]))
        played_end = int(1.0 * SR) + int(0.06 * SR)
        self.assertGreater(played_end, int(1.05 * SR))
        self.assertEqual(round(events[0]["len_s"] * SR), int(0.06 * SR))
        self.assertEqual(events[1]["lead_s"], round((int(1.3 * SR) - played_end) / SR, 3))
        self.assertEqual(events[1]["lead_s"], 0.24)
        self.assertGreater(np.abs(mix[played_end + 200]), 0)  # the lead-in sounds from there
        self.assertEqual(np.abs(mix[played_end - 1]), 0.0)  # where the short note's fade-out ends


class Recording009(unittest.TestCase):
    """009's attack (0.217 s into the take) is a low rumble, but it opens on a quieter G3 from
    about 0.03 s. Placed by ear on G3 (ADR 0015), a note with room before it plays that G3."""

    @classmethod
    def setUpClass(cls):
        (cls.raw,) = load_library(["009"])
        cls.src = placed(cls.raw, G3)
        cls.mix, cls.events = render(song([(1, 1)]), [cls.src], [Assignment(0, "009", G3, 0.0)])

    def test_its_lead_in_is_its_opening(self):
        self.assertAlmostEqual(len(self.src.lead_in) / SR, 0.215, delta=0.005)
        self.assertEqual(self.events[0]["lead_s"], round(len(self.src.lead_in) / SR, 3))  # all of it: a beat of room

    def test_the_g3_opening_plays_before_the_beat(self):
        lead = len(self.src.lead_in)
        before = self.mix[SR - lead : SR]
        self.assertGreater(np.corrcoef(before[200:], self.src.lead_in[200:])[0, 1], 0.99)  # the take's own samples
        f0 = librosa.yin(before, fmin=45, fmax=900, sr=SR, frame_length=2048, hop_length=256)
        heard = float(np.median(librosa.hz_to_midi(f0[4:-8])))  # its middle, from about 0.03 s of the take
        self.assertLess(abs(heard - G3), 0.5, heard)
        self.assertEqual(np.abs(self.mix[: SR - lead]).max(), 0.0)

    def test_when_the_saints_plays_its_g3_opening_first(self):
        # With 002, 032 and 022 gone, 009 placed on G3 plays the first note, on the half beat
        # (0.2 s), so 0.2 s of its opening plays before it, and the Song still passes the bar.
        # renderer.test.ts checks that the port places it the same.
        lib = [placed(s, G3) if s.id == "009" else s
               for s in load_library() if (s.pitched or s.id == "009") and s.id not in ("002", "032", "022")]
        m = {c["id"]: m for c, m in load_catalog()}["saints"]
        _, assignments = plan(m, lib)
        audio, events = render(m, lib, assignments)
        first = next(e for e in events if e["note_index"] == 0)
        self.assertEqual((first["source_id"], first["start_s"], first["lead_s"]), ("009", 0.2, 0.2))
        self.assertEqual(bar_problems(evaluate(audio, m, events, m.bpm, lib)), [])

    def test_its_attack_lands_on_the_beat(self):
        n = len(self.src.audio) // 2
        on = self.mix[SR : SR + n]
        lags = {k: np.corrcoef(on, self.src.audio[k : k + n])[0, 1] for k in range(0, 221, 20)}
        self.assertEqual(max(lags, key=lags.get), 0)  # unshifted by up to 5 ms
        self.assertGreater(lags[0], 0.99)


if __name__ == "__main__":
    unittest.main()
