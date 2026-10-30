"""Run the reference's checks (evaluate.py) on renders made outside the reference engine.

    .venv/bin/python evaluate_renders.py [dir] [--against-reference]    # default dir: out/web
    .venv/bin/python evaluate_renders.py --scenario scenarios/trim-065.json [--against-reference]

`dir` holds `<song>.wav` and `<song>.json` per Song, as `apps/web/scripts/render-songs.ts`
writes them. The JSON has the Song's `bpm` and one event per note (`note_index`, `len_s`,
`target_midi`, `source_id`). Each render goes through `evaluate()` exactly as run_all.py calls
it, with the reference's Recordings (`load_library()`) to read each fart's own pitch, prints
run_all.py's line, then the golden metrics for the same Song on the full library, and checks
it:

- the bar (evaluate.BAR, ADR 0012): at least 94% of notes within +-50 cents of their fart's
  own pitch, at least 95% of onsets within +-50 ms, and no second attack inside a note
  that the note's own fart doesn't have (ADR 0016);
- no worse than golden on within_50c_of_fart_pct, onsets_on_time_pct and
  notes_with_retrigger.

First it checks that `dir` holds exactly one render (`.json` and `.wav`) per golden Arrangement
that is unlocked (`fixtures/golden/arrangements/full/*.json`), and fails on a missing, extra or
stale one. Exits 1 if any check fails. It changes nothing in the reference.

Without --scenario the renders are the full library's. Last it lists, for information, the small library's
unlocked golden Arrangements that pYIN reads under the bar (`fixtures/golden/README.md` says
why).

With --against-reference it also renders each Song with the reference (`plan`, then
`render()` on `load_library()`) and prints the largest sample difference from it, for
information.

With --scenario scenarios/<id>.json the renders are of that Scenario's library instead (as
`render-songs.ts --scenario` makes them, into `out/web-<id>/` by default): the Fixture Library
Recordings it lists, each trimmed (`trim_bounds()`, then `trimmed()`, ADR 0019) and placed by
ear (`placed()`, ADR 0015) as it says. The expected renders are the Songs the reference unlocks
with that library, each is checked against the bar only (golden is the full library's), and
--against-reference renders with that library.
"""
import argparse
import json
import sys
from pathlib import Path

import librosa
import numpy as np

from engine import (
    AUDIO_DIR, MANIFEST, ROOT, SR, analyze_recording, load_library, melody_fit, placed, plan, render, trim_bounds,
    trimmed,
)
from evaluate import BAR, bar_problems, evaluate
from melody import load_catalog

GOLDEN = ROOT / "fixtures/golden/arrangements/full"
SMALL = ROOT / "fixtures/golden/arrangements/small"
HERE = Path(__file__).resolve().parent


def golden_unlocked():
    """The Songs whose golden Arrangement on the full library unlocks, and those it locks."""
    unlocked = {p.stem for p in GOLDEN.glob("*.json") if json.loads(p.read_text())["unlocked"]}
    return unlocked, {p.stem for p in GOLDEN.glob("*.json")} - unlocked


def load_scenario(path):
    """A Scenario's library: the Fixture Library Recordings it lists, analyzed, each trimmed
    between its handles (ADR 0019) and placed on its note (ADR 0015) where it says. Prints each
    Trim, in samples of the decoded take."""
    scenario = json.loads(Path(path).read_text())
    manifest = {r["id"]: r for r in json.loads(MANIFEST.read_text())["recordings"]}
    library = []
    for rid in scenario["library"]:
        y, _ = librosa.load(AUDIO_DIR / manifest[rid]["filename"], sr=SR, mono=True)
        src = analyze_recording(rid, y)
        if rid in scenario.get("trims", {}):
            handles = scenario["trims"][rid]
            start, end = trim_bounds(y, *handles)
            print(f"{rid} trimmed between {handles[0]} and {handles[1]} s: samples {round(start * SR)}"
                  f" to {round(end * SR)} ({start:.4f} to {end:.4f} s); analysis found {src.start} to {src.end}")
            src = trimmed(src, y, start, end, placed_by_ear=rid in scenario.get("placed", {}), handles=handles)
        if rid in scenario.get("placed", {}):
            src = placed(src, scenario["placed"][rid])
        library.append(src)
    return scenario, library


def scenario_unlocked(catalog, library):
    """The golden Songs the reference unlocks with `library`, and those it leaves locked."""
    songs = {p.stem for p in (ROOT / "fixtures/golden/songs").glob("*.json")}
    unlocked = {sid for sid in songs if melody_fit(catalog[sid], library).unlocked}
    return unlocked, songs - unlocked


def render_set_problems(out, unlocked, locked):
    """What is wrong with the set of renders in `out`, against the unlocked Songs."""
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
    parser.add_argument("dir", nargs="?", type=Path)
    parser.add_argument("--against-reference", action="store_true",
                        help="also render each Song with the reference and print the largest sample difference")
    parser.add_argument("--scenario", type=Path,
                        help="the renders are of this Scenario's library (scenarios/<id>.json), not the full one")
    args = parser.parse_args()
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
        if scenario:
            if args.against_reference:
                print(f"{'':12s} against the reference render: {against_reference(library, melody, audio)}")
            plays = [n["source_id"] for n in events["notes"]]
            print(f"{'':12s} plays " + ", ".join(f"{rid} on {plays.count(rid)}" for rid in sorted(set(plays))))
            problems = bar_problems(r)
            print(f"{'':12s} {'FAIL: ' + '; '.join(problems) if problems else 'PASS'}")
            if problems:
                failures.append(song)
            continue
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
    under = [] if scenario else small_library_under_bar()
    if under:
        print(f"note: on the small library, golden reads unlocked Songs under {BAR['within_50c_of_fart_pct']}%"
              f" within +-50 cents of their farts: {', '.join(under)} (fixtures/golden/README.md)")
    sys.exit(1 if failures or set_problems else 0)


if __name__ == "__main__":
    main()
