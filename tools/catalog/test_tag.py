"""Tests for the Song tags (tag.py, #383): the kind, origin and fame rules, the hand-set values, the
fetcher's cache and pace, and every Song's tags in the catalog.

    python3 -I tools/catalog/test_tag.py
"""
import json
import sys
import tempfile
import time
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE)]

import tag  # noqa: E402

W = "https://en.wikipedia.org/wiki/"


def page(*categories, title="Tune", came_from="composer_source", genre=(), instance_of=(), country=(), views=0,
         fragment=None):
    return {"url": W + title.replace(" ", "_"), "title": title, "from": came_from, "redirected": False,
            "fragment": fragment, "categories": list(categories), "instance_of": list(instance_of),
            "genre": list(genre), "country": list(country), "pageviews": views}


def song(page_=None, session=None, pdmx_list=None, pdmx_views=0):
    return {"id": "x", "title": "Tune", "session": session, "page": page_, "pdmx_views": pdmx_views,
            "pdmx_scores": 1, "pdmx_list": pdmx_list}


def entry(title="Tune", composer="Unknown"):
    return {"id": "x", "title": title, "composer": composer, "composer_source": W + "Tune", "file": "midi/x.mid"}


PEOPLE = {
    "Niel Gow": {"url": W + "Niel_Gow", "categories": ["1727 births", "Scottish fiddlers", "Scottish composers"],
                 "citizenship": ["Kingdom of Great Britain"]},
    "Frédéric Chopin": {"url": W + "Chopin", "categories": ["19th-century Polish classical composers",
                                                            "Polish Romantic composers", "Composers from Paris"],
                        "citizenship": ["France"]},
    "Nobody Known": {"url": W + "Nobody", "categories": ["1800 births"], "citizenship": ["Kingdom of Ireland"]},
    "Turlough O'Carolan": {"url": W + "Carolan",
                           "categories": ["17th-century Irish composers", "Irish traditional music composers"],
                           "citizenship": []},
}


def kind(s, e=None):
    return tag.kind_of(s, e or entry(), PEOPLE)


