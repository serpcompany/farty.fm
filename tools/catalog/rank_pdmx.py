"""Rank PDMX's tune titles by how popular their scores are, so each import batch takes the next best-known tunes.

    tools/melody-lab/.venv/bin/python -I tools/catalog/rank_pdmx.py
    tools/melody-lab/.venv/bin/python -I tools/catalog/rank_pdmx.py --batch 150 --out tools/catalog/titles-05.txt

A tune title is what scores are called: a score's title, or the head of an arrangement's title
("Maple Leaf Rag - Piano"). Its scores are exactly the ones the importer would match for a Song of that
name (pdmx.row_keys: by title, title head or MuseScore song name), so arrangements of one tune count
under one title. It is ranked by the scores the license gate accepts (public domain or CC0, no PDMX
license conflict): their views in all, then their ratings in all, then their mean rating.

Left out of the ranking, counted in its header:
  - titles in catalog/catalog.json or any titles file, by title or alias: tried already, and a title
    that failed stays failed
  - titles in excluded-titles.txt: under copyright as a composition, or not a tune
  - titles none of whose scores the importer can pick (pdmx.pick_problems)
  - titles with fewer than MIN_SCORES scores: one upload is someone's arrangement, not a tune many play
  - titles fewer than half of whose scores carry them as their whole title or song name, as in
    "Mozart - Waltz": a composer or a collection, not a tune
  - titles none of whose scores has a MuseScore genre: mostly recent game, anime and film music
  - titles more than half of whose genre-tagged scores are tagged pop, rock, soundtrack or another
    MODERN_GENRES genre: likely under copyright
  - titles whose scores' MuseScore artists, leaving out ones that name nobody ("Misc tunes",
    "Anonymous"), have no one artist for more than half of them: several pieces share the title
  - titles every spelling of which is garbled (UTF-8 read as Latin-1)
  - the same tune as a better-ranked or tried title (rank): a name that begins or ends with the
    other's, or with its MuseScore song, in 2 words or more ("Fur Elise Beethoven"), or at least half
    of both titles' scores linked to one MuseScore song ("Inno alla Gioia" and Ode to Joy)

Writes tools/catalog/ranking.md, the top --limit titles. --batch N --out FILE also writes the top N as a
titles file for import_pdmx.py; neither that file nor the Songs imported from it count as tried,
so running it again rewrites the same batch.

Run it with python -I: the dataset is untrusted input.
"""
import argparse
import collections
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE)]

import import_pdmx  # noqa: E402
import pdmx  # noqa: E402

RANKING = HERE / "ranking.md"
EXCLUDED = HERE / "excluded-titles.txt"
TOOL = "tools/catalog/rank_pdmx.py"
MIN_SCORES = 2
# MuseScore genres of songs written recently enough to be under copyright. classical, folk,
# religiousmusic, worldmusic, jazz and blues hold old tunes too, so they don't count.
MODERN_GENRES = frozenset({"pop", "rock", "soundtrack", "electronic", "rbfunksoul", "hiphop", "metal", "country",
                           "newage", "comedy", "disco", "reggaeska", "darkwave", "experimental"})


@dataclass
class Tune:
    """A tune title and the PDMX scores the license gate accepts among those it matches."""

    key: str  # pdmx.match_key of the title
    scores: int = 0
    pickable: int = 0  # scores the importer can pick (pdmx.pick_problems)
    views: int = 0
    ratings: int = 0
    rated: float = 0.0  # the sum of rating x n_ratings
    offered: int = 0  # scores called by the key: their title, or their title's head
    named: int = 0  # scores whose whole title or song name is the key
    tagged: int = 0  # scores with a MuseScore genre
    modern: int = 0  # scores with a MODERN_GENRES genre
    spellings: collections.Counter = field(default_factory=collections.Counter)  # the title as scores write it
    artists: collections.Counter = field(default_factory=collections.Counter)  # MuseScore's artist of the song
    songs: collections.Counter = field(default_factory=collections.Counter)  # MuseScore's song, by match_key

    @property
    def rating(self):
        """The mean rating, weighted by each score's number of ratings."""
        return self.rated / self.ratings if self.ratings else 0.0


def _number(text):
    return float(text or 0)


