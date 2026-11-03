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
| `rank_pdmx.py` | Ranks the tune titles not yet tried by how popular their scores are, and writes the next batch |
| `flag_picks.py` | After an import, lists the batch's passing picks whose own genre, tags or artist look modern, or that are one voice or a variant, and its Songs that are the same tune as another Song |
| `test_rank_pdmx.py`, `test_flag_picks.py` | Unit tests for the ranking and the flags, on made-up rows with no dataset |
| `ranking.md` | The ranking: the top 1,500 titles not yet tried, and why the others are left out |
| `excluded-titles.txt` | Titles the ranking leaves out by hand, one `Title \| why` a line: under copyright, not one tune, or the same tune under another name |

## How it works

- [Picking](picking.md): how a title finds its scores, which one is picked, the excerpt and tempo, PDMX's padded pickups, and how the run writes `catalog/`.
- [Ranking and checking a batch](batches.md): how the next batch of titles is ranked, how its picks are checked after the import, and what a batch changes.

## Gates

1. **License**: as [Picking](picking.md) says, checked again on the pick.
2. **Hash**: the MIDI archive matches Zenodo's md5, and both the extracted file the gates import and the catalog copy are byte for byte the archive's file (its sha256 is in the entry).
3. **Melody sanity**: 8 to 64 notes and a range of at most 19 semitones in the excerpt, the importer (`melody.py`) drops at most 10% of the track's notes as chord tones or inner-voice onsets, and the first bar isn't a pickup padded with silence. That check fails the bar of the melody's first note when it opens with a note on the bar line, has no rest of 1 beat or more between its notes, and then every track rests 1 beat or more to the next bar line, for at least as long as the bar's notes lasted (#225). A pickup is at most half its bar, so a full bar that ends on a real rest passes.
4. **Render**: unlocked with the full Fixture Library, and the renderer's bar from [ADR 0012](../../docs/adr/0012-songs-play-farts-raw.md) on the reference render (`render()`, `evaluate.py`): at least 94% of notes within ±50 cents of their fart's own pitch, at least 95% of onsets within ±50 ms, and no re-attacks. Songs play farts raw, so how close a Song sounds to its tune is reported (`in50c`, `med`, `contour`), not gated.
