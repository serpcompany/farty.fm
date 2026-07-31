# Services

This file is the service inventory for the app.

Use it to see:

- what Apple-provided capabilities we should use first
- what outside services the core app may need
- what services `Pedos AI` may need
- what APIs we should test before choosing a music-generation path
- what stack decisions support iPhone MVP first and Android later

Current recommended app stack:

- backend runtime: `Cloudflare Workers`
- auth: `Better Auth`
- ORM and migrations: `Drizzle`
- metadata database: `Cloudflare D1`
- file storage: `Cloudflare R2`
- async jobs when `Pedos AI` ships: `Cloudflare Queues`

## Planning Docs

- [Database Schema](./../database-schema.md)
- [Cross-Platform Stack](./cross-platform-stack.md)
- [Auth And Account](./auth-and-account.md)
- [Data And Storage](./data-and-storage.md)

## Service List

### Apple / iPhone

- [Siri / App Shortcuts / App Intents](#siri--app-shortcuts--app-intents)
- [Apple Audio Frameworks](#apple-audio-frameworks)
- [Apple Developer Program / App Store Connect](#apple-developer-program--app-store-connect)

### Core App Services

- [Backend / API Runtime](#backend--api-runtime)
- [Authentication Service](#authentication-service)
- [ORM / Schema Migrations](#orm--schema-migrations)
- [Audio File Storage](#audio-file-storage)
- [Metadata Database](#metadata-database)
- [Crash And Error Logging](#crash-and-error-logging)
- [Product Analytics](#product-analytics)

### Pedos AI Recommended Stack

- [OpenAI API](#openai-api-orchestration-layer)
- [Stability AI Stable Audio](#stability-ai-stable-audio-music-generation-layer)
- [FFmpeg Or Equivalent Processing Pipeline](#ffmpeg-or-equivalent-processing-pipeline)
- [Background Jobs / Queue](#background-jobs--queue)

### APIs To Test For Fart-To-Song

- [fal.ai + Stable Audio 2.5 audio-to-audio](#falai--stable-audio-25-audio-to-audio)
- [Loudly Audio Clips + Loudly Music API](#loudly-audio-clips--loudly-music-api)
- [MusicAPI.ai](#musicapiai)
- [Replicate + Meta MusicGen](#replicate--meta-musicgen)
- [Replicate + MiniMax Music 1.5](#replicate--minimax-music-15)
- [Google Lyria 2 on Vertex AI](#google-lyria-2-on-vertex-ai)

### Additional APIs Worth Watching

- [Mubert API](#mubert-api)
- [Beatoven.ai](#beatovenai)
- [Rightsify Hydra](#rightsify-hydra)

## Apple / iPhone

### Siri / App Shortcuts / App Intents

- **What it supports**: quick record via Siri, Shortcuts, Spotlight, Home Screen, and Action button
- **Tied feature**: fast quick-record flow
- **Required now**: yes, if quick record is part of MVP
- **Accounts / keys**: Apple developer account only
- **Recommendation**: use this as the official quick-record path
- **Notes**: this is the cleanest iPhone-safe option and is preferable to any custom wake-word idea

### Apple Audio Frameworks

- **What it supports**: microphone permission, recording, playback
- **Tied feature**: the core record / save / replay loop
- **Required now**: yes
- **Accounts / keys**: none beyond normal app setup
- **Recommendation**: use Apple-provided recording and playback APIs first
- **Notes**: these cover the core recording experience without needing an external audio SDK by default

### Apple Developer Program / App Store Connect

- **What it supports**: signing, device testing, TestFlight, and App Store release
- **Tied feature**: shipping the iPhone app
- **Required now**: yes
- **Accounts / keys**: Apple developer account
- **Recommendation**: required
- **Notes**: this is a hard dependency for real iPhone release work

## Core App Services

### Backend / API Runtime

- **What it supports**: app API routes, signed upload helpers, auth callbacks, share-link handling, and general backend logic
- **Tied feature**: all shared app behavior that should work for both iPhone MVP and later Android
- **Required now**: yes
- **Accounts / keys**: Cloudflare account
- **Possible vendors**: Cloudflare Workers, custom server elsewhere
- **Chosen vendor**: Cloudflare Workers
- **Notes**: this is the recommended shared backend runtime for the project

### Authentication Service

- **What it supports**: user accounts and sign-in
- **Tied feature**: saved fart history across sessions and devices
- **Required now**: yes if day-one auth remains in scope
- **Accounts / keys**: vendor account and auth keys
- **Possible vendors**: Better Auth
- **Chosen vendor**: Better Auth with the Drizzle adapter on D1
- **Notes**: this is the chosen auth system for the project; if guest mode ships first, auth can be delayed, but the account model should still assume Better Auth later

### ORM / Schema Migrations

- **What it supports**: typed schema definition, migrations, and app-level database access
- **Tied feature**: all shared metadata and auth tables
- **Required now**: yes
- **Accounts / keys**: none beyond the app stack
- **Possible vendors**: Drizzle
- **Chosen vendor**: Drizzle ORM + Drizzle Kit
- **Notes**: use Drizzle as the single schema and migration layer for D1 and for Better Auth tables

### Audio File Storage

- **What it supports**: storing recorded fart clips and later generated songs
- **Tied feature**: save, replay, history, and Pedos AI outputs
- **Required now**: yes
- **Accounts / keys**: storage account and credentials
- **Possible vendors**: Cloudflare R2, S3, Firebase Storage
- **Chosen vendor**: Cloudflare R2
- **Notes**: files should default to private user-owned storage; R2 is the recommended audio storage layer

### Metadata Database

- **What it supports**: recording metadata, timestamps, notes, intensity, stats, and later generation jobs
- **Tied feature**: history, stats, and feature state
- **Required now**: yes
- **Accounts / keys**: database account and credentials
- **Possible vendors**: Cloudflare D1
- **Chosen vendor**: Cloudflare D1
- **Notes**: keep the schema intentionally small for the first release; D1 is the chosen metadata database and should be accessed through Drizzle

### Crash And Error Logging

- **What it supports**: save failures, playback failures, shortcut failures, and edge-case bugs
- **Tied feature**: supportability and debugging
- **Required now**: strongly recommended
- **Accounts / keys**: vendor account and DSN or API key
- **Possible vendors**: Sentry, Bugsnag, Crashlytics
- **Chosen vendor**: TBD
- **Notes**: especially important for mic permission and quick-record routing problems

### Product Analytics

- **What it supports**: drop-off tracking in permission flow, quick record usage, save success, and repeat usage
- **Tied feature**: product learning and UX iteration
- **Required now**: optional but useful
- **Accounts / keys**: analytics workspace and keys
- **Possible vendors**: PostHog, Amplitude, Mixpanel, Firebase Analytics
- **Chosen vendor**: TBD
- **Notes**: keep events focused on real decision points and user drop-off

## Pedos AI Recommended Stack

### OpenAI API Orchestration Layer

- **Recommended first choice**: OpenAI API
- **What it supports**: clip selection assistance, prompt shaping, lyric and title generation, and request orchestration
- **Tied feature**: `Pedos AI`
- **Required now**: no for core MVP, yes once Pedos AI ships
- **Accounts / keys**: OpenAI account and API key
- **Why this is recommended**:
  - easiest fast-start LLM layer
  - useful immediately for `AI smart choose`
  - useful for turning user input into a stronger generation request
- **Notes**: use it as the orchestration brain, not as the music engine

### Stability AI Stable Audio Music Generation Layer

- **Recommended first choice**: Stability AI Stable Audio
- **What it supports**: music and audio generation, including audio-to-audio style transformation use cases
- **Tied feature**: original-song generation from fart clips
- **Required now**: no for core MVP, yes once Pedos AI ships
- **Accounts / keys**: Stability account and API access
- **Why this is recommended**:
  - better fit for transforming uploaded fart audio into something musical
  - stronger fit than a plain LLM for the actual song output
  - supports a more audio-native workflow
- **Notes**: this is the recommended first music engine for original-song mode

### FFmpeg Or Equivalent Processing Pipeline

- **Recommended first choice**: FFmpeg or equivalent processing pipeline
- **What it supports**: trim, normalize, transcode, merge clips, and prep files for generation
- **Tied feature**: Pedos AI input preparation
- **Required now**: no for core MVP, likely yes for Pedos AI
- **Accounts / keys**: none if self-hosted
- **Notes**: this is likely required once clips must be normalized before generation

### Background Jobs / Queue

- **What it supports**: longer-running generation jobs and retries
- **Tied feature**: Pedos AI generation workflow
- **Required now**: no for core MVP, likely yes for Pedos AI
- **Accounts / keys**: depends on backend choice
- **Possible vendors**: Cloudflare Queues
- **Chosen vendor**: Cloudflare Queues
- **Notes**: generation should be treated as an async job, not a blocking request; add Workflows only if the pipeline becomes meaningfully multi-step later

## APIs To Test For Fart-To-Song

These are the strongest current candidates to test first as of `2026-03-19`.

### fal.ai + Stable Audio 2.5 audio-to-audio

- **Why this should be tested first**:
  - direct audio-to-audio workflow
  - takes an input audio clip plus a text prompt
  - exposes a `strength` control for how much the uploaded clip influences the result
- **Best fit**:
  - turn a fart clip into a musical texture, loop, or track idea
  - test whether the raw fart sound can survive as recognizable source material
- **Tied feature**: Pedos AI original-song generation
- **Notes**: this is the clearest current API for "use this weird audio and make it musical"

### Loudly Audio Clips + Loudly Music API

- **Why this is worth testing early**:
  - Loudly publicly documents an `Audio Clips` workflow where short uploaded clips are blended into new AI-generated tracks
  - Loudly also has a public Music API page with API keys, text-to-music, music generator, stems, and commercial coverage
- **Best fit**:
  - test a more consumer-product-shaped remix flow
  - compare whether Loudly gives more musical results than raw model APIs
- **Tied feature**: Pedos AI original-song generation and future remix-style flows
- **Notes**:
  - this is a strong product-fit candidate
  - inference: Loudly clearly exposes `Audio Clips` as a product feature, but the public API page does not explicitly prove that exact flow is available via API

### MusicAPI.ai

- **Why this is worth testing**:
  - public docs show music-generation APIs with create, upload, cover, sample, and mashup style endpoints
  - looks flexible enough to test both generated songs and uploaded-audio-driven workflows
  - practical candidate because the team already has local API-key setup for it
- **Best fit**:
  - compare against the other vendors on speed, control, and output quality
  - test whether its upload-oriented endpoints can turn fart clips into something more song-like
- **Tied feature**: Pedos AI original-song generation and later cover-style experimentation
- **Notes**:
  - promising candidate, but not yet the recommended first engine
  - inference: the public docs clearly show music-generation and upload-related endpoints, but the exact best fart-to-song workflow still needs a real spike

### Replicate + Meta MusicGen

- **Why this is worth testing**:
  - simple API access
  - supports `input_audio`
  - can mimic melody from an uploaded clip or continue from it
- **Best fit**:
  - cheap sandbox testing
  - fast experiments with short fart loops and prompt variations
- **Tied feature**: Pedos AI prototyping and model comparison
- **Notes**: this is the easiest lower-friction backup if the first engine disappoints

### Replicate + MiniMax Music 1.5

- **Why this is interesting**:
  - supports reference files such as `song_file`, `voice_file`, and `instrumental_file`
  - better candidate if the team wants fuller song behavior or vocals later
- **Best fit**:
  - longer-form experiments after stitching fart clips into a longer guide track
- **Tied feature**: later Pedos AI experiments
- **Notes**:
  - reference files must be longer than 15 seconds
  - weaker first test than Stable Audio for short isolated fart clips

### Google Lyria 2 on Vertex AI

- **Why this stays on the list**:
  - official Google music API
  - stable fallback for text-to-music generation
- **Best fit**:
  - generate backing tracks from tags, prompts, and clip metadata
  - compare text-only music quality against audio-conditioned workflows
- **Tied feature**: Pedos AI backing tracks and prompt-driven experimentation
- **Notes**:
  - official docs currently describe `lyria-002` as `text to music`
  - weaker fit when the core trick is "use the actual fart sound"

## Additional APIs Worth Watching

### Mubert API

- **What it supports**: text, image, BPM, and genre-driven royalty-free track generation
- **Best fit**: quick background-track generation
- **Why it is not first**: it does not appear to be an uploaded-audio-first workflow

### Beatoven.ai

- **What it supports**: public API positioning around AI music generation and multimodal prompts
- **Best fit**: soundtrack-style generation for content workflows
- **Why it is not first**:
  - Beatoven publicly announced `Audio to Music`
  - inference: the current public API page does not clearly prove that audio-upload flow is exposed in the API itself

### Rightsify Hydra

- **What it supports**: commercially safe instrumental generation
- **Best fit**: background-music generation
- **Why it is not first**: weaker fit for "turn this uploaded fart sound into the actual source material"

## Explicit Recommendations

### Quick Record

- use Apple App Shortcuts + Siri
- do not plan on a custom `Hey Pedos` wake word

## Related Planning Docs

- [Feature Index](./../features/README.md)
- [Quick Record](./../features/quick-record.md)
- [Musical Fruit](./../features/musical-fruit/README.md)
- [UI Screens](./../ui/screens.md)

## Related GitHub Issues

- [#1](https://github.com/serpcompany/pedos-app/issues/1) compare Pedos AI music APIs using our fart sample pack
- [#2](https://github.com/serpcompany/pedos-app/issues/2) gather and curate fart samples
- [#3](https://github.com/serpcompany/pedos-app/issues/3) remove multi-fart samples and keep only single-fart recordings

## Next Planning Work

- [x] tech stack plan docs: map out the tech stack decisions needed to support iPhone MVP first, then V1 expansion to Google Play / Android, including database, auth system, storage, sync, and shared backend vs Apple-only services
