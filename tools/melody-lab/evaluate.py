"""Objective checks on a rendered Toot.

Songs play each fart raw, at its own pitch and speed (ADR 0012), so a note sounds at its
fart's pitch, not the melody's. The bar (BAR) checks that the renderer plays every fart as
recorded and on time:

- fidelity: at least 94% of notes sound within +-50 cents of their fart's own pitch over the
  stretch played (`within_50c_of_fart_pct`). YIN reads each note in the render and the same
  stretch of the dry Recording on the same frames (fart_cents()). A render that shifts or
  bends a fart fails it;
- timing: at least 95% of onsets within +-50 ms (`onsets_on_time_pct`), and no second attack
  inside a note (`notes_with_retrigger`).

Reported, not gated: how far each note sounds from the melody (`median_abs_cents`,
`within_50c_pct`), and the contour score (`contour_pct`): the share of the melody's
note-to-note steps that the render moves the same way. These checks are necessary, not
sufficient: the final judge is still a human listening.
"""
import librosa
import numpy as np

SR = 44100
HOP = 256
GAP_S = 0.025  # engine.GAP_S: the silence the renderer leaves before each next note
PYIN = {"fmin": 45, "fmax": 1200, "sr": SR, "frame_length": 2048, "hop_length": HOP}
BAR = {"within_50c_of_fart_pct": 94, "onsets_on_time_pct": 95, "notes_with_retrigger": 0}
FART_CENTS = 50  # a note is faithful when it sounds this close to its fart's own pitch


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


ON_PITCH_CENTS = 50
LOUD_DB = 20  # frames within this of the note's loudest are heard


def yin_frames(y):
    """YIN's pitch (Hz) and the level (dB) of every frame of `y`, on the evaluator's frame grid."""
    f = librosa.yin(y, fmin=PYIN["fmin"], fmax=PYIN["fmax"], sr=SR, frame_length=2048, hop_length=HOP)
    db = 20 * np.log10(librosa.feature.rms(y=y, frame_length=2048, hop_length=HOP)[0] + 1e-9)
    return f, db


def sounding_frames(t, db, start_s, heard_len):
    """A note's loud frames: over its sounding part (12 ms in from either end), the frames
    within LOUD_DB of its loudest. Empty for a note too short to have any."""
    win = np.where((t >= start_s + 0.012) & (t <= start_s + heard_len - 0.012))[0]
    return win[db[win] > db[win].max() - LOUD_DB] if len(win) else win


def on_pitch_share(audio, melody, events, bpm):
    """Share of the loud frames inside notes that YIN reads within 50 cents of the note (#208).

    YIN reads every frame, with no voicing decision, so it hears a note bending in from its
    attack or wandering off, which the pYIN median per note above smooths over. Over each note's
    sounding part (12 ms in from either end), frames within 20 dB of the note's loudest. Frames
    more than 9 semitones off are octave errors and left out."""
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
        cents.append(c[np.abs(c) <= 900])
    cents = np.concatenate(cents) if cents else np.array([])
    return float(np.mean(np.abs(cents) <= ON_PITCH_CENTS)) if len(cents) else 0.0


SOUNDING_DB = 30  # a 10 ms frame sounds when it is within this many dB of the note's peak
SILENT_FLOOR_DB = -80  # and is louder than this (dBFS), so a silent note doesn't count as sounding


def sounding_share(seg):
    """Share of a note's time that sounds: 10 ms frames (5 ms apart) within SOUNDING_DB of the
    note's loudest frame and above SILENT_FLOOR_DB. A fart shorter than its note leaves the rest
    silent (#205)."""
    hop = int(0.005 * SR)
    if len(seg) < 2 * hop:
        return 0.0
    db = 20 * np.log10(librosa.feature.rms(y=seg, frame_length=2 * hop, hop_length=hop)[0] + 1e-9)
    return float(np.mean((db > db.max() - SOUNDING_DB) & (db > SILENT_FLOOR_DB)))


def note_window(t, start_s, heard_len):
    """The frames pYIN reads a note by: 30 ms after it starts to 20 ms before it stops sounding."""
    return (t >= start_s + 0.03) & (t <= start_s + max(0.06, heard_len - 0.02))


def median_midi(f0, voiced, window):
    """The median pitch (MIDI) of the voiced frames in `window`; None under 2 frames."""
    f = f0[window & voiced & np.isfinite(f0)]
    return float(np.median(librosa.hz_to_midi(f))) if len(f) >= 2 else None


DRY_PAD = 8 * HOP  # silence around a dry stretch, a whole number of frames


def dry_frames(gesture, offset, n_samples):
    """YIN's pitch (Hz) of the dry stretch a note plays, the Recording's first `n_samples`, as
    it reads in the render: `offset` (the note's start sample mod HOP) and DRY_PAD of silence
    in front, so its frames fall on the render's frame grid, and DRY_PAD after it."""
    y = np.zeros(DRY_PAD + offset + n_samples + DRY_PAD)
    y[DRY_PAD + offset: DRY_PAD + offset + n_samples] = gesture[:n_samples]
    return yin_frames(y)[0]


