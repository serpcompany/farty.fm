# Pedos AI Audio API Runs

Last reviewed: `2026-03-19`

## What actually fixed `fal.ai`

The first successful `fal.ai` path in this repo was:

1. normalize the source fart audio to WAV with `ffmpeg`
2. upload that WAV with the official Python `fal_client`
3. call `fal-ai/stable-audio-25/audio-to-audio` with `audio_url`, `prompt`, `strength`, and `seed`

The earlier raw MP3 attempts were brittle and produced `500 Internal Server Error` on the tested clips.

## Checked-in runner

Use:

```bash
python scripts/pedos-ai/run-fal-audio-to-audio.py \
  --all-selected \
  --prepared-input tmp/pedos-ai-api-comparison/raw/seed-all/all-selected.wav \
  --label all-selected-fixed
```

That writes:

- a request log under `tmp/pedos-ai-api-comparison/logs/`
- a generated WAV under `tmp/pedos-ai-api-comparison/outputs/`

## Important limitation in this checkout

The sample-pack metadata still references source clip paths like:

- `test-data/fart-samples/freesound.co/...`

Those raw source files are not currently present in this checkout, so the checked-in runner is using the already prepared WAV inputs in `tmp/pedos-ai-api-comparison/raw/` for now.

## Current measured vendor behavior

- `fal.ai`
  - single-clip run succeeded
  - five-clip prepared-seed run succeeded
  - repeated runs with the same seed did **not** keep the same SHA-256 hash
- `Replicate MusicGen`
  - single-clip run succeeded
  - repeated run with the same seed **did** keep the same SHA-256 hash
- Loudly remix
  - still returns `403 Forbidden` even with the swagger-correct multipart body and host
- `AudioShake`
  - `GET /tasks` proves the key is valid
  - `POST /assets` is blocked because the account currently has `0` credits
  - the public API is for separation/transcription, not generative song creation

## Why this matters

For the product tests that matter most:

- `Replicate` currently has the best evidence for deterministic behavior
- `fal.ai` currently has the best evidence for conditioning on all selected fart recordings
- Loudly is still blocked before those tests can even be judged
- `AudioShake` is not a primary fart-to-song candidate from the current public docs

## Final product takeaway

The tested APIs are still the wrong tool for the fart-only MVP.

They can react to fart audio, but they do not reliably produce a song made only from fart sounds. They produce normal AI music that is merely influenced by the fart input.

For the MVP, the engine should be:

- local
- deterministic
- sample-based
- limited to the user’s selected fart recordings as the only source material
