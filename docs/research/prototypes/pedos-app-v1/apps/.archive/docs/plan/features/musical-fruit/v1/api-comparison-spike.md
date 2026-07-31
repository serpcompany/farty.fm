# Pedos AI API Comparison Spike

Last reviewed: `2026-03-19`

## Status

- Scope: `Service Spike`
- Status: `Closed as a product mismatch for the fart-only MVP`
- Related issue: [#1](https://github.com/serpcompany/pedos-app/issues/1)

## Summary

Issue `#1` asked for a measured comparison across:

- `fal.ai` Stable Audio 2.5 audio-to-audio
- `Loudly` Audio Clips / Music API
- `Replicate` Meta MusicGen
- `Replicate` MiniMax Music 1.5
- `Google Vertex AI` Lyria 2

Additional service checked after the original spike:

- `AudioShake` Assets + Tasks API

This repo checkout did not yet contain the pack metadata paths that issue `#1` references.

The vendor credentials were later added locally for `fal.ai`, `Replicate`, and Loudly. After re-reading the official docs, adjusting the request shapes, and listening to the outputs, the current live picture is:

- `fal.ai`: fixed for real runs when the source audio is normalized to WAV and uploaded through the official `fal-client`
- `Replicate`: now returns successful `MusicGen` output for a real seeded fart clip and repeated the same bytes on a second identical run
- Loudly: still returns `403 Forbidden` on the remix upload route even with the swagger-correct host and multipart body
- `AudioShake`: key is valid, but the account has `0` credits and the public API is separation/transcription oriented rather than music generation

Final conclusion from the spike:

- none of the tested vendor APIs produced anything close to a song composed only of fart noises
- the tested APIs make normal AI music influenced by fart audio, not deterministic fart-only compositions
- the right MVP path is a local sample-based composition engine, not a third-party music-generation vendor

To move the issue forward anyway, the repo now includes:

- rebuilt sample-pack metadata at `test-data/pedos-ai/fart-samples/`
- a provisional five-clip comparison seed
- a repeatable generator script for the pack manifest
- a repeatable `fal.ai` runner for checked-in prepared WAV inputs
- current official capability notes and the exact blockers for each target service

## Working Checklist

- [x] Rebuild the missing sample-pack README and manifests in the repo paths referenced by issue `#1`
- [x] Create a repeatable generator so the sample-pack metadata can be refreshed without hand edits
- [x] Capture the exact current blockers for each target vendor
- [x] Record current public pricing notes where the vendor exposes them
- [x] Run first live auth/billing check against `fal.ai` Stable Audio 2.5
- [x] Run first live auth/billing check against Loudly
- [x] Run first live auth/billing check against `Replicate` MusicGen
- [x] Run successful `fal.ai` Stable Audio 2.5 generation with the shared comparison seed
- [ ] Run successful Loudly upload/remix test, or confirm the exact account limitation with Loudly support
- [x] Run successful `Replicate` MusicGen test
- [ ] Run live `Replicate` MiniMax Music 1.5 test
- [ ] Run live `Google Vertex AI` Lyria 2 text-only baseline test
- [x] Save successful `fal.ai` and `Replicate` outputs plus latency logs in the project `tmp/` comparison folder
- [ ] Save measured cost straight from each vendor dashboard or invoice view
- [ ] Finalize first-choice and backup recommendation from measured multi-clip results

## Baseline Pack Ready For Comparison

Use these repo paths:

- [README](/Users/devin/repos/projects/pedos-app/test-data/pedos-ai/fart-samples/README.md)
- [Manifest JSON](/Users/devin/repos/projects/pedos-app/test-data/pedos-ai/fart-samples/freesound-cc0/manifest.json)
- [Manifest CSV](/Users/devin/repos/projects/pedos-app/test-data/pedos-ai/fart-samples/freesound-cc0/manifest.csv)
- [Comparison Seed](/Users/devin/repos/projects/pedos-app/test-data/pedos-ai/fart-samples/freesound-cc0/comparison-seed.json)

Important caveat:

- every current clip is still marked `needs-manual-review-for-issue-3`
- the rebuilt metadata currently describes `39` clips, not the `50` called out in issue `#2`
- the raw source clip directory referenced by the metadata is not currently present in this checkout, so the working `fal.ai` runner uses already prepared WAV inputs under `tmp/pedos-ai-api-comparison/raw/`
- issue `#3` still needs a listening pass before we can honestly claim this is a clean single-fart-only baseline

## Service Comparison Snapshot

| Service | Direct uploaded audio support | Current product fit | Public pricing note | Exact blocker in this checkout |
| --- | --- | --- | --- | --- |
| `fal.ai` Stable Audio 2.5 | Yes. Official audio-to-audio endpoint requires `audio_url` and supports `strength`, `seed`, and optional `total_seconds`. | Strongest current evidence for “use the actual selected fart recordings” and “use all selected fart recordings” because both single-clip and five-clip prepared inputs produced output. | `fal.ai` currently exposes endpoint billing of `$0.20` per generated audio on the model page. | The basic path is fixed, but strict determinism is weak: repeated runs with the same source audio, prompt, and seed produced different SHA-256 hashes. |
| `Loudly` Audio Clips / Music API | Public developer swagger does expose an upload-based remix route at `/api/ai/vega/remix/bundles`, plus text and parameter-based generation routes. | Strong product-fit candidate if the account can actually use the remix route. | Loudly publicly says the API starts with a free track allowance and then uses volume-based pricing. The current account shows `15` `GENERATE_VEGA_SONG` credits remaining. | Live check succeeded for `/api/account/limits` and test prompt generation, but the upload/remix route returned `403 Forbidden`, so the fart-audio path is still blocked on account permissions or plan limits. |
| `Replicate` Meta MusicGen | Yes. Official schema exposes `input_audio`, `continuation`, `duration`, and `seed`. | Best current evidence for deterministic control because a repeated run on the same clip and seed returned the same output hash twice. | Replicate currently says MusicGen costs about `$0.065` per run and typically completes in about `47 seconds`. | Single-clip generation is now working, but the all-selected multi-clip case is still not measured. The current successful path used a public WAV URL, not a checked-in local upload helper. |
| `Replicate` MiniMax Music 1.5 | Partial and weaker fit. Public page emphasizes lyrics plus optional `5-30` second reference music for style learning. | More useful for later fuller-song experiments than for short single-fart transformation. | Replicate currently exposes MiniMax pricing at about `$0.03` per output audio file. | The account should now be able to reach this model through the same token, but it still has not been run live here and the public flow is not a clean short-fart audio-to-audio path. |
| `AudioShake` Assets + Tasks | Yes for uploaded source files through `POST /assets`, then `assetId` on `POST /tasks`. | Weak fit as a primary vendor because the public API is for source separation, music removal, transcription, and alignment, not music generation. It may still be useful later as a supporting post-process tool. | The public docs use a credit system and explicitly say asset uploads require available credits. | `GET /tasks` returned `200`, proving the key works, but uploading the prepared WAV returned `400 Client has 0 credits`. Even with credits, no public generative music endpoint was found in the docs. |
| `Google Vertex AI` Lyria 2 | No direct uploaded audio path was found in the current official docs reviewed here. The public flow is text-to-music only. | Weak fit for the core on-brand question because it cannot prove preservation of the original fart source audio. | Google currently prices Lyria generations at `$0.06` per generated `30`-second clip. | No Google Cloud project/billing/auth is configured locally, and the current API is text-only instrumental generation. |

## Acceptance-Criteria Snapshot

| Service | Uses actual selected recordings | Uses all selected recordings | Deterministic with fixed seed | Lyrics toggle measured | Instrumentals toggle measured |
| --- | --- | --- | --- | --- | --- |
| `fal.ai` Stable Audio 2.5 | Yes for clip `014` | Yes for the five-clip prepared seed `016,050,014,002,024` | No. Repeated outputs changed hash for both the single-clip and five-clip runs. | Not yet confirmed by listening | Not yet confirmed by listening |
| `Replicate` Meta MusicGen | Yes for clip `014` | Not yet measured | Yes on the tested single-clip run. Two repeated outputs matched byte-for-byte. | Not yet confirmed by listening | Not yet confirmed by listening |
| Loudly remix | Not proven | Not proven | Not proven | Not proven | Not proven |
| `AudioShake` Tasks | Input upload is supported, but no music generation endpoint was found | Not applicable as a generator | Not applicable as a generator | Not applicable as a generator | It can create instrumental-only stems from an existing song mix, but that is a different problem |

## Final Recommendation

### Product call

- do not use `fal.ai`, `Replicate`, Loudly, `AudioShake`, or Lyria as the primary MVP generation engine
- use a deterministic local sample-composition pipeline built only from the selected fart recordings

### Why

- the requirement is not “make AI music from a fart prompt”
- the requirement is “make a song composed only of fart noises”
- the tested vendor APIs failed that requirement even when they technically accepted audio input
- the MVP needs hard control over source usage, arrangement rules, and toggle obedience

## Recommended Next Execution Pass

1. Stop spending implementation time on third-party music-generation APIs for the fart-only MVP.
2. Build a local sample-composition MVP that uses only the selected fart recordings as source material.
3. Turn the current comparison harness into a deterministic local generation tool that can later sit behind the app UI.
4. Use vendor APIs only later if a non-MVP “AI remix” mode is added as a separate feature.

## Live Check Results

### `2026-03-19` account verification pass

- `Replicate` MusicGen
  - account endpoint returned `200` for user `devinschumacher`
  - a real prediction against `https://api.replicate.com/v1/predictions` later returned `201` and `succeeded`
  - the saved output used the uploaded clip `014.wav`, finished in about `13.43s`, and produced [replicate-014-rerun.wav](/Users/devin/repos/projects/pedos-app/tmp/pedos-ai-api-comparison/outputs/replicate-014-rerun.wav)
  - a repeated run with the same seed produced the same SHA-256 hash and saved [replicate-014-rerun-repeat.wav](/Users/devin/repos/projects/pedos-app/tmp/pedos-ai-api-comparison/outputs/replicate-014-rerun-repeat.wav)
- `fal.ai` Stable Audio 2.5
  - first raw HTTP attempt against `https://fal.run/fal-ai/stable-audio-25/audio-to-audio` returned `403 User is locked. Reason: Exhausted balance.`
  - after credits were added, raw MP3 attempts still failed, but the official `fal-client` plus normalized WAV input succeeded
  - clip `014` produced [fal-014-wav.wav](/Users/devin/repos/projects/pedos-app/tmp/pedos-ai-api-comparison/outputs/fal-014-wav.wav) in about `20.33s`
  - the repeated clip `014` run produced [fal-014-wav-repeat.wav](/Users/devin/repos/projects/pedos-app/tmp/pedos-ai-api-comparison/outputs/fal-014-wav-repeat.wav), but with a different SHA-256 hash
  - the full five-clip prepared seed produced [fal-all-selected.wav](/Users/devin/repos/projects/pedos-app/tmp/pedos-ai-api-comparison/outputs/fal-all-selected.wav) and the checked-in runner reproduced that path into [fal-all-selected-fixed.wav](/Users/devin/repos/projects/pedos-app/tmp/pedos-ai-api-comparison/outputs/fal-all-selected-fixed.wav)
- Loudly account limits
  - request to `/api/account/limits` returned `200`
  - result: `GENERATE_VEGA_SONG left: 15`
  - meaning: the Loudly key is valid and the account has song-generation quota
- Loudly prompt generation
  - request to `/api/ai/prompt/songs` with `test=true` returned `200`
  - meaning: text-based generation routes are usable on this account
- Loudly remix upload
  - request to `https://soundtracks.loudly.com/api/ai/vega/remix/bundles` with the swagger-correct multipart fields `music_file`, `genre`, and `bpm` still returned `403 Forbidden`
  - meaning: the upload-based fart-to-song route is still blocked on account permissions or product plan, not a malformed request body
- `AudioShake` API
  - `GET https://api.audioshake.ai/tasks?skip=0&take=1` returned `200` with an empty list
  - `POST https://api.audioshake.ai/assets` with the prepared `014.wav` clip returned `400 Client has 0 credits. Please add credits to make this request.`
  - meaning: the key is valid, but the account cannot upload assets yet, and the public docs show source separation rather than generative song creation

## Saved Artifacts

Current request logs are saved at:

- [replicate-016.json](/Users/devin/repos/projects/pedos-app/tmp/pedos-ai-api-comparison/logs/replicate-016.json)
- [fal-016.json](/Users/devin/repos/projects/pedos-app/tmp/pedos-ai-api-comparison/logs/fal-016.json)
- [fal-014.json](/Users/devin/repos/projects/pedos-app/tmp/pedos-ai-api-comparison/logs/fal-014.json)
- [fal-014-wav.json](/Users/devin/repos/projects/pedos-app/tmp/pedos-ai-api-comparison/logs/fal-014-wav.json)
- [fal-014-wav-repeat.json](/Users/devin/repos/projects/pedos-app/tmp/pedos-ai-api-comparison/logs/fal-014-wav-repeat.json)
- [fal-all-selected.json](/Users/devin/repos/projects/pedos-app/tmp/pedos-ai-api-comparison/logs/fal-all-selected.json)
- [fal-all-selected-fixed.json](/Users/devin/repos/projects/pedos-app/tmp/pedos-ai-api-comparison/logs/fal-all-selected-fixed.json)
- [replicate-014-rerun.json](/Users/devin/repos/projects/pedos-app/tmp/pedos-ai-api-comparison/logs/replicate-014-rerun.json)
- [replicate-014-rerun-repeat.json](/Users/devin/repos/projects/pedos-app/tmp/pedos-ai-api-comparison/logs/replicate-014-rerun-repeat.json)
- [loudly-remix-014-rerun.json](/Users/devin/repos/projects/pedos-app/tmp/pedos-ai-api-comparison/logs/loudly-remix-014-rerun.json)
- [audioshake-list-tasks.json](/Users/devin/repos/projects/pedos-app/tmp/pedos-ai-api-comparison/logs/audioshake-list-tasks.json)
- [audioshake-upload-014.json](/Users/devin/repos/projects/pedos-app/tmp/pedos-ai-api-comparison/logs/audioshake-upload-014.json)

Current output audio files are saved at:

- [fal-014-wav.wav](/Users/devin/repos/projects/pedos-app/tmp/pedos-ai-api-comparison/outputs/fal-014-wav.wav)
- [fal-014-wav-repeat.wav](/Users/devin/repos/projects/pedos-app/tmp/pedos-ai-api-comparison/outputs/fal-014-wav-repeat.wav)
- [fal-all-selected.wav](/Users/devin/repos/projects/pedos-app/tmp/pedos-ai-api-comparison/outputs/fal-all-selected.wav)
- [fal-all-selected-fixed.wav](/Users/devin/repos/projects/pedos-app/tmp/pedos-ai-api-comparison/outputs/fal-all-selected-fixed.wav)
- [replicate-014-rerun.wav](/Users/devin/repos/projects/pedos-app/tmp/pedos-ai-api-comparison/outputs/replicate-014-rerun.wav)
- [replicate-014-rerun-repeat.wav](/Users/devin/repos/projects/pedos-app/tmp/pedos-ai-api-comparison/outputs/replicate-014-rerun-repeat.wav)

## Official References

- `fal.ai` Stable Audio 2.5 audio-to-audio:
  https://fal.ai/models/fal-ai/stable-audio-25/audio-to-audio/api
- Loudly Audio Clips:
  https://www.loudly.com/audio-clips
- Loudly Music API:
  https://www.loudly.com/music-API
- Replicate Meta MusicGen:
  https://replicate.com/meta/musicgen
- Replicate MiniMax Music 1.5:
  https://replicate.com/minimax/music-1.5
- AudioShake Assets:
  https://developer.audioshake.ai/assets
- AudioShake Tasks:
  https://developer.audioshake.ai/tasks
- AudioShake Models:
  https://developer.audioshake.ai/models
- Google Vertex AI Lyria music generation:
  https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/lyria-music-generation
- Google Vertex AI generative pricing:
  https://cloud.google.com/vertex-ai/generative-ai/pricing
