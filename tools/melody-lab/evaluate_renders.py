"""Run the reference's checks (evaluate.py) on renders made outside the reference engine.

    .venv/bin/python evaluate_renders.py [dir] [--against-reference]    # default dir: out/web

`dir` holds `<song>.wav` and `<song>.json` per Song, as `apps/web/scripts/render-songs.ts`
writes them. The JSON has the Song's `bpm` and one event per note (`note_index`, `len_s`,
`target_midi`, `source_id`). Each render goes through `evaluate()` exactly as run_all.py calls
it, prints run_all.py's line, then the golden metrics for the same Song on the full library,
and checks it:

- ADR 0004's bar: at least 94% of notes within +-50 cents, at least 95% of onsets within
  +-50 ms, and no second attack inside a note;
- no worse than golden on within_50c_pct, onsets_on_time_pct and notes_with_retrigger.

`furelise` note 15 is a tolerance edge (fixtures/golden/README.md, "Near-threshold
Recordings"), so it counts as within at +-60 cents.

First it checks that `dir` holds exactly one render (`.json` and `.wav`) per golden Arrangement
that is unlocked (`fixtures/golden/arrangements/full/*.json`), and fails on a missing, extra or
stale one. Exits 1 if any check fails. It changes nothing in the reference.

With --against-reference it also renders each Song with the reference (`plan`, then
`render(tune=1.0)` on `load_library()`) and prints the largest sample difference from it, for
information.
"""
import argparse
import json
import sys
from pathlib import Path

import librosa
import numpy as np

from engine import ROOT, SR, load_library, plan, render
from evaluate import evaluate
from melody import load_catalog

GOLDEN = ROOT / "fixtures/golden/arrangements/full"
TOLERANCE_EDGE = {"furelise": 15}
EDGE_CENTS = 60
BAR = {"within_50c_pct": 94, "onsets_on_time_pct": 95, "notes_with_retrigger": 0}


def strict_count(pct, n):
    """How many of n notes evaluate() counted, from its rounded percentage (unique while n <= 100)."""
    counts = [k for k in range(n + 1) if round(100 * k / n) == pct]
    assert len(counts) == 1, (pct, n, counts)
    return counts[0]


def within_with_edge(song, r):
    """within_50c_pct, with the Song's tolerance-edge note counted as within at +-EDGE_CENTS."""
    if song not in TOLERANCE_EDGE:
        return r["within_50c_pct"], None
    n = r["notes"]
    k = strict_count(r["within_50c_pct"], n)
    cents = {p["i"]: p["cents"] for p in r["per_note"]}
    edge = cents[TOLERANCE_EDGE[song]]
    if edge is None or abs(edge) > EDGE_CENTS:
        return round(100 * k / n), edge
    # per_note cents are rounded. Below 50 the note was already counted, above 50 it wasn't; at
    # exactly 50 it was counted if k has room for it beside the notes that surely were.
    sure = sum(1 for c in cents.values() if c is not None and abs(c) < 50)
    at_50 = sum(1 for c in cents.values() if c is not None and abs(c) == 50)
    if abs(edge) < 50 or (abs(edge) == 50 and (at_50 > 1 or k - sure == 1)):
        counted = 0
    else:
        counted = 1
    return round(100 * (k + counted) / n), edge


def render_set_problems(out):
    """What is wrong with the set of renders in `out`, against the golden unlocked Arrangements."""
    unlocked = {p.stem for p in GOLDEN.glob("*.json") if json.loads(p.read_text())["unlocked"]}
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
        song = json.loads((out / f"{stem}.json").read_text()).get("song")
        if song != stem:
            problems.append(f"{stem}.json says it is {song!r}")
    return sorted(unlocked & jsons & wavs), problems


