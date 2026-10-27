"""Recompute plan()'s cost for a given Arrangement, from the golden data alone.

An Auto-map or Pitch Coverage test compares the golden `uncovered`, `octave_moves` and
`plan_cost` with what this function (or a port of it) computes for the Arrangement under
test. It never uses the solver's own total: the solver's total only sums the matrix cells it
picked, so a port that picks the right cells but then maps a tied cell to the wrong Recording
(say, every tied pitch to 013) would still report the golden cost. Recomputing from the
returned Recording ids charges that mistake and rejects it.

    .venv/bin/python golden_cost.py    # recomputes every golden Arrangement and compares
"""
import json

from engine import GAP_S, ROOT, SR, fills, move_cost, needed_seconds, silent_cost, too_short_cost, unsettled_cost

GOLDEN = ROOT / "fixtures/golden"


def arrangement_cost(song, recordings, transpose, recording_for_pitch):
    """(uncovered pitches, Octave Moves, cost) of this Arrangement, as plan() ranks it.

    song:                a songs/<id>.json object
    recordings:          {id: recordings/<id>.json object}
    transpose:           the Arrangement's transposition
    recording_for_pitch: {Song pitch: Recording id, or None when uncovered}, one entry per
                         distinct Song pitch

    Per covered pitch, in ascending pitch order: the pitch's total note length in beats x
    move_cost(shift), plus too_short_cost(), unsettled_cost() and silent_cost() over its
    notes. A Recording plays at most one pitch, and only moves the unlock rule allows count:
    within move_cost()'s reach, and long enough for the pitch's longest note (fills()).
    """
    pitches = sorted({n["pitch"] for n in song["notes"]})
    assert sorted(recording_for_pitch) == pitches, "one entry per distinct Song pitch"
    used = [r for r in recording_for_pitch.values() if r is not None]
    assert len(used) == len(set(used)), "a Recording plays at most one pitch"
    spb = 60 / song["bpm"]
    uncovered = octaves = 0
    cost = 0.0
    for p in pitches:
        rid = recording_for_pitch[p]
        if rid is None:
            uncovered += 1
            continue
        rec = recordings[rid]
        assert rec["melodic"], f"{rid} is Noise-like"
        shift = p + transpose - rec["recording_pitch_midi"]
        move = move_cost(shift)
        assert move is not None, f"{rid} can't play {p + transpose} (shift {shift:.2f})"
        notes = [n for n in song["notes"] if n["pitch"] == p]
        weight = sum(n["dur"] for n in notes)
        seconds = (rec["gesture"]["end_sample"] - rec["gesture"]["start_sample"]) / SR
        note_seconds = [n["dur"] * spb - GAP_S for n in notes]
        assert fills(seconds, max(note_seconds), shift), f"{rid} is too short for {p + transpose}"
        octaves += move[1]
        cost += (
            weight * move[0]
            + too_short_cost(note_seconds, seconds, rec["shortest_note_s"], shift)
            + unsettled_cost(note_seconds, seconds, rec["settle_s"], shift)
            + silent_cost(note_seconds, seconds, shift)
        )
    return uncovered, octaves, cost


def missing(song, transpose, recording_for_pitch):
    """The notes no Recording covers, as {target_midi, seconds}: each uncovered pitch after
    transposition, and needed_seconds() of its longest slot, lowest first (Fit.missing)."""
    spb = 60 / song["bpm"]
    out = []
    for p in sorted(recording_for_pitch):
        if recording_for_pitch[p] is None:
            longest = max(n["dur"] * spb - GAP_S for n in song["notes"] if n["pitch"] == p)
            out.append({"target_midi": p + transpose, "seconds": needed_seconds(longest)})
    return out


def load(rel):
    return json.loads((GOLDEN / rel).read_text())


def check(fit, song, recordings):
    """Recompute one golden fit (an arrangement file or a coverage.json entry); return the error."""
    if "per_pitch" in fit:
        per_pitch = {x["song_pitch"]: x["recording"] for x in fit["per_pitch"]}
    else:
        per_pitch = {int(p): r for p, r in fit["recording_for_pitch"].items()}
    uncovered, octaves, cost = arrangement_cost(song, recordings, fit["transpose"], per_pitch)
    assert uncovered == fit["pitch_coverage"]["total"] - fit["pitch_coverage"]["covered"], fit
    assert fit["unlocked"] == (uncovered == 0), fit
    assert octaves == fit["octave_moves"], fit
    assert abs(cost - fit["plan_cost"]) <= 1e-9, (fit, cost)
    assert missing(song, fit["transpose"], per_pitch) == fit["missing"], fit
    return abs(cost - fit["plan_cost"])


def main():
    index = load("index.json")
    recordings = {r: load(f"recordings/{r}.json") for r in index["recordings"]}
    songs = {s["id"]: load(f"songs/{s['id']}.json") for s in index["songs"]}
    worst, n = 0.0, 0
    for library in index["libraries"]:
        for s in index["songs"]:
            a = load(f"arrangements/{library}/{s['id']}.json")
            if a["unlocked"]:
                per_pitch = {x["song_pitch"]: x["recording"] for x in a["per_pitch"]}
                assert all(per_pitch[x["song_pitch"]] == x["recording"] for x in a["notes"])
            worst, n = max(worst, check(a, songs[s["id"]], recordings)), n + 1
    for subset in load("coverage.json")["subsets"]:
        for fit in subset["songs"]:
            worst, n = max(worst, check(fit, songs[fit["song"]], recordings)), n + 1
    print(f"all {n} golden fits: recomputed cost within {worst:.1e} of plan_cost")


if __name__ == "__main__":
    main()
