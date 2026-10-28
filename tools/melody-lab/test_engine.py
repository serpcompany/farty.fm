import unittest

import numpy as np

from analysis import SR
from engine import (
    Assignment,
    SongLocked,
    fills,
    melody_fit,
    move_cost,
    needed_seconds,
    plan,
    render,
    silent_cost,
    too_short_cost,
    unsettled_cost,
)
from golden_cost import load
from golden_inputs import INDEX, SONGS, golden_library, golden_melody, source
from melody import Melody, Note
from signals import harmonic, samples


def song(pitches, beats=1.0, bpm=60.0):
    return Melody("test", bpm, 4, [Note(i * beats, beats, p) for i, p in enumerate(pitches)])


def zero_crossing_hz(x):
    crossings = np.count_nonzero(np.diff(np.signbit(x)))
    return crossings / 2 / (len(x) / SR)


class Costs(unittest.TestCase):
    def test_move_cost_within_three_semitones_or_an_octave_away(self):
        self.assertEqual(move_cost(0), (0.0, False))
        self.assertEqual(move_cost(-3), (3**1.5, False))
        self.assertIsNone(move_cost(3.5))
        self.assertEqual(move_cost(12), (6.0, True))
        self.assertEqual(move_cost(-10), (6.0 + 2**1.5, True))
        self.assertEqual(move_cost(15), (6.0 + 3**1.5, True))
        self.assertIsNone(move_cost(15.5))
        self.assertIsNone(move_cost(12, octave_moves=False))

    def test_an_octave_move_costs_more_than_any_closer_note(self):
        self.assertLess(move_cost(3)[0], move_cost(12)[0])

    def test_a_recording_fills_a_pitch_only_as_long_as_its_longest_note(self):
        self.assertTrue(fills(1.0, 1.0))
        self.assertFalse(fills(0.999, 1.0))

    def test_needed_seconds_rounds_up_to_a_tenth(self):
        self.assertEqual(needed_seconds(1.2), 1.2)
        self.assertEqual(needed_seconds(1.2000001), 1.3)
        self.assertEqual(needed_seconds(0.975), 1.0)

    def test_too_short_cost(self):
        self.assertEqual(too_short_cost([0.5, 1.0], 2.0, 0.2), 0.0)
        self.assertAlmostEqual(too_short_cost([0.1, 0.3], 1.0, 0.2), 8 + 400 * 0.1)
        self.assertAlmostEqual(too_short_cost([0.5], 0.15, 0.2), 8 + 400 * 0.05)

    def test_unsettled_cost_is_the_share_played_before_settling(self):
        self.assertAlmostEqual(unsettled_cost([0.1, 1.0], 2.0, 0.05), 20 * 0.5 + 20 * 0.05)
        self.assertAlmostEqual(unsettled_cost([0.04], 2.0, 0.05), 20.0)
        self.assertEqual(unsettled_cost([1.0], 2.0, 0.0), 0.0)

    def test_silent_cost_charges_what_the_recording_leaves_silent(self):
        self.assertAlmostEqual(silent_cost([1.0, 0.5], 0.8), 30 * 0.2)
        self.assertEqual(silent_cost([0.5], 0.8), 0.0)


class MelodyFit(unittest.TestCase):
    def test_one_recording_per_pitch_at_its_own_pitch(self):
        sources = [source("a", 48.0, samples(2), 0.1, 0.0), source("b", 50.0, samples(2), 0.1, 0.0),
                   source("c", 52.0, samples(2), 0.1, 0.0), source("noise", None, samples(2), 0.0, 0.0)]
        fit = melody_fit(song([60, 62, 64, 60]), sources)
        self.assertEqual(fit.transpose, -12)
        self.assertEqual(fit.recording_for_pitch, {60: "a", 62: "b", 64: "c"})
        self.assertEqual((fit.unlocked, fit.octave_moves, fit.cost, fit.missing), (True, 0, 0.0, []))

    def test_a_recording_plays_one_pitch_and_a_tie_puts_uncovered_pitches_last(self):
        fit = melody_fit(song([60, 70]), [source("a", 48.0, samples(2), 0.1, 0.0)])
        self.assertEqual((fit.covered, fit.total, fit.transpose), (1, 2, -12))
        self.assertEqual(fit.recording_for_pitch, {60: "a", 70: None})
        self.assertEqual(fit.missing, [(58, 1.0)])

    def test_a_recording_shorter_than_the_longest_note_covers_nothing(self):
        fit = melody_fit(song([60], beats=2.0), [source("a", 60.0, samples(1), 0.1, 0.0)])
        self.assertFalse(fit.unlocked)
        self.assertEqual(fit.missing, [(60 + fit.transpose, 2.0)])

    def test_an_octave_move_only_when_nothing_closer_covers_and_the_lower_key_breaks_a_tie(self):
        sources = [source("a", 60.0, samples(2), 0.1, 0.0), source("b", 76.0, samples(2), 0.1, 0.0)]
        fit = melody_fit(song([60, 64]), sources)
        self.assertEqual((fit.transpose, fit.octave_moves, fit.cost), (0, 1, 6.0))
        self.assertEqual(fit.recording_for_pitch, {60: "a", 64: "b"})
        without = melody_fit(song([60, 64]), sources, octave_moves=False)
        self.assertEqual((without.covered, without.octave_moves), (1, 0))

    def test_a_given_transposition_is_the_only_one_tried(self):
        sources = [source("a", 48.0, samples(2), 0.1, 0.0)]
        fit = melody_fit(song([60]), sources, transpose=-10)
        self.assertEqual((fit.transpose, fit.recording_for_pitch), (-10, {60: "a"}))
        self.assertAlmostEqual(fit.cost, 2**1.5)

    def test_matches_every_golden_arrangement(self):
        for library in INDEX["libraries"]:
            sources = golden_library(library)
            for sid, golden_song in SONGS.items():
                golden = load(f"arrangements/{library}/{sid}.json")
                fit = melody_fit(golden_melody(golden_song), sources)
                with self.subTest(library=library, song=sid):
                    self.assertEqual(fit.transpose, golden["transpose"])
                    self.assertEqual(fit.recording_for_pitch, {x["song_pitch"]: x["recording"] for x in golden["per_pitch"]})
                    self.assertEqual((fit.octave_moves, fit.cost), (golden["octave_moves"], golden["plan_cost"]))
                    self.assertEqual([{"target_midi": m, "seconds": s} for m, s in fit.missing], golden["missing"])

    def test_matches_golden_pitch_coverage_on_subsets(self):
        sources = {s.id: s for s in golden_library("full")}
        for subset in load("coverage.json")["subsets"][::10]:
            library = [sources[rid] for rid in subset["recordings"]]
            for golden in subset["songs"]:
                fit = melody_fit(golden_melody(SONGS[golden["song"]]), library)
                with self.subTest(recordings=subset["recordings"], song=golden["song"]):
                    self.assertEqual({str(p): r for p, r in fit.recording_for_pitch.items()}, golden["recording_for_pitch"])
                    self.assertEqual((fit.transpose, fit.cost), (golden["transpose"], golden["plan_cost"]))


