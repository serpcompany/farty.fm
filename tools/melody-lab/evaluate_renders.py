import argparse
import json
import sys
from pathlib import Path

import librosa
import numpy as np

from analysis import ROOT, SR, load_library
from engine import plan, render
from evaluate import BAR, bar_problems, evaluate, metrics_line
from melody import load_catalog

GOLDEN = ROOT / "fixtures/golden/arrangements/full"
SMALL = ROOT / "fixtures/golden/arrangements/small"
DESCRIPTION = "Run the reference's checks (evaluate.py) on renders made outside the reference engine."


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def render_set_problems(out):
    unlocked = {p.stem for p in GOLDEN.glob("*.json") if read_json(p)["unlocked"]}
    locked = {p.stem for p in GOLDEN.glob("*.json")} - unlocked
    jsons = {p.stem for p in out.glob("*.json")}
    wavs = {p.stem for p in out.glob("*.wav")}
    problems = []
    for stem in sorted(unlocked - jsons):
        problems.append(f"{stem}: no render, but golden unlocks it")
    for stem in sorted((jsons | wavs) - unlocked):
        why = "golden locks it" if stem in locked else "not a golden Arrangement"
        problems.append(f"{stem}: rendered, but {why}")
    for stem in sorted((jsons ^ wavs) & unlocked):
        problems.append(f"{stem}: {'.wav' if stem in jsons else '.json'} missing")
    for stem in sorted(jsons & wavs & unlocked):
        song = read_json(out / f"{stem}.json").get("song")
        if song != stem:
            problems.append(f"{stem}.json says it is {song!r}")
    return sorted(unlocked & jsons & wavs), problems


def small_library_under_bar():
    under = []
    for path in sorted(SMALL.glob("*.json")):
        golden = read_json(path)
        within = golden["metrics"]["within_50c_of_fart_pct"] if golden["unlocked"] else None
        if within is not None and within < BAR["within_50c_of_fart_pct"]:
            under.append(f"{path.stem} {within}%")
    return under


def against_reference(library, melody, audio):
    _, assignments = plan(melody, library)
    reference, _ = render(melody, library, assignments, bpm=melody.bpm)
    n = min(len(reference), len(audio))
    diff = np.abs(reference[:n].astype(np.float64) - audio[:n].astype(np.float64))
    worst = float(diff.max()) if n else 0.0
    return (f"samples {len(audio)} (reference {len(reference)}), max |diff| {worst:.2e}"
            f" ({20 * np.log10(worst + 1e-30):.1f} dBFS)")


def print_note_agreement(golden, r):
    for key, name in (("heard_cents", "cents"), ("fart_cents", "fart_cents")):
        heard = {n["index"]: n[key] for n in golden["notes"]}
        mine = {p["i"]: p[name] for p in r["per_note"]}
        differ = [i for i in heard if mine.get(i) != heard[i]]
        deltas = [abs(mine[i] - heard[i]) for i in differ if mine.get(i) is not None and heard[i] is not None]
        print(f"{'':12s} {key.replace('_', ' ')}: {len(heard) - len(differ)} of {len(heard)} notes equal golden"
              + (f", max |diff| {max(deltas)}c" if deltas else ""))


def golden_problems(r, g):
    within = r["within_50c_of_fart_pct"]
    problems = []
    if r["notes"] != g["notes"]:
        problems.append(f"{r['notes']} notes, golden {g['notes']}")
    problems += bar_problems(r)
    if within < g["within_50c_of_fart_pct"]:
        problems.append(f"in50cFart {within}% worse than golden {g['within_50c_of_fart_pct']}%")
    if r["onsets_on_time_pct"] < g["onsets_on_time_pct"]:
        problems.append(f"onTime {r['onsets_on_time_pct']}% worse than golden {g['onsets_on_time_pct']}%")
    if r["notes_with_retrigger"] > g["notes_with_retrigger"]:
        problems.append(f"re-attacks {r['notes_with_retrigger']} worse than golden {g['notes_with_retrigger']}")
    return problems


def check_render(path, catalog, library, against):
    events = read_json(path)
    song = events["song"]
    melody = catalog[song]
    audio, _ = librosa.load(path.with_suffix(".wav"), sr=SR, mono=True)
    r = evaluate(audio, melody, events["notes"], events["bpm"], library)
    print(metrics_line(song, events["transpose"], r, events["octave_moves"]))
    golden = read_json(GOLDEN / f"{song}.json")
    print(metrics_line("  golden", golden["transpose"], golden["metrics"], golden["octave_moves"]))
    print_note_agreement(golden, r)
    if against:
        print(f"{'':12s} against the reference render: {against_reference(library, melody, audio)}")
    problems = golden_problems(r, golden["metrics"])
    print(f"{'':12s} {'FAIL: ' + '; '.join(problems) if problems else 'PASS'}")
    return song, problems


def main():
    parser = argparse.ArgumentParser(description=DESCRIPTION)
    parser.add_argument("dir", nargs="?", type=Path, default=Path(__file__).resolve().parent / "out/web")
    parser.add_argument("--against-reference", action="store_true",
                        help="also render each Song with the reference and print the largest sample difference")
    args = parser.parse_args()
    out = args.dir
    catalog = {c["id"]: m for c, m in load_catalog()}
    library = load_library()
    renders, set_problems = render_set_problems(out)
    for problem in set_problems:
        print(f"FAIL: {problem}")
    if set_problems:
        print(f"the renders in {out} are not exactly the golden unlocked Arrangements;"
              " rerun apps/web's scripts/render-songs.ts")
    failures = []
    for stem in renders:
        song, problems = check_render(out / f"{stem}.json", catalog, library, args.against_reference)
        if problems:
            failures.append(song)
    print(f"{len(renders) - len(failures)} of {len(renders)} renders pass" + (f"; failing: {' '.join(failures)}" if failures else ""))
    if set_problems:
        print(f"FAIL: {len(set_problems)} problem(s) with the set of renders (above)")
    under = small_library_under_bar()
    if under:
        print(f"note: on the small library, golden reads unlocked Songs under {BAR['within_50c_of_fart_pct']}%"
              f" within +-50 cents of their farts: {', '.join(under)} (fixtures/golden/README.md)")
    sys.exit(1 if failures or set_problems else 0)


if __name__ == "__main__":
    main()
