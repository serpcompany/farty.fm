"""Every Song's composer (#357): PDMX's composer names in one spelling each, and the batches of
lookups that give each Song in catalog/catalog.json its composer, the year the last of them died,
and the page that says so.

    tools/melody-lab/.venv/bin/python -I tools/catalog/composers.py check --batch tools/catalog/composers-02.json
    tools/melody-lab/.venv/bin/python -I tools/catalog/composers.py report --batch tools/catalog/composers-02.json
    tools/melody-lab/.venv/bin/python -I tools/catalog/composers.py apply --batch tools/catalog/composers-02.json
    tools/melody-lab/.venv/bin/python -I tools/catalog/composers.py check
    tools/melody-lab/.venv/bin/python -I tools/catalog/composers.py plan

`check --batch` lists what's wrong with one batch's lookups, and never reads whether they're in the
catalog yet. `report` writes the batch's report. `apply` writes a batch's lookups into the catalog,
where each Song gets `composer`, `composer_died` and `composer_source` after its title, and writes
the report too. `check` lists what's wrong with every batch and with every batch's place in the
catalog. `plan` puts the catalog's Songs that are in no batch yet into new batch files, most viewed
on MuseScore first (PDMX's `n_views`). tools/catalog/README.md has the lookup procedure.
"""
import argparse
import csv
import json
import re
import sys
import urllib.parse
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path[:0] = [str(HERE)]

import pdmx  # noqa: E402

CATALOG = ROOT / "catalog/catalog.json"
BATCH_FILE = re.compile(r"composers-(\d+)\.json")
TOOL = "tools/catalog/composers.py"

UNKNOWN = "Unknown"
# "Traditional", or "Traditional (Irish)": a folk tune, named for its tradition.
TRADITIONAL = re.compile(r"Traditional(?: \([A-Z][a-z]+(?: [A-Z][a-z]+)*\))?")
# A person's name: letters, spaces and . ' - , only.
NAME = re.compile(r"[^\W\d_][^\W\d_.'’ ,-]*(?:[.'’ ,-]+[^\W\d_]+)*\.?")
# A Song first published in 1931 or later, or by an author who died after 1955, may still be under
# copyright (ADR 0003, excluded-titles.txt): the composer, or a lyricist whose words were written with
# the music (`lyricist_died`).
LAST_FREE_DEATH = 1955
FIRST_COPYRIGHT_YEAR = 1931

# Where a composer may come from. A MuseScore page counts only as the Song's own score.
SOURCES = ("wikipedia.org", "imslp.org", "thesession.org", "tunearch.org", "mutopiaproject.org")

# What a batch file's record holds. `plan` writes the first five; the lookup adds the rest.
SKELETON_KEYS = ("id", "title", "views", "pdmx", "score")
LOOKUP_KEYS = ("composer", "composer_died", "lyricist_died", "composer_source", "published", "checked", "remove",
               "note")

# PDMX composer names (pdmx.normalize'd) that name nobody. A tradition on its own ('American',
# TRADITIONS below) names nobody either.
NO_NAMES = {"", "na", "none", "composer", "unknown", "anon", "anonymous", "anonyme", "round"}

# Words that mark a PDMX name as a folk tune, and the tradition each other word names.
TRADITIONAL_WORDS = {"traditional", "trad", "traditionnel", "traditonnel", "tradicional", "traditionell"}
TRADITIONS = {
    "scottish": "Scottish", "scotch": "Scottish", "irish": "Irish", "french": "French", "english": "English",
    "englich": "English", "inglaterra": "English", "welsh": "Welsh", "german": "German", "spanish": "Spanish",
    "espanol": "Spanish", "espagnole": "Spanish", "russian": "Russian", "american": "American",
}

