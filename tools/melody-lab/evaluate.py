"""Objective checks on a rendered Created Melody.

If an automatic pitch tracker can read the melody back out of the audio, note by note, a
listener almost certainly can too. These checks are necessary, not sufficient: the final
judge is still a human listening.
"""
import librosa
import numpy as np

SR = 44100
HOP = 256


def has_reattack(seg):
    """Same definition the engine uses: on a 50 ms-smoothed level, a dip of >= 6 dB followed
    by a rise of >= 4 dB after the first 60 ms = a second audible attack inside one note."""
    hop = int(0.005 * SR)
    if len(seg) < 20 * hop:
        return False
    db = 20 * np.log10(librosa.feature.rms(y=seg, frame_length=10 * hop, hop_length=hop)[0] + 1e-9)
    a0 = int(np.argmax(db >= db.max() - 12))
    run_max, dip = db[a0], None
    for i in range(a0 + 1, len(db) - 2):
        if db[i] > run_max and dip is None:
            run_max = db[i]
        if db[i] < run_max - 6 and (dip is None or db[i] < db[dip]):
            dip = i
        if dip is not None and db[i] > db[dip] + 4 and (i - a0) * hop > 0.06 * SR:
            return True
    return False


def evaluate(audio, melody, events, bpm):
    spb = 60 / bpm
    f0, voiced, vprob = librosa.pyin(audio, fmin=45, fmax=1200, sr=SR, frame_length=2048, hop_length=HOP)
    t = librosa.times_like(f0, sr=SR, hop_length=HOP)
    onset_env = librosa.onset.onset_strength(y=audio, sr=SR, hop_length=HOP)
    onsets = librosa.onset.onset_detect(onset_envelope=onset_env, sr=SR, hop_length=HOP, units="time", backtrack=False)

    per_note, errors = [], []
    retrigger_notes = 0
    for e in events:
        n = melody.notes[e["note_index"]]
        s = n.start * spb
        heard_len = min(e["len_s"], n.dur * spb)
        win = (t >= s + 0.03) & (t <= s + max(0.06, heard_len - 0.02))
        f = f0[win & voiced & np.isfinite(f0)]
        cents = None
        if len(f) >= 2:
            heard = np.median(librosa.hz_to_midi(f))
            cents = float((heard - e["target_midi"]) * 100)
            errors.append(cents)
        retrigger_notes += has_reattack(audio[int(s * SR): int((s + heard_len) * SR)])
        per_note.append({"i": e["note_index"], "target": int(e["target_midi"]), "cents": None if cents is None else round(cents)})

    errors = np.array(errors)
    n_notes = len(events)
    # an octave error still carries the melody's shape but is reported separately
    pc_err = (errors + 600) % 1200 - 600 if len(errors) else errors
    note_starts = np.array([melody.notes[e["note_index"]].start * spb for e in events])
    matched = sum(1 for s in note_starts if len(onsets) and np.min(np.abs(onsets - s)) < 0.05)
    return {
        "notes": n_notes,
        "pitch_readable_pct": round(100 * len(errors) / n_notes),
        "within_50c_pct": round(100 * np.sum(np.abs(errors) <= 50) / n_notes),
        "within_50c_any_octave_pct": round(100 * np.sum(np.abs(pc_err) <= 50) / n_notes),
        "median_abs_cents": round(float(np.median(np.abs(errors))), 1) if len(errors) else None,
        "onsets_on_time_pct": round(100 * matched / n_notes),
        "notes_with_retrigger": retrigger_notes,
        "distinct_recordings": len({e["source_id"] for e in events}),
        "per_note": per_note,
    }
