import math
import re
import unicodedata
from dataclasses import dataclass
from pathlib import PurePosixPath

LICENSES = {
    "publicdomain": "https://creativecommons.org/publicdomain/mark/1.0/",
    "cc-zero": "https://creativecommons.org/publicdomain/zero/1.0/",
}
MAX_TRACKS = 2

MISBARRED_SCORES = {
    "6064902": 'Happy Birthday in 3/4 from "Hap-": bars start on "Hap-" and "to", not "birth-" and "you"',
    "2030696": 'When the Saints in 4/4 with "Oh when the" in its first bar: "saints" falls on beat 3',
    "5893953": 'God Rest Ye in 4/4 from "God": bars start on "God" and "-ry", not "rest" and "gen-"',
    "20295": 'The Star-Spangled Banner in 3/4 from "O-": bars start on "O-" and "you", not "say" and "see"',
    "3982531": 'The Star-Spangled Banner with "O-" on a bar line: bars start on "O-" and "you", not "say" and "see"',
    "5171990": 'The Star-Spangled Banner in 4/4 from "O-": the anthem is in 3/4, with "O-" as its pickup',
}

EXCERPT_BEATS = 32
MIN_BPM, MAX_BPM = 72, 144

MIN_NOTES, MAX_NOTES = 8, 64
MAX_RANGE = 19
MAX_DROPPED_SHARE = 0.10
PADDED_PICKUP_REST = 1
GRID = 1 / 48


@dataclass(frozen=True)
class Title:
    id: str
    title: str
    names: tuple


def normalize(text):
    text = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in text if not unicodedata.combining(c)).lower().replace("&", " and ")
    text = re.sub(r"['’`]", "", text)
    return " ".join(re.findall(r"[a-z0-9]+", text))


def read_titles(text):
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
    key = normalize(text)
    return key[4:] if key.startswith("the ") else key


_SEPARATOR = re.compile(r"\s[-–—|/]\s|[(\[:]")
MATCHES = ("title", "title head", "song name")


def row_keys(row):
    keys = [("title", match_key(row["title"]))]
    sep = _SEPARATOR.search(row["title"])
    if sep:
        keys.append(("title head", match_key(row["title"][: sep.start()])))
    if row.get("song_name") not in (None, "", "NA"):
        keys.append(("song name", match_key(row["song_name"])))
    return [(m, k) for m, k in keys if k]


def match_kind(row, names):
    return next((m for m, k in row_keys(row) if k in names), None)


def score_id(row):
    return PurePosixPath(row["metadata"]).stem


def license_problems(row):
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
    problems = license_problems(row)
    if score_id(row) in MISBARRED_SCORES:
        problems.append("its bar lines are off the tune")
    if int(float(row["n_tracks"] or 0)) > MAX_TRACKS:
        problems.append(f"more than {MAX_TRACKS} tracks")
    if not row["mid"]:
        problems.append("no MIDI file")
    return problems


def rank_key(match, row):
    return (
        MATCHES.index(match),
        -float(row["rating"] or 0),
        -int(float(row["n_views"] or 0)),
        -int(float(row["n_ratings"] or 0)),
        int(score_id(row)),
    )


@dataclass
class Candidates:
    title: Title
    eligible: list
    matched: int
    rejected: dict


def find_candidates(rows, titles, used=frozenset()):
    found = {t.id: Candidates(t, [], 0, {}) for t in titles}
    by_name = {}
    for t in titles:
        for name in t.names:
            by_name.setdefault(name, []).append(t.id)
    for row in rows:
        best = {}
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


EPS = 1e-6