# Every spelling PDMX gives a composer in the catalog, by its pdmx.normalize'd key, and the one
# spelling the catalog uses: the person's English Wikipedia article title without its bracketed
# disambiguation. A canonical spelling is a key of its own (`_ALIASES` below), so an entry whose key
# is its own spelling's ("antonin dvorak") gives a spelling with accents PDMX left out.
ALIASES = {
    "a borodine": "Alexander Borodin",
    "alfonso x el sabio": "Alfonso X of Castile",
    "angel villoldo": "Ángel Villoldo",
    "antonin dvorak": "Antonín Dvořák",
    "antonio lucio vivaldi": "Antonio Vivaldi",
    "bachs": "Johann Sebastian Bach",
    "j s bach": "Johann Sebastian Bach",
    "calixa lavallee": "Calixa Lavallée",
    "carolan": "Turlough O'Carolan",
    "ocarolan": "Turlough O'Carolan",
    "chopin": "Frédéric Chopin",
    "frederic chopin": "Frédéric Chopin",
    "frederic francois chopin": "Frédéric Chopin",
    "e grieg": "Edvard Grieg",
    "edvard hagerup grieg": "Edvard Grieg",
    "eward elgar": "Edward Elgar",
    "euphemia allen": "Euphemia Allan",
    "felix powel": "Felix Powell",
    "g f haendel": "George Frideric Handel",
    "handel": "George Frideric Handel",
    "g h matos rodriguez": "Gerardo Matos Rodríguez",
    "gabriel faure": "Gabriel Fauré",
    "gottfried heinrich stolzel": "Gottfried Heinrich Stölzel",
    "henry c work": "Henry Clay Work",
    "isaac albeniz": "Isaac Albéniz",
    "j offenbach": "Jacques Offenbach",
    "offenbach": "Jacques Offenbach",
    "j p sousa": "John Philip Sousa",
    "j s skinner": "James Scott Skinner",
    "j scott skinner": "James Scott Skinner",
    "l v betthoven": "Ludwig van Beethoven",
    "p i tchaikovsky": "Pyotr Ilyich Tchaikovsky",
    "peter ilyich tchaikovsky": "Pyotr Ilyich Tchaikovsky",
    "tchaikovsky": "Pyotr Ilyich Tchaikovsky",
    "playford": "John Playford",
    "rossini": "Gioachino Rossini",
    "stephen c foster": "Stephen Foster",
    "w a mozart": "Wolfgang Amadeus Mozart",
    "william b bradbury": "William Batchelder Bradbury",
    "wm marshall": "William Marshall",
}

