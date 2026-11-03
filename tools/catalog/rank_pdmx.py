import argparse
import collections
import json
import re
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path

import pdmx
from catalog_writer import DOI
from dataset import fetch_dataset, read_rows
from import_pdmx import CATALOG, rel
from report import table_row

HERE = Path(__file__).resolve().parent
RANKING = HERE / "ranking.md"
EXCLUDED = HERE / "excluded-titles.txt"
TOOL = "tools/catalog/rank_pdmx.py"
DESCRIPTION = "Rank PDMX's tune titles by how popular their scores are, so each import batch takes the next best-known tunes."
DEFAULT_LIMIT = 1500
MIN_SCORES = 2
MODERN_GENRES = frozenset({"pop", "rock", "soundtrack", "electronic", "rbfunksoul", "hiphop", "metal", "country",
                           "newage", "comedy", "disco", "reggaeska", "darkwave", "experimental"})
GENERIC_ARTISTS = ("anonymous", "unknown", "traditional", "trad")


@dataclass
class Tune:
    key: str
    scores: int = 0
    pickable: int = 0
    views: int = 0
    ratings: int = 0
    rated: float = 0.0
    offered: int = 0
    named: int = 0
    tagged: int = 0
    modern: int = 0
    spellings: collections.Counter = field(default_factory=collections.Counter)
    artists: collections.Counter = field(default_factory=collections.Counter)
    songs: collections.Counter = field(default_factory=collections.Counter)

    @property
    def rating(self):
        return self.rated / self.ratings if self.ratings else 0.0


def _number(text):
    return float(text or 0)


def tally(rows):
    tunes = {}
    for row in rows:
        if pdmx.license_problems(row):
            continue
        keys = dict(pdmx.row_keys(row))
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
    return {pdmx.match_key(e["title"]) for e in catalog} | {n for titles in titles_files for t in titles for n in t.names}


def without_batch(catalog, titles_file):
    return [e for e in catalog if pdmx.batch_of(e) != titles_file]


def read_excluded(text):
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


def names_nobody(name):
    key = pdmx.normalize(name)
    return key.split(" ")[0] == "misc" or key in GENERIC_ARTISTS or key.endswith("folk song")


def named_artists(tune):
    return collections.Counter({a: n for a, n in tune.artists.items() if not names_nobody(a)})


def artist(tune):
    top = named_artists(tune).most_common(1) or tune.artists.most_common(1)
    return top[0][0] if top else ""


def left_out(tune, known, excluded):
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
    words = key.split()
    return {" ".join(w) for i in range(1, len(words)) for w in (words[:i], words[i:]) if len(w) >= 2}


def song_of(tune):
    top = tune.songs.most_common(1)
    return top[0][0] if top and top[0][1] * 2 >= tune.scores else None


def rank(tunes, known, excluded):
    names = set()
    parts = set()

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


def decodes_again(text):
    if any("\x80" <= c <= "\x9f" for c in text):
        return True
    for codec in ("latin-1", "cp1252"):
        try:
            if text.encode(codec).decode("utf-8") != text:
                return True
        except UnicodeError:
            pass
    return False


def garbled(text):
    if decodes_again(text):
        return True
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


def _clean(text):
    text = unicodedata.normalize("NFC", text).replace("#", "♯").replace("|", "/").replace(";", ",")
    return text.strip(" -–—:/").rstrip(". ")


def _base(c):
    return unicodedata.normalize("NFD", c)[0]


def _with_accents(text, accented):
    same = [o for o in accented if len(o) == len(text)
            and all(_base(a).lower() == _base(b).lower() for a, b in zip(text, o, strict=True))]

    def letter(a, column):
        ways = {b.lower() for b in column}
        if _base(a) == a and len(ways) == 1 and _base(b := ways.pop()) != b:
            return b.upper() if a.isupper() else b
        return a

    return "".join(letter(a, column) for a, column in zip(text, zip(*same, strict=True), strict=True)) if same else text


def upper_share(text):
    letters = [c for c in text if c.isalpha()]
    return sum(c.isupper() for c in letters) / len(letters) if letters else 0


def one_case(text):
    return text == text.lower() or upper_share(text) > 0.5