class Plan(unittest.TestCase):
    sources = [source("a", 48.3, samples(2), 0.1, 0.0), source("b", 50.0, samples(2), 0.1, 0.0)]

    def test_every_note_of_a_pitch_uses_its_recording(self):
        transpose, assignments, cost = plan(song([60, 62, 60]), self.sources, with_cost=True)
        self.assertEqual(transpose, -12)
        self.assertEqual([(a.note_index, a.source_id, a.target_midi) for a in assignments],
                         [(0, "a", 48), (1, "b", 50), (2, "a", 48)])
        self.assertEqual([a.shift_semitones for a in assignments], [-0.3, 0.0, -0.3])
        self.assertEqual(cost, melody_fit(song([60, 62, 60]), self.sources).cost)

    def test_a_locked_song_cannot_be_planned(self):
        with self.assertRaises(SongLocked) as raised:
            plan(song([60, 70, 80]), self.sources)
        self.assertEqual(str(raised.exception), "2 of 3 notes covered")
        self.assertFalse(raised.exception.fit.unlocked)


class Render(unittest.TestCase):
    def setUp(self):
        self.sources = [source("low", 45.0, samples(1.5), 0.1, 0.0, audio=harmonic(220.0, 1.5, harmonics=1)),
                        source("high", 52.0, samples(1.5), 0.1, 0.0, audio=harmonic(330.0, 1.5, harmonics=1))]
        self.melody = Melody("test", 120.0, 4, [Note(0.0, 1.0, 57), Note(2.0, 1.0, 64)])
        _, self.assignments = plan(self.melody, self.sources)
        self.mix, self.events = render(self.melody, self.sources, self.assignments)

    def test_each_note_starts_on_time_and_stops_a_gap_before_its_slot_ends(self):
        self.assertEqual([(e["source_id"], e["start_s"], e["len_s"]) for e in self.events],
                         [("low", 0.0, 0.475), ("high", 1.0, 0.475)])
        self.assertTrue(np.all(self.mix[samples(0.476):samples(1.0)] == 0))
        self.assertEqual(len(self.mix), samples(3 * 0.5 + 1.0))

    def test_each_fart_plays_raw_at_its_own_pitch(self):
        self.assertAlmostEqual(zero_crossing_hz(self.mix[samples(0.05):samples(0.4)]), 220.0, delta=3.0)
        self.assertAlmostEqual(zero_crossing_hz(self.mix[samples(1.05):samples(1.4)]), 330.0, delta=3.0)
        shifted = [Assignment(a.note_index, a.source_id, a.target_midi + 5, 5.0) for a in self.assignments]
        again, _ = render(self.melody, self.sources, shifted)
        self.assertTrue(np.array_equal(again, self.mix))

    def test_the_downbeat_is_accented_and_the_mix_peaks_at_minus_one_dbfs(self):
        self.assertAlmostEqual(self.events[0]["gain_db"] - self.events[1]["gain_db"], 1.5, places=1)
        self.assertAlmostEqual(float(np.abs(self.mix).max()), 0.89)

    def test_a_fart_shorter_than_its_note_plays_to_its_end(self):
        short = [source("low", 45.0, samples(0.2), 0.1, 0.0, audio=harmonic(220.0, 0.2, harmonics=1))]
        _, events = render(Melody("test", 60.0, 4, [Note(0.0, 1.0, 45)]), short, [Assignment(0, "low", 45, 0.0)])
        self.assertEqual(events[0]["len_s"], 0.2)
