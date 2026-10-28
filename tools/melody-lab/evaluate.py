import librosa
import numpy as np

from analysis import (
    HOP,
    LEVEL_HOP,
    ONSET_BELOW_PEAK_DB,
    REATTACK_AFTER_S,
    REATTACK_DIP_DB,
    REATTACK_RISE_DB,
    SR,
    level_db,
)
from engine import GAP_S

PYIN = {"fmin": 45, "fmax": 1200, "sr": SR, "frame_length": 2048, "hop_length": HOP}
BAR = {"within_50c_of_fart_pct": 94, "onsets_on_time_pct": 95, "notes_with_retrigger": 0}
FART_CENTS = 50
ON_PITCH_CENTS = 50
LOUD_DB = 20
OCTAVE_ERROR_CENTS = 900
SOUNDING_DB = 30
SILENT_FLOOR_DB = -80
DRY_PAD = 8 * HOP
ONSET_TOLERANCE_S = 0.05


def has_reattack(seg):
    if len(seg) < 20 * LEVEL_HOP:
        return False
    db = level_db(seg, 10 * LEVEL_HOP)
    a0 = int(np.argmax(db >= db.max() - ONSET_BELOW_PEAK_DB))
    run_max, dip = db[a0], None
    for i in range(a0 + 1, len(db) - 2):
        if db[i] > run_max and dip is None:
            run_max = db[i]
        if db[i] < run_max - REATTACK_DIP_DB and (dip is None or db[i] < db[dip]):
            dip = i
        if dip is not None and db[i] > db[dip] + REATTACK_RISE_DB and (i - a0) * LEVEL_HOP > REATTACK_AFTER_S * SR:
            return True
    return False


def yin_frames(y):
    f = librosa.yin(y, fmin=PYIN["fmin"], fmax=PYIN["fmax"], sr=SR, frame_length=2048, hop_length=HOP)
    db = 20 * np.log10(librosa.feature.rms(y=y, frame_length=2048, hop_length=HOP)[0] + 1e-9)
    return f, db


def sounding_frames(t, db, start_s, heard_len):
    win = np.where((t >= start_s + 0.012) & (t <= start_s + heard_len - 0.012))[0]
    return win[db[win] > db[win].max() - LOUD_DB] if len(win) else win


def on_pitch_share(audio, melody, events, bpm):
    f, db = yin_frames(audio)
    t = librosa.times_like(f, sr=SR, hop_length=HOP)
    spb = 60 / bpm
    cents = []
    for e in events:
        s = melody.notes[e["note_index"]].start * spb
        heard_len = min(e["len_s"], melody.notes[e["note_index"]].dur * spb)
        loud = sounding_frames(t, db, s, heard_len)
        if len(loud) == 0:
            continue
        c = (librosa.hz_to_midi(f[loud]) - e["target_midi"]) * 100
        cents.append(c[np.abs(c) <= OCTAVE_ERROR_CENTS])
    cents = np.concatenate(cents) if cents else np.array([])
    return float(np.mean(np.abs(cents) <= ON_PITCH_CENTS)) if len(cents) else 0.0


def sounding_share(seg):
    if len(seg) < 2 * LEVEL_HOP:
        return 0.0
    db = level_db(seg, 2 * LEVEL_HOP)
    return float(np.mean((db > db.max() - SOUNDING_DB) & (db > SILENT_FLOOR_DB)))


def note_window(t, start_s, heard_len):
    return (t >= start_s + 0.03) & (t <= start_s + max(0.06, heard_len - 0.02))


def median_midi(f0, voiced, window):
    f = f0[window & voiced & np.isfinite(f0)]
    return float(np.median(librosa.hz_to_midi(f))) if len(f) >= 2 else None


def dry_frames(gesture, offset, n_samples):
    y = np.zeros(DRY_PAD + offset + n_samples + DRY_PAD)
    y[DRY_PAD + offset: DRY_PAD + offset + n_samples] = gesture[:n_samples]
    return yin_frames(y)[0]


def fart_cents(f, loud, dry, first):
    if len(loud) == 0:
        return None
    k = np.clip(loud - first, 0, len(dry) - 1)
    return float(np.median(librosa.hz_to_midi(f[loud]) - librosa.hz_to_midi(dry[k])) * 100)


def contour_share(targets, heard):
    steps = same = 0
    for (t0, h0), (t1, h1) in zip(zip(targets, heard), zip(targets[1:], heard[1:])):
        if t1 == t0:
            continue
        steps += 1
        same += h0 is not None and h1 is not None and np.sign(h1 - h0) == np.sign(t1 - t0)
    return same / steps if steps else None


class FartReader:
    def __init__(self, audio, sources):
        self.gesture = {s.id: s.audio for s in sources}
        self.f_yin, self.db = yin_frames(audio)
        self.dry = {}

    def cents_off(self, event, start_s, heard_len, t):
        start_sample = int(start_s * SR)
        g = self.gesture[event["source_id"]]
        n_samples = min(len(g), int(round(event["len_s"] * SR)))
        key = (event["source_id"], n_samples, start_sample % HOP)
        if key not in self.dry:
            self.dry[key] = dry_frames(g, start_sample % HOP, n_samples)
        first_render_frame = start_sample // HOP - DRY_PAD // HOP
        return fart_cents(self.f_yin, sounding_frames(t, self.db, start_s, heard_len), self.dry[key], first_render_frame)


