import io
import json
import os
import tarfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

import catalog_writer
import dataset
import gates
import pdmx
from analysis import ROOT
from melody import load_midi
from pdmx_testing import ARCHIVE, HERE, PADDED_BY_TWO_BEATS, SCORE, quiet, row, sha256, temp_dir, titles


class ScoreMeta(unittest.TestCase):
    def test_reads_tempo_and_meter_like_melody_py(self):
        for name in ("pdmx-amazing.mid", "pdmx-row.mid", "pdmx-twinkle.mid"):
            path = ROOT / "catalog/midi" / name
            tempos, meters = gates.score_meta(path)
            m = load_midi(path)
            with self.subTest(name=name):
                self.assertEqual(tempos[0][0], 0.0)
                self.assertAlmostEqual(round(tempos[0][1], 2), m.bpm)
                self.assertEqual(meters[0][:2], (0.0, m.beats_per_bar))

    def test_pickup_meter_matches_the_curated_songs(self):
        for name, beats_per_bar in (("pdmx-amazing.mid", 3), ("pdmx-auld.mid", 4)):
            path = ROOT / "catalog/midi" / name
            first = load_midi(path).notes[0].start
            with self.subTest(name=name):
                self.assertEqual(pdmx.render_options(*gates.score_meta(path), first)["beats_per_bar"], beats_per_bar)


class PaddedPickup(unittest.TestCase):
    @staticmethod
    def problems(path):
        _, meters = gates.score_meta(path)
        return pdmx.padded_pickup_problems(meters, gates.score_notes(path), load_midi(path).notes[0].start)

    def test_fails_the_scores_the_app_had_for_happy_birthday_and_merry_christmas(self):
        for name in ("pdmx-95546.mid", "pdmx-151013.mid"):
            with self.subTest(name=name):
                self.assertEqual(self.problems(HERE / "testdata" / name), PADDED_BY_TWO_BEATS)

    def test_no_catalog_song_opens_with_a_padded_pickup(self):
        catalog = json.loads((ROOT / "catalog/catalog.json").read_text(encoding="utf-8"))
        for entry in catalog:
            with self.subTest(song=entry["id"]):
                self.assertEqual(self.problems(ROOT / "catalog" / entry["file"]), [])

    def test_score_notes_reads_every_track(self):
        notes = [(round(s, 2), round(e, 2)) for s, e in gates.score_notes(HERE / "testdata/pdmx-95546.mid")]
        self.assertEqual(notes[:3], [(0.0, 0.75), (0.75, 1.0), (3.0, 4.0)])
        accompaniment_first_chord = (3.0, 5.0)
        self.assertIn(accompaniment_first_chord, notes)
        melody_notes, accompaniment_notes = 26, 22
        self.assertEqual(len(notes), melody_notes + accompaniment_notes)


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
        cached.write_bytes(data[:100])
        with quiet():
            got = dataset.extract(archive, ["./mid/1/1/QmA.mid", "./mid/1/1/QmB.mid"], tmp / "extracted")
        self.assertEqual(got, {"./mid/1/1/QmA.mid": sha256(data)})
        self.assertEqual(cached.read_bytes(), data)
        self.assertEqual([p.name for p in cached.parent.iterdir()], ["QmA.mid"])


