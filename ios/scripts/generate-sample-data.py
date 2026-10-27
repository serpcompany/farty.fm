#!/usr/bin/env python3
"""Generate the app's sample data from the design prototype's data and the golden data.

Reads docs/design/prototype/data.js (built from the Fixture Library by the melody lab, #47) and
the reference engine's golden data at format 2 (RecordingAnalysisKit/Tests/GoldenFormat2/, where
Swift is frozen: its Recordings and Songs), and writes ios/Pedos/Sample/SampleData.generated.swift:

- the prototype's Songs with their distinct pitches, their notes, tempo and beats per bar;
- each Fixture Library Recording's file and its Recording Analysis, as the reference engine
  computes it (the gesture, the Recording Pitch and the shortest note it plays on pitch), so the
  sample model plays, Auto-maps and renders the real fixture files (Debug only);
- the story order simulated recordings follow (Debug only).

The prototype's notes are the melody lab's render of each catalog score, moved into the
Recordings' range. They're moved back into the score's key here, and checked against the
Song's distinct pitches and the golden copy of the score, so they can't disagree.

Run from anywhere:
    ios/scripts/generate-sample-data.py           # rewrite the Swift file
    ios/scripts/generate-sample-data.py --check   # fail if the Swift file is out of date
"""
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
SOURCE = REPO / "docs/design/prototype/data.js"
# Swift is frozen at golden format 2 (RecordingAnalysisKit/Tests/GoldenFormat2/README.md).
GOLDEN = REPO / "RecordingAnalysisKit/Tests/GoldenFormat2"
FIXTURES = REPO / "fixtures/recordings"
OUTPUT = REPO / "ios/Pedos/Sample/SampleData.generated.swift"


def swift_string(text):
    return json.dumps(text, ensure_ascii=False)


def swift_double(value):
    return repr(float(value))


def swift_optional_double(value):
    return "nil" if value is None else swift_double(value)


def score_notes(song):
    """The Song's notes in the score's key: the render moved every note by the same interval."""
    rendered = sorted({n["m"] for n in song["notes"]})
    shifts = {m - p for m, p in zip(rendered, song["pitches"])}
    if len(rendered) != len(song["pitches"]) or len(shifts) != 1:
        sys.exit(f"error: Song {song['id']} notes don't match its pitches {song['pitches']}")
    shift = shifts.pop()
    notes = [(n["s"], n["d"], n["m"] - shift) for n in song["notes"]]
    if notes != sorted(notes, key=lambda n: n[0]) or any(d <= 0 for _, d, _ in notes):
        sys.exit(f"error: Song {song['id']} notes aren't in time order with positive lengths")
    return notes


def load():
    text = SOURCE.read_text(encoding="utf-8").strip()
    prefix = "window.PROTO = "
    if not text.startswith(prefix) or not text.endswith(";"):
        sys.exit(f"error: {SOURCE} doesn't look like the prototype's data.js")
    return json.loads(text[len(prefix):-1])


def golden(kind, item_id):
    path = GOLDEN / kind / f"{item_id}.json"
    if not path.is_file():
        sys.exit(f"error: no golden data {path.relative_to(REPO)}")
    return json.loads(path.read_text(encoding="utf-8"))


def golden_song(song):
    """The golden copy of the score, checked against the prototype's notes and tempo."""
    score = golden("songs", song["id"])
    notes = [(n["start"], n["dur"], n["pitch"]) for n in score["notes"]]
    if notes != score_notes(song):
        sys.exit(f"error: Song {song['id']} notes differ from {GOLDEN.relative_to(REPO)}/songs/{song['id']}.json")
    if score["bpm"] != song["bpm"]:
        sys.exit(f"error: Song {song['id']} is {song['bpm']} bpm in the prototype, {score['bpm']} in the golden data")
    return score


def golden_recording(recording):
    """The reference engine's analysis of a fixture, checked against the prototype's."""
    analysis = golden("recordings", recording["id"])
    pitch = analysis["recording_pitch_midi"]
    if (pitch is None) != (recording["midi"] is None) or (pitch is not None and round(pitch, 2) != recording["midi"]):
        sys.exit(f"error: Recording {recording['id']} pitch {recording['midi']} differs from the golden {pitch}")
    if analysis["gesture"]["cut_at_reattack"] != recording["cut"]:
        sys.exit(f"error: Recording {recording['id']} first-fart flag differs from the golden data")
    if (analysis["shortest_note_s"] is None) != (pitch is None):
        sys.exit(f"error: Recording {recording['id']} has a pitch but no shortest note, or the reverse")
    if not (FIXTURES / analysis["file"]["name"]).is_file():
        sys.exit(f"error: no fixture file {analysis['file']['name']} in {FIXTURES.relative_to(REPO)}")
    return analysis


