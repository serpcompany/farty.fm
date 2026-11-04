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

# The fields composers.py gives a Song's catalog entry (#357), which importing its batch again keeps.
COMPOSER_FIELDS = ("composer", "composer_died", "composer_source")

# Scores whose bar lines are off the tune: most are written without the Song's pickup, one in the
# wrong meter, so the renderers' accent on a bar line (+1.5 dB) falls on the wrong notes (#232).
# A gate can't tell a missing pickup from the score's own rhythm, so these were found by reading
# each catalog score's bar lines against the words (melody.bar_lines), and are never picked.
# MuseScore score id -> why.
MISBARRED_SCORES = {
    "6064902": 'Happy Birthday in 3/4 from "Hap-": bars start on "Hap-" and "to", not "birth-" and "you"',
    # When the Saints keeps this hand-picked score anyway, by decision (#232, comment 6459788077):
    # the one correctly barred score that passes the gates (6133057) plays "saints" short, then
    # rests 4 beats. The importer never picks it, so re-importing saints would replace it.
    "2030696": 'When the Saints in 4/4 with "Oh when the" in its first bar: "saints" falls on beat 3',
    "5893953": 'God Rest Ye in 4/4 from "God": bars start on "God" and "-ry", not "rest" and "gen-"',
    "20295": 'The Star-Spangled Banner in 3/4 from "O-": bars start on "O-" and "you", not "say" and "see"',
    "3982531": 'The Star-Spangled Banner with "O-" on a bar line: bars start on "O-" and "you", not "say" and "see"',
    "5171990": 'The Star-Spangled Banner in 4/4 from "O-": the anthem is in 3/4, with "O-" as its pickup',
}

# Scores that pass the gates but aren't the tune's melody: one inner voice of a hymn's harmony, or
# another tune under the same name, found by reading the picks after an import (flag_picks.py, #324).
# They're never picked. MuseScore score id -> why.
NOT_THE_MELODY = {
    "562231": "My Faith Looks Up To Thee: the tenor part of OLIVET",
    "653966": "Forty Days and Forty Nights: the tenor part of AUS DER TIEFE",
    "4878861": "The Dark-Eyed Sailor: Version 2 of 3, not the tune most PDMX scores of the song carry",
    "5864163": "In the Bleak Midwinter: the tenor part of CRANHAM",
}

# A sensible excerpt and tempo, chosen from the score itself.
EXCERPT_BEATS = 32  # the whole bars that fit in 32 quarter-note beats: 8 bars of 4/4, 10 of 3/4
HELD_NOTE_BEATS = 2  # a note this long on the excerpt's closing bar line ends its phrase: the excerpt keeps it (#389)
MIN_BPM, MAX_BPM = 72, 144  # the score's own tempo, kept inside this range

# Melody sanity: a clean single-line melody with nothing important dropped.
MIN_NOTES, MAX_NOTES = 8, 64
MAX_RANGE = 19  # semitones, an octave and a fifth
MAX_DROPPED_SHARE = 0.10  # chord tones and inner-voice onsets the importer drops, of the track's notes
PADDED_PICKUP_REST = 1  # beats of silence after a first bar's notes that make it a padded pickup
MOVED_TUNE_REST = 2  # beats: a rest this long while another staff of the score plays the tune (#380)
# A part that is a voice, so another part's line while it rests is its accompaniment's (#380): General
# MIDI's Choir Aahs, Voice Oohs and Synth Voice, or a voice's name. PDMX often gives a voice another
# program (Una furtiva lagrima's "Vocals" is a piano's 0, Erlkönig's "Voice" an oboe's 68). "Bass"
# alone isn't a voice's name here: it names a bass guitar as often as a voice.
VOICE_PROGRAMS = frozenset({52, 53, 54})
VOICE_NAMES = frozenset({
    "voice", "voices", "vocal", "vocals", "voce", "voz", "voix", "stimme", "singstimme", "gesang", "canto",
    "soprano", "sopran", "mezzo", "mezzo soprano", "alto", "contralto", "tenor", "tenore", "baritone",
    "bariton", "s", "a", "t", "choir", "chorus", "choir aahs", "voice oohs",
})
GRID = 1 / 48  # beats: the grid note times are compared on


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
    """Why a PDMX row can't be picked at all: its license, its track count, no MIDI file, or bar
    lines off the tune (MISBARRED_SCORES), or not the tune's melody (NOT_THE_MELODY)."""
    problems = license_problems(row)
    if score_id(row) in MISBARRED_SCORES:
        problems.append("its bar lines are off the tune")
    if score_id(row) in NOT_THE_MELODY:
        problems.append("it isn't the tune's melody")
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


