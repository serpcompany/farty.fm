"""Tests for the ranking of PDMX tune titles (rank_pdmx.py), on made-up rows and Tunes, with no dataset.

    tools/melody-lab/.venv/bin/python -I -m unittest discover -s tools/catalog -t tools/catalog
"""
import collections
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE)]

import pdmx  # noqa: E402
import rank_pdmx  # noqa: E402
from rank_pdmx import Tune  # noqa: E402


def scored(title, sid="1", rating="0.0", views="0", ratings="0", song_name="NA", tracks="1", conflict="False",
           genres="classical", artist="NA"):
    """A PDMX.csv row with the fields the importer and the ranking read."""
    return {
        "title": title, "song_name": song_name, "metadata": f"./metadata/1/{sid}.json", "rating": rating,
        "n_views": views, "n_ratings": ratings, "n_tracks": tracks, "license_conflict": conflict,
        "license": "publicdomain", "license_url": pdmx.LICENSES["publicdomain"], "mid": f"./mid/1/1/Qm{sid}.mid",
        "genres": genres, "artist_name": artist,
    }


def tune(title, scores=3, views=100, ratings=0, rating=0.0, **kw):
    """A Tune called `title` whose every score names it, can be picked and has a classical genre."""
    fields = dict(scores=scores, pickable=scores, views=views, ratings=ratings, rated=rating * ratings,
                  offered=scores, named=scores, tagged=scores, modern=0, spellings=collections.Counter({title: scores}))
    fields.update(kw)
    return Tune(pdmx.match_key(title), **fields)


def by_key(*tunes):
    return {t.key: t for t in tunes}


class TallyTest(unittest.TestCase):
    ROWS = [
        scored("Greensleeves", sid="1", views="10", ratings="2", rating="4.0"),
        scored("Greensleeves - Ukulele", sid="2", views="5", ratings="2", rating="5.0", tracks="3"),
        scored("Some Arrangement", sid="3", views="1", song_name="Greensleeves"),
        scored("Greensleeves", sid="4", views="1000", conflict="True"),
        scored("Lonely", sid="5", views="7", song_name="Only A Song Name"),
    ]

    def test_counts_exactly_the_scores_the_importer_matches_and_its_license_gate_accepts(self):
        tunes = rank_pdmx.tally(self.ROWS)
        names = ("greensleeves",)
        [found] = pdmx.find_candidates(self.ROWS, [pdmx.Title("greensleeves", "Greensleeves", names)])
        accepted = [r for r in self.ROWS if pdmx.match_kind(r, names) and not pdmx.license_problems(r)]
        self.assertEqual(found.matched, 4)
        self.assertEqual(found.rejected["PDMX flags a license conflict"], 1)
        self.assertEqual(tunes["greensleeves"].scores, len(accepted))
        self.assertEqual(tunes["greensleeves"].scores, 3)
        self.assertEqual(tunes["greensleeves"].views, 16)

    def test_sums_ratings_and_weights_the_mean_rating_by_them(self):
        t = rank_pdmx.tally(self.ROWS)["greensleeves"]
        self.assertEqual(t.ratings, 4)
        self.assertAlmostEqual(t.rating, 4.5)

    def test_counts_the_scores_the_importer_can_pick(self):
        t = rank_pdmx.tally(self.ROWS)["greensleeves"]
        self.assertEqual(t.pickable, 2)  # the ukulele score has 3 tracks

    def test_counts_how_scores_carry_the_title(self):
        t = rank_pdmx.tally(self.ROWS)["greensleeves"]
        self.assertEqual(t.offered, 2)  # its title, or its title's head
        self.assertEqual(t.named, 2)  # its whole title, or its song name
        self.assertEqual(t.spellings, collections.Counter({"Greensleeves": 2}))

    def test_keeps_only_names_some_score_is_called_by(self):
        tunes = rank_pdmx.tally(self.ROWS)
        self.assertIn("lonely", tunes)
        self.assertNotIn("only a song name", tunes)

    def test_counts_genres_and_artists(self):
        rows = [scored("Song", sid="1", genres="pop-rock", artist="Someone"), scored("Song", sid="2", genres="NA"),
                scored("Song", sid="3", genres="folk", artist="Misc tunes")]
        t = rank_pdmx.tally(rows)["song"]
        self.assertEqual((t.tagged, t.modern), (2, 1))
        self.assertEqual(t.artists, collections.Counter({"Someone": 1, "Misc tunes": 1}))


