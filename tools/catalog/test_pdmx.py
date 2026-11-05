"""Tests for the PDMX import's picking and gate rules (pdmx.py), and for the importer's control
flow (import_pdmx.py) on temporary files, with a stub renderer and no dataset.

    tools/melody-lab/.venv/bin/python -I -m unittest discover -s tools/catalog -t tools/catalog
"""
import contextlib
import hashlib
import io
import json
import os
import re
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path[:0] = [str(HERE), str(ROOT / "tools/melody-lab")]

import import_pdmx  # noqa: E402
import pdmx  # noqa: E402
from evaluate import BAR  # noqa: E402
from melody import load_midi  # noqa: E402

PD = "https://creativecommons.org/publicdomain/mark/1.0/"
SCORE = ROOT / "catalog/midi/pdmx-twinkle.mid"  # a cited score's MIDI file, for the importer's control flow
ARCHIVE = {"md5": "m", "published_md5": "m", "downloaded": "2026-10-21"}


def row(title, sid="1", rating="0.0", views="0", ratings="0", song_name="NA", tracks="1", conflict="False",
        license="publicdomain", license_url=PD, mid=None):
    return {
        "title": title, "song_name": song_name, "metadata": f"./metadata/1/{sid}.json", "rating": rating,
        "n_views": views, "n_ratings": ratings, "n_tracks": tracks, "license_conflict": conflict,
        "license": license, "license_url": license_url, "mid": f"./mid/1/1/Qm{sid}.mid" if mid is None else mid,
    }


def titles(text):
    return pdmx.read_titles(text)


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def quiet():
    return contextlib.redirect_stdout(io.StringIO())