def slot_sounding_share(audio, start_s, dur_s):
    slot = max(0.06, dur_s - GAP_S)
    return sounding_share(audio[int(start_s * SR): int(start_s * SR) + int(slot * SR)])


def evaluate(audio, melody, events, bpm, sources):
    spb = 60 / bpm
    f0, voiced, _ = librosa.pyin(audio, **PYIN)
    t = librosa.times_like(f0, sr=SR, hop_length=HOP)
    reader = FartReader(audio, sources)
    onset_env = librosa.onset.onset_strength(y=audio, sr=SR, hop_length=HOP)
    onsets = librosa.onset.onset_detect(onset_envelope=onset_env, sr=SR, hop_length=HOP, units="time", backtrack=False)

    per_note, errors, faithful, heard_midi, sounding = [], [], [], [], []
    retrigger_notes = 0
    for e in events:
        n = melody.notes[e["note_index"]]
        s = n.start * spb
        heard_len = min(e["len_s"], n.dur * spb)
        heard = median_midi(f0, voiced, note_window(t, s, heard_len))
        heard_midi.append(heard)
        cents = None
        if heard is not None:
            cents = float((heard - e["target_midi"]) * 100)
            errors.append(cents)
        off_fart = reader.cents_off(e, s, heard_len, t)
        faithful.append(off_fart is not None and abs(off_fart) <= FART_CENTS)
        retrigger_notes += has_reattack(audio[int(s * SR): int((s + heard_len) * SR)])
        sounding.append(slot_sounding_share(audio, s, n.dur * spb))
        per_note.append({
            "i": e["note_index"],
            "target": int(e["target_midi"]),
            "cents": None if cents is None else round(cents),
            "fart_cents": None if off_fart is None else round(off_fart),
        })

    errors = np.array(errors)
    n_notes = len(events)
    pitch_class_errors = (errors + 600) % 1200 - 600 if len(errors) else errors
    note_starts = np.array([melody.notes[e["note_index"]].start * spb for e in events])
    matched = sum(1 for s in note_starts if len(onsets) and np.min(np.abs(onsets - s)) < ONSET_TOLERANCE_S)
    contour = contour_share([e["target_midi"] for e in events], heard_midi)
    return {
        "notes": n_notes,
        "within_50c_of_fart_pct": round(100 * sum(faithful) / n_notes),
        "onsets_on_time_pct": round(100 * matched / n_notes),
        "notes_with_retrigger": retrigger_notes,
        "pitch_readable_pct": round(100 * len(errors) / n_notes),
        "within_50c_pct": round(100 * np.sum(np.abs(errors) <= 50) / n_notes),
        "within_50c_any_octave_pct": round(100 * np.sum(np.abs(pitch_class_errors) <= 50) / n_notes),
        "median_abs_cents": round(float(np.median(np.abs(errors))), 1) if len(errors) else None,
        "contour_pct": None if contour is None else round(100 * contour),
        "distinct_recordings": len({e["source_id"] for e in events}),
        "on_pitch_pct": round(100 * on_pitch_share(audio, melody, events, bpm)),
        "sounding_pct": round(100 * float(np.mean(sounding))) if sounding else None,
        "notes_mostly_silent": sum(1 for x in sounding if x < 0.5),
        "per_note": per_note,
    }


def bar_problems(metrics, bar=BAR):
    problems = []
    if metrics["within_50c_of_fart_pct"] < bar["within_50c_of_fart_pct"]:
        problems.append(f"in50cFart {metrics['within_50c_of_fart_pct']}% < {bar['within_50c_of_fart_pct']}%")
    if metrics["onsets_on_time_pct"] < bar["onsets_on_time_pct"]:
        problems.append(f"onTime {metrics['onsets_on_time_pct']}% < {bar['onsets_on_time_pct']}%")
    if metrics["notes_with_retrigger"] > bar["notes_with_retrigger"]:
        problems.append(f"{metrics['notes_with_retrigger']} notes re-attack")
    return problems


def metrics_line(label, transpose, r, octave_moves, verdict=""):
    return (
        f"{label:12s} T={transpose:+d} notes={r['notes']:3d} in50cFart={r['within_50c_of_fart_pct']:3d}%"
        f" onTime={r['onsets_on_time_pct']}% reatk={r['notes_with_retrigger']}{' ' + verdict if verdict else ''}"
        f" | in50c={r['within_50c_pct']:3d}% med={r['median_abs_cents']:5.1f}c contour={r['contour_pct']}%"
        f" recs={r['distinct_recordings']} octaveMoves={octave_moves}"
        f" sounding={r['sounding_pct']}% mostlySilent={r['notes_mostly_silent']}"
    )
