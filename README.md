# Internal Fixture Library loading proof

> THROWAWAY PROTOTYPE — this branch is evidence for the Wayfinder decision, not production code.

## Question

Can an Internal Tester repeatably install and verify the approved 23-Recording
Fixture Library on a physical iPhone while keeping the capability and bundled
audio absent from regular-user builds?

The prototype preserves the approved Recorder proof as its base. It adds a
separate `PedosInternalFixtureProof` target that alone contains:

- the explicit “Seed or refresh Fixture Library” control;
- the approved manifest and its exact 23 audio files;
- atomic replacement into `Application Support/FixtureLibrary`;
- count, decode, and on-device playback verification.

The regular `PedosRecorderProof` target excludes both the seeder implementation
and Fixture Library resources.

## Run on the Internal Tester’s iPhone

1. Run `xcodegen generate`.
2. Open `PedosRecorderProof.xcodeproj`.
3. Select the `PedosInternalFixtureProof` scheme and the physical iPhone.
4. Press Run. If prompted, select the development team used for device signing.
5. Tap **Seed or refresh Fixture Library**.

For repeatable CLI verification, launch the internal app with
`--seed-fixture-library`; the internal target seeds immediately and logs the
verified installed count.

## Verification checklist

1. Confirm the status says **Installed and verified 23 approved Recordings**.
2. Play several entries, including one MP3 and one WAV Recording.
3. Force-quit and relaunch; confirm the installed count remains 23 and playback still works.
4. Tap **Seed or refresh Fixture Library** again; confirm the count remains exactly 23.
5. Build `PedosRecorderProof`; inspect its app bundle and confirm it contains no
   `FixtureLibrary` directory or `approved-recordings.json`.
