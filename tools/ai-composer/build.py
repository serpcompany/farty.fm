"""Compose, render and check every candidate, and write the listening page.

    ../melody-lab/.venv/bin/python build.py            # uses cached model answers when present
    ../melody-lab/.venv/bin/python build.py --fresh    # asks the on-device model again
    ../melody-lab/.venv/bin/python build.py --recheck  # also asks again and counts identical answers

Output: out/listen/ (index.html, data.js, audio/*.mp3). Nothing here is committed.
"""
import json
import shutil
import subprocess
import sys
import time
from pathlib import Path

import numpy as np
import soundfile as sf

import llm
import rules
from common import MOODS, choose_palette, engine, load_sources, musical_stats, palette_dict, render

HERE = Path(__file__).parent
OUT = HERE / "out/listen"
AUDIO = OUT / "audio"

INPUTS = [
    {"id": "all9", "label": "All 9 Melodic Recordings", "ids": ["013", "017", "019", "021", "059", "084", "086", "090", "094"]},
    {"id": "three", "label": "3 Melodic Recordings (021, 090, 094)", "ids": ["021", "090", "094"]},
]
CASES = [(m, "short", 1) for m in MOODS] + [(m, "short", 2) for m in MOODS] + [("happy", "long", 1), ("epic", "long", 1)]
CANDIDATES = {
    "A": {
        "name": "On-device model writes the notes",
        "desc": "Apple's on-device language model (FoundationModels) writes every note. Each bar is 8 eighth-note "
        "slots and guided generation only allows the playable pitch names, hold or rest.",
    },
    "B": {
        "name": "Rule-based composer",
        "desc": "A small composer program: a one-bar motif (rhythm and pitch shape picked by mood), repeated in "
        "two-bar question and answer phrases, ending on the home note. The seed picks the options.",
    },
    "C": {
        "name": "Hybrid: model plans, rules write",
        "desc": "The on-device model picks the building blocks (motif rhythm, pitch shape, cadence) from menus; "
        "the rule-based composer from B writes the notes.",
    },
}


def encode(y, name):
    wav = AUDIO / f"{name}.wav"
    sf.write(wav, y, engine.SR)
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", wav, "-c:a", "libmp3lame", "-q:a", "4", AUDIO / f"{name}.mp3"],
        check=True,
    )
    wav.unlink()
    return f"audio/{name}.mp3"


def render_entry(cand, inp, mood, length, seed, pal, sources, comp, error=None):
    rid = f"{cand}-{inp['id']}-{mood}-{length}-{seed}"
    base = {"id": rid, "cand": cand, "input": inp["id"], "mood": mood, "length": length, "seed": seed}
    if comp is None:
        return {**base, "ok": False, "error": error}
    y, mel, events, r = render(comp, pal, sources, rid)
    notes = []
    for n, e, pn in zip([n for n in comp.notes if n[2] is not None], events, r["per_note"]):
        p = pal.pitches[n[2]]
        notes.append({"start": n[0], "dur": n[1], "i": n[2], "midi": p.midi, "name": p.name, "rec": p.rec, "cents": pn["cents"]})
    metrics = {k: v for k, v in r.items() if k != "per_note"}
    return {
        **base,
        "ok": True,
        "audio": encode(y, rid),
        "bpm": comp.bpm,
        "beats_per_bar": comp.beats_per_bar,
        "bars": comp.bars,
        "notes": notes,
        "metrics": metrics,
        "stats": musical_stats(comp, pal),
        "info": {k: v for k, v in comp.info.items() if k != "model_output"},
    }


def summarize(entries):
    ok = [e for e in entries if e["ok"]]
    if not ok:
        return {"renders": len(entries), "failed": len(entries)}

    def col(k, src="metrics"):
        return [e[src][k] for e in ok]

    llm_s = [e["info"]["llm_seconds"] for e in ok if "llm_seconds" in e["info"]]
    return {
        "renders": len(entries),
        "failed": len(entries) - len(ok),
        "within_50c_mean": round(float(np.mean(col("within_50c_pct"))), 1),
        "within_50c_min": min(col("within_50c_pct")),
        "onsets_on_time_mean": round(float(np.mean(col("onsets_on_time_pct"))), 1),
        "onsets_on_time_min": min(col("onsets_on_time_pct")),
        "retriggers_total": sum(col("notes_with_retrigger")),
        "notes_total": sum(col("notes")),
        "legalized_total": sum(e["info"].get("legalized", 0) for e in ok),
        "ends_on_home": sum(col("ends_on_home", "stats")),
        "stepwise_mean": round(float(np.mean(col("stepwise_pct", "stats"))), 1),
        "repeated_note_mean": round(float(np.mean(col("repeated_note_pct", "stats"))), 1),
        "llm_seconds_mean": round(float(np.mean(llm_s)), 2) if llm_s else None,
    }


