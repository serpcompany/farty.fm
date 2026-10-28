# Song Catalog import

Adds Songs to [`catalog/`](../../catalog/) in batches from PDMX (doi:10.5281/zenodo.15571083), keeping only the ones that pass the gates. Every Song is the cited score's own MIDI file; the import chooses only the excerpt and tempo ([ADR 0003](../../docs/adr/0003-songs-come-from-cited-scores.md)).

It runs in the `tools/` uv project, beside the reference engine it imports ([setup](../melody-lab/README.md)). From the repository root, on Windows, macOS or Linux:

```sh
uv run --project tools python -I tools/catalog/import_pdmx.py --titles tools/catalog/titles-01.txt
uv run --project tools pytest tools/catalog
```

`python -I` keeps the script's own folder and the environment's variables off the import path, since the dataset is untrusted input; the project's editable install still puts `tools/melody-lab` and `tools/catalog` on it. The first run downloads `PDMX.csv` (225 MB) and `mid.tar.gz` (214 MB) into `~/.cache/pedos/pdmx/` and checks them against Zenodo's md5. Every run reads the MIDI files of the scores it tries from the archive (about 6 s), and keeps an extracted file only while it's byte for byte the archive's.

| File | Role |
| --- | --- |
| `import_pdmx.py` | The command: picks a score for each title, runs the gates, writes `catalog/` and the report, and renders the `--listen` sample |
| `pdmx.py` | The rules: title matching, picking, excerpt and tempo, and each gate's thresholds |
| `dataset.py` | Downloads PDMX, checks Zenodo's md5, and extracts the scores it tries from the MIDI archive |
| `gates.py` | Runs the gates on one score with the reference engine, and tries each title's scores best first |
| `catalog_writer.py` | Stages the picked scores and their entries, and writes `catalog/` only once every entry imports as gated |
| `report.py` | Writes `<titles>.report.md` and `.json` |
| `test_pdmx.py`, `test_import_pdmx.py`, `pdmx_testing.py` | Unit tests for the rules, and for the importer on temporary files with a stub renderer and no dataset |
| `testdata/` | The two MuseScore 1.x scores whose pickups PDMX padded ([95546](https://musescore.com/score/95546) and [151013](https://musescore.com/score/151013), #225), as PDMX publishes them |
| `titles-NN.txt` | A batch: one Song per line, `id \| Title \| alias; alias` |
| `titles-NN.report.md`, `.json` | The batch's pass/fail report for every title, and every score tried |

## Picking

A score matches a title when its title, its title before ` - `, `(`, `[` or `:`, or its MuseScore song name is one of the Song's names (ignoring case, accents, punctuation and a leading "the"). A plain title ranks before an arrangement's title ("Greensleeves - Ukulele"), and both before a song-name match. It must be public domain or CC0, with no PDMX license conflict, and have at most 2 tracks. Then the highest rating wins, then the most views. If a score fails a gate, the next best is tried, up to `--tries` (5).

A title already in the catalog from another batch, or added by hand, fails, compared the same way ("The Itsy Bitsy Spider" and "Itsy Bitsy Spider" are one title). No two Songs share a score: one already in the catalog isn't picked, and one that passed for an earlier title in the batch fails the license gate for the later ones.

## Gates

1. **License**: as above, checked again on the pick.
2. **Hash**: the MIDI archive matches Zenodo's md5, and both the extracted file the gates import and the catalog copy are byte for byte the archive's file (its sha256 is in the entry).
3. **Melody sanity**: 8 to 64 notes and a range of at most 19 semitones in the excerpt, the importer (`melody.py`) drops at most 10% of the track's notes as chord tones or inner-voice onsets, and the first bar isn't a pickup padded with silence. That check fails the bar of the melody's first note when it opens with a note on the bar line, has no rest of 1 beat or more between its notes, and then every track rests 1 beat or more to the next bar line, for at least as long as the bar's notes lasted (#225). A pickup is at most half its bar, so a full bar that ends on a real rest passes.
4. **Render**: unlocked with the full Fixture Library, and the renderer's bar from [ADR 0012](../../docs/adr/0012-songs-play-farts-raw.md) on the reference render (`render()`, `evaluate.py`): at least 94% of notes within ±50 cents of their fart's own pitch, at least 95% of onsets within ±50 ms, and no re-attacks. Songs play farts raw, so how close a Song sounds to its tune is reported (`in50c`, `med`, `contour`), not gated.

The excerpt is the whole bars that fit in 32 quarter-note beats, from the bar of the melody's first note. Bar lines follow the score's time signatures, so a pickup written as its own short bar (1/4, then 3/4) keeps them, and `beats_per_bar` is the meter that covers most of the excerpt. The tempo is the score's own at the first note, kept within 72 to 144 bpm.

PDMX's MIDI pads a pickup out to a full bar when a MuseScore 1.x score sets the pickup's length only in its time-signature map, not on the measure itself: PDMX's reader (`read_musescore.py`) takes a measure's length from its `len` attribute or its time signature, and MuseScore takes it from the map. The Song then plays its pickup, then silence for the rest of the bar. Happy Birthday and We Wish You a Merry Christmas came from two such scores, so they were imported again in `titles-03.txt`.

The run writes `catalog/` only after every passing Song's entry imports, through the catalog's own loader, to exactly the melody its gates judged. If one doesn't, it stops with `ReimportMismatch` and leaves `catalog/` and the report as they were. The merged `catalog.json` is staged too, and renamed over the real one only after the copies have moved in; the batch's stale copies go last, so a failure before the rename leaves the old `catalog.json` with every file it names.

## After a batch

Imported Songs are in the catalog, so the melody lab renders them (`run_all.py`, `build.py`), but they don't ship: the app lists only the Songs on its ship list (`apps/web/src/lib/catalog/ship-list.json`). Shipping some is a separate change that adds them to the ship list, re-exports `fixtures/golden/` (which covers every Song on the ship list) and regenerates the app's catalog. Re-running a titles file replaces that batch's entries; nothing else in the catalog changes.
