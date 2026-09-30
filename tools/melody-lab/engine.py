"""Fart-only melody engine (proof).

Every sample in the output is a Recording's own waveform. The only operations are:
  trim to the detected sound, variable-rate resampling (pitch), fade in/out, gain, and mixing.
There is no oscillator, filter-resonator, looping, or granular re-triggering anywhere.
Each operation has a direct AVAudioEngine / Accelerate equivalent for the iOS port.
"""
import json
from dataclasses import dataclass, asdict
from pathlib import Path

import librosa
import numpy as np
import scipy.signal as sps
from scipy.ndimage import median_filter
from scipy.optimize import linear_sum_assignment

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "fixtures/recordings/manifest.json"
AUDIO_DIR = ROOT / "fixtures/recordings"
SR = 44100
HOP = 256
GAP_S = 0.025  # silence between consecutive notes (articulation)
MIN_PITCH_CONF = 0.1  # loose on purpose: audition() is the real gate


# ---------------------------------------------------------------- Recording Analysis


@dataclass
class Source:
    id: str
    cut_at_reattack: bool
    audio: np.ndarray  # the single-attack note segment (onset-aligned), mono float
    f0: np.ndarray  # per-hop smoothed f0 in Hz (nan = unvoiced) over `audio`
    ref_midi: float | None  # the pitch a listener hears in the first part of the sound
    pitch_confidence: float  # 0..1
    rms_db: float
    min_note_s: float = 0.0  # shortest note this Recording reads back on-pitch

    @property
    def pitched(self):
        return self.ref_midi is not None

    @property
    def seconds(self):
        return len(self.audio) / SR


def note_segment(y):
    """Find the single-attack part of a Recording that can act as one note.

    start: just before the level first gets within 12 dB of its peak, so slow swells don't
           make the note sound late.
    end:   the first clear re-attack (level dips >= 8 dB then rises >= 5 dB again), so one
           note never contains a second audible 'brrt'; otherwise where the sound fades out.
    """
    hop = int(0.005 * SR)
    fine = 20 * np.log10(librosa.feature.rms(y=y, frame_length=2 * hop, hop_length=hop)[0] + 1e-9)
    # 50 ms window: fast flutter (the 'brrrr' texture, > ~15 Hz) is smoothed away, so only
    # slow, clearly audible re-attacks (separate 'pft ... pft') count.
    db = 20 * np.log10(librosa.feature.rms(y=y, frame_length=10 * hop, hop_length=hop)[0] + 1e-9)
    peak = fine.max()
    a0 = int(np.argmax(fine >= peak - 12))
    start = max(0, a0 * hop - int(0.008 * SR))
    active = np.where(db > db.max() - 30)[0]
    end_i = active[-1] + 1
    run_max, dip_i, reattack_at = db[a0], None, None
    for i in range(a0 + 1, end_i):
        if db[i] > run_max and dip_i is None:
            run_max = db[i]
        if db[i] < run_max - 6:
            if dip_i is None or db[i] < db[dip_i]:
                dip_i = i
        if dip_i is not None and db[i] > db[dip_i] + 4 and (i - a0) * hop > 0.06 * SR:
            reattack_at = dip_i
            break
    end = (reattack_at if reattack_at is not None else end_i) * hop + hop
    return start, min(len(y), end), reattack_at is not None


def analyze_recording(rid, y):
    start, end, cut_at_reattack = note_segment(y)
    body = y[start:end].astype(np.float64)

    f0, voiced, vprob = librosa.pyin(body, fmin=45, fmax=900, sr=SR, frame_length=2048, hop_length=HOP)
    f0 = np.where(voiced & (vprob > 0.05), f0, np.nan)
    # smooth pitch contour and drop isolated blips
    finite = np.isfinite(f0)
    if finite.sum() >= 3:
        m = librosa.hz_to_midi(np.where(finite, f0, 1.0))
        m = np.where(finite, median_filter(np.where(finite, m, 0), size=5), np.nan)
        m = np.where(np.isfinite(m) & (m > 10), m, np.nan)
        f0 = librosa.midi_to_hz(m)
    # reference pitch: energy-weighted median of voiced frames in the first 450 ms
    head = min(len(f0), int(0.45 * SR / HOP))
    frame_rms = librosa.feature.rms(y=body, frame_length=2048, hop_length=HOP)[0][: len(f0)]
    v = np.isfinite(f0[:head])
    coverage = v.sum() / max(1, head if len(body) > 0.45 * SR else len(f0))
    ref_midi, conf = None, 0.0
    if v.sum() >= 4:
        mids = librosa.hz_to_midi(f0[:head][v])
        w = frame_rms[:head][v]
        order = np.argsort(mids)
        cw = np.cumsum(w[order]) / w.sum()
        med = mids[order][np.searchsorted(cw, 0.5)]
        spread = np.median(np.abs(mids - med))
        conf = float(np.clip(coverage, 0, 1) * np.clip(1 - spread / 3, 0, 1))
        if conf >= MIN_PITCH_CONF:
            ref_midi = float(med)
    src = Source(
        id=rid,
        cut_at_reattack=cut_at_reattack,
        audio=body,
        f0=f0,
        ref_midi=ref_midi,
        pitch_confidence=round(conf, 2),
        rms_db=float(20 * np.log10(np.sqrt(np.mean(body**2)) + 1e-9)),
    )
    if src.pitched:
        src.min_note_s = audition(src)
        if src.min_note_s is None:  # never reads back on pitch: not melodic after all
            src.ref_midi = None
    return src


