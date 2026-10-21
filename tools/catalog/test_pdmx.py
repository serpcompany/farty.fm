"""Tests for the PDMX import's picking and gate rules (pdmx.py), and for the importer's control
flow (import_pdmx.py) on temporary files, with a stub renderer and no dataset.

    tools/melody-lab/.venv/bin/python -I -m unittest discover -s tools/catalog -t tools/catalog
"""
import contextlib
import hashlib
import io
import json
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
from evaluate_renders import BAR  # noqa: E402
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
        self.assertEqual(options(100.4, (4, 4), 0.5), {"bpm": 100, "max_beats": 32})  # a late first note
        self.assertEqual(options(120.0, (4, 4), 9.0), {"bpm": 120, "start_beat": 8, "max_beats": 32})

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
            pdmx.render_options([(0.0, 90.0)], [(0.0, 4, 4), (16.0, 3, 4)], 20.0),
            {"bpm": 90, "start_beat": 19, "max_beats": 30, "beats_per_bar": 3},
        )


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

    def test_render_bar(self):
        ok = {"within_50c_pct": 94, "onsets_on_time_pct": 95, "notes_with_retrigger": 0}
        self.assertEqual(pdmx.render_problems(ok, BAR), [])
        self.assertEqual(len(pdmx.render_problems({**ok, "within_50c_pct": 93}, BAR)), 1)
        self.assertEqual(len(pdmx.render_problems({**ok, "onsets_on_time_pct": 94}, BAR)), 1)
        self.assertEqual(pdmx.render_problems({**ok, "notes_with_retrigger": 1}, BAR), ["1 notes re-attack"])

    def test_the_bar_is_the_readmes_bar(self):
        # fixtures/golden/README.md states the renderer's bar on notes; this tool's README states the whole gate.
        golden = re.search(r"\*\*Renderer \(#41\)\*\* requires at least (\d+)% of notes within ±50 cents",
                           (ROOT / "fixtures/golden/README.md").read_text())
        gate = re.search(r"at least (\d+)% of notes within ±50 cents, at least (\d+)% of onsets within ±50 ms, "
                         r"and no re-attacks", (HERE / "README.md").read_text())
        self.assertIsNotNone(golden, "fixtures/golden/README.md no longer states the renderer's bar")
        self.assertIsNotNone(gate, "tools/catalog/README.md no longer states the render gate's bar")
        self.assertEqual(int(gate[1]), int(golden[1]))
        self.assertEqual(BAR, {"within_50c_pct": int(golden[1]), "onsets_on_time_pct": int(gate[2]), "notes_with_retrigger": 0})

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

    def gate(self, midi, member_sha256, pdmx_row=None, archive=ARCHIVE, metrics=None):
        """Run gate() with a stub fit, plan, render and evaluate that report `metrics`.
        Returns the result, and whether the render gate was reached."""
        fit = SimpleNamespace(unlocked=True, covered=1, total=1, missing=[], octave_moves=0)
        stubs = {
            "melody_fit": mock.Mock(return_value=fit),
            "plan": mock.Mock(return_value=(0, [SimpleNamespace(shift_semitones=0.0)])),
            "render": mock.Mock(return_value=(None, [])),
            "evaluate": mock.Mock(side_effect=lambda *_: {"per_note": [], **metrics}),
        }
        with mock.patch.multiple(import_pdmx, **stubs):
            r = import_pdmx.gate(self.title, "title", pdmx_row or row("Twinkle Twinkle Little Star"), midi,
                                 member_sha256, archive, library=[])
        return r, stubs["melody_fit"].called

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

    def test_passes_only_on_the_bar(self):
        data = SCORE.read_bytes()
        on_bar = {"within_50c_pct": 94, "onsets_on_time_pct": 95, "notes_with_retrigger": 0}
        r, rendered = self.gate(self.file(data), sha256(data), metrics={**on_bar, "within_50c_pct": 93})
        self.assertTrue(rendered)
        self.assertEqual(r["gates"], {"license": "pass", "hash": "pass", "sanity": "pass", "render": ["in50c 93% < 94%"]})
        self.assertFalse(r["passed"])
        r, _ = self.gate(self.file(data), sha256(data), metrics=on_bar)
        self.assertEqual(r["gates"], dict.fromkeys(import_pdmx.GATES, "pass"))
        self.assertTrue(r["passed"])
        self.assertEqual(r["sha256"], sha256(data))


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
                    "gates": {"render": "pass" if sid in passing else ["in50c 50% < 94%"]}}

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
        self.assertEqual(songs[0]["reason"], "none of the 2 best scores passed; the best: render: in50c 50% < 94%")

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


if __name__ == "__main__":
    unittest.main()
