import hashlib
import json
import platform
import random
import shutil
from importlib.metadata import version

import librosa
import numpy as np
import soundfile as sf

import analysis
import engine
import golden_cost
from build import SMALL_LIBRARY
from evaluate import evaluate
from melody import load_catalog

GOLDEN = analysis.ROOT / "fixtures/golden"
SHIP_LIST = analysis.ROOT / "apps/web/src/lib/catalog/ship-list.json"
GENERATED = ("index.json", "recordings", "songs", "arrangements", "coverage.json")
FORMAT_VERSION = 6
COVERAGE_SEEDS = 10


class Exact(float):
    pass


def exact(x):
    return None if x is None else Exact(x)


def num(x, digits):
    if x is None or not np.isfinite(x):
        return None
    return round(float(x), digits) + 0.0


def plain(x):
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
    path.write_text(text + "\n", encoding="utf-8", newline="\n")


def noise_like_reason(src):
    if src.pitched:
        return None
    return "no_steady_pitch" if src.pitch_estimate is None else "failed_audition"


def recording_json(entry, src):
    audio_path = analysis.AUDIO_DIR / entry["filename"]
    info = sf.info(audio_path)
    voiced = np.isfinite(src.f0)
    contour = librosa.hz_to_midi(np.where(voiced, src.f0, 1.0))
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
            "start_s": num(src.start / analysis.SR, 6),
            "end_s": num(src.end / analysis.SR, 6),
            "cut_at_reattack": bool(src.cut_at_reattack),
        },
        "pitch_contour": {
            "sample_rate": analysis.SR,
            "hop": analysis.HOP,
            "frames": len(src.f0),
            "midi": [num(m, 4) if v else None for m, v in zip(contour, voiced, strict=True)],
        },
        "pitch_estimate_midi": exact(src.pitch_estimate),
        "pitch_confidence": src.pitch_confidence,
        "recording_pitch_midi": exact(src.ref_midi),
        "recording_pitch_note": librosa.midi_to_note(src.ref_midi, cents=True) if src.pitched else None,
        "shortest_note_s": src.min_note_s if src.pitched else None,
        "settle_s": exact(src.settle_s) if src.pitched else None,
        "melodic": src.pitched,
        "noise_like_reason": noise_like_reason(src),
        "rms_db": num(src.rms_db, 4),
    }


def song_json(c, m):
    report = dict(m.report)
    root = analysis.ROOT
    report["source_file"] = root.joinpath(report["source_file"]).resolve().relative_to(root).as_posix()
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
    return {
        "unlocked": fit.unlocked,
        "pitch_coverage": {"covered": fit.covered, "total": fit.total},
        "transpose": int(fit.transpose),
        "octave_moves": fit.octave_moves,
        "plan_cost": exact(fit.cost),
        "missing": [{"target_midi": int(m), "seconds": s} for m, s in fit.missing],
    }


def per_pitch_json(fit, sources):
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
    return per_pitch


def note_json(m, a, e, p):
    assert a.note_index == e["note_index"] == p["i"]
    return {
        "index": a.note_index,
        "song_pitch": int(m.notes[a.note_index].pitch),
        "target_midi": int(a.target_midi),
        "recording": a.source_id,
        "shift_semitones": num(a.shift_semitones, 4),
        "heard_cents": p["cents"],
        "fart_cents": p["fart_cents"],
        "render": {"start_s": e["start_s"], "len_s": e["len_s"], "gain_db": e["gain_db"]},
    }


def arrangement_json(c, m, library, sources):
    fit = engine.melody_fit(m, sources)
    out = {"song": c["id"], "library": library, **fit_json(fit), "per_pitch": per_pitch_json(fit, sources)}
    if not fit.unlocked:
        return {**out, "render_settings": None, "max_abs_shift_semitones": None, "notes": None, "metrics": None}

    transpose, assignments, cost = engine.plan(m, sources, with_cost=True)
    assert (transpose, cost) == (fit.transpose, fit.cost)
    audio, events = engine.render(m, sources, assignments, bpm=m.bpm)
    metrics = evaluate(audio, m, events, m.bpm, sources)
    per_note = metrics.pop("per_note")
    notes = [note_json(m, a, e, p) for a, e, p in zip(assignments, events, per_note, strict=True)]
    return {
        **out,
        "render_settings": {"bpm": m.bpm},
        "max_abs_shift_semitones": max(abs(n["shift_semitones"]) for n in notes),
        "notes": notes,
        "metrics": metrics,
    }


