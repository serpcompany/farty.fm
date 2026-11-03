# Song Catalog import

Adds Songs to [`catalog/`](../../catalog/) in batches from PDMX (doi:10.5281/zenodo.15571083), keeping only the ones that pass the gates. Every Song is the cited score's own MIDI file; the import chooses only the excerpt and tempo ([ADR 0003](../../docs/adr/0003-songs-come-from-cited-scores.md)).

```sh
cd tools/melody-lab && uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python -r requirements.txt && cd ../..
tools/melody-lab/.venv/bin/python -I tools/catalog/import_pdmx.py --titles tools/catalog/titles-01.txt
tools/melody-lab/.venv/bin/python -I -m unittest discover -s tools/catalog -t tools/catalog
```

The first run downloads `PDMX.csv` (225 MB) and `mid.tar.gz` (214 MB) into `~/.cache/pedos/pdmx/` and checks them against Zenodo's md5. Every run reads the MIDI files of the scores it tries from the archive (about 6 s), and keeps an extracted file only while it's byte for byte the archive's.

| File | Role |
| --- | --- |
| `import_pdmx.py` | Downloads, picks, runs the gates with the reference engine, writes `catalog/` and the report |
| `pdmx.py` | The rules: title matching, picking, excerpt and tempo, and each gate's thresholds |
| `test_pdmx.py` | Unit tests for the rules |
| `titles-NN.txt` | A batch: one Song per line, `id \| Title \| alias; alias` |
| `titles-NN.report.md`, `.json` | The batch's pass/fail report for every title, and every score tried |
| `rank_pdmx.py` | Ranks the tune titles not yet tried by how popular their scores are, and writes the next batch |
| `test_rank_pdmx.py` | Unit tests for the ranking |
| `flag_picks.py` | After an import, lists the batch's passing picks whose own genre, tags or artist look modern, or that are one voice or a variant, and its Songs that are the same tune as another Song |
| `test_flag_picks.py` | Unit tests for the flags |
| `ranking.md` | The ranking: the top 1,500 titles not yet tried, and why the others are left out |
| `excluded-titles.txt` | Titles the ranking leaves out by hand, one `Title \| why` a line: under copyright, not one tune, or the same tune under another name |
| `song_reports.py` | Lists an export of D1's `song_reports` per Song, worst first, against the catalog's notes now ([`docs/agents/web.md`](../../docs/agents/web.md#reports-and-take-downs)) |
| `test_song_reports.py` | Unit tests for the list |

## Ranking

From `titles-04.txt` on, a batch is the top of the ranking (#312):

```sh
tools/melody-lab/.venv/bin/python -I tools/catalog/rank_pdmx.py --batch 150 --out tools/catalog/titles-05.txt
```

A tune title's scores are the ones the import would match for a Song of that name and its license gate accepts, so arrangements of one tune count under one title. Titles rank by those scores' views in all, then ratings in all, then mean rating. Titles already in the catalog or in any titles file are left out, so a title that failed stays failed, as are titles with one score, titles no score of which can be picked, composer or collection names, and the same tune under a longer, shorter or translated name. PDMX takes a score's license from its uploader, and many recent songs are marked public domain, so the ranking also leaves out titles whose scores have no MuseScore genre or mostly a modern one (pop, rock, soundtrack and the like), or whose named artists don't agree on one piece. What's left still holds songs under copyright and titles that aren't one tune: read the top of `ranking.md` before each batch, add them to `excluded-titles.txt` with the reason, and run it again. Neither the batch file nor the Songs imported from it count as tried while `--out` names it, so it can be written again even after its import. After the import, check the picks these ways:

```sh
tools/melody-lab/.venv/bin/python -I tools/catalog/flag_picks.py --titles tools/catalog/titles-05.txt
```

1. It lists each passing pick whose own MuseScore genre, tags or artist look modern (rock, soundtrack, Disney, "Misc Soundtrack" and the like). A title can pass the ranking's genre rule while the importer picks its one modern arrangement, as Misirlou's pick was Dick Dale's. Check each one listed.
2. It lists each passing pick whose title, subtitle or MIDI track names mark one voice or a variant (Tenor, Alto, Bass, Soprano, Descant, Harmony, "Version 4"): My Faith Looks Up To Thee's pick was the hymn's tenor part, and On Christmas Night's was "Version 4", another tune. When the pick isn't the melody, add its score to `pdmx.NOT_THE_MELODY` so the importer tries the next one; when no score left is the melody, pull the title.
3. It lists each pair of Songs, one of them from the batch, whose melodies open with the same 10 changes of pitch in any key (`OPENING_STEPS`): the same tune under another name, as Kings Of Orient was We Three Kings. Pull the batch's title as the same tune. Without `--titles` it checks the whole catalog; after #344 that flags two pairs, both kept: `ode` and `ode-mutopia` (the hand-entered Mutopia score, kept to test the importer and left out of the app), and `caro-mio-ben` and `bartlett-house`, which part after 11 notes.
4. Compare each passing score's MuseScore artist and composer (`artist_name` and `composer_name` in `PDMX.csv`) with the title's Artist in `ranking.md`: a pick by someone else may be another piece of the same name, or under copyright.

Add the titles to pull to `excluded-titles.txt` with the reason, delete their lines from the batch file, note them in its header, and import it again, so the catalog and the report match the batch file. A Song's catalog title is its batch-file title: to correct one the ranking spelled wrong ("Amhr'an na bhFiann"), write the proper title and keep the ranking's as an alias (`id | Title | alias`) when it's compared differently, so the import matches the same scores. Then run `rank_pdmx.py` without `--out` to bring `ranking.md` up to date.

## Picking

A score matches a title when its title, its title before ` - `, `(`, `[` or `:`, or its MuseScore song name is one of the Song's names (ignoring case, accents, punctuation and a leading "the"). A plain title ranks before an arrangement's title ("Greensleeves - Ukulele"), and both before a song-name match. It must be public domain or CC0, with no PDMX license conflict, have at most 2 tracks, and not be one of the scores whose bar lines are off the tune (`pdmx.MISBARRED_SCORES`: most are written without the Song's pickup, one in the wrong meter, so the accent on each bar line falls on the wrong notes, found by reading the catalog's scores against the words, #232), nor one that isn't the tune's melody (`pdmx.NOT_THE_MELODY`: a hymn's tenor part, #324). Then the highest rating wins, then the most views. If a score fails a gate, the next best is tried, up to `--tries` (5). Of the score's tracks, the importer (`melody.py`) takes the one with the highest mean pitch, leaving out percussion parts (MIDI channel 10, or an unpitched General MIDI percussive program such as Woodblock; Tinkle Bell, Steel Drums and Melodic Tom can carry a tune): O Sacred Head Now Wounded's score has wood blocks above the hymn (#324).

A title already in the catalog from another batch, or added by hand, fails, compared the same way ("The Itsy Bitsy Spider" and "Itsy Bitsy Spider" are one title). No two Songs share a score: one already in the catalog isn't picked, and one that passed for an earlier title in the batch fails the license gate for the later ones.

## Gates

1. **License**: as above, checked again on the pick.
2. **Hash**: the MIDI archive matches Zenodo's md5, and both the extracted file the gates import and the catalog copy are byte for byte the archive's file (its sha256 is in the entry).
3. **Melody sanity**: 8 to 64 notes and a range of at most 19 semitones in the excerpt, the importer (`melody.py`) drops at most 10% of the track's notes as chord tones or inner-voice onsets, and the first bar isn't a pickup padded with silence. That check fails the bar of the melody's first note when it opens with a note on the bar line, has no rest of 1 beat or more between its notes, and then every track rests 1 beat or more to the next bar line, for at least as long as the bar's notes lasted (#225). A pickup is at most half its bar, so a full bar that ends on a real rest passes.
4. **Render**: unlocked with the full Fixture Library, and the renderer's bar from [ADR 0012](../../docs/adr/0012-songs-play-farts-raw.md) on the reference render (`render()`, `evaluate.py`): at least 94% of notes within ±50 cents of their fart's own pitch, at least 95% of onsets within ±50 ms, and no re-attacks. Songs play farts raw, so how close a Song sounds to its tune is reported (`in50c`, `med`, `contour`), not gated.

The excerpt runs from the melody's first note to the end of the whole bars that fit in 32 quarter-note beats from that note's bar, so a pickup written after a rest in a full bar doesn't open the Song with silence (#232). Bar lines follow the score's time signatures, so a pickup written as its own short bar (1/4, then 3/4) keeps them, and `beats_per_bar` is the meter that covers most of the excerpt. The renderers accent the notes on the score's own bar lines (`melody.bar_lines`), wherever the excerpt starts. The tempo is the score's own at the first note, kept within 72 to 144 bpm.

PDMX's MIDI pads a pickup out to a full bar when a MuseScore 1.x score sets the pickup's length only in its time-signature map, not on the measure itself: PDMX's reader (`read_musescore.py`) takes a measure's length from its `len` attribute or its time signature, and MuseScore takes it from the map. The Song then plays its pickup, then silence for the rest of the bar. Happy Birthday and We Wish You a Merry Christmas came from two such scores, so they were imported again in `titles-03.txt`.

The run writes `catalog/` only after every passing Song's entry imports, through the catalog's own loader, to exactly the melody its gates judged. If one doesn't, it stops with `ReimportMismatch` and leaves `catalog/` and the report as they were.

## After a batch

Imported Songs are in the catalog, so the melody lab renders them (`run_all.py`, `build.py`), and the app ships every Song in the catalog but `ode-mutopia` (#350). To ship a batch, run `tools/melody-lab/export_golden.py`, which writes each Song's melody to `fixtures/golden/songs/`, then the app's generator (`apps/web/src/lib/catalog/generate.ts`); `catalog.test.ts` fails until both have run. Re-running a titles file replaces that batch's entries in their place; nothing else in the catalog changes. The importer has changed since the first batches, so re-running one may pick other scores: titles-01 would replace 8 shipped Songs' scores (#344). Compare the catalog before and after.
