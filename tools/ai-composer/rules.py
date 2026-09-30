"""Candidate B: a rule-based composer, and the plan realizer candidate C shares.

A melody is built from a *plan*: a one-bar motif (a rhythm plus a pitch contour in palette
steps), an answering bar that ends a phrase, and a final cadence. Phrases are two bars:

    short (4 bars):  A = motif, answer (half cadence) | A' = motif, cadence (home)
    long  (8 bars):  A | A' | B = motif moved up/down or inverted, new rhythm, answer | A'

B draws the plan from mood-specific choices with a seeded RNG. C asks the on-device model
for the plan (llm.py) and realizes it here. Pitches are palette indexes, so "a step" is the
next pitch the user's Recordings can play.
"""
import random

from common import BARS, Comp, fit_bars, legalize, merge_rests, stable_seed

MOOD_BPM = {"happy": 120, "silly": 126, "spooky": 80, "epic": 92}
BEATS_PER_BAR = 4

# Bar rhythms in beats; a negative length is a rest. Nothing shorter than an eighth note:
# shorter notes don't read back on pitch with most Recordings.
RHYTHMS = {
    # happy
    "skip": ([0.5, 0.5, 1, 0.5, 0.5, 1], "bouncy: two eighths and a quarter, twice"),
    "bounce": ([1, 0.5, 0.5, 1, 1], "quarter, two eighths, two quarters"),
    "run": ([0.5, 0.5, 0.5, 0.5, 1, 1], "four quick eighths, then two quarters"),
    "march": ([1, 1, 1, 1], "four even quarters"),
    # silly
    "hiccup": ([0.5, 1, 0.5, 1, 1], "syncopated: eighth, quarter, eighth, two quarters"),
    "stop-go": ([0.5, 0.5, -0.5, 0.5, 1, -1], "two eighths, a gap, an eighth, a quarter, a gap"),
    "offbeat": ([-0.5, 0.5, -0.5, 0.5, 1, 1], "notes on the off-beats, then two quarters"),
    "tumble": ([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 1], "six tumbling eighths and a quarter"),
    # spooky
    "creep": ([1, 1, 1, 1], "four slow even steps"),
    "sigh": ([1.5, 0.5, 2], "dotted quarter, eighth, half"),
    "tiptoe": ([0.5, 0.5, 1, -1, 1], "two eighths, a quarter, a gap, a quarter"),
    "lurk": ([2, 1, 1], "half note, two quarters"),
    # epic
    "fanfare": ([1.5, 0.5, 2], "dotted quarter, eighth, half: a call"),
    "stride": ([1, 0.5, 0.5, 1, 1], "strong quarter, two eighths, two quarters"),
    "call": ([2, 1, 1], "long note, two quarters"),
    "anthem": ([1, 1, 1, 1], "four strong quarters"),
}
CADENCES = {
    "hold": ([1, 1, 2], "two quarters and a half note"),
    "tap-hold": ([0.5, 0.5, 1, 2], "two eighths, a quarter, a half note"),
    "long": ([2, 2], "two half notes"),
    "whole": ([4], "one whole note"),
    "ta-da": ([1, 1, -1, 1], "two quarters, a gap, a last pop"),
    "dotted": ([1.5, 0.5, 2], "dotted quarter, eighth, half note"),
    "drop": ([1, 3], "a quarter, then a long note"),
}
# Motif contours in palette steps (+1 = the next playable pitch up). When a bar has more
# notes than the contour, it continues with the contour mirrored, so it returns.
CONTOURS = {
    "rise": ([1, 1, 1], "climbs step by step"),
    "fall": ([-1, -1, -1], "falls step by step"),
    "arch": ([1, 1, -1, -1], "up and back down"),
    "valley": ([-1, -1, 1, 1], "down and back up"),
    "turn": ([1, -1, -1, 1], "a little turn around the first note"),
    "leap-fall": ([2, -1, -1], "jumps up, then steps down"),
    "fall-leap": ([-1, -1, 2], "steps down, then jumps up"),
    "repeat-rise": ([0, 1, 1], "repeats a note, then climbs"),
    "neighbor": ([1, -1, 0], "steps to a neighbour and back"),
    "zigzag": ([2, -1, 2, -1], "zigzags upward"),
    "boing": ([3, -3, 3], "big jumps up and down"),
    "yo-yo": ([2, -2, 2, -2], "bounces between two notes a skip apart"),
    "stutter": ([0, 0, 1, -1], "repeats a note, then wiggles"),
    "creep-down": ([-1, 0, -1], "slinks down with a repeated note"),
    "summit": ([3, -1, -1], "leaps to a peak, then steps down"),
}
MOOD_CHOICES = {
    "happy": {
        "motif": ["skip", "bounce", "run", "march"],
        "cadence": ["hold", "tap-hold", "dotted"],
        "contour": ["rise", "arch", "turn", "leap-fall", "repeat-rise", "zigzag"],
        "start": ["home", "third", "fifth"],
        "approach": ["above", "above", "below"],
    },
    "silly": {
        "motif": ["hiccup", "stop-go", "offbeat", "tumble"],
        "cadence": ["ta-da", "tap-hold", "hold"],
        "contour": ["boing", "yo-yo", "stutter", "neighbor", "zigzag"],
        "start": ["home", "low", "fifth", "top"],
        "approach": ["above", "below"],
    },
    "spooky": {
        "motif": ["creep", "sigh", "tiptoe", "lurk"],
        "cadence": ["long", "drop", "whole"],
        "contour": ["fall", "creep-down", "neighbor", "valley", "fall-leap"],
        "start": ["fifth", "home", "top"],
        "approach": ["below", "above"],
    },
    "epic": {
        "motif": ["fanfare", "stride", "call", "anthem"],
        "cadence": ["dotted", "long", "whole", "hold"],
        "contour": ["summit", "leap-fall", "rise", "arch", "zigzag"],
        "start": ["home", "low", "fifth"],
        "approach": ["below", "above"],
    },
}
STARTS = ["home", "third", "fifth", "low", "top"]
B_MOVES = ["up", "down", "invert"]


