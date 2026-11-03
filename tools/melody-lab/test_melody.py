import tempfile
import unittest
from pathlib import Path

import mido

from analysis import ROOT
from export_golden import arranged_catalog, song_json
from golden_cost import load
from golden_inputs import SONGS
from melody import bar_lines, load_catalog, load_midi

TPB = 480
WOODBLOCK = 115
STEEL_DRUMS = 114
DRUM_CHANNEL = 9


def track(*events):
    trk = mido.MidiTrack()
    tick = 0
    for at, msg in sorted(events, key=lambda e: e[0]):
        trk.append(msg.copy(time=at - tick))
        tick = at
    return trk


def note(pitch, start, end):
    return [(start, mido.Message("note_on", note=pitch, velocity=80)), (end, mido.Message("note_off", note=pitch))]


def time_signature(beat, numerator, denominator):
    return round(beat * TPB), mido.MetaMessage("time_signature", numerator=numerator, denominator=denominator)


def midi_file(test, *tracks):
    mid = mido.MidiFile(ticks_per_beat=TPB)
    mid.tracks.extend(tracks)
    tmp = tempfile.TemporaryDirectory()
    test.addCleanup(tmp.cleanup)
    path = Path(tmp.name) / "song.mid"
    mid.save(path)
    return path


def notes_of(melody):
    return [(n.start, n.dur, n.pitch) for n in melody.notes]


def instrument(channel, program, pitches):
    events = [(0, mido.Message("program_change", channel=channel, program=program))]
    for i, p in enumerate(pitches):
        events += [(i * TPB, mido.Message("note_on", channel=channel, note=p, velocity=80)),
                   ((i + 1) * TPB, mido.Message("note_off", channel=channel, note=p))]
    return track(*events)


class LoadMidi(unittest.TestCase):
    def setUp(self):
        meta = track((0, mido.MetaMessage("set_tempo", tempo=500000)),
                     (0, mido.MetaMessage("time_signature", numerator=3, denominator=4)),
                     (960, mido.MetaMessage("set_tempo", tempo=600000)))
        melody = track(*note(67, 0, 480), *note(64, 0, 960), *note(60, 0, 960),
                       *note(69, 960, 1920), *note(62, 1200, 1440),
                       *note(71, 1920, 2380), *note(72, 2400, 2880), *note(74, 3840, 4320), *note(76, 4320, 4320))
        self.path = midi_file(self, meta, melody)

    def test_keeps_the_top_note_closes_articulation_gaps_and_keeps_real_rests(self):
        m = load_midi(self.path)
        self.assertEqual(notes_of(m), [(0.0, 1.0, 67), (2.0, 2.0, 69), (4.0, 1.0, 71), (5.0, 1.0, 72), (8.0, 1.0, 74)])
        self.assertEqual((m.bpm, m.beats_per_bar, m.length_beats, m.title), (120.0, 3, 9.0, "song"))

    def test_reports_everything_it_drops(self):
        report = load_midi(self.path).report
        self.assertEqual(report["chord_tones_dropped"], 2)
        self.assertEqual(report["inner_voice_onsets_dropped"], 1)
        self.assertEqual(report["tempo_changes_ignored"], 1)
        self.assertEqual((report["overlaps_clipped"], report["note_count"]), (0, 5))
        self.assertEqual((report["track_used"], report["tracks_with_notes"]), (1, [1]))

    def test_excerpt_and_overrides(self):
        m = load_midi(self.path, title="Song", bpm=90, start_beat=2.0, max_beats=3, beats_per_bar=4)
        self.assertEqual(notes_of(m), [(0.0, 2.0, 69), (2.0, 1.0, 71)])
        self.assertEqual((m.title, m.bpm, m.beats_per_bar), ("Song", 90, 4))

    def test_picks_the_highest_track_and_clips_overlaps(self):
        bass = track(*note(36, 0, 960), *note(40, 960, 1920))
        tune = track(*note(72, 0, 600), *note(74, 480, 960), *note(76, 960, 1440))
        m = load_midi(midi_file(self, bass, tune))
        self.assertEqual(m.report["track_used"], 1)
        self.assertEqual(m.report["overlaps_clipped"], 1)
        self.assertEqual(notes_of(m), [(0.0, 1.0, 72), (1.0, 1.0, 74), (2.0, 1.0, 76)])
        self.assertEqual((m.bpm, m.beats_per_bar), (120.0, 4))


