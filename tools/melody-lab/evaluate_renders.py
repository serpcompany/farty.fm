import argparse
import json
import sys
from pathlib import Path

import librosa
import numpy as np

from analysis import AUDIO_DIR, ROOT, SR, analyze_recording, load_library, read_manifest
from engine import melody_fit, placed, plan, render
from evaluate import BAR, bar_problems, evaluate, metrics_line
from melody import load_catalog
from trim import trim_bounds, trimmed

GOLDEN = ROOT / "fixtures/golden/arrangements/full"
SMALL = ROOT / "fixtures/golden/arrangements/small"
GOLDEN_SONGS = ROOT / "fixtures/golden/songs"
HERE = Path(__file__).resolve().parent
DESCRIPTION = "Run the reference's checks (evaluate.py) on renders made outside the reference engine."


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def golden_unlocked():
    unlocked = {p.stem for p in GOLDEN.glob("*.json") if read_json(p)["unlocked"]}
    return unlocked, {p.stem for p in GOLDEN.glob("*.json")} - unlocked


def scenario_recording(rid, filename, scenario):
    y, _ = librosa.load(AUDIO_DIR / filename, sr=SR, mono=True)
    src = analyze_recording(rid, y)
    if rid in scenario.get("trims", {}):
        handles = scenario["trims"][rid]
        start, end = trim_bounds(y, *handles)
        print(f"{rid} trimmed between {handles[0]} and {handles[1]} s: samples {round(start * SR)}"
              f" to {round(end * SR)} ({start:.4f} to {end:.4f} s); analysis found {src.start} to {src.end}")
        src = trimmed(src, y, start, end, handles=handles)
    if rid in scenario.get("placed", {}):
        src = placed(src, scenario["placed"][rid])
    return src


def load_scenario(path):
    scenario = read_json(Path(path))
    filenames = {r["id"]: r["filename"] for r in read_manifest()}
    return scenario, [scenario_recording(rid, filenames[rid], scenario) for rid in scenario["library"]]


def scenario_unlocked(catalog, library):
    songs = {p.stem for p in GOLDEN_SONGS.glob("*.json")}
    unlocked = {sid for sid in songs if melody_fit(catalog[sid], library).unlocked}
    return unlocked, songs - unlocked


def render_set_problems(out, unlocked, locked):
    jsons = {p.stem for p in out.glob("*.json")}
    wavs = {p.stem for p in out.glob("*.wav")}
    problems = []
    for stem in sorted(unlocked - jsons):
        problems.append(f"{stem}: no render, but it unlocks")
    for stem in sorted((jsons | wavs) - unlocked):
        why = "it is locked" if stem in locked else "not a golden Arrangement"
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


def scenario_problems(events, r, library, melody, audio, against):
    if against:
        print(f"{'':12s} against the reference render: {against_reference(library, melody, audio)}")
    plays = [n["source_id"] for n in events["notes"]]
    print(f"{'':12s} plays " + ", ".join(f"{rid} on {plays.count(rid)}" for rid in sorted(set(plays))))
    return bar_problems(r)


def check_render(path, catalog, library, against, scenario):
    events = read_json(path)
    song = events["song"]
    melody = catalog[song]
    audio, _ = librosa.load(path.with_suffix(".wav"), sr=SR, mono=True)
    r = evaluate(audio, melody, events["notes"], events["bpm"], library)
    print(metrics_line(song, events["transpose"], r, events["octave_moves"]))
    if scenario:
        problems = scenario_problems(events, r, library, melody, audio, against)
        print(f"{'':12s} {'FAIL: ' + '; '.join(problems) if problems else 'PASS'}")
        return song, problems
    golden = read_json(GOLDEN / f"{song}.json")
    print(metrics_line("  golden", golden["transpose"], golden["metrics"], golden["octave_moves"]))
    print_note_agreement(golden, r)
    if against:
        print(f"{'':12s} against the reference render: {against_reference(library, melody, audio)}")
    problems = golden_problems(r, golden["metrics"])
    print(f"{'':12s} {'FAIL: ' + '; '.join(problems) if problems else 'PASS'}")
    return song, problems


def parse_args():
    parser = argparse.ArgumentParser(description=DESCRIPTION)
    parser.add_argument("dir", nargs="?", type=Path)
    parser.add_argument("--against-reference", action="store_true",
                        help="also render each Song with the reference and print the largest sample difference")
    parser.add_argument("--scenario", type=Path,
                        help="the renders are of this Scenario's library (scenarios/<id>.json), not the full one")
    return parser.parse_args()


def main():
    args = parse_args()
    catalog = {c["id"]: m for c, m in load_catalog()}
    if args.scenario:
        scenario, library = load_scenario(args.scenario)
        out = args.dir or HERE / f"out/web-{scenario['id']}"
        unlocked, locked = scenario_unlocked(catalog, library)
    else:
        scenario, library = None, load_library()
        out = args.dir or HERE / "out/web"
        unlocked, locked = golden_unlocked()
    renders, set_problems = render_set_problems(out, unlocked, locked)
    for problem in set_problems:
        print(f"FAIL: {problem}")
    if set_problems:
        expected = f"the Songs {scenario['id']} unlocks" if scenario else "the golden unlocked Arrangements"
        print(f"the renders in {out} are not exactly {expected}; rerun apps/web's scripts/render-songs.ts")
    failures = []
    for stem in renders:
        song, problems = check_render(out / f"{stem}.json", catalog, library, args.against_reference, scenario)
        if problems:
            failures.append(song)
    print(f"{len(renders) - len(failures)} of {len(renders)} renders pass" + (f"; failing: {' '.join(failures)}" if failures else ""))
    if set_problems:
        print(f"FAIL: {len(set_problems)} problem(s) with the set of renders (above)")
    under = [] if scenario else small_library_under_bar()
    if under:
        print(f"note: on the small library, golden reads unlocked Songs under {BAR['within_50c_of_fart_pct']}%"
              f" within +-50 cents of their farts: {', '.join(under)} (fixtures/golden/port-tests.md)")
    sys.exit(1 if failures or set_problems else 0)


if __name__ == "__main__":
    main()
