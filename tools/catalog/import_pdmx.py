"""Batch-import Songs from PDMX into the Song Catalog, keeping only the ones that pass the gates.

    tools/melody-lab/.venv/bin/python -I tools/catalog/import_pdmx.py --titles tools/catalog/titles-01.txt

For each title in the titles file it picks the best PDMX score, runs the gates, and tries the
next best score when one fails, up to --tries scores. A score is picked for one title at most,
so no two Songs share a score. A Song that passes is copied to catalog/midi/ and added to
catalog/catalog.json with its provenance. Every title gets a line in the report, written next to
the titles file (<titles>.report.md and .json). Nothing edits notes: the catalog keeps the
score's own MIDI file and only chooses the excerpt and tempo (ADR 0003). Imported Songs don't
ship until they're on the app's ship list (apps/web/src/lib/catalog/generate.ts).

The rules and thresholds are in pdmx.py. The gates, in order:

  license  public domain or CC0, with the URL PDMX records, and no PDMX license conflict
  hash     the MIDI archive matches Zenodo's md5, and the extracted file the gates import and the
           catalog copy are byte for byte the archive's file
  sanity   the excerpt's note count and range, and the share of notes the importer drops
  render   unlocked with the full Fixture Library, and the renderer's bar on the reference render
           (ADR 0012, evaluate.BAR): in50cFart >= 94% (notes within 50 cents of their fart's
           own pitch), onTime >= 95%, no re-attacks

catalog/ is written only once every passing Song's entry imports to exactly the melody its gates
judged. If one doesn't, the run stops with ReimportMismatch and leaves catalog/ as it was.

Running it again with the same titles file replaces that file's earlier entries, so a run is
repeatable. Entries from anywhere else are never changed, and a title already in the catalog fails.

The dataset (doi:10.5281/zenodo.15571083) goes to a cache outside the repository (--cache,
default ~/.cache/pedos/pdmx): PDMX.csv (225 MB) and mid.tar.gz (214 MB), checked against
Zenodo's md5 on every run. Every run reads the MIDI files of the scores it tries from the
archive, and keeps an extracted file only while it's byte for byte the archive's.

--listen DIR also renders a spot-check sample of the passing Songs to DIR as WAV, with
evaluate.py's numbers measured on the written files.

Run it with python -I: the dataset is untrusted input, and the script puts the melody lab on
sys.path itself.
"""
import argparse
import csv
import datetime
import hashlib
import json
import os
import re
import sys
import tarfile
import tempfile
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path[:0] = [str(HERE), str(ROOT / "tools/melody-lab")]

import librosa  # noqa: E402
import mido  # noqa: E402
import soundfile as sf  # noqa: E402

import pdmx  # noqa: E402
from engine import SR, load_library, melody_fit, plan, render  # noqa: E402
from evaluate import BAR, evaluate  # noqa: E402
from melody import load_catalog, load_midi  # noqa: E402

RECORD = "https://zenodo.org/api/records/15571083"
DOI = "10.5281/zenodo.15571083"
DATASET = "PDMX: A Large-Scale Public Domain MusicXML Dataset (Long et al., ICASSP 2025)"
FILES = ("PDMX.csv", "mid.tar.gz")
CATALOG = ROOT / "catalog/catalog.json"
TOOL = "tools/catalog/import_pdmx.py"
MIDI_PATH = re.compile(r"\./mid/\d+/\d+/[A-Za-z0-9]+\.mid")  # a PDMX MIDI path, as the CSV writes it
GATES = ("license", "hash", "sanity", "render")


def rel(path):
    return Path(path).resolve().relative_to(ROOT).as_posix()


def file_hash(path, algorithm):
    h = hashlib.new(algorithm)
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


# ---------------------------------------------------------------- the dataset


