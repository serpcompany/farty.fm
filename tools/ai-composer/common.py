"""Shared parts of the AI Song Creator candidates (#21).

Every candidate writes a melody using only a *palette*: a few pitches in one key, each
played by its own Melodic Recording shifted by at most 3 semitones (ADR 0004's rule). The
melody lab's engine then renders it (trim, resample, fade, gain, mix only) and its
evaluate() reads it back.
"""
import sys
import zlib
from dataclasses import dataclass, field, asdict
from pathlib import Path

import numpy as np
from scipy.optimize import linear_sum_assignment

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "melody-lab"))
import engine  # noqa: E402
from evaluate import evaluate  # noqa: E402
from melody import Melody, Note  # noqa: E402

MOODS = ["happy", "silly", "spooky", "epic"]
BARS = {"short": 4, "long": 8}
MAX_SHIFT = 3.0
WINDOW = 12  # palette span in semitones: one octave, so leaps stay singable

SCALES = {
    "major": [0, 2, 4, 5, 7, 9, 11],
    "major pentatonic": [0, 2, 4, 7, 9],
    "mixolydian": [0, 2, 4, 5, 7, 9, 10],
    "natural minor": [0, 2, 3, 5, 7, 8, 10],
    "harmonic minor": [0, 2, 3, 5, 7, 8, 11],
    "phrygian": [0, 1, 3, 5, 7, 8, 10],
    "dorian": [0, 2, 3, 5, 7, 9, 10],
}
MOOD_SCALES = {
    "happy": ["major", "major pentatonic"],
    "silly": ["major", "mixolydian"],
    "spooky": ["harmonic minor", "phrygian", "natural minor"],
    "epic": ["natural minor", "dorian", "major"],
}
DEGREE = {0: "1", 1: "b2", 2: "2", 3: "b3", 4: "3", 5: "4", 6: "#4", 7: "5", 8: "b6", 9: "6", 10: "b7", 11: "7"}
SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]
MINORISH = {"natural minor", "harmonic minor", "phrygian", "dorian"}


def stable_seed(*parts):
    """Deterministic seed from the inputs (Python's hash() is randomized per process)."""
    return zlib.crc32("|".join(map(str, parts)).encode())


