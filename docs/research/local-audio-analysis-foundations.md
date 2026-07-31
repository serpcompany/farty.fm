# Local audio analysis foundations for melodic rendering

Research for [Research local audio analysis foundations for melodic rendering](https://github.com/serpcompany/pedos-app/issues/10), checked 2026-07-31.

## Scope and conclusion

This note asks what a local, post-save Recording Analysis can credibly know about short, noisy, weakly pitched fart Recordings, which of those observations a sample-based renderer actually needs, and which iPhone-compatible implementation foundations are viable. It does not approve a production algorithm or add domain vocabulary. Those remain human decisions in [Choose a post-save Recording Analysis approach](https://github.com/serpcompany/pedos-app/issues/4).

The preserved first attempt proposed “duration and tonal usefulness” analysis followed by bounded pitch shifting, but did not establish an approved measurement contract or validate an analyzer.[^archived-plan] It is used here to frame questions, not as current specification.

The reliable starting point is smaller than the current `windowed-yin-v2` prototype:

1. Use Apple's `AVAudioFile`/`AVAudioPCMBuffer` to decode a saved Recording and preserve exact source/decoded facts plus the identity and version of the analysis that produced any derived result. Apple documents that `AVAudioFile` exposes file and processing formats, reads decoded PCM buffers, and reports the file's sample-frame length; `AVAudioFormat` exposes sample rate and channel count.[^avfile][^avformat]
2. Treat amplitude, activity boundaries, and pitch as method-dependent observations. Preserve units, parameters, and an explicit unavailable result; never turn an estimator's forced output into a product fact.
3. Make the first comparative proof answer only what the next renderer consumes: decoded duration for scheduling, a coarse amplitude envelope for gain/time-shaping experiments, and a frame-level fundamental-frequency candidate with periodicity/confidence and unavailable frames for pitch-selection experiments.
4. Defer brightness, spectral shape, noisiness, loop points, perceptual loudness, and high-level labels until a Melody Fit or rendering experiment demonstrates that one changes selection or audible quality.
5. Keep the original Recording authoritative. A versioned result can be invalidated and intentionally recomputed when its source revision, schema, algorithm, or parameters change.

This avoids the apparent catch-22. Recording Analysis does not need to predict the final renderer. It needs a stable boundary through which later, evidence-backed observations can be added without coupling capture, persistence, or playback to a particular analyzer.

## What melodic rendering actually consumes

Apple's rendering APIs show that analysis and rendering are separable:

- `AVAudioUnitTimePitch` changes playback rate and pitch independently, and its pitch control is expressed in cents (100 cents per semitone, 1,200 per octave). It does not require the source's fundamental frequency in order to apply a chosen shift.[^timepitch][^timepitch-pitch]
- `AVAudioUnitVarispeed` couples duration and pitch through resampling; Apple gives the relationship `pitch = 1200 * log2(rate)`.[^varispeed]
- `AVAudioEngine` can render a node graph offline, disconnected from audio hardware, and write the resulting PCM to a file.[^offline-rendering][^audio-engine]
- `AVAudioUnitSampler` can use root-key and key-range metadata already embedded in audio files, but arbitrary user Recordings will not reliably contain those musical annotations.[^sampler]

From those capabilities, the inputs fall into three groups.

### Needed to render any note event

- A decodable Recording, its decoded format, and decoded frame count/duration.
- The target event's start time, duration, pitch-shift choice, gain, and envelope/fade policy. These are rendering-plan decisions, not inherent characteristics of the Recording.

### Potentially useful to choose among Recordings or reduce alteration

- A source fundamental-frequency candidate for frames that are sufficiently periodic. Melody Fit can compare that candidate with a target note and prefer the Recording that needs the least shift.
- Frame timestamps, so the renderer can choose or align a portion of the Recording without silently treating one clip-wide number as stationary.
- A coarse amplitude envelope, peak, and RMS under a specified channel-mix/window policy, so experiments can compare gain normalization and attack/release alignment.
- Confidence/periodicity and voiced/unvoiced or available/unavailable state for every pitch frame. These are required companions to a pitch candidate, not optional presentation fields.

### Not required merely to hit target pitch and duration

- Spectral centroid/“brightness,” spectral flatness, rolloff, MFCCs, harmonic ratios, learned labels, or similarity embeddings.
- Tempo/beat detection: each Recording is one fart event, while note timing comes from the target melody plan.
- A single user-visible quality score. Quality and allowable alteration are Melody Fit decisions that need comparative listening evidence.

Those deferred observations may later help keep timbre consistent, choose a comic contrast, distinguish noise-like from harmonic Recordings, or select loopable material. None is proven necessary by the renderer APIs themselves.

## Measurement tiers

### Stable baseline facts

These are reproducible facts when the decode policy is fixed and are reasonable to make available for every Recording:

| Fact | Why it is stable | Caveat to preserve |
| --- | --- | --- |
| Source identity and revision | Binds results to the exact saved Recording | Prefer a content digest; size plus modification time is only a cache hint and can collide |
| File format and decoded PCM format | Reported by `AVAudioFile`/`AVAudioFormat` | File format can differ from the processing format used for analysis[^avfile][^avformat] |
| Sample rate, channel count, decoded frame count | Direct format/decode outputs | A mono-mix policy is still algorithm configuration |
| Full decoded duration | `frameCount / sampleRate` under the chosen processing format | This is not the duration of the audible fart event |
| Analysis lifecycle | Schema, algorithm, parameter version, source revision, timestamps, success/failure | It describes provenance, not audio quality |

Peak magnitude, RMS, and a windowed envelope are deterministic arithmetic on decoded PCM once channel mixing, window size, and full-scale convention are fixed. Apple's Accelerate/vDSP provides optimized reductions, correlation, convolution, and Fourier transforms, including maximum-magnitude and mean operations.[^vdsp][^vdsp-overview] They are technically credible but should still remain namespaced method outputs until a rendering experiment establishes which summaries it uses.

### Uncertain estimates

#### Fundamental frequency

YIN estimates fundamental frequency from approximate periodicity. Its authors describe a periodic-signal model, report improved error rates on speech with laryngograph ground truth, and explicitly note that the model can be extended for forms of aperiodicity.[^yin] That is credible evidence for speech and musical sounds, not validation on fart Recordings.

For each analysis frame, preserve at least:

- timestamp and window/hop configuration;
- zero or more frequency candidates in hertz;
- an algorithm-specific periodicity, aperiodicity, or confidence value;
- an explicit available/unavailable or voiced/unvoiced result;
- any post-processing version used for smoothing, octave correction, or aggregation.

Do not describe a YIN-derived “confidence” as a calibrated probability unless calibration has actually been measured on representative labeled data. Essentia's own `PitchYin` documentation warns that it always emits a numeric pitch and that callers must ignore it when confidence is zero.[^essentia-pitchyin] A corpus wrapper therefore must be allowed to discard candidates instead of forcing a note.

pYIN is a useful challenger because it retains multiple frame candidates with probabilities and uses a hidden Markov model to produce a temporally smoothed monophonic track; the original paper reports improved recall and precision over single-candidate YIN with low additional computational complexity.[^pyin] Its evaluation and state assumptions are still about monophonic voice/music, so it also needs Fixture Library validation.

The one-number summaries used by `windowed-yin-v2`—reference note, stable bounds, confidence, and voiced-frame ratio—are downstream interpretations of a frame track. They should not replace that track in an extensible boundary. Keeping the evidence frames permits later aggregation changes without decoding the Recording again, while changing the frame detector still intentionally invalidates those results.

#### Activity boundaries

The start and end of an audible event are not file facts. They depend on a threshold, noise floor, window/hop, smoothing, and minimum-run rules. A low-energy tail may be musically useful even if a gate rejects it. The current prototype's “usable region” is therefore a candidate gate result, not shared domain vocabulary or a stable property.

If the next proof needs event alignment, preserve the amplitude envelope and the gate's proposed boundary with its configuration. That lets Melody Fit/rendering compare whole-file playback with a boundary-driven variant. Do not trim or overwrite the Recording.

#### Level and loudness

Sample peak and RMS answer simple mathematical questions; neither alone is perceived loudness. ITU-R BS.1770-5 defines K-weighted loudness and true-peak measurement, but its gated loudness calculation uses 400 ms blocks and discards incomplete final blocks.[^bs1770] Several approved Recordings have less than 400 ms of candidate active audio in the existing prototype evidence, so an integrated LUFS field is not automatically a better universal baseline. A later gain-normalization listening test should choose between peak, RMS/envelope, and a short-sound loudness policy.

#### Spectral shape

Spectral centroid, first-difference ratios, flatness, and rolloff describe spectral distribution; they do not establish a fundamental frequency. Essentia, for example, defines spectral centroid separately from YIN pitch and defines flatness as the geometric-to-arithmetic-mean ratio.[^essentia-centroid][^essentia-flatness] These can be computed locally with vDSP or a library, but the product should defer them until a renderer comparison has a specific hypothesis such as “choose Recordings with similar spectral shape across adjacent notes.”

### Defer until demonstrated

- Loop-point/sustain detection: only necessary if listening proves that one-shot, repetition, or time stretching cannot cover required note lengths acceptably.
- Onset classification, transientness, harmonic/noise ratio, and multiple-event segmentation: useful possible diagnostics, but one Recording already has a one-fart domain constraint.
- MFCCs, chroma, embeddings, and learned fart subclasses: useful for retrieval or similarity only if later selection logic consumes them.
- Denoising or source separation: changes audio rather than only observing it and should be a separate rendering/preprocessing experiment.
- Sound classification with Apple's Sound Analysis framework: `SNClassifySoundRequest` runs a built-in or custom Core ML classifier over windows; it does not provide generic pitch, envelope, or spectral measurements.[^sound-analysis]

## iPhone-compatible foundations

Current maintenance facts below are repository observations as of 2026-07-31, not guarantees about future support.

| Foundation | Relevant outputs | iPhone integration | Uncertainty behavior | License / maintenance | Fit for the next proof |
| --- | --- | --- | --- | --- | --- |
| Apple AVFAudio + Accelerate with a small in-repo analyzer | Decode facts; arbitrary envelope/DSP; custom YIN or pYIN | Native Swift/Objective-C system frameworks; no third-party binary | Fully controllable, but Pedos owns correctness, tests, and versioning | Apple SDK terms; no extra OSS runtime dependency | **Best baseline shell.** Compare at least two pitch implementations/configurations before choosing one |
| AudioKit `SoundpipeAudioKit` | `PitchTap` exposes per-channel frequency and amplitude through Soundpipe `ptrack` | Swift Package, iOS 13+, but brings AudioKit, AudioKitEX, KissFFT, Tonic, C/C++ bridge[^soundpipe-package][^soundpipe-pitchtap] | Public `PitchTap` returns frequency/amplitude, not a confidence or unavailable result; wrapper is a live node tap | MIT; release 5.7.4 published 2026-04-15 and repository active in 2026[^soundpipe-release] | Maintained and easy to prototype, but its public result shape is weaker than this decision needs |
| `audioFlux` | Multiple pitch methods including YIN plus spectral/onset features | C library; repository includes an iOS CMake/Xcode build for arm64/x86_64, but no first-party Swift Package/XCFramework wrapper[^audioflux][^audioflux-ios] | YIN exposes frequency plus two algorithm values, whose semantics must be verified and wrapped explicitly[^audioflux-yin] | MIT; latest tagged release v0.1.9 (2024-05-24), with repository activity in 2026[^audioflux-release] | Promising permissive challenger if a small bridge spike builds cleanly and results are interpretable |
| `aubio` | YIN/YINFFT and other pitch methods, confidence, onset, quiet/loud regions, MFCC | C; official README says it compiles on iOS[^aubio] | API exposes confidence and configurable silence/tolerance; caller still defines rejection[^aubio-pitch] | GPL-3.0-or-later; latest release 0.4.9 (2019-02-27), though repository received later commits[^aubio-release] | Technically relevant, but GPL distribution obligations and old release cadence make it a poor default for a closed App Store/TestFlight product without explicit legal acceptance |
| Essentia | Very broad temporal/spectral/tonal features; YIN and YINFFT with confidence | C++; officially supports iOS, but integration/build surface is much larger[^essentia] | Explicit confidence; docs require callers to ignore invalid pitch; many configurable algorithms | AGPL-3.0 with separate proprietary licensing offered; official releases are old while docs identify 2.1-beta6-dev/master[^essentia-license][^essentia-releases] | Excellent desktop research oracle; disproportionate production dependency unless commercial licensing and breadth become justified |
| CREPE or another learned pitch model | Frame pitch and voicing confidence | No official native Swift/iOS package; requires model conversion/runtime work | Confidence is model output, not Fixture Library calibration | CREPE code/models are MIT, but its official package is Python/TensorFlow and its latest GitHub release is from 2018[^crepe] | Defer. Official docs say training data is vocal/instrumental and it works best there, making fart Recordings out of distribution[^crepe] |

### Why Apple-native is a foundation, not yet the chosen analyzer

Apple supplies reliable decode, DSP primitives, pitch/time effects, and offline rendering, but no general fundamental-frequency estimator in AVFAudio or Accelerate. A small in-repo analyzer therefore avoids licensing and integration risks while leaving algorithm choice open. It does not make a handwritten YIN variant correct merely because it compiles on iPhone.

The existing `windowed-yin-v2` proof is useful evidence that this architecture can run deterministically over all 23 approved Recordings and represent unavailable pitch. It is not a standards-conformant or externally validated YIN implementation: it uses an agent-chosen downsample, Hann window, frequency range, threshold, gate, frame aggregation, four-semitone stability filter, and 0.2 acceptance threshold. Its 10 pitched and 13 unavailable corpus outcomes are candidate behavior to compare, not ground truth.[^prototype-evidence]

### Why a broad library is not automatically safer

Libraries reduce implementation effort and can supply established algorithms, but their default thresholds and confidence meanings are still algorithm-specific. Essentia explicitly warns that its YIN implementation never returns a null pitch; Soundpipe's Swift wrapper does not expose confidence; and audioFlux's public Python wrapper names two auxiliary YIN arrays without documenting their meaning.[^essentia-pitchyin][^soundpipe-pitchtap][^audioflux-yin] Pedos still needs a boundary that can reject or preserve uncertainty and a corpus test that evaluates audible downstream results.

## Extensible versioned boundary

The following is a research recommendation, not an approved schema. It separates immutable provenance from replaceable observations:

```text
RecordingAnalysisRecord
  recordingID
  sourceRevision            // preferably digest of saved bytes
  schemaVersion
  analyzerID
  analyzerVersion
  parameterSetID
  analyzedAt
  decode
    fileFormat
    processingFormat
    sampleRateHz
    channelCount
    frameCount
    durationSeconds
  observations[]
    kind
    methodID
    methodVersion
    units
    status                  // available | unavailable | failed
    value or time-series reference
    uncertainty             // method-specific, never implied probability
    parameters
  failure                   // typed decode/analysis failure when applicable
```

Boundary rules:

1. Saving, playback, and deletion of a Recording do not require successful Recording Analysis.
2. Results are valid only when source revision, schema, analyzer, and parameter versions match.
3. Each observation can independently be unavailable or failed. A missing pitch does not invalidate duration or envelope results.
4. Preserve units and method-specific uncertainty. Do not put a bare `confidence` beside unrelated algorithms as if the values were comparable.
5. Preserve compact frame evidence when later aggregation is likely; do not preserve large FFTs or embeddings without a consumer.
6. Re-analysis is an intentional migration or user/developer action after an algorithm/parameter change, not a launch-time side effect.
7. The saved Recording remains the authority and permits future observations not anticipated by this schema.

## Suggested next comparative proof

The research does not select a winner. It sharpens [Choose a post-save Recording Analysis approach](https://github.com/serpcompany/pedos-app/issues/4) into a bounded corpus experiment:

1. Keep `windowed-yin-v2` as candidate A.
2. Add candidate B using either a faithful pYIN/YIN implementation with multiple candidates and voicing state, or a permissive library challenger (`audioFlux` if its iOS bridge and output semantics check out).
3. Run both on the approved 23-Recording Fixture Library with identical decoded mono PCM and record runtime, failure, frame track, and unavailable behavior.
4. Build the smallest local renderer that consumes only duration, envelope, and pitch evidence. For each pitched target, export blind comparisons of candidate selection and bounded shifts; include forced “no pitch analysis” and unavailable-pitch controls.
5. Let the product owner judge recognizable melody, retained fart character, objectionable artifacts, and whether the analyzer-assisted selection beats the controls. Use those judgments to set Melody Fit bounds and decide which observations earn preservation.

Pure pitch labels cannot validate this decision: fart Recordings lack authoritative F0 annotations, human pitch judgments can disagree for aperiodic sounds, and the product outcome is an acceptable Created Melody. Synthetic tones can verify numerical correctness and octave handling, while Fixture Library renders verify usefulness.

## Decision fog exposed by the research

These are now precise enough for the parent decision to address, but the research does not answer them for the product owner:

- Is the first Created Melody renderer allowed to use unpitched Recordings as percussive/noise-like note events, or only where a credible source pitch is available?
- Should long target notes repeat, loop, stretch, or cut off a short Recording, and which option best preserves fart character?
- Is lower pitch alteration always preferable, or can timbre continuity/contrast outweigh it?
- Which listening comparisons define “acceptable” melody recognition and retained fart character, and what maximum pitch/time alteration follows from them?
- Does gain matching need only peak/RMS envelope behavior, or does a short-sound perceptual loudness method audibly improve results?

Until those decisions are made, extra descriptors belong in deferred experiments rather than the permanent Recording Analysis contract.

## Sources

[^avfile]: Apple, [`AVAudioFile`](https://developer.apple.com/documentation/avfaudio/avaudiofile).
[^avformat]: Apple, [`AVAudioFormat`](https://developer.apple.com/documentation/avfaudio/avaudioformat/).
[^timepitch]: Apple, [`AVAudioUnitTimePitch`](https://developer.apple.com/documentation/avfaudio/avaudiounittimepitch).
[^timepitch-pitch]: Apple, [`AVAudioUnitTimePitch.pitch`](https://developer.apple.com/documentation/avfaudio/avaudiounittimepitch/pitch).
[^varispeed]: Apple, [`AVAudioUnitVarispeed.rate`](https://developer.apple.com/documentation/avfaudio/avaudiounitvarispeed/rate).
[^offline-rendering]: Apple, [Performing offline audio processing](https://developer.apple.com/documentation/avfaudio/performing-offline-audio-processing).
[^audio-engine]: Apple, [`AVAudioEngine`](https://developer.apple.com/documentation/avfaudio/avaudioengine).
[^sampler]: Apple, [`AVAudioUnitSampler.loadAudioFiles(at:)`](https://developer.apple.com/documentation/avfaudio/avaudiounitsampler/loadaudiofiles%28at%3A%29).
[^vdsp]: Apple, [`vDSP`](https://developer.apple.com/documentation/accelerate/vdsp).
[^vdsp-overview]: Apple, [vDSP library overview](https://developer.apple.com/documentation/accelerate/vdsp-library).
[^yin]: Alain de Cheveigné and Hideki Kawahara, [“YIN, a fundamental frequency estimator for speech and music”](https://doi.org/10.1121/1.1458024), *Journal of the Acoustical Society of America* 111(4), 2002.
[^pyin]: Matthias Mauch and Simon Dixon, [“pYIN: A fundamental frequency estimator using probabilistic threshold distributions”](https://www.eecs.qmul.ac.uk/~simond/pub/2014/MauchDixon-PYIN-ICASSP2014.pdf), ICASSP 2014.
[^bs1770]: ITU-R, [Recommendation BS.1770-5: Algorithms to measure audio programme loudness and true-peak audio level](https://www.itu.int/rec/R-REC-BS.1770-5-202311-I/en), 2023, especially Annex 1's 400 ms gating blocks and Annex 2's true-peak guidance.
[^sound-analysis]: Apple, [`SNClassifySoundRequest`](https://developer.apple.com/documentation/soundanalysis/snclassifysoundrequest).
[^essentia-pitchyin]: Music Technology Group, Essentia 2.1-beta6-dev, [`PitchYin`](https://essentia.upf.edu/reference/std_PitchYin.html).
[^essentia-centroid]: Music Technology Group, Essentia 2.1-beta6-dev, [`SpectralCentroidTime`](https://essentia.upf.edu/reference/std_SpectralCentroidTime.html).
[^essentia-flatness]: Music Technology Group, Essentia 2.1-beta6-dev, [`Flatness`](https://essentia.upf.edu/reference/std_Flatness.html).
[^soundpipe-package]: AudioKit, [`SoundpipeAudioKit` `Package.swift`](https://github.com/AudioKit/SoundpipeAudioKit/blob/main/Package.swift).
[^soundpipe-pitchtap]: AudioKit, [`PitchTap.swift`](https://github.com/AudioKit/SoundpipeAudioKit/blob/main/Sources/SoundpipeAudioKit/PitchTap.swift) and its [`PitchTracker.mm`](https://github.com/AudioKit/SoundpipeAudioKit/blob/main/Sources/CSoundpipeAudioKit/PitchTracker.mm) bridge.
[^soundpipe-release]: AudioKit, [`SoundpipeAudioKit` releases](https://github.com/AudioKit/SoundpipeAudioKit/releases) and [MIT license](https://github.com/AudioKit/SoundpipeAudioKit/blob/main/LICENSE).
[^audioflux]: `audioFlux` maintainers, [`audioFlux` repository](https://github.com/libAudioFlux/audioFlux), including supported MIR methods, platforms, and MIT license.
[^audioflux-ios]: `audioFlux` maintainers, [`scripts/build_iOS.sh`](https://github.com/libAudioFlux/audioFlux/blob/master/scripts/build_iOS.sh).
[^audioflux-yin]: `audioFlux` maintainers, [`PitchYIN` wrapper](https://github.com/libAudioFlux/audioFlux/blob/master/python/audioflux/mir/pitch_yin.py) and [C header](https://github.com/libAudioFlux/audioFlux/blob/master/include/mir/_pitch_yin.h).
[^audioflux-release]: `audioFlux` maintainers, [`audioFlux` releases](https://github.com/libAudioFlux/audioFlux/releases).
[^aubio]: Paul Brossier and contributors, [`aubio` repository README](https://github.com/aubio/aubio), including iOS support and GPL-3.0-or-later license.
[^aubio-pitch]: aubio, [`pitch.h` API documentation](https://aubio.org/doc/latest/pitch_8h.html).
[^aubio-release]: aubio, [`aubio` releases](https://github.com/aubio/aubio/releases).
[^essentia]: Music Technology Group, [`Essentia` repository README](https://github.com/MTG/essentia), including feature scope and iOS support.
[^essentia-license]: Music Technology Group, [Essentia licensing information](https://essentia.upf.edu/licensing_information.html) and [repository license text](https://github.com/MTG/essentia/blob/master/Essentia%20Licensing.txt).
[^essentia-releases]: Music Technology Group, [`Essentia` releases](https://github.com/MTG/essentia/releases).
[^crepe]: Jong Wook Kim et al., [`CREPE` repository and pretrained model](https://github.com/marl/crepe), including model output, training data, MIT license, and release history; see also the [original ICASSP 2018 paper](https://arxiv.org/abs/1802.06182).
[^archived-plan]: Pedos preserved first attempt, [Musical Fruit MVP plan](prototypes/pedos-app-v1/docs/plan/features/musical-fruit/v1/mvp-plan.md).
[^prototype-evidence]: Pedos throwaway prototype, [`RecordingAnalysis.swift`](https://github.com/serpcompany/pedos-app/blob/prototype/post-save-recording-analysis/RecorderProof/RecordingAnalysis.swift) and [approved Fixture Library evidence](https://github.com/serpcompany/pedos-app/blob/prototype/post-save-recording-analysis/Evidence/README.md).
