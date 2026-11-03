"""Export the reference engine's results as golden test data for the ports (web, Swift).

Writes deterministic JSON to fixtures/golden/ (format and tolerances: fixtures/golden/README.md):

  index.json                         libraries, Recordings, Songs, a summary, library versions
  recordings/<id>.json               Recording Analysis of every Fixture Library Recording
  songs/<id>.json                    the imported melody of every catalog Song, which the web app
                                     ships from (apps/web/src/lib/catalog/generate.ts)
  arrangements/<library>/<id>.json   Pitch Coverage, transposition, Arrangement and evaluate.py
                                     metrics per arranged Song (arranged_catalog()), for the full
                                     Fixture Library and the small 6-Recording one (no Arrangement
                                     to render when locked)
  coverage.json                      Pitch Coverage and Arrangement of every arranged Song on fixed
                                     random subsets of the Fixture Library
  choices.json                       the user's changes to an Arrangement (#360) replayed step by
                                     step on every arranged Song: swaps, farts left out, resets

Everything is computed by the lab's own functions (the same calls run_all.py makes); this
script only rounds and writes. Running it twice gives byte-identical files.

    .venv/bin/python export_golden.py
"""
import hashlib
import json
import platform
import random
import shutil
from importlib.metadata import version

import librosa
import numpy as np
import soundfile as sf

import engine
import golden_cost
from build import SMALL_LIBRARY
from evaluate import evaluate
from melody import load_catalog

GOLDEN = engine.ROOT / "fixtures/golden"
# The batches whose Songs get arrangements/ and coverage.json, with the hand-entered Songs: the 129
# Songs with golden data before #350 (the web app's 128 and ode-mutopia), which the web port's tests
# check against this engine.
ARRANGED_BATCHES = {f"tools/catalog/titles-0{n}.txt" for n in (1, 2, 3)}
GENERATED = ("index.json", "recordings", "songs", "arrangements", "coverage.json", "choices.json")  # README.md is written by hand
FORMAT_VERSION = 8  # 8: a fart's lead-in plays before its beat (#287); 7: Songs play every burst, the pitch reads the first (ADR 0016); 6: Songs' `bar_lines` (#232); 5: Songs play farts raw (ADR 0012); 4: the length rule (#221)
COVERAGE_SEEDS = 10  # random subsets per size in coverage.json


class Exact(float):
    """A float written at full precision: Python's repr round-trips to the same double."""


def exact(x):
    return None if x is None else Exact(x)


def num(x, digits):
    """Round a float for stable output. NaN and None become None, -0.0 becomes 0.0."""
    if x is None or not np.isfinite(x):
        return None
    return round(float(x), digits) + 0.0