def random_plan(mood, length, seed):
    """Candidate B's plan: every choice is a seeded draw from the mood's options."""
    rng = random.Random(stable_seed("rules", mood, length, seed))
    ch = MOOD_CHOICES[mood]
    return {
        "motif_rhythm": rng.choice(ch["motif"]),
        "answer_rhythm": rng.choice(ch["motif"] + ch["cadence"]),
        "cadence_rhythm": rng.choice(ch["cadence"]),
        "b_rhythm": rng.choice(ch["motif"]),
        "contour": rng.choice(ch["contour"]),
        "start": rng.choice(ch["start"]),
        "b_move": rng.choice(B_MOVES),
        "approach": rng.choice(ch["approach"]),
    }


def _rhythm(name):
    return (RHYTHMS.get(name) or CADENCES[name])[0]


def _start_index(pal, start):
    n, h = len(pal.pitches), pal.home
    deg = [p.degree for p in pal.pitches]

    def near(options):
        hits = [i for i, d in enumerate(deg) if d in options]
        return min(hits, key=lambda i: (abs(i - h), i)) if hits else h

    return {
        "home": h,
        "third": near({"3", "b3"}),
        "fifth": near({"5"}),
        "low": 0,
        "top": n - 1,
    }[start]


def _half_cadence(pal, near_idx):
    """A phrase that isn't the last one ends on the fifth (or the second): an open ending."""
    for wanted in ({"5"}, {"2"}, {"4", "6", "b6"}):
        hits = [i for i, p in enumerate(pal.pitches) if p.degree in wanted and i != pal.home]
        if hits:
            return min(hits, key=lambda i: (abs(i - near_idx), i))
    return pal.home + 1 if pal.home + 1 < len(pal.pitches) else max(0, pal.home - 1)


def _reflect(i, n):
    if n == 1:
        return 0
    period = 2 * (n - 1)
    i %= period
    return i if i < n else period - i


def _motif_bar(rhythm, start, steps, n):
    """Place the contour on the rhythm. The start moves as little as needed for the whole
    bar to fit in the palette; only if it can't fit at all do steps bounce off the ends."""
    ext = steps + [-s for s in reversed(steps)]
    k = sum(1 for d in rhythm if d > 0)
    offs = [0]
    for j in range(k - 1):
        offs.append(offs[-1] + ext[j % len(ext)])
    lo, hi = min(offs), max(offs)
    if hi - lo <= n - 1:
        start = min(max(start, -lo), n - 1 - hi)
    it = iter(offs)
    return [(-d, None) if d < 0 else (d, _reflect(start + next(it), n)) for d in rhythm]


def _cadence_bar(rhythm, prev, target, approach, n):
    """Walk from the previous pitch to `target`, arriving from above or below on the last note."""
    sounding = [d for d in rhythm if d > 0]
    k = len(sounding)
    side = 1 if approach == "above" else -1
    if not 0 <= target + side < n:
        side = -side if 0 <= target - side < n else 0
    path = []
    if k == 1:
        path = [target]
    else:
        a, b = prev, target + side
        for j in range(k - 1):
            path.append(round(a + (b - a) * (j + 1) / (k - 1)) if k > 2 else b)
        path.append(target)
    path = [min(n - 1, max(0, p)) for p in path]
    out, it = [], iter(path)
    for d in rhythm:
        out.append((-d, None) if d < 0 else (d, next(it)))
    return out


def realize(pal, mood, length, plan):
    """Turn a plan into a melody on the palette. Deterministic: no randomness here."""
    n = len(pal.pitches)
    steps = CONTOURS[plan["contour"]][0]
    start = _start_index(pal, plan["start"])
    motif = _motif_bar(_rhythm(plan["motif_rhythm"]), start, steps, n)

    def last_pitch(bar):
        return next(p for _, p in reversed(bar) if p is not None) if any(p is not None for _, p in bar) else start

    half = _half_cadence(pal, last_pitch(motif))
    answer = _cadence_bar(_rhythm(plan["answer_rhythm"]), last_pitch(motif), half, plan["approach"], n)
    home = _cadence_bar(_rhythm(plan["cadence_rhythm"]), last_pitch(motif), pal.home, plan["approach"], n)
    bars = [motif, answer, motif, home]
    if BARS[length] == 8:
        move = plan["b_move"]
        if move == "invert":
            b_steps, b_start = [-s for s in steps], start
        else:
            b_steps, b_start = steps, _reflect(start + (2 if move == "up" else -2), n)
        b_bar = _motif_bar(_rhythm(plan["b_rhythm"]), b_start, b_steps, n)
        b_answer = _cadence_bar(_rhythm(plan["answer_rhythm"]), last_pitch(b_bar), half, plan["approach"], n)
        bars = [motif, answer, motif, home, b_bar, b_answer, motif, home]
    notes, changed = fit_bars(bars, BEATS_PER_BAR)
    comp = Comp(bpm=MOOD_BPM[mood], beats_per_bar=BEATS_PER_BAR, bars=BARS[length], notes=merge_rests(notes))
    comp.info = {"plan": plan, "fit_changed": changed}
    comp.info["legalized"] = legalize(comp, pal)
    return comp


def compose(pal, mood, length, seed):
    return realize(pal, mood, length, random_plan(mood, length, seed))
