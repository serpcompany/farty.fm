import json
import re
import unittest

import pdmx
from analysis import ROOT
from evaluate import BAR
from pdmx_testing import HERE, PADDED_BY_TWO_BEATS, row, titles


class TitlesFile(unittest.TestCase):
    def test_parses_ids_titles_and_aliases(self):
        got = titles("# comment\n\nhot-cross-buns | Hot Cross Buns\ndanny-boy | Danny Boy | Londonderry Air; O Danny Boy  # tune\n")
        self.assertEqual([t.id for t in got], ["hot-cross-buns", "danny-boy"])
        self.assertEqual(got[0].title, "Hot Cross Buns")
        self.assertEqual(got[1].names, ("danny boy", "londonderry air", "o danny boy"))

    def test_refuses_bad_lines(self):
        for bad in ("Hot Cross Buns", "Hot-Cross | Hot Cross Buns", "a | b | c | d", "x | A\nx | B", " | A"):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                titles(bad)

    def test_normalize(self):
        self.assertEqual(pdmx.normalize("Frère Jacques!"), "frere jacques")
        self.assertEqual(pdmx.normalize("Brahms' Lullaby"), "brahms lullaby")
        self.assertEqual(pdmx.normalize("Rain,  Rain, Go Away"), "rain rain go away")
        self.assertEqual(pdmx.normalize("Rock & Roll"), "rock and roll")
        self.assertEqual(pdmx.match_key("The Three Blind Mice"), "three blind mice")


class Matching(unittest.TestCase):
    names = titles("twinkle | Twinkle, Twinkle, Little Star")[0].names

    def test_title_head_and_song_name(self):
        self.assertEqual(pdmx.match_kind(row("Twinkle Twinkle Little Star"), self.names), "title")
        self.assertEqual(pdmx.match_kind(row("Twinkle Twinkle Little Star - Main Theme"), self.names), "title head")
        self.assertEqual(pdmx.match_kind(row("Twinkle, twinkle, little star (easy)"), self.names), "title head")
        self.assertEqual(pdmx.match_kind(row("Star SOLO", song_name="Twinkle Twinkle Little Star"), self.names), "song name")

    def test_no_match(self):
        self.assertIsNone(pdmx.match_kind(row("Twinkle Twinkle Little Star Variations"), self.names))
        self.assertIsNone(pdmx.match_kind(row("Little Star"), self.names))
        jingle = titles("jingle | Jingle Bells")[0].names
        self.assertIsNone(pdmx.match_kind(row("Jingle Bell Rock"), jingle))


class Picking(unittest.TestCase):
    def test_license(self):
        self.assertEqual(pdmx.license_problems(row("x")), [])
        cc0 = row("x", license="cc-zero", license_url="https://creativecommons.org/publicdomain/zero/1.0/")
        self.assertEqual(pdmx.license_problems(cc0), [])
        self.assertEqual(len(pdmx.license_problems(row("x", license="cc-by", license_url="x"))), 1)
        self.assertEqual(len(pdmx.license_problems(row("x", license_url=cc0["license_url"]))), 1)
        self.assertEqual(pdmx.license_problems(row("x", conflict="True")), ["PDMX flags a license conflict"])

    def test_tracks_and_midi(self):
        self.assertEqual(pdmx.pick_problems(row("x", tracks="2")), [])
        self.assertEqual(pdmx.pick_problems(row("x", tracks="3")), ["more than 2 tracks"])
        self.assertEqual(pdmx.pick_problems(row("x", mid="")), ["no MIDI file"])

    def test_ranking(self):
        rows = [
            row("Mary Had a Little Lamb - Piano", sid="1", rating="5.0", views="9999"),
            row("Lamb", sid="2", rating="5.0", views="9999", song_name="Mary had a little lamb"),
            row("Mary had a little lamb", sid="3", rating="4.5", views="10"),
            row("Mary Had A Little Lamb", sid="4", rating="4.5", views="20"),
            row("mary had a little lamb", sid="5", rating="0.0", views="5000"),
            row("Mary had a little lamb", sid="6", rating="4.5", views="20", ratings="3"),
            row("Mary had a little lamb", sid="7", rating="4.5", views="20", ratings="3"),
        ]
        [c] = pdmx.find_candidates(rows, titles("mary | Mary Had a Little Lamb"))
        self.assertEqual([pdmx.score_id(r) for _, r in c.eligible], ["6", "7", "4", "3", "5", "1", "2"])
        self.assertEqual([m for m, _ in c.eligible], ["title"] * 5 + ["title head", "song name"])

    def test_rejected_rows_are_counted_not_picked(self):
        rows = [row("Shenandoah", sid="1", tracks="4"), row("Shenandoah", sid="2", conflict="True"),
                row("Shenandoah", sid="3", tracks="5", conflict="True"), row("Shenandoah", sid="4"),
                row("Shenandoah", sid="5", mid="./mid/1/1/Qm5.mid"), row("Other", sid="6")]
        [c] = pdmx.find_candidates(rows, titles("shenandoah | Shenandoah"), used={"./mid/1/1/Qm5.mid"})
        self.assertEqual(c.matched, 5)
        self.assertEqual([pdmx.score_id(r) for _, r in c.eligible], ["4"])
        self.assertEqual(c.rejected, {"more than 2 tracks": 2, "PDMX flags a license conflict": 2, "already in the catalog": 1})

    def test_one_row_can_match_two_titles(self):
        found = pdmx.find_candidates([row("Londonderry Air")], titles("a | Danny Boy | Londonderry Air\nb | Londonderry Air"))
        self.assertEqual([len(c.eligible) for c in found], [1, 1])