def main():
    fresh, recheck = "--fresh" in sys.argv, "--recheck" in sys.argv
    if OUT.exists():
        shutil.rmtree(OUT)
    AUDIO.mkdir(parents=True)
    t0 = time.time()

    libs = {}
    for inp in INPUTS:
        sources = load_sources(inp["ids"])
        libs[inp["id"]] = (sources, {m: choose_palette(sources, m) for m in MOODS})

    # Candidates A and C: one on-device model request per melody (cached in out/cache/llm.json)
    jobs = []
    for inp in INPUTS:
        for mood, length, seed in CASES:
            pal = libs[inp["id"]][1][mood]
            jobs.append(("A", inp, mood, length, seed, llm.grid_request(pal, mood, length, seed)))
            jobs.append(("C", inp, mood, length, seed, llm.plan_request(pal, mood, length, seed)))
    answers = llm.run([j[-1] for j in jobs], fresh=fresh)
    determinism = {}
    if recheck:
        for cand in "AC":
            same, total = llm.recheck([j[-1] for j in jobs if j[0] == cand])
            determinism[cand] = f"{same} of {total} model answers identical when asked again"

    entries = []
    for (cand, inp, mood, length, seed, _), resp in zip(jobs, answers):
        sources, pals = libs[inp["id"]]
        pal = pals[mood]
        if not resp["ok"]:
            entries.append(render_entry(cand, inp, mood, length, seed, pal, sources, None, resp.get("error")))
            continue
        make = llm.comp_from_grid if cand == "A" else llm.comp_from_plan
        entries.append(render_entry(cand, inp, mood, length, seed, pal, sources, make(resp, pal, mood, length)))

    # Candidate B: seeded rules; composing twice must give the same notes
    same_b = 0
    for inp in INPUTS:
        sources, pals = libs[inp["id"]]
        for mood, length, seed in CASES:
            comp = rules.compose(pals[mood], mood, length, seed)
            same_b += comp.notes == rules.compose(pals[mood], mood, length, seed).notes
            entries.append(render_entry("B", inp, mood, length, seed, pals[mood], sources, comp))
    determinism["B"] = f"{same_b} of {len(INPUTS) * len(CASES)} melodies identical when composed again"

    order = {"A": 0, "B": 1, "C": 2}
    entries.sort(key=lambda e: (order[e["cand"]], e["input"] != "all9", MOODS.index(e["mood"]), e["length"] != "short", e["seed"]))

    # the instrument: each palette pitch's Recording, alone
    manifest = {r["id"]: r for r in json.loads(engine.MANIFEST.read_text())["recordings"]}
    recordings = {}
    for inp in INPUTS:
        for s in libs[inp["id"]][0]:
            if s.id not in recordings:
                recordings[s.id] = {
                    "id": s.id,
                    "pitch_midi": round(s.ref_midi, 2),
                    "shortest_note_s": s.min_note_s,
                    "seconds": round(s.seconds, 2),
                    "source": manifest[s.id]["source"],
                    "audio": encode(s.audio / np.abs(s.audio).max() * 0.89, f"rec-{s.id}"),
                }

    summary = {c: {inp["id"]: summarize([e for e in entries if e["cand"] == c and e["input"] == inp["id"]]) for inp in INPUTS} for c in CANDIDATES}
    for c in CANDIDATES:
        summary[c]["all"] = summarize([e for e in entries if e["cand"] == c])
    data = {
        "candidates": CANDIDATES,
        "inputs": [{k: v for k, v in i.items()} for i in INPUTS],
        "palettes": {i["id"]: {m: palette_dict(p) for m, p in libs[i["id"]][1].items()} for i in INPUTS},
        "recordings": recordings,
        "renders": entries,
        "summary": summary,
        "determinism": determinism,
        "settings": {"bpm": rules.MOOD_BPM, "llm_top_k": llm.TOP_K, "llm_temperature": llm.TEMPERATURE},
    }
    shutil.copy(HERE / "listen/index.html", OUT / "index.html")
    (OUT / "data.js").write_text("window.AICOMPOSE = " + json.dumps(data, ensure_ascii=False) + ";\n")

    for c in CANDIDATES:
        s = summary[c]["all"]
        print(f"{c}: {s}")
    for c, d in determinism.items():
        print(f"determinism {c}: {d}")
    print(f"wrote {OUT} in {time.time() - t0:.0f} s")


if __name__ == "__main__":
    main()
