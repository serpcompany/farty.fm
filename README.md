# Recorder and local persistence proof

> THROWAWAY PROTOTYPE — this branch is evidence for the Wayfinder decision, not production code.

## Question

Does a minimal native iPhone approach using `AVAudioRecorder` plus sandboxed files reliably support the complete independent Recorder loop: capture one fart, preview it before saving, save it locally, rebuild the Recording shelf after relaunch, replay it, and delete it—without coupling capture or persistence to Recording Analysis?

The prototype deliberately excludes Recording Analysis, Siri, auto-start, accounts, cloud storage, media editing, and creator features.

## Run

```sh
xcodegen generate
open PedosRecorderProof.xcodeproj
```

Choose your iPhone and press Run. Xcode may ask you to choose your development team for device signing.

The iOS Simulator can exercise capture, preview, save, relaunch persistence,
replay, and deletion. Its automated microphone permission callback is bypassed
because that callback can remain pending after simulator privacy access is
pre-granted; physical-device builds still use the real system permission flow.

## Human review checklist

Run these checks on a physical iPhone:

1. Grant microphone permission, capture exactly one fart, stop, preview it, and save it.
2. Force-quit and relaunch. Confirm the Recording remains and replays.
3. Capture another Recording, preview it, then discard it. Relaunch and confirm it never appears.
4. Delete a saved Recording. Relaunch and confirm it stays deleted.
5. Deny microphone permission once and confirm the app reports the failure without pretending to record.
6. Repeat capture/save/replay at least three times and note any silent, truncated, missing, duplicated, or undeletable Recording.

The prototype exposes its current phase, draft filename, persistent directory, and saved count in a state panel so unexpected transitions are visible during review.
