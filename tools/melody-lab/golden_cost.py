"""Recompute plan()'s cost for a given Arrangement, from the golden data alone.

An Auto-map test compares golden `plan_cost` with the cost of the Arrangement under test,
computed by this function (or a port of it). It never uses the solver's own total: the
solver's total only sums the matrix cells it picked, so a port that picks the right cells
but then maps a tied cell to the wrong Recording (say, every tied pitch to 013) would still
report the golden cost. Recomputing from the returned Recording ids charges that mistake
(reuse and too-short penalties) and rejects it.

    .venv/bin/python golden_cost.py    # recomputes every golden Arrangement and compares
"""
import json
from collections import Counter

from engine import GAP_S, ROOT, shift_cost

GOLDEN = ROOT / "fixtures/golden"


def arrangement_cost(song, recordings, transpose, recording_for_pitch):
    """The cost plan() gives this Arrangement.

    song:                a songs/<id>.json object
    recordings:          {id: recordings/<id>.json object}
    transpose:           the Arrangement's transposition
    recording_for_pitch: {Song pitch: Recording id}, one entry per distinct Song pitch

    Same terms as plan()'s cost matrix, per distinct pitch in ascending order:
    total note length in beats x shift_cost(shift), plus 8 per note too short for the
    Recording to hold, plus 2 x how many lower pitches already use that Recording.
    """
    pitches = sorted({n["pitch"] for n in song["notes"]})
    assert sorted(recording_for_pitch) == pitches, "one Recording per distinct Song pitch"
    spb = 60 / song["bpm"]
    total, uses = 0.0, Counter()
    for p in pitches:
        rid = recording_for_pitch[p]
        rec = recordings[rid]
        assert rec["melodic"], f"{rid} is Noise-like"
        notes = [n for n in song["notes"] if n["pitch"] == p]
        weight = sum(n["dur"] for n in notes)
        too_short = sum(1 for n in notes if n["dur"] * spb - GAP_S < rec["shortest_note_s"])
        total += weight * shift_cost(p + transpose - rec["recording_pitch_midi"]) + 8.0 * too_short + 2.0 * uses[rid]
        uses[rid] += 1
    return total


def load(rel):
    return json.loads((GOLDEN / rel).read_text())


def main():
    index = load("index.json")
    recordings = {r: load(f"recordings/{r}.json") for r in index["recordings"]}
    worst = 0.0
    for library in index["libraries"]:
        for s in index["songs"]:
            a = load(f"arrangements/{library}/{s['id']}.json")
            per_pitch = {p["song_pitch"]: p["recording"] for p in a["per_pitch"]}
            assert all(per_pitch[n["song_pitch"]] == n["recording"] for n in a["notes"])
            cost = arrangement_cost(load(f"songs/{s['id']}.json"), recordings, a["transpose"], per_pitch)
            worst = max(worst, abs(cost - a["plan_cost"]))
            assert abs(cost - a["plan_cost"]) <= 1e-9, (library, s["id"], cost, a["plan_cost"])
    print(f"all golden Arrangements: recomputed cost within {worst:.1e} of plan_cost")


if __name__ == "__main__":
    main()
