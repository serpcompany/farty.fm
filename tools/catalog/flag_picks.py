import argparse
import collections
import itertools
import json
import re
from pathlib import Path

import mido

import pdmx
from dataset import fetch_dataset, read_rows
from import_pdmx import CATALOG, rel
from melody import load_catalog
from rank_pdmx import MODERN_GENRES

DESCRIPTION = ("List the picks to read after each import: the batch's passing picks whose own PDMX genres, tags or"
               " artist look modern, or whose title or part names mark one voice or a variant, and its Songs whose"
               " melody is the same tune as another Song's.")
MODERN_TAGS = frozenset({
    "soundtrack", "ost", "film", "films", "filmmusic", "movie", "movies", "tv", "television", "tvshow",
    "videogame", "videogames", "game", "games", "gaming", "anime", "cartoon", "cartoons", "disney", "pixar",
    "dreamworks", "marvel", "starwars", "nintendo", "pokemon", "undertale", "musical", "broadway", "pop", "kpop",
    "jpop", "rock", "metal", "punk", "edm", "techno", "dubstep", "hiphop", "rap", "fusion", "jazzfusion",
    "vocaloid", "meme",
})
MODERN_ARTISTS = frozenset({"misc computer games", "misc cartoons", "misc soundtrack", "misc television",
                            "misc unsigned bands", "misc mashups", "misc your songs"})
PART_WORDS = re.compile(r"\b(?:tenor|alto|bass|soprano|descant|harmony|version\s*\d+)\b", re.IGNORECASE)
OPENING_STEPS = 10


def _words(field):
    return {w for w in (field or "").split("-") if w and w != "NA"}


def modern_signs(row):
    signs = [f"genre {g}" for g in sorted(_words(row.get("genres")) & MODERN_GENRES)]
    signs += [f"tag {t}" for t in sorted(_words(row.get("tags")) & MODERN_TAGS)]
    artist = (row.get("artist_name") or "").strip()
    if pdmx.normalize(artist) in MODERN_ARTISTS:
        signs.append(f"artist {artist}")
    return signs


def part_signs(row, part_names=()):
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
    return [m.name for t in mido.MidiFile(path).tracks for m in t if m.type == "track_name" and m.name.strip()]


def in_batch(entry, titles_file):
    return titles_file is None or pdmx.batch_of(entry) == titles_file


def batch_picks(catalog, titles_file):
    return {e["source"]["musescore_score_id"]: e for e in catalog
            if in_batch(e, titles_file) and "musescore_score_id" in e["source"]}


def flag(picks, rows, parts=None):
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
    changes = [b - a for a, b in itertools.pairwise(pitches) if b != a]
    return tuple(changes[:steps]) if len(changes) >= steps else None


def same_tunes(melodies, ids, steps=OPENING_STEPS):
    by_opening = collections.defaultdict(list)
    for sid, pitches in melodies.items():
        key = opening(pitches, steps)
        if key:
            by_opening[key].append(sid)
    return [(a, b) for group in by_opening.values() for a, b in itertools.combinations(group, 2)
            if a in ids or b in ids]


def print_flagged(picks, rows, what):
    parts = {sid: part_names(CATALOG.parent / e["file"]) for sid, e in picks.items()}
    flagged = flag(picks, rows, parts)
    for entry, row, signs in flagged:
        print(f"{entry['id']} | {entry['title']} | {entry['source']['musescore_url']} | {row['title']!r} by "
              f"{row['artist_name']!r} | {', '.join(signs)}")
    print(f"{len(flagged)} of {len(picks)} passing picks of {what} look modern, or one voice or a variant")


def print_same_tunes(catalog, titles_file, what):
    melodies = {e["id"]: [n.pitch for n in sorted(m.notes, key=lambda n: (n.start, -n.pitch))]
                for e, m in load_catalog(CATALOG)}
    pairs = same_tunes(melodies, {e["id"] for e in catalog if in_batch(e, titles_file)})
    for a, b in pairs:
        print(f"same tune: {a} | {b}")
    print(f"{len(pairs)} pairs of Songs, one of them from {what}, open with the same {OPENING_STEPS} changes of pitch")


def main():
    parser = argparse.ArgumentParser(description=DESCRIPTION)
    parser.add_argument("--titles", type=Path, help="the titles file the batch was imported from (default: every Song)")
    parser.add_argument("--cache", type=Path, default=Path.home() / ".cache/pedos/pdmx")
    args = parser.parse_args()
    titles_file = rel(args.titles.resolve()) if args.titles else None
    what = titles_file or "the catalog"
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    dataset = fetch_dataset(args.cache)
    print_flagged(batch_picks(catalog, titles_file), read_rows(dataset["PDMX.csv"]["path"]), what)
    print_same_tunes(catalog, titles_file, what)


if __name__ == "__main__":
    main()
