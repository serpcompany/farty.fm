# Quick Record And Pedos AI Research

Last reviewed: 2026-03-19

## Summary

Two product directions were researched:

- the fastest cleanest iPhone quick-record flow
- services to support `Pedos AI` song generation

## Recommendation

### Quick record

Use Apple App Shortcuts with an App Intent for recording.

Recommended product behavior:

1. user says `Record with Pedos`
2. Siri runs the shortcut
3. the app opens into recording
4. recording starts immediately if mic permission already exists
5. otherwise the user lands in permission education

Why this is the best call:

- Apple documents that App Shortcuts work with Siri, Spotlight, the Home Screen, and the Action button
- Apple provides an `AudioRecordingIntent` protocol specifically for app intents that start, stop, or otherwise modify audio recording state
- this is much safer than assuming a custom `Hey Pedos` wake word is possible

## Apple references

- Shortcuts for developers:
  https://developer.apple.com/shortcuts/
- Siri for developers:
  https://developer.apple.com/siri/
- App Intents:
  https://developer.apple.com/documentation/AppIntents/app-intents
- `openAppWhenRun` metadata:
  https://developer.apple.com/documentation/appintents/appintent/openappwhenrun
- Microphone permission:
  https://developer.apple.com/library/archive/documentation/Audio/Conceptual/AudioSessionProgrammingGuide/RequestingPermission/RequestingPermission.html

## Pedos AI service recommendation

### Orchestration layer

Recommended first choice:

- OpenAI API

Use it for:

- clip selection assistance
- prompt generation
- song titles / lyrics / creative metadata
- optional speech-to-text for user-entered audio requests

OpenAI references:

- Audio and speech overview:
  https://platform.openai.com/docs/guides/audio/quickstart
- Speech-to-text model docs:
  https://developers.openai.com/api/docs/models/gpt-4o-mini-transcribe

## APIs to test for fart-to-song generation

These are the most relevant service options found during research as of `2026-03-19`.

### 1. fal.ai + Stable Audio 2.5 audio-to-audio

Why it stands out:

- official API for audio-to-audio generation
- accepts `audio_url` plus a prompt
- exposes `strength`, which controls how much the uploaded audio influences the generated result
- strongest direct fit for turning fart clips into musical output

Best use:

- first real prototype
- original-song mode driven by uploaded fart clips

Key references:

- fal Stable Audio 2.5 audio-to-audio API:
  https://fal.ai/models/fal-ai/stable-audio-25/audio-to-audio/api
- Stability AI Stable Audio 2.5 announcement:
  https://stability.ai/news/stability-ai-introduces-stable-audio-25-the-first-audio-model-built-for-enterprise-sound-production-at-scale

### 2. Loudly Audio Clips + Loudly Music API

Why it stands out:

- Loudly publicly documents an `Audio Clips` product that accepts short audio samples from `1-60 seconds`
- Loudly says those clips can be blended into new AI-generated tracks
- Loudly also has a public Music API with API keys, text-to-music, a parameterized music generator, stems, and commercial usage claims

Best use:

- second comparison test after Stable Audio
- evaluate whether a more packaged music product gives a better result than a raw model API

Important caveat:

- inference: Loudly clearly exposes `Audio Clips` as a public product feature, but the public Music API page does not explicitly confirm that the same flow is exposed via API

Key references:

- Loudly Audio Clips:
  https://www.loudly.com/audio-clips
- Loudly Music API:
  https://www.loudly.com/music-API

### 3. MusicAPI.ai

Why it stands out:

- public docs show multiple music-generation models and workflows
- docs also expose upload, cover, sample, and mashup-related endpoints under the `sonic` model family
- this makes it worth testing as a more flexible all-in-one candidate

Best use:

- compare against the leading candidates on speed, control, and output quality
- test whether its upload-oriented endpoints can create more song-like outputs from fart source material

Important caveat:

- inference: the docs clearly show relevant creation and upload endpoints, but the exact best fart-to-song workflow still needs hands-on testing

Key references:

- MusicAPI docs home:
  https://docs.musicapi.ai/
- Nuro instruction:
  https://docs.musicapi.ai/nuro-instruction

### 4. Replicate + Meta MusicGen

Why it stands out:

- simple API access
- supports `input_audio`
- can use input audio as a melodic guide or continuation seed