class MelodyTrack(unittest.TestCase):
    def test_skips_the_drum_channel(self):
        m = load_midi(midi_file(self, instrument(0, 22, [64, 69, 67, 65]), instrument(DRUM_CHANNEL, 0, [76, 77, 77, 77])))
        self.assertEqual(m.report["track_used"], 0)
        self.assertEqual([n.pitch for n in m.notes], [64, 69, 67, 65])

    def test_skips_an_unpitched_percussion_program(self):
        m = load_midi(midi_file(self, instrument(0, 0, [60, 62, 64]), instrument(1, WOODBLOCK, [84, 84, 84])))
        self.assertEqual(m.report["track_used"], 0)

    def test_takes_a_pitched_percussion_program(self):
        m = load_midi(midi_file(self, instrument(0, 32, [48, 50, 52, 53]), instrument(1, STEEL_DRUMS, [76, 79, 81, 79])))
        self.assertEqual(m.report["track_used"], 1)
        self.assertEqual([n.pitch for n in m.notes], [76, 79, 81, 79])

    def test_a_score_of_only_percussion_still_imports(self):
        m = load_midi(midi_file(self, instrument(DRUM_CHANNEL, 0, [76, 77])))
        self.assertEqual(m.report["track_used"], 0)

    def test_o_sacred_head_plays_the_hymn_not_its_wood_blocks(self):
        m = load_midi(ROOT / "catalog/midi/pdmx-o-sacred-head-now-wounded.mid")
        self.assertEqual(m.report["track_used"], 0)
        self.assertEqual([n.pitch for n in m.notes[:5]], [64, 69, 67, 65, 64])


class BarLines(unittest.TestCase):
    def test_one_meter(self):
        self.assertEqual(bar_lines([(0, 3, 4)], 9), [0, 3, 6])

    def test_a_six_eight_bar_is_three_quarter_notes(self):
        self.assertEqual(bar_lines([(0, 6, 8)], 7), [0, 3, 6])

    def test_no_time_signature_is_four_four(self):
        self.assertEqual(bar_lines([], 9), [0, 4, 8])

    def test_a_pickup_written_as_its_own_bar_is_not_a_bar(self):
        self.assertEqual(bar_lines([(0, 1, 4), (1, 3, 4)], 10), [1, 4, 7])
        self.assertEqual(bar_lines([(0, 3, 4), (3, 4, 4)], 12), [3, 7, 11])

    def test_a_bar_split_at_a_repeat_is_one_bar(self):
        self.assertEqual(bar_lines([(0, 4, 4), (8, 3, 4), (11, 1, 4), (12, 4, 4)], 20), [0, 4, 8, 12, 16])

    def test_a_split_bar_can_follow_a_short_bar(self):
        self.assertEqual(bar_lines([(0, 2, 4), (4, 3, 4), (7, 1, 4), (8, 4, 4)], 16), [0, 2, 4, 8, 12])

    def test_two_whole_bars_before_a_longer_meter_are_two_bars(self):
        self.assertEqual(bar_lines([(0, 2, 4), (8, 4, 4)], 20), [0, 2, 4, 6, 8, 12, 16])
        self.assertEqual(bar_lines([(0, 3, 4), (6, 6, 4)], 18), [0, 3, 6, 12])

    def test_meter_changes_keep_their_bar_lines(self):
        self.assertEqual(bar_lines([(0, 4, 4), (8, 3, 4)], 14), [0, 4, 8, 11])

    def test_a_short_bar_after_a_full_one_is_a_bar_not_a_pickup(self):
        self.assertEqual(bar_lines([(0, 4, 4), (4, 3, 4), (7, 4, 4)], 12), [0, 4, 7, 11])

    def test_only_bar_lines_before_the_end(self):
        self.assertEqual(bar_lines([(0, 3, 4)], 6), [0, 3])

    def test_load_midi_gives_the_bar_lines_in_the_excerpts_beats(self):
        meters = [time_signature(0, 1, 4), time_signature(1, 3, 4)]
        happy_birthday = [*note(60, 0, 360), *note(60, 360, 480), *note(62, 480, 960), *note(60, 960, 1440),
                          *note(65, 1440, 1920), *note(64, 1920, 2880)]
        for meters_are, tracks in (("in their own track", (track(*meters), track(*happy_birthday))),
                                   ("in the melody's track", (track(*meters, *happy_birthday),))):
            with self.subTest(meters_are=meters_are):
                path = midi_file(self, *tracks)
                m = load_midi(path)
                self.assertEqual(m.bar_lines, [1, 4])
                self.assertEqual(m.beats_per_bar, 1)
                self.assertEqual(load_midi(path, start_beat=1).bar_lines, [0, 3])
                self.assertEqual(load_midi(path, max_beats=3).bar_lines, [1])


class Catalog(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.catalog = load_catalog()

    def test_imports_every_catalog_song_as_the_golden_data_has_it(self):
        for c, m in self.catalog:
            with self.subTest(song=c["id"]):
                self.assertEqual(song_json(c, m), load(f"songs/{c['id']}.json"))

    def test_arranges_the_hand_entered_songs_and_the_first_three_batches(self):
        arranged = arranged_catalog(self.catalog)
        self.assertEqual([c["id"] for c, _ in arranged], list(SONGS))
        self.assertEqual(len(arranged), 129)
        self.assertGreater(len(self.catalog), len(arranged))

    def test_reads_titles_as_utf8(self):
        titles = {c["id"]: c["title"] for c, _ in self.catalog}
        self.assertEqual((titles["frere"], titles["furelise"]), ("Frère Jacques", "Für Elise"))
