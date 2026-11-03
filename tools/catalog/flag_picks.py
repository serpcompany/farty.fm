"""List the picks to read after each import: the batch's passing picks whose own PDMX genres, tags or
artist look modern, or whose title or part names mark one voice or a variant, and its Songs whose
melody is the same tune as another Song's.

    tools/melody-lab/.venv/bin/python -I tools/catalog/flag_picks.py --titles tools/catalog/titles-05.txt

Without --titles it checks every Song in the catalog.

The ranking leaves out titles most of whose scores are tagged with a modern genre, but the importer
may still pick a title's one modern arrangement: Misirlou's pick was Dick Dale's (genre rock), and
Lavender's Blue's was from Disney's Cinderella (genre soundtrack, artist "Misc Soundtrack"). So this
flags every Song the batch put in the catalog whose picked score has a MODERN_GENRES genre, a
MODERN_TAGS tag, or a MODERN_ARTISTS artist.

It also flags a pick whose title, subtitle or MIDI track names say it's one voice of a harmony or one of
several versions (PART_WORDS): My Faith Looks Up To Thee's pick was "My Faith Looks Up To Thee: Tenor",
and On Christmas Night's was "On Christmas Night - Version 4", another tune.

And it flags a Song whose melody opens with the same OPENING_STEPS changes of pitch as another Song's,
in any key: the same tune under another name, as Kings Of Orient was We Three Kings.

A flag is a prompt to check the pick, not a verdict: exclude the title (excluded-titles.txt) only when
the pick is under copyright, isn't the tune, or is the same tune as a Song already in the catalog.

Run it with python -I: the dataset is untrusted input.
"""
import argparse
import collections
import itertools
import json
import re
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

# Whole words in a score's title, subtitle or part names that mark one voice of a harmony, or one of
# several versions, rather than the tune: "Tenor", "Alto Line", "Version 4".
PART_WORDS = re.compile(r"\b(?:tenor|alto|bass|soprano|descant|harmony|version\s*\d+)\b", re.IGNORECASE)

# Changes of pitch (repeated notes don't count) two melodies must open with alike, in any key, to be
# flagged as the same tune. Over the catalog of #324, 10 flags only Songs that are one tune (We Three
# Kings and Kings Of Orient, Sheebeg and Sheemore, Johnny I Hardly Knew Ye, Stingo and Cold and Raw,
# Lightly Row and Hänschen klein, and the two Ode to Joy); 9 also flags Brian Boru's March and Princess
# Royal, which aren't.
OPENING_STEPS = 10


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


def part_signs(row, part_names=()):
    """What about a pick marks it as one voice or a variant: ["title tenor", "part alto"], or []. A part
    name counts only when it's the score's one part: a score of Soprano and Alto holds the tune too."""
    parts = [("part", n) for n in part_names] if len(part_names) == 1 else []
    fields = [("title", row.get("title")), ("subtitle", row.get("subtitle"))] + parts
    signs = []
    for field, text in fields:
        for word in PART_WORDS.findall(text or ""):
            sign = f"{field} {' '.join(word.lower().split())}"
            if sign not in signs:
                signs.append(sign)
    return signs


def part_names(path):
    """The track names a MIDI file gives its parts."""
    import mido
    return [m.name for t in mido.MidiFile(path).tracks for m in t if m.type == "track_name" and m.name.strip()]


def batch_picks(catalog, titles_file):
    """The batch's catalog entries (titles_file is repo-relative; None for every entry from MuseScore) by
    their MuseScore score id."""
    return {e["source"]["musescore_score_id"]: e for e in catalog
            if (titles_file is None or pdmx.batch_of(e) == titles_file) and "musescore_score_id" in e["source"]}


def flag(picks, rows, parts=None):
    """[(entry, row, signs)] for each pick whose row looks modern, or marks one voice or a variant, in
    catalog order. parts: score id -> the pick's part names."""
    parts = parts or {}
    found = {}
    for row in rows:
        sid = pdmx.score_id(row)
        if sid in picks:
            signs = modern_signs(row) + part_signs(row, parts.get(sid, ()))
            if signs:
                found[sid] = (picks[sid], row, signs)
    return [found[sid] for sid in picks if sid in found]


def opening(pitches, steps=OPENING_STEPS):
    """A melody's first `steps` changes of pitch in semitones, repeated notes dropped, or None if it has fewer."""
    changes = [b - a for a, b in zip(pitches, pitches[1:]) if b != a]
    return tuple(changes[:steps]) if len(changes) >= steps else None


def same_tunes(melodies, ids, steps=OPENING_STEPS):
    """[(song id, song id)] pairs of Songs that open alike, at least one of them in `ids`, in catalog order.
    melodies: song id -> its pitches, in catalog order."""
    by_opening = collections.defaultdict(list)
    for sid, pitches in melodies.items():
        key = opening(pitches, steps)
        if key:
            by_opening[key].append(sid)
    return [(a, b) for group in by_opening.values() for a, b in itertools.combinations(group, 2)
            if a in ids or b in ids]


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--titles", type=Path, help="the titles file the batch was imported from (default: every Song)")
    parser.add_argument("--cache", type=Path, default=Path.home() / ".cache/pedos/pdmx")
    args = parser.parse_args()

    from melody import load_catalog  # noqa: E402  import_pdmx put tools/melody-lab on the path

    titles_file = import_pdmx.rel(args.titles.resolve()) if args.titles else None
    what = titles_file or "the catalog"
    catalog = json.loads(import_pdmx.CATALOG.read_text())
    picks = batch_picks(catalog, titles_file)
    parts = {sid: part_names(import_pdmx.CATALOG.parent / e["file"]) for sid, e in picks.items()}
    dataset = import_pdmx.fetch_dataset(args.cache)
    flagged = flag(picks, import_pdmx.read_rows(dataset["PDMX.csv"]["path"]), parts)
    for entry, row, signs in flagged:
        print(f"{entry['id']} | {entry['title']} | {entry['source']['musescore_url']} | {row['title']!r} by "
              f"{row['artist_name']!r} | {', '.join(signs)}")
    print(f"{len(flagged)} of {len(picks)} passing picks of {what} look modern, or one voice or a variant")

    melodies = {e["id"]: [n.pitch for n in sorted(m.notes, key=lambda n: (n.start, -n.pitch))]
                for e, m in load_catalog(import_pdmx.CATALOG)}
    pairs = same_tunes(melodies, {e["id"] for e in catalog if titles_file is None or pdmx.batch_of(e) == titles_file})
    for a, b in pairs:
        print(f"same tune: {a} | {b}")
    print(f"{len(pairs)} pairs of Songs, one of them from {what}, open with the same {OPENING_STEPS} changes of pitch")


if __name__ == "__main__":
    main()