def tally(rows):
    """Every name the rows match by (pdmx.row_keys) -> its Tune, over the rows the license gate
    accepts. Only names some row is called by (its title, or its title's head) are kept."""
    tunes = {}
    for row in rows:
        if pdmx.license_problems(row):
            continue
        keys = dict(pdmx.row_keys(row))  # match -> key
        title, head, song = keys.get("title"), keys.get("title head"), keys.get("song name")
        sep = pdmx._SEPARATOR.search(row["title"])
        written = {title: row["title"], head: row["title"][: sep.start()] if sep else None}
        pickable = not pdmx.pick_problems(row)
        n_ratings = int(_number(row["n_ratings"]))
        genres = {g for g in row.get("genres", "").split("-") if g and g != "NA"}
        for key in dict.fromkeys(keys.values()):
            t = tunes.setdefault(key, Tune(key))
            t.scores += 1
            t.pickable += pickable
            t.views += int(_number(row["n_views"]))
            t.ratings += n_ratings
            t.rated += _number(row["rating"]) * n_ratings
            t.tagged += bool(genres)
            t.modern += bool(genres & MODERN_GENRES)
            t.named += key in (title, song)
            t.offered += key == (head or title)
            if written.get(key):
                t.spellings[" ".join(written[key].split())] += 1
            if row.get("artist_name") not in (None, "", "NA"):
                t.artists[row["artist_name"].strip()] += 1
            if song:
                t.songs[song] += 1
    return {k: t for k, t in tunes.items() if t.offered}


def known_names(catalog, titles_files):
    """The names of every Song in the catalog and every title tried in a titles file, with their aliases."""
    return {pdmx.match_key(e["title"]) for e in catalog} | {n for titles in titles_files for t in titles for n in t.names}


def without_batch(catalog, titles_file):
    """The catalog without the Songs imported from titles_file (a repo-relative path), so a batch
    written again can take its own titles again."""
    return [e for e in catalog if pdmx.batch_of(e) != titles_file]


def read_excluded(text):
    """excluded-titles.txt: one `Title | why` a line, `#` starts a comment -> {match_key: why}."""
    out = {}
    for n, raw in enumerate(text.splitlines(), 1):
        line = raw.split("#", 1)[0].strip()
        if not line:
            continue
        title, sep, why = (p.strip() for p in line.partition("|"))
        if not (sep and title and why):
            raise ValueError(f"line {n}: expected 'Title | why'")
        out[pdmx.match_key(title)] = why
    return out


def named_artists(tune):
    """The Tune's MuseScore artists that name somebody: not "Misc tunes", "Misc Traditional",
    "Anonymous" or "Germany Folk Song". artist -> scores."""
    def generic(name):
        key = pdmx.normalize(name)
        return key.split(" ")[0] == "misc" or key in ("anonymous", "unknown", "traditional", "trad") or key.endswith(
            "folk song")
    return collections.Counter({a: n for a, n in tune.artists.items() if not generic(a)})


def artist(tune):
    """The artist MuseScore gives the Tune's scores most often, preferring one that names somebody."""
    top = named_artists(tune).most_common(1) or tune.artists.most_common(1)
    return top[0][0] if top else ""


def left_out(tune, known, excluded):
    """Why a Tune isn't ranked, before it's compared with better-ranked titles, or None."""
    if tune.key in known:
        return "in the catalog or tried already"
    if tune.key in excluded:
        return "in excluded-titles.txt"
    if not tune.pickable:
        return "no score the importer can pick"
    if tune.scores < MIN_SCORES:
        return f"fewer than {MIN_SCORES} scores"
    if tune.named * 2 < tune.scores:
        return "mostly a title head: a composer or collection"
    if not tune.tagged:
        return "no score has a MuseScore genre: mostly recent game, anime and film music"
    if tune.modern * 2 > tune.tagged:
        return "mostly a modern genre: likely under copyright"
    artists = named_artists(tune)
    if artists and artists.most_common(1)[0][1] * 2 <= sum(artists.values()):
        return "no one artist for most of its scores: several pieces share the title"
    if display_title(tune) is None:
        return "every spelling of the title is garbled"
    return None


def _parts(key):
    """The key's beginnings and endings of 2 words or more, as in "fur elise" of "fur elise beethoven"."""
    words = key.split()
    return {" ".join(w) for i in range(1, len(words)) for w in (words[:i], words[i:]) if len(w) >= 2}


