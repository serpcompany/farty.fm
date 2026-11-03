import unittest

import librosa
import numpy as np

from analysis import SR, Source, lead_in_start, load_library
from engine import Assignment, placed, plan, render
from evaluate import bar_problems, evaluate
from melody import Melody, Note, load_catalog

G3 = 55
ONE_BEAT_A_SECOND = 60.0
FRAME = int(0.005 * SR)
PRE_ROLL_S = 0.008


def fart(rid, lead_s, body_s, lead=0.02, level=0.5):
    return Source(rid, False, np.full(int(body_s * SR), level), np.zeros(0), None, 0.0, 0.0,
                  lead_in=np.full(int(lead_s * SR), lead))


def song(notes):
    return Melody("t", ONE_BEAT_A_SECOND, 4, [Note(s, d, 60) for s, d in notes], [])


def assign(ids):
    return [Assignment(i, rid, 60, 0.0) for i, rid in enumerate(ids)]


def beat(n):
    return int(n.start * SR)


def without_note_index(e):
    return {k: v for k, v in e.items() if k != "note_index"}


class LeadInStart(unittest.TestCase):
    def test_a_quiet_sound_20_db_down_before_the_attack_is_the_lead_in_from_8_ms_before_it(self):
        y = np.concatenate([np.zeros(SR // 10), np.full(SR // 5, 0.05), np.full(SR // 2, 0.5)])
        attack = SR // 10 + SR // 5 - int(PRE_ROLL_S * SR)
        self.assertAlmostEqual(lead_in_start(y, attack) / SR, 0.1 - PRE_ROLL_S, delta=FRAME / SR)

    def test_a_fart_that_opens_loud_has_a_frame_at_most(self):
        y = np.concatenate([np.zeros(SR // 10), np.full(SR // 2, 0.5)])
        attack = SR // 10 - int(PRE_ROLL_S * SR)
        self.assertLessEqual(attack - lead_in_start(y, attack), FRAME)

    def test_a_30_ms_dip_54_db_down_stays_in_the_lead_in(self):
        y = np.concatenate([np.zeros(SR // 10), np.full(SR // 10, 0.05), np.full(int(0.03 * SR), 0.001),
                            np.full(SR // 20, 0.05), np.full(SR // 2, 0.5)])
        attack = SR // 10 + SR // 10 + int(0.03 * SR) + SR // 20 - int(PRE_ROLL_S * SR)
        self.assertAlmostEqual(lead_in_start(y, attack) / SR, 0.1 - PRE_ROLL_S, delta=0.005)

    def test_room_noise_before_a_longer_gap_is_not_the_lead_in(self):
        y = np.concatenate([np.full(SR, 0.005), np.full(SR // 10, 0.05), np.full(int(0.3 * SR), 0.005),
                            np.full(SR // 2, 0.5)])
        attack = SR + SR // 10 + int(0.3 * SR) - int(PRE_ROLL_S * SR)
        self.assertLessEqual(attack - lead_in_start(y, attack), FRAME)

    def test_the_lead_in_is_at_most_a_quarter_second_of_loud_room_noise(self):
        y = np.concatenate([np.full(SR, 0.05), np.full(SR // 2, 0.5)])
        attack = SR - int(PRE_ROLL_S * SR)
        self.assertEqual(attack - lead_in_start(y, attack), int(0.25 * SR))


class Placement(unittest.TestCase):
    A, B = fart("a", 0.3, 0.5), fart("b", 0.3, 2.0)
    M = song([(0.1, 0.5), (1.1, 1), (2.1, 0.8), (3.1, 1)])
    MIX, EVENTS = render(M, [A, B], assign(["a", "a", "b", "a"]))
    FADE_IN = int(0.003 * SR)

    def test_every_attack_lands_on_its_beat(self):
        for n, e in zip(self.M.notes, self.EVENTS, strict=True):
            self.assertEqual(e["start_s"], round(n.start, 3))
            at = beat(n)
            lead = round(e["lead_s"] * SR)
            loud = np.abs(self.MIX[at - lead : at + 500]) >= 0.5 * np.abs(self.MIX[at + 500])
            first = int(np.argmax(loud)) - lead
            if lead:
                self.assertEqual(first, 0, n)
            else:
                self.assertTrue(0 <= first <= self.FADE_IN, n)

    def test_the_lead_in_plays_in_the_rest_before_the_beat_never_before_the_note_before_ends(self):
        expected = [0.1, 0.3, 0.0, 0.2]
        written_end = [0] + [int((n.start + n.dur) * SR) for n in self.M.notes[:-1]]
        for n, e, want, until in zip(self.M.notes, self.EVENTS, expected, written_end, strict=True):
            self.assertAlmostEqual(e["lead_s"], want, delta=0.001)
            self.assertGreaterEqual(beat(n) - round(e["lead_s"] * SR), until - 1, n)
            if want:
                self.assertGreater(np.abs(self.MIX[beat(n) - round(e["lead_s"] * SR) + 200]), 0, n)

    def test_silence_stays_where_nothing_reaches(self):
        self.assertEqual(np.abs(self.MIX[int(0.58 * SR) : int(0.79 * SR)]).max(), 0.0)
        self.assertEqual(np.abs(self.MIX[int(2.076 * SR) : int(2.1 * SR)]).max(), 0.0)

    def test_the_level_is_set_from_the_attack(self):
        _, alone = render(song([(1, 1)]), [fart("a", 0.0, 0.5)], assign(["a"]))
        self.assertAlmostEqual(self.EVENTS[1]["gain_db"], alone[0]["gain_db"], delta=0.1)

    def test_a_fart_with_no_lead_in_plays_as_before(self):
        _, events = render(song([(1, 1)]), [fart("a", 0.0, 0.5)], assign(["a"]))
        self.assertEqual((events[0]["start_s"], events[0]["len_s"], events[0]["lead_s"]), (1.0, 0.5, 0.0))

    def test_notes_out_of_start_order_place_the_same_and_come_back_in_start_order(self):
        order = [3, 1, 0, 2]
        m = song([(self.M.notes[i].start, self.M.notes[i].dur) for i in order])
        ids = ["a", "a", "b", "a"]
        mix, events = render(m, [self.A, self.B], [Assignment(k, ids[i], 60, 0.0) for k, i in enumerate(order)])
        self.assertEqual([e["note_index"] for e in events], [2, 1, 3, 0])
        self.assertEqual([without_note_index(e) for e in events], [without_note_index(e) for e in self.EVENTS])
        self.assertTrue(np.array_equal(mix, self.MIX))

    def test_a_fart_played_past_its_written_end_holds_back_the_next_lead_in(self):
        mix, events = render(song([(1, 0.05), (1.3, 1)]), [self.A], assign(["a", "a"]))
        played_end = int(1.0 * SR) + int(0.06 * SR)
        self.assertGreater(played_end, int(1.05 * SR))
        self.assertEqual(round(events[0]["len_s"] * SR), int(0.06 * SR))
        self.assertEqual(events[1]["lead_s"], round((int(1.3 * SR) - played_end) / SR, 3))
        self.assertEqual(events[1]["lead_s"], 0.24)
        self.assertGreater(np.abs(mix[played_end + 200]), 0)
        self.assertEqual(np.abs(mix[played_end - 1]), 0.0)


class Recording009PlacedOnG3(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        (cls.raw,) = load_library(["009"])
        cls.src = placed(cls.raw, G3)
        cls.mix, cls.events = render(song([(1, 1)]), [cls.src], [Assignment(0, "009", G3, 0.0)])

    def test_its_whole_opening_is_its_lead_in_with_a_beat_of_room(self):
        self.assertAlmostEqual(len(self.src.lead_in) / SR, 0.215, delta=0.005)
        self.assertEqual(self.events[0]["lead_s"], round(len(self.src.lead_in) / SR, 3))

    def test_the_g3_opening_plays_before_the_beat(self):
        lead = len(self.src.lead_in)
        before = self.mix[SR - lead : SR]
        self.assertGreater(np.corrcoef(before[200:], self.src.lead_in[200:])[0, 1], 0.99)
        f0 = librosa.yin(before, fmin=45, fmax=900, sr=SR, frame_length=2048, hop_length=256)
        heard = float(np.median(librosa.hz_to_midi(f0[4:-8])))
        self.assertLess(abs(heard - G3), 0.5, heard)
        self.assertEqual(np.abs(self.mix[: SR - lead]).max(), 0.0)

    def test_when_the_saints_plays_its_g3_opening_first(self):
        lib = [placed(s, G3) if s.id == "009" else s
               for s in load_library() if (s.pitched or s.id == "009") and s.id not in ("002", "032", "022")]
        m = {c["id"]: m for c, m in load_catalog()}["saints"]
        _, assignments = plan(m, lib)
        audio, events = render(m, lib, assignments)
        first = next(e for e in events if e["note_index"] == 0)
        self.assertEqual((first["source_id"], first["start_s"], first["lead_s"]), ("009", 0.2, 0.2))
        self.assertEqual(bar_problems(evaluate(audio, m, events, m.bpm, lib)), [])

    def test_its_attack_lands_on_the_beat_unshifted_by_up_to_5_ms(self):
        n = len(self.src.audio) // 2
        on = self.mix[SR : SR + n]
        lags = {k: np.corrcoef(on, self.src.audio[k : k + n])[0, 1] for k in range(0, 221, 20)}
        self.assertEqual(max(lags, key=lags.get), 0)
        self.assertGreater(lags[0], 0.99)