class Kind(unittest.TestCase):
    def test_a_carol_settles_christmas(self):
        self.assertEqual(kind(song(page("Christmas carols", "Christian hymns", "Bing Crosby songs")))[0], "Christmas")
        # ...unless the Song is clearly an anthem.
        self.assertEqual(kind(song(page("Christmas carols", "National anthems", "Royal anthems")))[0], "Anthems")
        # A Christmas category that isn't a carol only scores: Amazing Grace is a hymn.
        s = song(page("British Christmas songs", "18th-century hymns", "Gospel songs"), pdmx_list="Misc Praise Songs")
        self.assertEqual(kind(s)[0], "Hymns")
        s = song(page("Ballets by Pyotr Ilyich Tchaikovsky", "Christmas onstage"))
        self.assertEqual(kind(s, entry(composer="Frédéric Chopin"))[0], "Classical")

    def test_a_kind_counts_each_signal_once(self):
        # Covers by many singers don't outweigh one hymn category; a tie goes to the more specific kind.
        s = song(page("Christian hymns", "Elvis Presley songs", "Judy Collins songs", "1779 songs"))
        self.assertEqual(kind(s)[0], "Hymns")
        self.assertEqual(kind(song(page("1902 songs", "English children's songs")))[0], "Kids")

    def test_a_category_that_only_hints_counts_less(self):
        # Sung by children isn't written for them: a folk song with a children's category is a song.
        s = song(page("American children's songs", "American folk songs", "Traditional children's songs"))
        self.assertEqual(kind(s)[0], "Songs")
        self.assertEqual(kind(song(page("English nursery rhymes", "English folk songs")))[0], "Kids")
        # A year's compositions doesn't outweigh a march.
        self.assertEqual(kind(song(page("1893 compositions", "Sousa marches")))[0], "Anthems")
        self.assertEqual(kind(song(page("Anthems", "Scottish folk songs", "Drinking songs")))[0], "Songs")
        # A stub category counts as its subject.
        self.assertEqual(kind(song(page("Folk dance stubs", "Irish songs")))[0], "Fiddle tunes")

    def test_fiddlers_and_pipers_write_fiddle_tunes(self):
        self.assertEqual(kind(song(), entry("Miss Tune", "Niel Gow")), ("Fiddle tunes", "composer: Scottish fiddlers",
                                                                          False))
        self.assertEqual(kind(song(), entry("Morgan Megan", "Turlough O'Carolan"))[:2],
                         ("Fiddle tunes", "composer: Irish traditional music composers"))
        self.assertEqual(kind(song(), entry("Some Piece", "Frédéric Chopin"))[0], "Classical")

    def test_state_songs_and_civil_war_songs_are_not_anthems(self):
        self.assertEqual(kind(song(page("State songs of Virginia", "1850s songs")))[0], "Songs")
        self.assertEqual(kind(song(page("Songs of the American Civil War")))[0], "Songs")
        self.assertEqual(kind(song(page("National anthems")))[0], "Anthems")

    def test_patriotic_songs_count_half(self):
        # "American patriotic songs" is an anthem's 1 point, which a folk song's 2 outweigh.
        self.assertEqual(kind(song(page("American patriotic songs")))[0], "Anthems")
        self.assertEqual(kind(song(page("American patriotic songs", "American folk songs")))[0], "Songs")
        s = song(page("Patriotic hymns", "American military marches"))
        self.assertEqual(kind(s, entry("The Hymn"))[0], "Anthems")

    def test_the_session_and_title_words(self):
        self.assertEqual(kind(song(session="reel"))[:2], ("Fiddle tunes", "session: reel"))
        self.assertEqual(kind(song(), entry("Sonata in C major"))[0], "Classical")
        self.assertEqual(kind(song(), entry("The Holly Jig"))[0], "Fiddle tunes")
        self.assertEqual(kind(song(), entry("My Lord Byron's Maggot")),
                         ("Fiddle tunes", "fallback: an unknown composer", True))
        self.assertEqual(kind(song(), entry("Hob y Deri Danno"))[2], True)
        # Shepherds watched at Christmas; a shepherd on his own is anyone's.
        self.assertEqual(kind(song(), entry("While Shepherds Watched"))[0], "Christmas")
        self.assertEqual(kind(song(), entry("The Shepherd Boy"))[2], True)
        self.assertEqual(kind(song(), entry("Pavane Op. 50"))[:2], ("Classical", "title: Op. 50"))
        self.assertEqual(kind(song(pdmx_list="Misc Children"))[0], "Kids")

    def test_a_page_found_by_title_only_counts_when_its_a_tune(self):
        book = page("1791 non-fiction books", "Books by Thomas Paine", title="Rights of Man", came_from="title")
        self.assertIsNone(tag.tune_page(song(book)))
        self.assertEqual(kind(song(book, session="hornpipe"))[0], "Fiddle tunes")
        day = page("Christian festivals", "Quarter days", title="Lady Day", came_from="title")
        self.assertIsNone(tag.tune_page(song(day)))
        tune = page("Irish folk songs", title="Tune", came_from="title")
        self.assertIs(tag.tune_page(song(tune)), tune)
        carol = page("Christmas carols", "Songs inspired by deaths", title="Coventry Carol", came_from="title")
        self.assertIs(tag.tune_page(song(carol)), carol)
        for not_a_tune in (("Concert halls in Brussels", "Music venues completed in 1878"),
                           ("19th-century music genres", "Song forms"), ("1700 births", "Scottish Gaelic songs"),
                           ("1990s electronic song stubs",), ("1927 operas", "Musicals by Sigmund Romberg"),
                           ("1892 operas", "English comic operas")):
            self.assertIsNone(tag.tune_page(song(page(*not_a_tune, title="T", came_from="title"))), not_a_tune)

    def test_fallbacks(self):
        self.assertEqual(kind(song(pdmx_list="Misc tunes")), ("Fiddle tunes", "fallback: in PDMX's Misc tunes", True))
        self.assertEqual(kind(song(), entry(composer="Traditional (Irish)"))[0::2], ("Songs", True))
        self.assertEqual(kind(song(), entry(composer="Unknown"))[0::2], ("Fiddle tunes", True))
        self.assertEqual(kind(song(), entry(composer="Nobody Known"))[0::2], ("Classical", True))
        self.assertFalse(kind(song(page("Irish folk songs")))[2])


