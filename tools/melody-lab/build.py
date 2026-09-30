"""Render every catalog melody in several variants and write the listening page data."""
import json
import shutil
import subprocess
from pathlib import Path

import librosa
import numpy as np
import soundfile as sf

import engine
from evaluate import evaluate
from melody import load_catalog

OUT = Path(__file__).parent / "out/listen"
AUDIO = OUT / "audio"
SMALL_LIBRARY = ["002", "009", "016", "021", "069", "090"]  # a plausible new user's first six


def encode(y, name):
    wav = AUDIO / f"{name}.wav"
    sf.write(wav, y, engine.SR)
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", wav, "-c:a", "libmp3lame", "-q:a", "4", AUDIO / f"{name}.mp3"],
        check=True,
    )
    wav.unlink()
    return f"audio/{name}.mp3"


def main():
    AUDIO.mkdir(parents=True, exist_ok=True)
    lib = engine.load_library()
    small = [s for s in lib if s.id in SMALL_LIBRARY]
    manifest = {r["id"]: r for r in json.loads(engine.MANIFEST.read_text())["recordings"]}

    recordings = []
    for s in lib:
        recordings.append(
            {
                "id": s.id,
                "source": manifest[s.id]["source"],
                "license": manifest[s.id]["permission"],
                "melodic": s.pitched,
                "note": librosa.midi_to_note(s.ref_midi, cents=True) if s.pitched else None,
                "shortest_note_s": s.min_note_s if s.pitched else None,
                "segment_s": round(s.seconds, 2),
                "audio": encode(s.audio / np.abs(s.audio).max() * 0.89, f"rec-{s.id}"),
            }
        )

    songs = []
    for c, m in load_catalog():
        if c["id"] == "ode-mutopia":
            continue
        variants = {}
        for key, sources, tune in (("tuned", lib, 1.0), ("natural", lib, 0.0), ("small", small, 1.0)):
            T, asg = engine.plan(m, sources)
            y, ev = engine.render(m, sources, asg, tune=tune, bpm=m.bpm)
            r = evaluate(y, m, ev, m.bpm)
            variants[key] = {
                "audio": encode(y, f"{c['id']}-{key}"),
                "transpose": T,
                "metrics": {k: v for k, v in r.items() if k != "per_note"},
                "notes": [
                    {
                        "start": m.notes[e["note_index"]].start,
                        "dur": m.notes[e["note_index"]].dur,
                        "midi": e["target_midi"],
                        "rec": e["source_id"],
                        "shift": e["shift_semitones"],
                        "cents": p["cents"],
                    }
                    for e, p in zip(ev, r["per_note"])
                ],
            }
            print(c["id"], key, variants[key]["metrics"])
        variants["before"] = {"audio": encode(engine.render_naive(m, lib, bpm=m.bpm), f"{c['id']}-before")}
        songs.append(
            {
                "id": c["id"],
                "title": c["title"],
                "bpm": m.bpm,
                "beats_per_bar": m.beats_per_bar,
                "source": c["source"],
                "import_report": {k: v for k, v in m.report.items() if k != "source_file"},
                "variants": variants,
            }
        )

    data = {"recordings": recordings, "songs": songs, "small_library": SMALL_LIBRARY}
    shutil.copy(Path(__file__).parent / "listen/index.html", OUT / "index.html")
    (OUT / "data.js").write_text("window.PEDOS = " + json.dumps(data, ensure_ascii=False) + ";\n")


if __name__ == "__main__":
    main()
