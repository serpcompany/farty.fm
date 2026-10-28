import math
from dataclasses import asdict, dataclass, field

import librosa
import numpy as np
from scipy.optimize import linear_sum_assignment

from analysis import AUDIO_DIR, SR, read_manifest

GAP_S = 0.025
MAX_SHIFT = 3.0
OCTAVE = 12.0
OCTAVE_MOVE_COST = 6.0
TOO_SHORT_COST = 8.0
TOO_SHORT_COST_PER_S = 400.0
UNSETTLED_COST = 20.0
SILENT_COST_PER_S = 30.0
NOTE_FILL = 1.0
TIE = 1e-9
TRANSPOSITIONS = range(-36, 25)
UNCOVERED_LAST = "￿"


def too_short_cost(note_seconds, recording_seconds, shortest_note_s):
    cost = 0.0
    for a in note_seconds:
        sounds = min(a, recording_seconds)
        if sounds < shortest_note_s:
            cost += TOO_SHORT_COST + TOO_SHORT_COST_PER_S * (shortest_note_s - sounds)
    return cost


def unsettled_cost(note_seconds, recording_seconds, settle_s):
    cost = 0.0
    for a in note_seconds:
        sounds = min(a, recording_seconds)
        cost += UNSETTLED_COST * min(sounds, settle_s) / max(1e-9, sounds)
    return cost


def silent_cost(note_seconds, recording_seconds):
    return SILENT_COST_PER_S * sum(max(0.0, a - recording_seconds) for a in note_seconds)


def fills(recording_seconds, longest_note_s):
    return recording_seconds >= NOTE_FILL * longest_note_s


def needed_seconds(longest_note_s):
    return math.ceil(NOTE_FILL * longest_note_s * 10 - 1e-9) / 10


def move_cost(shift, octave_moves=True):
    a = abs(shift)
    if a <= MAX_SHIFT:
        return a**1.5, False
    if octave_moves and abs(a - OCTAVE) <= MAX_SHIFT:
        return OCTAVE_MOVE_COST + abs(a - OCTAVE) ** 1.5, True
    return None


@dataclass
class Assignment:
    note_index: int
    source_id: str
    target_midi: int
    shift_semitones: float


@dataclass
class Fit:
    transpose: int
    recording_for_pitch: dict
    octave_moves: int
    cost: float
    longest_note_s: dict = field(default_factory=dict)

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
        return [
            (p + self.transpose, needed_seconds(self.longest_note_s[p]))
            for p, r in sorted(self.recording_for_pitch.items())
            if r is None
        ]


@dataclass
class SongPitches:
    pitches: list
    weight: dict
    note_seconds: dict
    longest: dict


def song_pitches(melody):
    pitches = sorted({n.pitch for n in melody.notes})
    spb = 60 / melody.bpm
    weight = {p: sum(n.dur for n in melody.notes if n.pitch == p) for p in pitches}
    note_seconds = {p: [n.dur * spb - GAP_S for n in melody.notes if n.pitch == p] for p in pitches}
    return SongPitches(pitches, weight, note_seconds, {p: max(note_seconds[p]) for p in pitches})


def pitch_cell(song, p, transpose, s, octave_moves):
    m = move_cost(p + transpose - s.ref_midi, octave_moves)
    if m is None or not fills(s.seconds, song.longest[p]):
        return None
    notes = song.note_seconds[p]
    return (m[1], song.weight[p] * m[0] + too_short_cost(notes, s.seconds, s.min_note_s)
            + unsettled_cost(notes, s.seconds, s.settle_s)
            + silent_cost(notes, s.seconds))


def cost_table(song, pitched, transpose, octave_moves):
    return [[pitch_cell(song, p, transpose, s, octave_moves) for s in pitched] for p in song.pitches]


def arrangement_key(table, choice):
    uncovered = octaves = 0
    cost = 0.0
    for row, j in zip(table, choice, strict=True):
        if j is None:
            uncovered += 1
        else:
            octaves += row[j][0]
            cost += row[j][1]
    return uncovered, octaves, cost


def solve(table, n_recordings, fixed=()):
    rows = table[len(fixed) :]
    cols = [j for j in range(n_recordings) if j not in fixed]
    bound = sum(max((c[1] for c in row if c is not None), default=0.0) for row in rows)
    octave_penalty = 1.0 + bound
    uncovered_penalty = (len(rows) + 1) * octave_penalty
    costs = np.full((len(rows), len(cols) + len(rows)), np.inf)
    for i, row in enumerate(rows):
        for k, j in enumerate(cols):
            if row[j] is not None:
                costs[i, k] = row[j][1] + (octave_penalty if row[j][0] else 0.0)
        costs[i, len(cols) + i] = uncovered_penalty
    choice = list(fixed)
    if rows:
        r, c = linear_sum_assignment(costs)
        picked = dict(zip(r, c, strict=True))
        choice += [cols[picked[i]] if picked[i] < len(cols) else None for i in range(len(rows))]
    return arrangement_key(table, choice), choice


