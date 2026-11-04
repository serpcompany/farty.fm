"""Tests for the composer lookups (composers.py, #357): PDMX's names in one spelling each, the rules a
batch's lookups follow, and the batches' place in the catalog.

    tools/melody-lab/.venv/bin/python -I -m unittest discover -s tools/catalog -t tools/catalog
"""
import json
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path[:0] = [str(HERE)]

import composers  # noqa: E402
import pdmx  # noqa: E402

W = "https://en.wikipedia.org/wiki/"
ENTRY = {"id": "nocturne", "title": "Nocturne", "file": "midi/x.mid",
         "source": {"musescore_score_id": "5285384", "musescore_url": "https://musescore.com/score/5285384",
                    "composer": "Chopin", "dataset_path": "./mid/1.mid"}}
DONE = {"id": "nocturne", "title": "Nocturne", "views": 10, "pdmx": "Chopin", "score": ENTRY["source"]["musescore_url"],
        "composer": "Frédéric Chopin", "composer_died": 1849, "composer_source": W + "Fr%C3%A9d%C3%A9ric_Chopin"}


def catalog():
    return json.loads(composers.CATALOG.read_text(encoding="utf-8"))


class Normalize(unittest.TestCase):
    def test_placeholders_name_nobody(self):
        for raw in (None, "", "NA", "Composer", "anon.", "Anonymous", "Unknown", "American", "R-22Irish"):
            with self.subTest(raw=raw):
                self.assertIsNone(composers.normalize(raw))

    def test_one_spelling_for_each_composer(self):
        for raw, name in (("Chopin", "Frédéric Chopin"), ("Frederic Chopin (1810-1849)", "Frédéric Chopin"),
                          ("G.F. HAENDEL", "George Frideric Handel"), ("Composed by J.S. Bach", "Johann Sebastian Bach"),
                          ("Music: Stephen C. Foster", "Stephen Foster"), ("Carolan arr. Someone", "Turlough O'Carolan"),
                          ("Johann Pachelbel c.1680", "Johann Pachelbel"),
                          ("Ludwig van Beethoven Allegro", "Ludwig van Beethoven"),
                          ("W. A. Mozart & Rossini", "Wolfgang Amadeus Mozart and Gioachino Rossini"),
                          ("Attrib. to Guiseppe Giordiano", "Giuseppe Giordani")):
            with self.subTest(raw=raw):
                self.assertEqual(composers.normalize(raw), name)

    def test_folk_tunes_are_traditional(self):
        for raw, name in (("Irish Traditional", "Traditional (Irish)"), ("Traditional", "Traditional"),
                          ("trad. arr. John Smith", "Traditional"), ("Scotch Air", "Traditional (Scottish)")):
            with self.subTest(raw=raw):
                self.assertEqual(composers.normalize(raw), name)

    def test_every_catalog_name_normalizes_to_a_name_the_lookups_accept(self):
        for entry in catalog():
            raw = entry.get("source", {}).get("composer")
            name = composers.normalize(raw)
            if name is not None:
                with self.subTest(id=entry["id"], raw=raw):
                    self.assertEqual(composers.name_problems(name), [])

    def test_each_alias_is_a_canonical_spelling(self):
        for key, name in composers.ALIASES.items():
            with self.subTest(key=key):
                self.assertEqual(composers.name_problems(name), [])
                self.assertEqual(composers.ALIASES.get(pdmx.normalize(name), name), name)  # no chain of aliases


class NameProblems(unittest.TestCase):
    def test_accepts_names_traditions_and_unknown(self):
        for name in ("Frédéric Chopin", "Turlough O'Carolan", "Mildred J. Hill and Patty Hill", "Traditional",
                     "Traditional (Irish)", "Traditional (African American)", "Unknown"):
            with self.subTest(name=name):
                self.assertEqual(composers.name_problems(name), [])

    def test_refuses_other_spellings_placeholders_and_dates(self):
        for name, says in (("Chopin", "write 'Frédéric Chopin'"), ("NA", "names nobody"),
                           ("J.S. Bach (1685-1750)", "isn't a name"), ("Traditional Irish", "folk tune"),
                           ("Scottish", "Traditional (Scottish)"), ("Frédéric Chopin, 1849", "isn't a name"),
                           ("", "a name"), (None, "a name")):
            with self.subTest(name=name):
                problems = composers.name_problems(name)
                self.assertEqual(len(problems), 1)
                self.assertIn(says, problems[0])


class SourceProblems(unittest.TestCase):
    def test_accepts_the_procedures_sources(self):
        for url in (W + "Chopin", "https://de.wikipedia.org/wiki/X", "https://imslp.org/wiki/X",
                    "https://thesession.org/tunes/1", "https://tunearch.org/wiki/X",
                    "https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=1",
                    "https://musescore.com/score/5285384", "https://musescore.com/user/1/scores/5285384"):
            with self.subTest(url=url):
                self.assertEqual(composers.source_problems(url, ENTRY, "composer_source"), [])

    def test_refuses_other_pages(self):
        for url in ("http://en.wikipedia.org/wiki/Chopin", "https://example.com/chopin", "https://notwikipedia.org/x",
                    "https://musescore.com/score/52853840", "https://musescore.com/user/1/scores/1", "wikipedia", None):
            with self.subTest(url=url):
                self.assertEqual(len(composers.source_problems(url, ENTRY, "composer_source")), 1)