class LeftOutTest(unittest.TestCase):
    def why(self, t, known=(), excluded=None):
        return rank_pdmx.left_out(t, set(known), excluded or {})

    def test_keeps_a_popular_public_domain_tune(self):
        self.assertIsNone(self.why(tune("Maple Leaf Rag", artists=collections.Counter({"Scott Joplin": 3}))))

    def test_leaves_out_titles_in_the_catalog_or_tried(self):
        self.assertEqual(self.why(tune("The Greensleeves"), known={"greensleeves"}), "in the catalog or tried already")

    def test_leaves_out_excluded_titles(self):
        excluded = rank_pdmx.read_excluded("Take Five | under copyright: Paul Desmond, 1959")
        self.assertEqual(self.why(tune("Take Five"), excluded=excluded), "in excluded-titles.txt")

    def test_leaves_out_titles_no_score_of_which_can_be_picked(self):
        self.assertEqual(self.why(tune("Song", pickable=0)), "no score the importer can pick")

    def test_leaves_out_titles_with_one_score(self):
        self.assertEqual(self.why(tune("Song", scores=1)), "fewer than 2 scores")

    def test_leaves_out_title_heads_most_scores_dont_carry_whole(self):
        self.assertEqual(self.why(tune("Mozart", scores=4, named=1)), "mostly a title head: a composer or collection")
        self.assertIsNone(self.why(tune("Mozart", scores=4, named=2)))

    def test_leaves_out_titles_without_a_genre(self):
        self.assertIn("no score has a MuseScore genre", self.why(tune("Megalovania", tagged=0)))

    def test_leaves_out_titles_mostly_in_a_modern_genre(self):
        self.assertIn("mostly a modern genre", self.why(tune("Song", tagged=3, modern=2)))
        self.assertIsNone(self.why(tune("Song", tagged=4, modern=2)))

    def test_leaves_out_titles_several_artists_share_ignoring_ones_that_name_nobody(self):
        split = collections.Counter({"Brahms": 2, "Mozart": 1, "Schubert": 1, "Misc tunes": 9})
        self.assertIn("several pieces share the title", self.why(tune("Lullaby", artists=split)))
        one = collections.Counter({"Gustav Holst": 6, "Christina Rossetti": 2, "Misc tunes": 4, "Anonymous": 2})
        self.assertIsNone(self.why(tune("In the Bleak Midwinter", artists=one)))

    def test_leaves_out_titles_every_spelling_of_which_is_garbled(self):
        t = tune("x", spellings=collections.Counter({"SarÄ Gelin": 2}))
        t.key = pdmx.match_key("SarÄ Gelin")
        self.assertEqual(self.why(t), "every spelling of the title is garbled")


