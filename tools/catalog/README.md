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
| `composers.py` | Each Song's composer ([Composers](#composers)): PDMX's names in one spelling each, and the rules, `check`, `apply` and `plan` for the lookup batches |
| `test_composers.py` | Unit tests for the composer rules, and every batch against the catalog |
| `composers-NN.json` | A batch of composer lookups: one record per Song, most viewed first |
| `composers-NN.report.md` | The batch's report, written by `apply`: every Song's composer and source, the Unknowns and the removals |
| `tag.py` | Each Song's kind, origin, fame and Well known ([Tags](#tags)): `fetch`, `apply`, `check` and `guess` |
| `test_tag.py` | Unit tests for the tag rules, and every Song's tags against the catalog |
| `tag-signals.json` | What `fetch` found for each Song: its tune's page, categories, pageviews, The Session's type, PDMX views |
| `tag-hand.json` | Tags set by hand, which win over the rules, each with its reason |
| `tags.report.md` | Written by `apply`: the counts, and every Song's tags with the source of each |
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

A score matches a title when its title, its title before ` - `, `(`, `[` or `:`, or its MuseScore song name is one of the Song's names (ignoring case, accents, punctuation and a leading "the"). A plain title ranks before an arrangement's title ("Greensleeves - Ukulele"), and both before a song-name match. It must be public domain or CC0, with no PDMX license conflict, have at most 2 tracks, and not be one of the scores whose bar lines are off the tune (`pdmx.MISBARRED_SCORES`: most are written without the Song's pickup, one in the wrong meter, so the accent on each bar line falls on the wrong notes, found by reading the catalog's scores against the words, #232), nor one that isn't the tune's melody (`pdmx.NOT_THE_MELODY`: a hymn's tenor part, #324). Then the highest rating wins, then the most views. If a score fails a gate, the next best is tried, up to `--tries` (5). Of the score's tracks, the importer (`melody.py`) takes the one with the highest mean pitch, leaving out percussion parts (MIDI channel 10, or an unpitched General MIDI percussive program such as Woodblock; Tinkle Bell, Steel Drums and Melodic Tom can carry a tune): O Sacred Head Now Wounded's score has wood blocks above the hymn (#324). When the tune moves to another staff, of that track's part or another part, the importer reads the staves that carry it as one (the sanity gate, below).

A title already in the catalog from another batch, or added by hand, fails, compared the same way ("The Itsy Bitsy Spider" and "Itsy Bitsy Spider" are one title). No two Songs share a score: one already in the catalog isn't picked, and one that passed for an earlier title in the batch fails the license gate for the later ones.

## Gates

1. **License**: as above, checked again on the pick.
2. **Hash**: the MIDI archive matches Zenodo's md5, and both the extracted file the gates import and the catalog copy are byte for byte the archive's file (its sha256 is in the entry).
3. **Melody sanity**: 8 to 64 notes and a range of at most 19 semitones in the excerpt, the importer (`melody.py`) drops at most 10% of the track's notes as chord tones or inner-voice onsets, and the first bar isn't a pickup padded with silence. That check fails the bar of the melody's first note when it opens with a note on the bar line, has no rest of 1 beat or more between its notes, and then every track rests 1 beat or more to the next bar line, for at least as long as the bar's notes lasted (#225). A pickup is at most half its bar, so a full bar that ends on a real rest passes.

   The melody also fails when it rests between two notes while another staff of the score plays the tune, so the Song would fall silent where the score plays on (#380): for 1 beat or more (`MOVED_TUNE_REST`) while another staff of its own part plays, or 2 beats or more (`OTHER_PART_REST`) while another part does. Old MacDonald's piano score gives "Old MacDonald had a farm" to the left hand and "E-I-E-I-O" to the right, and Moments Musicaux's first violin rests while the second plays the tune. `melody.py` keeps a gap as a real rest when it's a full beat or more, or longer than the note before it. So a shorter rest can exist, and one with the tune on another staff would pass today, though none of the catalog's has it; the shortest that lost notes were exactly 1 beat, 6 of them in Jesus Loves Me (#396). Another part keeps 2 beats, since the catalog's 5 rests of 1 to 2 beats while another part plays are the melody's breath while that part accompanies or answers it: The Swan's baritone sax, Ave Maria's guitar, The Parting Glass's violin. PDMX's MIDI writes each staff of a part as a track with the part's name and channel, so a piano's two staves are two "Piano" tracks on one channel, and another part (a voice over its piano, a second violin) has a channel of its own. The line is the notes `melody.py` would take from that staff in the rest, and it's the tune when it's in the tune's register, the melody and it spanning at most 19 semitones, so a bass under the tune is its accompaniment. Another part's line must also have two pitches or more and not a chord at every onset: a part that sounds one repeated pitch or only chords in the rest (Radetzky's guitar, Erlkönig's piano) accompanies, while the other hand of the melody's own instrument answers it even with one note, unless the rest is under 2 beats and that hand plays only chords in it (Marche Slave's left hand keeps its off-beat chord through a rest of 1.15 beats, #396). A sung melody's rest while an instrument plays is the score's (Danny Boy's voice over its piano's intro): a part is a voice when its General MIDI program is Choir Aahs, Voice Oohs or Synth Voice, or its name is a voice's (`pdmx.VOICE_NAMES`), and another voice can still carry the tune. Percussion staves never do. Such a melody is read again from its staff and those that carry the tune as one (`render.track` lists them), and passes only if that reading passes every gate: in a choir's score whose two Soprano staves are one part, and in Moments Musicaux's duet, it drops too many notes. A shorter rest isn't checked, nor one before the excerpt's first note.
4. **Render**: unlocked with the full Fixture Library, and the renderer's bar from [ADR 0012](../../docs/adr/0012-songs-play-farts-raw.md) on the reference render (`render()`, `evaluate.py`): at least 94% of notes within ±50 cents of their fart's own pitch, at least 95% of onsets within ±50 ms, and no re-attacks. Songs play farts raw, so how close a Song sounds to its tune is reported (`in50c`, `med`, `contour`), not gated.

The excerpt runs from the melody's first note to the end of the whole bars that fit in 32 quarter-note beats from that note's bar, so a pickup written after a rest in a full bar doesn't open the Song with silence (#232). When a melody note of 2 beats or more (`HELD_NOTE_BEATS`) starts on that closing bar line, the excerpt runs on to that note's end, so the Song doesn't stop one note before its phrase does (#389): Grand Old Flag's pickup is a bar of its own, so its excerpt stopped on "the home of the free and the", and "brave" starts on the closing bar line. That note may run up to 4 beats (`HELD_OVERRUN_BEATS`) past the 32 beats from the excerpt's start, the furthest any Song's held note needs (Oh! Susanna's and O Come, All Ye Faithful's, #394). The excerpt takes in only that note, and only when it follows on from the melody: after a rest of 2 beats or more (`HELD_NOTE_REST`) the Song would fall silent just before its last note, as Rule, Britannia! would where its left hand plays on to the E4 that repeats its refrain. When taking that note in locks the Song with the full Fixture Library (no fart there lasts it), the excerpt stops on the bar line, as before, since the render gate would fail the score for that one note. Bar lines follow the score's time signatures, so a pickup written as its own short bar (1/4, then 3/4) keeps them, and `beats_per_bar` is the meter that covers most of the excerpt. The renderers accent the notes on the score's own bar lines (`melody.bar_lines`), wherever the excerpt starts. The tempo is the score's own at the first note, kept within 72 to 144 bpm.

PDMX's MIDI pads a pickup out to a full bar when a MuseScore 1.x score sets the pickup's length only in its time-signature map, not on the measure itself: PDMX's reader (`read_musescore.py`) takes a measure's length from its `len` attribute or its time signature, and MuseScore takes it from the map. The Song then plays its pickup, then silence for the rest of the bar. Happy Birthday and We Wish You a Merry Christmas came from two such scores, so they were imported again in `titles-03.txt`.

The run writes `catalog/` only after every passing Song's entry imports, through the catalog's own loader, to exactly the melody its gates judged. If one doesn't, it stops with `ReimportMismatch` and leaves `catalog/` and the report as they were.

## After a batch

Imported Songs are in the catalog, so the melody lab renders them (`run_all.py`, `build.py`), and the app ships every Song in the catalog but `ode-mutopia` (#350). To ship a batch, run `tools/melody-lab/export_golden.py`, which writes each Song's melody to `fixtures/golden/songs/`, then the app's generator (`apps/web/src/lib/catalog/generate.ts`); `catalog.test.ts` fails until both have run. Re-running a titles file replaces that batch's entries in their place; nothing else in the catalog changes. The importer has changed since the first batches, so re-running one may pick other scores: titles-01 would replace 8 shipped Songs' scores (#344), and titles-02 more. Compare the catalog before and after. To import some of a batch's Songs again, as after a change to the gates, name them with `--only id,id`: the batch's other Songs and their report rows stay as they are, and the report says which titles were imported again (#380).

A re-imported Song keeps its composer. A new Song is in no composer batch, so `composers.test.ts` fails until it's in one: run `composers.py plan` (below) and look the new batch up, in the import's PR or its own.

A re-imported Song loses its tags, and a new Song has none, so `tag.py check` fails until `tag.py fetch` and `tag.py apply` have run ([Tags](#tags)). Re-running `apply` alone puts back the tags of a Song already in `tag-signals.json`, which is how to settle a conflict in `catalog/catalog.json`.

## Composers

Every Song names its composer, with the page that says so (#357). The fields sit after `title` in `catalog/catalog.json`:

- `composer`: one name ("Frédéric Chopin"), several joined by ` and `, "Traditional (Irish)" for a folk tune, or "Unknown". The app's Compose index (`SongSummary.composer`) carries it, and leaves it out for "Unknown" and for a Song not looked up yet.
- `composer_died`: the year the last of them died. Only for a named composer, and needed for one unless the tune was first published before 1931 (step 4).
- `composer_source`: the page that says who wrote it.

The batch record also holds what the lookup found but the catalog doesn't keep: `lyricist_died`, `published`, `checked` and `note`. It can hold the Song's `kind` and `origin` too: `tag.py guess`'s first guess, which the lookup confirms. They never beat `tag.py`'s rules, and `tag.py check` fails a record whose value isn't the Song's tag ([Tags](#tags)).

`source.composer` stays as PDMX gave it. PDMX's name is the uploader's, and often wrong: "NA" for most Songs, a lyricist, an arranger or a collection. Never copy it without checking.

The lookups are in batch files, `composers-01.json` and on, about 150 Songs each, most viewed on MuseScore first. Every Song in the catalog is in exactly one. `apps/web/src/lib/catalog/composers.test.ts` counts the Songs looked up, and the count can't go down: each looked-up Song must carry its batch's answer, and no Song may have a composer its batch doesn't give it. Once no batch has a record left open, every Song must have `composer` and `composer_source`.

### Look up a batch

Batches run in parallel, so a worker touches only its own batch: one agent fills `composers-NN.json` and writes its report, on its own branch from `staging`, and never runs `apply`, imports, regenerates or edits `catalog/catalog.json`, the titles files or `composers.py`. One integration PR then brings every batch into the catalog at once ([below](#bring-the-batches-in)). For each record of `composers-NN.json` whose `composer` isn't set yet:

1. Find who wrote the melody the Song plays: not the words, the arrangement or the uploader. Start from the record's `title` and `score` (its MuseScore page, to tell which piece of that name it is), and treat `pdmx` as a hint only.
2. Use only these sources: Wikipedia (any language), IMSLP, The Session, the Traditional Tune Archive (tunearch.org), the Mutopia Project, or the Song's own MuseScore score (its `score`). Prefer the tune's own page; the composer's page counts when it names the work. Never guess.
3. Write `composer` the catalog's way:
   - A person: their English Wikipedia article's title, without its bracketed disambiguation ("Antonín Dvořák", "Turlough O'Carolan", "George Frideric Handel"). With no English article, the source's spelling. No dates, "arr." or "attrib.".
   - Several: joined by ` and ` ("Peadar Kearney and Patrick Heeney").
   - Name a person only when the source says they wrote the tune, even with "attributed" or "probably"; put that doubt in `note`. A person named only as printer, publisher, collector or adapter isn't a credit, and neither is one the source can't tell from an adapter ("not making it clear whether he was the composer or adapter"): write `Traditional` for a folk tune, else `Unknown`.
   - A folk tune nobody is credited with: `Traditional (<tradition>)`, the tradition as the source gives it, one capitalized adjective or two ("Traditional (Irish)", "Traditional (African American)" for a spiritual), or `Traditional` when it doesn't say.
   - `Unknown`: the tune isn't a folk tune and no source you read names who wrote it, whether it says nobody knows or says nothing. Add `checked`, the list of page URLs you read.
   - `composers.py check` refuses another spelling of a name it knows (`ALIASES`). When it's a new name and PDMX spells it another way, list both spellings in your hand-back for the integration PR to add to `ALIASES`.
   - Confirm or correct the record's `kind` and `origin`, `tag.py guess`'s first guess, from the pages you read for the composer: `kind` one of Christmas, Kids, Hymns, Anthems, Classical, Songs or Fiddle tunes, and `origin` where the tune is from, as one of `tag.py`'s `DEMONYMS` origins ("Irish", "African American"), or `null` when no page says ([Tags](#tags)). A `Traditional (<tradition>)` composer gives the origin, so an origin that disagrees with it is wrong. Name the page behind a corrected value in `note`: the integration PR moves a correction the rules don't reach into `tag-hand.json` with it.
4. Add `composer_source`, and `published`, the year the tune was first published, when the source gives it. For a named composer, add `composer_died` (an integer), from the source or the composer's own article; for several composers, the last of their deaths. When neither gives it, look at the composer's IMSLP category page (`imslp.org/wiki/Category:<Surname>,_<Given>`), which lists dates. With no death year anywhere, `check` passes the record only with a `published` before 1931 and a `note` that says why the year is missing; else the Song is a removal (step 5). When the words were written with the music (a song written by its composer and lyricist together, not words set to an older tune or written to it later), add `lyricist_died`, the year the last of those lyricists died, from the source or the lyricist's own article, and name the lyricist and the page in `note`. Add a short `note` for anything else a reader would ask (the words' author, another attribution).
5. **Under copyright**: when `composer_died` or `lyricist_died` is after 1955, or `published` is 1931 or later ([ADR 0003](../../docs/adr/0003-songs-come-from-cited-scores.md), `excluded-titles.txt`; `composers.py` and `composers.test.ts` read the two years from `copyright.json`), the Song leaves the catalog. Mark its record with `remove`, the reason in words ("first published in 1931 or later: Morris first published it in 1940"), and the years that show it, and list it in your hand-back. Don't pull it yourself: the integration PR does. A Song added by hand (no `import` in its catalog entry) keeps `remove` too: say in your hand-back that it was added by hand, for the owner, since it has no titles file to pull it from.
6. Check the batch and write its report:

   ```sh
   tools/melody-lab/.venv/bin/python -I tools/catalog/composers.py check --batch tools/catalog/composers-NN.json
   tools/melody-lab/.venv/bin/python -I tools/catalog/composers.py report --batch tools/catalog/composers-NN.json
   ```

   `report` refuses while `check --batch` lists a problem. Both print the batch's counts (named, traditional, unknown, to remove, open). `python3 -I tools/catalog/tag.py check` lists a `kind` or `origin` it doesn't know.
7. Commit only `composers-NN.json` and `composers-NN.report.md`, push the branch and hand back its name, the counts, the Songs to remove, the Unknowns and any new spellings. Don't open a PR: `composers.test.ts` fails a branch whose lookups aren't in the catalog yet.

### Bring the batches in

One PR, after every worker has handed back:

1. Merge each worker's branch. They touch only their own batch files, so they merge cleanly. Add the new spellings to `ALIASES`.
2. Pull every Song marked `remove` the way [Ranking](#ranking) pulls a title: add it to `excluded-titles.txt` with the reason, delete its line from its titles file (its entry's `import.titles`) and note that in the file's header. Then import each titles file that lost a line once. Compare the catalog before and after: when an import changes any other Song (titles-01 would, #344), restore the catalog and that titles file's report, and pull its Songs by hand instead. A Song added by hand (no `import` in its catalog entry) is pulled by hand too: delete its entry from `catalog/catalog.json` and its MIDI from `catalog/midi/`. Its record keeps `remove` either way, since `check` fails a kept Song over the limits, and the PR lists each Song pulled by hand for the owner.
3. Apply each batch. `apply` refuses while one of the batch's removals is still in the catalog. Then check them all:

   ```sh
   for b in tools/catalog/composers-0[2-7].json; do tools/melody-lab/.venv/bin/python -I tools/catalog/composers.py apply --batch "$b" || break; done
   tools/melody-lab/.venv/bin/python -I tools/catalog/composers.py check
   ```

4. Run `tools/melody-lab/export_golden.py` (from `tools/melody-lab`, with its venv) and the generator once, from `apps/web`: `pnpm exec tsx src/lib/catalog/generate.ts`. Set the shipped Songs' count in `apps/web/src/lib/catalog/catalog.test.ts`, and the locked Songs' count in `apps/web/src/lib/pitch-coverage.test.ts` when a removed Song changes it. Then tag the new Songs from what the lookups found ([Tags](#tags)): `tag.py fetch` again, since a Song's tune page, pageviews and Session type come from its `composer_source`, then `tag.py apply`. `tag.py check` lists each batch record whose `kind` or `origin` isn't the Song's tag: correct the record when the rules are right (often the lookup's `Traditional (<tradition>)` settles it), or hand-set the value in `tag-hand.json`, with the page from the record's `note` as its `source`. Then the unit tests above and `pnpm check`.
5. Open the PR with `Closes #357` when no record is left open, else `Part of #357` and a line `No issue: <why>` (the issue-link check needs one). Give the count `check` printed, the removed Songs, the Unknowns and the Songs left for the owner.

CI runs `composers.py check`, `tag.py check` and their unit tests whenever anything under `catalog/` or `tools/catalog/` changes.

### New batches

`plan` puts every Song in no batch into new batch files of about `--size` (150) Songs, most viewed first, from `PDMX.csv` in the cache. `--batches K` writes only K batches of `--size`.

```sh
tools/melody-lab/.venv/bin/python -I tools/catalog/composers.py plan
```

Then give each new record its first guess at the Song's kind and origin, before the batches go to the workers, and commit `tag-signals.json` with the batches:

```sh
python3 -I tools/catalog/tag.py fetch
python3 -I tools/catalog/tag.py guess --batch tools/catalog/composers-08.json
```

The guess comes before the lookup, from the title alone, so it's only a starting point: the integration PR fetches again after the lookups ([step 4](#bring-the-batches-in)).

## Tags

Every Song has a kind, an origin and a fame (#383, from #381's research). The fields sit after the composer fields in `catalog/catalog.json`:

- `kind`: one of Christmas, Kids, Hymns, Anthems, Classical, Songs or Fiddle tunes (`tag.KINDS`).
- `origin`: where the tune is from, as today's demonym ("Irish", "Czech" for Bohemia) or a tradition ("African American"), or `null` when no source says.
- `fame`: `log10(1 + pageviews) + log10(1 + PDMX views)`, for sorting. Pageviews are 12 months' views of the tune's own English Wikipedia page by people, not bots; PDMX views are summed over every score with one of the Song's names, as the import matches them.
- `well_known`: `true` when pageviews ≥ 20,000 and PDMX views ≥ 200, or pageviews ≥ 150,000, or PDMX views ≥ 5,000.

```sh
python3 -I tools/catalog/tag.py fetch
python3 -I tools/catalog/tag.py apply
python3 -I tools/catalog/tag.py check
python3 -I tools/catalog/test_tag.py
```

`fetch` writes `tag-signals.json`, what Wikipedia, Wikidata, The Session and `PDMX.csv` say about each Song, at one request a second, about 2,400 the first time (about 45 minutes). It caches every answer in `~/.cache/pedos/tags/`, beside PDMX's, so it outlives a worktree and a second run asks nothing. `apply` needs no network: it tags every Song from `tag-signals.json`, the composer batches and `tag-hand.json`, writes the four fields and `tags.report.md`, which gives each tag's source. `check` fails when a Song has no kind or one outside the seven, its fields aren't `apply`'s, its signals were fetched with another `composer` or `composer_source` than it has now (each Song's signals record both), or a composer batch record's `kind` or `origin` isn't the Song's tag. It reads only files, so CI never fetches.

- **The tune's page** is the composer lookup's `composer_source` when it's a Wikipedia article and not the composer's own (another language's article is swapped for its English one through Wikidata). When that page has none of the Song's names ("Notebook for Anna Magdalena Bach"), the English article with the Song's title takes its place if it's about a tune. With no cited article, it's the English article with the Song's title, kept only when its categories call it a song or tune and not a book, film, opera, day, building, whole genre ("Barcarolle"), person, or a song from 1930 on (another song with the old name). Its pageviews count only when the page is the tune's own: it has a song or tune category (a cited "Calvary" is the hill), no redirect led to a section of a longer page ("Sea shanty"), and its title is one of the Song's names, or close to one (spelled another way, "Whiskey in the Jar", or with words around a name of two words or more, "Clarinet Concerto (Mozart)", but not a set it's one of, "Gnossiennes"), or the Song's title leads to it, or it was found by the title.
- **Kind**: each signal gives a kind points once, its best: the page's categories, the page's Wikidata genre, The Session's tune type for the tune the lookup cites (2), PDMX's bulk list (Misc Christmas, Misc Children, Misc Praise Songs: 2), a word in the title (1), and the composer's categories (1: fiddlers, pipers, harpers and traditional-music composers are Fiddle tunes, not Classical). A category counts for the first rule in `CATEGORY_KINDS` it matches, and a rule gives 1 to 3 points by how sure it is: "Christmas carols" 2, "Christmas onstage" 1; "nursery rhymes" 2, "children's songs" 1 (folk songs are sung by children too); "marches" 3, so a year's compositions doesn't make Sousa Classical; "patriotic songs" 1; state songs and Civil War songs aren't anthems. A national anthem settles Anthems, and then a carol category settles Christmas. The most points win; a tie goes to the more specific kind (`TIE_ORDER`). With no points, a **fallback**: Fiddle tunes for a Song in PDMX's Misc tunes or Misc Traditional, Songs for another traditional tune, Fiddle tunes for an Unknown composer, Classical for a named one.
- **Origin**, the first that answers: the composer batch's `Traditional (<tradition>)` (the Song's `composer`), the tune's Wikidata country of origin, the tune's categories ("Irish folk songs", not "English-language songs" or "Songs about Scotland"), the composer's categories ("Scottish fiddlers"), the composer's Wikidata citizenship. Categories must agree: a tune that's American, English and Irish folk song alike has no origin from them, and a composer who's an Austrian composer as often as a German one takes the citizenship that's one of the two. `COUNTRIES` maps old states to today's demonyms.
- **Hand-set values** win over everything, and nothing else does: `tag-hand.json` holds, by Song id, the `kind`, `origin` or `well_known` to set, `source`, the page that supports it (needed for an `origin`, optional otherwise; the report prints it), `found_by` (the review that found it: `known miss`, `fallback kind`, `signals disagree`, `near miss` for a Song left out with one signal close to the bar, or `hand check` for one found by reading the tags, such as the 30-Song check) and `why`, one line. A composer batch record's `kind` and `origin` are only `guess`'s starting point and never count. Review the Songs whose kind is a fallback and the Well known Songs whose signals disagree (`tags.report.md` counts them) whenever `fetch` adds Songs.