def render_options(tempos, meters, first_onset):
    tempos = sorted(tempos) or [(0.0, 120.0)]
    meters = _meters(meters)
    bpm = next((b for at, b in reversed(tempos) if at <= first_onset + EPS), 120.0)
    opts = {"bpm": int(min(MAX_BPM, max(MIN_BPM, round(bpm))))}

    bars = _bar_lines(meters, first_onset + EXCERPT_BEATS)
    start_index = _bar_index(bars, first_onset)
    first_line = bars[start_index][0]
    end = first_line + bars[start_index][1]
    covered = {}
    for line, length, meter in bars[start_index:]:
        if line + length > first_line + EXCERPT_BEATS + EPS:
            break
        end = line + length
        covered[meter] = covered.get(meter, 0) + length
    if first_onset > first_line + EPS:
        start = first_onset
        opts["start_beat"] = int(start) if start == int(start) else start
    else:
        start = first_line
        if start > EPS:
            opts["start_beat"] = _number(start)
    opts["max_beats"] = _number(end - start)

    num, den = max(covered, key=covered.get) if covered else bars[start_index][2]
    bar = num * 4 / den
    if bar == int(bar) and bar != meters[0][1]:
        opts["beats_per_bar"] = int(bar)
    return opts


def _meters(meters):
    meters = sorted(meters) or [(0.0, 4, 4)]
    if meters[0][0] > 0:
        meters.insert(0, (0.0, 4, 4))
    return meters


def _bar_lines(meters, until):
    bars = []
    for i, (at, num, den) in enumerate(meters):
        end = meters[i + 1][0] if i + 1 < len(meters) else math.inf
        length = num * 4 / den
        line = at
        while line < end - EPS and line <= until + EPS:
            bars.append((line, length, (num, den)))
            line += length
    return bars


def _bar_index(bars, beat):
    return max(i for i, (line, _, _) in enumerate(bars) if line <= beat + EPS)


def _number(x):
    x = round(x, 6)
    return int(x) if x == int(x) else x


def sanity_problems(pitches, chord_tones_dropped, inner_onsets_dropped, track_notes):
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


def padded_pickup_problems(meters, notes, first_onset):
    bars = _bar_lines(_meters(meters), first_onset)
    line, length, _ = bars[_bar_index(bars, first_onset)]
    end = line + length
    spans = sorted((max(s, line), min(e, end)) for s, e in notes if s < end - EPS and e > line + EPS)
    if not spans or _grid(spans[0][0] - line) > 0:
        return []
    reach = line
    for start, stop in spans:
        if _grid(start - reach) >= PADDED_PICKUP_REST:
            return []
        reach = max(reach, stop)
    rest = _grid(end - reach)
    if rest < PADDED_PICKUP_REST or rest < _grid(reach - line):
        return []
    beats = "beat" if _number(rest) == 1 else "beats"
    return [f"the first bar is a pickup padded with silence: every track rests {_number(rest)} {beats} after its notes"]


def _grid(beats):
    return round(beats / GRID) * GRID


def hash_problems(archive_md5, published_md5, member_sha256, copy_sha256, copy="the catalog copy"):
    problems = []
    if archive_md5 != published_md5:
        problems.append(f"the MIDI archive's md5 {archive_md5} is not Zenodo's {published_md5}")
    if copy_sha256 != member_sha256:
        problems.append(f"{copy}'s sha256 {copy_sha256} is not the archive file's {member_sha256}")
    return problems


def new_title_problems(title, catalog):
    for e in catalog:
        if e["id"] == title.id:
            return [f"the catalog already has id {title.id!r}"]
        if match_key(e["title"]) in title.names:
            return [f"the catalog already has {e['title']!r} ({e['id']})"]
    return []


def batch_of(entry):
    return entry.get("import", {}).get("titles")


def merge_catalog(catalog, titles_file, entries):
    kept = [e for e in catalog if batch_of(e) != titles_file]
    clash = {e["id"] for e in kept} & {e["id"] for e in entries}
    if clash:
        raise ValueError(f"ids already in the catalog: {sorted(clash)}")
    return kept + list(entries)


def spread(items, n):
    if n >= len(items):
        return list(items)
    if n == 1:
        return [items[0]]
    return [items[round(i * (len(items) - 1) / (n - 1))] for i in range(n)]
