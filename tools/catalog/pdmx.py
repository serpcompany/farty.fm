"""The rules of the PDMX batch import: which score is picked for a title, and the gates it must pass.

Pure functions, so the rules are tested without the dataset (`test_pdmx.py`). `import_pdmx.py`
does the downloading, rendering and writing. ADR 0003 says why Songs come only from cited scores.
"""
import math
import re
import unicodedata
from dataclasses import dataclass
from pathlib import PurePosixPath

# The only licenses the catalog accepts, with the URL PDMX records for each.
LICENSES = {
    "publicdomain": "https://creativecommons.org/publicdomain/mark/1.0/",
    "cc-zero": "https://creativecommons.org/publicdomain/zero/1.0/",
}
MAX_TRACKS = 2

# A sensible excerpt and tempo, chosen from the score itself.
EXCERPT_BEATS = 32  # the whole bars that fit in 32 quarter-note beats: 8 bars of 4/4, 10 of 3/4
MIN_BPM, MAX_BPM = 72, 144  # the score's own tempo, kept inside this range

# Melody sanity: a clean single-line melody with nothing important dropped.
MIN_NOTES, MAX_NOTES = 8, 64
MAX_RANGE = 19  # semitones, an octave and a fifth
MAX_DROPPED_SHARE = 0.10  # chord tones and inner-voice onsets the importer drops, of the track's notes


# ---------------------------------------------------------------- titles


@dataclass(frozen=True)
class Title:
    id: str  # the catalog id
    title: str  # the catalog title
    names: tuple  # normalized score titles that count as this Song


def normalize(text):
    """Lower case, no accents, apostrophes or punctuation: 'Frère Jacques!' -> 'frere jacques'."""
    text = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in text if not unicodedata.combining(c)).lower().replace("&", " and ")
    text = re.sub(r"['’`]", "", text)
    return " ".join(re.findall(r"[a-z0-9]+", text))


def read_titles(text):
    """Parse a titles file: one Song per line, `id | Title`, or `id | Title | alias; alias`.

    `#` starts a comment. An alias is another title a score of the same Song may carry."""
    titles, ids = [], set()
    for n, raw in enumerate(text.splitlines(), 1):
        line = raw.split("#", 1)[0].strip()
        if not line:
            continue
        parts = [p.strip() for p in line.split("|")]
        if len(parts) not in (2, 3) or not parts[0] or not parts[1]:
            raise ValueError(f"line {n}: expected 'id | Title' or 'id | Title | alias; alias'")
        sid, title = parts[0], parts[1]
        if not re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", sid):
            raise ValueError(f"line {n}: id {sid!r} must be lower-case words joined by '-'")
        if sid in ids:
            raise ValueError(f"line {n}: id {sid!r} is listed twice")
        ids.add(sid)
        aliases = [a.strip() for a in parts[2].split(";")] if len(parts) == 3 else []
        names = tuple(dict.fromkeys(match_key(x) for x in [title, *aliases] if match_key(x)))
        titles.append(Title(sid, title, names))
    return titles


def match_key(text):
    """What titles are compared by: normalized, without a leading 'the' ('The Three Blind Mice')."""
    key = normalize(text)
    return key[4:] if key.startswith("the ") else key


# A score title's head: what comes before ' - ', '(', '[' or ':', as in "Twinkle Twinkle Little Star - Main Theme".
_SEPARATOR = re.compile(r"\s[-–—|/]\s|[(\[:]")
# How a score's title matches, best first. A plain title beats an arrangement's ("Greensleeves -
# Ukulele", "Silent Night: Theme and Variations"), and MuseScore's song name comes last.
MATCHES = ("title", "title head", "song name")


def row_keys(row):
    """The (match, key) pairs a PDMX row can match a Title by, best match first."""
    keys = [("title", match_key(row["title"]))]
    sep = _SEPARATOR.search(row["title"])
    if sep:
        keys.append(("title head", match_key(row["title"][: sep.start()])))
    if row.get("song_name") not in (None, "", "NA"):
        keys.append(("song name", match_key(row["song_name"])))
    return [(m, k) for m, k in keys if k]


def match_kind(row, names):
    """How a PDMX row's title matches one of `names` (an entry of MATCHES), or None."""
    return next((m for m, k in row_keys(row) if k in names), None)


# ---------------------------------------------------------------- picking


def score_id(row):
    """The MuseScore score id, which PDMX uses as the metadata file's name (./metadata/5/5740212.json)."""
    return PurePosixPath(row["metadata"]).stem


