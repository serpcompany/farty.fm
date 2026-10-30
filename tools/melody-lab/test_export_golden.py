"""export_golden.py pairs engine.render()'s events, which come in start order, with the Song's
notes by position, so it refuses a Song whose notes don't start in strictly increasing order
instead of pairing the wrong rows (#287 review).

    .venv/bin/python -I -m unittest discover -s . -p 'test_*.py'    # from tools/melody-lab
"""
import sys
import unittest
from dataclasses import replace
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE)]

import export_golden  # noqa: E402
from engine import load_library  # noqa: E402
from melody import load_catalog  # noqa: E402


class StartOrder(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.c, cls.m = next((c, m) for c, m in load_catalog() if c["id"] == "twinkle")
        cls.lib = load_library()

    def test_a_song_in_start_order_is_exported(self):
        export_golden.require_start_order(self.c, self.m)  # no error
        self.assertIsNotNone(export_golden.arrangement_json(self.c, self.m, "full", self.lib)["notes"])

    def test_notes_out_of_start_order_are_refused(self):
        notes = list(self.m.notes)
        notes[1], notes[2] = notes[2], notes[1]
        with self.assertRaisesRegex(ValueError, r"twinkle: note 2 starts at beat .*strictly increasing start order"):
            export_golden.arrangement_json(self.c, replace(self.m, notes=notes), "full", self.lib)

    def test_two_notes_on_one_beat_are_refused(self):
        notes = list(self.m.notes)
        notes[1] = replace(notes[1], start=notes[0].start)
        with self.assertRaisesRegex(ValueError, r"twinkle: note 1 starts at beat"):
            export_golden.arrangement_json(self.c, replace(self.m, notes=notes), "full", self.lib)


if __name__ == "__main__":
    unittest.main()