def render_options(tempos, meters, first_onset, notes=()):
    """The catalog's `render` options for a score: the tempo in effect at the melody's first note,
    kept within MIN_BPM..MAX_BPM, and an excerpt from the melody's first note to the end of the
    whole bars that fit in EXCERPT_BEATS from that note's bar, so a pickup written after a rest in a
    full bar doesn't open the Song with silence. The accents still fall on the score's own bar
    lines, which melody.py reads from its time signatures (`bar_lines`, #232). When the melody's
    held note starts on that closing bar line, the excerpt runs on to its end (held_note_end, #389).

    `tempos` is [(beat, bpm)] and `meters` [(beat, numerator, denominator)], from the score's
    set_tempo and time_signature events, and `notes` the melody's [(start, dur)] as melody.py reads
    them. Beats are quarter notes, as in melody.py. Each time
    signature starts a bar, so a pickup written as its own short bar (1/4, then 3/4) and meter
    changes keep their bar lines. `beats_per_bar` is the excerpt's main meter (the one covering the
    most of it), given only when it differs from the first time signature's numerator, which
    melody.py uses by default (6/8 has 3 quarter beats; a 1/4 pickup bar isn't the meter)."""
    tempos = sorted(tempos) or [(0.0, 120.0)]
    meters = _meters(meters)
    bpm = next((b for at, b in reversed(tempos) if at <= first_onset + EPS), 120.0)
    opts = {"bpm": int(min(MAX_BPM, max(MIN_BPM, round(bpm))))}

    bars = _bar_lines(meters, first_onset + EXCERPT_BEATS)
    start_index = _bar_index(bars, first_onset)
    first_line = bars[start_index][0]
    end = first_line + bars[start_index][1]  # at least one bar, however long
    covered = {}
    for line, length, meter in bars[start_index:]:
        if line + length > first_line + EXCERPT_BEATS + EPS:
            break
        end = line + length
        covered[meter] = covered.get(meter, 0) + length
    if first_onset > first_line + EPS:
        # The first note's beat exactly as melody.py reads it, so load_midi keeps that note.
        start = first_onset
        opts["start_beat"] = int(start) if start == int(start) else start
    else:
        start = first_line
        if start > EPS:
            opts["start_beat"] = _number(start)
    opts["max_beats"] = excerpt_beats(start, held_note_end(notes, start, end))

    num, den = max(covered, key=covered.get) if covered else bars[start_index][2]
    bar = num * 4 / den
    if bar == int(bar) and bar != meters[0][1]:
        opts["beats_per_bar"] = int(bar)
    return opts


def held_note_end(notes, start, end):
    """Where an excerpt from `start` to the bar line `end` ends: at the end of the melody's held note
    (HELD_NOTE_BEATS or more) that starts on that bar line, so the Song doesn't stop one note before
    its phrase does (#389), or at `end`. Grand Old Flag's excerpt stopped on "the home of the free and
    the", and "brave" starts on its closing bar line. The excerpt still lasts at most EXCERPT_BEATS
    from `start`, and takes in only that note: none other starts before its end.

    `notes` is the melody's [(start, dur)] in beats, as melody.py reads them: a note's slot runs to
    the next onset unless a rest follows, and load_midi keeps each note that starts in the excerpt
    whole, so the held note's end is where the Song stops."""
    held = next(((s, d) for s, d in notes if abs(s - end) < EPS), None)
    if held is None or held[1] < HELD_NOTE_BEATS - EPS:
        return end
    held_end = held[0] + held[1]
    if held_end > start + EXCERPT_BEATS + EPS or any(end + EPS < s < held_end - EPS for s, _ in notes):
        return end
    return held_end