def license_problems(row):
    """Why a PDMX row's license isn't acceptable: public domain or CC0 only, and no license conflict."""
    problems = []
    lic = row["license"]
    if lic not in LICENSES:
        problems.append("the license is not public domain or CC0")
    elif row["license_url"] != LICENSES[lic]:
        problems.append("the license URL doesn't match the license")
    if row["license_conflict"] != "False":
        problems.append("PDMX flags a license conflict")
    return problems


def pick_problems(row):
    """Why a PDMX row can't be picked at all: its license, its track count, or no MIDI file."""
    problems = license_problems(row)
    if int(float(row["n_tracks"] or 0)) > MAX_TRACKS:
        problems.append(f"more than {MAX_TRACKS} tracks")
    if not row["mid"]:
        problems.append("no MIDI file")
    return problems


def rank_key(match, row):
    """Best first: the best match (MATCHES), then the highest rating, the most views, the most
    ratings, and the lower score id."""
    return (
        MATCHES.index(match),
        -float(row["rating"] or 0),
        -int(float(row["n_views"] or 0)),
        -int(float(row["n_ratings"] or 0)),
        int(score_id(row)),
    )


@dataclass
class Candidates:
    """The PDMX scores whose title matches one Title."""

    title: Title
    eligible: list  # (match, row) that may be picked, best first
    matched: int  # rows whose title matches
    rejected: dict  # why the other matched rows can't be picked: reason -> count


def find_candidates(rows, titles, used=frozenset()):
    """Match every PDMX row against every Title and rank the eligible ones.

    `used` holds MIDI paths (the CSV's `mid`) already in the catalog; those aren't picked again."""
    found = {t.id: Candidates(t, [], 0, {}) for t in titles}
    by_name = {}
    for t in titles:
        for name in t.names:
            by_name.setdefault(name, []).append(t.id)
    for row in rows:
        best = {}  # title id -> the row's best match for it
        for match, key in row_keys(row):
            for tid in by_name.get(key, ()):
                best.setdefault(tid, match)
        for tid, match in best.items():
            c = found[tid]
            c.matched += 1
            problems = pick_problems(row)
            if row["mid"] in used:
                problems.append("already in the catalog")
            if problems:
                for p in problems:
                    c.rejected[p] = c.rejected.get(p, 0) + 1
            else:
                c.eligible.append((match, row))
    for c in found.values():
        c.eligible.sort(key=lambda mr: rank_key(*mr))
    return [found[t.id] for t in titles]


# ---------------------------------------------------------------- excerpt and tempo


EPS = 1e-6


def render_options(tempos, meters, first_onset):
    """The catalog's `render` options for a score: the tempo in effect at the melody's first note,
    kept within MIN_BPM..MAX_BPM, and the whole bars that fit in EXCERPT_BEATS, from the bar of the
    melody's first note.

    `tempos` is [(beat, bpm)] and `meters` [(beat, numerator, denominator)], from the score's
    set_tempo and time_signature events. Beats are quarter notes, as in melody.py. Each time
    signature starts a bar, so a pickup written as its own short bar (1/4, then 3/4) and meter
    changes keep their bar lines. `beats_per_bar` is the excerpt's main meter (the one covering the
    most of it), given only when it differs from the first time signature's numerator, which
    melody.py uses by default (6/8 has 3 quarter beats; a 1/4 pickup bar isn't the meter)."""
    tempos = sorted(tempos) or [(0.0, 120.0)]
    meters = sorted(meters) or [(0.0, 4, 4)]
    if meters[0][0] > 0:
        meters.insert(0, (0.0, 4, 4))
    bpm = next((b for at, b in reversed(tempos) if at <= first_onset + EPS), 120.0)
    opts = {"bpm": int(min(MAX_BPM, max(MIN_BPM, round(bpm))))}

    # Bar lines, each tagged with the meter of the bar it starts.
    bars = []
    for i, (at, num, den) in enumerate(meters):
        until = meters[i + 1][0] if i + 1 < len(meters) else math.inf
        length = num * 4 / den
        line = at
        while line < until - EPS and line <= first_onset + EXCERPT_BEATS + EPS:
            bars.append((line, length, (num, den)))
            line += length
    start_index = max(i for i, (line, _, _) in enumerate(bars) if line <= first_onset + EPS)
    start = bars[start_index][0]
    end = start + bars[start_index][1]  # at least one bar, however long
    covered = {}
    for line, length, meter in bars[start_index:]:
        if line + length > start + EXCERPT_BEATS + EPS:
            break
        end = line + length
        covered[meter] = covered.get(meter, 0) + length
    if start > EPS:
        opts["start_beat"] = _number(start)
    opts["max_beats"] = _number(end - start)

    num, den = max(covered, key=covered.get) if covered else bars[start_index][2]
    bar = num * 4 / den
    if bar == int(bar) and bar != meters[0][1]:
        opts["beats_per_bar"] = int(bar)
    return opts


