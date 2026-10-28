import argparse
import json
from pathlib import Path

import librosa
import soundfile as sf

import pdmx
from analysis import ROOT, SR, load_library
from catalog_writer import TOOL, write_catalog
from dataset import extract, fetch_dataset, read_rows
from engine import plan, render
from evaluate import BAR, evaluate
from gates import first_problem, gate, not_tried, pick_scores
from melody import load_midi
from report import write_report

CATALOG = ROOT / "catalog/catalog.json"
DESCRIPTION = "Batch-import Songs from PDMX into the Song Catalog, keeping only the ones that pass the gates."


def rel(path):
    return Path(path).resolve().relative_to(ROOT).as_posix()


def listen(sample, library, out):
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
             "measured_on": wav.name, "metrics": metrics, "gate_metrics": r["metrics"]}, indent=1) + "\n",
            encoding="utf-8", newline="\n")
        print(f"listen {wav}: in50cFart={metrics['within_50c_of_fart_pct']}% onTime={metrics['onsets_on_time_pct']}%"
              f" reatk={metrics['notes_with_retrigger']} med={metrics['median_abs_cents']}c contour={metrics['contour_pct']}%"
              f" notes={metrics['notes']}")


def record_picks(songs, picks):
    for title, r, _ in picks:
        song = next(s for s in songs if s["id"] == title.id)
        song["tried"][-1] = {k: v for k, v in r.items() if k != "row"}
        if r["passed"]:
            song.update(result="pass", picked=r["score_id"], reason=None)
        else:
            song["reason"] = first_problem(r)


def run_summary(titles_file, tries, dataset, library):
    return {
        "titles": titles_file,
        "command": f"uv run --project tools python -I {TOOL} --titles {titles_file} --tries {tries}",
        "dataset": {name: {k: v for k, v in d.items() if k != "path"} for name, d in dataset.items()},
        "library": f"{len(library)} Recordings, {sum(s.pitched for s in library)} Melodic",
        "picking": (f"title matches one of the Song's names (MATCHES order: {', '.join(pdmx.MATCHES)}); "
                    f"license {' or '.join(pdmx.LICENSES)} with no PDMX license conflict; at most {pdmx.MAX_TRACKS} tracks; "
                    f"then the highest rating, the most views; up to {tries} scores tried per title, best first"),
        "gates": (f"license; hash; sanity: {pdmx.MIN_NOTES}-{pdmx.MAX_NOTES} notes, range <= {pdmx.MAX_RANGE} semitones, "
                  f"at most {pdmx.MAX_DROPPED_SHARE:.0%} of the track's notes dropped, no first bar that is a pickup "
                  f"padded with silence ({pdmx.PADDED_PICKUP_REST} beat or more, and at least as long as the bar's notes); render with excerpt "
                  f"<= {pdmx.EXCERPT_BEATS} beats of whole bars and the score's tempo within {pdmx.MIN_BPM}-{pdmx.MAX_BPM} bpm"),
        "bar": BAR,
    }


def parse_args():
    parser = argparse.ArgumentParser(description=DESCRIPTION)
    parser.add_argument("--titles", type=Path, required=True, help="the titles file (pdmx.read_titles)")
    parser.add_argument("--cache", type=Path, default=Path.home() / ".cache/pedos/pdmx")
    parser.add_argument("--tries", type=int, default=5, help="scores to try per title, best first")
    parser.add_argument("--listen", type=Path, help="also render a sample of the passing Songs to WAV here")
    parser.add_argument("--listen-count", type=int, default=3)
    return parser.parse_args()


def main():
    args = parse_args()
    titles_file = rel(args.titles)
    titles = pdmx.read_titles(args.titles.read_text(encoding="utf-8"))
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
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
    record_picks(songs, picks)
    report = args.titles.with_name(args.titles.stem + ".report")
    write_report(report, run_summary(titles_file, args.tries, dataset, library), songs)
    passed = sum(s["result"] == "pass" for s in songs)
    print(f"{passed} of {len(songs)} titles pass; report: {rel(report)}.md")

    if args.listen:
        good = [(t, r, src) for t, r, src in picks if r["passed"]]
        listen(pdmx.spread(good, args.listen_count), library, args.listen)


if __name__ == "__main__":
    main()
