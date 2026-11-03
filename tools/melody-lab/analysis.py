import json
from dataclasses import dataclass, field
from pathlib import Path

import librosa
import numpy as np
import scipy.signal as sps
from scipy.ndimage import median_filter

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "fixtures/recordings/manifest.json"
AUDIO_DIR = ROOT / "fixtures/recordings"
SR = 44100
HOP = 256
PYIN = {"fmin": 45, "fmax": 900, "sr": SR, "frame_length": 2048, "hop_length": HOP}

LEVEL_HOP_S = 0.005
LEVEL_HOP = int(LEVEL_HOP_S * SR)
ONSET_BELOW_PEAK_DB = 12
PRE_ROLL_S = 0.008
SOUND_BELOW_PEAK_DB = 30
REATTACK_DIP_DB = 6
REATTACK_RISE_DB = 4
REATTACK_AFTER_S = 0.06
LEAD_IN_GAP_S = 0.05
LEAD_IN_MAX_S = 0.25

MIN_PITCH_CONF = 0.2
FAR_FROM_CENTER = 6.0
PITCH_WINDOW_S = 0.45
AUDITION_LENGTHS_S = (0.12, 0.2, 0.35, 0.6)
AUDITION_CENTS = 40
SETTLE_CENTS = 50.0
SETTLE_RUN_FRAMES = 9
MAX_PULL_SEMITONES = 5


@dataclass
class Source:
    id: str
    cut_at_reattack: bool
    audio: np.ndarray
    f0: np.ndarray
    ref_midi: float | None
    pitch_confidence: float
    rms_db: float
    min_note_s: float = 0.0
    settle_s: float = 0.0
    start: int = 0
    end: int = 0
    pitch_estimate: float | None = None
    pitch_end: int = 0
    lead_in: np.ndarray = field(default_factory=lambda: np.zeros(0))

    @property
    def pitched(self):
        return self.ref_midi is not None

    @property
    def seconds(self):
        return len(self.audio) / SR

    @property
    def pitch_audio(self):
        return self.audio[: max(0, self.pitch_end - self.start)]


def level_db(y, frame_length):
    return 20 * np.log10(librosa.feature.rms(y=y, frame_length=frame_length, hop_length=LEVEL_HOP)[0] + 1e-9)


def note_segment(y):
    fine = level_db(y, 2 * LEVEL_HOP)
    smoothed = level_db(y, 10 * LEVEL_HOP)
    a0 = int(np.argmax(fine >= fine.max() - ONSET_BELOW_PEAK_DB))
    start = max(0, a0 * LEVEL_HOP - int(PRE_ROLL_S * SR))
    end_i = np.where(smoothed > smoothed.max() - SOUND_BELOW_PEAK_DB)[0][-1] + 1
    run_max, dip_i, reattack_at = smoothed[a0], None, None
    for i in range(a0 + 1, end_i):
        if smoothed[i] > run_max and dip_i is None:
            run_max = smoothed[i]
        if smoothed[i] < run_max - REATTACK_DIP_DB and (dip_i is None or smoothed[i] < smoothed[dip_i]):
            dip_i = i
        rises = dip_i is not None and smoothed[i] > smoothed[dip_i] + REATTACK_RISE_DB
        if rises and (i - a0) * LEVEL_HOP > REATTACK_AFTER_S * SR:
            reattack_at = dip_i
            break
    end = min(len(y), end_i * LEVEL_HOP + LEVEL_HOP)
    pitch_end = min(end, reattack_at * LEVEL_HOP + LEVEL_HOP) if reattack_at is not None else end
    return start, end, pitch_end, reattack_at is not None


def lead_in_start(y, start):
    fine = level_db(y, 2 * LEVEL_HOP)
    peak = fine.max()
    attack = int(np.argmax(fine >= peak - ONSET_BELOW_PEAK_DB))
    first, below = attack, 0
    for i in range(attack - 1, -1, -1):
        if fine[i] >= peak - SOUND_BELOW_PEAK_DB:
            first, below = i, 0
        else:
            below += 1
            if below > round(LEAD_IN_GAP_S / LEVEL_HOP_S):
                break
    return min(start, max(0, first * LEVEL_HOP - int(PRE_ROLL_S * SR), start - int(LEAD_IN_MAX_S * SR)))


def weighted_median(mids, w):
    order = np.argsort(mids)
    cw = np.cumsum(w[order]) / w.sum()
    return mids[order][np.searchsorted(cw, 0.5)]


def voiced_f0(y):
    f0, voiced, _ = librosa.pyin(y, **PYIN)
    return f0, voiced


def smoothed_contour(f0, frame_rms):
    finite = np.isfinite(f0)
    if finite.sum() < 3:
        return f0
    m = librosa.hz_to_midi(np.where(finite, f0, 1.0))
    m = np.where(finite, median_filter(np.where(finite, m, 0), size=5), np.nan)
    m = np.where(np.isfinite(m) & (m > 10), m, np.nan)
    kept = np.isfinite(m)
    if kept.sum() >= 3:
        center = weighted_median(m[kept], frame_rms[kept])
        m = np.where(np.abs(m - center) > FAR_FROM_CENTER, np.nan, m)
    return librosa.midi_to_hz(m)