def options(bpm, meter, first_onset=0.0):
    return pdmx.render_options([(0.0, bpm)], [(0.0, *meter)], first_onset)


class ExcerptAndTempo(unittest.TestCase):
    def test_four_four(self):
        self.assertEqual(options(120.0, (4, 4)), {"bpm": 120, "max_beats": 32})
        self.assertEqual(options(100.4, (4, 4), 0.5), {"bpm": 100, "max_beats": 32})
        self.assertEqual(options(120.0, (4, 4), 9.0), {"bpm": 120, "start_beat": 8, "max_beats": 32})

    def test_tempo_is_kept_in_range(self):
        self.assertEqual(options(200.0, (4, 4))["bpm"], 144)
        self.assertEqual(options(50.0, (4, 4))["bpm"], 72)

    def test_other_meters(self):
        self.assertEqual(options(90.0, (3, 4)), {"bpm": 90, "max_beats": 30})
        self.assertEqual(options(90.0, (6, 8)), {"bpm": 90, "max_beats": 30, "beats_per_bar": 3})
        self.assertEqual(options(90.0, (2, 2)), {"bpm": 90, "max_beats": 32, "beats_per_bar": 4})
        self.assertEqual(options(90.0, (3, 8)), {"bpm": 90, "max_beats": 31.5})

    def test_tempo_at_the_first_note_and_not_later_changes(self):
        self.assertEqual(pdmx.render_options([(0.0, 120.0), (4.0, 100.0)], [(0.0, 4, 4)], 4.0)["bpm"], 100)
        self.assertEqual(pdmx.render_options([(0.0, 100.0), (8.0, 60.0)], [(0.0, 4, 4)], 0.0)["bpm"], 100)

    def test_pickup_bar_keeps_bar_lines(self):
        quarter_pickup_then_three_four = pdmx.render_options([(0.0, 90.0)], [(0.0, 1, 4), (1.0, 3, 4)], 0.0)
        self.assertEqual(quarter_pickup_then_three_four, {"bpm": 90, "max_beats": 31, "beats_per_bar": 3})
        eighth_pickup_then_six_eight = pdmx.render_options([(0.0, 90.0)], [(0.0, 1, 8), (0.5, 6, 8)], 0.0)
        self.assertEqual(eighth_pickup_then_six_eight, {"bpm": 90, "max_beats": 30.5, "beats_per_bar": 3})

    def test_meter_change_inside_the_excerpt(self):
        four_four_covers_more = pdmx.render_options([(0.0, 90.0)], [(0.0, 4, 4), (16.0, 3, 4)], 0.0)
        self.assertEqual(four_four_covers_more, {"bpm": 90, "max_beats": 31})
        starts_after_the_change = pdmx.render_options([(0.0, 90.0)], [(0.0, 4, 4), (16.0, 3, 4)], 20.0)
        self.assertEqual(starts_after_the_change, {"bpm": 90, "start_beat": 19, "max_beats": 30, "beats_per_bar": 3})