def coverage_json(catalog, lib):
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


def golden_catalog():
    ship = json.loads(SHIP_LIST.read_text(encoding="utf-8"))
    catalog = [(c, m) for c, m in load_catalog() if c["id"] in ship or "import" not in c]
    missing = set(ship) - {c["id"] for c, _ in catalog}
    assert not missing, f"the ship list names Songs that aren't in catalog/: {sorted(missing)}"
    return catalog


def clear_generated():
    for name in GENERATED:
        path = GOLDEN / name
        if path.is_dir():
            shutil.rmtree(path)
        elif path.exists():
            path.unlink()


def summary_line(c, name, a):
    cov = f"{a['pitch_coverage']['covered']}/{a['pitch_coverage']['total']}"
    if not a["unlocked"]:
        return f"{c['id']:12s} {name:5s} T={a['transpose']:+d} locked, {cov} notes covered"
    r = a["metrics"]
    return (
        f"{c['id']:12s} {name:5s} T={a['transpose']:+d} notes={r['notes']:3d} in50cFart={r['within_50c_of_fart_pct']:3d}% "
        f"onTime={r['onsets_on_time_pct']}% reatk={r['notes_with_retrigger']} | in50c={r['within_50c_pct']:3d}% "
        f"med={r['median_abs_cents']:5.1f}c contour={r['contour_pct']}% recs={r['distinct_recordings']} "
        f"octaveMoves={a['octave_moves']}"
    )


def write_songs(catalog, libraries):
    songs = []
    for c, m in catalog:
        write(f"songs/{c['id']}.json", song_json(c, m))
        transposes, unlocked = {}, {}
        for name, sources in libraries.items():
            a = arrangement_json(c, m, name, sources)
            write(f"arrangements/{name}/{c['id']}.json", a)
            transposes[name] = a["transpose"]
            unlocked[name] = a["unlocked"]
            print(summary_line(c, name, a))
        songs.append({"id": c["id"], "title": c["title"], "notes": len(m.notes), "transpose": transposes, "unlocked": unlocked})
    return songs


def environment():
    return {
        "python": platform.python_version(),
        "numpy": version("numpy"),
        "scipy": version("scipy"),
        "librosa": version("librosa"),
        "soundfile": version("soundfile"),
        "libsndfile": sf.__libsndfile_version__,
        "mido": version("mido"),
        "soxr": version("soxr"),
    }


def main():
    clear_generated()
    manifest = {r["id"]: r for r in analysis.read_manifest()}
    lib = analysis.load_library()
    small = [s for s in lib if s.id in SMALL_LIBRARY]
    assert [s.id for s in small] == sorted(SMALL_LIBRARY)
    libraries = {"full": lib, "small": small}
    for src in lib:
        write(f"recordings/{src.id}.json", recording_json(manifest[src.id], src))

    catalog = golden_catalog()
    songs = write_songs(catalog, libraries)
    write("coverage.json", coverage_json(catalog, lib))

    melodic = [s.id for s in lib if s.pitched]
    by_pitch = {}
    for s in lib:
        if s.pitched:
            by_pitch.setdefault(s.ref_midi, []).append(s.id)
    write(
        "index.json",
        {
            "format_version": FORMAT_VERSION,
            "generator": "tools/melody-lab/export_golden.py",
            "sample_rate": analysis.SR,
            "hop": analysis.HOP,
            "libraries": {name: [s.id for s in sources] for name, sources in libraries.items()},
            "recordings": [s.id for s in lib],
            "melodic_recordings": melodic,
            "tie_groups": sorted(ids for ids in by_pitch.values() if len(ids) > 1),
            "songs": songs,
            "environment": environment(),
        },
    )
    print(f"{len(melodic)} of {len(lib)} Recordings are Melodic: {' '.join(melodic)}")
    golden_cost.main()


if __name__ == "__main__":
    main()