class Origin(unittest.TestCase):
    def origin(self, s, e=None):
        return tag.origin_of(s, e or entry(), PEOPLE)

    def test_the_first_source_that_answers(self):
        s = song(page("English folk songs", country=["Kingdom of Ireland"]))
        self.assertEqual(self.origin(s, entry(composer="Traditional (Shetland)")),
                         ("Scottish", "composer: Traditional (Shetland)"))
        self.assertEqual(self.origin(s), ("Irish", "Wikidata country of origin: Kingdom of Ireland"))
        self.assertEqual(self.origin(song(page("English folk songs"))),
                         ("English", "Wikipedia category: English folk songs"))
        self.assertEqual(self.origin(song(), entry(composer="Frédéric Chopin"))[0], "Polish")
        self.assertEqual(self.origin(song(), entry(composer="Nobody Known")),
                         ("Irish", "composer's citizenship: Kingdom of Ireland"))
        self.assertEqual(self.origin(song(), entry(composer="Traditional")), (None, "no source"))

    def test_categories_that_disagree_give_no_origin(self):
        s = song(page("American folk songs", "English folk songs", "Irish folk songs"))
        self.assertEqual(self.origin(s), (None, "no source"))
        s = song(page("Irish folk songs", "English folk songs", "Irish songs"))
        self.assertEqual(self.origin(s)[0], "Irish")

    def test_an_american_composer_of_any_descent_is_american(self):
        people = {"A": {"url": W + "A", "categories": ["Jewish American songwriters"], "citizenship": []},
                  "B": {"url": W + "B", "categories": ["African-American composers"], "citizenship": []}}
        for name in people:
            with self.subTest(name=name):
                self.assertEqual(tag.origin_of(song(), entry(composer=name), people)[0], "American")

    def test_a_language_or_subject_isnt_an_origin(self):
        for category in ("English-language songs", "Songs about Scotland", "Irish people", "1850s songs"):
            with self.subTest(category=category):
                self.assertEqual(self.origin(song(page(category)))[0], None)
        for category, origin in (("Scottish songs", "Scottish"), ("African-American spirituals", "African American"),
                                 ("19th-century Welsh hymns", "Welsh"), ("Swedish folk songs", "Swedish")):
            with self.subTest(category=category):
                self.assertEqual(self.origin(song(page(category)))[0], origin)

    def test_every_origin_is_a_demonym(self):
        self.assertLessEqual(set(tag.COUNTRIES.values()), set(tag.DEMONYMS.values()))