class RankTest(unittest.TestCase):
    def rank(self, *tunes, known=()):
        ranked, why = rank_pdmx.rank(by_key(*tunes), set(known), {})
        return [t.key for t in ranked], why

    def test_ranks_by_views_then_ratings_then_mean_rating(self):
        keys, _ = self.rank(tune("C", views=10, ratings=5, rating=4.0), tune("A", views=20),
                            tune("B", views=10, ratings=5, rating=4.5), tune("D", views=10, ratings=9))
        self.assertEqual(keys, ["a", "d", "b", "c"])

    def test_leaves_out_a_name_that_begins_or_ends_with_a_tried_title(self):
        keys, why = self.rank(tune("Fur Elise Beethoven"), tune("The Song of Fur Elise"), known={"fur elise"})
        self.assertEqual(keys, [])
        self.assertEqual(why, {"the same tune as a better-ranked or tried title": 2})

    def test_leaves_out_a_shorter_or_longer_name_of_a_better_ranked_title(self):
        keys, _ = self.rank(tune("Tico Tico no Fuba", views=9), tune("Tico Tico", views=5))
        self.assertEqual(keys, ["tico tico no fuba"])
        keys, _ = self.rank(tune("Tico Tico no Fuba", views=5), tune("Tico Tico", views=9))
        self.assertEqual(keys, ["tico tico"])

    def test_one_word_in_common_is_not_the_same_tune(self):
        keys, _ = self.rank(tune("Perfect Day", views=5), known={"perfect"})
        self.assertEqual(keys, ["perfect day"])

    def test_leaves_out_a_title_whose_scores_mostly_link_to_the_song_of_a_tried_or_better_ranked_one(self):
        ode = collections.Counter({"ode to joy": 2})
        keys, _ = self.rank(tune("Inno alla Gioia", views=9, songs=ode), known={"ode to joy"})
        self.assertEqual(keys, [])
        keys, _ = self.rank(tune("Hymn to Joy", views=9, songs=ode), tune("Inno alla Gioia", views=5, songs=ode))
        self.assertEqual(keys, ["hymn to joy"])

    def test_a_song_fewer_than_half_the_scores_link_to_doesnt_count(self):
        keys, _ = self.rank(tune("Cranham", songs=collections.Counter({"ode to joy": 1})), known={"ode to joy"})
        self.assertEqual(keys, ["cranham"])


class KnownNamesTest(unittest.TestCase):
    def test_takes_catalog_titles_and_every_name_of_tried_titles(self):
        tried = [pdmx.read_titles("ring | Ring Around the Rosie | Ring a Ring o' Roses\n")]
        known = rank_pdmx.known_names([{"id": "mice", "title": "The Three Blind Mice"}], tried)
        self.assertEqual(known, {"three blind mice", "ring around the rosie", "ring a ring o roses"})

    def test_a_batch_written_again_does_not_count_its_own_songs(self):
        catalog = [{"id": "mice", "title": "Three Blind Mice"},
                   {"id": "swan", "title": "The Swan", "import": {"titles": "tools/catalog/titles-04.txt"}},
                   {"id": "ode", "title": "Ode to Joy", "import": {"titles": "tools/catalog/titles-02.txt"}}]
        kept = rank_pdmx.without_batch(catalog, "tools/catalog/titles-04.txt")
        self.assertEqual([e["id"] for e in kept], ["mice", "ode"])


class ReadExcludedTest(unittest.TestCase):
    def test_reads_titles_by_match_key_and_skips_comments(self):
        text = "# why\n\nThe Girl from Ipanema | under copyright: Jobim, 1962  # bossa nova\nFrère Jacques! | test\n"
        self.assertEqual(rank_pdmx.read_excluded(text),
                         {"girl from ipanema": "under copyright: Jobim, 1962", "frere jacques": "test"})

    def test_refuses_a_line_without_a_reason(self):
        with self.assertRaisesRegex(ValueError, "line 2"):
            rank_pdmx.read_excluded("A | why\nTake Five\n")

    def test_the_committed_file_reads(self):
        excluded = rank_pdmx.read_excluded(rank_pdmx.EXCLUDED.read_text())
        self.assertIn("take five", excluded)


class GarbledTest(unittest.TestCase):
    def test_finds_utf8_read_as_latin1(self):
        for text in ["SÃ¤kkijÃ¤rven Polkka", "Marko skaÄ\x8de", "Marko skaÄe", "SarÄ Gelin", "WÅród nocnej ciszy",
                     "JÄzus", "Nie zna Åmierci Pan Å¼ywota", "Åç", "Ððµññð²ðð¼ñðºðñ", "ΑπÏ κÎμπους"]:
            with self.subTest(text):
                self.assertTrue(rank_pdmx.garbled(text))

    def test_passes_accented_titles(self):
        for text in ["Säkkijärven Polkka", "Frère Jacques", "FRÈRE JACQUES", "CAFÉ", "Ännchen von Tharau",
                     "Chanson à boire", "España", "Là ci darem la mano", "Schneeflöckchen Weißröckchen", "Ölberg"]:
            with self.subTest(text):
                self.assertFalse(rank_pdmx.garbled(text))


