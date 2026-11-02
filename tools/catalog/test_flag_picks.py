"""Tests for flagging a batch's modern-looking picks (flag_picks.py), on made-up rows, with no dataset.

    tools/melody-lab/.venv/bin/python -I -m unittest discover -s tools/catalog -t tools/catalog
"""
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE)]

import flag_picks  # noqa: E402

BATCH = "tools/catalog/titles-09.txt"


def row(sid, genres="classical", tags="NA", artist="Misc tunes", title="A Tune"):
    """A PDMX.csv row with the fields flag_picks reads."""
    return {"metadata": f"./metadata/1/{sid}.json", "genres": genres, "tags": tags, "artist_name": artist,
            "title": title}


def entry(sid, song_id, titles=BATCH):
    return {"id": song_id, "title": song_id.title(), "source": {"musescore_score_id": sid,
            "musescore_url": f"https://musescore.com/score/{sid}"}, "import": {"titles": titles}}


class ModernSignsTest(unittest.TestCase):
    def test_a_modern_genre_tag_or_artist_is_a_sign(self):
        self.assertEqual(flag_picks.modern_signs(row("1", genres="rock")), ["genre rock"])
        self.assertEqual(flag_picks.modern_signs(row("1", genres="classical-soundtrack")), ["genre soundtrack"])
        self.assertEqual(flag_picks.modern_signs(row("1", tags="piano-disney-videogame")),
                         ["tag disney", "tag videogame"])
        self.assertEqual(flag_picks.modern_signs(row("1", artist="Misc Soundtrack")), ["artist Misc Soundtrack"])

    def test_old_genres_and_generic_artists_are_not(self):
        for genres in ("classical", "folk", "jazz", "blues", "religiousmusic", "worldmusic", "NA", ""):
            self.assertEqual(flag_picks.modern_signs(row("1", genres=genres)), [], genres)
        for artist in ("Misc tunes", "Misc Traditional", "Henry Purcell", "NA", ""):
            self.assertEqual(flag_picks.modern_signs(row("1", artist=artist)), [], artist)

    def test_a_tag_must_match_whole(self):
        self.assertEqual(flag_picks.modern_signs(row("1", tags="jsbach-stmatthewpassion-popular-rockabye")), [])

    def test_missing_fields_are_no_sign(self):
        self.assertEqual(flag_picks.modern_signs({"metadata": "./metadata/1/1.json"}), [])


class FlagTest(unittest.TestCase):
    def test_flags_only_the_batchs_picks_that_look_modern_in_catalog_order(self):
        catalog = [entry("30", "lavenders-blue"), entry("10", "misirlou"), entry("20", "greensleeves"),
                   entry("40", "rock-elsewhere", titles="tools/catalog/titles-01.txt")]
        picks = flag_picks.batch_picks(catalog, BATCH)
        self.assertEqual(sorted(picks), ["10", "20", "30"])
        rows = [row("10", genres="rock", artist="Dick Dale"), row("20"), row("40", genres="rock"),
                row("30", genres="soundtrack", artist="Misc Soundtrack"), row("99", genres="pop")]
        flagged = flag_picks.flag(picks, rows)
        self.assertEqual([(e["id"], signs) for e, _, signs in flagged],
                         [("lavenders-blue", ["genre soundtrack", "artist Misc Soundtrack"]),
                          ("misirlou", ["genre rock"])])

    def test_no_picks_no_flags(self):
        self.assertEqual(flag_picks.flag({}, [row("1", genres="rock")]), [])


if __name__ == "__main__":
    unittest.main()
