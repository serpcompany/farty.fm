# MIDI Piano Roll UI — throwaway prototype

> Question: would a built-in MIDI melody plus auto-filled, optional note-level clip swapping be easier and more successful than asking the renderer to invent a recognizable melody from the recordings?

This is deliberately disposable UI code on `codex/midi-piano-roll-prototype`. It explores three structurally different mobile Song Maker surfaces on one route:

- `?variant=A` — guided auto-fill first, then optional note-level swaps (recommended starting point)
- `?variant=B` — a denser clip-lane workbench, closer to a tiny DAW
- `?variant=C` — a one-note-at-a-time assignment flow for users who do not understand piano rolls
- `?variant=D` — the selected A+B hybrid: auto-map first, then a functional arranger

All variants share in-memory state. Drag a source clip onto a note on desktop, or tap a clip and then a note on mobile. **Auto Map** restores a complete suggested mapping. Note and song audition use tracked local sample audio and small `playbackRate` changes matching the displayed cent offsets.

Variant D is the working editor experiment. It supports four song templates
(`Ode to Joy`, `Mary Had a Little Lamb`, `Twinkle Twinkle Little Star`, and
`Jingle Bells`), source replacement, note-to-note clip swaps, note reordering,
adding, duplication, clip removal, note deletion, pitch/duration/accent edits,
bounded pitch correction, and undo/redo. State is intentionally memory-only.

The prototype uses hand-authored MIDI-like event lists for old/public-domain
song openings. This validates the interaction only. It does not establish a
licensed MIDI catalog, production audio quality, source clearance, or release
architecture.

Run from the repository root:

```sh
Tools/run-midi-piano-roll-prototype
```

Optionally pass a different port:

```sh
Tools/run-midi-piano-roll-prototype 4180
```