def render(data):
    recordings, songs, story = data["recordings"], data["songs"], data["story"]
    ids = {r["id"] for r in recordings}
    for r in recordings:
        if r["melodic"] != (r["midi"] is not None):
            sys.exit(f"error: Recording {r['id']} is melodic={r['melodic']} with midi={r['midi']}")
    for fixture_id in story:
        if fixture_id not in ids:
            sys.exit(f"error: story names unknown Recording {fixture_id}")
    for s in songs:
        if s["pitches"] != sorted(set(s["pitches"])):
            sys.exit(f"error: Song {s['id']} pitches aren't distinct and sorted")

    lines = [
        "// Generated by ios/scripts/generate-sample-data.py from docs/design/prototype/data.js and",
        "// fixtures/golden/. Do not edit by hand: rerun the script instead.",
        "",
        "extension Song {",
        "    /// The design prototype's Songs (#47), with each Song's distinct pitches as MIDI note",
        "    /// numbers and its notes (start and length in beats). They stand in for the Song Catalog",
        "    /// until #38 bundles it.",
        "    static let prototypeCatalog: [Song] = [",
    ]
    for s in songs:
        score = golden_song(s)
        lines += [
            "        Song(",
            f"            id: {swift_string(s['id'])}, title: {swift_string(s['title'])}, "
            f"pitches: {json.dumps(s['pitches'])},",
            f"            source: {swift_string(s['source'])}, bpm: {s['bpm']}, beatsPerBar: {score['beats_per_bar']},",
            "            notes: [",
        ]
        notes = [
            f"Note(start: {swift_double(start)}, length: {swift_double(length)}, pitch: {pitch})"
            for start, length, pitch in score_notes(s)
        ]
        for i in range(0, len(notes), 3):
            lines.append("                " + ", ".join(notes[i:i + 3]) + ",")
        lines += [
            "            ]",
            "        ),",
        ]
    lines += [
        "    ]",
        "}",
        "",
        "#if INTERNAL",
        "extension SampleFixture {",
        "    /// Every Fixture Library Recording: its file, and its Recording Analysis as the reference",
        "    /// engine computed it at golden format 2 (`RecordingAnalysisKit/Tests/GoldenFormat2/recordings/`).",
        "    static let prototypeLibrary: [SampleFixture] = [",
    ]
    for r in recordings:
        analysis = golden_recording(r)
        gesture, file = analysis["gesture"], analysis["file"]
        lines += [
            f"        SampleFixture(",
            f"            id: {swift_string(r['id'])}, file: {swift_string(file['name'])},",
            f"            seconds: {swift_double(file['frames'] / file['sample_rate'])}, "
            f"gestureSamples: {gesture['start_sample']}..<{gesture['end_sample']}, "
            f"firstFartUsed: {'true' if gesture['cut_at_reattack'] else 'false'},",
            f"            pitch: {swift_optional_double(analysis['recording_pitch_midi'])}, "
            f"shortestNoteSeconds: {swift_optional_double(analysis['shortest_note_s'])}",
            "        ),",
        ]
    lines += [
        "    ]",
        "",
        "    /// The order simulated recordings arrive in: a noise-like one first, then pitches that",
        "    /// unlock Songs step by step.",
        f"    static let prototypeStory: [String] = [{', '.join(swift_string(i) for i in story)}]",
        "}",
        "#endif",
        "",
    ]
    return "\n".join(lines)


def main():
    swift = render(load())
    if "--check" in sys.argv[1:]:
        current = OUTPUT.read_text(encoding="utf-8") if OUTPUT.exists() else ""
        if current != swift:
            sys.exit(f"error: {OUTPUT.relative_to(REPO)} is out of date; run ios/scripts/generate-sample-data.py")
        print(f"ok    {OUTPUT.relative_to(REPO)} matches {SOURCE.relative_to(REPO)} and {GOLDEN.relative_to(REPO)}")
        return
    OUTPUT.write_text(swift, encoding="utf-8")
    print(f"wrote {OUTPUT.relative_to(REPO)}")


if __name__ == "__main__":
    main()
