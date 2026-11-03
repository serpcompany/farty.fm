"""Tests for listing Song reports per Song (song_reports.py), on made-up rows and a made-up catalog.

    tools/melody-lab/.venv/bin/python -I -m unittest discover -s tools/catalog -t tools/catalog
"""
import json
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE)]

import song_reports  # noqa: E402

NOW = "1111111111111111"
OLD = "0000000000000000"
SONGS = {"twinkle": ("Twinkle, Twinkle, Little Star", NOW), "mary": ("Mary Had a Little Lamb", NOW)}


def row(song_id, version=NOW, reason="wrong_notes", note=None, at=1_793_700_000_000):
    return {"id": f"{song_id}-{at}", "song_id": song_id, "song_version": version, "reason": reason,
            "note": note, "created_at": at}


class BySongTest(unittest.TestCase):
    def test_songs_rank_by_reports_on_their_notes_now_then_by_all_then_newest(self):
        rows = [
            row("twinkle", OLD), row("twinkle", OLD), row("twinkle", OLD),
            row("mary"), row("mary", reason="other", at=1_793_700_000_001),
            row("gone", at=1_793_800_000_000),
        ]
        entries = song_reports.by_song(rows, SONGS)
        self.assertEqual([e["song_id"] for e in entries], ["mary", "twinkle", "gone"])
        mary, twinkle, gone = entries
        self.assertEqual((mary["now"], mary["older"]), (2, 0))
        self.assertEqual(dict(mary["reasons"]), {"wrong_notes": 1, "other": 1})
        self.assertEqual([r["reason"] for r in mary["reports"]], ["other", "wrong_notes"])
        self.assertEqual((twinkle["now"], twinkle["older"]), (0, 3))
        self.assertIsNone(gone["title"])

    def test_a_tie_goes_to_the_song_reported_most_recently(self):
        entries = song_reports.by_song([row("twinkle", at=1), row("mary", at=2)], SONGS)
        self.assertEqual([e["song_id"] for e in entries], ["mary", "twinkle"])


class ReportTest(unittest.TestCase):
    def test_lists_each_song_its_counts_and_each_note_without_control_characters(self):
        rows = [row("twinkle", note="Bar 3\x1b[2J is off"), row("twinkle", OLD, "wrong_sound", at=0)]
        text = song_reports.report(song_reports.by_song(rows, SONGS))
        self.assertIn("1. twinkle · Twinkle, Twinkle, Little Star", text)
        self.assertIn("1 on its notes now (1 wrong_notes) · 1 on older notes", text)
        self.assertIn("2026-11-03 10:00  now    wrong_notes  Bar 3 [2J is off", text)
        self.assertIn("1970-01-01 00:00  older  wrong_sound", text)
        self.assertNotIn("\x1b", text)

    def test_says_so_when_there_are_none(self):
        self.assertEqual(song_reports.report([]), "No Song reports.")


class ReadRowsTest(unittest.TestCase):
    def test_reads_wranglers_json_a_plain_list_and_a_csv_alike(self):
        rows = [row("twinkle", note="Bar 3, maybe")]
        with tempfile.TemporaryDirectory() as tmp:
            wrangler = Path(tmp, "wrangler.json")
            wrangler.write_text(json.dumps([{"results": rows, "success": True, "meta": {}}]))
            plain = Path(tmp, "rows.json")
            plain.write_text(json.dumps(rows))
            table = Path(tmp, "rows.csv")
            table.write_text('id,song_id,song_version,reason,note,created_at\n'
                             f'x,twinkle,{NOW},wrong_notes,"Bar 3, maybe",1793700000000\n')
            for path in (wrangler, plain, table):
                [read] = song_reports.read_rows(path)
                self.assertEqual((read["song_id"], read["note"]), ("twinkle", "Bar 3, maybe"), path.name)
                self.assertEqual(int(read["created_at"]), 1_793_700_000_000, path.name)


class CatalogSongsTest(unittest.TestCase):
    def test_takes_each_songs_title_and_notes_version_from_the_public_catalog(self):
        with tempfile.TemporaryDirectory() as tmp:
            Path(tmp, "songs-abc.json").write_text(json.dumps([
                {"id": "twinkle", "title": "Twinkle", "notesPath": f"/catalog/notes/twinkle-{NOW}.json"},
            ]))
            self.assertEqual(song_reports.catalog_songs(Path(tmp)), {"twinkle": ("Twinkle", NOW)})

    def test_the_real_catalog_has_a_version_for_every_song(self):
        songs = song_reports.catalog_songs()
        self.assertGreater(len(songs), 100)
        self.assertTrue(all(version for _, version in songs.values()))


if __name__ == "__main__":
    unittest.main()
