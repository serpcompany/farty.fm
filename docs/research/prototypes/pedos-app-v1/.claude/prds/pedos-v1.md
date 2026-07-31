---
name: pedos-v1
description: Pedos — a fart recording and melody generation app for public App Store release with monetization experiments
status: active
created: 2026-04-05T12:47:36Z
---

# PRD: pedos-v1

## Executive Summary

Pedos is an iPhone app that lets users record their own farts, build a personal library, and turn those recordings into real melodies using a sophisticated audio processing pipeline. The MVP POC is working — it's time to take it from archived prototype to a polished, App Store-ready product that can grow to thousands of users and generate revenue through multiple monetization experiments.

## Problem Statement

Fart apps exist, but they're all soundboards — passive content consumption. Pedos is different: your body is the instrument. The core insight from the POC is that with the right audio pipeline (rubberband pitch-shifting, time-stretching, loudness normalization, velocity dynamics, rest handling, smart sample-to-note mapping), a fart recording can actually sound like a recognizable melody. This is genuinely novel and shareable.

The gap from POC to product:
- The audio pipeline lives in the backend but only works with pre-loaded test samples — users can't feed their own recordings into it yet
- The app is unpolished (no onboarding, no sharing, no monetization hooks)
- The backend needs to be production-deployed (not just local dev)
- No App Store presence, no distribution

## User Stories

### Core Loop
- **As a user**, I can open the app and immediately record a fart with one tap, so I can capture the moment without fumbling with settings.
  - Acceptance: Record button visible on first launch, no sign-in required
- **As a user**, I can review my recording before saving and give it a name, so my library stays organized.
  - Acceptance: Preview playback works, name defaults to "Fart #N", save/discard both work
- **As a user**, I can see all my recordings in a library sorted by date, so I can find and play any clip.
  - Acceptance: Library loads persisted recordings, inline play/pause works

### Musical Fruit (the money feature)
- **As a user**, I can select one or more of my own recorded farts and generate a real melody from them, so I can hear what my farts sound like as Happy Birthday or Ode to Joy.
  - Acceptance: User recordings appear in the sample picker (not just test samples); generation works end-to-end
- **As a user**, I can pick from at least 20 songs to generate, so there's variety and replayability.
  - Acceptance: All 20 current MIDI songs are available; search/filter works
- **As a user**, I can hear my generated melody and it actually sounds recognizable, so the experience is surprising and funny.
  - Acceptance: Rubberband pitch-shift + time-stretch + normalization + fades pipeline is active; result sounds like the target song
- **As a user**, I can share a generated melody directly from the app, so I can send it to friends or post it on social media.
  - Acceptance: Native iOS share sheet works; exported file plays in Messages/Instagram/etc.

### Discovery & Retention
- **As a user**, I see a dashboard with my stats (total farts, funniest, longest, weekly), so I feel progress and come back.
  - Acceptance: All stat cards update after each recording/generation
- **As a user**, I can favorite recordings and generated songs, so I can quickly find the best ones.
  - Acceptance: Star action on all library items, "Favorites" filter tab

### Monetization
- **As a new user**, I get the full core experience for free, so I can fall in love with the app before spending money.
  - Acceptance: Recording + 3 melody generations per day free; no paywall on first launch
- **As a user who loves the app**, I can unlock unlimited melody generations via a "Pedos Pro" subscription or one-time purchase, so power users can pay.
  - Acceptance: Paywall shows after daily limit; StoreKit purchase flow works; receipt validated server-side
- **As a developer**, I can A/B test different monetization models (IAP, subscription, paywall placement) without a full release, so I can find what works.
  - Acceptance: RevenueCat (or equivalent) integrated; at least 2 offerings configurable from dashboard

## Functional Requirements

### FR-1: Own Recordings as Source Material
- User recordings (`.m4a` files stored locally) must be uploadable to the backend for melody generation
- Backend must accept uploads, run sample analysis (brightness, loudness, duration, pitch), cache results
- Generated songs using user recordings must be stored and playable in the library
- Fallback: if user has no recordings, show test samples as "demo farts" to try

### FR-2: Audio Pipeline Integrity (the secret sauce — all implemented in POC)
The following pipeline components are **already working** in the POC and must be preserved and built upon:

**Pitch detection & shifting (reference-based, not C4-assumed):**
- Goertzel spectral centroid for real pitch detection on each fart sample
- Reference-based pitch shifting — each sample shifts from its *actual* detected pitch, not always from C4
- Optimal melody transposition (±5 semitones) so the melody fits the sample's natural register
- Rubberband pitch-shift + time-stretch (NOT `asetrate`) with formant preservation + quality pitch mode