def excerpt_beats(start, end):
    """The `max_beats` of an excerpt from `start` to `end`. Rounded down, so load_midi, which keeps
    the notes that start before it, leaves out a note that starts on `end` (a third of a beat
    doesn't round to 6 decimals)."""
    return _number(math.floor((end - start) * 1e6 + 1e-3) / 1e6)


def _meters(meters):
    """The time signatures in order, with melody.py's 4/4 at beat 0 when the score sets none there."""
    meters = sorted(meters) or [(0.0, 4, 4)]
    if meters[0][0] > 0:
        meters.insert(0, (0.0, 4, 4))
    return meters


def _bar_lines(meters, until):
    """The bar lines up to beat `until`, each as (beat, bar length, meter of the bar it starts).
    Each time signature starts a bar."""
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
    """The index in `bars` of the bar that holds `beat`."""
    return max(i for i, (line, _, _) in enumerate(bars) if line <= beat + EPS)


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


def padded_pickup_problems(meters, notes, first_onset):
    """A first bar that is a pickup padded with silence (#225), so the Song would open with its
    pickup cut off from bar 1. PDMX's reader takes a measure's length from its `len` attribute or
    its time signature, and a MuseScore 1.x file can give a pickup's length only in the score's
    `<siglist>`, so the MIDI file pads the pickup out to a full bar: its notes start on the bar
    line, and every track is then silent to the next bar line.

    The bar is the one that holds the melody's first note (`first_onset`), where the excerpt
    starts, and `notes` is every track's notes as (start, end) beats. The bar fails when it opens
    with a note, its notes run with no rest of PADDED_PICKUP_REST beats or more between them, and
    every track then rests PADDED_PICKUP_REST beats or more to the next bar line, for at least as
    long as the bar's notes lasted. A pickup is at most half its bar, so a full bar that ends on a
    real rest ("C D E -") passes. A bar with a rest of PADDED_PICKUP_REST beats or more between its
    notes too is the score's own rhythm, not a padded pickup."""
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


def part_staves(tracks, track):
    """The tracks of `track`'s part, in order. PDMX's MIDI writes each staff of a part as a track of
    its own, with the part's name and channel, so a piano's two staves are two tracks named "Piano"
    on one channel. Another part, a voice over its piano or a second violin, has a channel of its
    own. `tracks` is {track: (name, channels)}, of the tracks with notes."""
    return sorted(t for t, part in tracks.items() if part == tracks[track])


def sung(name, programs):
    """Whether a part named `name`, with these General MIDI `programs`, is a voice (VOICE_NAMES)."""
    return bool(VOICE_PROGRAMS & set(programs)) or " ".join(re.findall(r"[a-z]+", normalize(name))) in VOICE_NAMES


def tune_staves(tracks, track):
    """The staves the tune can move to from `track`'s, as {staff: (where it moves, whether it's
    another part)}: the other staves of its part (part_staves), and every staff of the score's other
    parts but an instrument's under a sung melody, since a voice resting while its piano plays is the
    score's rest (Danny Boy's voice over its piano's intro). `tracks` is {track: ((name, channels),
    sung)}, of the tracks with notes."""
    part, voice = tracks[track]
    own = part_staves({t: p for t, (p, _) in tracks.items()}, track)
    out = {}
    for t, (p, v) in sorted(tracks.items()):
        if t in own and t != track:
            out[t] = ("another staff of its part", False)
        elif t not in own and (v or not voice):
            out[t] = (f"another part ({p[0] or f'track {t}'})", True)
    return out


