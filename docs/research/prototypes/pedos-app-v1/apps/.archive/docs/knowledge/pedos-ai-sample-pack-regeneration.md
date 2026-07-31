# Pedos AI Sample Pack Regeneration

Last reviewed: `2026-03-19`

## What was wrong

Issue `#1` and issue `#2` referenced these repo paths:

- `test-data/pedos-ai/fart-samples/README.md`
- `test-data/pedos-ai/fart-samples/freesound-cc0/audio/`
- `test-data/pedos-ai/fart-samples/freesound-cc0/manifest.json`
- `test-data/pedos-ai/fart-samples/freesound-cc0/manifest.csv`

In the earlier broken state, those files did not exist yet.

At that time, only the raw MP3 directory was present:

- `test-data/fart-samples/freesound.co/`

That raw pack contained `39` MP3s, not the `50` described in issue `#2`.

## Safe fix

Do not hand-maintain the manifest files.

Regenerate them with:

```bash
node scripts/pedos-ai/generate-sample-pack.mjs
```

When the raw source pack is available, that command:

- probes the checked-in MP3 files with `ffprobe`
- rebuilds the JSON and CSV manifests
- rebuilds the pack README
- refreshes the `audio` symlink under the expected `test-data/pedos-ai/...` path
- creates a provisional five-clip comparison seed

When the raw source pack is **not** available in the current checkout, the generator now safely falls back to the checked-in `manifest.json` so:

- repo tests still pass
- the README stays honest about the raw audio being absent
- the existing metadata can still be re-rendered without pretending the MP3 pack exists locally

This fallback is for keeping the repo consistent. It does **not** replace a true regeneration from source audio.

## Important limitation

The generator does not pretend to solve issue `#3`.

Every manifest row is intentionally marked:

- `needs-manual-review-for-issue-3`

That keeps the repo honest until someone does the listening pass to confirm which clips are truly single-fart recordings.

It also does not pretend the raw audio is present. If `test-data/fart-samples/freesound.co/` is missing, the generated README should say so explicitly.