# PDMX composer names that the rules below can't read, as they're written, and what each says: a
# name, a tradition, or nobody (None) when it names a collection, a lyricist or a page.
PDMX_NAMES = {
    "1860s English Sea Shanty": "Traditional (English)",
    "Adapted froman Old Irish Air byFRED E. WEATHERLY": "Traditional (Irish)",
    "Attrib. to Guiseppe Giordiano": "Giuseppe Giordani",
    "Bach-Gounod": "Johann Sebastian Bach and Charles Gounod",
    "Bartholomäus Gesius / Georg Philipp Telemann": "Bartholomäus Gesius and Georg Philipp Telemann",
    "Based on Eddie Reader's recording as I hear it in B minor": None,
    "Cecil Sharp song collector": None,
    "David FraserJames Stewart Robertson": "David Fraser and James Stewart Robertson",
    "Deutsches Kinderlied": "Traditional (German)",
    "English Words by AP Graves": None,
    "Fourteenth century melody (in dulci jubilo); harmonized by Charles Winfred Douglas (18671944) 1918": None,
    "Frederick PageSt. Albans Hertfordshire 20 Sep 1898": "Frederick Page",
    "French Carol": "Traditional (French)",
    "Gow's Repository 1817": None,
    "Guido 'Arrezzo": "Guido of Arezzo",
    "Illumina oculos meos - Palestrina": "Giovanni Pierluigi da Palestrina",
    "Japanese Folk Song": "Traditional (Japanese)",
    "Kerr's First": None,
    "Mildred and Patty HillArr. C. Franklin Sweedy": "Mildred J. Hill and Patty Hill",
    "Music: Anon./William J Kirkpatrick Arranged by Todd McCabe and April Moriarty": "William J. Kirkpatrick",
    "Negro Spiritual Traditionnel": "Traditional (African American)",
    "No 214 Page 105 William Clarke of Feltwell": None,
    "O'Neill's version": None,
    "OLD HUNDREDTH L.M. Thomas Ken1551": None,
    "Pipe Major John McLellan": "John McLellan",
    "Pipe Major William Laurie Ballachulish (1882-1916)": "William Laurie",
    "Playford 1698 after Purcell 1695": "Henry Purcell",
    "Qui vult venire post me -Lasso": "Orlando di Lasso",
    "Recueil de Contradances 1706": None,
    "Russisches Volkslied": "Traditional (Russian)",
    "Russland": "Traditional (Russian)",
    "S-GHenry Clay Work": "Henry Clay Work",
    "SamuelJCM": None,
    "Scotch Air": "Traditional (Scottish)",
    "Sizilianische Weise 1803": "Traditional (Sicilian)",
    "Spiritual": "Traditional (African American)",
    "Though Philomela lost her love - Morley": "Thomas Morley",
    "TraditionnelRenaissance Espagnole": "Traditional (Spanish)",
    "Tsjekkisk julesang": "Traditional (Czech)",
    "Tune is: by Philip Rosseter 1601": "Philip Rosseter",
    "Tune: GROSSER GOTT from Katholisches Gesangbuch (circa 1774)Words: Clarence A Walworth (1820-1900) "
    "translated from Ignace Franz (1719-90)": None,
    "Unknown (Steven Foster) -c 1850": "Stephen Foster",
    "Urskoug": None,
    "Von Himmel": None,
    "W. de Wycombe / John of Fornsete -c 1226": "W. de Wycombe and John of Fornsete",
    "William Campbell's Country Dances III ca. 1790": None,
    "Words Charles C. Converse 1868 Lyrics Joseph M. Scriven 1855": "Charles Crozat Converse",
    "Words written by Robert Tannahill 1774-1810.": None,
    "Words: Frederick W Faber (1814-1863)Music: Benjamin F. White (1844 Sacred Harp)": "Benjamin F. White",
    "Words: Henry Francis Lyte (1793-1847)Tune: LAUDA ANIMA / PRAISE MY SOUL - John Goss (1800-1880)": "John Goss",
    "Words: William Henry Draper (1855 - 1933) tr from Cantico di fratre sole Francis of AssisiTune: LASST UNS "
    "ERFREUEN from Geistliche Kirchengesang Cologne 1623": None,
    "XV ème siècle": None,
    "aka The Fair Maid of the Inn": None,
    "aranjament Ionut Boncea": None,
    "for Galloway House 8x32R": None,
    "verses 1-3 unknownverses 4-5 James Montgomery (1771-1854)Tune: John Bacchus Dykes (1866)": "John Bacchus Dykes",
    "words: Goffredo Mameli 1847music: Michele Novaro 1847": "Michele Novaro",
}
# Pages of a tune collection, and a dance's reference number: R-22Irish, Joe Buchanan's Scottish Tome.
NOT_A_NAME = re.compile(r"^R-\d|Scottish Tome")

_DATES = re.compile(r"\([^)]*[\d?][^)]*\)|\[[^\]]*\d[^\]]*\]|-?\s*\b(?:c\.?|ca\.?|circa)\s*\d{3,4}|"
                    r"\s-\s*\d{4}\b|\b\d{3,4}s?\b(?:\s*-\s*\d{2,4}\b)?")
_ARRANGER = re.compile(r"\(?\s*(?:\barr\b\.?|arr\.|arranged\b|arrangement\b|bearbeitung\b|harmoni[sz]ed\b).*$", re.I)
_PREFIX = re.compile(r"^(?:composer\s*:|composed by\b|melodie\s*:|music\s*:|by\b)\s*", re.I)
_TEMPO = re.compile(r"\s*\b(?:allegro moderato|allegretto|allegro|vivace|andante|moderato)\s*$", re.I)
_PLACE = re.compile(r"\s+(?:Scotland|Northumberland|Ireland|England)$")
_ALIASES = {**ALIASES, **{pdmx.normalize(name): name for name in set(ALIASES.values())}}


def traditional(key):
    """'Traditional (Irish)' for a pdmx.normalize'd folk-tune name such as 'irish traditional', else None."""
    words = key.split()
    if not TRADITIONAL_WORDS & set(words):
        return None
    traditions = {TRADITIONS[w] for w in words if w in TRADITIONS}
    return f"Traditional ({traditions.pop()})" if len(traditions) == 1 else "Traditional"


