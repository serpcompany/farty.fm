# Song Creator is automatic: no piano-roll editing in the MVP

A piano roll for dragging Recordings onto notes was planned for two reasons: to rescue melodies that sounded bad when generated automatically, and because fully automatic creation seemed to leave the user nothing to do (see tag `archive/codex/midi-piano-roll-prototype`). The accepted engine (ADR 0004) makes Auto-map sound good on its own, and Pitch Coverage and Unlocked Songs give the user the thing to do: collect Melodic Recordings to unlock more Songs. So the product owner dropped manual editing on 2026-09-29. Song Creator is: pick a Song, hear it played by your Recordings, save it. Anyone proposing a piano roll again should first show that collecting and unlocking isn't enough.

This all sits inside the capture-first structure first approved in #2 (tag `archive/prototype/end-to-end-mvp-interaction`, variant A) and refined in #47: four tabs, Record (opens first), Recordings, Compose and Melodies. See `docs/design/app-map.md`.

Update 2026-09-30: the owner renamed the Melodies tab to Toots, and a saved result is a Toot (`CONTEXT.md`, #52).

Update 2026-09-30: there are now five tabs, left to right: Recordings, Compose, Record (in the center, and still opening first), Toots and Profile (#60).

Update 2026-11-04: in Song Creator the user can now swap the fart that plays one of a Song's pitches, or leave a fart out of the Song, and Reset to automatic undoes either (Fart Choices in `CONTEXT.md`, #360). Auto-map still arranges every pitch they haven't settled, at the transposition the Song had when they first changed it, and the pitches a change leaves without a fart are arranged again together, so one change can also move a pitch an earlier one moved. The notes are still the Song's: there is no piano roll, and no editing of notes.