class Gates(unittest.TestCase):
    def test_sanity_note_count(self):
        self.assertEqual(pdmx.sanity_problems([60] * 8, 0, 0, 8), [])
        self.assertEqual(pdmx.sanity_problems([60] * 64, 0, 0, 64), [])
        self.assertEqual(len(pdmx.sanity_problems([60] * 7, 0, 0, 7)), 1)
        self.assertEqual(len(pdmx.sanity_problems([60] * 65, 0, 0, 65)), 1)

    def test_sanity_range(self):
        self.assertEqual(pdmx.sanity_problems([60] * 7 + [79], 0, 0, 8), [])
        self.assertIn("range 20 semitones", pdmx.sanity_problems([60] * 7 + [80], 0, 0, 8)[0])

    def test_sanity_drops(self):
        self.assertEqual(pdmx.sanity_problems([60] * 10, 6, 4, 90), [])
        self.assertIn("11%", pdmx.sanity_problems([60] * 10, 7, 4, 89)[0])

    def test_padded_pickup(self):
        cases = {
            "happy birthday as PDMX padded it": ([(0.0, 3, 4)], [(0.0, 0.75), (0.75, 1.0), (3.0, 4.0), (4.0, 5.0)], 0.0,
                                                 PADDED_BY_TWO_BEATS),
            "silence as long as the notes": ([(0.0, 4, 4)], [(0.0, 2.0), (4.0, 5.0)], 0.0, PADDED_BY_TWO_BEATS),
            "silence shorter than the notes": ([(0.0, 4, 4)], [(0.0, 2.25), (4.0, 5.0)], 0.0, []),
            "one beat of silence": ([(0.0, 2, 4)], [(0.0, 1.0), (2.0, 3.0)], 0.0,
                                    ["the first bar is a pickup padded with silence: every track rests 1 beat after its notes"]),
            "a short pickup": ([(0.0, 4, 4)], [(0.0, 0.75), (4.0, 5.0)], 0.0,
                               ["the first bar is a pickup padded with silence: every track rests 3.25 beats after its notes"]),
            "less than a beat of silence": ([(0.0, 2, 4)], [(0.0, 0.5), (1.5, 1.75), (2.0, 3.0)], 0.0, []),
        }
        for name, (meters, notes, first, expected) in cases.items():
            with self.subTest(name):
                self.assertEqual(pdmx.padded_pickup_problems(meters, notes, first), expected)

    def test_only_the_bar_of_the_first_note_counts(self):
        notes = [(0.0, 1.0), (8.0, 9.0), (12.0, 13.0)]
        self.assertEqual(len(pdmx.padded_pickup_problems([(0.0, 4, 4)], notes, 8.0)), 1)

    def test_not_a_padded_pickup(self):
        cases = {
            "the pickup as its own 1/4 bar": ([(0.0, 1, 4), (1.0, 3, 4)], [(0.0, 0.75), (0.75, 1.0), (1.0, 2.0)]),
            "rests before the pickup": ([(0.0, 3, 4)], [(2.0, 2.75), (2.75, 3.0), (3.0, 4.0)]),
            "a rest of a beat between its notes": ([(0.0, 4, 4)], [(0.0, 1.0), (2.0, 3.0), (4.0, 5.0)]),
            "another track plays on": ([(0.0, 3, 4)], [(0.0, 1.0), (0.0, 3.0), (3.0, 4.0)]),
            "a full 4/4 bar ending on a quarter rest": ([(0.0, 4, 4)], [(0.0, 2.0), (2.0, 3.0), (4.0, 5.0)]),
            "a 3/4 half note then a quarter rest": ([(0.0, 3, 4)], [(0.0, 2.0), (3.0, 4.0)]),
            "three staccato eighths then a rest": ([(0.0, 4, 4)], [(0.0, 0.5), (1.0, 1.5), (2.0, 2.5), (4.0, 5.0)]),
        }
        for name, (meters, notes) in cases.items():
            with self.subTest(name):
                self.assertEqual(pdmx.padded_pickup_problems(meters, notes, 0.0), [])

    def test_the_bar_is_the_readmes_bar(self):
        golden = re.search(r"\*\*Renderer \(#41\)\*\* requires at least (\d+)% of notes within ±50 cents of "
                           r"their fart's own pitch", (ROOT / "fixtures/golden/README.md").read_text(encoding="utf-8"))
        gate = re.search(r"at least (\d+)% of notes within ±50 cents of their fart's own pitch, at least (\d+)% of "
                         r"onsets within ±50 ms, and no re-attacks", (HERE / "README.md").read_text(encoding="utf-8"))
        self.assertIsNotNone(golden, "fixtures/golden/README.md no longer states the renderer's bar")
        self.assertIsNotNone(gate, "tools/catalog/README.md no longer states the render gate's bar")
        self.assertEqual(int(gate[1]), int(golden[1]))
        self.assertEqual(BAR, {"within_50c_of_fart_pct": int(golden[1]), "onsets_on_time_pct": int(gate[2]),
                               "notes_with_retrigger": 0})

    def test_hash(self):
        self.assertEqual(pdmx.hash_problems("a", "a", "s", "s"), [])
        self.assertEqual(len(pdmx.hash_problems("a", "b", "s", "s")), 1)
        self.assertEqual(pdmx.hash_problems("a", "a", "s", "t", copy="the extracted file"),
                         ["the extracted file's sha256 t is not the archive file's s"])


