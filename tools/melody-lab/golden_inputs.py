import numpy as np

from analysis import Source
from golden_cost import load
from melody import Melody, Note

INDEX = load("index.json")
SONGS = {s["id"]: load(f"songs/{s['id']}.json") for s in INDEX["songs"]}


def golden_melody(song):
    notes = [Note(n["start"], n["dur"], n["pitch"]) for n in song["notes"]]
    return Melody(song["title"], song["bpm"], song["beats_per_bar"], notes, song["bar_lines"])


def source(rid, ref_midi, samples, min_note_s, settle_s, audio=None):
    audio = np.zeros(samples, dtype=np.float32) if audio is None else audio
    return Source(rid, False, audio, np.zeros(0), ref_midi, 1.0, 0.0, min_note_s=min_note_s, settle_s=settle_s)


def golden_source(rid):
    r = load(f"recordings/{rid}.json")
    g = r["gesture"]
    if not r["melodic"]:
        return source(rid, None, g["end_sample"] - g["start_sample"], 0.0, 0.0)
    return source(rid, r["recording_pitch_midi"], g["end_sample"] - g["start_sample"], r["shortest_note_s"], r["settle_s"])


def golden_library(name):
    return [golden_source(rid) for rid in INDEX["libraries"][name]]