class Fame(unittest.TestCase):
    def test_own_page(self):
        names = {"tune", "londonderry air"}

        def tune(**kw):
            return page("Irish folk songs", **kw)

        self.assertTrue(tag.own_page(song(tune(title="Tune (song)")), names))
        self.assertTrue(tag.own_page(song(tune(title="The Tune")), names))
        self.assertFalse(tag.own_page(song(tune(title="Sea shanty")), names))  # a parent page
        self.assertFalse(tag.own_page(song(tune(title="Tune", fragment="Tune")), names))
        self.assertTrue(tag.own_page(song(tune(title="Cantique de Jean Racine")), {"cantique de jean racine op 11"}))
        # Another name, which the Song's title leads to; or a page found by the title.
        renamed = {**tune(title="Hänschen klein"), "title_page": {"title": "Hänschen klein", "fragment": None}}
        self.assertTrue(tag.own_page(song(renamed), {"lightly row"}))
        parent = {**tune(title="Sea shanty"), "title_page": {"title": "Sea shanty", "fragment": "Leave Her"}}
        self.assertFalse(tag.own_page(song(parent), {"leave her johnny"}))
        self.assertTrue(tag.own_page(song(tune(title="Other", came_from="title")), {"tune"}))
        # The page the lookup cites, with the Song's name, about the hill the hymn is named for.
        hill = page("Crucifixion of Jesus", "New Testament places", title="Calvary")
        self.assertFalse(tag.own_page(song(hill), {"calvary"}))

    def test_own_page_under_a_name_close_to_the_songs(self):
        def own(title, name):
            return tag.own_page(song(page("Compositions", title=title)), {name})

        self.assertTrue(own("Whiskey in the Jar", "whisky in the jar"))
        self.assertTrue(own("Oh Shenandoah", "shenandoah"))
        self.assertTrue(own("Such a Parcel of Rogues in a Nation", "parcel of rogues"))
        self.assertTrue(own("Clarinet Concerto (Mozart)", "clarinet concerto in a major k 622"))
        self.assertTrue(own("Waltz in A minor, Op. posth. (Chopin)", "waltz in a minor chopin"))
        # A set or stage work the Song is part of, or a dance it's one of.
        self.assertFalse(own("Gnossiennes", "gnossienne no 1"))
        self.assertFalse(own("Six moments musicaux (Schubert)", "moments musicaux opus 94 no 3 in f minor"))
        self.assertFalse(own("Babes in Toyland (operetta)", "toyland"))
        self.assertFalse(own("Branle", "branle de bourgogne"))
        self.assertFalse(own("Wild Mountain Thyme", "braes o balquhidder"))

    def test_fame_counts_only_the_tunes_own_page(self):
        own = page("Irish folk songs", title="Tune", views=999)
        self.assertEqual(tag.fame_of(song(own, pdmx_views=9), {"tune"}), (4.0, 999, 9))
        parent = page("Sea shanties", title="Sea shanty", views=999)
        self.assertEqual(tag.fame_of(song(parent, pdmx_views=9), {"tune"}), (1.0, 0, 9))

    def test_well_known(self):
        for views, pdmx_views, known in ((20_000, 200, True), (19_999, 4_999, False), (150_000, 0, True),
                                         (0, 5_000, True), (149_999, 199, False)):
            with self.subTest(views=views, pdmx_views=pdmx_views):
                self.assertEqual(tag.well_known(views, pdmx_views), known)
        self.assertTrue(tag.disagree(0, 5_000))
        self.assertFalse(tag.disagree(20_000, 5_000))


class HandSet(unittest.TestCase):
    def test_hand_set_wins_over_the_batch_and_the_rules(self):
        s = song(page("Irish folk songs", title="Tune", views=200_000))
        got = tag.tag(entry(), s, PEOPLE, {"tune"}, None, {"kind": "Kids"})
        self.assertEqual((got["kind"], got["sources"]["kind"]),
                         ("Kids", "composer batch: the lookup (the rules said 'Songs')"))
        got = tag.tag(entry(), s, PEOPLE, {"tune"}, {"well_known": False, "kind": "Hymns", "why": "wrong page"},
                      {"kind": "Kids"})
        self.assertEqual((got["kind"], got["well_known"]), ("Hymns", False))
        self.assertEqual(got["sources"]["well_known"], "hand-set: wrong page (the rules said True)")

    def test_hand_problems(self):
        good = {"title": "Tune", "well_known": False, "found_by": "known miss", "why": "its page is a book"}
        self.assertEqual(tag.hand_problems({"x": good}, {"x"}), [])
        for change, says in (({"kind": "Carols"}, "kind: one of"), ({"why": " "}, "why"),
                             ({"found_by": "a hunch"}, "found_by"), ({"fame": 3}, "can't set 'fame'"),
                             ({"origin": "Irish-ish"}, "origin"), ({"well_known": "yes"}, "true or false")):
            with self.subTest(change=change):
                problems = tag.hand_problems({"x": {**good, **change}}, {"x"})
                self.assertEqual(len(problems), 1, problems)
                self.assertIn(says, problems[0])
        self.assertIn("not in the catalog", tag.hand_problems({"y": good}, {"x"})[0])
        self.assertEqual(tag.hand_problems({"x": {**good, "origin": None}}, {"x"}), [])


