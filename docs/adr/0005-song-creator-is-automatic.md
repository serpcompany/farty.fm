# Song Creator is automatic: no piano-roll editing in the MVP

A piano roll for dragging Recordings onto notes was planned for two reasons: to rescue melodies that sounded bad when generated automatically, and because fully automatic creation seemed to leave the user nothing to do (see tag `archive/codex/midi-piano-roll-prototype`). The accepted engine (ADR 0004) makes Auto-map sound good on its own, and Pitch Coverage and Unlocked Songs give the user the thing to do: collect Melodic Recordings to unlock more Songs. So the product owner dropped manual editing on 2026-09-29. Song Creator is: pick a Song, hear it played by your Recordings, save it. Anyone proposing a piano roll again should first show that collecting and unlocking isn't enough.

This all sits inside the capture-first structure first approved in #2 (tag `archive/prototype/end-to-end-mvp-interaction`, variant A) and refined in #47: four tabs, Record (opens first), Recordings, Compose and Melodies. The app map it was drawn in is retired (2026-10-27); the app as built, with its checks, is in [the product docs](../../apps/web/docs/product/README.md).

Update 2026-09-30: the owner renamed the Melodies tab to Toots, and a saved result is a Toot (`CONTEXT.md`, #52).

Update 2026-09-30: there are now five tabs, left to right: Recordings, Compose, Record (in the center, and still opening first), Toots and Profile (#60).