def fetch_dataset(cache):
    """Download PDMX.csv and mid.tar.gz into `cache` once, and check them against Zenodo's md5."""
    cache.mkdir(parents=True, exist_ok=True)
    record_file = cache / "zenodo-record.json"
    if not record_file.exists():
        with urllib.request.urlopen(RECORD) as r:
            record_file.write_bytes(r.read())
    published = {f["key"]: f["checksum"].removeprefix("md5:") for f in json.loads(record_file.read_text())["files"]}
    downloads_file = cache / "downloads.json"
    downloads = json.loads(downloads_file.read_text()) if downloads_file.exists() else {}
    out = {}
    for name in FILES:
        path = cache / name
        if not path.exists():
            print(f"downloading {name} into {cache} ...", flush=True)
            part = path.with_suffix(path.suffix + ".part")
            urllib.request.urlretrieve(f"{RECORD}/files/{name}/content", part)
            part.rename(path)
        if name not in downloads:
            downloads[name] = {"downloaded": datetime.date.fromtimestamp(path.stat().st_mtime).isoformat()}
        md5 = file_hash(path, "md5")
        out[name] = {"path": path, "md5": md5, "published_md5": published[name], "downloaded": downloads[name]["downloaded"]}
        if md5 != published[name]:
            sys.exit(f"error: {path} has md5 {md5}, Zenodo publishes {published[name]}; delete it and run again")
    downloads_file.write_text(json.dumps(downloads, indent=1) + "\n")
    return out


def read_rows(csv_path):
    with open(csv_path, newline="", encoding="utf-8") as f:
        yield from csv.DictReader(f)


def extract(archive, members, out):
    """Make `out` hold each of `members` (the CSV's ./mid/... paths) byte for byte as the MIDI
    archive has it, and return {member: its sha256 in the archive}, leaving out members the archive
    doesn't have. The archive is read on every run (about 6 s): an extracted file from an earlier
    run is kept only when its sha256 is the archive file's, and is rewritten whole otherwise, so a
    file cut short by an interrupted run can't pass the hash gate."""
    for m in members:
        if not MIDI_PATH.fullmatch(m):
            raise ValueError(f"unexpected MIDI path {m!r}")
    want, member_sha256 = set(members), {}
    if want:
        print(f"reading {len(want)} MIDI files from {archive.name} ...", flush=True)
        with tarfile.open(archive, "r|gz") as tar:
            for info in tar:
                name = "./" + info.name.removeprefix("./")
                if name in want and info.isfile():
                    data = tar.extractfile(info).read()
                    member_sha256[name] = hashlib.sha256(data).hexdigest()
                    dest = out / name
                    if not dest.is_file() or file_hash(dest, "sha256") != member_sha256[name]:
                        dest.parent.mkdir(parents=True, exist_ok=True)
                        part = dest.with_name(dest.name + ".part")
                        part.write_bytes(data)
                        part.replace(dest)
                    want.discard(name)
                    if not want:
                        break
    return member_sha256


# ---------------------------------------------------------------- the gates


def score_meta(path):
    """A MIDI file's tempo and time signature events, in quarter-note beats as melody.py counts
    them: ([(beat, bpm)], [(beat, numerator, denominator)]), with melody.py's defaults at beat 0
    (120 bpm, 4/4) when the file sets none there."""
    mid = mido.MidiFile(path)
    tempos, meters = {0.0: 120.0}, {0.0: (4, 4)}
    for track in mid.tracks:
        tick = 0
        for msg in track:
            tick += msg.time
            if msg.type == "set_tempo":
                tempos[tick / mid.ticks_per_beat] = 60_000_000 / msg.tempo
            elif msg.type == "time_signature":
                meters[tick / mid.ticks_per_beat] = (msg.numerator, msg.denominator)
    return sorted(tempos.items()), [(at, *m) for at, m in sorted(meters.items())]


