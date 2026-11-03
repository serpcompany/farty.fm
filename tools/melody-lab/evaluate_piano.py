"""Reads back a Song's melody as the web app's piano played it (#359, ADR 0015 rule 3).

The piano never reaches a render, so this checks what the browser sent to the speakers:
`apps/web/e2e/piano-preview.spec.ts` records it, with E2E_EVIDENCE_DIR set, as `piano-<song>.wav`
and `piano-<song>.json` (the Song's notes as written, in the key it played, and where its 0 is
in the WAV). The checks are evaluate.py's, against the notes instead of a fart:

- timing: each note's start has an onset within +-50 ms (`onsets_on_time_pct`, evaluate.py's
  onTime), with the median and largest distance to the nearest onset;
- pitch: pYIN's median over each note (evaluate.py's `note_window`) against the note
  (`within_50c_pct`, `median_abs_cents`);
- level: each note's loudness over the same window, in dBFS, quietest first.

    .venv/bin/python -I evaluate_piano.py <dir>/piano-mary.wav
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import librosa  # noqa: E402
import numpy as np  # noqa: E402
from evaluate import BAR, HOP, PYIN, SR, median_midi, note_window  # noqa: E402


def evaluate_piano(audio, notes, zero):
    f0, voiced, _ = librosa.pyin(audio, **PYIN)
    t = librosa.times_like(f0, sr=SR, hop_length=HOP) - zero
    onset_env = librosa.onset.onset_strength(y=audio, sr=SR, hop_length=HOP)
    onsets = librosa.onset.onset_detect(onset_envelope=onset_env, sr=SR, hop_length=HOP, units="time", backtrack=False) - zero
    rms = librosa.feature.rms(y=audio, frame_length=2048, hop_length=HOP)[0]
    t_rms = librosa.times_like(rms, sr=SR, hop_length=HOP) - zero

    distances, cents, levels = [], [], []
    for n in notes:
        distances.append(float(np.min(np.abs(onsets - n["start"]))) if len(onsets) else float("inf"))
        heard = median_midi(f0, voiced, note_window(t, n["start"], n["seconds"]))
        cents.append(None if heard is None else 100 * (heard - n["midi"]))
        window = note_window(t_rms, n["start"], n["seconds"])
        levels.append(float(20 * np.log10(np.sqrt(np.mean(rms[window] ** 2)) + 1e-9)))

    distances = np.array(distances)
    read = np.array([abs(c) for c in cents if c is not None])
    end = notes[-1]["start"] + notes[-1]["seconds"]
    quietest = sorted(range(len(notes)), key=lambda i: levels[i])[:3]
    return {
        "notes": len(notes),
        "onsets_detected": int(np.sum((onsets > -0.25) & (onsets < end + 0.25))),
        "onsets_on_time_pct": round(100 * float(np.mean(distances < 0.05))),
        "median_onset_ms": round(1000 * float(np.median(distances)), 1),
        "max_onset_ms": round(1000 * float(np.max(distances)), 1),
        "pitch_read": len(read),
        "within_50c_pct": round(100 * float(np.mean(read < 50))) if len(read) else 0,
        "median_abs_cents": round(float(np.median(read)), 1) if len(read) else None,
        "quietest_notes_dbfs": [
            {"index": i, "midi": notes[i]["midi"], "dbfs": round(levels[i], 1)} for i in quietest
        ],
        "loudest_note_dbfs": round(max(levels), 1),
    }


def main(wav):
    wav = Path(wav)
    plan = json.loads(wav.with_suffix(".json").read_text())
    audio, _ = librosa.load(wav, sr=SR, mono=True)
    metrics = evaluate_piano(audio, plan["notes"], plan["zero"])
    print(json.dumps({"song": plan["song"], "transposition": plan["transposition"], **metrics}, indent=2))
    on_time = metrics["onsets_on_time_pct"] >= BAR["onsets_on_time_pct"]
    print("PASS" if on_time else f"FAIL onTime {metrics['onsets_on_time_pct']}% < {BAR['onsets_on_time_pct']}%")
    return 0 if on_time else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
