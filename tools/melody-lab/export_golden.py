"""Export the reference engine's results as golden test data for the Swift port.

Writes deterministic JSON to fixtures/golden/ (format and tolerances: fixtures/golden/README.md):

  index.json                         libraries, Recordings, Songs, a summary, library versions
  recordings/<id>.json               Recording Analysis of every Fixture Library Recording
  songs/<id>.json                    the imported melody of every catalog Song
  arrangements/<library>/<id>.json   transposition, Arrangement and evaluate.py metrics per Song,
                                     for the full Fixture Library and the small 6-Recording one

Everything is computed by the lab's own functions (the same calls run_all.py makes); this
script only rounds and writes. Running it twice gives byte-identical files.

    .venv/bin/python export_golden.py
"""
import hashlib
import json
import platform
import shutil
from importlib.metadata import version

import librosa
import numpy as np
import soundfile as sf

import engine
from build import SMALL_LIBRARY
from evaluate import evaluate
from melody import load_catalog

GOLDEN = engine.ROOT / "fixtures/golden"
GENERATED = ("index.json", "recordings", "songs", "arrangements")  # README.md is written by hand
TUNE = 1.0  # render settings of run_all.py and build.py's "tuned" variant
FORMAT_VERSION = 1


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
            "cut_at_reattack": bool(src.cut_at_reattack),
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
        "length_beats": exact(m.length_beats),
        "pitches": sorted({int(n.pitch) for n in m.notes}),
        "notes": [{"start": exact(n.start), "dur": exact(n.dur), "pitch": int(n.pitch)} for n in m.notes],
        "import_report": report,
    }


def arrangement_json(c, m, library, sources):
    transpose, assignments, cost = engine.plan(m, sources, with_cost=True)
    pitch_of = {s.id: s.ref_midi for s in sources}
    audio, events = engine.render(m, sources, assignments, tune=TUNE, bpm=m.bpm)
    metrics = evaluate(audio, m, events, m.bpm)
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
                "render": {"start_s": e["start_s"], "len_s": e["len_s"], "gain_db": e["gain_db"]},
            }
        )
    per_pitch = {}  # without variety, every note of a Song pitch gets the same Recording
    for a in assignments:
        p = int(m.notes[a.note_index].pitch)
        entry = {
            "song_pitch": p,
            "target_midi": int(a.target_midi),
            "recording": a.source_id,
            "shift_semitones": exact(a.target_midi - pitch_of[a.source_id]),
        }
        assert per_pitch.setdefault(p, entry) == entry
    return {
        "song": c["id"],
        "library": library,
        "render_settings": {"tune": TUNE, "bpm": m.bpm, "variety": False},
        "transpose": int(transpose),
        "plan_cost": exact(cost),
        "per_pitch": [per_pitch[p] for p in sorted(per_pitch)],
        "max_abs_shift_semitones": max(abs(n["shift_semitones"]) for n in notes),
        "notes": notes,
        "metrics": metrics,
    }


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

    songs = []
    for c, m in load_catalog():
        write(f"songs/{c['id']}.json", song_json(c, m))
        transposes = {}
        for name, sources in libraries.items():
            a = arrangement_json(c, m, name, sources)
            write(f"arrangements/{name}/{c['id']}.json", a)
            transposes[name] = a["transpose"]
            r = a["metrics"]
            print(
                f"{c['id']:12s} {name:5s} T={a['transpose']:+d} notes={r['notes']:3d} in50c={r['within_50c_pct']:3d}% "
                f"med={r['median_abs_cents']:5.1f}c onTime={r['onsets_on_time_pct']}% reatk={r['notes_with_retrigger']} "
                f"recs={r['distinct_recordings']} maxShift={a['max_abs_shift_semitones']:.1f}"
            )
        songs.append({"id": c["id"], "title": c["title"], "notes": len(m.notes), "transpose": transposes})

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


if __name__ == "__main__":
    main()