def display_title(tune):
    def order(item):
        text, n = item
        return (one_case(text) or text[:1].islower(), -n, text)

    readable = [text for text, _ in sorted(tune.spellings.items(), key=order) if not garbled(text)]
    accented = [_clean(t) for t in readable if any(_base(c) != c for c in _clean(t) if c.isalpha())]
    for text in readable:
        text = _clean(text)
        if one_case(text):
            text = " ".join(w[:1].upper() + w[1:] for w in text.lower().split())
        text = _with_accents(text[:1].upper() + text[1:], accented)
        if pdmx.match_key(text) == tune.key:
            return text
    return None


def song_id(key, taken):
    base = key.replace(" ", "-")
    sid, n = base, 1
    while sid in taken:
        n += 1
        sid = f"{base}-{n}"
    return sid


def titles_lines(tunes, taken):
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
        f"- Dataset: PDMX, doi:{DOI}. `PDMX.csv` md5 `{run['md5']}`, equal to Zenodo's.",
        "- A title's scores are the ones `import_pdmx.py` would match for a Song of that name, of those its",
        "  license gate accepts. Ranked by their views in all, then ratings in all, then mean rating. Artist:",
        "  the artist MuseScore gives the scores most often, preferring one that names somebody over",
        "  \"Misc tunes\" or \"Anonymous\", to judge whether the tune is under copyright.",
        f"- {total} titles; {len(ranked)} may be tried next, and the top {min(run['limit'], len(ranked))} are listed. Left out:",
        *[f"  - {n}: {reason}" for reason, n in sorted(why.items(), key=lambda kv: -kv[1])],
        "",
        table_row("Rank", "Title", "Artist", "Scores", "Can be picked", "Views", "Ratings", "Rating"),
        table_row(*["---"] * 8),
    ]
    for i, t in enumerate(ranked[: run["limit"]], 1):
        lines.append(table_row(i, display_title(t), artist(t), t.scores, t.pickable, t.views, t.ratings,
                               f"{t.rating:.2f}"))
    return "\n".join(lines) + "\n"


def batch_header(batch, out):
    return [
        f"# The top {batch} tune titles of tools/catalog/ranking.md, not yet in the catalog or tried, written by",
        f"# {TOOL} --batch {batch} --out {rel(out)} (#312). Each title's only name is",
        "# the one the ranking counted scores by.",
        "# id | catalog title",
    ]


def parse_args():
    parser = argparse.ArgumentParser(description=DESCRIPTION)
    parser.add_argument("--cache", type=Path, default=Path.home() / ".cache/pedos/pdmx")
    parser.add_argument("--limit", type=int, default=DEFAULT_LIMIT, help="titles to list in ranking.md")
    parser.add_argument("--batch", type=int, help="also write the top N titles as a titles file (--out)")
    parser.add_argument("--out", type=Path, help="the titles file --batch writes")
    args = parser.parse_args()
    if bool(args.batch) != bool(args.out):
        parser.error("--batch and --out go together")
    return args


def main():
    args = parse_args()
    out = args.out.resolve() if args.out else None
    tried = [f for f in sorted(HERE.glob("titles-*.txt")) if f.resolve() != out]
    tried_titles = [pdmx.read_titles(f.read_text(encoding="utf-8")) for f in tried]
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    if out:
        catalog = without_batch(catalog, rel(out))
    known = known_names(catalog, tried_titles)
    excluded = read_excluded(EXCLUDED.read_text(encoding="utf-8"))
    dataset = fetch_dataset(args.cache)
    ranked, why = rank(tally(read_rows(dataset["PDMX.csv"]["path"])), known, excluded)

    limit = f" --limit {args.limit}" if args.limit != DEFAULT_LIMIT else ""
    run = {"command": f"uv run --project tools python -I {TOOL}{limit}", "md5": dataset["PDMX.csv"]["md5"],
           "limit": args.limit}
    RANKING.write_text(ranking_text(ranked, why, run), encoding="utf-8", newline="\n")
    print(f"{len(ranked)} titles may be tried next; ranking: {rel(RANKING)}")
    if args.batch:
        taken = {e["id"] for e in catalog} | {t.id for titles in tried_titles for t in titles}
        lines = batch_header(args.batch, out) + titles_lines(ranked[: args.batch], taken)
        out.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")
        print(f"wrote {min(args.batch, len(ranked))} titles to {rel(out)}")


if __name__ == "__main__":
    main()
