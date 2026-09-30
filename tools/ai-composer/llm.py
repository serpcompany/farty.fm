"""Candidates A and C: Apple's on-device model (FoundationModels) through fm-compose.

A: the model writes the notes itself. Each bar is exactly 8 eighth-note slots, and guided
   generation only lets a slot be one of the palette's pitch names, "hold" or "rest", so it
   can't produce a pitch the Recordings can't play or a bar of the wrong length. (A first
   try let it pick note lengths instead; it couldn't add up beats, and most bars had to be
   cut or padded.) Notes too short for their Recording are then moved (common.legalize);
   the page reports how many.
C: the model only fills in a plan (motif rhythm, contour, cadence, ...) from fixed menus,
   and rules.realize() writes the notes.

Sampling is top-k with a fixed seed, so the same request gives the same answer on the same
model version. Answers are cached in out/cache/llm.json.
"""
import hashlib
import json
import random
import subprocess
from pathlib import Path

import rules
from common import BARS, Comp, legalize, merge_rests, stable_seed

HERE = Path(__file__).parent
CLI = HERE / "fm-compose/.build/release/fm-compose"
CACHE = HERE / "out/cache/llm.json"
TOP_K = 40
TEMPERATURE = 0.9

MOOD_TEXT = {
    "happy": "Happy: bright and bouncy, with skipping eighth notes, mostly rising lines and a cheerful ending",
    "silly": "Silly: goofy and playful, with syncopation, repeated notes, a few surprising jumps and short rests",
    "spooky": "Spooky: slow and creepy, with long notes, creeping small steps, falling lines and some silence",
    "epic": "Epic: heroic and big, with long notes, bold upward leaps at the start of phrases and a grand ending",
}

INSTRUCTIONS = (
    "You are a melody composer for a toy instrument made of recorded sounds. It can only play "
    "the few pitches you are given. You write short, catchy melodies with a clear shape: a "
    "motif that comes back, mostly small steps between neighbouring pitches, phrases of two "
    "bars, and a strong ending on the home note."
)


def _pitch_lines(pal):
    return ", ".join(f"{p.name} ({p.degree}{', home' if i == pal.home else ''})" for i, p in enumerate(pal.pitches))


def _short_note_warning(pal, bpm):
    spb = 60 / bpm
    no_eighths = [p.name for p in pal.pitches if 0.5 * spb < p.min_s]
    return f"{', '.join(no_eighths)} can't play eighth notes. " if no_eighths else ""


def _form_text(pal, length):
    home = pal.pitches[pal.home].name
    text = (
        "Bars 1-2 ask a question and end away from home. Bars 3-4 start like bar 1 and answer it, "
        f"ending on {home} (home) with a long note."
    )
    if BARS[length] == 8:
        text += f" Bars 5-6 bring something new. Bars 7-8 return to the opening and end on {home} again."
    return text


SLOTS = 8  # eighth-note slots per 4/4 bar


def grid_request(pal, mood, length, seed):
    """Candidate A, grid format: every bar is exactly 8 eighth-note slots, each a pitch name
    (start a note), "hold" (keep the previous note sounding) or "rest". The schema fixes the
    bar length, so the model never has to add up beats."""
    bars = BARS[length]
    bpm = rules.MOOD_BPM[mood]
    prompt = (
        f"Write a melody. Mood: {MOOD_TEXT[mood]}.\n"
        f"Tempo {bpm} beats per minute in 4/4 time, exactly {bars} bars. Each bar is 8 slots, one per eighth note. "
        "In each slot write a pitch name to start a new note, \"hold\" to keep the previous note sounding, or "
        "\"rest\" for silence. A quarter note is a pitch and one hold, a half note is a pitch and three holds, "
        "a whole note is a pitch and seven holds.\n"
        f"The instrument's pitches, low to high, with their scale degree in {pal.key}: {_pitch_lines(pal)}. "
        f"Pitches next to each other in this list are one step apart. {_short_note_warning(pal, bpm)}\n"
        f"{_form_text(pal, length)}"
    )
    slot = {"type": "enum", "name": "Slot", "choices": [p.name for p in pal.pitches] + ["hold", "rest"]}
    bar = {
        "type": "object",
        "name": "Bar",
        "description": "One bar of 8 eighth-note slots",
        "properties": [{"name": "slots", "schema": {"type": "array", "items": slot, "min": SLOTS, "max": SLOTS}}],
    }
    schema = {
        "type": "object",
        "name": "Melody",
        "properties": [{"name": "bars", "schema": {"type": "array", "items": bar, "min": bars, "max": bars}}],
    }
    return {"instructions": INSTRUCTIONS, "prompt": prompt, "schema": schema, "seed": seed, "top_k": TOP_K, "temperature": TEMPERATURE}


def comp_from_grid(resp, pal, mood, length):
    """Candidate A (grid): slots to notes. A leading "hold" with nothing to hold is a rest."""
    content = json.loads(resp["content"])
    index = {p.name: i for i, p in enumerate(pal.pitches)}
    notes, t = [], 0.0
    for b in content["bars"]:
        for s in b["slots"]:
            if s == "hold" and notes:
                notes[-1][1] += 0.5
            else:
                notes.append([t, 0.5, index.get(s)])  # "rest" (or a stray hold) -> None
            t += 0.5
    comp = Comp(bpm=rules.MOOD_BPM[mood], beats_per_bar=rules.BEATS_PER_BAR, bars=BARS[length], notes=merge_rests(notes))
    comp.info = {"model_output": content, "fit_changed": 0, "llm_seconds": round(resp["elapsed_s"], 2)}
    comp.info["legalized"] = legalize(comp, pal)
    return comp