class RecordProblems(unittest.TestCase):
    def problems(self, record, entry=ENTRY):
        return composers.record_problems(record, entry)

    def test_a_done_lookup(self):
        self.assertEqual(self.problems(DONE), [])
        folk = {k: v for k, v in DONE.items() if k != "composer_died"} | {"composer": "Traditional (Irish)"}
        self.assertEqual(self.problems(folk), [])

    def test_a_lookup_not_done_yet(self):
        skeleton = {k: DONE[k] for k in composers.SKELETON_KEYS}
        self.assertEqual(self.problems(skeleton), [])
        self.assertEqual(self.problems({**skeleton, "note": "x"}), ["nocturne: note without a composer"])

    def test_under_copyright_is_removed_not_kept(self):
        self.assertIn("after 1955", self.problems({**DONE, "composer_died": 1956})[0])
        self.assertIn("first published 1931", self.problems({**DONE, "published": 1931})[0])
        self.assertEqual(self.problems({**DONE, "composer_died": 1955, "published": 1930}), [])

    def test_a_lyricist_who_wrote_with_the_music_counts(self):
        # excluded-titles.txt: an author who died after 1955 is the composer, or a lyricist whose words
        # were written with the music.
        song = {**DONE, "composer_died": 1940, "published": 1925, "note": "words by a lyricist, with the music"}
        self.assertEqual(self.problems({**song, "lyricist_died": 1941}), [])
        self.assertEqual(self.problems({**song, "lyricist_died": 1970}),
                         ["nocturne: lyricist died 1970, after 1955: under copyright, so remove the Song"])
        self.assertEqual(self.problems({**song, "lyricist_died": "1970"}), ["nocturne: lyricist_died: a year"])

    def test_a_named_composer_needs_a_death_year_or_an_old_publication(self):
        living = {k: v for k, v in DONE.items() if k != "composer_died"}
        self.assertIn("composer_died: the year the composer died", self.problems(living)[0])
        self.assertIn("composer_died: the year the composer died", self.problems({**living, "published": 1925})[0])
        self.assertIn("composer_died: the year the composer died",
                      self.problems({**living, "published": 1925, "note": " "})[0])
        self.assertEqual(self.problems({**living, "published": 1925, "note": "no source gives the year"}), [])
        unknown = {**living, "composer": "Unknown", "checked": [W + "Tourdion"]}
        self.assertEqual(self.problems(unknown), [])

    def test_a_removal(self):
        removal = {**DONE, "composer_died": 1960, "remove": "died 1960"}
        self.assertEqual(self.problems(removal, None), [])
        self.assertEqual(self.problems({k: v for k, v in removal.items() if k not in ("composer", "composer_died")}
                                       | {"published": 1940}, None), [])
        self.assertEqual(self.problems(removal), [])  # a worker marks it; the integration PR removes it
        self.assertEqual(self.problems({**DONE, "lyricist_died": 1970, "remove": "lyricist died 1970"}, None), [])
        self.assertIn("composer_died or lyricist_died after 1955", self.problems({**DONE, "remove": "x"}, None)[0])
        self.assertIn("why", self.problems({**removal, "remove": " "}, None)[0])

    def test_a_song_gone_from_the_catalog_needs_a_removal(self):
        self.assertIn("no `remove`", self.problems(DONE, None)[0])

    def test_unknown_needs_the_pages_checked(self):
        unknown = {**{k: DONE[k] for k in composers.SKELETON_KEYS}, "composer": "Unknown",
                   "composer_source": W + "Tourdion"}
        self.assertIn("checked", self.problems(unknown)[0])
        self.assertEqual(self.problems({**unknown, "checked": [W + "Tourdion"]}), [])
        self.assertIn("checked", self.problems({**unknown, "checked": ["https://example.com"]})[0])
        self.assertIn("only for a named composer", self.problems({**unknown, "checked": [W], "composer_died": 1500})[0])

    def test_years_and_keys(self):
        self.assertEqual(self.problems({**DONE, "composer_died": "1849"}), ["nocturne: composer_died: a year"])
        self.assertEqual(self.problems({**DONE, "composer_died": True}), ["nocturne: composer_died: a year"])
        self.assertEqual(self.problems({**DONE, "died": 1849}), ["nocturne: unknown key 'died'"])