class WithTags(unittest.TestCase):
    def test_puts_the_fields_after_the_composer(self):
        fields = {"kind": "Songs", "origin": None, "fame": 1.5, "well_known": False}
        e = tag.with_tags({**entry(), "kind": "Kids"}, fields)
        self.assertEqual(list(e), ["id", "title", "composer", "composer_source", "kind", "origin", "fame",
                                   "well_known", "file"])
        self.assertEqual(e["kind"], "Songs")
        tagged = tag.with_tags({"id": "x", "title": "T", "file": "f"}, fields)
        self.assertEqual(list(tagged)[:3], ["id", "title", "kind"])


class Check(unittest.TestCase):
    """What CI's tag.py check fails on: a Song with no kind or one outside the seven, a missing field,
    or tags that aren't apply's."""

    fields = {"kind": "Songs", "origin": None, "fame": 1.5, "well_known": False}

    def problems(self, **change):
        e = {**entry(), **self.fields, **change}
        return tag.catalog_problems([{k: v for k, v in e.items() if v != "-"}], {"x": self.fields})

    def test_a_song_with_apply_tags_passes(self):
        self.assertEqual(self.problems(), [])

    def test_a_missing_or_invalid_kind_fails(self):
        for kind, says in (("-", "kind None isn't one of"), ("Polka", "kind 'Polka' isn't one of"),
                           ("Fiddle Tunes", "kind 'Fiddle Tunes' isn't one of")):
            with self.subTest(kind=kind):
                problems = self.problems(kind=kind)
                self.assertTrue(problems and problems[0].startswith("x: " + says), problems)

    def test_a_missing_field_or_a_hand_edit_fails(self):
        self.assertIn("no fame", self.problems(fame="-")[0])
        self.assertIn("aren't apply's", self.problems(well_known=True)[0])


class Guess(unittest.TestCase):
    def test_a_new_record_gets_the_rules_kind_and_origin(self):
        skeleton = {"id": "x", "title": "Tune", "views": 9, "pdmx": "a", "score": "b"}
        tags = {"x": {"kind": "Songs", "origin": "Irish"}, "y": {"kind": "Kids", "origin": None}}
        got = tag.guess([dict(skeleton), {"id": "y", "title": "Y", "kind": "Hymns"}, {"id": "z", "title": "Z"}], tags)
        self.assertEqual(list(got[0]), ["id", "title", "views", "pdmx", "score", "kind", "origin"])
        self.assertEqual((got[0]["kind"], got[0]["origin"]), ("Songs", "Irish"))
        # A record the lookup has guessed or corrected keeps it; a Song with no tags gets none.
        self.assertEqual(got[1:], [{"id": "y", "title": "Y", "kind": "Hymns"}, {"id": "z", "title": "Z"}])