def note_name(midi, flats=False):
    return (FLAT if flats else SHARP)[midi % 12] + str(midi // 12 - 1)


# ---------------------------------------------------------------- the palette


@dataclass
class Pitch:
    midi: int
    name: str
    degree: str  # scale degree relative to the tonic, e.g. "b3"
    rec: str  # the Melodic Recording that plays it
    shift: float  # semitones from the Recording Pitch
    min_s: float  # shortest note (s) the Recording holds on pitch, including the articulation gap
    max_s: float  # roughly how long the Recording lasts at this pitch


@dataclass
class Palette:
    mood: str
    scale: str
    tonic_pc: int
    flats: bool
    home: int  # index into pitches: the tonic the melody comes home to
    pitches: list = field(default_factory=list)  # Pitch, sorted low to high

    @property
    def key(self):
        return f"{note_name(self.tonic_pc + 60, self.flats)[:-1]} {self.scale}"

    def index(self, midi):
        return next(i for i, p in enumerate(self.pitches) if p.midi == midi)


def _flats(tonic_pc, scale):
    major_pc = (tonic_pc + 3) % 12 if scale in MINORISH else tonic_pc
    return major_pc in (5, 10, 3, 8, 1, 6)


def choose_palette(sources, mood):
    """Pick the key and the pitches for a mood from the user's Melodic Recordings.

    For each of the mood's scales, each tonic and each one-octave window, give every
    Melodic Recording at most one scale pitch within 3 semitones of its Recording Pitch, one
    Recording per pitch (an assignment problem). Keep the palette with the most pitches,
    preferring one that contains the tonic, the scale's third, neighbouring steps and small
    shifts. Deterministic: no randomness, ties go to the first option in a fixed order.
    """
    melodic = [s for s in sources if s.pitched]
    if not melodic:
        raise ValueError("no Melodic Recordings")
    lo = int(np.floor(min(s.ref_midi for s in melodic) - MAX_SHIFT))
    hi = int(np.ceil(max(s.ref_midi for s in melodic) + MAX_SHIFT))
    best = None
    for scale in MOOD_SCALES[mood]:
        steps = SCALES[scale]
        third = 3 if scale in MINORISH else 4
        for tonic_pc in range(12):
            for w0 in range(lo, hi - 3):
                cand = [m for m in range(w0, w0 + WINDOW + 1) if (m - tonic_pc) % 12 in steps]
                if not cand:
                    continue
                # rows: Recordings; columns: candidate pitches, then one "unused" column per Recording
                big = 1e6
                C = np.full((len(melodic), len(cand) + len(melodic)), big)
                for i, s in enumerate(melodic):
                    for j, m in enumerate(cand):
                        d = abs(m - s.ref_midi)
                        if d <= MAX_SHIFT:
                            tonic_bonus = -30 if (m - tonic_pc) % 12 == 0 else 0
                            C[i, j] = d**1.5 + 2 * s.min_note_s + tonic_bonus
                    C[i, len(cand) + i] = 100.0
                rows, cols = linear_sum_assignment(C)
                chosen = [(melodic[i], cand[j]) for i, j in zip(rows, cols) if j < len(cand) and C[i, j] < big]
                if not chosen:
                    continue
                mids = sorted(m for _, m in chosen)
                tonics = [m for m in mids if (m - tonic_pc) % 12 == 0]
                if not tonics:
                    continue
                rel = {(m - tonic_pc) % 12 for m in mids}
                steps_ok = sum(1 for a, b in zip(mids, mids[1:]) if b - a <= 2)
                shift = sum(abs(m - s.ref_midi) ** 1.5 for s, m in chosen)
                score = (
                    10 * len(mids)
                    + (6 if third in rel else 0)
                    + (3 if 7 in rel else 0)
                    + 2 * steps_ok
                    + (3 if len(tonics) > 1 else 0)
                    - shift
                )
                if best is None or score > best[0] + 1e-9:
                    best = (score, scale, tonic_pc, chosen, tonics[0])
    if best is None:
        raise ValueError("no palette: no tonic within 3 semitones of any Melodic Recording")
    _, scale, tonic_pc, chosen, home_midi = best
    flats = _flats(tonic_pc, scale)
    pitches = []
    for s, m in sorted(chosen, key=lambda x: x[1]):
        shift = m - s.ref_midi
        pitches.append(
            Pitch(
                midi=m,
                name=note_name(m, flats),
                degree=DEGREE[(m - tonic_pc) % 12],
                rec=s.id,
                shift=round(shift, 2),
                min_s=s.min_note_s + engine.GAP_S,
                max_s=round(s.seconds / 2 ** (shift / 12), 3),
            )
        )
    pal = Palette(mood=mood, scale=scale, tonic_pc=tonic_pc, flats=flats, home=0, pitches=pitches)
    pal.home = pal.index(home_midi)
    return pal


# ---------------------------------------------------------------- composed melodies


@dataclass
class Comp:
    """A composed melody on a beat grid. pitch is a palette index, or None for a rest."""

    bpm: float
    beats_per_bar: int
    bars: int
    notes: list  # of [start_beats, dur_beats, pitch_index_or_None]
    info: dict = field(default_factory=dict)


def fit_bars(bar_notes, beats_per_bar):
    """Lay out per-bar note lists [(dur, pitch)] so every bar lasts exactly one bar: a note
    that would spill over is shortened, and a short bar's last note is lengthened. Returns
    (notes, number of notes changed)."""
    out, changed, t = [], 0, 0.0
    for bar in bar_notes:
        used = 0.0
        kept = []
        for dur, p in bar:
            if used >= beats_per_bar - 1e-9:
                changed += 1
                continue
            d = min(dur, beats_per_bar - used)
            changed += d != dur
            kept.append([d, p])
            used += d
        if not kept:
            kept = [[beats_per_bar, None]]
        elif used < beats_per_bar - 1e-9:
            kept[-1][0] += beats_per_bar - used
            changed += 1
        for d, p in kept:
            out.append([t, d, p])
            t += d
    return out, changed


def legalize(comp, pal):
    """Replace any note too short for its pitch's Recording with the nearest palette pitch
    whose Recording can hold it (Recordings have a shortest note that still reads on pitch).
    Returns the number of notes moved."""
    spb = 60 / comp.bpm
    moved = 0
    for n in comp.notes:
        if n[2] is None or n[1] * spb >= pal.pitches[n[2]].min_s:
            continue
        ok = [i for i, p in enumerate(pal.pitches) if n[1] * spb >= p.min_s]
        if ok:
            n[2] = min(ok, key=lambda i: (abs(pal.pitches[i].midi - pal.pitches[n[2]].midi), i))
            moved += 1
    return moved


def merge_rests(notes):
    """Collapse consecutive rests and drop leading/trailing silence from the note list."""
    out = []
    for n in notes:
        if n[2] is None and out and out[-1][2] is None:
            out[-1][1] += n[1]
        else:
            out.append(list(n))
    return out


# ---------------------------------------------------------------- render + checks


def load_sources(ids, cache_dir=Path(__file__).parent / "out/cache"):
    """engine.load_library(ids), cached (analysis takes a while and never changes here)."""
    import pickle

    cache_dir.mkdir(parents=True, exist_ok=True)
    f = cache_dir / ("sources-" + "-".join(sorted(ids)) + ".pkl")
    key = (Path(engine.__file__).read_bytes(), engine.MANIFEST.read_bytes())
    if f.exists():
        k, srcs = pickle.loads(f.read_bytes())
        if k == key:
            return srcs
    srcs = engine.load_library(ids)
    f.write_bytes(pickle.dumps((key, srcs)))
    return srcs


def render(comp, pal, sources, title):
    """Render with the melody lab engine (tune=1.0, fart-only) and run evaluate()."""
    sounding = [n for n in comp.notes if n[2] is not None]
    mel = Melody(
        title=title,
        bpm=comp.bpm,
        beats_per_bar=comp.beats_per_bar,
        notes=[Note(start=n[0], dur=n[1], pitch=pal.pitches[n[2]].midi) for n in sounding],
    )
    by_id = {s.id: s for s in sources}
    asg = []
    for i, n in enumerate(sounding):
        p = pal.pitches[n[2]]
        asg.append(engine.Assignment(i, p.rec, p.midi, round(p.midi - by_id[p.rec].ref_midi, 2)))
    y, events = engine.render(mel, sources, asg, tune=1.0, bpm=comp.bpm)
    # engine.render adds 1 s of tail; trim trailing silence to keep files small
    nz = np.flatnonzero(np.abs(y) > 1e-4)
    y = y[: (nz[-1] + 1 + int(0.2 * engine.SR)) if len(nz) else len(y)]
    r = evaluate(y, mel, events, comp.bpm)
    return y, mel, events, r


def musical_stats(comp, pal):
    """Cheap structure measures (not a verdict on musicality: that's the owner's ear)."""
    snd = [n for n in comp.notes if n[2] is not None]
    mids = [pal.pitches[n[2]].midi for n in snd]
    ints = [abs(b - a) for a, b in zip(mids, mids[1:])]
    idx_steps = [abs(b[2] - a[2]) for a, b in zip(snd, snd[1:])]
    bar_rhythms = {}
    for n in comp.notes:
        b = int(n[0] // comp.beats_per_bar)
        bar_rhythms.setdefault(b, []).append((round(n[0] % comp.beats_per_bar, 3), n[1], n[2] is None))
    rh = [tuple(v) for _, v in sorted(bar_rhythms.items())]
    repeated = sum(1 for i, r in enumerate(rh) if r in rh[:i])
    return {
        "notes": len(snd),
        "rests": sum(1 for n in comp.notes if n[2] is None),
        "distinct_pitches": len(set(mids)),
        "range_semitones": (max(mids) - min(mids)) if mids else 0,
        "stepwise_pct": round(100 * sum(1 for s in idx_steps if s <= 1) / max(1, len(idx_steps))),
        "repeated_note_pct": round(100 * sum(1 for i in ints if i == 0) / max(1, len(ints))),
        "largest_leap": max(ints) if ints else 0,
        "starts_on_home": bool(snd) and snd[0][2] == pal.home,
        "ends_on_home": bool(snd) and snd[-1][2] == pal.home,
        "bars_with_repeated_rhythm": repeated,
        "seconds": round(comp.bars * comp.beats_per_bar * 60 / comp.bpm, 1),
    }


def palette_dict(pal):
    return {"mood": pal.mood, "key": pal.key, "scale": pal.scale, "home": pal.home, "pitches": [asdict(p) for p in pal.pitches]}
