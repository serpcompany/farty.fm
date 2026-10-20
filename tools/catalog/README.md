# Song Catalog import

Adds Songs to [`catalog/`](../../catalog/) in batches from PDMX (doi:10.5281/zenodo.15571083), keeping only the ones that pass the gates. Every Song is the cited score's own MIDI file; the import chooses only the excerpt and tempo ([ADR 0003](../../docs/adr/0003-songs-come-from-cited-scores.md)).

```sh
cd tools/melody-lab && uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python -r requirements.txt && cd ../..
tools/melody-lab/.venv/bin/python -I tools/catalog/import_pdmx.py --titles tools/catalog/titles-01.txt
tools/melody-lab/.venv/bin/python -I -m unittest discover -s tools/catalog -t tools/catalog
```

The first run downloads `PDMX.csv` (225 MB) and `mid.tar.gz` (214 MB) into `~/.cache/pedos/pdmx/` and checks them against Zenodo's md5. It extracts only the MIDI files of the scores it tries.

| File | Role |
| --- | --- |
| `import_pdmx.py` | Downloads, picks, runs the gates with the reference engine, writes `catalog/` and the report |
| `pdmx.py` | The rules: title matching, picking, excerpt and tempo, and each gate's thresholds |
| `test_pdmx.py` | Unit tests for the rules |
| `titles-NN.txt` | A batch: one Song per line, `id \| Title \| alias; alias` |
| `titles-NN.report.md`, `.json` | The batch's pass/fail report for every title, and every score tried |

## Picking

A score matches a title when its title, its title before ` - `, `(`, `[` or `:`, or its MuseScore song name is one of the Song's names (ignoring case, accents, punctuation and a leading "the"). A plain title ranks before an arrangement's title ("Greensleeves - Ukulele"), and both before a song-name match. It must be public domain or CC0, with no PDMX license conflict, and have at most 2 tracks. Then the highest rating wins, then the most views. If a score fails a gate, the next best is tried, up to `--tries` (5).

## Gates

1. **License**: as above, checked again on the pick.
2. **Hash**: the MIDI archive matches Zenodo's md5, and the catalog copy is byte for byte the archive's file (its sha256 is in the entry).
3. **Melody sanity**: 8 to 64 notes and a range of at most 19 semitones in the excerpt, and the importer (`melody.py`) drops at most 10% of the track's notes as chord tones or inner-voice onsets.
4. **Render**: unlocked with the full Fixture Library, and the renderer's bar from [`fixtures/golden/README.md`](../../fixtures/golden/README.md) on the reference render (`render(tune=1.0)`, `evaluate.py`): at least 94% of notes within ±50 cents, at least 95% of onsets within ±50 ms, and no re-attacks.

The excerpt is the whole bars that fit in 32 quarter-note beats, from the bar of the melody's first note. Bar lines follow the score's time signatures, so a pickup written as its own short bar (1/4, then 3/4) keeps them, and `beats_per_bar` is the meter that covers most of the excerpt. The tempo is the score's own at the first note, kept within 72 to 144 bpm.

## After a batch

Imported Songs are in the catalog, so the melody lab renders them (`run_all.py`, `build.py`), but they don't ship: the app lists only the Songs on its ship list (`apps/web/src/lib/catalog/generate.ts`). Shipping some is a separate change that adds them to the ship list, re-exports `fixtures/golden/` and regenerates the app's catalog. Re-running a titles file replaces that batch's entries; nothing else in the catalog changes.