def temp_dir(test):
    tmp = tempfile.TemporaryDirectory()
    test.addCleanup(tmp.cleanup)
    return Path(tmp.name)


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

    def test_misbarred_scores_are_never_picked(self):
        # #232: this Happy Birthday is barred from "Hap-", so the accents fell on "Hap-" and "to".
        rows = [row("Happy Birthday to You", sid="6064902", rating="4.94"), row("Happy Birthday to You", sid="6420004")]
        [c] = pdmx.find_candidates(rows, titles("birthday | Happy Birthday | Happy Birthday to You"))
        self.assertEqual([pdmx.score_id(r) for _, r in c.eligible], ["6420004"])
        self.assertEqual(c.rejected, {"its bar lines are off the tune": 1})

    def test_a_score_that_isnt_the_melody_is_never_picked(self):
        # #324: the best-rated score that passed was the hymn's tenor part.
        rows = [row("My Faith Looks Up To Thee: Tenor", sid="562231", rating="4.9"),
                row("My faith looks up to Thee - Lowell Mason", sid="5789390")]
        [c] = pdmx.find_candidates(rows, titles("faith | My Faith Looks Up To Thee"))
        self.assertEqual([pdmx.score_id(r) for _, r in c.eligible], ["5789390"])
        self.assertEqual(c.rejected, {"it isn't the tune's melody": 1})

    def test_no_catalog_song_has_a_score_that_isnt_the_melody(self):
        for entry in json.loads((ROOT / "catalog/catalog.json").read_text()):
            with self.subTest(song=entry["id"]):
                self.assertNotIn(entry["source"].get("musescore_score_id"), pdmx.NOT_THE_MELODY)

    def test_no_catalog_song_has_a_misbarred_score(self):
        for entry in json.loads((ROOT / "catalog/catalog.json").read_text()):
            if entry["id"] == "saints":  # keeps its hand-picked misbarred score by decision (#232, comment 6459788077)
                continue
            with self.subTest(song=entry["id"]):
                self.assertNotIn(entry["source"].get("musescore_score_id"), pdmx.MISBARRED_SCORES)

    def test_ranking(self):
        rows = [
            row("Mary Had a Little Lamb - Piano", sid="1", rating="5.0", views="9999"),  # head match
            row("Lamb", sid="2", rating="5.0", views="9999", song_name="Mary had a little lamb"),  # song name
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
    """render_options for a score with one tempo and one time signature, both at beat 0."""
    return pdmx.render_options([(0.0, bpm)], [(0.0, *meter)], first_onset)


class ExcerptAndTempo(unittest.TestCase):
    def test_four_four(self):
        self.assertEqual(options(120.0, (4, 4)), {"bpm": 120, "max_beats": 32})
        # A late first note: the excerpt starts on it, and ends on the bar line 32 beats after its bar's.
        self.assertEqual(options(100.4, (4, 4), 0.5), {"bpm": 100, "start_beat": 0.5, "max_beats": 31.5})
        self.assertEqual(options(120.0, (4, 4), 9.0), {"bpm": 120, "start_beat": 9, "max_beats": 31})
        self.assertEqual(options(120.0, (4, 4), 8.0), {"bpm": 120, "start_beat": 8, "max_beats": 32})
        # A first note on a third of a beat keeps its exact beat, so load_midi keeps the note.
        self.assertEqual(options(120.0, (3, 4), 2 / 3)["start_beat"], 2 / 3)

    def test_tempo_is_kept_in_range(self):
        self.assertEqual(options(200.0, (4, 4))["bpm"], 144)
        self.assertEqual(options(50.0, (4, 4))["bpm"], 72)

    def test_other_meters(self):
        self.assertEqual(options(90.0, (3, 4)), {"bpm": 90, "max_beats": 30})
        self.assertEqual(options(90.0, (6, 8)), {"bpm": 90, "max_beats": 30, "beats_per_bar": 3})
        self.assertEqual(options(90.0, (2, 2)), {"bpm": 90, "max_beats": 32, "beats_per_bar": 4})
        self.assertEqual(options(90.0, (3, 8)), {"bpm": 90, "max_beats": 31.5})

    def test_tempo_at_the_first_note(self):
        # MuseScore often writes a tempo change where the music starts; later changes are ignored.
        self.assertEqual(pdmx.render_options([(0.0, 120.0), (4.0, 100.0)], [(0.0, 4, 4)], 4.0)["bpm"], 100)
        self.assertEqual(pdmx.render_options([(0.0, 100.0), (8.0, 60.0)], [(0.0, 4, 4)], 0.0)["bpm"], 100)

    def test_pickup_bar_keeps_bar_lines(self):
        # A pickup written as a 1/4 bar, then 3/4: bar lines at 0, 1, 4, ... 31.
        self.assertEqual(
            pdmx.render_options([(0.0, 90.0)], [(0.0, 1, 4), (1.0, 3, 4)], 0.0),
            {"bpm": 90, "max_beats": 31, "beats_per_bar": 3},
        )
        # A 1/8 pickup, then 6/8: 3 quarter beats a bar, bar lines at 0.5, 3.5, ... 30.5.
        self.assertEqual(
            pdmx.render_options([(0.0, 90.0)], [(0.0, 1, 8), (0.5, 6, 8)], 0.0),
            {"bpm": 90, "max_beats": 30.5, "beats_per_bar": 3},
        )

    def test_meter_change_inside_the_excerpt(self):
        # 4/4 for 16 beats, then 3/4: bar lines 16, 19, ... 31; 4/4 covers more of it.
        self.assertEqual(
            pdmx.render_options([(0.0, 90.0)], [(0.0, 4, 4), (16.0, 3, 4)], 0.0), {"bpm": 90, "max_beats": 31}
        )
        # The excerpt starts after the change: its meter is 3/4.
        self.assertEqual(
            pdmx.render_options([(0.0, 90.0)], [(0.0, 4, 4), (16.0, 3, 4)], 19.0),
            {"bpm": 90, "start_beat": 19, "max_beats": 30, "beats_per_bar": 3},
        )


# Grand Old Flag's shape (#389): a 1/4 pickup bar, then 4/4. Seven bars after the pickup fit in 32
# beats, so the excerpt's closing bar line is beat 29, where "brave" starts, held 3 beats.
PICKUP_BAR = [(0.0, 1, 4), (1.0, 4, 4)]
CADENCE = [(b, 1.0) for b in range(29)] + [(29.0, 3.0), (32.0, 1.0), (33.0, 1.0)]


def held(notes, meters=PICKUP_BAR, first_onset=0.0):
    """render_options at 120 bpm for a melody of (start, dur)."""
    return pdmx.render_options([(0.0, 120.0)], meters, first_onset, notes)


class HeldNote(unittest.TestCase):
    """The excerpt takes in the held note its phrase ends on, when it starts on the closing bar line (#389)."""

    def test_a_pickup_bar_and_a_held_note_on_the_closing_bar_line(self):
        self.assertEqual(held(()), {"bpm": 120, "max_beats": 29, "beats_per_bar": 4})  # the bar lines alone
        self.assertEqual(held(CADENCE), {"bpm": 120, "max_beats": 32, "beats_per_bar": 4})
        # A note held 2 beats is enough, one of 1.75 isn't: the next phrase starts on the bar line.
        two = CADENCE[:29] + [(29.0, 2.0), (31.0, 1.0)]
        self.assertEqual(held(two)["max_beats"], 31)
        self.assertEqual(held(CADENCE[:29] + [(29.0, 1.75), (30.75, 1.0)])["max_beats"], 29)

    def test_the_held_note_ends_at_most_4_beats_past_32(self):
        # 4/4 from beat 0: the closing bar line is 32 beats from the start, so the note may last 4 beats.
        four_four = [(0.0, 4, 4)]
        bars = [(b, 1.0) for b in range(32)]
        self.assertEqual(held(bars + [(32.0, 2.0)], four_four)["max_beats"], 34)
        self.assertEqual(held(bars + [(32.0, 4.0)], four_four)["max_beats"], 36)
        self.assertEqual(held(bars + [(32.0, 4.5)], four_four)["max_beats"], 32)
        # 3/4: ten bars, then a dotted half to beat 33 runs 1 beat past 32.
        self.assertEqual(held(bars[:30] + [(30.0, 3.0)], [(0.0, 3, 4)])["max_beats"], 33)
        # The limit counts from the excerpt's start, not its bar: a first note on beat 3 of a full
        # bar has 36 beats to 39, so a note on the closing bar line at 32 may last 7.
        late = bars[3:]
        self.assertEqual(held(late + [(32.0, 7.0)], four_four, 3.0), {"bpm": 120, "start_beat": 3, "max_beats": 36})
        self.assertEqual(held(late + [(32.0, 7.5)], four_four, 3.0), {"bpm": 120, "start_beat": 3, "max_beats": 29})

    def test_only_the_held_note_is_taken_in_past_32(self):
        # The note after it stays out, however soon it starts, even a held one of its own.
        bars = [(b, 1.0) for b in range(32)]
        self.assertEqual(held(bars + [(32.0, 2.0), (34.0, 1.0)], [(0.0, 4, 4)])["max_beats"], 34)
        self.assertEqual(held(bars + [(32.0, 2.0), (34.0, 2.0)], [(0.0, 4, 4)])["max_beats"], 34)

    def test_no_other_note_starts_inside_the_held_note(self):
        overlapping = CADENCE[:29] + [(29.0, 3.0), (31.0, 1.0), (32.0, 1.0)]
        self.assertEqual(held(overlapping)["max_beats"], 29)
        # Past 32 too: a note inside it leaves the excerpt on the bar line.
        self.assertEqual(held(CADENCE[:29] + [(29.0, 5.0), (33.0, 1.0)])["max_beats"], 29)

    def test_the_held_note_follows_on_from_the_melody(self):
        # After a rest of 2 beats or more the Song would fall silent just before its last note.
        self.assertEqual(held(CADENCE[:28] + [(29.0, 3.0)])["max_beats"], 32)  # a rest of 1 beat
        self.assertEqual(held(CADENCE[:27] + [(29.0, 3.0)])["max_beats"], 29)  # of 2 beats

    def test_rule_britannia_stops_before_the_rest_its_left_hand_fills(self):
        # The left hand plays on to the E4 that repeats the refrain, so taking it in alone would silence the
        # 3 beats before it (#380). The Song keeps its bar-line excerpt and ends on the refrain's cadence (#394, #396).
        path = ROOT / "catalog/midi/pdmx-rule-britannia.mid"
        whole = load_midi(path)
        self.assertEqual([(n.start, n.dur) for n in whole.notes if 28 <= n.start < 35], [(28.0, 1.0), (32.0, 3.0)])
        opts = pdmx.render_options(*import_pdmx.score_meta(path), whole.notes[0].start,
                                   [(n.start, n.dur) for n in whole.notes])
        self.assertEqual(opts["max_beats"], 32)

    def test_a_held_note_that_ends_on_a_third_of_a_beat(self):
        # max_beats rounds down, so load_midi leaves out the next note, which starts on that end.
        notes = [(2 / 3 + b, 1.0) for b in range(29)] + [(30.0, 7 / 3), (30 + 7 / 3, 1.0)]
        opts = held(notes, [(0.0, 3, 4)], 2 / 3)
        self.assertEqual(opts["max_beats"], 31.666666)
        self.assertLess(opts["max_beats"], 30 + 7 / 3 - 2 / 3)

    def test_grand_old_flag_ends_on_brave(self):
        # The tune moves between the score's two staves, so the Song reads both (#380).
        path = ROOT / "catalog/midi/pdmx-grand-old-flag.mid"
        whole = load_midi(path, track=[0, 1])
        opts = pdmx.render_options(*import_pdmx.score_meta(path), whole.notes[0].start,
                                   [(n.start, n.dur) for n in whole.notes])
        self.assertEqual(opts, {"bpm": 120, "max_beats": 32, "beats_per_bar": 4})
        entry = next(e for e in json.loads((ROOT / "catalog/catalog.json").read_text()) if e["id"] == "grand-old-flag")
        self.assertEqual(entry["render"], {**opts, "track": [0, 1]})
        notes = load_midi(path, **entry["render"]).notes
        self.assertEqual((len(notes), notes[-1].pitch, notes[-1].dur), (37, 62, 3.0))  # "brave": D4 for 3 beats

    def test_o_come_all_ye_faithful_runs_past_32_beats_to_finish_its_note(self):
        # The closing bar line is 32 beats from its start, and the note there lasts 4: the furthest
        # any Song runs (#394).
        path = ROOT / "catalog/midi/pdmx-o-come-all-ye-faithful.mid"
        entry = next(e for e in json.loads((ROOT / "catalog/catalog.json").read_text()) if e["id"] == "o-come-all-ye-faithful")
        self.assertEqual(entry["render"]["max_beats"], pdmx.EXCERPT_BEATS + pdmx.HELD_OVERRUN_BEATS)
        notes = load_midi(path, **entry["render"]).notes
        self.assertEqual((notes[-1].start, notes[-1].dur), (32.0, 4.0))

    def test_every_imported_song_ends_on_its_held_note(self):
        # An imported Song's excerpt ends on its closing bar line, or takes in the held note that
        # starts there, unless the full Fixture Library has no fart that lasts it (import_pdmx.excerpt).
        # A hand-entered Song's excerpt is chosen by hand. The closing bar line is the rule's, from the
        # Song's own start: a Song of the first batches starts on its first bar line, not its first note.
        # None runs past the held note's limit (#394).
        from engine import load_library, melody_fit
        library = load_library()
        for entry in json.loads((ROOT / "catalog/catalog.json").read_text()):
            if "import" not in entry:
                continue
            r, path = entry["render"], ROOT / "catalog" / entry["file"]
            whole = load_midi(path, track=r.get("track"))
            bars = pdmx.render_options(*import_pdmx.score_meta(path), whole.notes[0].start)
            close, start = bars.get("start_beat", 0) + bars["max_beats"], r.get("start_beat", 0)
            shorter = pdmx.excerpt_beats(start, close)
            longer = pdmx.excerpt_beats(start, pdmx.held_note_end([(n.start, n.dur) for n in whole.notes], start, close))
            with self.subTest(song=entry["id"]):
                if longer != shorter and not melody_fit(load_midi(path, **{**r, "max_beats": longer}), library).unlocked:
                    longer = shorter
                self.assertEqual(r["max_beats"], longer)
                self.assertLessEqual(r["max_beats"], pdmx.EXCERPT_BEATS + pdmx.HELD_OVERRUN_BEATS)


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
        self.assertEqual(pdmx.sanity_problems([60] * 10, 6, 4, 90), [])  # 10 of 100: 10%
        self.assertIn("11%", pdmx.sanity_problems([60] * 10, 7, 4, 89)[0])

    def test_padded_pickup(self):
        # Happy Birthday as PDMX padded it: "Hap-py" for 1 beat, then 2 beats of silence in a 3/4 bar.
        padded = [(0.0, 0.75), (0.75, 1.0), (3.0, 4.0), (4.0, 5.0)]
        self.assertEqual(pdmx.padded_pickup_problems([(0.0, 3, 4)], padded, 0.0),
                         ["the first bar is a pickup padded with silence: every track rests 2 beats after its notes"])
        # The silence must last at least as long as the notes before it: a pickup is at most half its bar.
        self.assertEqual(pdmx.padded_pickup_problems([(0.0, 4, 4)], [(0.0, 2.0), (4.0, 5.0)], 0.0),
                         ["the first bar is a pickup padded with silence: every track rests 2 beats after its notes"])
        self.assertEqual(pdmx.padded_pickup_problems([(0.0, 4, 4)], [(0.0, 2.25), (4.0, 5.0)], 0.0), [])
        # One beat of silence is enough; less isn't.
        self.assertEqual(pdmx.padded_pickup_problems([(0.0, 2, 4)], [(0.0, 1.0), (2.0, 3.0)], 0.0),
                         ["the first bar is a pickup padded with silence: every track rests 1 beat after its notes"])
        self.assertEqual(pdmx.padded_pickup_problems([(0.0, 4, 4)], [(0.0, 0.75), (4.0, 5.0)], 0.0),
                         ["the first bar is a pickup padded with silence: every track rests 3.25 beats after its notes"])
        self.assertEqual(pdmx.padded_pickup_problems([(0.0, 2, 4)], [(0.0, 0.5), (1.5, 1.75), (2.0, 3.0)], 0.0), [])
        # The bar of the melody's first note, where the excerpt starts; the bars before it don't count.
        self.assertEqual(len(pdmx.padded_pickup_problems([(0.0, 4, 4)], [(0.0, 1.0), (8.0, 9.0), (12.0, 13.0)], 8.0)), 1)

    def test_not_a_padded_pickup(self):
        # The same pickup written as its own 1/4 bar, then 3/4: it leads straight into bar 1.
        self.assertEqual(pdmx.padded_pickup_problems([(0.0, 1, 4), (1.0, 3, 4)], [(0.0, 0.75), (0.75, 1.0), (1.0, 2.0)], 0.0), [])
        # Written as a full bar that opens with rests: the silence comes before the pickup.
        self.assertEqual(pdmx.padded_pickup_problems([(0.0, 3, 4)], [(2.0, 2.75), (2.75, 3.0), (3.0, 4.0)], 0.0), [])
        # A rest of a beat between the bar's notes too: the score's own rhythm (By the Light of the Silvery Moon).
        self.assertEqual(pdmx.padded_pickup_problems([(0.0, 4, 4)], [(0.0, 1.0), (2.0, 3.0), (4.0, 5.0)], 0.0), [])
        # Another track plays on through the melody's rest.
        self.assertEqual(pdmx.padded_pickup_problems([(0.0, 3, 4)], [(0.0, 1.0), (0.0, 3.0), (3.0, 4.0)], 0.0), [])
        # A full bar that ends on a real rest, as a melody-only score can open (#231 review, N1).
        # 4/4: C half, D quarter, quarter rest.
        self.assertEqual(pdmx.padded_pickup_problems([(0.0, 4, 4)], [(0.0, 2.0), (2.0, 3.0), (4.0, 5.0)], 0.0), [])
        # 3/4: a half note, then a quarter rest.
        self.assertEqual(pdmx.padded_pickup_problems([(0.0, 3, 4)], [(0.0, 2.0), (3.0, 4.0)], 0.0), [])
        # 4/4: three staccato eighths on beats 1 to 3, then a rest.
        staccato = [(0.0, 0.5), (1.0, 1.5), (2.0, 2.5), (4.0, 5.0)]
        self.assertEqual(pdmx.padded_pickup_problems([(0.0, 4, 4)], staccato, 0.0), [])

    def test_render_bar(self):
        ok = {"within_50c_of_fart_pct": 94, "onsets_on_time_pct": 95, "notes_with_retrigger": 0}
        self.assertEqual(pdmx.render_problems(ok, BAR), [])
        self.assertEqual(pdmx.render_problems({**ok, "within_50c_of_fart_pct": 93}, BAR), ["in50cFart 93% < 94%"])
        self.assertEqual(len(pdmx.render_problems({**ok, "onsets_on_time_pct": 94}, BAR)), 1)
        self.assertEqual(pdmx.render_problems({**ok, "notes_with_retrigger": 1}, BAR), ["1 notes re-attack"])

    def test_the_bar_is_the_readmes_bar(self):
        # fixtures/golden/README.md states the renderer's bar on notes; this tool's README states the whole gate.
        golden = re.search(r"\*\*Renderer \(#41\)\*\* requires at least (\d+)% of notes within ±50 cents of "
                           r"their fart's own pitch", (ROOT / "fixtures/golden/README.md").read_text())
        gate = re.search(r"at least (\d+)% of notes within ±50 cents of their fart's own pitch, at least (\d+)% of "
                         r"onsets within ±50 ms, and no re-attacks", (HERE / "README.md").read_text())
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
        self.assertEqual([e["id"] for e in merged], ["mary", "z", "x"])  # in the batch's place
        self.assertEqual([e["id"] for e in pdmx.merge_catalog([self.hand, self.other], "tools/catalog/titles-01.txt", [new])],
                         ["mary", "x", "z"])  # a new batch goes last
        with self.assertRaises(ValueError):
            pdmx.merge_catalog([self.hand], "tools/catalog/titles-01.txt", [{**new, "id": "mary"}])

    def test_a_song_imported_again_keeps_its_composer(self):
        looked_up = {"id": "y", "title": "Y", "composer": "Frédéric Chopin", "composer_died": 1849,
                     "composer_source": "https://en.wikipedia.org/wiki/Fr%C3%A9d%C3%A9ric_Chopin",
                     "import": {"titles": "tools/catalog/titles-01.txt"}}
        again = {"id": "y", "title": "Y", "source": {}, "import": {"titles": "tools/catalog/titles-01.txt"}}
        merged = pdmx.merge_catalog([self.hand, looked_up, self.other], "tools/catalog/titles-01.txt", [again])
        self.assertEqual(list(merged[1]), ["id", "title", "composer", "composer_died", "composer_source", "source",
                                           "import"])
        self.assertEqual(merged[1]["composer"], "Frédéric Chopin")
        new = {"id": "z", "title": "Z", "import": {"titles": "tools/catalog/titles-01.txt"}}
        self.assertNotIn("composer", pdmx.merge_catalog([self.hand, looked_up], "tools/catalog/titles-01.txt", [new])[1])

    def test_spread(self):
        self.assertEqual(pdmx.spread(list(range(10)), 3), [0, 4, 9])  # round(4.5) is 4
        self.assertEqual(pdmx.spread([1, 2], 3), [1, 2])
        self.assertEqual(pdmx.spread([1, 2, 3], 1), [1])

    def test_catalog_keeps_its_format(self):
        text = (ROOT / "catalog/catalog.json").read_text()
        self.assertEqual(json.dumps(json.loads(text), indent=1, ensure_ascii=False), text)


class ScoreMeta(unittest.TestCase):
    def test_reads_tempo_and_meter_like_melody_py(self):
        for name in ("pdmx-amazing.mid", "pdmx-row.mid", "pdmx-twinkle.mid"):
            path = ROOT / "catalog/midi" / name
            tempos, meters = import_pdmx.score_meta(path)
            m = load_midi(path)
            with self.subTest(name=name):
                self.assertEqual(tempos[0][0], 0.0)
                self.assertAlmostEqual(round(tempos[0][1], 2), m.bpm)
                self.assertEqual(meters[0][:2], (0.0, m.beats_per_bar))

    def test_pickup_meter_matches_the_curated_songs(self):
        # Amazing Grace and Auld Lang Syne open with a 1/4 pickup bar; their curated entries set
        # the real meter by hand, and the rule finds the same one.
        for name, beats_per_bar in (("pdmx-amazing.mid", 3), ("pdmx-auld.mid", 4)):
            path = ROOT / "catalog/midi" / name
            first = load_midi(path).notes[0].start
            with self.subTest(name=name):
                self.assertEqual(pdmx.render_options(*import_pdmx.score_meta(path), first)["beats_per_bar"], beats_per_bar)


class PaddedPickup(unittest.TestCase):
    """The padded-pickup check on real PDMX files, as the sanity gate runs it (#225)."""

    @staticmethod
    def problems(path):
        _, meters = import_pdmx.score_meta(path)
        return pdmx.padded_pickup_problems(meters, import_pdmx.score_notes(path), load_midi(path).notes[0].start)

    def test_fails_the_scores_the_app_had_for_happy_birthday_and_merry_christmas(self):
        # Until #225 the catalog had these two MuseScore 1.14 scores, public domain in PDMX:
        # https://musescore.com/score/95546 (./mid/1/49/QmbVDLKjmtAqCoc1TNjgtASz7Bi8gXfSt8i6Mmowhjqi1C.mid) and
        # https://musescore.com/score/151013 (./mid/9/43/QmRSYgs3jvLQMTdwaDaGV4EAJKyndRhoxFQppHXwfjKWCE.mid).
        for name in ("pdmx-95546.mid", "pdmx-151013.mid"):
            with self.subTest(name=name):
                self.assertEqual(self.problems(HERE / "testdata" / name),
                                 ["the first bar is a pickup padded with silence: every track rests 2 beats after its notes"])

    def test_no_catalog_song_opens_with_a_padded_pickup(self):
        catalog = json.loads((ROOT / "catalog/catalog.json").read_text())
        for entry in catalog:
            with self.subTest(song=entry["id"]):
                self.assertEqual(self.problems(ROOT / "catalog" / entry["file"]), [])

    def test_score_notes_reads_every_track(self):
        # Each note ends a tick (1/480 beat) early in this file.
        notes = [(round(s, 2), round(e, 2)) for s, e in import_pdmx.score_notes(HERE / "testdata/pdmx-95546.mid")]
        self.assertEqual(notes[:3], [(0.0, 0.75), (0.75, 1.0), (3.0, 4.0)])
        self.assertIn((3.0, 5.0), notes)  # the accompaniment's first chord
        self.assertEqual(len(notes), 48)  # 26 melody notes and 22 accompaniment notes


class MelodyTrack(unittest.TestCase):
    """The importer never takes a percussion part as the melody (#324: O Sacred Head's score 461931 has a
    "Wood Blocks" track on MIDI channel 10 above the hymn, and the Song played the wood blocks)."""

    def midi(self, *tracks):
        """A MIDI file of one track per (channel, program, pitches), each pitch a quarter note."""
        import mido
        mid = mido.MidiFile(ticks_per_beat=480)
        for channel, program, pitches in tracks:
            trk = mido.MidiTrack([mido.Message("program_change", channel=channel, program=program)])
            for p in pitches:
                trk += [mido.Message("note_on", channel=channel, note=p, velocity=80),
                        mido.Message("note_off", channel=channel, note=p, time=480)]
            mid.tracks.append(trk)
        path = temp_dir(self) / "score.mid"
        mid.save(path)
        return path

    def test_skips_the_drum_channel(self):
        m = load_midi(self.midi((0, 22, [64, 69, 67, 65]), (9, 0, [76, 77, 77, 77])))
        self.assertEqual(m.report["track_used"], 0)
        self.assertEqual([n.pitch for n in m.notes], [64, 69, 67, 65])

    def test_skips_a_percussion_program(self):
        m = load_midi(self.midi((0, 0, [60, 62, 64]), (1, 115, [84, 84, 84])))  # GM 116, Woodblock
        self.assertEqual(m.report["track_used"], 0)

    def test_takes_a_pitched_percussion_program(self):
        m = load_midi(self.midi((0, 32, [48, 50, 52, 53]), (1, 114, [76, 79, 81, 79])))  # GM 115, Steel Drums
        self.assertEqual(m.report["track_used"], 1)
        self.assertEqual([n.pitch for n in m.notes], [76, 79, 81, 79])

    def test_a_score_of_only_percussion_still_imports(self):
        m = load_midi(self.midi((9, 0, [76, 77])))
        self.assertEqual(m.report["track_used"], 0)

    def test_the_hymns_score_plays_the_hymn(self):
        m = load_midi(ROOT / "catalog/midi/pdmx-o-sacred-head-now-wounded.mid")
        self.assertEqual(m.report["track_used"], 0)  # "Melodica", not "Wood Blocks"
        self.assertEqual([n.pitch for n in m.notes[:5]], [64, 69, 67, 65, 64])  # E4 A4 G4 F4 E4


def score(test, *tracks):
    """A MIDI file of one track per (name, channel, notes), each note (start, dur, pitch) in beats, as
    PDMX writes a score: a part's staves are tracks with its name and channel, and only the first sets
    the program."""
    import mido
    mid, programmed = mido.MidiFile(ticks_per_beat=480), set()
    for name, channel, notes in tracks:
        trk = mido.MidiTrack([mido.MetaMessage("track_name", name=name)])
        if channel not in programmed:
            trk.append(mido.Message("program_change", channel=channel, program=0))
            programmed.add(channel)
        msgs = sorted([(round(s * 480), 1, p) for s, _, p in notes] + [(round((s + d) * 480), 0, p) for s, d, p in notes])
        tick = 0
        for t, on, p in msgs:
            trk.append(mido.Message("note_on" if on else "note_off", channel=channel, note=p, velocity=80, time=t - tick))
            tick = t
        mid.tracks.append(trk)
    path = temp_dir(test) / "score.mid"
    mid.save(path)
    return path


def line(start, pitches, dur=1.0):
    """Notes of one length, one after another from `start`."""
    return [(start + i * dur, dur, p) for i, p in enumerate(pitches)]


# A piano score like Old MacDonald's (#380): the right hand plays a phrase and rests while the left hand,
# under it a held bass, answers with the tune's next phrase in its register.
RIGHT_HAND = line(0, [72, 72, 72, 67, 69, 69]) + [(6, 2, 67)] + line(12, [76, 76, 74, 74]) + [(16, 4, 72), (24, 4, 72)]
LEFT_HAND = [(0, 8, 48)] + line(8, [64, 64, 62, 62]) + [(12, 8, 48)] + line(20, [64, 64, 62, 62])


class MovedTune(unittest.TestCase):
    """The tune moving to another staff of the score, which left Songs silent where the score plays on (#380)."""

    def test_a_parts_staves_share_its_name_and_channel(self):
        tracks = {0: ("Piano", {0}), 1: ("Piano", {0}), 2: ("Voice", {1}), 3: ("Piano", {2}), 5: ("Piano", {0})}
        self.assertEqual(pdmx.part_staves(tracks, 1), [0, 1, 5])
        self.assertEqual(pdmx.part_staves(tracks, 2), [2])
        self.assertEqual(pdmx.part_staves(tracks, 3), [3])  # a second piano

    def test_a_voice_is_named_or_programmed_as_one(self):
        self.assertTrue(pdmx.sung("Voice", {68}))  # Erlkönig's voice has an oboe's program
        self.assertTrue(pdmx.sung("Soprano 2", {0}))
        self.assertTrue(pdmx.sung("S.", set()))
        self.assertTrue(pdmx.sung("Part_1", {53}))  # Voice Oohs
        self.assertFalse(pdmx.sung("Alto Saxophone", {65}))
        self.assertFalse(pdmx.sung("Bass", {33}))
        self.assertTrue(pdmx.sung("Bass", {52}))
        self.assertFalse(pdmx.sung("Piano", {0}))

    def test_the_tune_can_move_to_another_staff_or_part(self):
        piano, voice, violin2 = (("Piano", {0}), False), (("Voice", {1}), True), (("Violin", {3}), False)
        self.assertEqual(pdmx.tune_staves({0: piano, 1: piano, 2: violin2}, 0),
                         {1: ("another staff of its part", False), 2: ("another part (Violin)", True)})
        # A voice resting while its piano plays is the score's rest; another voice can carry the tune.
        self.assertEqual(pdmx.tune_staves({0: voice, 1: piano, 2: piano}, 0), {})
        self.assertEqual(pdmx.tune_staves({0: voice, 1: (("Alto", {2}), True)}, 0), {1: ("another part (Alto)", True)})
        self.assertEqual(pdmx.tune_staves({0: piano, 1: piano, 2: voice}, 0),
                         {1: ("another staff of its part", False), 2: ("another part (Voice)", True)})
        self.assertEqual(pdmx.tune_staves({0: ((" ", {0}), False), 4: (("", {2}), False)}, 0), {4: ("another part (track 4)", True)})

    def moved(self, melody, staff_notes, start_beat=0.0, other_part=False):
        where = "another part (Violin)" if other_part else "another staff of its part"
        return [p for _, p in pdmx.moved_tune_problems(melody, {1: (where, other_part, staff_notes)}, start_beat)]

    def test_a_rest_while_another_staff_plays_the_tune_fails(self):
        melody = [(0, 1, 72), (1, 1, 67), (4, 1, 72)]
        self.assertEqual(self.moved(melody, [(2, 3, 64), (3, 4, 62)]),
                         ["the tune moves to another staff of its part: the melody rests 2 beats from beat 2 while that staff plays"])
        # The excerpt starts at the score's beat 8.
        self.assertEqual(len(self.moved(melody, [(10, 11, 64), (11, 12, 62)], start_beat=8)), 1)
        self.assertEqual(self.moved(melody, [(2, 3, 64), (3, 4, 62)], start_beat=8), [])

    def test_each_staff_that_plays_the_tune_is_named(self):
        melody = [(0, 1, 72), (4, 1, 72)]
        tune = [(1, 2, 64), (2, 3, 62)]
        staves = {1: ("another staff of its part", False, [(1, 4, 40)]), 3: ("another part (Violin)", True, tune),
                  4: ("another part (Flute)", True, tune)}
        self.assertEqual(pdmx.moved_tune_problems(melody, staves), [
            (3, "the tune moves to another part (Violin): the melody rests 3 beats from beat 1 while that staff plays"),
            (4, "the tune moves to another part (Flute): the melody rests 3 beats from beat 1 while that staff plays"),
        ])

    def test_a_rest_of_a_beat_loses_the_other_hands_notes(self):
        # Jesus Loves Me's right hand rested a beat six times while its left played the tune (#396).
        self.assertEqual(self.moved([(0, 1, 72), (2, 1, 72)], [(1, 2, 64)]),
                         ["the tune moves to another staff of its part: the melody rests 1 beat from beat 1 while that staff plays"])
        self.assertEqual(self.moved([(0, 1, 72), (1.75, 1, 72)], [(1, 1.75, 64)]), [])

    def test_a_hands_chords_in_a_rest_under_two_beats_accompany(self):
        # Marche Slave's left hand plays only its off-beat chord in the right hand's rest (#396).
        chord = [(1.5, 2, 52), (1.5, 2, 45)]
        self.assertEqual(self.moved([(0, 1, 60), (2.25, 1, 60)], chord), [])
        self.assertEqual(len(self.moved([(0, 1, 60), (2.25, 1, 60)], chord + [(2, 2.25, 55)])), 1)  # one onset isn't a chord
        self.assertEqual(len(self.moved([(0, 1, 60), (3, 1, 60)], chord)), 1)  # 2 beats: its chords can carry the tune

    def test_another_part_fills_a_rest_under_two_beats(self):
        # The melody's breath while that part accompanies or answers it (The Swan's baritone sax, #396).
        answer = [(1, 2, 64), (2, 3, 62)]
        self.assertEqual(self.moved([(0, 1, 72), (2.75, 1, 72)], answer, other_part=True), [])
        self.assertEqual(len(self.moved([(0, 1, 72), (3, 1, 72)], answer, other_part=True)), 1)

    def test_a_rest_the_other_staff_is_silent_for_passes(self):
        self.assertEqual(self.moved([(0, 1, 72), (4, 1, 72)], [(0, 1, 48), (4, 5, 48)]), [])

    def test_a_bass_under_the_tune_is_its_accompaniment(self):
        melody = [(0, 1, 72), (1, 1, 79), (4, 1, 72)]
        self.assertEqual(self.moved(melody, [(2, 3, 59)]), [])  # 79 - 59: range 20
        self.assertEqual(len(self.moved(melody, [(2, 3, 60)])), 1)

    def test_another_parts_repeated_note_or_chords_are_its_accompaniment(self):
        melody = [(0, 1, 72), (4, 1, 72)]
        vamp = [(1, 2, 65), (2, 3, 65), (3, 4, 65)]  # Radetzky's guitar: one F4
        self.assertEqual(self.moved(melody, vamp, other_part=True), [])
        self.assertEqual(self.moved(melody, [(1, 2, 65)], other_part=True), [])
        chords = [(s, s + 1, p) for s in (1, 2, 3) for p in (s + 60, s + 64)]
        self.assertEqual(self.moved(melody, chords, other_part=True), [])
        self.assertEqual(len(self.moved(melody, chords + [(3.5, 4, 67)], other_part=True)), 1)  # one onset isn't a chord
        # The other hand of the melody's own instrument answers it even with one note (Summ, summ, summ).
        self.assertEqual(len(self.moved(melody, [(1, 2, 65)])), 1)
        self.assertEqual(len(self.moved(melody, chords)), 1)

    def test_the_staffs_line_is_its_skyline(self):
        # An inner voice under a held note starts no melody note, as in melody.py.
        self.assertEqual(pdmx.staff_line([(0, 4, 72), (1, 2, 40), (2, 3, 64)], 0, 4), [72])
        self.assertEqual(pdmx.staff_line([(0, 4, 72), (1, 2, 40)], 1, 4), [])
        self.assertEqual(pdmx.staff_line([(1, 2, 40), (1, 2, 52), (2, 3, 64)], 0, 4), [52, 64])
        self.assertEqual(pdmx.staff_line([(1, 2, 52), (4, 5, 64)], 0, 4), [52])  # before `end`

    def test_score_tracks_reads_each_staff_and_its_part(self):
        tracks = import_pdmx.score_tracks(score(self, ("Piano", 0, RIGHT_HAND), ("Piano", 0, LEFT_HAND),
                                                ("Voice", 1, line(0, [60, 62]))))
        self.assertEqual({t: part for t, (part, _) in tracks.items()},
                         {0: ("Piano", frozenset({0})), 1: ("Piano", frozenset({0})), 2: ("Voice", frozenset({1}))})
        self.assertEqual(tracks[1][1][:3], [(0.0, 8.0, 48), (8.0, 9.0, 64), (9.0, 10.0, 64)])

    def test_load_midi_reads_a_parts_staves_as_one(self):
        path = score(self, ("Piano", 0, RIGHT_HAND), ("Piano", 0, LEFT_HAND))
        self.assertEqual([n.pitch for n in load_midi(path).notes], [72, 72, 72, 67, 69, 69, 67, 76, 76, 74, 74, 72, 72])
        both = load_midi(path, track=[0, 1])
        self.assertEqual(both.report["track_used"], [0, 1])
        self.assertEqual([(n.start, n.pitch) for n in both.notes[6:12]],
                         [(6.0, 67), (8.0, 64), (9.0, 64), (10.0, 62), (11.0, 62), (12.0, 76)])
        self.assertEqual(len(both.notes), 21)
        self.assertEqual(both.report["chord_tones_dropped"], 2)  # the bass under the right hand

    def test_korobeiniki_picks_the_score_of_the_tune_people_know(self):
        # That score's whole title is an alias, so it ranks with the plain titles and its rating wins (#396).
        korobeiniki = next(t for t in titles((ROOT / "tools/catalog/titles-02.txt").read_text()) if t.id == "korobeiniki")
        rows = [row("Korobeiniki", "585906", views="476"), row("Korobushka", "3104746", views="790"),
                row("Korobeiniki/Korobushka (Tetris Theme)", "103168", rating="4.78", views="9395")]
        [found] = pdmx.find_candidates(rows, [korobeiniki])
        self.assertEqual([pdmx.score_id(r) for _, r in found.eligible], ["103168", "3104746", "585906"])

    def test_no_catalog_song_rests_while_another_staff_plays_the_tune(self):
        for entry in json.loads((ROOT / "catalog/catalog.json").read_text()):
            path = ROOT / "catalog" / entry["file"]
            with self.subTest(song=entry["id"]):
                moved, _ = import_pdmx.tune_moves(path, load_midi(path, **entry["render"]), entry["render"].get("start_beat", 0))
                self.assertEqual(moved, [])


class Extract(unittest.TestCase):
    def test_a_cached_file_cut_short_is_read_again_from_the_archive(self):
        tmp, data = temp_dir(self), SCORE.read_bytes()
        archive = tmp / "mid.tar.gz"
        with tarfile.open(archive, "w:gz") as tar:
            info = tarfile.TarInfo("./mid/1/1/QmA.mid")
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))
        cached = tmp / "extracted/mid/1/1/QmA.mid"
        cached.parent.mkdir(parents=True)
        cached.write_bytes(data[:100])  # what an interrupted run leaves
        with quiet():
            got = import_pdmx.extract(archive, ["./mid/1/1/QmA.mid", "./mid/1/1/QmB.mid"], tmp / "extracted")
        self.assertEqual(got, {"./mid/1/1/QmA.mid": sha256(data)})  # QmB isn't in the archive
        self.assertEqual(cached.read_bytes(), data)
        self.assertEqual([p.name for p in cached.parent.iterdir()], ["QmA.mid"])