def _person(text):
    text = _PLACE.sub("", _TEMPO.sub("", text)).strip(" -.,;:/(")
    if text.isupper():
        text = text.title()
    key = pdmx.normalize(text)
    if key in NO_NAMES or key in TRADITIONS or not re.search(r"[a-z]", key):
        return None
    return _ALIASES.get(key, " ".join(text.split()))


def normalize(raw):
    """PDMX's composer_name in the catalog's one spelling: a person ('Frédéric Chopin' for 'Chopin'
    or 'Frederic Chopin (1810-1849)'), several joined by ' and ', 'Traditional (Irish)' for a folk
    tune, or None when it names nobody ('NA', 'Composer', 'anon.', a collection's page)."""
    if raw is None:
        return None
    raw = raw.strip()
    if raw in PDMX_NAMES:
        return PDMX_NAMES[raw]
    if NOT_A_NAME.search(raw):
        return None
    text = _PREFIX.sub("", raw)
    text = _ARRANGER.sub("", text)
    text = _DATES.sub(" ", text)
    if ":" in text:
        text = text.split(":", 1)[0]
    key = pdmx.normalize(text)
    if key in NO_NAMES:
        return None
    if traditional(key):
        return traditional(key)
    people = [_person(part) for part in re.split(r"\s+(?:&|and)\s+", text)]
    if None in people:
        return None
    return " and ".join(people)


def name_problems(composer):
    """What's wrong with a lookup's composer: a name in another spelling, a placeholder, or a date."""
    if not isinstance(composer, str) or not composer:
        return ["composer: a name, 'Traditional (<tradition>)' or 'Unknown'"]
    if composer == UNKNOWN or TRADITIONAL.fullmatch(composer):
        return []
    if pdmx.normalize(composer).split()[0] in TRADITIONAL_WORDS:
        return [f"composer: write a folk tune as 'Traditional' or 'Traditional (Irish)', not {composer!r}"]
    problems = []
    for name in composer.split(" and "):
        key = pdmx.normalize(name)
        if key in NO_NAMES:
            problems.append(f"composer: {name!r} names nobody; write 'Unknown' with the pages checked")
        elif key in TRADITIONS:
            problems.append(f"composer: write a folk tune as 'Traditional ({TRADITIONS[key]})', not {name!r}")
        elif not NAME.fullmatch(name):
            problems.append(f"composer: {name!r} isn't a name (several are joined by ' and ', with no dates)")
        elif _ALIASES.get(key, name) != name:
            problems.append(f"composer: write {_ALIASES[key]!r}, the catalog's spelling, not {name!r}")
    return problems


def source_problems(url, entry, field):
    """What's wrong with a source URL: not https, or not a page the procedure accepts."""
    if not isinstance(url, str):
        return [f"{field}: a URL"]
    parts = urllib.parse.urlparse(url)
    host = parts.netloc.lower()
    if parts.scheme != "https" or not host:
        return [f"{field}: {url!r} isn't an https URL"]
    if any(host == s or host.endswith("." + s) for s in SOURCES):
        return []
    if host in ("musescore.com", "www.musescore.com"):
        own = (entry or {}).get("source", {}).get("musescore_score_id")
        if own and re.search(rf"/scores?/{own}(?:/|$)", parts.path):
            return []
        return [f"{field}: a MuseScore page counts only as the Song's own score, musescore.com/score/{own}"]
    return [f"{field}: {host} isn't Wikipedia, IMSLP, The Session, the Traditional Tune Archive, Mutopia "
            "or the Song's own MuseScore score"]


def is_done(record):
    return "composer" in record and "remove" not in record