class Apply(unittest.TestCase):
    def test_waits_for_a_removal(self):
        removal = {**DONE, "composer_died": 1960, "remove": "died 1960"}
        self.assertEqual(composers.removals_left([ENTRY], [removal]),
                         ["nocturne: still in the catalog: remove it the README's way first"])
        self.assertEqual(composers.removals_left([], [removal]), [])
        self.assertEqual(composers.removals_left([ENTRY], [DONE]), [])

    def test_puts_the_fields_after_the_title(self):
        applied = composers.apply([ENTRY, {"id": "other", "title": "Other"}], [DONE])
        self.assertEqual(list(applied[0]), ["id", "title", "composer", "composer_died", "composer_source", "file",
                                            "source"])
        self.assertEqual(applied[0]["composer_died"], 1849)
        self.assertEqual(applied[1], {"id": "other", "title": "Other"})

    def test_a_new_lookup_replaces_the_old_one(self):
        applied = composers.apply([ENTRY], [DONE])
        traditional = {k: v for k, v in DONE.items() if k != "composer_died"} | {"composer": "Traditional (Polish)"}
        again = composers.apply(applied, [traditional])[0]
        self.assertEqual(again["composer"], "Traditional (Polish)")
        self.assertNotIn("composer_died", again)

    def test_skips_lookups_not_done_and_removals(self):
        skeleton = {k: DONE[k] for k in composers.SKELETON_KEYS}
        self.assertEqual(composers.apply([ENTRY], [skeleton]), [ENTRY])
        self.assertEqual(composers.apply([ENTRY], [{**DONE, "remove": "x"}]), [ENTRY])


class CatalogProblems(unittest.TestCase):
    def test_a_batch_in_its_place(self):
        catalog = composers.apply([ENTRY], [DONE])
        self.assertEqual(composers.catalog_problems(catalog, {"composers-01.json": [DONE]}), [])

    def test_finds_each_problem(self):
        other = {"id": "other", "title": "Other"}
        skeleton = {k: DONE[k] for k in composers.SKELETON_KEYS}
        cases = (
            ([ENTRY], {"a": [DONE]}, "run apply"),
            ([ENTRY, other], {"a": [skeleton]}, "other: in no composers-NN.json batch"),
            ([ENTRY], {"a": [skeleton], "b": [skeleton]}, "in a and b"),
            ([ENTRY], {"a": [{**DONE, "remove": "x"}]}, "still in the catalog"),
            (composers.apply([ENTRY], [DONE]), {"a": [skeleton]}, "doesn't give it"),
        )
        for catalog, batches, says in cases:
            with self.subTest(says=says):
                problems = composers.catalog_problems(catalog, batches)
                self.assertEqual(len(problems), 1, problems)
                self.assertIn(says, problems[0])


class Plan(unittest.TestCase):
    entries = [{"id": f"s{i}", "title": f"S{i}", "source": {"composer": "NA"}} for i in range(7)]

    def views(self, entry):
        return {"s3": 50, "s5": 50}.get(entry["id"], int(entry["id"][1:]))

    def test_splits_the_rest_evenly_most_viewed_first(self):
        batches = composers.plan(self.entries, {}, self.views, 3)
        self.assertEqual([[r["id"] for r in b] for b in batches], [["s3", "s5", "s6"], ["s4", "s2", "s1", "s0"]])
        self.assertEqual(list(batches[0][0]), list(composers.SKELETON_KEYS))

    def test_leaves_out_songs_in_a_batch_and_stops_at_count(self):
        taken = {"composers-01.json": [{"id": "s3"}]}
        self.assertEqual([[r["id"] for r in b] for b in composers.plan(self.entries, taken, self.views, 2, 1)],
                         [["s5", "s6"]])
        self.assertEqual(composers.plan(self.entries[:1], {"x": [{"id": "s0"}]}, self.views, 3), [])


class Repository(unittest.TestCase):
    """The batch files in tools/catalog against catalog/catalog.json."""

    def test_every_batch_passes_check(self):
        catalog_ = catalog()
        entries = {e["id"]: e for e in catalog_}
        batches = composers.read_batches()
        self.assertEqual([p for records in batches.values() for r in records
                          for p in composers.record_problems(r, entries.get(r["id"]))], [])
        self.assertEqual(composers.catalog_problems(catalog_, batches), [])

    def test_each_report_is_its_batchs(self):
        for name, records in composers.read_batches().items():
            path = HERE / name.replace(".json", ".report.md")
            if any(composers.is_done(r) or "remove" in r for r in records):
                with self.subTest(batch=name):
                    self.assertEqual(path.read_text(encoding="utf-8"), composers.report(name, records))

    def test_batches_keep_the_catalogs_format(self):
        with tempfile.TemporaryDirectory() as tmp:
            for name in composers.read_batches():
                text = (HERE / name).read_text(encoding="utf-8")
                composers.write_json(Path(tmp) / name, json.loads(text))
                with self.subTest(batch=name):
                    self.assertEqual((Path(tmp) / name).read_text(encoding="utf-8"), text)


if __name__ == "__main__":
    unittest.main()