def audition(src):
    """Play the Recording through the real render path at its own pitch for a few note
    lengths and read the pitch back. Returns the shortest note length (s) that still reads
    within 40 cents, or None. Catches farts whose pitch only settles after the attack."""
    for length in (0.12, 0.2, 0.35, 0.6):
        n = int(min(length, src.seconds) * SR)
        seg = variable_resample(src.audio, src.f0, 1.0, 1.0, n, src.ref_midi)
        f0, voiced, _ = librosa.pyin(seg, fmin=45, fmax=900, sr=SR, frame_length=2048, hop_length=HOP)
        f = f0[voiced & np.isfinite(f0)]
        if len(f) >= 2 and abs(np.median(librosa.hz_to_midi(f)) - src.ref_midi) * 100 <= 40:
            return length
        if length >= src.seconds:
            break
    return None


def load_library(ids=None):
    manifest = json.loads(MANIFEST.read_text())["recordings"]
    lib = []
    for r in manifest:
        if ids and r["id"] not in ids:
            continue
        y, _ = librosa.load(AUDIO_DIR / r["filename"], sr=SR, mono=True)
        lib.append(analyze_recording(r["id"], y))
    return lib


# ---------------------------------------------------------------- Melody Fit planning


@dataclass
class Assignment:
    note_index: int
    source_id: str
    target_midi: int
    shift_semitones: float


def shift_cost(s):
    a = abs(s)
    if a > 12:  # beyond an octave the fart stops sounding like itself
        return 1e6
    return a**1.5 + (4 * (a - 7) if a > 7 else 0)


