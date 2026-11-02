"""List a batch's passing picks whose own PDMX genres, tags or artist look modern, to read after each import.

    tools/melody-lab/.venv/bin/python -I tools/catalog/flag_picks.py --titles tools/catalog/titles-05.txt

The ranking leaves out titles most of whose scores are tagged with a modern genre, but the importer
may still pick a title's one modern arrangement: Misirlou's pick was Dick Dale's (genre rock), and
Lavender's Blue's was from Disney's Cinderella (genre soundtrack, artist "Misc Soundtrack"). So this
flags every Song the batch put in the catalog whose picked score has a MODERN_GENRES genre, a
MODERN_TAGS tag, or a MODERN_ARTISTS artist. A flag is a prompt to check the pick, not a verdict:
exclude the title (excluded-titles.txt) only when the pick is under copyright or isn't the tune.

Run it with python -I: the dataset is untrusted input.
"""
import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE)]

import import_pdmx  # noqa: E402
import pdmx  # noqa: E402
from rank_pdmx import MODERN_GENRES  # noqa: E402

# MuseScore tags (lower case, no spaces, joined by "-" in PDMX.csv) that name recent film, TV, game or
# popular music. A whole tag must match: "jsbach" isn't "game".
MODERN_TAGS = frozenset({
    "soundtrack", "ost", "film", "films", "filmmusic", "movie", "movies", "tv", "television", "tvshow",
    "videogame", "videogames", "game", "games", "gaming", "anime", "cartoon", "cartoons", "disney", "pixar",
    "dreamworks", "marvel", "starwars", "nintendo", "pokemon", "undertale", "musical", "broadway", "pop", "kpop",
    "jpop", "rock", "metal", "punk", "edm", "techno", "dubstep", "hiphop", "rap", "fusion", "jazzfusion",
    "vocaloid", "meme",
})
# MuseScore artists that file a score under recent media rather than a composer.
MODERN_ARTISTS = frozenset({"misc computer games", "misc cartoons", "misc soundtrack", "misc television",
                            "misc unsigned bands", "misc mashups", "misc your songs"})


def _words(field):
    return {w for w in (field or "").split("-") if w and w != "NA"}


def modern_signs(row):
    """What about a PDMX row looks modern: ["genre rock", "tag disney", "artist Misc Soundtrack"], or []."""
    signs = [f"genre {g}" for g in sorted(_words(row.get("genres")) & MODERN_GENRES)]
    signs += [f"tag {t}" for t in sorted(_words(row.get("tags")) & MODERN_TAGS)]
    artist = (row.get("artist_name") or "").strip()
    if pdmx.normalize(artist) in MODERN_ARTISTS:
        signs.append(f"artist {artist}")
    return signs


def batch_picks(catalog, titles_file):
    """The batch's catalog entries (titles_file is repo-relative) by their MuseScore score id."""
    return {e["source"]["musescore_score_id"]: e for e in catalog if pdmx.batch_of(e) == titles_file}


def flag(picks, rows):
    """[(entry, row, signs)] for each pick whose row looks modern, in catalog order."""
    found = {}
    for row in rows:
        sid = pdmx.score_id(row)
        if sid in picks:
            signs = modern_signs(row)
            if signs:
                found[sid] = (picks[sid], row, signs)
    return [found[sid] for sid in picks if sid in found]


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--titles", type=Path, required=True, help="the titles file the batch was imported from")
    parser.add_argument("--cache", type=Path, default=Path.home() / ".cache/pedos/pdmx")
    args = parser.parse_args()

    titles_file = import_pdmx.rel(args.titles.resolve())
    picks = batch_picks(json.loads(import_pdmx.CATALOG.read_text()), titles_file)
    dataset = import_pdmx.fetch_dataset(args.cache)
    flagged = flag(picks, import_pdmx.read_rows(dataset["PDMX.csv"]["path"]))
    for entry, row, signs in flagged:
        print(f"{entry['id']} | {entry['title']} | {entry['source']['musescore_url']} | {row['title']!r} by "
              f"{row['artist_name']!r} | {', '.join(signs)}")
    print(f"{len(flagged)} of {len(picks)} passing picks of {titles_file} look modern")


if __name__ == "__main__":
    main()
