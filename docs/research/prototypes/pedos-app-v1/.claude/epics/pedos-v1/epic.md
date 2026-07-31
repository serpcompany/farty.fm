---
name: pedos-v1
status: in-progress
created: 2026-04-05T12:53:00Z
updated: 2026-04-05T12:53:00Z
progress: 0%
prd: .claude/prds/pedos-v1.md
github: (will be set on sync)
---

# Epic: pedos-v1 — App Store Launch

## Overview

Take the working MVP POC (archived at `apps/.archive/pedos-mvp-vibecodeapp.com3`) and build the official, production-ready Pedos app. The POC proves the core loop works — record farts, generate melodies using a sophisticated audio pipeline. This epic covers everything needed to ship on the App Store, monetize, and grow.

## What's Already Done (POC State)

The POC in `.archive/pedos-mvp-vibecodeapp.com3` is fully functional:

### Recording & Playback
- Floating record button → record screen → review → save flow
- Dashboard with stats (total farts, duration, longest, weekly)
- Library with inline playback for both recordings and generated songs
- Zustand + AsyncStorage for local persistence

### Musical Fruit Audio Pipeline (the secret sauce)
All of these are working in the POC backend:
- **Goertzel spectral centroid** for real pitch detection per sample
- **Reference-based pitch shifting** — shifts from actual detected pitch, not assumed C4
- **Optimal melody transposition** (±5 semitones) to fit sample's natural register
- **Rubberband** pitch-shift + time-stretch with formant preservation + quality mode
- **Input pre-trimming** — attack portion only, prevents extreme compression ratios
- **Tempo ratio clamped** to [0.75×, 1.5×] to prevent distortion
- **Sample looping** for notes longer than source sample
- **18% harmonic reinforcement** (subtle sine tone for pitch clarity)
- **15ms fade in/out** per segment (eliminates clicks/pops)
- **Velocity-based volume** (MIDI velocity 0–1 directly)
- **Loudness normalization** (-16 LUFS, streaming standard)
- **Rest handling** with silence segments for MIDI gaps
- **Smart sample-to-note mapping** (brightness → pitch, duration → note length, loudness → velocity)
- **Chroma-based quality scoring**
- **20 MIDI songs** (drop a `.mid` file = new song, no code changes)

## Architecture Decisions

1. **Migrate from archive to official app path** — The POC lives in `.archive/`; the official app goes in `apps/pedos-app/` (or a clean `apps/pedos/` directory). Start clean, port the working code.

2. **Local-first, backend for generation** — Recording, library, playback: all local (Zustand + AsyncStorage). Backend (Bun + Hono) only for: melody generation, sample upload/analysis, generated audio serving.

3. **User recordings as source material** — This is the #1 gap from POC to product. The POC only uses pre-loaded test samples; the product needs user recordings uploaded to backend for generation.

4. **Backend production deployment** — Backend needs a real host (Railway recommended — Docker + FFmpeg + rubberband support). MIDI files and generated audio stored persistently.

5. **Monetization via RevenueCat** — Soft paywall: 3 free generations/day, then upsell. RevenueCat handles IAP + subscription + A/B experiments without App Store re-submission.

6. **No user accounts for v1** — Avoid auth complexity. All state is local or anonymous. Anonymous user ID for server-side rate limiting.

## Technical Approach

### Frontend (Expo SDK 53 + React Native + TypeScript + NativeWind)
- Port existing screens from POC: Dashboard, Library, Create (Musical Fruit), Record, Review, Playback
- Add: Onboarding (first-launch), Settings (privacy policy, rate us), Share sheet, Favorites
- RevenueCat SDK for monetization
- Anonymous user ID (expo-crypto UUID, persisted to AsyncStorage) for rate limiting

### Backend (Bun + Hono)
- Port existing routes: `/api/musical-fruit/*`, `/api/sample/*`
- Add: `/api/recordings/upload` — accepts `.m4a`, runs sample analysis, caches
- Docker container with FFmpeg + rubberband + @tonejs/midi
- Deploy to Railway (Dockerfile in `backend/`)
- Rate limiting per anonymous user ID (in-memory or Redis)
- Generated audio cleanup job (>24h old files deleted)

### Infrastructure
- Railway for backend (Docker deploy)
- App Store Connect for iOS distribution
- RevenueCat for monetization
- No database needed for v1 (file-based caching for sample analysis)

## Implementation Strategy

Tasks ordered by dependency and value:

1. **Project bootstrap** — Set up official app directory structure, copy/port working code from archive
2. **Own recordings as source** — Upload endpoint + wire mobile recordings to generation picker
3. **Backend production deploy** — Dockerize + deploy to Railway
4. **Sharing** — Native share sheet for generated songs
5. **Polish & onboarding** — First-launch screen, app icon, splash screen
6. **Monetization** — RevenueCat + daily limit + paywall UI
7. **App Store submission** — Screenshots, metadata, TestFlight, submit

## Task Breakdown Preview

| # | Task | Parallel? | Depends on |
|---|------|-----------|------------|
| 001 | Bootstrap: migrate POC to official app structure | No | — |
| 002 | User recordings upload + analysis endpoint | No | 001 |
| 003 | Wire mobile recordings into Musical Fruit picker | No | 002 |
| 004 | Backend Docker + Railway production deploy | Yes | 001 |
| 005 | Native share sheet (generated songs + recordings) | Yes | 001 |
| 006 | Favorites (star/unstar recordings + songs) | Yes | 001 |
| 007 | App icon, splash screen, onboarding screen | Yes | 001 |
| 008 | RevenueCat integration + daily limit + paywall | No | 001 |
| 009 | Update docs (FEATURES.md, CLAUDE.md accuracy) | Yes | 001 |
| 010 | App Store submission (TestFlight → submit) | No | 002–009 |

## Dependencies

- FFmpeg + rubberband in production Docker image
- Apple Developer account (for TestFlight + App Store)
- RevenueCat account (free tier sufficient to start)
- Railway account (free tier or ~$5/mo)
- App Store Connect IAP products configured (before task 008)

## Success Criteria (Technical)

- [ ] User's own recordings appear in the Musical Fruit sample picker
- [ ] Generation works end-to-end with user recordings (not just test samples)
- [ ] Backend deployed at a real HTTPS URL, not localhost
- [ ] Native share sheet exports generated melody as audio file
- [ ] RevenueCat paywall shows after 3 free generations/day
- [ ] App passes App Store review (no crashes, proper permissions, privacy policy)
- [ ] All 20 songs generate in <30s on production server
- [ ] Zero memory leaks in recording/playback flow

## Estimated Effort

- Tasks 001–003 (core loop completion): ~3–4 sessions
- Tasks 004–008 (production + monetization): ~4–5 sessions
- Task 009–010 (docs + submission): ~2–3 sessions
- Total: ~10–12 focused sessions
