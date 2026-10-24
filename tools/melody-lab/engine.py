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
MIN_PITCH_CONF = 0.2  # loose on purpose: audition() is the real gate (#208 raised it from 0.1)
FAR_FROM_CENTER = 6.0  # semitones: contour frames farther than this from the gesture's center are dropped (#208)


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
    settle_s: float = 0.0  # when its played pitch settles within 50 cents of ref_midi (settle_time())
    start: int = 0  # gesture start, in samples of the decoded original file
    end: int = 0  # gesture end (exclusive), in samples of the decoded original file
    pitch_estimate: float | None = None  # ref_midi before audition() (kept when audition rejects it)

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


def weighted_median(mids, w):
    """The pitch below which half the weight lies."""
    order = np.argsort(mids)
    cw = np.cumsum(w[order]) / w.sum()
    return mids[order][np.searchsorted(cw, 0.5)]


def analyze_recording(rid, y):
    start, end, cut_at_reattack = note_segment(y)
    body = y[start:end].astype(np.float64)

    # Every frame pYIN calls voiced, attack included. A voiced-probability gate on top (0.05
    # until #208) dropped most attacks, so the renderer bent each note in from the attack's pitch.
    f0, voiced, _ = librosa.pyin(body, fmin=45, fmax=900, sr=SR, frame_length=2048, hop_length=HOP)
    f0 = np.where(voiced, f0, np.nan)
    frame_rms = librosa.feature.rms(y=body, frame_length=2048, hop_length=HOP)[0][: len(f0)]
    # smooth pitch contour and drop isolated blips
    finite = np.isfinite(f0)
    if finite.sum() >= 3:
        m = librosa.hz_to_midi(np.where(finite, f0, 1.0))
        m = np.where(finite, median_filter(np.where(finite, m, 0), size=5), np.nan)
        m = np.where(np.isfinite(m) & (m > 10), m, np.nan)
        # drop octave errors and glide tails, which the renderer would bend toward
        kept = np.isfinite(m)
        if kept.sum() >= 3:
            center = weighted_median(m[kept], frame_rms[kept])
            m = np.where(np.abs(m - center) > FAR_FROM_CENTER, np.nan, m)
        f0 = librosa.midi_to_hz(m)
    # reference pitch: energy-weighted median of voiced frames in the first 450 ms
    head = min(len(f0), int(0.45 * SR / HOP))
    v = np.isfinite(f0[:head])
    coverage = v.sum() / max(1, head if len(body) > 0.45 * SR else len(f0))
    ref_midi, conf = None, 0.0
    if v.sum() >= 4:
        mids = librosa.hz_to_midi(f0[:head][v])
        w = frame_rms[:head][v]
        med = weighted_median(mids, w)
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
        start=start,
        end=end,
        pitch_estimate=ref_midi,
    )
    if src.pitched:
        src.min_note_s = audition(src)
        if src.min_note_s is None:  # never reads back on pitch: not melodic after all
            src.ref_midi = None
        else:
            src.settle_s = settle_time(src)
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


SETTLE_CENTS = 50.0  # "on pitch", as evaluate.py counts a note
SETTLE_RUN_FRAMES = 9  # 9 hops = 52 ms in a row on pitch


def heard_cents(src):
    """The whole gesture played through the real render path at its own pitch (as audition()
    does) and read back by pYIN: cents from ref_midi per hop, nan where unvoiced."""
    seg = variable_resample(src.audio, src.f0, 1.0, 1.0, len(src.audio), src.ref_midi)
    f0, voiced, _ = librosa.pyin(seg, fmin=45, fmax=900, sr=SR, frame_length=2048, hop_length=HOP)
    ok = voiced & np.isfinite(f0)
    return np.where(ok, (librosa.hz_to_midi(np.where(ok, f0, 1.0)) - src.ref_midi) * 100, np.nan)


def settle_time(src):
    """Seconds from the gesture start until the Recording, played at its own pitch, is on pitch
    and stays there: the first pYIN frame (centered at frame x 256 samples) that starts
    SETTLE_RUN_FRAMES voiced frames in a row within SETTLE_CENTS of ref_midi. The Recording's
    whole length if that never happens. Glides, scoops and slow starts that the renderer's
    pitch-following can't straighten show up here; an Octave Move scales it by 2^(-shift/12)."""
    heard = heard_cents(src)
    on = np.abs(np.nan_to_num(heard, nan=np.inf)) <= SETTLE_CENTS
    for i in range(len(on) - SETTLE_RUN_FRAMES + 1):
        if on[i : i + SETTLE_RUN_FRAMES].all():
            return min(src.seconds, i * HOP / SR)
    return src.seconds


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

