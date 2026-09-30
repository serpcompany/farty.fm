"""Deterministic MIDI -> monophonic melody plan importer.

Every melody comes from a checked-in source MIDI file. The importer never invents notes:
it selects one track, keeps the highest note at each onset ("skyline"), clips overlaps,
and reports everything it discarded so nothing is silently dropped.
"""
from dataclasses import dataclass, field
from pathlib import Path

import mido


@dataclass
class Note:
    start: float  # beats
    dur: float  # beats
    pitch: int  # MIDI


@dataclass
class Melody:
    title: str
    bpm: float
    beats_per_bar: int
    notes: list
    report: dict = field(default_factory=dict)

    @property
    def length_beats(self):
        return max(n.start + n.dur for n in self.notes)


def load_midi(path, track=None, title=None, bpm=None, max_beats=None, start_beat=0.0, beats_per_bar=None):
    beats_per_bar_arg = beats_per_bar
    mid = mido.MidiFile(path)
    tpb = mid.ticks_per_beat
    tempo_us, beats_per_bar, tempo_changes = 500000, 4, 0
    events = {}  # track index -> list of (start_tick, end_tick, pitch)
    for ti, trk in enumerate(mid.tracks):
        tick, open_notes, done = 0, {}, []
        for msg in trk:
            tick += msg.time
            if msg.type == "set_tempo":
                if tick == 0:
                    tempo_us = msg.tempo
                else:
                    tempo_changes += 1
            elif msg.type == "time_signature" and tick == 0:
                beats_per_bar = msg.numerator
            elif msg.type == "note_on" and msg.velocity > 0:
                open_notes.setdefault((msg.channel, msg.note), []).append(tick)
            elif msg.type in ("note_off", "note_on"):
                starts = open_notes.get((msg.channel, msg.note))
                if starts:
                    done.append((starts.pop(0), tick, msg.note))
        done = [d for d in done if d[1] > d[0]]  # zero-length notes carry no sound
        if done:
            events[ti] = sorted(done)
    if track is None:  # default: the track with the highest mean pitch (usually the tune)
        track = max(events, key=lambda t: sum(p for _, _, p in events[t]) / len(events[t]))
    raw = events[track]

    # Sustain-aware skyline: a new melody note starts only when the highest *sounding*
    # pitch is a note that begins at this onset. Inner-voice onsets under a held top note
    # are dropped (and counted) instead of chopping the melody note.
    onsets = sorted({s for s, _, _ in raw})
    top = []
    dropped_chord_tones = dropped_inner_onsets = 0
    for s in onsets:
        sounding = [(p, st, e) for st, e, p in raw if st <= s < e]
        p, st, e = max(sounding)
        starting_here = sum(1 for _, st2, _ in sounding if st2 == s)
        if st == s:
            top.append([s, e, p])
            dropped_chord_tones += starting_here - 1
        else:
            dropped_inner_onsets += starting_here
    # Engraving software exports notes slightly short of their written value (articulation).
    # A note's slot runs to the next onset unless a real rest follows (a gap of a full beat,
    # or a gap longer than the note itself).
    grid = tpb / 48
    q = lambda x: round(x / grid) * grid
    notes, clipped = [], 0
    for i, (s, e, p) in enumerate(top):
        nxt = top[i + 1][0] if i + 1 < len(top) else None
        if nxt is not None and e > nxt:
            e, clipped = nxt, clipped + 1
        elif nxt is not None and nxt - e < tpb and nxt - e <= 1.1 * (e - s):
            e = nxt
        notes.append(Note(q(s) / tpb, max(grid, q(e) - q(s)) / tpb, p))

    notes = [Note(n.start - start_beat, n.dur, n.pitch) for n in notes if n.start >= start_beat]
    if max_beats is not None:
        notes = [n for n in notes if n.start < max_beats]
    return Melody(
        title=title or Path(path).stem,
        bpm=bpm or round(60_000_000 / tempo_us, 2),
        beats_per_bar=beats_per_bar_arg or beats_per_bar,
        notes=notes,
        report={
            "source_file": str(path),
            "track_used": track,
            "tracks_with_notes": sorted(events),
            "chord_tones_dropped": dropped_chord_tones,
            "inner_voice_onsets_dropped": dropped_inner_onsets,
            "overlaps_clipped": clipped,
            "tempo_changes_ignored": tempo_changes,
            "note_count": len(notes),
        },
    )


def load_catalog(path=Path(__file__).resolve().parents[2] / "catalog/catalog.json"):
    import json

    out = []
    for c in json.loads(Path(path).read_text()):
        m = load_midi(Path(path).parent / c["file"], title=c["title"], **c.get("render", {}))
        m.report["catalog_id"] = c["id"]
        out.append((c, m))
    return out