def fart_cents(f, loud, dry, first):
    """How far a note sounds from its fart's own pitch over the stretch played, in cents: frame
    by frame over the note's loud frames (sounding_frames()), the pitch YIN reads in the render
    less the pitch it reads on the same frame of the dry stretch (dry_frames()); the median.

    YIN reads each frame on its own, with no voicing decision and nothing carried between
    frames, so the same samples read the same pitch: a render that plays the stretch untouched
    reads about 0, and one that shifts it or holds its pitch reads the shift or the bend. The
    median per frame, not the difference of two medians: a fart YIN reads an octave apart on
    nearby frames (032) would otherwise swing a whole octave on the few frames the fade-out
    changes. None for a note with no loud frames."""
    if len(loud) == 0:
        return None
    k = np.clip(loud - first, 0, len(dry) - 1)
    return float(np.median(librosa.hz_to_midi(f[loud]) - librosa.hz_to_midi(dry[k])) * 100)


def contour_share(targets, heard):
    """Of the melody's note-to-note steps that change pitch, the share the render moves the same
    way (up or down). A step with an unreadable note doesn't count as moving the same way."""
    steps = same = 0
    for (t0, h0), (t1, h1) in zip(zip(targets, heard), zip(targets[1:], heard[1:])):
        if t1 == t0:
            continue
        steps += 1
        same += h0 is not None and h1 is not None and np.sign(h1 - h0) == np.sign(t1 - t0)
    return same / steps if steps else None


def evaluate(audio, melody, events, bpm, sources):
    """evaluate.py's metrics for one render. `sources` are the Recordings it played (each with
    `id` and its gesture as `audio`, like engine.Source), to read each fart's own pitch."""
    gesture = {s.id: s.audio for s in sources}
    spb = 60 / bpm
    f0, voiced, vprob = librosa.pyin(audio, **PYIN)
    t = librosa.times_like(f0, sr=SR, hop_length=HOP)
    f_yin, db = yin_frames(audio)
    onset_env = librosa.onset.onset_strength(y=audio, sr=SR, hop_length=HOP)
    onsets = librosa.onset.onset_detect(onset_envelope=onset_env, sr=SR, hop_length=HOP, units="time", backtrack=False)

    per_note, errors, faithful, heard_midi, sounding = [], [], [], [], []
    dry_cache = {}
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
        # the stretch of the fart this note plays: from the gesture's start, as long as it sounds
        start_sample = int(s * SR)
        g = gesture[e["source_id"]]
        n_samples = min(len(g), int(round(e["len_s"] * SR)))
        key = (e["source_id"], n_samples, start_sample % HOP)
        if key not in dry_cache:
            dry_cache[key] = dry_frames(g, start_sample % HOP, n_samples)
        first = start_sample // HOP - DRY_PAD // HOP  # the render frame of the dry read's frame 0
        off_fart = fart_cents(f_yin, sounding_frames(t, db, s, heard_len), dry_cache[key], first)
        faithful.append(off_fart is not None and abs(off_fart) <= FART_CENTS)
        retrigger_notes += has_reattack(audio[int(s * SR): int((s + heard_len) * SR)])
        # the note's whole slot: its written length less the gap before the next note
        slot = max(0.06, n.dur * spb - GAP_S)
        sounding.append(sounding_share(audio[int(s * SR): int(s * SR) + int(slot * SR)]))
        per_note.append({
            "i": e["note_index"],
            "target": int(e["target_midi"]),
            "cents": None if cents is None else round(cents),
            "fart_cents": None if off_fart is None else round(off_fart),
        })

    errors = np.array(errors)
    n_notes = len(events)
    # an octave error still carries the melody's shape but is reported separately
    pc_err = (errors + 600) % 1200 - 600 if len(errors) else errors
    note_starts = np.array([melody.notes[e["note_index"]].start * spb for e in events])
    matched = sum(1 for s in note_starts if len(onsets) and np.min(np.abs(onsets - s)) < 0.05)
    contour = contour_share([e["target_midi"] for e in events], heard_midi)
    return {
        "notes": n_notes,
        "within_50c_of_fart_pct": round(100 * sum(faithful) / n_notes),
        "onsets_on_time_pct": round(100 * matched / n_notes),
        "notes_with_retrigger": retrigger_notes,
        "pitch_readable_pct": round(100 * len(errors) / n_notes),
        "within_50c_pct": round(100 * np.sum(np.abs(errors) <= 50) / n_notes),
        "within_50c_any_octave_pct": round(100 * np.sum(np.abs(pc_err) <= 50) / n_notes),
        "median_abs_cents": round(float(np.median(np.abs(errors))), 1) if len(errors) else None,
        "contour_pct": None if contour is None else round(100 * contour),
        "distinct_recordings": len({e["source_id"] for e in events}),
        "on_pitch_pct": round(100 * on_pitch_share(audio, melody, events, bpm)),
        "sounding_pct": round(100 * float(np.mean(sounding))) if sounding else None,
        "notes_mostly_silent": sum(1 for x in sounding if x < 0.5),
        "per_note": per_note,
    }


def bar_problems(metrics, bar=BAR):
    """What keeps a render under the bar (empty when it passes)."""
    problems = []
    if metrics["within_50c_of_fart_pct"] < bar["within_50c_of_fart_pct"]:
        problems.append(f"in50cFart {metrics['within_50c_of_fart_pct']}% < {bar['within_50c_of_fart_pct']}%")
    if metrics["onsets_on_time_pct"] < bar["onsets_on_time_pct"]:
        problems.append(f"onTime {metrics['onsets_on_time_pct']}% < {bar['onsets_on_time_pct']}%")
    if metrics["notes_with_retrigger"] > bar["notes_with_retrigger"]:
        problems.append(f"{metrics['notes_with_retrigger']} notes re-attack")
    return problems
