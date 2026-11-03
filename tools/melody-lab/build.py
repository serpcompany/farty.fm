import json
import shutil
import subprocess
from pathlib import Path

import librosa
import numpy as np
import soundfile as sf

import engine
from analysis import SR, load_library, read_manifest
from evaluate import evaluate
from melody import load_catalog

OUT = Path(__file__).parent / "out/listen"
AUDIO = OUT / "audio"
SMALL_LIBRARY = ["002", "009", "016", "022", "069", "090"]
NOT_LISTED = {"ode-mutopia"}


def encode(y, name):
    wav = AUDIO / f"{name}.wav"
    sf.write(wav, y, SR)
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", wav, "-c:a", "libmp3lame", "-q:a", "4", AUDIO / f"{name}.mp3"],
        check=True,
    )
    wav.unlink()
    return f"audio/{name}.mp3"


def recording_entry(s, manifest):
    return {
        "id": s.id,
        "source": manifest[s.id]["source"],
        "license": manifest[s.id]["permission"],
        "melodic": s.pitched,
        "note": librosa.midi_to_note(s.ref_midi, cents=True) if s.pitched else None,
        "shortest_note_s": s.min_note_s if s.pitched else None,
        "segment_s": round(s.seconds, 2),
        "audio": encode(s.audio / np.abs(s.audio).max() * 0.89, f"rec-{s.id}"),
    }


def raw_variant(c, m, lib):
    transpose, assignments = engine.plan(m, lib)
    y, events = engine.render(m, lib, assignments, bpm=m.bpm)
    r = evaluate(y, m, events, m.bpm, lib)
    variant = {
        "audio": encode(y, f"{c['id']}-raw"),
        "transpose": transpose,
        "metrics": {k: v for k, v in r.items() if k != "per_note"},
        "notes": [
            {
                "start": m.notes[e["note_index"]].start,
                "dur": m.notes[e["note_index"]].dur,
                "midi": e["target_midi"],
                "rec": e["source_id"],
                "shift": e["shift_semitones"],
                "cents": p["cents"],
                "fart_cents": p["fart_cents"],
            }
            for e, p in zip(events, r["per_note"], strict=True)
        ],
    }
    print(c["id"], "raw", variant["metrics"])
    return variant


def song_entry(c, m, lib):
    variants = {
        "raw": raw_variant(c, m, lib),
        "before": {"audio": encode(engine.render_naive(m, lib, bpm=m.bpm), f"{c['id']}-before")},
    }
    return {
        "id": c["id"],
        "title": c["title"],
        "bpm": m.bpm,
        "bar_lines": m.bar_lines,
        "source": c["source"],
        "import_report": {k: v for k, v in m.report.items() if k != "source_file"},
        "variants": variants,
    }


def main():
    AUDIO.mkdir(parents=True, exist_ok=True)
    lib = load_library()
    manifest = {r["id"]: r for r in read_manifest()}
    recordings = [recording_entry(s, manifest) for s in lib]
    songs = []
    for c, m in load_catalog():
        if c["id"] in NOT_LISTED:
            continue
        fit = engine.melody_fit(m, lib)
        if not fit.unlocked:
            print(c["id"], f"locked: {fit.covered} of {fit.total} notes covered")
            continue
        songs.append(song_entry(c, m, lib))
    data = {"recordings": recordings, "songs": songs}
    shutil.copy(Path(__file__).parent / "listen/index.html", OUT / "index.html")
    (OUT / "data.js").write_text(
        "window.PEDOS = " + json.dumps(data, ensure_ascii=False) + ";\n", encoding="utf-8", newline="\n"
    )


if __name__ == "__main__":
    main()