def _number(x):
    x = round(x, 6)
    return int(x) if x == int(x) else x


# ---------------------------------------------------------------- gates


def sanity_problems(pitches, chord_tones_dropped, inner_onsets_dropped, track_notes):
    """Melody sanity: a sensible note count and range in the excerpt (`pitches`, MIDI, in order),
    and few notes dropped by the importer across the track (`track_notes` is what it kept)."""
    problems = []
    if not MIN_NOTES <= len(pitches) <= MAX_NOTES:
        problems.append(f"{len(pitches)} notes (between {MIN_NOTES} and {MAX_NOTES})")
    if pitches and max(pitches) - min(pitches) > MAX_RANGE:
        problems.append(f"range {max(pitches) - min(pitches)} semitones (at most {MAX_RANGE})")
    dropped = chord_tones_dropped + inner_onsets_dropped
    share = dropped / (track_notes + dropped) if track_notes + dropped else 0.0
    if share > MAX_DROPPED_SHARE:
        problems.append(
            f"the importer dropped {dropped} chord tones and inner-voice onsets,"
            f" {share:.0%} of the track's notes (at most {MAX_DROPPED_SHARE:.0%})"
        )
    return problems


def render_problems(metrics, bar):
    """The renderer's bar (ADR 0012, evaluate.BAR) on evaluate.py's metrics."""
    problems = []
    if metrics["within_50c_of_fart_pct"] < bar["within_50c_of_fart_pct"]:
        problems.append(f"in50cFart {metrics['within_50c_of_fart_pct']}% < {bar['within_50c_of_fart_pct']}%")
    if metrics["onsets_on_time_pct"] < bar["onsets_on_time_pct"]:
        problems.append(f"onTime {metrics['onsets_on_time_pct']}% < {bar['onsets_on_time_pct']}%")
    if metrics["notes_with_retrigger"] > bar["notes_with_retrigger"]:
        problems.append(f"{metrics['notes_with_retrigger']} notes re-attack")
    return problems


def hash_problems(archive_md5, published_md5, member_sha256, copy_sha256, copy="the catalog copy"):
    """The MIDI archive matches the checksum Zenodo publishes, and a copy of the score (the
    extracted file the gates import, or the catalog's copy) is byte for byte the file in the archive."""
    problems = []
    if archive_md5 != published_md5:
        problems.append(f"the MIDI archive's md5 {archive_md5} is not Zenodo's {published_md5}")
    if copy_sha256 != member_sha256:
        problems.append(f"{copy}'s sha256 {copy_sha256} is not the archive file's {member_sha256}")
    return problems


# ---------------------------------------------------------------- the catalog


def new_title_problems(title, catalog):
    """A Title must be new: no catalog entry outside its own batch has its id or title. Titles
    compare as names do (match_key), so a leading 'the' on either side doesn't matter."""
    for e in catalog:
        if e["id"] == title.id:
            return [f"the catalog already has id {title.id!r}"]
        if match_key(e["title"]) in title.names:
            return [f"the catalog already has {e['title']!r} ({e['id']})"]
    return []


def batch_of(entry):
    return entry.get("import", {}).get("titles")


def merge_catalog(catalog, titles_file, entries):
    """The catalog with this titles file's earlier entries replaced by `entries`.

    Entries from elsewhere (other batches, or added by hand) are kept as they are, in order."""
    kept = [e for e in catalog if batch_of(e) != titles_file]
    clash = {e["id"] for e in kept} & {e["id"] for e in entries}
    if clash:
        raise ValueError(f"ids already in the catalog: {sorted(clash)}")
    return kept + list(entries)


def spread(items, n):
    """`n` items spread evenly through `items`, first and last included: the spot-check sample."""
    if n >= len(items):
        return list(items)
    if n == 1:
        return [items[0]]
    return [items[round(i * (len(items) - 1) / (n - 1))] for i in range(n)]