MAX_SHIFT = 3.0  # semitones a Recording may be moved from its Recording Pitch (ADR 0004) ...
OCTAVE = 12.0  # ... or from the same note an octave up or down, with an Octave Move (ADR 0006)
OCTAVE_MOVE_COST = 6.0  # per beat, on top of the remaining shift: more than any real-pitch move (3^1.5 = 5.2)
TOO_SHORT_COST = 8.0  # per note that sounds too briefly for the Recording to settle on its pitch ...
TOO_SHORT_COST_PER_S = 400.0  # ... plus this per second it falls short (4 per 10 ms)
TIE = 1e-9  # Arrangement costs this close are equal
TRANSPOSITIONS = range(-36, 25)


def too_short_cost(note_seconds, recording_seconds, shortest_note_s, shift):
    """Cost of the notes a Recording plays too briefly to settle on its pitch.

    A note sounds for its own length (minus the gap before the next note) or for the
    Recording's length after resampling `shift` semitones, whichever is shorter: an Octave
    Move up halves a Recording's length. Below the Recording's shortest note (`audition()`),
    each note costs TOO_SHORT_COST plus TOO_SHORT_COST_PER_S per second it falls short.
    """
    played = recording_seconds * 2 ** (-shift / 12)
    cost = 0.0
    for a in note_seconds:
        sounds = min(a, played)
        if sounds < shortest_note_s:
            cost += TOO_SHORT_COST + TOO_SHORT_COST_PER_S * (shortest_note_s - sounds)
    return cost


UNSETTLED_COST = 20.0  # per note played entirely before its Recording settles; less for part of it (#92)


def unsettled_cost(note_seconds, recording_seconds, settle_s, shift):
    """Cost of the share of each note a Recording plays before its pitch settles (#92).

    A note sounds for min(its length, the Recording's resampled length), as in too_short_cost().
    The Recording settles settle_s (settle_time()) after it starts, also scaled by resampling.
    Each note costs UNSETTLED_COST x the share of its sounding time that comes before that: a
    short note on a slow-settling fart costs up to UNSETTLED_COST, the same fart on a long note
    costs little. Picked from 15, 20, 30, 40, 80 and 160 (and per-second forms) by renders
    passing; 40 and above make a full-library Song worse.
    """
    played = recording_seconds * 2 ** (-shift / 12)
    settle = settle_s * 2 ** (-shift / 12)
    cost = 0.0
    for a in note_seconds:
        sounds = min(a, played)
        cost += UNSETTLED_COST * min(sounds, settle) / max(1e-9, sounds)
    return cost


@dataclass
class Assignment:
    note_index: int
    source_id: str
    target_midi: int
    shift_semitones: float


def move_cost(shift, octave_moves=True):
    """Cost per beat of playing a note `shift` semitones from the Recording Pitch, and
    whether that is an Octave Move. None when the unlock rule doesn't allow it.

    Octave Moves go up or down on equal terms. Allowing only up, or down only as a last
    resort, unlocked fewer Songs or passed the render checks less often (ADR 0006)."""
    a = abs(shift)
    if a <= MAX_SHIFT:
        return a**1.5, False
    if octave_moves and abs(a - OCTAVE) <= MAX_SHIFT:
        return OCTAVE_MOVE_COST + abs(a - OCTAVE) ** 1.5, True
    return None


@dataclass
class Fit:
    """Melody Fit: which Melodic Recording plays each distinct Song pitch, and its cost.

    Arrangements compare by (uncovered pitches, Octave Moves, cost), smallest first: as much
    Pitch Coverage as possible, then as few Octave Moves as that allows, then the closest
    shifts. Costs within TIE are equal; then the Recording ids read in ascending Song pitch
    order (uncovered last) decide, then the lower transposition."""

    transpose: int
    recording_for_pitch: dict  # Song pitch -> Recording id, or None when no Recording covers it
    octave_moves: int
    cost: float  # over covered pitches: beats x move_cost + too_short_cost + unsettled_cost of its notes

    @property
    def covered(self):
        return sum(r is not None for r in self.recording_for_pitch.values())

    @property
    def total(self):
        return len(self.recording_for_pitch)

    @property
    def unlocked(self):
        return self.covered == self.total

    @property
    def missing(self):
        """The notes (MIDI, after transposition) that no Recording covers."""
        return [p + self.transpose for p, r in sorted(self.recording_for_pitch.items()) if r is None]


