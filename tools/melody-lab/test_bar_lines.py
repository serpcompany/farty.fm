"""Checks where a Song's bar lines fall (melody.bar_lines, #232): the renderers play a note that
starts on one 1.5 dB louder, so a pickup must not be a bar, and meter changes keep their bars.

    .venv/bin/python -I -m unittest discover -s . -p 'test_*.py'
"""
import tempfile
import unittest
from pathlib import Path

import mido

from melody import bar_lines, load_midi


class BarLinesTest(unittest.TestCase):
    def test_one_meter(self):
        self.assertEqual(bar_lines([(0, 3, 4)], 9), [0, 3, 6])
        self.assertEqual(bar_lines([(0, 6, 8)], 7), [0, 3, 6])  # 6/8: a bar is 3 quarter notes

    def test_no_time_signature_is_four_four(self):
        self.assertEqual(bar_lines([], 9), [0, 4, 8])

    def test_a_pickup_written_as_its_own_bar_is_not_a_bar(self):
        # PDMX's MIDI writes Happy Birthday's "Hap-py" as a 1/4 bar, then 3/4: "birth" starts a bar.
        self.assertEqual(bar_lines([(0, 1, 4), (1, 3, 4)], 10), [1, 4, 7])
        self.assertEqual(bar_lines([(0, 3, 4), (3, 4, 4)], 12), [3, 7, 11])

    def test_a_bar_split_at_a_repeat_is_one_bar(self):
        # 3/4 + 1/4 before 4/4: the 1/4 is the rest of the bar, not a bar of its own.
        self.assertEqual(bar_lines([(0, 4, 4), (8, 3, 4), (11, 1, 4), (12, 4, 4)], 20), [0, 4, 8, 12, 16])
        # The first half can follow a short bar: 2/4, 2/4, then 3/4 + 1/4 before 4/4.
        self.assertEqual(bar_lines([(0, 2, 4), (4, 3, 4), (7, 1, 4), (8, 4, 4)], 16), [0, 2, 4, 8, 12])

    def test_two_whole_bars_before_a_longer_meter_are_two_bars(self):
        # 2/4 then 4/4: the 2/4 bar at 6 isn't the rest of the one at 4 (stars-and-stripes, 2/2 then 4/2).
        self.assertEqual(bar_lines([(0, 2, 4), (8, 4, 4)], 20), [0, 2, 4, 6, 8, 12, 16])
        self.assertEqual(bar_lines([(0, 3, 4), (6, 6, 4)], 18), [0, 3, 6, 12])

    def test_meter_changes_keep_their_bar_lines(self):
        self.assertEqual(bar_lines([(0, 4, 4), (8, 3, 4)], 14), [0, 4, 8, 11])
        # A short bar after a full one is a bar of its own, not a pickup.
        self.assertEqual(bar_lines([(0, 4, 4), (4, 3, 4), (7, 4, 4)], 12), [0, 4, 7, 11])

    def test_only_bar_lines_before_the_end(self):
        self.assertEqual(bar_lines([(0, 3, 4)], 6), [0, 3])


class LoadMidiBarLinesTest(unittest.TestCase):
    def midi(self, meters, notes):
        """A one-track MIDI file: time signatures [(beat, num, den)] and notes [(beat, beats, pitch)]."""
        tpb = 480
        events = [(round(b * tpb), 0, mido.MetaMessage("time_signature", numerator=n, denominator=d)) for b, n, d in meters]
        for b, length, pitch in notes:
            events.append((round(b * tpb), 2, mido.Message("note_on", note=pitch, velocity=80)))
            events.append((round((b + length) * tpb), 1, mido.Message("note_off", note=pitch)))
        track, now = mido.MidiTrack(), 0
        for tick, _, msg in sorted(events, key=lambda e: (e[0], e[1])):
            track.append(msg.copy(time=tick - now))
            now = tick
        mid = mido.MidiFile(ticks_per_beat=tpb)
        mid.tracks.append(track)
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        path = Path(tmp.name) / "song.mid"
        mid.save(path)
        return path

    def test_bar_lines_are_in_the_excerpts_beats(self):
        # "Hap-py birth-day to you": a 1/4 pickup bar, then 3/4.
        path = self.midi([(0, 1, 4), (1, 3, 4)],
                         [(0, 0.75, 60), (0.75, 0.25, 60), (1, 1, 62), (2, 1, 60), (3, 1, 65), (4, 2, 64)])
        m = load_midi(path)
        self.assertEqual(m.bar_lines, [1, 4])
        self.assertEqual(m.beats_per_bar, 1)  # the first time signature's, as before; accents don't read it
        self.assertEqual(load_midi(path, start_beat=1).bar_lines, [0, 3])
        self.assertEqual(load_midi(path, max_beats=3).bar_lines, [1])


if __name__ == "__main__":
    unittest.main()
