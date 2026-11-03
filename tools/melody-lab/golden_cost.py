import json

from analysis import ROOT, SR
from engine import GAP_S, fills, move_cost, needed_seconds, silent_cost, too_short_cost, unsettled_cost

GOLDEN = ROOT / "fixtures/golden"


def arrangement_cost(song, recordings, transpose, recording_for_pitch):
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
        assert fills(seconds, max(note_seconds)), f"{rid} is too short for {p + transpose}"
        octaves += move[1]
        cost += (
            weight * move[0]
            + too_short_cost(note_seconds, seconds, rec["shortest_note_s"])
            + unsettled_cost(note_seconds, seconds, rec["settle_s"])
            + silent_cost(note_seconds, seconds)
        )
    return uncovered, octaves, cost


def missing(song, transpose, recording_for_pitch):
    spb = 60 / song["bpm"]
    out = []
    for p in sorted(recording_for_pitch):
        if recording_for_pitch[p] is None:
            longest = max(n["dur"] * spb - GAP_S for n in song["notes"] if n["pitch"] == p)
            out.append({"target_midi": p + transpose, "seconds": needed_seconds(longest)})
    return out


def load(rel):
    return json.loads((GOLDEN / rel).read_text(encoding="utf-8"))


def check(fit, song, recordings):
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
    return n


if __name__ == "__main__":
    main()