def gate(title, match, row, midi, member_sha256, archive, library):
    """Run every gate on one PDMX score, stopping at the first that fails. `midi` is the extracted
    file and `member_sha256` the archive file's sha256 (extract); the hash gate checks one against
    the other before anything imports the file."""
    sid = pdmx.score_id(row)
    result = {
        "score_id": sid,
        "url": f"https://musescore.com/score/{sid}",
        "score_title": row["title"],
        "match": match,
        "rating": row["rating"],
        "n_ratings": row["n_ratings"],
        "n_views": row["n_views"],
        "license": row["license"],
        "n_tracks": row["n_tracks"],
        "dataset_path": row["mid"],
        "gates": {},
        "passed": False,
    }
    gates = result["gates"]

    def failed(name, problems):
        gates[name] = problems or "pass"
        return bool(problems)

    if failed("license", pdmx.pick_problems(row)):
        return result
    result["sha256"] = member_sha256
    hashes = pdmx.hash_problems(archive["md5"], archive["published_md5"], member_sha256, file_hash(midi, "sha256"),
                                copy="the extracted file")
    if failed("hash", hashes):
        return result

    try:
        whole = load_midi(midi)
        options = pdmx.render_options(*score_meta(midi), first_onset=whole.notes[0].start)
        melody = load_midi(midi, title=title.title, **options)
    except Exception as e:  # a MIDI file the importer can't read fails sanity
        failed("sanity", [f"the MIDI file doesn't import: {type(e).__name__}: {e}"])
        return result
    report = {k: v for k, v in melody.report.items() if k != "source_file"}
    pitches = [n.pitch for n in melody.notes]
    result.update(
        render=options,
        import_report=report,
        track_notes=len(whole.notes),
        range_semitones=max(pitches) - min(pitches) if pitches else None,
        distinct_pitches=len(set(pitches)),
    )
    sanity = pdmx.sanity_problems(
        pitches, report["chord_tones_dropped"], report["inner_voice_onsets_dropped"], len(whole.notes)
    )
    if failed("sanity", sanity):
        return result

    fit = melody_fit(melody, library)
    result["pitch_coverage"] = f"{fit.covered} of {fit.total}"
    if not fit.unlocked:
        missing = " ".join(f"{librosa.midi_to_note(p)} ({s:.1f} s)" for p, s in fit.missing)
        failed("render", [f"locked with the full Fixture Library: {fit.covered} of {fit.total} notes covered, needs {missing}"])
        return result
    transpose, assignments = plan(melody, library)
    audio, events = render(melody, library, assignments, bpm=melody.bpm)
    metrics = evaluate(audio, melody, events, melody.bpm, library)
    metrics.pop("per_note")
    metrics.update(
        transpose=transpose,
        octave_moves=fit.octave_moves,
        max_abs_shift_semitones=max(abs(a.shift_semitones) for a in assignments),
    )
    result["metrics"] = metrics
    result["notes"] = [[n.start, n.dur, n.pitch] for n in melody.notes]  # what the gates judged
    result["passed"] = not failed("render", pdmx.render_problems(metrics, BAR))
    return result


def summary_line(song_id, r):
    m = r.get("metrics")
    if m is None:
        return f"{song_id:24s} {r['score_id']:>9s} {'PASS' if r['passed'] else 'fail'}"
    return (
        f"{song_id:24s} {r['score_id']:>9s} {'PASS' if r['passed'] else 'fail'} T={m['transpose']:+d}"
        f" notes={m['notes']:3d} in50cFart={m['within_50c_of_fart_pct']:3d}% onTime={m['onsets_on_time_pct']}%"
        f" reatk={m['notes_with_retrigger']} | in50c={m['within_50c_pct']:3d}% med={m['median_abs_cents']:5.1f}c"
        f" contour={m['contour_pct']}% recs={m['distinct_recordings']} octaveMoves={m['octave_moves']}"
    )


def first_problem(r):
    for name in GATES:
        problems = r["gates"].get(name)
        if problems and problems != "pass":
            return f"{name}: {'; '.join(problems)}"
    return None


def not_tried(row, gate_name, problem):
    """The result for a score that fails `gate_name` before any gate runs on it."""
    sid = pdmx.score_id(row)
    return {"score_id": sid, "url": f"https://musescore.com/score/{sid}", "score_title": row["title"],
            "gates": {gate_name: [problem]}, "passed": False}


def pick_scores(titles, found, others, tries, try_score, midi_dir):
    """Try each title's best eligible scores in order, up to `tries`, until one passes
    (`try_score(title, match, row)` runs the gates). A title already in the catalog (`others`)
    tries none. A score that passed for an earlier title fails the license gate, which re-checks
    the picking rules, so no two Songs share a score.

    Returns the report's songs, and the picks as (title, result with its row, extracted MIDI file)."""
    songs, picks, picked = [], [], {}  # picked: a MIDI path -> the id of the title it passed for
    for title, cands in zip(titles, found):
        song = {"id": title.id, "title": title.title, "matched": cands.matched, "eligible": len(cands.eligible),
                "rejected": cands.rejected, "tried": [], "result": "fail", "reason": None, "picked": None}
        songs.append(song)
        new = pdmx.new_title_problems(title, others)
        if new:
            song["reason"] = "; ".join(new)
        elif not cands.eligible:
            song["reason"] = "no PDMX score matches" if not cands.matched else "no matching PDMX score can be picked"
        for match, row in [] if new else cands.eligible[:tries]:
            if row["mid"] in picked:
                r = not_tried(row, "license", f"already picked for {picked[row['mid']]} in this batch")
            else:
                r = try_score(title, match, row)
            song["tried"].append(r)
            print(summary_line(title.id, r) + ("" if r["passed"] else f"  {first_problem(r)}"), flush=True)
            if r["passed"]:
                picked[row["mid"]] = title.id
                picks.append((title, {**r, "row": row}, midi_dir / row["mid"]))
                break
        if song["tried"] and not song["reason"]:
            song["reason"] = None if song["tried"][-1]["passed"] else (
                f"none of the {len(song['tried'])} best scores passed; the best: {first_problem(song['tried'][0])}")
    return songs, picks


