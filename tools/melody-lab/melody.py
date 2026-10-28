import json
from dataclasses import dataclass, field
from pathlib import Path

import mido

CATALOG = Path(__file__).resolve().parents[2] / "catalog/catalog.json"
DEFAULT_TEMPO_US = 500000
DEFAULT_BEATS_PER_BAR = 4
GRID_PER_BEAT = 48
EPS = 1e-6


@dataclass
class Note:
    start: float
    dur: float
    pitch: int


@dataclass
class Melody:
    title: str
    bpm: float
    beats_per_bar: int
    notes: list
    bar_lines: list
    report: dict = field(default_factory=dict)

    @property
    def length_beats(self):
        return max(n.start + n.dur for n in self.notes)


@dataclass
class ScoreEvents:
    notes_by_track: dict
    tempo_us: int = DEFAULT_TEMPO_US
    beats_per_bar: int = DEFAULT_BEATS_PER_BAR
    tempo_changes: int = 0
    meters: dict = field(default_factory=dict)


@dataclass(frozen=True)
class Bar:
    line: float
    length: float
    whole_segment: bool


def opening_meter(meters):
    meters = sorted(meters)
    if not meters or meters[0][0] > EPS:
        meters.insert(0, (0.0, 4, 4))
    return meters


def bars_through(meters, until):
    bars = []
    for i, (at, num, den) in enumerate(meters):
        end = meters[i + 1][0] if i + 1 < len(meters) else float("inf")
        length, line = num * 4 / den, at
        while line < end - EPS and (not bars or bars[-1].line < until - EPS):
            size = min(length, end - line)
            bars.append(Bar(line, size, abs(line - at) < EPS and line + size > end - EPS))
            line += length
    return bars


def completes_split_bar(before, bar, after):
    return before.whole_segment and abs(before.length + bar.length - after.length) < EPS


def is_pickup(bars, i):
    if i + 1 == len(bars) or bars[i].length >= bars[i + 1].length - EPS:
        return False
    return i == 0 or completes_split_bar(bars[i - 1], bars[i], bars[i + 1])


def bar_lines(meters, until):
    bars = bars_through(opening_meter(meters), until)
    return [bar.line for i, bar in enumerate(bars) if bar.line < until - EPS and not is_pickup(bars, i)]


def track_notes(track, score):
    tick, open_notes, done = 0, {}, []
    for msg in track:
        tick += msg.time
        if msg.type == "set_tempo":
            if tick == 0:
                score.tempo_us = msg.tempo
            else:
                score.tempo_changes += 1
        elif msg.type == "time_signature":
            score.meters[tick] = (msg.numerator, msg.denominator)
            if tick == 0:
                score.beats_per_bar = msg.numerator
        elif msg.type == "note_on" and msg.velocity > 0:
            open_notes.setdefault((msg.channel, msg.note), []).append(tick)
        elif msg.type in ("note_off", "note_on"):
            starts = open_notes.get((msg.channel, msg.note))
            if starts:
                done.append((starts.pop(0), tick, msg.note))
    return [d for d in done if d[1] > d[0]]


def read_score(mid):
    score = ScoreEvents({})
    for ti, trk in enumerate(mid.tracks):
        done = track_notes(trk, score)
        if done:
            score.notes_by_track[ti] = sorted(done)
    return score


def highest_track(notes_by_track):
    return max(notes_by_track, key=lambda t: sum(p for _, _, p in notes_by_track[t]) / len(notes_by_track[t]))


def skyline(raw):
    top = []
    dropped_chord_tones = dropped_inner_onsets = 0
    for s in sorted({s for s, _, _ in raw}):
        sounding = [(p, st, e) for st, e, p in raw if st <= s < e]
        p, st, e = max(sounding)
        starting_here = sum(1 for _, st2, _ in sounding if st2 == s)
        if st == s:
            top.append([s, e, p])
            dropped_chord_tones += starting_here - 1
        else:
            dropped_inner_onsets += starting_here
    return top, dropped_chord_tones, dropped_inner_onsets


def snap(x, grid):
    return round(x / grid) * grid


def closes_articulation_gap(start, end, next_onset, tpb):
    return next_onset - end < tpb and next_onset - end <= 1.1 * (end - start)


def slot_notes(top, tpb):
    grid = tpb / GRID_PER_BEAT
    notes, clipped = [], 0
    for i, (s, e, p) in enumerate(top):
        nxt = top[i + 1][0] if i + 1 < len(top) else None
        if nxt is not None and e > nxt:
            e, clipped = nxt, clipped + 1
        elif nxt is not None and closes_articulation_gap(s, e, nxt, tpb):
            e = nxt
        notes.append(Note(snap(s, grid) / tpb, max(grid, snap(e, grid) - snap(s, grid)) / tpb, p))
    return notes, clipped


def excerpt_bar_lines(score, tpb, start_beat, notes):
    until = start_beat + max((n.start + n.dur for n in notes), default=0.0)
    lines = bar_lines([(tick / tpb, *meter) for tick, meter in score.meters.items()], until)
    return [line - start_beat for line in lines if line > start_beat - EPS]


def load_midi(path, track=None, title=None, bpm=None, max_beats=None, start_beat=0.0, beats_per_bar=None):
    mid = mido.MidiFile(path)
    score = read_score(mid)
    if track is None:
        track = highest_track(score.notes_by_track)
    top, dropped_chord_tones, dropped_inner_onsets = skyline(score.notes_by_track[track])
    notes, clipped = slot_notes(top, mid.ticks_per_beat)
    notes = [Note(n.start - start_beat, n.dur, n.pitch) for n in notes if n.start >= start_beat]
    if max_beats is not None:
        notes = [n for n in notes if n.start < max_beats]
    return Melody(
        title=title or Path(path).stem,
        bpm=bpm or round(60_000_000 / score.tempo_us, 2),
        beats_per_bar=beats_per_bar or score.beats_per_bar,
        notes=notes,
        report={
            "source_file": str(path),
            "track_used": track,
            "tracks_with_notes": sorted(score.notes_by_track),
            "chord_tones_dropped": dropped_chord_tones,
            "inner_voice_onsets_dropped": dropped_inner_onsets,
            "overlaps_clipped": clipped,
            "tempo_changes_ignored": score.tempo_changes,
            "note_count": len(notes),
        },
        bar_lines=excerpt_bar_lines(score, mid.ticks_per_beat, start_beat, notes),
    )


def load_catalog(path=CATALOG):
    out = []
    for c in json.loads(Path(path).read_text(encoding="utf-8")):
        m = load_midi(Path(path).parent / c["file"], title=c["title"], **c.get("render", {}))
        m.report["catalog_id"] = c["id"]
        out.append((c, m))
    return out