class DisplayTitleTest(unittest.TestCase):
    def display(self, key, **spellings):
        t = tune("x", spellings=collections.Counter(spellings))
        t.key = key
        return rank_pdmx.display_title(t)

    def test_prefers_title_or_sentence_case_to_a_more_common_spelling(self):
        t = tune("x", spellings=collections.Counter({"maple leaf rag": 5, "MAPLE LEAF RAG": 4, "Maple Leaf Rag": 1}))
        t.key = "maple leaf rag"
        self.assertEqual(rank_pdmx.display_title(t), "Maple Leaf Rag")

    def test_capitalises_a_title_written_only_in_small_or_capital_letters(self):
        t = tune("x", spellings=collections.Counter({"maple leaf rag": 5, "MAPLE LEAF RAG": 4}))
        t.key = "maple leaf rag"
        self.assertEqual(rank_pdmx.display_title(t), "Maple Leaf Rag")
        t.spellings = collections.Counter({"toccata in e minor BWV 914": 1})
        t.key = "toccata in e minor bwv 914"
        self.assertEqual(rank_pdmx.display_title(t), "Toccata in e minor BWV 914")

    def test_writes_nothing_a_titles_file_reads_as_a_comment_or_separator(self):
        t = tune("x", spellings=collections.Counter({"Prelude in C# minor | Op. 3; No. 2 -": 1}))
        t.key = "prelude in c minor op 3 no 2"
        self.assertEqual(rank_pdmx.display_title(t), "Prelude in C♯ minor / Op. 3, No. 2")

    def test_skips_garbled_spellings_and_gives_none_when_all_are(self):
        t = tune("x", spellings=collections.Counter({"O ce veste minunatÄ": 2, "O Ce Veste Minunata": 1}))
        t.key = "o ce veste minunata"
        self.assertEqual(rank_pdmx.display_title(t), "O Ce Veste Minunata")
        t.spellings = collections.Counter({"SarÄ Gelin": 1})
        t.key = "sara gelin"
        self.assertIsNone(rank_pdmx.display_title(t))


class TitlesLinesTest(unittest.TestCase):
    def test_writes_a_titles_file_the_importer_reads_with_the_ranked_name_only(self):
        tunes = [tune("Maple Leaf Rag"), tune("The Swan"), tune("Prelude in C# minor")]
        lines = rank_pdmx.titles_lines(tunes, taken={"maple-leaf-rag"})
        read = pdmx.read_titles("\n".join(lines))
        self.assertEqual([t.id for t in read], ["maple-leaf-rag-2", "swan", "prelude-in-c-minor"])
        self.assertEqual([t.title for t in read], ["Maple Leaf Rag", "The Swan", "Prelude in C♯ minor"])
        self.assertEqual([t.names for t in read], [(t.key,) for t in tunes])


class RankingTextTest(unittest.TestCase):
    def test_lists_the_top_titles_and_why_the_others_were_left_out(self):
        ranked = [tune("Maple Leaf Rag", views=350, ratings=2, rating=4.5,
                       artists=collections.Counter({"Misc tunes": 5, "Scott Joplin": 1}))]
        run = {"command": "rank", "md5": "m", "limit": 1500}
        text = rank_pdmx.ranking_text(ranked, collections.Counter({"fewer than 2 scores": 3}), run)
        self.assertIn("- 4 titles; 1 may be tried next, and the top 1 are listed. Left out:\n  - 3: fewer than 2 scores",
                      text)
        self.assertIn("| 1 | Maple Leaf Rag | Scott Joplin | 3 | 3 | 350 | 2 | 4.50 |", text)


if __name__ == "__main__":
    unittest.main()
