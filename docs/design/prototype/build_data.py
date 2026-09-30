"""Build the design prototype's data and audio from the melody lab.

Run from the repo root after `tools/melody-lab/build.py` has produced out/listen/:
    tools/melody-lab/.venv/bin/python docs/design/prototype/build_data.py
"""
import json
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
LAB = HERE.parents[2] / "tools/melody-lab"
sys.path.insert(0, str(LAB))

import engine  # noqa: E402
from melody import load_catalog  # noqa: E402

LISTEN = LAB / "out/listen"
# The order simulated recordings arrive in: a noise-like one first, then pitches that
# unlock Songs step by step, with a second noise-like one mixed in.
STORY = ["069", "021", "090", "052", "094", "059", "019", "086", "017", "084", "013", "002"]


def main():
    lab = json.loads((LISTEN / "data.js").read_text().removeprefix("window.PEDOS = ").rstrip(";\n"))
    lib = {s.id: s for s in engine.load_library()}
    audio = HERE / "audio"
    audio.mkdir(exist_ok=True)

    recordings = []
    for r in lab["recordings"]:
        s = lib[r["id"]]
        shutil.copy(LISTEN / r["audio"], audio / f"rec-{r['id']}.mp3")
        recordings.append(
            {
                "id": r["id"],
                "melodic": s.pitched,
                "midi": round(s.ref_midi, 2) if s.pitched else None,
                "seconds": round(s.seconds, 2),
                "cut": s.cut_at_reattack,
                "audio": f"audio/rec-{r['id']}.mp3",
            }
        )

    titles = {c["id"]: m for c, m in load_catalog()}
    songs = []
    for s in lab["songs"]:
        tuned = s["variants"]["tuned"]
        shutil.copy(LISTEN / tuned["audio"], audio / f"song-{s['id']}.mp3")
        src = s["source"]
        songs.append(
            {
                "id": s["id"],
                "title": s["title"],
                "pitches": sorted({n.pitch for n in titles[s["id"]].notes}),
                "notes": [{"s": n["start"], "d": n["dur"], "m": n["midi"], "r": n["rec"]} for n in tuned["notes"]],
                "bpm": s["bpm"],
                "audio": f"audio/song-{s['id']}.mp3",
                "source": "Public domain score · PDMX" if "musescore_url" in src else "Public domain score · Mutopia",
            }
        )

    data = {"recordings": recordings, "songs": songs, "story": STORY}
    (HERE / "data.js").write_text("window.PROTO = " + json.dumps(data, ensure_ascii=False) + ";\n")
    print(len(recordings), "recordings,", len(songs), "songs,", sum(1 for _ in audio.iterdir()), "audio files")


if __name__ == "__main__":
    main()