**Timing & duration:**
- Input pre-trimming: long samples only feed their attack portion to rubberband, eliminating extreme compression ratios
- Tempo ratio clamped to [0.75×, 1.5×] to avoid time-stretch distortion
- Sample looping for long notes when source sample is shorter than note duration

**Tonal quality:**
- 18% harmonic reinforcement (subtle sine tone under each note for pitch clarity)
- 15ms fade in/out per segment (eliminates clicks/pops)
- Velocity-based volume scaling (MIDI velocity 0–1 directly)
- Loudness normalization (-16 LUFS, Apple Music / Spotify standard)
- Rest handling: silence segments for MIDI gaps

**Sample selection:**
- Smart sample-to-note mapping: brightness (Goertzel spectral centroid) → pitch, duration → note length, loudness → velocity
- Chroma-based quality scoring system to evaluate output fidelity

**Architecture:**
- Adding new songs = drop a `.mid` file in `test-data/melodies/`; no code changes required
- 20 MIDI songs available at launch, all single-voice, BPM-accurate

### FR-3: Sharing
- Share sheet for generated songs (export as `.wav` or `.m4a`)
- Share sheet for individual recordings
- Deep link / preview card metadata (song name, "Made with Pedos") for social sharing

### FR-4: Monetization Infrastructure
- Daily free limit (e.g. 3 generations/day) enforced client-side + server-side
- In-app purchase options: unlimited generations (one-time), "Pedos Pro" (monthly/annual subscription)
- Soft paywall (not hard gate) — show upsell after limit, don't block recording
- RevenueCat integration for purchase management + A/B testing
- Analytics events on: record, generate, share, paywall shown, purchase initiated, purchase completed

### FR-5: App Store Readiness
- App icon, splash screen, app name "Pedos"
- Onboarding screen (first-launch only): one-screen explainer of what the app does
- Microphone permission request with clear rationale string
- Privacy policy URL (linked from settings)
- App Store screenshots (at least 3)
- TestFlight build working end-to-end

### FR-6: Backend Production Deployment
- Backend deployed to a server (not localhost) — Railway, Fly.io, or Render
- Environment variables managed via secrets (not committed)
- FFmpeg + rubberband available in production container
- Health check endpoint
- Basic rate limiting on generation endpoint

### FR-7: Quality of Life
- Rename generated songs
- Tempo control slider (0.5×–2×) before generation
- Waveform visualization on library cards (actual audio waveform, not animation)
- Pull-to-refresh on library

## Non-Functional Requirements

- **Latency**: Melody generation should complete in <30s for a 30-note song on a reasonable server
- **Storage**: Generated audio files cleaned up from server after 24h (user has local copy)
- **Offline**: Recording + library playback work offline; generation requires network
- **iOS target**: iOS 16+ (Expo SDK 53 baseline)
- **Accessibility**: All interactive elements have accessibilityLabel; minimum 44px touch targets
- **Code quality**: Well-documented, AI-friendly codebase with CLAUDE.md per module

## Success Criteria

- App Store approved and live (v1.0)
- 1,000+ downloads in first 3 months
- ≥30% of users who generate a melody share it
- At least one monetization model generating revenue (any amount = validated)
- Musical Fruit output is recognizable as the target song by a blind listener ≥80% of the time
- Zero P0 crashes in TestFlight (0 crash-free sessions metric)

## Constraints & Assumptions

- Solo/AI-assisted development (well-documented codebase for AI coding)
- Mobile: Expo SDK 53 + React Native + TypeScript (no ejecting unless forced)
- Backend: Bun + Hono (flexible, but stick with it unless there's a hard blocker)
- FFmpeg + rubberband must be available in the production environment
- No user accounts required for v1 (local-first; backend only for generation + uploads)
- App Store review is the final gate — content (fart sounds) must pass Apple's guidelines

## Out of Scope (v1)

- Android version
- User accounts / social features (follow, leaderboard)
- Custom melody editor / user-uploaded MIDI
- Web app
- Real-time audio effects / live preview during recording
- Push notifications
- Collaboration (share library with another user)
- More than 20 songs at launch (expand post-launch)

## Dependencies

- FFmpeg + rubberband available in production Docker/server environment
- RevenueCat account + App Store Connect IAP products configured
- Apple Developer account (already needed for App Store)
- Backend hosting (Railway / Fly.io / Render — to be decided)
- MIDI files already generated (20 songs in `test-data/melodies/`)