class Catalog(unittest.TestCase):
    hand = {"id": "mary", "title": "Mary Had a Little Lamb"}
    other = {"id": "x", "title": "X", "import": {"titles": "tools/catalog/titles-00.txt"}}
    mine = {"id": "y", "title": "Y", "import": {"titles": "tools/catalog/titles-01.txt"}}

    def test_new_titles_only(self):
        self.assertEqual(len(pdmx.new_title_problems(titles("mary | Something Else")[0], [self.hand])), 1)
        self.assertEqual(len(pdmx.new_title_problems(titles("lamb | Mary had a little lamb!")[0], [self.hand])), 1)
        self.assertEqual(pdmx.new_title_problems(titles("lamb | Little Lamb")[0], [self.hand]), [])

    def test_a_leading_the_doesnt_make_a_title_new(self):
        for catalog_title, line in (("The Itsy Bitsy Spider", "itsy | Itsy Bitsy Spider"),
                                    ("Itsy Bitsy Spider", "itsy | The Itsy Bitsy Spider"),
                                    ("The Itsy Bitsy Spider", "itsy | Spider Song | Itsy Bitsy Spider")):
            with self.subTest(catalog_title=catalog_title, line=line):
                problems = pdmx.new_title_problems(titles(line)[0], [{"id": "spider", "title": catalog_title}])
                self.assertEqual(problems, [f"the catalog already has {catalog_title!r} (spider)"])

    def test_merge_replaces_only_its_own_batch(self):
        new = {"id": "z", "title": "Z", "import": {"titles": "tools/catalog/titles-01.txt"}}
        merged = pdmx.merge_catalog([self.hand, self.mine, self.other], "tools/catalog/titles-01.txt", [new])
        self.assertEqual([e["id"] for e in merged], ["mary", "x", "z"])
        with self.assertRaises(ValueError):
            pdmx.merge_catalog([self.hand], "tools/catalog/titles-01.txt", [{**new, "id": "mary"}])

    def test_spread(self):
        self.assertEqual(pdmx.spread(list(range(10)), 3), [0, 4, 9])
        self.assertEqual(pdmx.spread([1, 2], 3), [1, 2])
        self.assertEqual(pdmx.spread([1, 2, 3], 1), [1])

    def test_catalog_keeps_its_format(self):
        text = (ROOT / "catalog/catalog.json").read_text(encoding="utf-8")
        self.assertEqual(json.dumps(json.loads(text), indent=1, ensure_ascii=False), text)