Best use:

- quick low-friction experiments
- compare output quality and controllability against Stable Audio

Key reference:

- Replicate MusicGen API:
  https://replicate.com/meta/musicgen/versions/7be0f12c54a8d033a0fbd14418c9af98962da9a86f5ff7811f9b3423a1f0b7d7/api

### 5. Replicate + MiniMax Music 1.5

Why it stands out:

- supports `song_file`, `voice_file`, and `instrumental_file`
- better candidate for larger song-generation experiments later

Best use:

- later-stage testing with stitched together longer references
- not the best first test for tiny isolated fart clips

Important caveat:

- official input schema requires reference files longer than `15 seconds`

Key reference:

- Replicate MiniMax Music 1.5 API:
  https://replicate.com/minimax/music-1.5/versions/cbc53896dce2877b6e6bece908b5f23ebd2629d01cbaaffb9b4507868be6201e/api

### 6. Google Lyria 2 on Vertex AI

Why it matters:

- current official Google music API
- stable fallback if the product wants text-to-music backing tracks

Best use:

- compare text-only generation against audio-conditioned generation
- generate instrumental backing tracks from tags or clip metadata

Important caveat:

- official model docs currently describe `lyria-002` as supporting `text to music`
- inference: this makes it a weaker direct fit for "turn this fart clip into the source audio for the song"

Key references:

- Lyria generate music guide:
  https://cloud.google.com/vertex-ai/generative-ai/docs/music/generate-music
- Lyria 2 model details:
  https://cloud.google.com/vertex-ai/generative-ai/docs/models/lyria/lyria-002

## Additional APIs worth watching

### Mubert

- official API
- strong for royalty-free track generation from text / image / BPM / genre inputs
- weaker fit for uploaded fart clips as direct source audio

Reference:

- https://mubert.com/api

### Beatoven.ai

- public API positioning around AI music generation and multimodal prompts
- company blog also describes an `Audio to Music` feature
- inference: the current public API page does not clearly prove that audio-upload flow is available in the API

References:

- https://www.beatoven.ai/api
- https://www.beatoven.ai/blog/beatoven-ai-launching-on-product-hunt/

### Rightsify Hydra

- commercially safe instrumental generation option
- better fit for background music than for transforming uploaded fart clips into source material

Reference:

- https://www.rightsify.com/post/rightsify-presents-hydra-advanced-ai-music-generation-for-all

## Practical recommendation

If the team wants the fastest useful test stack:

1. `fal.ai` Stable Audio 2.5 audio-to-audio
2. `Loudly` Audio Clips / Music API
3. `MusicAPI.ai`
4. `Replicate` MusicGen
5. `Google Lyria 2` for a text-only comparison baseline

If the team wants a later deeper experiment:

1. stitch multiple fart clips into a longer guide track
2. test `MiniMax Music 1.5` with that longer reference
3. compare full-song behavior against the shorter audio-to-audio systems

### Music generation layer

Recommended first choice:

- Stability AI Stable Audio

Why:

- official music and audio generation product
- supports audio-to-audio transformation
- marketed for longer full-track generation

Stability references:

- Stable Audio 2.0:
  https://stability.ai/news/stable-audio-2-0
- Stable Audio 2.5:
  https://stability.ai/news/stability-ai-introduces-stable-audio-25-the-first-audio-model-built-for-enterprise-sound-production-at-scale

### Strong alternative

- Google Lyria 2 on Vertex AI

Why:

- current official API
- instrumental music generation from text prompts
- useful for backing-track generation or fast original-song prototyping

Tradeoff:

- official docs describe it as instrumental text-to-music
- it looks less directly suited than Stable Audio for transforming uploaded fart clips

Google references:

- Lyria on Vertex AI:
  https://cloud.google.com/blog/products/ai-machine-learning/expanding-generative-media-for-enterprise-on-vertex-ai
- Lyria 2 announcement:
  https://cloud.google.com/blog/products/ai-machine-learning/announcing-veo-3-imagen-4-and-lyria-2-on-vertex-ai

## Cover-song direction

Cover-song mode is a meaningful later expansion path for Pedos AI.

Why it matters:

- it gives users a more recognizable target than a fully original song
- it can make the result feel more immediately funny or specific
- it should be evaluated as a separate product path from original-song generation
