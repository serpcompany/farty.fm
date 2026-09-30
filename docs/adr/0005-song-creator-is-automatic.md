# Song Creator is automatic: no piano-roll editing in the MVP

A piano roll for dragging Recordings onto notes was planned for two reasons: to rescue melodies that sounded bad when generated automatically, and because fully automatic creation seemed to leave the user nothing to do (see tag `archive/codex/midi-piano-roll-prototype`). The accepted engine (ADR 0004) makes Auto-map sound good on its own, and Pitch Coverage and Unlocked Songs give the user the thing to do: collect Melodic Recordings to unlock more Songs. So the product owner dropped manual editing on 2026-09-29. Song Creator is: pick a Song, hear it played by your Recordings, save it. Anyone proposing a piano roll again should first show that collecting and unlocking isn't enough.

This all sits inside the approved Capture Dock structure: capture is always one tap away, with a stable dock for the Recording shelf, creation, and Created Melodies (tag `archive/prototype/end-to-end-mvp-interaction`, variant A).