def estimate_pitch(f0, frame_rms, n_body, a):
    window = int(PITCH_WINDOW_S * SR / HOP)
    end = min(len(f0), a + window)
    v = np.isfinite(f0[a:end])
    coverage = v.sum() / max(1, window if n_body > PITCH_WINDOW_S * SR else len(f0))
    if v.sum() < 4:
        return None, 0.0
    mids = librosa.hz_to_midi(f0[a:end][v])
    med = weighted_median(mids, frame_rms[a:end][v])
    spread = np.median(np.abs(mids - med))
    conf = float(np.clip(coverage, 0, 1) * np.clip(1 - spread / 3, 0, 1))
    return (float(med) if conf >= MIN_PITCH_CONF else None), conf


def recording_pitch(f0, frame_rms, n_body):
    head = estimate_pitch(f0, frame_rms, n_body, 0)
    kept = np.flatnonzero(np.isfinite(f0))
    if head[0] is not None or not len(kept) or kept[0] == 0:
        return head
    later = estimate_pitch(f0, frame_rms, n_body, int(kept[0]))
    return later if later[0] is not None else head


def analyze_recording(rid, y):
    start, end, pitch_end, cut_at_reattack = note_segment(y)
    fart = y[start:end].astype(np.float64)
    body = fart[: pitch_end - start]
    f0, voiced = voiced_f0(body)
    f0 = np.where(voiced, f0, np.nan)
    frame_rms = librosa.feature.rms(y=body, frame_length=2048, hop_length=HOP)[0][: len(f0)]
    f0 = smoothed_contour(f0, frame_rms)
    ref_midi, conf = recording_pitch(f0, frame_rms, len(body))
    src = Source(
        id=rid,
        cut_at_reattack=cut_at_reattack,
        audio=fart,
        f0=f0,
        ref_midi=ref_midi,
        pitch_confidence=round(conf, 2),
        rms_db=float(20 * np.log10(np.sqrt(np.mean(fart**2)) + 1e-9)),
        start=start,
        end=end,
        pitch_estimate=ref_midi,
        pitch_end=pitch_end,
        lead_in=y[lead_in_start(y, start) : start].astype(np.float64),
    )
    if src.pitched:
        src.min_note_s = audition(src)
        if src.min_note_s is None:
            src.ref_midi = None
        else:
            src.settle_s = settle_time(src)
    return src


def audition(src):
    body = src.pitch_audio
    seconds = len(body) / SR
    for length in AUDITION_LENGTHS_S:
        n = int(min(length, seconds) * SR)
        f0, voiced = voiced_f0(variable_resample(body, src.f0, n, src.ref_midi))
        f = f0[voiced & np.isfinite(f0)]
        if len(f) >= 2 and abs(np.median(librosa.hz_to_midi(f)) - src.ref_midi) * 100 <= AUDITION_CENTS:
            return length
        if length >= seconds:
            break
    return None


def heard_cents(src):
    body = src.pitch_audio
    f0, voiced = voiced_f0(variable_resample(body, src.f0, len(body), src.ref_midi))
    ok = voiced & np.isfinite(f0)
    return np.where(ok, (librosa.hz_to_midi(np.where(ok, f0, 1.0)) - src.ref_midi) * 100, np.nan)


def settle_time(src):
    seconds = len(src.pitch_audio) / SR
    on = np.abs(np.nan_to_num(heard_cents(src), nan=np.inf)) <= SETTLE_CENTS
    for i in range(len(on) - SETTLE_RUN_FRAMES + 1):
        if on[i : i + SETTLE_RUN_FRAMES].all():
            return min(seconds, i * HOP / SR)
    return seconds


def read_manifest():
    return json.loads(MANIFEST.read_text(encoding="utf-8"))["recordings"]


def load_library(ids=None):
    lib = []
    for r in read_manifest():
        if ids and r["id"] not in ids:
            continue
        y, _ = librosa.load(AUDIO_DIR / r["filename"], sr=SR, mono=True)
        lib.append(analyze_recording(r["id"], y))
    return lib


def anti_aliased(x, fastest_rate):
    if fastest_rate <= 1.02:
        return x
    b, a = sps.butter(8, min(0.95, 0.9 / fastest_rate), btype="low")
    return sps.filtfilt(b, a, x)


def hop_rates(f0, ref_midi):
    n_hops = len(f0)
    if ref_midi is None:
        return np.full(n_hops, 1.0)
    m = librosa.hz_to_midi(np.where(np.isfinite(f0), f0, 1.0))
    pull = np.where(np.isfinite(f0), ref_midi - m, np.nan)
    idx = np.arange(n_hops)
    ok = np.isfinite(pull)
    if ok.sum() < 2:
        return np.full(n_hops, 1.0)
    pull = np.clip(np.interp(idx, idx[ok], pull[ok]), -MAX_PULL_SEMITONES, MAX_PULL_SEMITONES)
    return 2 ** (pull / 12)


def variable_resample(x, f0, out_len, ref_midi):
    hop_rate = hop_rates(f0, ref_midi)
    x = anti_aliased(x, hop_rate.max())
    pos = np.zeros(out_len)
    p = 0.0
    for i in range(out_len):
        if p >= len(x) - 2:
            return cubic_read(x, pos[:i])
        pos[i] = p
        p += hop_rate[min(len(f0) - 1, int(p / HOP))]
    return cubic_read(x, pos)


def cubic_read(x, pos):
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