# ---------------------------------------------------------------- the catalog and the report


def catalog_entry(title, r, retrieved, titles_file):
    sid = r["score_id"]
    row = r["row"]
    return {
        "id": title.id,
        "title": title.title,
        "file": f"midi/pdmx-{title.id}.mid",
        "sha256": r["sha256"],
        "source": {
            "dataset": DATASET,
            "dataset_doi": DOI,
            "dataset_path": row["mid"],
            "musescore_score_id": sid,
            "musescore_url": f"https://musescore.com/score/{sid}",
            "score_title": row["title"],
            "composer": row["composer_name"],
            "license": row["license"],
            "license_url": row["license_url"],
            "pdmx_license_conflict": row["license_conflict"],
            "rating": row["rating"],
            "n_ratings": row["n_ratings"],
            "n_views": row["n_views"],
        },
        "retrieved": retrieved,
        "render": r["render"],
        "import": {"tool": TOOL, "titles": titles_file},
    }


class ReimportMismatch(Exception):
    """A passing Song's catalog entry imports to a different melody from the one its gates judged."""


def write_catalog(path, catalog, titles_file, picks, archive):
    """Replace this titles file's entries in the catalog at `path` (catalog.json) with the picks,
    and copy each picked score into midi/ next to it. A pick whose copy isn't byte for byte the
    archive's file is dropped and fails the hash gate.

    The copies and entries are staged first, and nothing in the catalog changes until every entry
    imports, through the catalog's own loader, to exactly the melody its gates judged. If one
    doesn't, this raises ReimportMismatch with the catalog as it was.

    The merged catalog.json is written in the staging directory too, and renamed over the real one
    only after the copies have moved in. The batch's stale copies are removed after that, so a
    failure before the rename leaves the old catalog.json with every file it names."""
    with tempfile.TemporaryDirectory(prefix=".import-", dir=path.parent) as staging:
        staging = Path(staging)
        (staging / "midi").mkdir()
        kept = []
        for title, r, src in picks:
            entry = catalog_entry(title, r, archive["downloaded"], titles_file)
            copy = staging / entry["file"]
            copy.write_bytes(src.read_bytes())
            problems = pdmx.hash_problems(archive["md5"], archive["published_md5"], r["sha256"], file_hash(copy, "sha256"))
            r["gates"]["hash"] = problems or "pass"
            if problems:
                r["passed"] = False
                continue
            kept.append((title, r, entry))
        entries = [entry for _, _, entry in kept]
        (staging / path.name).write_text(json.dumps(entries))
        imported = {c["id"]: m for c, m in load_catalog(staging / path.name)}
        for title, r, _ in kept:
            if [[n.start, n.dur, n.pitch] for n in imported[title.id].notes] != r["notes"]:
                raise ReimportMismatch(f"{title.id}: the catalog entry imports differently from what was gated; "
                                       "the catalog is unchanged")
        merged = pdmx.merge_catalog(catalog, titles_file, entries)
        old = {e["file"] for e in catalog if pdmx.batch_of(e) == titles_file}
        (staging / path.name).write_text(json.dumps(merged, indent=1, ensure_ascii=False))  # the file's own format
        for entry in entries:
            (staging / entry["file"]).replace(path.parent / entry["file"])
        os.replace(staging / path.name, path)
        for stale in old - {e["file"] for e in merged}:
            (path.parent / stale).unlink(missing_ok=True)
    return entries


def table_row(*cells):
    return "| " + " | ".join(str(c).replace("|", "\\|") for c in cells) + " |"


