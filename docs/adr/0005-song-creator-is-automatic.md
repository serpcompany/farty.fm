# Song Creator is automatic: no piano-roll editing in the MVP

A piano roll for dragging Recordings onto notes was planned as a way to rescue melodies that sounded bad when generated automatically (see tag `archive/codex/midi-piano-roll-prototype`). The accepted engine (ADR 0004) makes Auto-map sound good on its own, so the product owner dropped manual editing on 2026-09-30. Song Creator is: pick a Song, hear it played by your Recordings, save it. The user improves results by recording more Melodic Recordings, which Pitch Coverage and Unlocked Songs encourage, not by editing notes.

This all sits inside the approved Capture Dock structure: capture is always one tap away, with a stable dock for the Recording shelf, creation, and Created Melodies (tag `archive/prototype/end-to-end-mvp-interaction`, variant A).
