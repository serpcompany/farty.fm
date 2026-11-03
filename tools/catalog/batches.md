# Ranking and checking a batch

How the next batch of titles is ranked from PDMX, how its picks are checked after the import, and what a batch changes. The commands are in the [README](README.md), and how a title's score is picked is in [Picking](picking.md).

## Ranking

From `titles-04.txt` on, a batch is the top of the ranking (#312):

```sh
uv run --project tools python -I tools/catalog/rank_pdmx.py --batch 150 --out tools/catalog/titles-05.txt
```

A tune title's scores are the ones the import would match for a Song of that name and its license gate accepts, so arrangements of one tune count under one title. Titles rank by those scores' views in all, then ratings in all, then mean rating (weighted by each score's number of ratings). Left out, and counted in `ranking.md`'s header:

- titles already in the catalog or in any titles file, by title or alias, so a title that failed stays failed;
- titles in `excluded-titles.txt`;
- titles none of whose scores the importer can pick (`pdmx.pick_problems`), and titles with fewer than 2 scores (`MIN_SCORES`: one upload is someone's arrangement, not a tune many play);
- composer or collection names: titles fewer than half of whose scores carry them as their whole title or song name, as in "Mozart - Waltz";
- titles none of whose scores has a MuseScore genre (mostly recent game, anime and film music), or more than half of whose genre-tagged scores have a modern one (`MODERN_GENRES`: pop, rock, soundtrack and the like; classical, folk, religious, world, jazz and blues hold old tunes too, so they don't count). PDMX takes a score's license from its uploader, and many recent songs are marked public domain;
- titles whose scores' MuseScore artists, leaving out the ones that name nobody ("Misc tunes", "Anonymous", "Germany Folk Song"), have no one artist for more than half of them: several pieces share the title;
- titles every spelling of which is garbled: UTF-8 read as Latin-1 or Windows-1252 ("SÃ¤kkijÃ¤rven"), or with the second byte lost ("Marko skaÄe", "WÅród"). Such a title has a control character, decodes again as UTF-8, has a capital Latin-1 letter after a small letter (or between a capital and a small one) or before another Latin-1 letter, a Latin-1 letter before a Latin-1 sign ("Å¼"), three Latin-1 letters in a row, or a word of only Latin-1 letters ("Åç");
- the same tune as a better-ranked or tried title: a name that begins or ends with the other's, or with its MuseScore song, in 2 words or more ("Fur Elise Beethoven", "Tico Tico" and "Tico Tico no Fuba"), or at least half of both titles' scores linked to one MuseScore song ("Inno alla Gioia" and Ode to Joy).

A title's Artist in `ranking.md` is the artist MuseScore gives its scores most often, preferring one that names somebody. Its written title is the spelling its scores use most, still matching its name, not garbled, preferring title or sentence case, with nothing a titles file reads as a comment or a separator and no trailing full stop; when other spellings write the same letters with accents, it takes the accents they all agree on ("Màiri Bhàn Òg", but "Funiculi Funicula" stays plain when "Fúnicúlí Fúnicúla" and "Funiculì Funiculà" disagree). Each title in a batch file has only the name the ranking counted scores by, so the import matches exactly those scores.

What's left still holds songs under copyright and titles that aren't one tune: read the top of `ranking.md` before each batch, add them to `excluded-titles.txt` with the reason, and run it again. Neither the batch file nor the Songs imported from it count as tried while `--out` names it, so it can be written again even after its import. After the import, check the picks these ways:

```sh
uv run --project tools python -I tools/catalog/flag_picks.py --titles tools/catalog/titles-05.txt
```

1. It lists each passing pick whose own MuseScore genre, a whole tag (`MODERN_TAGS`: "jsbach" isn't "game") or artist (`MODERN_ARTISTS`, ones that file a score under recent media rather than a composer) look modern. A title can pass the ranking's genre rule while the importer picks its one modern arrangement: Misirlou's pick was Dick Dale's (genre rock), and Lavender's Blue's was from Disney's Cinderella (genre soundtrack, artist "Misc Soundtrack"). Check each one listed.
2. It lists each passing pick whose title, subtitle or MIDI track names mark one voice or a variant (`PART_WORDS`, whole words: Tenor, Alto, Bass, Soprano, Descant, Harmony, "Version 4"). A part name counts only when it's the score's one part: a score of Soprano and Alto holds the tune too. My Faith Looks Up To Thee's pick was the hymn's tenor part, and On Christmas Night's was "Version 4", another tune. When the pick isn't the melody, add its score to `pdmx.NOT_THE_MELODY` so the importer tries the next one; when no score left is the melody, pull the title.
3. It lists each pair of Songs, one of them from the batch, whose melodies open with the same 10 changes of pitch in any key, repeated notes left out (`OPENING_STEPS`): the same tune under another name, as Kings Of Orient was We Three Kings. Over the catalog of #324, 10 flags only Songs that are one tune (We Three Kings and Kings Of Orient, Sheebeg and Sheemore, Johnny I Hardly Knew Ye, Stingo and Cold and Raw, Lightly Row and Hänschen klein, and the two Ode to Joy); 9 also flags Brian Boru's March and Princess Royal, which aren't. Pull the batch's title as the same tune. Without `--titles` it checks the whole catalog; after #344 that flags two pairs, both kept: `ode` and `ode-mutopia` (the hand-entered Mutopia score, kept to test the importer and left out of the app), and `caro-mio-ben` and `bartlett-house`, which part after 11 notes.
4. Compare each passing score's MuseScore artist and composer (`artist_name` and `composer_name` in `PDMX.csv`) with the title's Artist in `ranking.md`: a pick by someone else may be another piece of the same name, or under copyright.

A flag is a prompt to check the pick, not a verdict: exclude a title only when the pick is under copyright, isn't the tune, or is the same tune as a Song already in the catalog. Add the titles to pull to `excluded-titles.txt` with the reason, delete their lines from the batch file, note them in its header, and import it again, so the catalog and the report match the batch file. A Song's catalog title is its batch-file title: to correct one the ranking spelled wrong ("Amhr'an na bhFiann"), write the proper title and keep the ranking's as an alias (`id | Title | alias`) when it's compared differently, so the import matches the same scores. Then run `rank_pdmx.py` without `--out` to bring `ranking.md` up to date. Both read the dataset, so run them with `python -I` too.

## After a batch

Imported Songs are in the catalog, so the melody lab renders them (`run_all.py`, `build.py`), and the app ships every Song in the catalog but `ode-mutopia` (#350). To ship a batch, run `tools/melody-lab/export_golden.py`, which writes each Song's melody to `fixtures/golden/songs/`, then the app's generator (`apps/web/src/lib/catalog/generate.ts`); `catalog.test.ts` fails until both have run. Re-running a titles file replaces that batch's entries in their place, so the app's Songs keep their order; nothing else in the catalog changes. The importer has changed since the first batches, so re-running one may pick other scores: titles-01 would replace 8 shipped Songs' scores (#344). Compare the catalog before and after.