def song_of(tune):
    """The MuseScore song at least half of a Tune's scores are linked to, or None."""
    top = tune.songs.most_common(1)
    return top[0][0] if top and top[0][1] * 2 >= tune.scores else None


def rank(tunes, known, excluded):
    """The Tunes that may be tried next, best first, and why the others were left out: why -> count.

    A Tune is the same tune as a better-ranked or tried title when its name begins or ends with that
    title's name or MuseScore song, or that name begins or ends with the Tune's, in 2 words or more
    ("Fur Elise Beethoven", "Tico Tico" and "Tico Tico no Fuba"); or when at least half of both
    titles' scores are linked to one MuseScore song ("Inno alla Gioia" and Ode to Joy)."""
    names = set()  # the names and MuseScore songs of the tried and better-ranked titles
    parts = set()  # their beginnings and endings of 2 words or more

    def add(*keys):
        for k in keys:
            if k:
                names.add(k)
                parts.update(_parts(k))

    for k in known:
        add(k, song_of(tunes[k]) if k in tunes else None)
    why = collections.Counter()
    kept = []
    for t in sorted(tunes.values(), key=lambda t: (-t.views, -t.ratings, -t.rating, t.key)):
        reason = left_out(t, known, excluded)
        if reason is None and (t.key in parts or _parts(t.key) & names or song_of(t) in names):
            reason = "the same tune as a better-ranked or tried title"
        if reason:
            why[reason] += 1
        else:
            kept.append(t)
            add(t.key, song_of(t))
    return kept, why


def garbled(text):
    """Whether text is UTF-8 read as Latin-1 or Windows-1252, as some PDMX titles are: "SÃ¤kkijÃ¤rven",
    or with the second byte lost, "Marko skaÄe" and "WÅród". Such a title has a control character,
    decodes again as UTF-8, has a capital Latin-1 letter after a small letter (or between a capital
    and a small one) or before another Latin-1 letter, a Latin-1 letter before a Latin-1 sign ("Å¼"),
    three Latin-1 letters in a row, or a word of only Latin-1 letters ("Åç")."""
    if any("\x80" <= c <= "\x9f" for c in text):
        return True
    for codec in ("latin-1", "cp1252"):
        try:
            if text.encode(codec).decode("utf-8") != text:
                return True
        except UnicodeError:
            pass
    for i, c in enumerate(text):
        before, after = text[i - 1 : i], text[i + 1 : i + 2]
        if "À" <= c <= "Þ" and c != "×" and (before.islower() or before.isupper() and after.islower()):
            return True
        if "À" <= c <= "ÿ" and "\xa1" <= after <= "\xbf":
            return True
        if "À" <= c <= "Þ" and "À" <= after <= "ÿ":
            return True
        if all("À" <= x <= "ÿ" for x in text[i : i + 3]) and len(text[i : i + 3]) == 3:
            return True
    return any(len(w) > 1 and all("À" <= c <= "ÿ" for c in w) for w in re.findall(r"[^\W\d_]+", text))


def display_title(tune):
    """The title as its scores most often write it, still matching the tune's key: not garbled,
    preferring one in title or sentence case (starting with a capital), with nothing a titles file reads as a comment or a
    separator. None when every spelling is garbled."""
    def upper_share(text):
        letters = [c for c in text if c.isalpha()]
        return sum(c.isupper() for c in letters) / len(letters) if letters else 0

    def order(item):
        text, n = item
        return (text == text.lower() or upper_share(text) > 0.5 or text[:1].islower(), -n, text)

    for text, _ in sorted(tune.spellings.items(), key=order):
        if garbled(text):
            continue
        text = text.replace("#", "♯").replace("|", "/").replace(";", ",").strip(" -–—:/")
        if text == text.lower() or upper_share(text) > 0.5:
            text = " ".join(w[:1].upper() + w[1:] for w in text.lower().split())
        text = text[:1].upper() + text[1:]
        if pdmx.match_key(text) == tune.key:
            return text
    return None


def song_id(key, taken):
    """A catalog id from the key, not one of `taken`."""
    base = key.replace(" ", "-")
    sid, n = base, 1
    while sid in taken:
        n += 1
        sid = f"{base}-{n}"
    return sid


