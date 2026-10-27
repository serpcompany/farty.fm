"""Run the reference's checks (evaluate.py) on renders made outside the reference engine.

    .venv/bin/python evaluate_renders.py [dir] [--against-reference]    # default dir: out/web

`dir` holds `<song>.wav` and `<song>.json` per Song, as `apps/web/scripts/render-songs.ts`
writes them. The JSON has the Song's `bpm` and one event per note (`note_index`, `len_s`,
`target_midi`, `source_id`). Each render goes through `evaluate()` exactly as run_all.py calls
it, with the reference's Recordings (`load_library()`) to read each fart's own pitch, prints
run_all.py's line, then the golden metrics for the same Song on the full library, and checks
it:

- the bar (evaluate.BAR, ADR 0012): at least 94% of notes within +-50 cents of their fart's
  own pitch, at least 95% of onsets within +-50 ms, and no second attack inside a note;
- no worse than golden on within_50c_of_fart_pct, onsets_on_time_pct and
  notes_with_retrigger.

First it checks that `dir` holds exactly one render (`.json` and `.wav`) per golden Arrangement
that is unlocked (`fixtures/golden/arrangements/full/*.json`), and fails on a missing, extra or
stale one. Exits 1 if any check fails. It changes nothing in the reference.

The renders are the full library's only. Last it lists, for information, the small library's
unlocked golden Arrangements that pYIN reads under the bar (`fixtures/golden/README.md` says
why).

With --against-reference it also renders each Song with the reference (`plan`, then
`render()` on `load_library()`) and prints the largest sample difference from it, for
information.
"""
import argparse
import json
import sys
from pathlib import Path

import librosa
import numpy as np

from engine import ROOT, SR, load_library, plan, render
from evaluate import BAR, bar_problems, evaluate
from melody import load_catalog

GOLDEN = ROOT / "fixtures/golden/arrangements/full"
SMALL = ROOT / "fixtures/golden/arrangements/small"


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


def small_library_under_bar():
    """The small library's unlocked golden Arrangements under the bar's fidelity (ADR 0012)."""
    under = []
    for path in sorted(SMALL.glob("*.json")):
        golden = json.loads(path.read_text())
        within = golden["metrics"]["within_50c_of_fart_pct"] if golden["unlocked"] else None
        if within is not None and within < BAR["within_50c_of_fart_pct"]:
            under.append(f"{path.stem} {within}%")
    return under


def against_reference(library, melody, audio):
    """How far a render is from the reference's own render of the same Song, sample by sample."""
    _, assignments = plan(melody, library)
    reference, _ = render(melody, library, assignments, bpm=melody.bpm)
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
    library = load_library()
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
        r = evaluate(audio, melody, events["notes"], events["bpm"], library)
        print(
            f"{song:12s} T={events['transpose']:+d} notes={r['notes']:3d} in50cFart={r['within_50c_of_fart_pct']:3d}%"
            f" onTime={r['onsets_on_time_pct']}% reatk={r['notes_with_retrigger']}"
            f" | in50c={r['within_50c_pct']:3d}% med={r['median_abs_cents']:5.1f}c contour={r['contour_pct']}%"
            f" recs={r['distinct_recordings']} octaveMoves={events['octave_moves']}"
            f" sounding={r['sounding_pct']}% mostlySilent={r['notes_mostly_silent']}"
        )
        golden = json.loads((GOLDEN / f"{song}.json").read_text())
        g = golden["metrics"]
        print(
            f"{'  golden':12s} T={golden['transpose']:+d} notes={g['notes']:3d} in50cFart={g['within_50c_of_fart_pct']:3d}%"
            f" onTime={g['onsets_on_time_pct']}% reatk={g['notes_with_retrigger']}"
            f" | in50c={g['within_50c_pct']:3d}% med={g['median_abs_cents']:5.1f}c contour={g['contour_pct']}%"
            f" recs={g['distinct_recordings']} octaveMoves={golden['octave_moves']}"
            f" sounding={g['sounding_pct']}% mostlySilent={g['notes_mostly_silent']}"
        )
        # Note by note against the golden heard_cents and fart_cents (rounded to the cent): information only.
        for key, name in (("heard_cents", "cents"), ("fart_cents", "fart_cents")):
            heard = {n["index"]: n[key] for n in golden["notes"]}
            mine = {p["i"]: p[name] for p in r["per_note"]}
            differ = [i for i in heard if mine.get(i) != heard[i]]
            deltas = [abs(mine[i] - heard[i]) for i in differ if mine.get(i) is not None and heard[i] is not None]
            print(f"{'':12s} {key.replace('_', ' ')}: {len(heard) - len(differ)} of {len(heard)} notes equal golden"
                  + (f", max |diff| {max(deltas)}c" if deltas else ""))
        if args.against_reference:
            print(f"{'':12s} against the reference render: {against_reference(library, melody, audio)}")
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
        print(f"{'':12s} {'FAIL: ' + '; '.join(problems) if problems else 'PASS'}")
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