def record_problems(record, entry):
    """What's wrong with one lookup, given the Song's catalog entry (None once it's removed)."""
    sid = record.get("id")
    problems = [f"unknown key {k!r}" for k in record if k not in SKELETON_KEYS + LOOKUP_KEYS]
    if "remove" in record:
        if not isinstance(record["remove"], str) or not record["remove"].strip():
            problems.append("remove: why the Song is under copyright")
        if not (max(record.get("composer_died", 0), record.get("lyricist_died", 0)) > LAST_FREE_DEATH
                or record.get("published", 0) >= FIRST_COPYRIGHT_YEAR):
            problems.append(f"remove: give composer_died or lyricist_died after {LAST_FREE_DEATH}, or published "
                            f"in {FIRST_COPYRIGHT_YEAR} or later")
        problems += source_problems(record.get("composer_source"), entry, "composer_source")
        return [f"{sid}: {p}" for p in problems]
    if entry is None:
        return [f"{sid}: not in the catalog, and no `remove` says why"]
    if "composer" not in record:
        stray = [k for k in LOOKUP_KEYS if k in record]
        return [f"{sid}: {k} without a composer" for k in stray]
    composer = record["composer"]
    problems += name_problems(composer)
    problems += source_problems(record.get("composer_source"), entry, "composer_source")
    named = composer != UNKNOWN and not TRADITIONAL.fullmatch(composer or "")
    for field in ("composer_died", "lyricist_died", "published"):
        year = record.get(field)
        if year is not None and not (isinstance(year, int) and not isinstance(year, bool) and 500 <= year <= 2100):
            problems.append(f"{field}: a year")
    died, published = record.get("composer_died"), record.get("published")
    if died is not None and not named:
        problems.append("composer_died: only for a named composer")
    # A living composer has no death year, so a named one needs it, or a first publication before
    # 1931 and a note saying why the year is missing.
    old = isinstance(published, int) and published < FIRST_COPYRIGHT_YEAR
    if named and died is None and not (old and isinstance(record.get("note"), str) and record["note"].strip()):
        problems.append(f"composer_died: the year the composer died, or `published` before {FIRST_COPYRIGHT_YEAR} "
                        "with a `note` saying why the death year is missing")
    for field, year in (("died", died), ("lyricist died", record.get("lyricist_died"))):
        if isinstance(year, int) and year > LAST_FREE_DEATH:
            problems.append(f"{field} {year}, after {LAST_FREE_DEATH}: under copyright, so remove the Song")
    if isinstance(published, int) and published >= FIRST_COPYRIGHT_YEAR:
        problems.append(f"first published {published}: under copyright, so remove the Song")
    if composer == UNKNOWN:
        checked = record.get("checked")
        if not checked or not isinstance(checked, list):
            problems.append("checked: the pages looked at, for an Unknown composer")
        else:
            for url in checked:
                problems += source_problems(url, entry, "checked")
    if "note" in record and not isinstance(record["note"], str):
        problems.append("note: text")
    return [f"{sid}: {p}" for p in problems]


def catalog_fields(record):
    """The fields a done lookup gives its Song's catalog entry."""
    fields = {"composer": record["composer"]}
    if "composer_died" in record:
        fields["composer_died"] = record["composer_died"]
    fields["composer_source"] = record["composer_source"]
    return fields


def catalog_problems(catalog, batches):
    """Every batch's place in the catalog: each Song in one batch, each done lookup's fields on its
    Song, each removed Song gone, and no Song with a composer that no lookup gave it."""
    problems = []
    entries = {e["id"]: e for e in catalog}
    seen = {}
    for name, records in batches.items():
        for r in records:
            if r["id"] in seen:
                problems.append(f"{r['id']}: in {seen[r['id']]} and {name}")
            seen[r["id"]] = name
            entry = entries.get(r["id"])
            if is_done(r) and entry is not None:
                have = {k: entry[k] for k in pdmx.COMPOSER_FIELDS if k in entry}
                if have != catalog_fields(r):
                    problems.append(f"{r['id']}: the catalog doesn't have {name}'s lookup: run apply")
            elif "remove" in r and entry is not None:
                problems.append(f"{r['id']}: {name} removes it, and it's still in the catalog")
            elif not is_done(r) and entry is not None and any(k in entry for k in pdmx.COMPOSER_FIELDS):
                problems.append(f"{r['id']}: has a composer in the catalog that {name} doesn't give it")
    for e in catalog:
        if e["id"] not in seen:
            problems.append(f"{e['id']}: in no composers-NN.json batch: run plan")
    return problems