class Gate(unittest.TestCase):
    """gate() on one score stops at the first gate that fails, and passes only on the renderer's bar."""

    title = titles("twinkle | Twinkle, Twinkle, Little Star")[0]

    def gate(self, midi, member_sha256, pdmx_row=None, archive=ARCHIVE, metrics=None, unlocked=lambda melody: True):
        """Run gate() with a stub fit that unlocks the melodies `unlocked` says, and a stub plan,
        render and evaluate that report `metrics`. Returns the result, and whether the render gate
        rendered."""
        def fit(melody, library):
            ok = unlocked(melody)
            return SimpleNamespace(unlocked=ok, covered=1, total=1, missing=[] if ok else [(62, 1.5)], octave_moves=0)

        stubs = {
            "melody_fit": mock.Mock(side_effect=fit),
            "plan": mock.Mock(return_value=(0, [SimpleNamespace(shift_semitones=0.0)])),
            "render": mock.Mock(return_value=(None, [])),
            "evaluate": mock.Mock(side_effect=lambda *_: {"per_note": [], **metrics}),
        }
        with mock.patch.multiple(import_pdmx, **stubs):
            r = import_pdmx.gate(self.title, "title", pdmx_row or row("Twinkle Twinkle Little Star"), midi,
                                 member_sha256, archive, library=[])
        return r, stubs["render"].called

    def file(self, data):
        path = temp_dir(self) / "QmA.mid"
        path.write_bytes(data)
        return path

    def test_stops_at_the_license_gate(self):
        r, rendered = self.gate(Path("not-read.mid"), "s", pdmx_row=row("x", license="cc-by", license_url="x"))
        self.assertEqual(r["gates"], {"license": ["the license is not public domain or CC0"]})
        self.assertFalse(r["passed"] or rendered)

    def test_stops_at_the_hash_gate(self):
        data = SCORE.read_bytes()
        r, rendered = self.gate(self.file(data), sha256(data), archive={**ARCHIVE, "md5": "x"})
        self.assertEqual(r["gates"], {"license": "pass", "hash": ["the MIDI archive's md5 x is not Zenodo's m"]})
        self.assertFalse(r["passed"] or rendered)

    def test_a_cached_file_cut_short_fails_the_hash_gate(self):
        data = SCORE.read_bytes()
        r, rendered = self.gate(self.file(data[:100]), sha256(data))
        self.assertEqual(r["gates"]["hash"],
                         [f"the extracted file's sha256 {sha256(data[:100])} is not the archive file's {sha256(data)}"])
        self.assertNotIn("sanity", r["gates"])
        self.assertFalse(r["passed"] or rendered)

    def test_stops_at_the_sanity_gate(self):
        data = b"not a MIDI file"
        r, rendered = self.gate(self.file(data), sha256(data))
        self.assertEqual(list(r["gates"]), ["license", "hash", "sanity"])
        self.assertIn("the MIDI file doesn't import", r["gates"]["sanity"][0])
        self.assertFalse(r["passed"] or rendered)

    def test_a_padded_pickup_fails_the_sanity_gate(self):
        data = (HERE / "testdata/pdmx-95546.mid").read_bytes()
        r, rendered = self.gate(self.file(data), sha256(data))
        self.assertEqual(r["gates"]["sanity"],
                         ["the first bar is a pickup padded with silence: every track rests 2 beats after its notes"])
        self.assertFalse(r["passed"] or rendered)

    def test_passes_only_on_the_bar(self):
        data = SCORE.read_bytes()
        on_bar = {"within_50c_of_fart_pct": 94, "onsets_on_time_pct": 95, "notes_with_retrigger": 0}
        r, rendered = self.gate(self.file(data), sha256(data), metrics={**on_bar, "within_50c_of_fart_pct": 93})
        self.assertTrue(rendered)
        self.assertEqual(r["gates"], {"license": "pass", "hash": "pass", "sanity": "pass", "render": ["in50cFart 93% < 94%"]})
        self.assertFalse(r["passed"])
        r, _ = self.gate(self.file(data), sha256(data), metrics=on_bar)
        self.assertEqual(r["gates"], dict.fromkeys(import_pdmx.GATES, "pass"))
        self.assertTrue(r["passed"])
        self.assertEqual(r["sha256"], sha256(data))

    on_bar = {"within_50c_of_fart_pct": 100, "onsets_on_time_pct": 100, "notes_with_retrigger": 0}

    def test_a_held_note_no_fart_lasts_is_left_out(self):
        # Grand Old Flag's excerpt takes in "brave" (#389), unless the library has no fart for it: then
        # it stops on the bar line before it, where the render gate would fail it for that one note.
        data = (ROOT / "catalog/midi/pdmx-grand-old-flag.mid").read_bytes()
        r, _ = self.gate(self.file(data), sha256(data), metrics=self.on_bar)
        self.assertEqual((r["render"]["max_beats"], len(r["notes"])), (32, 37))
        r, _ = self.gate(self.file(data), sha256(data), metrics=self.on_bar, unlocked=lambda m: len(m.notes) < 37)
        self.assertTrue(r["passed"])
        self.assertEqual((r["render"]["max_beats"], len(r["notes"])), (29, 36))
        # Without it the Song is still locked: the render gate fails it as before.
        r, _ = self.gate(self.file(data), sha256(data), metrics=self.on_bar, unlocked=lambda m: False)
        self.assertEqual(r["render"]["max_beats"], 29)
        self.assertEqual(r["gates"]["render"], ["locked with the full Fixture Library: 1 of 1 notes covered, needs D4 (1.5 s)"])

    def test_a_tune_that_moves_between_staves_is_read_from_both(self):
        path = score(self, ("Piano", 0, RIGHT_HAND), ("Piano", 0, LEFT_HAND))
        r, rendered = self.gate(path, sha256(path.read_bytes()), metrics=self.on_bar)
        self.assertTrue(r["passed"] and rendered)
        self.assertEqual(r["moved_tune"], [
            "the tune moves to another staff of its part: the melody rests 4 beats from beat 8 while that staff plays",
            "the tune moves to another staff of its part: the melody rests 4 beats from beat 20 while that staff plays",
        ])
        self.assertEqual(r["render"]["track"], [0, 1])
        self.assertEqual(r["notes"], [[n.start, n.dur, n.pitch] for n in load_midi(path, **r["render"]).notes])
        self.assertEqual(len(r["notes"]), 21)

    def test_another_parts_line_leaves_the_melody_alone(self):
        path = score(self, ("Voice", 0, RIGHT_HAND), ("Piano", 1, LEFT_HAND))
        r, _ = self.gate(path, sha256(path.read_bytes()), metrics=self.on_bar)
        self.assertTrue(r["passed"])
        self.assertNotIn("moved_tune", r)
        self.assertNotIn("track", r["render"])
        self.assertEqual(len(r["notes"]), 13)

    def test_a_tune_that_moves_to_another_part_is_read_from_both(self):
        # Moments Musicaux's duet: the first violin rests while the second plays the tune.
        path = score(self, ("Violin", 0, RIGHT_HAND), ("Violin", 1, [n for n in LEFT_HAND if n[2] != 48]))
        r, _ = self.gate(path, sha256(path.read_bytes()), metrics=self.on_bar)
        self.assertTrue(r["passed"])
        self.assertEqual(r["moved_tune"][0],
                         "the tune moves to another part (Violin): the melody rests 4 beats from beat 8 while that staff plays")
        self.assertEqual(r["render"]["track"], [0, 1])
        self.assertEqual(len(r["notes"]), 21)

    def test_a_voice_that_rests_while_another_voice_sings_the_tune_is_read_from_both(self):
        path = score(self, ("Soprano", 0, RIGHT_HAND), ("Alto", 1, [n for n in LEFT_HAND if n[2] != 48]),
                     ("Piano", 2, line(8, [60, 62, 64, 65])))
        r, _ = self.gate(path, sha256(path.read_bytes()), metrics=self.on_bar)
        self.assertEqual(len(r["moved_tune"]), 2)
        self.assertEqual(r["render"]["track"], [0, 1])

    def test_staves_that_arent_one_line_fail_the_sanity_gate(self):
        chords = [(s, 1, p) for s in range(8, 11) for p in (52, 55, 60, 64)] + [(11, 1, 62)]  # the tune as chords
        path = score(self, ("Piano", 0, RIGHT_HAND), ("Piano", 0, [(0, 8, 48)] + chords + [(12, 8, 48)]))
        r, rendered = self.gate(path, sha256(path.read_bytes()), metrics=self.on_bar)
        self.assertFalse(r["passed"] or rendered)
        self.assertEqual(r["gates"]["sanity"], [
            "the tune moves to another staff of its part: the melody rests 4 beats from beat 8 while that staff plays",
            "read from tracks 0, 1 as one, the importer dropped 11 chord tones and inner-voice onsets, 39% of the"
            " track's notes (at most 10%)",
        ])