def write_report(path, run, songs):
    lean = [{**s, "tried": [{k: v for k, v in r.items() if k != "notes"} for r in s["tried"]]} for s in songs]
    path.with_name(path.name + ".json").write_text(json.dumps({**run, "songs": lean}, indent=1, ensure_ascii=False) + "\n")
    passed = [s for s in songs if s["result"] == "pass"]
    lines = [
        f"# PDMX import report: `{run['titles']}`",
        "",
        f"Generated by `{TOOL}`; don't edit by hand. Command:",
        "",
        "```sh",
        run["command"],
        "```",
        "",
        f"**{len(passed)} of {len(songs)} titles pass** and are in `catalog/catalog.json`; "
        f"{len(songs) - len(passed)} fail. Imported Songs don't ship until they're on the app's ship list.",
        "",
        f"- Dataset: PDMX, doi:{DOI}. `PDMX.csv` md5 `{run['dataset']['PDMX.csv']['md5']}` and `mid.tar.gz` md5 "
        f"`{run['dataset']['mid.tar.gz']['md5']}`, both equal to Zenodo's; downloaded {run['dataset']['mid.tar.gz']['downloaded']}.",
        f"- Picking: {run['picking']}",
        f"- Gates: {run['gates']}",
        f"- Render bar: in50cFart >= {BAR['within_50c_of_fart_pct']}%, onTime >= {BAR['onsets_on_time_pct']}%, "
        f"re-attacks <= {BAR['notes_with_retrigger']}, with the full Fixture Library ({run['library']}).",
        "",
        "## Every title",
        "",
        table_row("Song", "Result", "Score", "Match", "License", "Rating", "Views", "Notes", "Range", "Dropped",
                  "Pitches", "in50cFart", "onTime", "Re-attacks", "Why it failed"),
        table_row(*["---"] * 15),
    ]
    for s in songs:
        r = s["tried"][-1] if s["tried"] else None
        if r is None:
            lines.append(table_row(s["title"], s["result"], "", "", "", "", "", "", "", "", "", "", "", "", s["reason"]))
            continue
        m = r.get("metrics", {})
        rep = r.get("import_report", {})
        dropped = (f"{rep['chord_tones_dropped'] + rep['inner_voice_onsets_dropped']} of "
                   f"{r['track_notes'] + rep['chord_tones_dropped'] + rep['inner_voice_onsets_dropped']}") if rep else ""
        lines.append(table_row(
            s["title"], s["result"], f"[{r['score_id']}]({r['url']})", r["match"], r["license"], r["rating"], r["n_views"],
            rep.get("note_count", ""), r.get("range_semitones", ""), dropped, r.get("pitch_coverage", ""),
            f"{m['within_50c_of_fart_pct']}%" if m else "", f"{m['onsets_on_time_pct']}%" if m else "",
            m.get("notes_with_retrigger", ""), "" if s["result"] == "pass" else s["reason"],
        ))
    lines += [
        "",
        "The row shows the score that passed, or the last one tried. Dropped: chord tones and inner-voice",
        "onsets the importer dropped, of the track's notes. Pitches: Pitch Coverage with the full library.",
        "",
        "## Every score tried",
        "",
    ]
    for s in songs:
        lines.append(f"- **{s['title']}** (`{s['id']}`): {s['matched']} PDMX scores match, {s['eligible']} can be picked"
                     + (f"; {s['matched'] - s['eligible']} can't ({', '.join(f'{n} {why}' for why, n in sorted(s['rejected'].items()))})"
                        if s["rejected"] else "")
                     + f". {s['result'].upper()}" + ("" if s["result"] == "pass" else f": {s['reason']}"))
        for r in s["tried"]:
            lines.append(f"  - [{r['score_id']}]({r['url']}) {r['score_title']!r}: "
                         + ("pass" if r["passed"] else first_problem(r)))
    path.with_name(path.name + ".md").write_text("\n".join(lines) + "\n")