def melody_fit(melody, sources, transpose=None, octave_moves=True):
    """Pitch Coverage and Auto-map in one search (ADR 0004, ADR 0006).

    Like a multi-sampled instrument: each distinct Song pitch gets its own Melodic Recording
    (one to one, never reused), moved at most 3 semitones, or with an Octave Move at most 3
    semitones from the same note an octave away. Every transposition from -36 to +24 is
    tried. A Song is unlocked when every pitch is covered under the best transposition.
    `octave_moves=False` gives ADR 0004's rule without Octave Moves, for comparison.
    """
    pitched = sorted((s for s in sources if s.pitched), key=lambda s: s.id)
    pitches = sorted({n.pitch for n in melody.notes})
    spb = 60 / melody.bpm
    weight = {p: sum(n.dur for n in melody.notes if n.pitch == p) for p in pitches}
    note_seconds = {p: [n.dur * spb - GAP_S for n in melody.notes if n.pitch == p] for p in pitches}

    def cells(t):  # cells[i][j]: (Octave Move?, cost) of pitch i on Recording j, or None
        out = []
        for p in pitches:
            row = []
            for s in pitched:
                shift = p + t - s.ref_midi
                m = move_cost(shift, octave_moves)
                if m is None:
                    row.append(None)
                else:
                    row.append((m[1], weight[p] * m[0] + too_short_cost(note_seconds[p], s.seconds, s.min_note_s, shift)
                                + unsettled_cost(note_seconds[p], s.seconds, s.settle_s, shift)))
            out.append(row)
        return out

    def key(table, choice):  # exact (uncovered, Octave Moves, cost), summed in pitch order
        uncovered = octaves = 0
        cost = 0.0
        for row, j in zip(table, choice):
            if j is None:
                uncovered += 1
            else:
                octaves += row[j][0]
                cost += row[j][1]
        return uncovered, octaves, cost

    def solve(table, fixed=()):
        """Best choice for the pitches after `fixed` (Recording indexes or None, in pitch
        order), as one assignment problem: penalties larger than any cost make it minimise
        uncovered pitches first, then Octave Moves, then cost."""
        rows = table[len(fixed) :]
        cols = [j for j in range(len(pitched)) if j not in fixed]
        bound = sum(max((c[1] for c in row if c is not None), default=0.0) for row in rows)
        octave_penalty = 1.0 + bound
        uncovered_penalty = (len(rows) + 1) * octave_penalty
        C = np.full((len(rows), len(cols) + len(rows)), np.inf)
        for i, row in enumerate(rows):
            for k, j in enumerate(cols):
                if row[j] is not None:
                    C[i, k] = row[j][1] + (octave_penalty if row[j][0] else 0.0)
            C[i, len(cols) + i] = uncovered_penalty  # this pitch stays uncovered
        choice = list(fixed)
        if rows:
            r, c = linear_sum_assignment(C)
            picked = dict(zip(r, c))
            choice += [cols[picked[i]] if picked[i] < len(cols) else None for i in range(len(rows))]
        return key(table, choice), choice

    tables = {t: cells(t) for t in ([transpose] if transpose is not None else TRANSPOSITIONS)}
    best = {t: solve(table)[0] for t, table in tables.items()}
    top = min(k[:2] for k in best.values())
    low = min(k[2] for k in best.values() if k[:2] == top)

    def optimal(k):
        return k[:2] == top and k[2] <= low + TIE

    def smallest_ids(table):  # the lexicographically smallest optimal choice, uncovered last
        fixed = []
        for i in range(len(pitches)):
            for j in sorted(set(range(len(pitched))) - set(fixed), key=lambda j: pitched[j].id) + [None]:
                if j is not None and table[i][j] is None:
                    continue
                if optimal(solve(table, fixed + [j])[0]):
                    fixed.append(j)
                    break
        return fixed

    fits = []
    for t, k in best.items():
        if optimal(k):
            choice = smallest_ids(tables[t])
            ids = tuple(pitched[j].id if j is not None else "￿" for j in choice)
            fits.append((ids, t, choice))
    _, t, choice = min(fits)
    _, octaves, cost = key(tables[t], choice)
    return Fit(
        transpose=t,
        recording_for_pitch={p: (pitched[j].id if j is not None else None) for p, j in zip(pitches, choice)},
        octave_moves=octaves,
        cost=float(cost),
    )


class SongLocked(ValueError):
    """The Recordings don't cover every pitch of the Song, so it can't be played."""

    def __init__(self, fit):
        super().__init__(f"{fit.covered} of {fit.total} notes covered")
        self.fit = fit


def plan(melody, sources, transpose=None, with_cost=False):
    """Choose a key (transposition) and a Recording for each note of an Unlocked Song.

    Every note of a Song pitch uses that pitch's Recording, so the same note always sounds
    the same. Raises SongLocked when the Song isn't unlocked. `with_cost=True` also returns
    the Arrangement's cost (used by the golden export).
    """
    fit = melody_fit(melody, sources, transpose)
    if not fit.unlocked:
        raise SongLocked(fit)
    ref = {s.id: s.ref_midi for s in sources}
    out = []
    for i, n in enumerate(melody.notes):
        target = n.pitch + fit.transpose
        rid = fit.recording_for_pitch[n.pitch]
        out.append(Assignment(i, rid, target, round(target - ref[rid], 2)))
    return (fit.transpose, out, fit.cost) if with_cost else (fit.transpose, out)


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