def plan(melody, sources, variety=False, transpose=None):
    """Choose a key (transposition) and a Recording for each note.

    Key-zone mapping, like a multi-sampled instrument: each distinct melody pitch is played
    by the pitched Recording whose natural pitch is closest, so shifts stay small and the same
    note always sounds the same. A one-to-one assignment maximises how many different
    Recordings are used. `variety=True` rotates between the closest few Recordings on
    repeated notes instead.
    """
    pitched = [s for s in sources if s.pitched]
    if not pitched:
        raise ValueError("no Recording has a usable pitch")
    pitches = sorted({n.pitch for n in melody.notes})
    weight = {p: sum(n.dur for n in melody.notes if n.pitch == p) for p in pitches}
    spb = 60 / melody.bpm
    too_short = {  # notes at pitch p shorter than what Recording s can carry
        (p, s.id): sum(1 for n in melody.notes if n.pitch == p and n.dur * spb - GAP_S < s.min_note_s)
        for p in pitches
        for s in pitched
    }

    def solve(t):
        cols = pitched * (1 + len(pitches) // len(pitched))  # allow reuse when needed
        reuse = np.repeat(np.arange(1 + len(pitches) // len(pitched)), len(pitched))
        C = np.array(
            [
                [weight[p] * shift_cost(p + t - s.ref_midi) + 8.0 * too_short[p, s.id] + 2.0 * r for s, r in zip(cols, reuse)]
                for p in pitches
            ]
        )
        rows, cidx = linear_sum_assignment(C)
        return C[rows, cidx].sum(), {pitches[i]: cols[j] for i, j in zip(rows, cidx)}

    candidates = [transpose] if transpose is not None else range(-36, 25)
    best_t, (best_cost, zone) = min(((t, solve(t)) for t in candidates), key=lambda x: x[1][0])

    out = []
    counters = {}
    for i, n in enumerate(melody.notes):
        target = n.pitch + best_t
        src = zone[n.pitch]
        if variety:
            fits = [s for s in pitched if s.min_note_s <= n.dur * spb - GAP_S and abs(target - s.ref_midi) <= 7]
            near = sorted(fits, key=lambda s: shift_cost(target - s.ref_midi))[:3] or [src]
            k = counters.get(n.pitch, 0)
            counters[n.pitch] = k + 1
            src = near[k % len(near)]
        out.append(Assignment(i, src.id, target, round(target - src.ref_midi, 2)))
    return best_t, out


# ---------------------------------------------------------------- Rendering


def variable_resample(x, f0, ratio_const, tune, out_len, ref_midi):
    """Read `x` at a (possibly time-varying) rate. rate > 1 raises pitch.

    tune=0: constant rate (plain sampler transposition, keeps the fart's natural glide).
    tune=1: rate follows the Recording's own pitch contour so the note holds steady on target.
    """
    n_hops = len(f0)
    hop_rate = np.full(n_hops, ratio_const)
    if tune > 0 and ref_midi is not None:
        m = librosa.hz_to_midi(np.where(np.isfinite(f0), f0, 1.0))
        dev = np.where(np.isfinite(f0), ref_midi - m, np.nan)  # semitones to pull toward ref
        idx = np.arange(n_hops)
        ok = np.isfinite(dev)
        if ok.sum() >= 2:
            dev = np.interp(idx, idx[ok], dev[ok])
            dev = np.clip(dev, -5, 5)
            hop_rate = ratio_const * 2 ** (tune * dev / 12)
    # anti-alias when reading faster than 1x
    if hop_rate.max() > 1.02:
        b, a = sps.butter(8, min(0.95, 0.9 / hop_rate.max()), btype="low")
        x = sps.filtfilt(b, a, x)
    pos = np.zeros(out_len)
    p = 0.0
    for i in range(out_len):
        if p >= len(x) - 2:
            return _cubic_read(x, pos[:i])
        pos[i] = p
        p += hop_rate[min(n_hops - 1, int(p / HOP))]
    return _cubic_read(x, pos)


def _cubic_read(x, pos):
    i = np.floor(pos).astype(int)
    f = pos - i
    xm1 = x[np.clip(i - 1, 0, len(x) - 1)]
    x0 = x[np.clip(i, 0, len(x) - 1)]
    x1 = x[np.clip(i + 1, 0, len(x) - 1)]
    x2 = x[np.clip(i + 2, 0, len(x) - 1)]
    c1 = 0.5 * (x1 - xm1)
    c2 = xm1 - 2.5 * x0 + 2 * x1 - 0.5 * x2
    c3 = 0.5 * (x2 - xm1) + 1.5 * (x0 - x1)
    return ((c3 * f + c2) * f + c1) * f + x0


def render(melody, sources, assignments, tune=1.0, bpm=None, gap_ms=GAP_S * 1000, accent_db=1.5, target_rms_db=-20):
    by_id = {s.id: s for s in sources}
    bpm = bpm or melody.bpm
    spb = 60 / bpm
    total = int((melody.length_beats * spb + 1.0) * SR)
    mix = np.zeros(total)
    events = []
    for a in assignments:
        n = melody.notes[a.note_index]
        s = by_id[a.source_id]
        start = int(n.start * spb * SR)
        max_len = int(max(0.06, n.dur * spb - gap_ms / 1000) * SR)
        ratio = 2 ** (a.shift_semitones / 12)
        seg = variable_resample(s.audio, s.f0, ratio, tune, max_len, s.ref_midi)
        fi, fo = int(0.003 * SR), int(min(0.03, len(seg) / SR / 3) * SR)
        env = np.ones(len(seg))
        env[:fi] = np.linspace(0, 1, fi)
        if fo > 0:
            env[-fo:] *= np.linspace(1, 0, fo) ** 2
        seg = seg * env
        rms = np.sqrt(np.mean(seg[: int(0.25 * SR)] ** 2)) + 1e-9
        on_downbeat = abs((n.start / melody.beats_per_bar) - round(n.start / melody.beats_per_bar)) < 1e-6
        gain_db = target_rms_db - 20 * np.log10(rms) + (accent_db if on_downbeat else 0)
        seg = seg * 10 ** (gain_db / 20)
        mix[start : start + len(seg)] += seg
        events.append({**asdict(a), "start_s": round(start / SR, 3), "len_s": round(len(seg) / SR, 3), "gain_db": round(gain_db, 1)})
    peak = np.abs(mix).max()
    mix = np.tanh(mix / peak * 1.2) / np.tanh(1.2) * 0.89  # gentle limiter, -1 dBFS peak
    return mix, events


# ---------------------------------------------------------------- Naive baseline (for contrast)


def render_naive(melody, sources, bpm=None):
    """What 'place raw recordings on notes' does without analysis: file start on the beat,
    no trimming, no pitch. Kept only to show why the melody disappears."""
    manifest = {r["id"]: r for r in json.loads(MANIFEST.read_text())["recordings"]}
    spb = 60 / (bpm or melody.bpm)
    mix = np.zeros(int((melody.length_beats * spb + 2) * SR))
    ids = [s.id for s in sources]
    for i, n in enumerate(melody.notes):
        y, _ = librosa.load(AUDIO_DIR / manifest[ids[i % len(ids)]]["filename"], sr=SR, mono=True)
        y = y[: int(n.dur * spb * SR)]
        st = int(n.start * spb * SR)
        mix[st : st + len(y)] += y / (np.abs(y).max() + 1e-9) * 0.3
    return mix / np.abs(mix).max() * 0.89