class PickScores(unittest.TestCase):
    """pick_scores tries each title's scores best first, and picks only a score that passed."""

    rows = [row("Shenandoah", sid="1", rating="5.0"), row("Shenandoah", sid="2", rating="4.0"),
            row("Shenandoah", sid="3", rating="3.0")]

    def pick(self, text, rows, passing, tries=5, others=()):
        """Run pick_scores with a stub gate that passes the score ids in `passing`.
        Returns the songs, the picks as (title id, score id), and the scores the gate ran on."""
        ts, ran = titles(text), []

        def try_score(title, match, r):
            sid = pdmx.score_id(r)
            ran.append((title.id, sid))
            return {"score_id": sid, "url": "", "score_title": r["title"], "passed": sid in passing,
                    "gates": {"render": "pass" if sid in passing else ["in50cFart 50% < 94%"]}}

        with quiet():
            songs, picks = import_pdmx.pick_scores(ts, pdmx.find_candidates(rows, ts), list(others), tries, try_score,
                                                   Path("extracted"))
        return songs, [(t.id, r["score_id"]) for t, r, _ in picks], ran

    def test_tries_the_next_score_until_one_passes(self):
        songs, picks, ran = self.pick("s | Shenandoah", self.rows, passing={"2", "3"})
        self.assertEqual(ran, [("s", "1"), ("s", "2")])
        self.assertEqual(picks, [("s", "2")])
        self.assertEqual([r["passed"] for r in songs[0]["tried"]], [False, True])
        self.assertIsNone(songs[0]["reason"])

    def test_picks_nothing_when_no_score_passes(self):
        songs, picks, ran = self.pick("s | Shenandoah", self.rows, passing=set(), tries=2)
        self.assertEqual(ran, [("s", "1"), ("s", "2")])
        self.assertEqual(picks, [])
        self.assertEqual(songs[0]["reason"], "none of the 2 best scores passed; the best: render: in50cFart 50% < 94%")

    def test_a_title_already_in_the_catalog_tries_nothing(self):
        songs, picks, ran = self.pick("s | Shenandoah", self.rows, passing={"1"}, others=[{"id": "x", "title": "The Shenandoah"}])
        self.assertEqual((picks, ran), ([], []))
        self.assertEqual(songs[0]["reason"], "the catalog already has 'The Shenandoah' (x)")

    def test_two_titles_never_get_the_same_score(self):
        rows = [row("Londonderry Air", sid="1", rating="5.0"), row("Londonderry Air", sid="2", rating="4.0")]
        songs, picks, ran = self.pick("danny | Danny Boy | Londonderry Air\nair | Londonderry Air", rows, passing={"1", "2"})
        self.assertEqual(picks, [("danny", "1"), ("air", "2")])
        self.assertEqual(ran, [("danny", "1"), ("air", "2")])
        self.assertEqual(songs[1]["tried"][0]["gates"], {"license": ["already picked for danny in this batch"]})