class Gate(unittest.TestCase):
    title = titles("twinkle | Twinkle, Twinkle, Little Star")[0]

    def gate(self, midi, member_sha256, pdmx_row=None, archive=ARCHIVE, metrics=None):
        fit = SimpleNamespace(unlocked=True, covered=1, total=1, missing=[], octave_moves=0)
        stubs = {
            "melody_fit": mock.Mock(return_value=fit),
            "plan": mock.Mock(return_value=(0, [SimpleNamespace(shift_semitones=0.0)])),
            "render": mock.Mock(return_value=(None, [])),
            "evaluate": mock.Mock(side_effect=lambda *_: {"per_note": [], **metrics}),
        }
        with mock.patch.multiple(gates, **stubs):
            r = gates.gate(self.title, "title", pdmx_row or row("Twinkle Twinkle Little Star"), midi,
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

    def test_a_padded_pickup_fails_the_sanity_gate(self):
        data = (HERE / "testdata/pdmx-95546.mid").read_bytes()
        r, rendered = self.gate(self.file(data), sha256(data))
        self.assertEqual(r["gates"]["sanity"], PADDED_BY_TWO_BEATS)
        self.assertFalse(r["passed"] or rendered)

    def test_passes_only_on_the_bar(self):
        data = SCORE.read_bytes()
        on_bar = {"within_50c_of_fart_pct": 94, "onsets_on_time_pct": 95, "notes_with_retrigger": 0}
        r, rendered = self.gate(self.file(data), sha256(data), metrics={**on_bar, "within_50c_of_fart_pct": 93})
        self.assertTrue(rendered)
        self.assertEqual(r["gates"], {"license": "pass", "hash": "pass", "sanity": "pass", "render": ["in50cFart 93% < 94%"]})
        self.assertFalse(r["passed"])
        r, _ = self.gate(self.file(data), sha256(data), metrics=on_bar)
        self.assertEqual(r["gates"], dict.fromkeys(gates.GATES, "pass"))
        self.assertTrue(r["passed"])
        self.assertEqual(r["sha256"], sha256(data))


class PickScores(unittest.TestCase):
    rows = [row("Shenandoah", sid="1", rating="5.0"), row("Shenandoah", sid="2", rating="4.0"),
            row("Shenandoah", sid="3", rating="3.0")]

    def pick(self, text, rows, passing, tries=5, others=()):
        ts, ran = titles(text), []

        def try_score(title, match, r):
            sid = pdmx.score_id(r)
            ran.append((title.id, sid))
            return {"score_id": sid, "url": "", "score_title": r["title"], "passed": sid in passing,
                    "gates": {"render": "pass" if sid in passing else ["in50cFart 50% < 94%"]}}

        with quiet():
            songs, picks = gates.pick_scores(ts, pdmx.find_candidates(rows, ts), list(others), tries, try_score,
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
    batch = "tools/catalog/titles-09.txt"

    def setUp(self):
        self.root = temp_dir(self)
        self.path = self.root / "catalog/catalog.json"
        (self.root / "catalog/midi").mkdir(parents=True)
        self.catalog = [{"id": "mary", "title": "Mary Had a Little Lamb", "file": "midi/mary.mid"},
                        {"id": "gone", "title": "Gone", "file": "midi/pdmx-gone.mid", "import": {"titles": self.batch}}]
        self.path.write_text(json.dumps(self.catalog, indent=1, ensure_ascii=False), encoding="utf-8")
        (self.root / "catalog/midi/mary.mid").write_bytes(b"mary")
        (self.root / "catalog/midi/pdmx-gone.mid").write_bytes(b"gone")
        self.src = self.root / "extracted/QmA.mid"
        self.src.parent.mkdir()
        self.src.write_bytes(SCORE.read_bytes())

    def pick(self, song_id, sha=None):
        title = titles(f"{song_id} | Twinkle, Twinkle, Little Star")[0]
        notes = [[n.start, n.dur, n.pitch] for n in load_midi(self.src, title=title.title).notes]
        r = {"score_id": "1", "sha256": sha or sha256(self.src.read_bytes()), "render": {}, "notes": notes,
             "gates": dict.fromkeys(gates.GATES, "pass"), "passed": True,
             "row": {**row("Twinkle Twinkle Little Star"), "composer_name": "NA"}}
        return title, r, self.src

    def write(self, picks):
        return catalog_writer.write_catalog(self.path, self.catalog, self.batch, picks, ARCHIVE)

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
        nothing_left_staged = ["catalog/catalog.json", "catalog/midi/mary.mid", "catalog/midi/pdmx-twinkle.mid",
                               "extracted/QmA.mid"]
        self.assertEqual(sorted(files), nothing_left_staged)
        self.assertEqual(files["catalog/midi/pdmx-twinkle.mid"], SCORE.read_bytes())
        written = json.loads(files["catalog/catalog.json"])
        self.assertEqual([e["id"] for e in written], ["mary", "twinkle"])
        self.assertEqual(files["catalog/catalog.json"].decode(), json.dumps(written, indent=1, ensure_ascii=False))

    def test_an_entry_that_imports_differently_changes_nothing(self):
        title, r, src = self.pick("twinkle")
        r["notes"] = r["notes"][:-1]
        before = self.files()
        with self.assertRaises(catalog_writer.ReimportMismatch):
            self.write([(title, r, src)])
        self.assertEqual(self.files(), before)

    def test_an_id_clash_changes_nothing(self):
        before = self.files()
        with self.assertRaises(ValueError):
            self.write([self.pick("mary")])
        self.assertEqual(self.files(), before)

    def test_a_disk_full_on_the_final_write_changes_nothing(self):
        writes, real_write_text = [], Path.write_text

        def write_text(p, text, *args, **kwargs):
            if p.name != "catalog.json":
                return real_write_text(p, text, *args, **kwargs)
            writes.append(p)
            if len(writes) < 2:
                return real_write_text(p, text, *args, **kwargs)
            with open(p, "w", encoding="utf-8") as f:
                f.write(text[:len(text) // 2])
            raise OSError(28, "No space left on device")

        before = self.files()
        with mock.patch.object(Path, "write_text", write_text), self.assertRaises(OSError):
            self.write([self.pick("twinkle")])
        self.assertEqual(len(writes), 2)
        self.assertEqual(self.files(), before)

    def test_a_failed_rename_keeps_the_old_catalog_and_every_file_it_names(self):
        real_replace = os.replace

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