def listen(sample, library, out):
    """Render the sample to WAV and measure each written file with evaluate.py."""
    out.mkdir(parents=True, exist_ok=True)
    for title, r, midi in sample:
        melody = load_midi(midi, title=title.title, **r["render"])
        _, assignments = plan(melody, library)
        audio, events = render(melody, library, assignments, bpm=melody.bpm)
        wav = out / f"{title.id}.wav"
        sf.write(wav, audio, SR, subtype="PCM_16")
        heard, _ = librosa.load(wav, sr=SR, mono=True)
        metrics = evaluate(heard, melody, events, melody.bpm, library)
        metrics.pop("per_note")
        (out / f"{title.id}.json").write_text(json.dumps(
            {"song": title.id, "title": title.title, "score": r["url"], "render": r["render"],
             "measured_on": wav.name, "metrics": metrics, "gate_metrics": r["metrics"]}, indent=1) + "\n")
        print(f"listen {wav}: in50cFart={metrics['within_50c_of_fart_pct']}% onTime={metrics['onsets_on_time_pct']}%"
              f" reatk={metrics['notes_with_retrigger']} med={metrics['median_abs_cents']}c contour={metrics['contour_pct']}%"
              f" notes={metrics['notes']}")


# ---------------------------------------------------------------- main


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--titles", type=Path, required=True, help="the titles file (pdmx.read_titles)")
    parser.add_argument("--cache", type=Path, default=Path.home() / ".cache/pedos/pdmx")
    parser.add_argument("--tries", type=int, default=5, help="scores to try per title, best first")
    parser.add_argument("--listen", type=Path, help="also render a sample of the passing Songs to WAV here")
    parser.add_argument("--listen-count", type=int, default=3)
    args = parser.parse_args()

    titles_file = rel(args.titles)
    titles = pdmx.read_titles(args.titles.read_text())
    catalog = json.loads(CATALOG.read_text())
    others = [e for e in catalog if pdmx.batch_of(e) != titles_file]
    dataset = fetch_dataset(args.cache)
    archive = dataset["mid.tar.gz"]

    found = pdmx.find_candidates(read_rows(dataset["PDMX.csv"]["path"]), titles,
                                 used={e["source"].get("dataset_path") for e in others})
    midi_dir = args.cache / "extracted"
    member_sha256 = extract(archive["path"], sorted({row["mid"] for c in found for _, row in c.eligible[: args.tries]}),
                            midi_dir)
    library = load_library()

    def try_score(title, match, row):
        if row["mid"] not in member_sha256:
            return not_tried(row, "hash", f"{row['mid']} isn't in {archive['path'].name}")
        return gate(title, match, row, midi_dir / row["mid"], member_sha256[row["mid"]], archive, library)

    songs, picks = pick_scores(titles, found, others, args.tries, try_score, midi_dir)
    write_catalog(CATALOG, catalog, titles_file, picks, archive)
    for title, r, _ in picks:
        song = next(s for s in songs if s["id"] == title.id)
        song["tried"][-1] = {k: v for k, v in r.items() if k != "row"}
        if r["passed"]:
            song.update(result="pass", picked=r["score_id"], reason=None)
        else:
            song["reason"] = first_problem(r)
    run = {
        "titles": titles_file,
        "command": f"tools/melody-lab/.venv/bin/python -I {TOOL} --titles {titles_file} --tries {args.tries}",
        "dataset": {name: {k: v for k, v in d.items() if k != "path"} for name, d in dataset.items()},
        "library": f"{len(library)} Recordings, {sum(s.pitched for s in library)} Melodic",
        "picking": (f"title matches one of the Song's names (MATCHES order: {', '.join(pdmx.MATCHES)}); "
                    f"license {' or '.join(pdmx.LICENSES)} with no PDMX license conflict; at most {pdmx.MAX_TRACKS} tracks; "
                    f"then the highest rating, the most views; up to {args.tries} scores tried per title, best first"),
        "gates": (f"license; hash; sanity: {pdmx.MIN_NOTES}-{pdmx.MAX_NOTES} notes, range <= {pdmx.MAX_RANGE} semitones, "
                  f"at most {pdmx.MAX_DROPPED_SHARE:.0%} of the track's notes dropped; render with excerpt "
                  f"<= {pdmx.EXCERPT_BEATS} beats of whole bars and the score's tempo within {pdmx.MIN_BPM}-{pdmx.MAX_BPM} bpm"),
        "bar": BAR,
    }
    report = args.titles.with_name(args.titles.stem + ".report")
    write_report(report, run, songs)
    passed = sum(s["result"] == "pass" for s in songs)
    print(f"{passed} of {len(songs)} titles pass; report: {rel(report)}.md")

    if args.listen:
        good = [(t, r, src) for t, r, src in picks if r["passed"]]
        listen(pdmx.spread(good, args.listen_count), library, args.listen)


if __name__ == "__main__":
    main()