class Fetcher(unittest.TestCase):
    def test_caches_and_paces_its_requests(self):
        asked = []

        def opener(url):
            asked.append((url, time.monotonic()))
            return (404, None) if url.endswith("missing") else (200, {"url": url})

        with tempfile.TemporaryDirectory() as tmp:
            fetch = tag.Fetcher(tmp, interval=0.05, opener=opener)
            for url in ("https://a/1", "https://a/2", "https://a/missing", "https://a/1", "https://a/missing"):
                fetch.get(url)
            self.assertEqual([u for u, _ in asked], ["https://a/1", "https://a/2", "https://a/missing"])
            self.assertGreaterEqual(asked[2][1] - asked[0][1], 0.1)
            again = tag.Fetcher(tmp, offline=True, opener=opener)
            self.assertEqual(again.get("https://a/2"), {"url": "https://a/2"})
            self.assertIsNone(again.get("https://a/missing"))
            self.assertEqual(again.requests, 0)
            with self.assertRaises(LookupError):
                again.get("https://a/3")

    def test_session_type_needs_the_tunes_name(self):
        answers = {"https://thesession.org/tunes/83?format=json": {"type": "hornpipe"},
                   "https://thesession.org/tunes/search?q=lady+day&format=json":
                       {"tunes": [{"name": "Lady Dayle", "type": "reel"}, {"name": "Lady Day", "type": "jig"}]}}
        with tempfile.TemporaryDirectory() as tmp:
            fetch = tag.Fetcher(tmp, interval=0, opener=lambda url: (200, answers.get(url)))
            self.assertEqual(tag.session_type(fetch, ["https://thesession.org/tunes/83"], {"x"}), "hornpipe")
            self.assertEqual(tag.session_type(fetch, ["https://thesession.org/tunes/search?q=lady%20day"],
                                              {"lady day"}), "jig")
            self.assertIsNone(tag.session_type(fetch, [W + "Lady_Day"], {"lady day"}))


class FetchSignals(unittest.TestCase):
    """fetch_signals against a fake Wikipedia: which page is the tune's."""

    PAGES = {  # title asked -> (the page's title, its fragment, its categories)
        "Notebook for Anna Magdalena Bach": ("Notebook for Anna Magdalena Bach", None,
                                             ["1725 documents", "Compositions by Johann Sebastian Bach"]),
        "Hänschen klein": ("Hänschen klein", None, ["German children's songs"]),
        "Lightly Row": ("Hänschen klein", None, ["German children's songs"]),
        "Sea shanty": ("Sea shanty", None, ["Sea shanties"]),
        "Leave Her Johnny": ("Sea shanty", "Leave Her Johnny", ["Sea shanties"]),
        "Musette in D major": ("Musette in D major", None, ["Compositions by Johann Sebastian Bach"]),
        "Niel Gow": ("Niel Gow", None, ["1727 births", "Scottish fiddlers"]),
        "Miss Tune": ("Miss Tune", None, ["Scottish fiddle tunes"]),
    }

    def opener(self, url):
        parts = tag.urllib.parse.urlparse(url)
        query = tag.urllib.parse.parse_qs(parts.query)
        if parts.netloc == "en.wikipedia.org":
            asked = query["titles"][0]
            if asked not in self.PAGES:
                return 200, {"query": {"pages": [{"title": asked, "missing": True}]}}
            title, fragment, categories = self.PAGES[asked]
            redirects = [{"from": asked, "to": title, **({"tofragment": fragment} if fragment else {})}] \
                if asked != title else []
            return 200, {"query": {"redirects": redirects, "pages": [
                {"title": title, "ns": 0, "categories": [{"title": "Category:" + c} for c in categories]}]}}
        if parts.netloc == "wikimedia.org":
            return 200, {"items": [{"views": 1000}]}
        return 200, {"entities": {}}

    def signals(self, *entries):
        with tempfile.TemporaryDirectory() as tmp:
            csv_path = Path(tmp) / "PDMX.csv"
            csv_path.write_text("title,song_name,n_views,mid,artist_name\n", encoding="utf-8")
            fetch = tag.Fetcher(Path(tmp) / "cache", interval=0, opener=self.opener)
            catalog = [{"id": sid, "title": title, "composer": composer, "composer_source": W + cited.replace(" ", "_"),
                        "source": {"dataset_path": f"./mid/{sid}.mid"}} for sid, title, composer, cited in entries]
            got = tag.fetch_signals(catalog, fetch, csv_path, log=lambda m: None)
            names = tag.song_names(catalog)
            return {s["id"]: (s["page"] and s["page"]["title"], s["page"] and s["page"]["from"],
                              tag.own_page(s, names[s["id"]])) for s in got["songs"]}

    def test_the_tunes_page(self):
        got = self.signals(
            # The cited page is a book the march is in, and the title has no page: a parent page.
            ("march", "March in D Major", "Carl Philipp Emanuel Bach", "Notebook for Anna Magdalena Bach"),
            # The cited page is the tune's under another name, which the Song's title leads to.
            ("row", "Lightly Row", "Traditional (German)", "Hänschen klein"),
            # The Song's title leads to a section of the cited page: a parent page.
            ("johnny", "Leave Her Johnny", "Traditional", "Sea shanty"),
            # The Song's title has a page of its own, about a tune, unlike the cited page.
            ("musette", "Musette in D major", "Johann Sebastian Bach", "Notebook for Anna Magdalena Bach"),
            # The composer's own page is cited: the tune is looked up by its title.
            ("miss", "Miss Tune", "Niel Gow", "Niel Gow"),
        )
        self.assertEqual(got, {
            "march": ("Notebook for Anna Magdalena Bach", "composer_source", False),
            "row": ("Hänschen klein", "composer_source", True),
            "johnny": ("Sea shanty", "composer_source", False),
            "musette": ("Musette in D major", "title, for composer_source's page is another's", True),
            "miss": ("Miss Tune", "title", True),
        })