def _menu(names, table):
    return "; ".join(f"{n}: {table[n][1]}" for n in names)


def plan_request(pal, mood, length, seed):
    """Candidate C: the model fills in the plan from menus; rules.realize() writes the notes."""
    # The model favours whatever is listed first, so each try lists the menus in its own
    # (seeded) order. Without this, most tries got the same plan (#21 listening page).
    rng = random.Random(stable_seed("plan-menus", seed))
    motif_names = rng.sample(list(rules.RHYTHMS), len(rules.RHYTHMS))
    cadence_names = rng.sample(list(rules.CADENCES), len(rules.CADENCES))
    contour_names = rng.sample(list(rules.CONTOURS), len(rules.CONTOURS))
    starts = rng.sample(rules.STARTS, len(rules.STARTS))
    b_moves = rng.sample(rules.B_MOVES, len(rules.B_MOVES))
    approaches = rng.sample(["above", "below"], 2)
    prompt = (
        f"Plan a melody. Mood: {MOOD_TEXT[mood]}. A composer program will write the notes from your plan.\n"
        f"It is {BARS[length]} bars of 4/4 at {rules.MOOD_BPM[mood]} beats per minute, played on these pitches "
        f"(scale degrees in {pal.key}): {_pitch_lines(pal)}.\n"
        "Form: bar 1 is the motif, bar 2 answers it and ends away from home, bar 3 repeats the motif, bar 4 is "
        "the cadence that ends on home."
        + (" Bars 5-6 are a contrasting section built from the motif, and bars 7-8 repeat bars 3-4." if BARS[length] == 8 else "")
        + "\n"
        f"Bar rhythms: {_menu(motif_names, rules.RHYTHMS)}.\n"
        f"Cadence rhythms: {_menu(cadence_names, rules.CADENCES)}.\n"
        f"Motif contours: {_menu(contour_names, rules.CONTOURS)}.\n"
        "Choose what fits the mood best."
    )

    def enum(name, choices, desc):
        return {"name": name, "description": desc, "schema": {"type": "enum", "name": name.title().replace("_", ""), "choices": choices}}

    schema = {
        "type": "object",
        "name": "MelodyPlan",
        "properties": [
            enum("motif_rhythm", motif_names, "rhythm of the motif bar"),
            enum("contour", contour_names, "pitch shape of the motif"),
            enum("start", starts, "which pitch the motif starts on"),
            enum("answer_rhythm", motif_names + cadence_names, "rhythm of the answering bar (bar 2)"),
            enum("cadence_rhythm", cadence_names, "rhythm of the final bar of a phrase"),
            enum("approach", approaches, "whether phrase endings arrive from above or below"),
            enum("b_rhythm", motif_names, "rhythm of the contrasting section (long melodies only)"),
            enum("b_move", b_moves, "how the contrasting section changes the motif: moved up, moved down, or turned upside down"),
        ],
    }
    return {"instructions": INSTRUCTIONS, "prompt": prompt, "schema": schema, "seed": seed, "top_k": TOP_K, "temperature": TEMPERATURE}


def _key(req):
    return hashlib.sha256(json.dumps(req, sort_keys=True).encode()).hexdigest()


def call(requests):
    """Run requests through fm-compose now (no cache). Returns {request key: response}."""
    if not CLI.exists():
        raise SystemExit(f"build the CLI first: swift build -c release --package-path {CLI.parents[2]}")
    batch = [{**r, "id": _key(r)} for r in requests]
    out = subprocess.run([str(CLI)], input=json.dumps(batch), capture_output=True, text=True, check=True).stdout
    return {resp["id"]: resp for resp in map(json.loads, out.splitlines())}


def run(requests, fresh=False):
    """Run requests through fm-compose, reusing cached answers unless `fresh`."""
    cache = json.loads(CACHE.read_text()) if CACHE.exists() else {}
    todo = [r for r in requests if fresh or _key(r) not in cache]
    if todo:
        cache.update(call(todo))
        CACHE.parent.mkdir(parents=True, exist_ok=True)
        CACHE.write_text(json.dumps(cache, indent=1, sort_keys=True))
    return [cache[_key(r)] for r in requests]


def recheck(requests):
    """Ask again, bypassing the cache: how many answers are identical to the cached ones."""
    cached = run(requests)
    again = call(requests)
    # compare parsed JSON: the key order of jsonString varies between runs (Swift dictionaries)
    parsed = lambda resp: json.loads(resp["content"]) if resp.get("ok") else None
    same = sum(1 for r, c in zip(requests, cached) if parsed(again[_key(r)]) == parsed(c))
    return same, len(requests)


def comp_from_plan(resp, pal, mood, length):
    """Candidate C: realize the model's plan with the rule-based composer."""
    plan = json.loads(resp["content"])
    comp = rules.realize(pal, mood, length, plan)
    comp.info["llm_seconds"] = round(resp["elapsed_s"], 2)
    return comp