def plain(x):
    """Turn numpy scalars into JSON types; round any float not marked Exact to 6 decimals."""
    if isinstance(x, dict):
        return {str(k): plain(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [plain(v) for v in x]
    if isinstance(x, Exact):
        return float(x)
    if isinstance(x, np.generic):
        x = x.item()
    if isinstance(x, float):
        return num(x, 6)
    return x


def write(rel, obj):
    path = GOLDEN / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(plain(obj), indent=2, sort_keys=True, ensure_ascii=False, allow_nan=False)
    path.write_text(text + "\n", encoding="utf-8")


def recording_json(entry, src):
    audio_path = engine.AUDIO_DIR / entry["filename"]
    info = sf.info(audio_path)
    voiced = np.isfinite(src.f0)
    contour = librosa.hz_to_midi(np.where(voiced, src.f0, 1.0))
    if src.pitched:
        reason = None
    elif src.pitch_estimate is None:
        reason = "no_steady_pitch"  # too few voiced frames, or confidence below MIN_PITCH_CONF
    else:
        reason = "failed_audition"  # had a pitch estimate, but audition() never read it back
    return {
        "id": src.id,
        "file": {
            "name": entry["filename"],
            "sha256": hashlib.sha256(audio_path.read_bytes()).hexdigest(),
            "sample_rate": info.samplerate,
            "channels": info.channels,
            "frames": info.frames,
        },
        "gesture": {
            "start_sample": src.start,
            "end_sample": src.end,
            "start_s": num(src.start / engine.SR, 6),
            "end_s": num(src.end / engine.SR, 6),
            "pitch_end_sample": src.pitch_end,
            "pitch_end_s": num(src.pitch_end / engine.SR, 6),
            "cut_at_reattack": bool(src.cut_at_reattack),
            "lead_start_sample": src.start - len(src.lead_in),
            "lead_start_s": num((src.start - len(src.lead_in)) / engine.SR, 6),
        },
        "pitch_contour": {
            "sample_rate": engine.SR,
            "hop": engine.HOP,
            "frames": len(src.f0),
            "midi": [num(m, 4) if v else None for m, v in zip(contour, voiced)],
        },
        "pitch_estimate_midi": exact(src.pitch_estimate),
        "pitch_confidence": src.pitch_confidence,
        "recording_pitch_midi": exact(src.ref_midi),
        "recording_pitch_note": librosa.midi_to_note(src.ref_midi, cents=True) if src.pitched else None,
        "shortest_note_s": src.min_note_s if src.pitched else None,
        "settle_s": exact(src.settle_s) if src.pitched else None,
        "melodic": src.pitched,
        "noise_like_reason": reason,
        "rms_db": num(src.rms_db, 4),
    }


def song_json(c, m):
    report = dict(m.report)
    report["source_file"] = engine.ROOT.joinpath(report["source_file"]).resolve().relative_to(engine.ROOT).as_posix()
    return {
        "id": c["id"],
        "title": c["title"],
        "file": c["file"],
        "sha256": c["sha256"],
        "import_args": c.get("render", {}),
        "bpm": m.bpm,
        "beats_per_bar": m.beats_per_bar,
        "bar_lines": [exact(x) for x in m.bar_lines],
        "length_beats": exact(m.length_beats),
        "pitches": sorted({int(n.pitch) for n in m.notes}),
        "notes": [{"start": exact(n.start), "dur": exact(n.dur), "pitch": int(n.pitch)} for n in m.notes],
        "import_report": report,
    }


def fit_json(fit):
    """The Melody Fit's ranking and Pitch Coverage, shared by arrangements/ and coverage.json."""
    return {
        "unlocked": fit.unlocked,
        "pitch_coverage": {"covered": fit.covered, "total": fit.total},
        "transpose": int(fit.transpose),
        "octave_moves": fit.octave_moves,
        "plan_cost": exact(fit.cost),
        "missing": [{"target_midi": int(m), "seconds": s} for m, s in fit.missing],
    }


def require_start_order(c, m):
    """Raise unless the Song's notes start in strictly increasing order. engine.render() returns
    its events in start order and the ports return theirs in the order given, so the golden rows
    are paired with the notes by position only while the two orders are the same."""
    for i in range(1, len(m.notes)):
        if not m.notes[i].start > m.notes[i - 1].start:
            raise ValueError(
                f"{c['id']}: note {i} starts at beat {m.notes[i].start}, not after note {i - 1} at beat "
                f"{m.notes[i - 1].start}; golden needs a Song's notes in strictly increasing start order"
            )


def arrangement_json(c, m, library, sources):
    require_start_order(c, m)
    fit = engine.melody_fit(m, sources)
    pitch_of = {s.id: s.ref_midi for s in sources}
    per_pitch = []
    for p, rid in sorted(fit.recording_for_pitch.items()):
        shift = None if rid is None else p + fit.transpose - pitch_of[rid]
        per_pitch.append(
            {
                "song_pitch": int(p),
                "target_midi": int(p + fit.transpose),
                "recording": rid,
                "shift_semitones": exact(shift),
                "octave_move": None if rid is None else engine.move_cost(shift)[1],
            }
        )
    out = {"song": c["id"], "library": library, **fit_json(fit), "per_pitch": per_pitch}
    if not fit.unlocked:  # a locked Song can't be played, so there is nothing to render
        return {**out, "render_settings": None, "max_abs_shift_semitones": None, "notes": None, "metrics": None}

    transpose, assignments, cost = engine.plan(m, sources, with_cost=True)
    assert (transpose, cost) == (fit.transpose, fit.cost)
    audio, events = engine.render(m, sources, assignments, bpm=m.bpm)
    metrics = evaluate(audio, m, events, m.bpm, sources)
    per_note = metrics.pop("per_note")
    notes = []
    for a, e, p in zip(assignments, events, per_note, strict=True):
        assert a.note_index == e["note_index"] == p["i"]
        notes.append(
            {
                "index": a.note_index,
                "song_pitch": int(m.notes[a.note_index].pitch),
                "target_midi": int(a.target_midi),
                "recording": a.source_id,
                "shift_semitones": num(a.shift_semitones, 4),
                "heard_cents": p["cents"],
                "fart_cents": p["fart_cents"],
                "render": {"start_s": e["start_s"], "len_s": e["len_s"], "gain_db": e["gain_db"], "lead_s": e["lead_s"]},
            }
        )
    return {
        **out,
        "render_settings": {"bpm": m.bpm},
        "max_abs_shift_semitones": max(abs(n["shift_semitones"]) for n in notes),
        "notes": notes,
        "metrics": metrics,
    }


def coverage_json(catalog, lib):
    """Pitch Coverage of every Song on fixed random subsets of the Fixture Library."""
    ids = [s.id for s in lib]
    melodic = [s.id for s in lib if s.pitched]
    subsets = []
    for pool_name, pool, sizes in (("all", ids, (3, 6, 9)), ("melodic", melodic, (4, 6))):
        for size in sizes:
            for seed in range(COVERAGE_SEEDS):
                subsets.append(sorted(random.Random(f"{pool_name}-{size}-{seed}").sample(pool, size)))
    out = []
    for sub in subsets:
        sources = [s for s in lib if s.id in sub]
        songs = []
        for c, m in catalog:
            fit = engine.melody_fit(m, sources)
            rfp = {str(p): r for p, r in sorted(fit.recording_for_pitch.items())}
            songs.append({"song": c["id"], **fit_json(fit), "recording_for_pitch": rfp})
        out.append({"recordings": sub, "songs": songs})
    return {"subsets": out}


def choices_json(choices):
    if choices is None:
        return None
    return {"transposition": int(choices.transposition), "preferred": choices.preferred, "excluded": list(choices.excluded)}


def choice_cases(m, sources):
    """The changes the golden tests replay on one Song (#360), each a list of steps from no change:
    (name, [step]), a step being an op dict as choices.json writes it. Every case picks its pitch
    and Recording by a fixed rule, lowest first, and a Song gets only the cases it allows."""
    auto = engine.melody_fit(m, sources)
    start = engine.FartChoices(auto.transpose)
    melodic = sorted((s for s in sources if s.pitched), key=lambda s: s.id)
    pitches = sorted(auto.recording_for_pitch)
    players = {p: [s.id for s in melodic if engine.can_play(s, p, start, m)] for p in pitches}
    playing = {r: p for p, r in auto.recording_for_pitch.items() if r is not None}
    cases = []
    swap = next(((p, r) for p in pitches for r in players[p] if r not in playing), None)
    if swap:  # a Recording nobody plays: no other pitch moves
        cases.append(("swap", [{"op": "swap", "song_pitch": swap[0], "recording": swap[1]}]))
    taken = next(((p, r) for p in pitches for r in players[p] if playing.get(r, p) != p), None)
    if taken:  # a Recording another pitch plays: that pitch is arranged again
        cases.append(("swap_taken", [{"op": "swap", "song_pitch": taken[0], "recording": taken[1]}]))
    covered = [p for p in pitches if auto.recording_for_pitch[p] is not None]
    if covered:
        r = auto.recording_for_pitch[covered[0]]
        cases.append(("leave_out", [{"op": "leave_out", "recording": r}]))
        cases.append(("use_again", [{"op": "leave_out", "recording": r}, {"op": "use_again", "recording": r}]))
        # The covered pitch fewest Recordings can play, lowest on a tie: leave out each of them in
        # turn until it has no fart and the Song locks, then reset it.
        p = min(covered, key=lambda p: (len(players[p]), p))
        steps = [{"op": "leave_out", "recording": r} for r in players[p]]
        cases.append(("leave_out_every", [*steps, {"op": "reset", "song_pitch": p}]))
    if swap and len(covered) > 1:
        q = next(q for q in covered if q != swap[0])
        cases.append((
            "reset",
            [
                {"op": "swap", "song_pitch": swap[0], "recording": swap[1]},
                {"op": "leave_out", "recording": auto.recording_for_pitch[q]},
                {"op": "reset", "song_pitch": swap[0]},
                {"op": "reset", "song_pitch": q},
            ],
        ))
        cases.append(("reset_all", [
            {"op": "swap", "song_pitch": swap[0], "recording": swap[1]},
            {"op": "leave_out", "recording": auto.recording_for_pitch[q]},
            {"op": "reset_all"},
        ]))
    others = [p for p in pitches if p != swap[0]] if swap else []
    if len(others) >= 4:
        # A swap kept, and picks the engine drops: a Recording that is gone, one that can't play
        # its pitch, one left out, a Noise-like one, one for a pitch the Song doesn't have, and
        # the swapped one again for a higher pitch.
        preferred = {swap[0]: swap[1], others[0]: "999", pitches[-1] + 1: melodic[0].id}
        far = next((s.id for s in melodic if s.id not in players[others[1]]), None)
        if far is not None:
            preferred[others[1]] = far
        left_out = auto.recording_for_pitch[others[2]] or melodic[0].id
        preferred[others[2]] = left_out
        noise = next((s.id for s in sorted(sources, key=lambda s: s.id) if not s.pitched), None)
        if noise is not None:
            preferred[others[3]] = noise
        higher = [p for p in others[4:] if p > swap[0]]
        if higher:
            preferred[higher[0]] = swap[1]
        choices = {"transposition": auto.transpose, "preferred": dict(sorted(preferred.items())), "excluded": [left_out]}
        cases.append(("stale", [{"op": "set", "choices": choices}]))
    return cases


def apply_step(step, choices, auto, m, sources):
    """One step of a choice case, on the Song's Fart Choices, or on none at the transposition of
    Auto-map's Arrangement `auto` (what the Song shows with no change)."""
    current = choices or engine.FartChoices(auto.transpose)
    op = step["op"]
    if op == "swap":
        return engine.swap(current, step["song_pitch"], step["recording"])
    if op == "leave_out":
        return engine.leave_out(current, step["recording"])
    if op == "use_again":
        return engine.use_again(current, step["recording"])
    if op == "reset":
        return engine.reset(current, step["song_pitch"], m, sources)
    if op == "reset_all":
        return None
    if op == "set":
        c = step["choices"]
        return engine.FartChoices(c["transposition"], dict(c["preferred"]), tuple(c["excluded"]))
    raise ValueError(op)


def choice_states(m, sources, steps):
    """The Song's Fart Choices and Arrangement before the first step and after each."""
    auto = engine.melody_fit(m, sources)
    choices = None
    states = []
    for step in [None, *steps]:
        if step is not None:
            choices = apply_step(step, choices, auto, m, sources)
        fit = auto if choices is None else engine.arrange(m, sources, choices)
        rfp = {str(p): r for p, r in sorted(fit.recording_for_pitch.items())}
        states.append({"step": step, "choices": choices_json(choices), **fit_json(fit), "recording_for_pitch": rfp})
    return states


def choices_cases_json(catalog, libraries):
    """Every arranged Song's choice cases (choice_cases()) on each library, replayed step by step."""
    out = []
    for name, sources in libraries.items():
        for c, m in catalog:
            for case, steps in choice_cases(m, sources):
                out.append({"case": case, "song": c["id"], "library": name, "states": choice_states(m, sources, steps)})
    return {"cases": out}


def arranged_catalog(catalog):
    """The Songs of `catalog` that get arrangements/ and coverage.json, in catalog order: the
    hand-entered ones and ARRANGED_BATCHES' (#350). Every later batch's Song passed
    tools/catalog/import_pdmx.py's render gate on this engine. Arranging all 1,009 here would take
    this script from about 3 minutes to 25, and the web tests that read them about 8 times as long."""
    return [(c, m) for c, m in catalog if "import" not in c or c["import"].get("titles") in ARRANGED_BATCHES]


def main():
    for name in GENERATED:
        path = GOLDEN / name
        if path.is_dir():
            shutil.rmtree(path)
        elif path.exists():
            path.unlink()

    manifest = {r["id"]: r for r in json.loads(engine.MANIFEST.read_text())["recordings"]}
    lib = engine.load_library()
    small = [s for s in lib if s.id in SMALL_LIBRARY]
    assert [s.id for s in small] == sorted(SMALL_LIBRARY)
    libraries = {"full": lib, "small": small}
    for src in lib:
        write(f"recordings/{src.id}.json", recording_json(manifest[src.id], src))

    every = load_catalog()
    for c, m in every:
        write(f"songs/{c['id']}.json", song_json(c, m))
    catalog = arranged_catalog(every)
    songs = []
    for c, m in catalog:
        transposes, unlocked = {}, {}
        for name, sources in libraries.items():
            a = arrangement_json(c, m, name, sources)
            write(f"arrangements/{name}/{c['id']}.json", a)
            transposes[name] = a["transpose"]
            unlocked[name] = a["unlocked"]
            cov = f"{a['pitch_coverage']['covered']}/{a['pitch_coverage']['total']}"
            if not a["unlocked"]:
                print(f"{c['id']:12s} {name:5s} T={a['transpose']:+d} locked, {cov} notes covered")
                continue
            r = a["metrics"]
            print(
                f"{c['id']:12s} {name:5s} T={a['transpose']:+d} notes={r['notes']:3d} in50cFart={r['within_50c_of_fart_pct']:3d}% "
                f"onTime={r['onsets_on_time_pct']}% reatk={r['notes_with_retrigger']} | in50c={r['within_50c_pct']:3d}% "
                f"med={r['median_abs_cents']:5.1f}c contour={r['contour_pct']}% recs={r['distinct_recordings']} "
                f"octaveMoves={a['octave_moves']}"
            )
        songs.append({"id": c["id"], "title": c["title"], "notes": len(m.notes), "transpose": transposes, "unlocked": unlocked})
    # The owner's farts (#295) stay out of the random subsets, so adding them left every subset as
    # it was. They are Noise-like, so the Arrangements, which read only Melodic Recordings, are too.
    write("coverage.json", coverage_json(catalog, [s for s in lib if manifest[s.id]["source"] != "owner"]))
    write("choices.json", choices_cases_json(catalog, libraries))

    melodic = [s.id for s in lib if s.pitched]
    by_pitch = {}
    for s in lib:
        if s.pitched:
            by_pitch.setdefault(s.ref_midi, []).append(s.id)
    tie_groups = sorted(ids for ids in by_pitch.values() if len(ids) > 1)
    write(
        "index.json",
        {
            "format_version": FORMAT_VERSION,
            "generator": "tools/melody-lab/export_golden.py",
            "sample_rate": engine.SR,
            "hop": engine.HOP,
            "libraries": {name: [s.id for s in sources] for name, sources in libraries.items()},
            "recordings": [s.id for s in lib],
            "melodic_recordings": melodic,
            "tie_groups": tie_groups,
            "songs": songs,
            "environment": {
                "python": platform.python_version(),
                "numpy": version("numpy"),
                "scipy": version("scipy"),
                "librosa": version("librosa"),
                "soundfile": version("soundfile"),
                "libsndfile": sf.__libsndfile_version__,
                "mido": version("mido"),
                "soxr": version("soxr"),
            },
        },
    )
    print(f"{len(melodic)} of {len(lib)} Recordings are Melodic: {' '.join(melodic)}")
    golden_cost.main()  # fails if golden_cost.py no longer matches plan()'s cost terms


if __name__ == "__main__":
    main()