class WriteCatalog(unittest.TestCase):
    """write_catalog on a temporary catalog: what it writes and drops, and that a failed check writes nothing."""

    batch = "tools/catalog/titles-09.txt"

    def setUp(self):
        self.root = temp_dir(self)
        self.path = self.root / "catalog/catalog.json"
        (self.root / "catalog/midi").mkdir(parents=True)
        self.catalog = [{"id": "mary", "title": "Mary Had a Little Lamb", "file": "midi/mary.mid"},
                        {"id": "gone", "title": "Gone", "file": "midi/pdmx-gone.mid", "import": {"titles": self.batch}}]
        self.path.write_text(json.dumps(self.catalog, indent=1, ensure_ascii=False))
        (self.root / "catalog/midi/mary.mid").write_bytes(b"mary")
        (self.root / "catalog/midi/pdmx-gone.mid").write_bytes(b"gone")
        self.src = self.root / "extracted/QmA.mid"
        self.src.parent.mkdir()
        self.src.write_bytes(SCORE.read_bytes())

    def pick(self, song_id, sha=None):
        """A pick of the score at self.src, gated as it imports with no render options."""
        title = titles(f"{song_id} | Twinkle, Twinkle, Little Star")[0]
        notes = [[n.start, n.dur, n.pitch] for n in load_midi(self.src, title=title.title).notes]
        r = {"score_id": "1", "sha256": sha or sha256(self.src.read_bytes()), "render": {}, "notes": notes,
             "gates": dict.fromkeys(import_pdmx.GATES, "pass"), "passed": True,
             "row": {**row("Twinkle Twinkle Little Star"), "composer_name": "NA"}}
        return title, r, self.src

    def write(self, picks):
        return import_pdmx.write_catalog(self.path, self.catalog, self.batch, picks, ARCHIVE)

    def files(self):
        return {p.relative_to(self.root).as_posix(): p.read_bytes() for p in self.root.rglob("*") if p.is_file()}

    def test_writes_the_picks_and_drops_a_copy_that_fails_the_hash_gate(self):
        good, bad = self.pick("twinkle"), self.pick("star", sha="0" * 64)
        self.assertEqual([e["id"] for e in self.write([good, bad])], ["twinkle"])
        self.assertEqual(good[1]["gates"]["hash"], "pass")
        self.assertFalse(bad[1]["passed"])
        self.assertEqual(bad[1]["gates"]["hash"],
                         [f"the catalog copy's sha256 {sha256(SCORE.read_bytes())} is not the archive file's {'0' * 64}"])
        files = self.files()
        self.assertEqual(sorted(files), ["catalog/catalog.json", "catalog/midi/mary.mid", "catalog/midi/pdmx-twinkle.mid",
                                         "extracted/QmA.mid"])  # the batch's old copy is gone, and nothing is left staged
        self.assertEqual(files["catalog/midi/pdmx-twinkle.mid"], SCORE.read_bytes())
        written = json.loads(files["catalog/catalog.json"])
        self.assertEqual([e["id"] for e in written], ["mary", "twinkle"])
        self.assertEqual(files["catalog/catalog.json"].decode(), json.dumps(written, indent=1, ensure_ascii=False))

    def test_only_keeps_the_batchs_other_songs(self):
        """--only: the batch's Songs it didn't import again stay as they were, in the titles file's order."""
        gone = self.catalog[1]
        entries = import_pdmx.write_catalog(self.path, self.catalog, self.batch, [self.pick("twinkle")], ARCHIVE,
                                            keep=[gone], order=["twinkle", "gone"])
        self.assertEqual([e["id"] for e in entries], ["twinkle"])
        files = self.files()
        self.assertEqual(json.loads(files["catalog/catalog.json"])[1:], [entries[0], gone])
        self.assertEqual(files["catalog/midi/pdmx-gone.mid"], b"gone")

    def test_only_keeps_the_report_rows_of_the_titles_it_didnt_import(self):
        ts = titles("a | A\nb | B\nc | C")
        rows = import_pdmx.report_songs(ts, [{"id": "b", "run": "this"}],
                                        [{"id": "c", "run": "before"}, {"id": "b", "run": "before"}, {"id": "a", "run": "before"}])
        self.assertEqual(rows, [{"id": "a", "run": "before"}, {"id": "b", "run": "this"}, {"id": "c", "run": "before"}])

    def test_a_row_kept_from_before_adr_0012_gives_its_in50c(self):
        self.assertEqual(import_pdmx.in50c_fart({"within_50c_of_fart_pct": 91.2}), "91.2%")
        self.assertEqual(import_pdmx.in50c_fart({"within_50c_pct": 64.0}), "64.0% in50c")
        self.assertEqual(import_pdmx.in50c_fart(None), "")

    def test_an_entry_that_imports_differently_changes_nothing(self):
        title, r, src = self.pick("twinkle")
        r["notes"] = r["notes"][:-1]
        before = self.files()
        with self.assertRaises(import_pdmx.ReimportMismatch):
            self.write([(title, r, src)])
        self.assertEqual(self.files(), before)

    def test_an_id_clash_changes_nothing(self):
        before = self.files()
        with self.assertRaises(ValueError):
            self.write([self.pick("mary")])
        self.assertEqual(self.files(), before)

    def test_a_disk_full_on_the_final_write_changes_nothing(self):
        """The second catalog.json write (the merged one) truncates its file, writes half and fails."""
        writes, real_write_text = [], Path.write_text

        def write_text(p, text, *args, **kwargs):
            if p.name != "catalog.json":
                return real_write_text(p, text, *args, **kwargs)
            writes.append(p)
            if len(writes) < 2:
                return real_write_text(p, text, *args, **kwargs)
            with open(p, "w") as f:
                f.write(text[:len(text) // 2])
            raise OSError(28, "No space left on device")

        before = self.files()
        with mock.patch.object(Path, "write_text", write_text), self.assertRaises(OSError):
            self.write([self.pick("twinkle")])
        self.assertEqual(len(writes), 2)
        self.assertEqual(self.files(), before)  # catalog.json, the stale copy, and no staging left over

    def test_a_failed_rename_keeps_the_old_catalog_and_every_file_it_names(self):
        real_replace = os.replace  # Path.replace calls it too

        def replace(src, dst):
            if Path(dst) == self.path:
                raise OSError("rename failed")
            return real_replace(src, dst)

        before = self.files()
        with mock.patch.object(os, "replace", replace), self.assertRaises(OSError):
            self.write([self.pick("twinkle")])
        after = self.files()
        self.assertEqual(after["catalog/catalog.json"], before["catalog/catalog.json"])
        self.assertEqual(after["catalog/midi/pdmx-gone.mid"], b"gone")
        self.assertFalse(list(self.path.parent.glob(".import-*")))


if __name__ == "__main__":
    unittest.main()