def against_reference(library, melody, audio):
    """How far a render is from the reference's own render of the same Song, sample by sample."""
    _, assignments = plan(melody, library)
    reference, _ = render(melody, library, assignments, tune=1.0, bpm=melody.bpm)
    n = min(len(reference), len(audio))
    diff = np.abs(reference[:n].astype(np.float64) - audio[:n].astype(np.float64))
    worst = float(diff.max()) if n else 0.0
    return (f"samples {len(audio)} (reference {len(reference)}), max |diff| {worst:.2e}"
            f" ({20 * np.log10(worst + 1e-30):.1f} dBFS)")


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("dir", nargs="?", type=Path, default=Path(__file__).resolve().parent / "out/web")
    parser.add_argument("--against-reference", action="store_true",
                        help="also render each Song with the reference and print the largest sample difference")
    args = parser.parse_args()
    out = args.dir
    catalog = {c["id"]: m for c, m in load_catalog()}
    library = load_library() if args.against_reference else None
    renders, set_problems = render_set_problems(out)
    for problem in set_problems:
        print(f"FAIL: {problem}")
    if set_problems:
        print(f"the renders in {out} are not exactly the golden unlocked Arrangements;"
              " rerun apps/web's scripts/render-songs.ts")
    failures = []
    for stem in renders:
        path = out / f"{stem}.json"
        events = json.loads(path.read_text())
        song = events["song"]
        melody = catalog[song]
        audio, _ = librosa.load(path.with_suffix(".wav"), sr=SR, mono=True)
        r = evaluate(audio, melody, events["notes"], events["bpm"])
        shifts = [abs(e["shift_semitones"]) for e in events["notes"]]
        print(
            f"{song:12s} T={events['transpose']:+d} notes={r['notes']:3d} in50c={r['within_50c_pct']:3d}%"
            f" med={r['median_abs_cents']:5.1f}c onTime={r['onsets_on_time_pct']}%"
            f" reatk={r['notes_with_retrigger']} recs={r['distinct_recordings']}"
            f" octaveMoves={events['octave_moves']} maxShift={max(shifts):.1f}"
        )
        golden = json.loads((GOLDEN / f"{song}.json").read_text())
        g = golden["metrics"]
        print(
            f"{'  golden':12s} T={golden['transpose']:+d} notes={g['notes']:3d} in50c={g['within_50c_pct']:3d}%"
            f" med={g['median_abs_cents']:5.1f}c onTime={g['onsets_on_time_pct']}%"
            f" reatk={g['notes_with_retrigger']} recs={g['distinct_recordings']}"
            f" octaveMoves={golden['octave_moves']}"
        )
        # Note by note against the golden heard_cents (both rounded to the cent): information only.
        heard = {n["index"]: n["heard_cents"] for n in golden["notes"]}
        mine = {p["i"]: p["cents"] for p in r["per_note"]}
        differ = [i for i in heard if mine.get(i) != heard[i]]
        deltas = [abs(mine[i] - heard[i]) for i in differ if mine.get(i) is not None and heard[i] is not None]
        print(f"{'':12s} heard cents: {len(heard) - len(differ)} of {len(heard)} notes equal golden"
              + (f", max |diff| {max(deltas)}c" if deltas else ""))
        if library is not None:
            print(f"{'':12s} against the reference render: {against_reference(library, melody, audio)}")
        within, edge = within_with_edge(song, r)
        if song in TOLERANCE_EDGE:
            print(f"{'':12s} note {TOLERANCE_EDGE[song]} reads {edge} cents (tolerance edge,"
                  f" within at +-{EDGE_CENTS}): in50c={within}%")
        problems = []
        if r["notes"] != g["notes"]:
            problems.append(f"{r['notes']} notes, golden {g['notes']}")
        if within < BAR["within_50c_pct"]:
            problems.append(f"in50c {within}% < {BAR['within_50c_pct']}%")
        if r["onsets_on_time_pct"] < BAR["onsets_on_time_pct"]:
            problems.append(f"onTime {r['onsets_on_time_pct']}% < {BAR['onsets_on_time_pct']}%")
        if r["notes_with_retrigger"] > BAR["notes_with_retrigger"]:
            problems.append(f"{r['notes_with_retrigger']} notes re-attack")
        if within < g["within_50c_pct"]:
            problems.append(f"in50c {within}% worse than golden {g['within_50c_pct']}%")
        if r["onsets_on_time_pct"] < g["onsets_on_time_pct"]:
            problems.append(f"onTime {r['onsets_on_time_pct']}% worse than golden {g['onsets_on_time_pct']}%")
        if r["notes_with_retrigger"] > g["notes_with_retrigger"]:
            problems.append(f"re-attacks {r['notes_with_retrigger']} worse than golden {g['notes_with_retrigger']}")
        print(f"{'':12s} {'FAIL: ' + '; '.join(problems) if problems else 'PASS'}")
        if problems:
            failures.append(song)
    print(f"{len(renders) - len(failures)} of {len(renders)} renders pass" + (f"; failing: {' '.join(failures)}" if failures else ""))
    if set_problems:
        print(f"FAIL: {len(set_problems)} problem(s) with the set of renders (above)")
    sys.exit(1 if failures or set_problems else 0)


if __name__ == "__main__":
    main()