def read_batches(directory=HERE):
    """Every batch file in `directory`, by name, in order."""
    files = sorted(p for p in Path(directory).iterdir() if BATCH_FILE.fullmatch(p.name))
    return {p.name: json.loads(p.read_text(encoding="utf-8")) for p in files}


def write_json(path, value):
    """A batch file, or the catalog: the catalog's own format (`json.dumps(indent=1)`, no trailing newline)."""
    Path(path).write_text(json.dumps(value, indent=1, ensure_ascii=False), encoding="utf-8")


def skeleton(entry, views):
    """A batch file's record for a Song not looked up yet."""
    source = entry.get("source", {})
    return {"id": entry["id"], "title": entry["title"], "views": views, "pdmx": source.get("composer"),
            "score": source.get("musescore_url") or source.get("url")}


def plan(catalog, batches, views, size, count=None):
    """New batches of the catalog's Songs that are in none yet, most viewed first, then by id: `count`
    batches of `size`, or all of them in batches of about `size`."""
    taken = {r["id"] for records in batches.values() for r in records}
    rest = sorted((e for e in catalog if e["id"] not in taken), key=lambda e: (-views(e), e["id"]))
    if count is not None:
        groups = [rest[i * size:(i + 1) * size] for i in range(count)]
    else:
        n = max(1, round(len(rest) / size)) if rest else 0
        groups = [rest[i * len(rest) // n:(i + 1) * len(rest) // n] for i in range(n)]
    return [[skeleton(e, views(e)) for e in group] for group in groups if group]


def pdmx_views(csv_path):
    """Each PDMX MIDI path's MuseScore views, from PDMX.csv."""
    with open(csv_path, newline="", encoding="utf-8") as f:
        return {row["mid"]: int(float(row["n_views"] or 0)) for row in csv.DictReader(f)}


def cell(text):
    return str(text).replace("|", "\\|").replace("\n", " ")


def link(url):
    if not url:
        return ""
    name = urllib.parse.unquote(urllib.parse.urlparse(url).netloc + urllib.parse.urlparse(url).path)
    return f"[{cell(name)}]({url})"


def report(batch_name, records):
    """The batch's report: every Song's composer and source, what PDMX said, and what was removed."""
    done = [r for r in records if is_done(r)]
    removed = [r for r in records if "remove" in r]
    unknown = [r for r in done if r["composer"] == UNKNOWN]
    folk = [r for r in done if TRADITIONAL.fullmatch(r["composer"])]
    differ = [r for r in done if r["composer"] not in (UNKNOWN, normalize(r.get("pdmx"))) and normalize(r.get("pdmx"))]
    lines = [
        f"# Composers: `tools/catalog/{batch_name}`",
        "",
        f"Generated by `{TOOL}`; don't edit by hand. Command:",
        "",
        "```sh",
        f"tools/melody-lab/.venv/bin/python -I {TOOL} report --batch tools/catalog/{batch_name}",
        "```",
        "",
        f"**{len(done)} of {len(records)} Songs looked up**: "
        f"{len(done) - len(unknown) - len(folk)} named, {len(folk)} traditional and {len(unknown)} unknown. "
        f"{len(removed)} removed as under copyright, {len(records) - len(done) - len(removed)} not looked up.",
        "",
        f"PDMX names another composer for {len(differ)} of them (PDMX column): its name is the score's "
        "uploader's, so each was checked against the source.",
    ]
    if removed:
        lines += ["", "## Removed as under copyright", "",
                  "| Song | Composer | Died | Published | Why | Source |", "| --- | --- | --- | --- | --- | --- |"]
        lines += [f"| {cell(r['title'])} (`{r['id']}`) | {cell(r.get('composer', ''))} | {r.get('composer_died', '')} | "
                  f"{r.get('published', '')} | {cell(r['remove'])} | {link(r.get('composer_source'))} |" for r in removed]
    if unknown:
        lines += ["", "## Unknown", "", "| Song | Pages checked | Note |", "| --- | --- | --- |"]
        lines += [f"| {cell(r['title'])} (`{r['id']}`) | {', '.join(link(u) for u in r['checked'])} | "
                  f"{cell(r.get('note', ''))} |" for r in unknown]
    lines += ["", "## Every Song", "", "| Song | Composer | Died | Published | Source | PDMX | Note |",
              "| --- | --- | --- | --- | --- | --- | --- |"]
    for r in records:
        mark = " (removed)" if "remove" in r else ""
        lines.append(f"| {cell(r['title'])} (`{r['id']}`){mark} | {cell(r.get('composer', ''))} | "
                     f"{r.get('composer_died', '')} | {r.get('published', '')} | {link(r.get('composer_source'))} | "
                     f"{cell(normalize(r.get('pdmx')) or '')} | {cell(r.get('note', ''))} |")
    return "\n".join(lines) + "\n"


def apply(catalog, records):
    """The catalog with each done lookup's fields on its Song."""
    lookups = {r["id"]: r for r in records if is_done(r)}
    return [pdmx.with_composer(e, catalog_fields(lookups[e["id"]])) if e["id"] in lookups else e for e in catalog]


def batch_problems(catalog, batch_path):
    entries = {e["id"]: e for e in catalog}
    records = json.loads(Path(batch_path).read_text(encoding="utf-8"))
    problems = [p for r in records for p in record_problems(r, entries.get(r.get("id")))]
    return records, problems


def removals_left(catalog, records):
    """The batch's Songs to remove that are still in the catalog: `apply` waits until they're gone."""
    ids = {e["id"] for e in catalog}
    return [f"{r['id']}: still in the catalog: remove it the README's way first" for r in records
            if "remove" in r and r["id"] in ids]


def batch_counts(records):
    """How a batch's lookups stand, for the worker's hand-back."""
    done = [r for r in records if is_done(r)]
    unknown = sum(1 for r in done if r["composer"] == UNKNOWN)
    folk = sum(1 for r in done if TRADITIONAL.fullmatch(r["composer"]))
    removed = sum(1 for r in records if "remove" in r)
    return (f"{len(done)} of {len(records)} looked up: {len(done) - unknown - folk} named, {folk} traditional, "
            f"{unknown} unknown; {removed} to remove, {len(records) - len(done) - removed} open")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("check", "report", "apply"):
        p = sub.add_parser(name)
        p.add_argument("--batch", type=Path, required=name != "check", help="a tools/catalog/composers-NN.json")
    p = sub.add_parser("plan")
    p.add_argument("--size", type=int, default=150)
    p.add_argument("--batches", type=int, help="write this many batches of --size, not all")
    p.add_argument("--cache", type=Path, default=Path.home() / ".cache/pedos/pdmx")
    args = parser.parse_args()
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))

    if args.command == "plan":
        batches = read_batches()
        views = pdmx_views(args.cache / "PDMX.csv")
        new = plan(catalog, batches, lambda e: views.get(e.get("source", {}).get("dataset_path"), 0), args.size,
                   args.batches)
        start = max((int(BATCH_FILE.fullmatch(n).group(1)) for n in batches), default=0) + 1
        for i, records in enumerate(new):
            path = HERE / f"composers-{start + i:02d}.json"
            write_json(path, records)
            print(f"{path.relative_to(ROOT)}: {len(records)} Songs")
        return 0

    if args.batch:
        # One batch: its own lookups, whether or not they're in the catalog yet.
        records, problems = batch_problems(catalog, args.batch)
        if args.command == "apply":
            problems += removals_left(catalog, records)
        if problems:
            print("\n".join(problems), file=sys.stderr)
            return 1
        if args.command == "apply":
            catalog = apply(catalog, records)
            write_json(CATALOG, catalog)
        if args.command in ("report", "apply"):
            args.batch.with_suffix(".report.md").write_text(report(args.batch.name, records), encoding="utf-8")
        print(f"{args.batch.name}: {batch_counts(records)}")
        if args.command != "apply":
            return 0
    else:
        problems = [p for path in (HERE / name for name in read_batches()) for p in batch_problems(catalog, path)[1]]
        problems += catalog_problems(catalog, read_batches())
    done = sum(1 for e in catalog if "composer" in e and "composer_source" in e)
    print(f"{done} of {len(catalog)} Songs have their composer")
    if problems:
        print("\n".join(problems), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
