import tempfile
import unittest
from pathlib import Path

import mido

from export_golden import golden_catalog, song_json
from golden_inputs import SONGS
from melody import load_midi

TPB = 480


def track(*events):
    trk = mido.MidiTrack()
    tick = 0
    for at, msg in sorted(events, key=lambda e: e[0]):
        trk.append(msg.copy(time=at - tick))
        tick = at
    return trk


def note(pitch, start, end):
    return [(start, mido.Message("note_on", note=pitch, velocity=80)), (end, mido.Message("note_off", note=pitch))]


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


class Catalog(unittest.TestCase):
    def test_imports_every_golden_song_as_the_golden_data_has_it(self):
        catalog = golden_catalog()
        self.assertEqual([c["id"] for c, _ in catalog], list(SONGS))
        for c, m in catalog:
            with self.subTest(song=c["id"]):
                self.assertEqual(song_json(c, m), SONGS[c["id"]])

    def test_reads_titles_as_utf8(self):
        titles = {c["id"]: c["title"] for c, _ in golden_catalog()}
        self.assertEqual((titles["frere"], titles["furelise"]), ("Frère Jacques", "Für Elise"))