def smallest_ids(table, pitched, optimal):
    fixed = []
    for i in range(len(table)):
        free = sorted(set(range(len(pitched))) - set(fixed), key=lambda j: pitched[j].id)
        for j in [*free, None]:
            if j is not None and table[i][j] is None:
                continue
            if optimal(solve(table, len(pitched), [*fixed, j])[0]):
                fixed.append(j)
                break
    return fixed


def melody_fit(melody, sources, transpose=None, octave_moves=True):
    pitched = sorted((s for s in sources if s.pitched), key=lambda s: s.id)
    song = song_pitches(melody)
    transpositions = [transpose] if transpose is not None else TRANSPOSITIONS
    tables = {t: cost_table(song, pitched, t, octave_moves) for t in transpositions}
    best = {t: solve(table, len(pitched))[0] for t, table in tables.items()}
    top = min(k[:2] for k in best.values())
    low = min(k[2] for k in best.values() if k[:2] == top)

    def optimal(k):
        return k[:2] == top and k[2] <= low + TIE

    fits = []
    for t, k in best.items():
        if optimal(k):
            choice = smallest_ids(tables[t], pitched, optimal)
            ids = tuple(pitched[j].id if j is not None else UNCOVERED_LAST for j in choice)
            fits.append((ids, t, choice))
    _, t, choice = min(fits)
    _, octaves, cost = arrangement_key(tables[t], choice)
    return Fit(
        transpose=t,
        recording_for_pitch={p: (pitched[j].id if j is not None else None) for p, j in zip(song.pitches, choice, strict=True)},
        octave_moves=octaves,
        cost=float(cost),
        longest_note_s=song.longest,
    )


class SongLocked(ValueError):
    def __init__(self, fit):
        super().__init__(f"{fit.covered} of {fit.total} notes covered")
        self.fit = fit


def plan(melody, sources, transpose=None, with_cost=False):
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


def faded(seg):
    fi, fo = int(0.003 * SR), int(min(0.03, len(seg) / SR / 3) * SR)
    env = np.ones(len(seg))
    env[:fi] = np.linspace(0, 1, fi)
    if fo > 0:
        env[-fo:] *= np.linspace(1, 0, fo) ** 2
    return seg * env


def soft_limited(mix):
    peak = np.abs(mix).max()
    return np.tanh(mix / peak * 1.2) / np.tanh(1.2) * 0.89


def render(melody, sources, assignments, bpm=None, gap_ms=GAP_S * 1000, accent_db=1.5, target_rms_db=-20):
    by_id = {s.id: s for s in sources}
    spb = 60 / (bpm or melody.bpm)
    mix = np.zeros(int((melody.length_beats * spb + 1.0) * SR))
    events = []
    for a in assignments:
        n = melody.notes[a.note_index]
        start = int(n.start * spb * SR)
        max_len = int(max(0.06, n.dur * spb - gap_ms / 1000) * SR)
        seg = faded(by_id[a.source_id].audio[:max_len].copy())
        rms = np.sqrt(np.mean(seg[: int(0.25 * SR)] ** 2)) + 1e-9
        on_bar_line = any(abs(n.start - line) < 1e-6 for line in melody.bar_lines)
        gain_db = target_rms_db - 20 * np.log10(rms) + (accent_db if on_bar_line else 0)
        seg = seg * 10 ** (gain_db / 20)
        mix[start : start + len(seg)] += seg
        events.append({**asdict(a), "start_s": round(start / SR, 3), "len_s": round(len(seg) / SR, 3), "gain_db": round(gain_db, 1)})
    return soft_limited(mix), events


def render_naive(melody, sources, bpm=None):
    manifest = {r["id"]: r for r in read_manifest()}
    spb = 60 / (bpm or melody.bpm)
    mix = np.zeros(int((melody.length_beats * spb + 2) * SR))
    ids = [s.id for s in sources]
    for i, n in enumerate(melody.notes):
        y, _ = librosa.load(AUDIO_DIR / manifest[ids[i % len(ids)]]["filename"], sr=SR, mono=True)
        y = y[: int(n.dur * spb * SR)]
        st = int(n.start * spb * SR)
        mix[st : st + len(y)] += y / (np.abs(y).max() + 1e-9) * 0.3
    return mix / np.abs(mix).max() * 0.89
