# Native iPhone Simulator evidence

The `PedosMIDIArrangerPrototype` target was generated with XcodeGen, built with
Xcode 26, installed, and launched on the iOS 26.0 `iPhone 17 Pro` Simulator.

## Redesigned studio UI

The 2026-08-26 redesign replaces the vertically stacked prototype cards with a
single focused music-making workspace:

- compact song, history, transport, Auto Map, and Add Note controls;
- a recording shelf that keeps draggable source audio immediately available;
- a dark piano roll with sticky pitch labels as the largest visual surface;
- a compact selected-note dock; and
- a native partial-sheet inspector for pitch, length, accent, pitch correction,
  ordering, duplication, source removal, and deletion.

The interface uses native SwiftUI components and a small semantic token system.
No third-party component dependency or blanket Liquid Glass treatment was added.

## Simulator verification

The final source built and launched successfully through XcodeBuildMCP. Observed
interactions on the running app:

- dragging `Round 013` onto note 1 changed its accessibility value from
  `E4, Smooth 016, +12 cents` to `E4, Round 013, 0 cents` after the final layout
  refinement;
- dragging note 1 onto note 2 swapped their recording IDs and correction values;
- the song menu exposed all four templates and successfully loaded
  `Twinkle Twinkle Little Star` with 14 mapped notes;
- Auto Map, Undo, Redo, Add Note, and Add-then-Undo updated the arrangement;
- bundled-audio preview changed `preview-song` from `Preview song` to
  `Stop preview` and back;
- the inspector changed Accent from Strong to Medium and exposed the pitch,
  length, correction, move, duplicate, remove, and delete controls;
- Duplicate Note inserted a second copy after note 1, selected it, and updated
  the piano roll from 15 to 16 notes without dismissing the inspector; and
- the expected accessibility identifiers remained exposed, including
  `song-picker`, `auto-map`, `preview-song`, `piano-roll`, `note-1`,
  `clip-round`, `hear-note`, `edit-note`, `pitch-correction`, `move-left`,
  `move-right`, `duplicate-note`, and `note-actions`.

## Screenshots

- `native-studio-arranger.jpg` — final launch state and primary arranger hierarchy.
- `native-studio-note-inspector.jpg` — expanded note editor after changing Accent
  to Medium.
- `native-arranger-top.jpg` and `native-arranger-after-drag.jpg` — retained
  baseline evidence from the original native prototype.

This is interaction and interface evidence only. It does not approve melody
sound quality, MIDI/catalog provenance, persistence, or production integration.

## Minimal piano-roll iteration

Owner feedback rejected the studio redesign as still too complicated. The next
iteration removes nearly all visible editor chrome:

- the top bar contains only song, Map, play, and overflow;
- undo, redo, and Add MIDI Note live in overflow;
- recordings are one thin draggable palette with no separate instructions;
- the responsive six-lane piano roll consumes all remaining iPhone height;
- every MIDI target has an orange dashed/highlighted slot behind its clip, and
  an unassigned slot reads `+ Drop`;
- selected-note tools are a single compact bottom strip; detailed controls stay
  in the optional sheet; and
- enlarged invisible slot hit areas make source drops forgiving without making
  the visible notes larger.

Final Simulator verification rebuilt successfully, source-to-note drag changed
note 1 to `Round 013, 0 cents`, and note-to-note drag still swapped corrections.

Screenshot: `native-minimal-piano-roll.jpg`.