def moved_tune_problems(notes, staves, start_beat=0.0):
    """The tune moving to another staff of the score, so the Song falls silent where the score plays
    on (#380): Old MacDonald's score gives "Old MacDonald had a farm" to the piano's left hand, and
    Moments Musicaux's first violin rests while the second plays the tune. The melody fails when it
    rests MOVED_TUNE_REST beats or more between two notes while one of `staves` plays the tune in
    the rest (tune_line). A rest at the excerpt's start, an opening, isn't checked.

    `notes` is the melody's excerpt as (start, dur, pitch) from `start_beat` of the score, and
    `staves` is {staff: (where it moves, whether it's another part, its notes as (start, end, pitch)
    in the score's beats)}. Returns [(staff, problem)], in the melody's order."""
    pitches = [p for _, _, p in notes]
    problems = []
    for (s0, d0, _), (s1, _, _) in zip(notes, notes[1:]):
        rest = _grid(s1 - s0 - d0)
        if rest < MOVED_TUNE_REST:
            continue
        for staff, (where, other_part, staff_notes) in staves.items():
            if tune_line(staff_notes, start_beat + s0 + d0, start_beat + s1, pitches, other_part):
                problems.append((staff, f"the tune moves to {where}: the melody rests {_number(round(rest, 2))} beats"
                                        f" from beat {_number(round(s0 + d0, 2))} while that staff plays"))
    return problems


def tune_line(staff_notes, start, end, pitches, other_part=False):
    """The line a staff plays from `start` to before `end` (staff_line), when it's the tune and not
    its accompaniment: in the tune's register, so the melody's `pitches` and it span at most
    MAX_RANGE (a bass under the tune is its accompaniment). [] when the staff plays no tune there.

    Another part's line is the tune only with two pitches or more, not a chord at every onset: a
    part that sounds one pitch in the rest (Radetzky's guitar, one F4) or only chords (Erlkönig's
    piano) accompanies. The other hand of the melody's own instrument answers it even with one
    note (Summ, summ, summ's left hand).

    The rule's blind spot: a tune that really moves to another part but is one repeated pitch there,
    or moves in parallel chords, passes as accompaniment. Today the rule lets through only Radetzky
    (the guitar's F4) and Aus tiefer Not schrei ich zu dir (the bass's C3), and both accompany."""
    line = staff_line(staff_notes, start, end)
    if not line or max(pitches + line) - min(pitches + line) > MAX_RANGE:
        return []
    onsets = [s for s, _, _ in staff_notes if start - EPS <= s < end - EPS]
    if other_part and (len(set(line)) < 2 or all(onsets.count(s) > 1 for s in set(onsets))):
        return []
    return line


def staff_line(staff_notes, start, end):
    """The pitches melody.py's sustain-aware skyline takes from `staff_notes` ((start, end, pitch))
    at its onsets from `start` to before `end`: at each onset the highest sounding note, if it starts
    there."""
    line = []
    for onset in sorted({s for s, _, _ in staff_notes if start - EPS <= s < end - EPS}):
        pitch, begun = max((p, s) for s, e, p in staff_notes if s <= onset < e)
        if begun == onset:
            line.append(pitch)
    return line


def _grid(beats):
    return round(beats / GRID) * GRID


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


def with_composer(entry, fields):
    """The entry with its composer fields (COMPOSER_FIELDS) set to `fields`, placed after its title."""
    out = {}
    for key, value in entry.items():
        if key in COMPOSER_FIELDS:
            continue
        out[key] = value
        if key == "title":
            out.update(fields)
    return out


def merge_catalog(catalog, titles_file, entries):
    """The catalog with this titles file's earlier entries replaced by `entries`, where the first of them
    was (at the end for a new batch), so importing a batch again doesn't reorder the app's Songs. A
    Song imported again keeps the composer its earlier entry had (composers.py, #357).

    Entries from elsewhere (other batches, or added by hand) are kept as they are, in order."""
    earlier = {e["id"]: e for e in catalog if batch_of(e) == titles_file}
    entries = [with_composer(e, {k: earlier[e["id"]][k] for k in COMPOSER_FIELDS if k in earlier[e["id"]]})
               if e["id"] in earlier else e for e in entries]
    first = next((i for i, e in enumerate(catalog) if batch_of(e) == titles_file), len(catalog))
    kept = [e for e in catalog if batch_of(e) != titles_file]
    clash = {e["id"] for e in kept} & {e["id"] for e in entries}
    if clash:
        raise ValueError(f"ids already in the catalog: {sorted(clash)}")
    return kept[:first] + list(entries) + kept[first:]


def spread(items, n):
    """`n` items spread evenly through `items`, first and last included: the spot-check sample."""
    if n >= len(items):
        return list(items)
    if n == 1:
        return [items[0]]
    return [items[round(i * (len(items) - 1) / (n - 1))] for i in range(n)]
