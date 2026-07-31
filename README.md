# Post-save Recording Analysis proof

> THROWAWAY PROTOTYPE — this branch is evidence for the Wayfinder decision, not production code.

## Current proof

The current task is the reusable analysis API in `RecordingAnalysisKit/`. It
reports duration, optional pitch evidence, named dBFS level measurements, and
detected sound start/end. Run:

```sh
swift test --package-path RecordingAnalysisKit
zsh Tools/run-recording-analysis-library
```

The later comparative-rendering section is retained as superseded throwaway
history. It is not a product-owner acceptance task.

## Question

Can an independent, on-device post-save process extract and preserve the characteristics needed for Melody Fit and fart-only rendering—usable duration, relative level, brightness, and a confidence-gated pitch profile—without coupling capture to analysis or decoding the Recording again on every launch?

This proof extends the already-approved Recorder proof. Saving still completes by moving the approved `.m4a` file into `Application Support/Recordings`. Only after that move succeeds does a separate analysis task decode the saved Recording. The result is versioned JSON in the separate `Application Support/RecordingAnalysis` directory.

The analysis record is reused while the audio file's size and modification date match. A schema-version change or audio revision mismatch makes it missing rather than silently trusting stale characteristics.

The archived first attempt is evidence, not the current decision. It taught two lessons this proof carries forward:

- spectral brightness must not masquerade as fundamental pitch;
- noisy Recordings need an explicit pitch-confidence result, including “not confidently pitched.”

## Run

```sh
open PedosRecorderProof.xcodeproj
```

Choose an iPhone Simulator or physical iPhone and press Run.

For repeatable Simulator automation, the prototype also accepts
`--install-analysis-cases --analyze-missing` as launch arguments.

## Prototype controls

- **Install 3 controlled analysis cases** copies three bundled audio cases into the prototype's Recording shelf. They are proof inputs only, not a regular-user starter library or the Fixture Library capability.
- **Analyze every missing Recording** runs the on-device analysis once per missing item.
- **Forget preserved analysis** deletes only the prototype's analysis JSON so the same audio can be analyzed again.

Each Recording shows the full relevant state: usable region, RMS and peak dBFS, brightness, reference note or “not confidently pitched,” pitch confidence, voiced-frame ratio, schema version, and audio revision.

## Human review checklist

1. Install the controlled cases and play all three so the measurements can be compared with the actual sounds.
2. Analyze every missing Recording. Confirm the UI remains responsive and every case reaches either a measured result or an explicit failure.
3. Treat pitch as usable only when the displayed confidence and what you hear agree. A noisy case returning “not confidently pitched” is a valid result.
4. Terminate the app and relaunch it. Confirm each result says **preserved JSON**, **Fresh analyses this launch** remains `0`, and no audible or visible playback/capture behavior changed.
5. Capture, preview, and save a new Recording. Confirm it appears on the shelf immediately, then gains a separate **fresh analysis** result.
6. Delete a Recording, relaunch, and confirm its audio and analysis record are both gone.
7. Use **Forget preserved analysis** and confirm the audio remains playable while its analysis state becomes missing.

The decision is ready only after the product owner confirms that these preserved characteristics are credible enough to drive the next Melody Fit and rendering proof.

## Approved Fixture Library review

Run the exact on-device analyzer logic across all 23 approved Recordings:

```sh
zsh Tools/run-fixture-analysis
```

The command extracts the committed Fixture Library from
`prototype/internal-fixture-library`, writes
`Evidence/recording-analysis-corpus.json`, and opens a terminal review loop.
Use `p` to play or stop the selected Recording, then compare what you hear with
its usable region, level, brightness, confidence-gated reference pitch, and
stable detected pitch bounds. The extracted audio lives only in a temporary
directory and is removed when the review exits.

For a non-interactive evidence refresh:

```sh
zsh Tools/run-fixture-analysis --batch
```

## Comparative rendering proof

The first corpus run only proves that `windowed-yin-v2` executes. It does not
prove that its observations improve a Created Melody. Run the throwaway logic
comparison:

```sh
zsh Tools/run-comparative-rendering
```

The command exports three deliberately blind renders under
`Evidence/comparative-rendering/` using the same fixed pitch contour:

- the existing `windowed-yin-v2` candidate;
- a second, paper-shaped YIN interpretation with a stricter periodicity gate;
- a duration-only control that uses one unanalysed Recording, relative pitch
  shifts, no sound-boundary detection, and no gain matching.

Listen to `blind-1.wav`, `blind-2.wav`, and `blind-3.wav` before opening
`answer-key.txt`. The comparison is not approval of the challenger, its
thresholds, the note contour, looping, or the renderer. It asks the smaller
question: does either analysis-assisted plan sound more melody-shaped and
consistently levelled than the control while retaining fart character?

`comparison-evidence.json` surfaces the full relevant state for every note:
source Recording, detected source pitch, applied shift, gain, and detected
sound boundaries. The original Fixture Library files remain unchanged.