def titles_lines(tunes, taken):
    """`id | Title` lines for a titles file. Each Title's only name is its key, so the importer
    matches exactly the scores the ranking counted."""
    lines, taken = [], set(taken)
    for t in tunes:
        sid = song_id(t.key, taken)
        taken.add(sid)
        lines.append(f"{sid} | {display_title(t)}")
    return lines


def ranking_text(ranked, why, run):
    total = len(ranked) + sum(why.values())
    lines = [
        "# PDMX tune titles, most popular first",
        "",
        f"Generated by `{TOOL}`; don't edit by hand. Command:",
        "",
        "```sh",
        run["command"],
        "```",
        "",
        f"- Dataset: PDMX, doi:{import_pdmx.DOI}. `PDMX.csv` md5 `{run['md5']}`, equal to Zenodo's.",
        "- A title's scores are the ones `import_pdmx.py` would match for a Song of that name, of those its",
        "  license gate accepts. Ranked by their views in all, then ratings in all, then mean rating. Artist:",
        "  the artist MuseScore gives the scores most often, preferring one that names somebody over",
        "  \"Misc tunes\" or \"Anonymous\", to judge whether the tune is under copyright.",
        f"- {total} titles; {len(ranked)} may be tried next, and the top {min(run['limit'], len(ranked))} are listed. Left out:",
        *[f"  - {n}: {reason}" for reason, n in sorted(why.items(), key=lambda kv: -kv[1])],
        "",
        import_pdmx.table_row("Rank", "Title", "Artist", "Scores", "Can be picked", "Views", "Ratings", "Rating"),
        import_pdmx.table_row(*["---"] * 8),
    ]
    for i, t in enumerate(ranked[: run["limit"]], 1):
        lines.append(import_pdmx.table_row(i, display_title(t), artist(t), t.scores, t.pickable, t.views, t.ratings,
                                           f"{t.rating:.2f}"))
    return "\n".join(lines) + "\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--cache", type=Path, default=Path.home() / ".cache/pedos/pdmx")
    parser.add_argument("--limit", type=int, default=1500, help="titles to list in ranking.md")
    parser.add_argument("--batch", type=int, help="also write the top N titles as a titles file (--out)")
    parser.add_argument("--out", type=Path, help="the titles file --batch writes")
    args = parser.parse_args()
    if bool(args.batch) != bool(args.out):
        parser.error("--batch and --out go together")

    out = args.out.resolve() if args.out else None
    tried = [f for f in sorted(HERE.glob("titles-*.txt")) if f.resolve() != out]
    tried_titles = [pdmx.read_titles(f.read_text()) for f in tried]
    catalog = json.loads(import_pdmx.CATALOG.read_text())
    if out:
        catalog = without_batch(catalog, import_pdmx.rel(out))
    known = known_names(catalog, tried_titles)
    excluded = read_excluded(EXCLUDED.read_text())
    dataset = import_pdmx.fetch_dataset(args.cache)
    ranked, why = rank(tally(import_pdmx.read_rows(dataset["PDMX.csv"]["path"])), known, excluded)

    command = f"tools/melody-lab/.venv/bin/python -I {TOOL}" + (f" --limit {args.limit}" if args.limit != 1500 else "")
    run = {"command": command, "md5": dataset["PDMX.csv"]["md5"], "limit": args.limit}
    RANKING.write_text(ranking_text(ranked, why, run))
    print(f"{len(ranked)} titles may be tried next; ranking: {import_pdmx.rel(RANKING)}")
    if args.batch:
        taken = {e["id"] for e in catalog} | {t.id for titles in tried_titles for t in titles}
        header = [
            f"# The top {args.batch} tune titles of tools/catalog/ranking.md, not yet in the catalog or tried, written by",
            f"# {TOOL} --batch {args.batch} --out {import_pdmx.rel(out)} (#312). Each title's only name is",
            "# the one the ranking counted scores by.",
            "# id | catalog title",
        ]
        out.write_text("\n".join(header + titles_lines(ranked[: args.batch], taken)) + "\n")
        print(f"wrote {min(args.batch, len(ranked))} titles to {import_pdmx.rel(out)}")


if __name__ == "__main__":
    main()