class Repository(unittest.TestCase):
    """catalog/catalog.json against tag-signals.json, the composer batches and tag-hand.json."""

    @classmethod
    def setUpClass(cls):
        cls.catalog, cls.signals, cls.hand, cls.batches, cls.tags = tag.load()

    def test_every_song_has_its_tags(self):
        self.assertEqual(tag.catalog_problems(self.catalog, self.tags), [])
        self.assertEqual(sorted(s["id"] for s in self.signals["songs"]), sorted(e["id"] for e in self.catalog))

    def test_the_hand_set_values_and_the_batches_values(self):
        self.assertEqual(tag.hand_problems(self.hand, {e["id"] for e in self.catalog}), [])
        self.assertEqual([p for r in self.batches.values()
                          for p in tag.value_problems({k: r[k] for k in ("kind", "origin") if k in r})], [])

    def test_the_researchs_known_misses_are_set_by_hand(self):
        # #381: wrongly Well known, and wrongly left out.
        for sid, known in (("rights-of-man", False), ("march-in-d-major", False), ("leave-her-johnny", False),
                           ("uti-var-hage", False), ("schiarazula-marazula", False),
                           ("oh-dear-what-can-the-matter-be", True), ("a-la-claire-fontaine", True)):
            with self.subTest(sid=sid):
                self.assertEqual(self.tags[sid]["well_known"], known)
                self.assertTrue(self.tags[sid]["sources"]["well_known"].startswith("hand-set:"))
        # A page with the tune's name that isn't the tune (a 1952 play, a feast day) gives no pageviews.
        for sid in ("happy-marriage", "lady-day"):
            with self.subTest(sid=sid):
                self.assertEqual(self.tags[sid]["pageviews"], 0)
        # #381's wrong kinds.
        for sid, kind in (("chopsticks", "Kids"), ("her-kommer-jesus-dine-sma", "Christmas"),
                          ("schiarazula-marazula", "Fiddle tunes")):
            with self.subTest(sid=sid):
                self.assertEqual(self.tags[sid]["kind"], kind)

    def test_the_report_is_applys(self):
        self.assertEqual(tag.REPORT.read_text(encoding="utf-8"), tag.report(self.catalog, self.tags, self.hand))

    def test_files_keep_the_catalogs_format(self):
        for path in (tag.SIGNALS, tag.HAND):
            text = path.read_text(encoding="utf-8")
            with self.subTest(path=path.name):
                self.assertEqual(json.dumps(json.loads(text), indent=1, ensure_ascii=False), text)


if __name__ == "__main__":
    unittest.main()
