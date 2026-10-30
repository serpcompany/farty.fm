"""Fart-only melody engine (proof).

Every sample in the output is a Recording's own waveform, played raw (ADR 0012): at its own
pitch and speed. The only operations are: trim the silence before and after the fart (every
burst kept, ADR 0016, and its quiet lead-in played before the beat, #287), cut at the note's
end, fade in/out, gain, and mixing. Nothing changes a fart's pitch or length: there is no
resampling, oscillator, filter-resonator, looping, or granular re-triggering anywhere.
Recording Analysis still reads each fart back with its pitch held (variable_resample()) to
decide whether it is Melodic and when it settles; no Song plays that read-back.
"""
import json
import math
from dataclasses import asdict, dataclass, field, replace
from pathlib import Path

import librosa
import numpy as np
import scipy.signal as sps
from scipy.ndimage import median_filter
from scipy.optimize import linear_sum_assignment

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "fixtures/recordings/manifest.json"
AUDIO_DIR = ROOT / "fixtures/recordings"
SR = 44100
HOP = 256
GAP_S = 0.025  # silence between consecutive notes (articulation)
MIN_PITCH_CONF = 0.2  # loose on purpose: audition() is the real gate (#208 raised it from 0.1)
FAR_FROM_CENTER = 6.0  # semitones: contour frames farther than this from the gesture's center are dropped (#208)


# ---------------------------------------------------------------- Recording Analysis


@dataclass
class Source:
    id: str
    cut_at_reattack: bool  # the take holds a second burst, so the pitch is read from the first only
    audio: np.ndarray  # the fart as Songs play it, every burst, silence trimmed (onset-aligned), mono float
    f0: np.ndarray  # per-hop smoothed f0 in Hz (nan = unvoiced) over the first burst (`pitch_audio`)
    ref_midi: float | None  # the pitch a listener hears in the first part of the sound
    pitch_confidence: float  # 0..1
    rms_db: float
    min_note_s: float = 0.0  # shortest note this Recording reads back on-pitch
    settle_s: float = 0.0  # when its played pitch settles within 50 cents of ref_midi (settle_time())
    start: int = 0  # the fart's start, in samples of the decoded original file
    end: int = 0  # the fart's end (exclusive), where it fades out, in samples of the decoded original file
    pitch_estimate: float | None = None  # ref_midi before audition() (kept when audition rejects it)
    pitch_end: int = 0  # the first burst's end (exclusive), in samples of the decoded original file
    # the fart's quiet lead-in: the sound joined to its attack, up to `start` (lead_in_start()),
    # which Songs play before the note's beat so the attack still lands on it (#287); empty when
    # the fart opens loud
    lead_in: np.ndarray = field(default_factory=lambda: np.zeros(0))

    @property
    def pitched(self):
        return self.ref_midi is not None

    @property
    def seconds(self):
        """The fart's own length, as Songs play it: the length rule and Auto-map's costs."""
        return len(self.audio) / SR

    @property
    def pitch_audio(self):
        """The first burst, which Recording Analysis reads the pitch from (ADR 0016)."""
        return self.audio[: max(0, self.pitch_end - self.start)]


def note_segment(y):
    """Find the fart in a Recording, and its first burst.

    start:     just before the level first gets within 12 dB of its peak, so slow swells don't
               make the note sound late.
    end:       where the sound fades out: after the last 50 ms level within 30 dB of the peak.
               Songs play the fart from start to here, every burst included (ADR 0016).
    pitch_end: the first clear re-attack (the level dips more than 6 dB below its running
               maximum, then rises more than 4 dB, more than 60 ms in); otherwise `end`.
               Recording Analysis reads the pitch from start to here only, so a second burst at
               another pitch doesn't blur it (ADR 0016). Until ADR 0016 Songs stopped here too.
    Returns (start, end, pitch_end, cut_at_reattack).
    """
    hop = int(0.005 * SR)
    fine = 20 * np.log10(librosa.feature.rms(y=y, frame_length=2 * hop, hop_length=hop)[0] + 1e-9)
    # 50 ms window: fast flutter (the 'brrrr' texture, > ~15 Hz) is smoothed away, so only
    # slow, clearly audible re-attacks (separate 'pft ... pft') count.
    db = 20 * np.log10(librosa.feature.rms(y=y, frame_length=10 * hop, hop_length=hop)[0] + 1e-9)
    peak = fine.max()
    a0 = int(np.argmax(fine >= peak - 12))
    start = max(0, a0 * hop - int(0.008 * SR))
    active = np.where(db > db.max() - 30)[0]
    end_i = active[-1] + 1
    run_max, dip_i, reattack_at = db[a0], None, None
    for i in range(a0 + 1, end_i):
        if db[i] > run_max and dip_i is None:
            run_max = db[i]
        if db[i] < run_max - 6:
            if dip_i is None or db[i] < db[dip_i]:
                dip_i = i
        if dip_i is not None and db[i] > db[dip_i] + 4 and (i - a0) * hop > 0.06 * SR:
            reattack_at = dip_i
            break
    end = min(len(y), end_i * hop + hop)
    pitch_end = min(end, reattack_at * hop + hop) if reattack_at is not None else end
    return start, end, pitch_end, reattack_at is not None


LEAD_IN_DB = 30.0  # sound: a 5 ms level within this of the peak, as note_segment()'s end (#287)
LEAD_IN_GAP_S = 0.05  # a quieter gap this long or shorter is kept inside the lead-in
LEAD_IN_MAX_S = 0.25  # the longest lead-in: 009's 0.215 s G3 opening, and no more room noise


def lead_in_start(y, start):
    """Where the fart's lead-in begins (#287): the sound joined to its attack. From note_segment()'s
    attack frame (the first 5 ms level within 12 dB of the peak), it walks back over every 5 ms
    level within LEAD_IN_DB of the peak and over gaps below that of up to LEAD_IN_GAP_S, and starts
    8 ms before the earliest such level, as `start` does before the attack. A sound before a
    longer gap isn't the fart's: on the owner's room-noisy phone takes (105-110, #295) it's room
    noise, up to 2 s of it. The lead-in is at most LEAD_IN_MAX_S, for a room loud enough to join
    its noise to the attack. Songs play the stretch from here to `start` before the note's beat.
    Never after `start`."""
    hop = int(0.005 * SR)
    fine = 20 * np.log10(librosa.feature.rms(y=y, frame_length=2 * hop, hop_length=hop)[0] + 1e-9)
    peak = fine.max()
    attack = int(np.argmax(fine >= peak - 12))
    first, below = attack, 0
    for i in range(attack - 1, -1, -1):
        if fine[i] >= peak - LEAD_IN_DB:
            first, below = i, 0
        else:
            below += 1
            if below > round(LEAD_IN_GAP_S / 0.005):
                break
    return min(start, max(0, first * hop - int(0.008 * SR), start - int(LEAD_IN_MAX_S * SR)))


def weighted_median(mids, w):
    """The pitch below which half the weight lies."""
    order = np.argsort(mids)
    cw = np.cumsum(w[order]) / w.sum()
    return mids[order][np.searchsorted(cw, 0.5)]


def analyze_recording(rid, y):
    start, end, pitch_end, cut_at_reattack = note_segment(y)
    fart = y[start:end].astype(np.float64)
    lead_in = y[lead_in_start(y, start) : start].astype(np.float64)
    body = fart[: pitch_end - start]  # the first burst: the pitch is read from it alone

    # Every frame pYIN calls voiced, attack included. A voiced-probability gate on top (0.05
    # until #208) dropped most attacks, so the renderer bent each note in from the attack's pitch.
    f0, voiced, _ = librosa.pyin(body, fmin=45, fmax=900, sr=SR, frame_length=2048, hop_length=HOP)
    f0 = np.where(voiced, f0, np.nan)
    frame_rms = librosa.feature.rms(y=body, frame_length=2048, hop_length=HOP)[0][: len(f0)]
    # smooth pitch contour and drop isolated blips
    finite = np.isfinite(f0)
    if finite.sum() >= 3:
        m = librosa.hz_to_midi(np.where(finite, f0, 1.0))
        m = np.where(finite, median_filter(np.where(finite, m, 0), size=5), np.nan)
        m = np.where(np.isfinite(m) & (m > 10), m, np.nan)
        # drop octave errors and glide tails, which the renderer would bend toward
        kept = np.isfinite(m)
        if kept.sum() >= 3:
            center = weighted_median(m[kept], frame_rms[kept])
            m = np.where(np.abs(m - center) > FAR_FROM_CENTER, np.nan, m)
        f0 = librosa.midi_to_hz(m)
    # reference pitch: energy-weighted median of voiced frames in the first 450 ms
    head = min(len(f0), int(0.45 * SR / HOP))
    v = np.isfinite(f0[:head])
    coverage = v.sum() / max(1, head if len(body) > 0.45 * SR else len(f0))
    ref_midi, conf = None, 0.0
    if v.sum() >= 4:
        mids = librosa.hz_to_midi(f0[:head][v])
        w = frame_rms[:head][v]
        med = weighted_median(mids, w)
        spread = np.median(np.abs(mids - med))
        conf = float(np.clip(coverage, 0, 1) * np.clip(1 - spread / 3, 0, 1))
        if conf >= MIN_PITCH_CONF:
            ref_midi = float(med)
    src = Source(
        id=rid,
        cut_at_reattack=cut_at_reattack,
        audio=fart,
        f0=f0,
        ref_midi=ref_midi,
        pitch_confidence=round(conf, 2),
        rms_db=float(20 * np.log10(np.sqrt(np.mean(fart**2)) + 1e-9)),
        start=start,
        end=end,
        pitch_estimate=ref_midi,
        pitch_end=pitch_end,
        lead_in=lead_in,
    )
    if src.pitched:
        src.min_note_s = audition(src)
        if src.min_note_s is None:  # never reads back on pitch: not melodic after all
            src.ref_midi = None
        else:
            src.settle_s = settle_time(src)
    return src


def audition(src):
    """Read the Recording back with its pitch held on ref_midi (variable_resample()) for a few
    note lengths. Returns the shortest note length (s) that still reads within 40 cents, or
    None. Catches farts whose pitch only settles after the attack. Songs play farts raw since
    ADR 0012; this read-back stayed as it was, so Melodic Recordings and Auto-map's picks did.
    It reads the first burst only (pitch_audio), where the pitch was read (ADR 0016)."""
    body = src.pitch_audio
    seconds = len(body) / SR
    for length in (0.12, 0.2, 0.35, 0.6):
        n = int(min(length, seconds) * SR)
        seg = variable_resample(body, src.f0, n, src.ref_midi)
        f0, voiced, _ = librosa.pyin(seg, fmin=45, fmax=900, sr=SR, frame_length=2048, hop_length=HOP)
        f = f0[voiced & np.isfinite(f0)]
        if len(f) >= 2 and abs(np.median(librosa.hz_to_midi(f)) - src.ref_midi) * 100 <= 40:
            return length
        if length >= seconds:
            break
    return None


SETTLE_CENTS = 50.0  # "on pitch", as evaluate.py counts a note
SETTLE_RUN_FRAMES = 9  # 9 hops = 52 ms in a row on pitch


def heard_cents(src):
    """The first burst (pitch_audio) read back with its pitch held (as audition() does) by
    pYIN: cents from ref_midi per hop, nan where unvoiced."""
    body = src.pitch_audio
    seg = variable_resample(body, src.f0, len(body), src.ref_midi)
    f0, voiced, _ = librosa.pyin(seg, fmin=45, fmax=900, sr=SR, frame_length=2048, hop_length=HOP)
    ok = voiced & np.isfinite(f0)
    return np.where(ok, (librosa.hz_to_midi(np.where(ok, f0, 1.0)) - src.ref_midi) * 100, np.nan)


def settle_time(src):
    """Seconds from the fart's start until the Recording, played at its own pitch, is on pitch
    and stays there: the first pYIN frame (centered at frame x 256 samples) that starts
    SETTLE_RUN_FRAMES voiced frames in a row within SETTLE_CENTS of ref_midi, over the first
    burst (heard_cents()). The first burst's whole length if that never happens. Glides, scoops
    and slow starts that the pitch-held read-back can't straighten show up here."""
    heard = heard_cents(src)
    seconds = len(src.pitch_audio) / SR
    on = np.abs(np.nan_to_num(heard, nan=np.inf)) <= SETTLE_CENTS
    for i in range(len(on) - SETTLE_RUN_FRAMES + 1):
        if on[i : i + SETTLE_RUN_FRAMES].all():
            return min(seconds, i * HOP / SR)
    return seconds


def load_library(ids=None):
    manifest = json.loads(MANIFEST.read_text())["recordings"]
    lib = []
    for r in manifest:
        if ids and r["id"] not in ids:
            continue
        y, _ = librosa.load(AUDIO_DIR / r["filename"], sr=SR, mono=True)
        lib.append(analyze_recording(r["id"], y))
    return lib


# ---------------------------------------------------------------- Melody Fit planning

MAX_SHIFT = 3.0  # semitones a note may be from its Recording's pitch (ADR 0004) ...
OCTAVE = 12.0  # ... or from the same note an octave up or down, with an Octave Move (ADR 0006)
OCTAVE_MOVE_COST = 6.0  # per beat, on top of the remaining distance: more than any closer note (3^1.5 = 5.2)
TOO_SHORT_COST = 8.0  # per note that sounds too briefly for the Recording to settle on its pitch ...
TOO_SHORT_COST_PER_S = 400.0  # ... plus this per second it falls short (4 per 10 ms)
TIE = 1e-9  # Arrangement costs this close are equal
TRANSPOSITIONS = range(-36, 25)
PLACED_MIN_NOTE_S = 0.6  # the shortest note a Placed Recording counts as reading back on (ADR 0015)


def placed(src, midi):
    """A Noise-like Recording placed on `midi` by ear (ADR 0015), as melody_fit() reads it: a
    Melodic Recording whose Recording Pitch is that note. Nothing measured its pitch, so its
    shortest note is audition()'s longest length, the slowest a Melodic Recording reads back
    on, and it counts as settled from its start. render() plays it raw, like any fart: the note
    is where it goes, never a pitch shift. The web's `placedAutoMapRecording()` makes the same."""
    if src.pitched:
        raise ValueError(f"{src.id} is Melodic: only a Noise-like Recording is placed by ear")
    return replace(src, ref_midi=float(midi), min_note_s=PLACED_MIN_NOTE_S, settle_s=0.0)


def too_short_cost(note_seconds, recording_seconds, shortest_note_s):
    """Cost of the notes a Recording plays too briefly to settle on its pitch.

    A note sounds for its own length (minus the gap before the next note) or for the
    Recording's own length, whichever is shorter: Songs play farts raw, at their own speed
    (ADR 0012). Below the Recording's shortest note (`audition()`), each note costs
    TOO_SHORT_COST plus TOO_SHORT_COST_PER_S per second it falls short.
    """
    cost = 0.0
    for a in note_seconds:
        sounds = min(a, recording_seconds)
        if sounds < shortest_note_s:
            cost += TOO_SHORT_COST + TOO_SHORT_COST_PER_S * (shortest_note_s - sounds)
    return cost


UNSETTLED_COST = 20.0  # per note played entirely before its Recording settles; less for part of it (#92)


def unsettled_cost(note_seconds, recording_seconds, settle_s):
    """Cost of the share of each note a Recording plays before its pitch settles (#92).

    A note sounds for min(its length, the Recording's own length), as in too_short_cost().
    The Recording settles settle_s (settle_time()) after it starts.
    Each note costs UNSETTLED_COST x the share of its sounding time that comes before that: a
    short note on a slow-settling fart costs up to UNSETTLED_COST, the same fart on a long note
    costs little. Picked from 15, 20, 30, 40, 80 and 160 (and per-second forms) by renders
    passing; 40 and above make a full-library Song worse.
    """
    cost = 0.0
    for a in note_seconds:
        sounds = min(a, recording_seconds)
        cost += UNSETTLED_COST * min(sounds, settle_s) / max(1e-9, sounds)
    return cost


SILENT_COST_PER_S = 30.0  # per second of a note its Recording leaves silent (#205)


def silent_cost(note_seconds, recording_seconds):
    """Cost of the part of each note a Recording is too short to fill (#205).

    A note sounds for min(its length, the Recording's own length), as in too_short_cost();
    the rest of it is silence. Each second of that costs SILENT_COST_PER_S, so a long note
    prefers a long Recording. Picked from 0, 10, 20, 30, 40, 60 and 80 on the 12 app Songs with
    the Fixture Library: every value keeps all 12 passing with no Octave Move notes, and 30 is
    the smallest that plays Happy Birthday's last half note in full (0.41 to 1.18 s). Above 30
    sounding time gains little (90.0% to at most 93.2%) and single Songs lose on-pitch time:
    amazing 90 to 83% from 40 up, row 90 to 88% from 40 up, and frere 95 to 81% at 80.
    """
    return SILENT_COST_PER_S * sum(max(0.0, a - recording_seconds) for a in note_seconds)


NOTE_FILL = 1.0  # a Recording covers a pitch only if it lasts this share of the pitch's longest note (#221)


def fills(recording_seconds, longest_note_s):
    """Whether a Recording is long enough to cover a pitch: the length rule of unlocking (#221).

    The Recording's own length must be at least NOTE_FILL x the longest slot among the pitch's
    notes, each slot being the note's written length less GAP_S. Songs play farts raw (ADR
    0012), so an Octave Move no longer halves or doubles a fart's length. Stretching, looping or
    re-triggering a Recording to fill a note is never done (ADR 0004), so without this rule a
    short fart unlocked a Song and left most of a long note silent.

    NOTE_FILL was chosen by measurement (ADR 0011): 0.75, 0.9 and 1.0 swept on the 12 app Songs
    and the 129 catalog Songs with the full Fixture Library (32 Recordings). 1.0 is the only one
    that keeps every unlocked app Song at ADR 0004's bar. At 0.9 and 0.75 Fur Elise reads 91%
    within 50 cents: its G2 (score 71, at T=-28) has a 1.066 s note, so the gate moves it from
    019 (0.33 s) to 069 (1.17 s at G2), whose attack reads +243 cents on the 0.25 s notes of that
    pitch. At 1.0 069 still fills G2, but score 69's 1.339 s note is too long for 022 (1.32 s at
    F2), so 69 takes 032 with an Octave Move, and 022 goes to G2, beating 069 on cost. The Song
    reads 100% through the cost ranking, not because the gate excludes 069. Amazing Grace locks
    from 0.9 up: its 2.98 s note is longer than any Recording can last, even moved down an
    octave. See ADR 0011 for the table. That sweep measured lengths after resampling, which
    Songs no longer do (ADR 0012).
    """
    return recording_seconds >= NOTE_FILL * longest_note_s


def needed_seconds(longest_note_s):
    """The shortest Recording that covers a pitch whose longest slot is `longest_note_s`:
    NOTE_FILL x the slot, rounded up to 0.1 s ("Needs a fart near F3 (1.2 s)").
    The 1e-9 keeps float noise from adding 0.1 s to an exact tenth."""
    return math.ceil(NOTE_FILL * longest_note_s * 10 - 1e-9) / 10


@dataclass
class Assignment:
    note_index: int
    source_id: str
    target_midi: int
    shift_semitones: float  # target_midi minus the Recording Pitch; the fart plays unshifted (ADR 0012)


def move_cost(shift, octave_moves=True):
    """Cost per beat of a note `shift` semitones from the Recording Pitch, and whether that is
    an Octave Move. None when the unlock rule doesn't allow it. Songs play the fart unshifted
    (ADR 0012), so `shift` is how far the note is from the fart's pitch, and an Octave Move
    plays the fart an octave from its note.

    Octave Moves go up or down on equal terms. Allowing only up, or down only as a last
    resort, unlocked fewer Songs or passed the render checks less often (ADR 0006)."""
    a = abs(shift)
    if a <= MAX_SHIFT:
        return a**1.5, False
    if octave_moves and abs(a - OCTAVE) <= MAX_SHIFT:
        return OCTAVE_MOVE_COST + abs(a - OCTAVE) ** 1.5, True
    return None


@dataclass
class Fit:
    """Melody Fit: which Melodic Recording plays each distinct Song pitch, and its cost.

    Arrangements compare by (uncovered pitches, Octave Moves, cost), smallest first: as much
    Pitch Coverage as possible, then as few Octave Moves as that allows, then the closest
    shifts. Costs within TIE are equal; then the Recording ids read in ascending Song pitch
    order (uncovered last) decide, then the lower transposition."""

    transpose: int
    recording_for_pitch: dict  # Song pitch -> Recording id, or None when no Recording covers it
    octave_moves: int
    cost: float  # over covered pitches: beats x move_cost + too_short, unsettled and silent costs of its notes
    longest_note_s: dict = field(default_factory=dict)  # Song pitch -> its longest slot in seconds

    @property
    def covered(self):
        return sum(r is not None for r in self.recording_for_pitch.values())

    @property
    def total(self):
        return len(self.recording_for_pitch)

    @property
    def unlocked(self):
        return self.covered == self.total

    @property
    def missing(self):
        """The notes no Recording covers, as (MIDI after transposition, seconds): the shortest
        Recording near that note that would cover it (needed_seconds()), lowest note first."""
        return [
            (p + self.transpose, needed_seconds(self.longest_note_s[p]))
            for p, r in sorted(self.recording_for_pitch.items())
            if r is None
        ]


def melody_fit(melody, sources, transpose=None, octave_moves=True):
    """Pitch Coverage and Auto-map in one search (ADR 0004, ADR 0006).

    Like a multi-sampled instrument: each distinct Song pitch gets its own Melodic Recording
    (one to one, never reused), at most 3 semitones from the note, or with an Octave Move at
    most 3 semitones from the same note an octave away. Every transposition from -36 to +24 is
    tried. A Recording also has to last at least as long as the pitch's longest note (fills(),
    ADR 0011). A Song is unlocked when every pitch is covered under the best transposition.
    `octave_moves=False` gives ADR 0004's rule without Octave Moves, for comparison.
    """
    pitched = sorted((s for s in sources if s.pitched), key=lambda s: s.id)
    pitches = sorted({n.pitch for n in melody.notes})
    spb = 60 / melody.bpm
    weight = {p: sum(n.dur for n in melody.notes if n.pitch == p) for p in pitches}
    note_seconds = {p: [n.dur * spb - GAP_S for n in melody.notes if n.pitch == p] for p in pitches}
    longest = {p: max(note_seconds[p]) for p in pitches}

    def cells(t):  # cells[i][j]: (Octave Move?, cost) of pitch i on Recording j, or None
        out = []
        for p in pitches:
            row = []
            for s in pitched:
                shift = p + t - s.ref_midi
                m = move_cost(shift, octave_moves)
                if m is None or not fills(s.seconds, longest[p]):
                    row.append(None)
                else:
                    row.append((m[1], weight[p] * m[0] + too_short_cost(note_seconds[p], s.seconds, s.min_note_s)
                                + unsettled_cost(note_seconds[p], s.seconds, s.settle_s)
                                + silent_cost(note_seconds[p], s.seconds)))
            out.append(row)
        return out

    def key(table, choice):  # exact (uncovered, Octave Moves, cost), summed in pitch order
        uncovered = octaves = 0
        cost = 0.0
        for row, j in zip(table, choice):
            if j is None:
                uncovered += 1
            else:
                octaves += row[j][0]
                cost += row[j][1]
        return uncovered, octaves, cost

    def solve(table, fixed=()):
        """Best choice for the pitches after `fixed` (Recording indexes or None, in pitch
        order), as one assignment problem: penalties larger than any cost make it minimise
        uncovered pitches first, then Octave Moves, then cost."""
        rows = table[len(fixed) :]
        cols = [j for j in range(len(pitched)) if j not in fixed]
        bound = sum(max((c[1] for c in row if c is not None), default=0.0) for row in rows)
        octave_penalty = 1.0 + bound
        uncovered_penalty = (len(rows) + 1) * octave_penalty
        C = np.full((len(rows), len(cols) + len(rows)), np.inf)
        for i, row in enumerate(rows):
            for k, j in enumerate(cols):
                if row[j] is not None:
                    C[i, k] = row[j][1] + (octave_penalty if row[j][0] else 0.0)
            C[i, len(cols) + i] = uncovered_penalty  # this pitch stays uncovered
        choice = list(fixed)
        if rows:
            r, c = linear_sum_assignment(C)
            picked = dict(zip(r, c))
            choice += [cols[picked[i]] if picked[i] < len(cols) else None for i in range(len(rows))]
        return key(table, choice), choice

    tables = {t: cells(t) for t in ([transpose] if transpose is not None else TRANSPOSITIONS)}
    best = {t: solve(table)[0] for t, table in tables.items()}
    top = min(k[:2] for k in best.values())
    low = min(k[2] for k in best.values() if k[:2] == top)

    def optimal(k):
        return k[:2] == top and k[2] <= low + TIE

    def smallest_ids(table):  # the lexicographically smallest optimal choice, uncovered last
        fixed = []
        for i in range(len(pitches)):
            for j in sorted(set(range(len(pitched))) - set(fixed), key=lambda j: pitched[j].id) + [None]:
                if j is not None and table[i][j] is None:
                    continue
                if optimal(solve(table, fixed + [j])[0]):
                    fixed.append(j)
                    break
        return fixed

    fits = []
    for t, k in best.items():
        if optimal(k):
            choice = smallest_ids(tables[t])
            ids = tuple(pitched[j].id if j is not None else "￿" for j in choice)
            fits.append((ids, t, choice))
    _, t, choice = min(fits)
    _, octaves, cost = key(tables[t], choice)
    return Fit(
        transpose=t,
        recording_for_pitch={p: (pitched[j].id if j is not None else None) for p, j in zip(pitches, choice)},
        octave_moves=octaves,
        cost=float(cost),
        longest_note_s=longest,
    )


class SongLocked(ValueError):
    """The Recordings don't cover every pitch of the Song, so it can't be played."""

    def __init__(self, fit):
        super().__init__(f"{fit.covered} of {fit.total} notes covered")
        self.fit = fit


def plan(melody, sources, transpose=None, with_cost=False):
    """Choose a key (transposition) and a Recording for each note of an Unlocked Song.

    Every note of a Song pitch uses that pitch's Recording, so the same note always sounds
    the same. Raises SongLocked when the Song isn't unlocked. `with_cost=True` also returns
    the Arrangement's cost (used by the golden export).
    """
    fit = melody_fit(melody, sources, transpose)
    if not fit.unlocked:
        raise SongLocked(fit)
    ref = {s.id: s.ref_midi for s in sources}
    out = []
    for i, n in enumerate(melody.notes):
        target = n.pitch + fit.transpose
        rid = fit.recording_for_pitch[n.pitch]
        out.append(Assignment(i, rid, target, round(target - ref[rid], 2)))
    return (fit.transpose, out, fit.cost) if with_cost else (fit.transpose, out)


# ---------------------------------------------------------------- Rendering


def variable_resample(x, f0, out_len, ref_midi):
    """Recording Analysis's read-back (audition(), heard_cents()): read `x` at a rate that
    follows its own pitch contour `f0`, so it holds steady on `ref_midi`. Songs never play
    this: since ADR 0012 they play each fart raw (render()).
    """
    n_hops = len(f0)
    hop_rate = np.full(n_hops, 1.0)
    if ref_midi is not None:
        m = librosa.hz_to_midi(np.where(np.isfinite(f0), f0, 1.0))
        dev = np.where(np.isfinite(f0), ref_midi - m, np.nan)  # semitones to pull toward ref
        idx = np.arange(n_hops)
        ok = np.isfinite(dev)
        if ok.sum() >= 2:
            dev = np.interp(idx, idx[ok], dev[ok])
            dev = np.clip(dev, -5, 5)
            hop_rate = 2 ** (dev / 12)
    # anti-alias when reading faster than 1x
    if hop_rate.max() > 1.02:
        b, a = sps.butter(8, min(0.95, 0.9 / hop_rate.max()), btype="low")
        x = sps.filtfilt(b, a, x)
    pos = np.zeros(out_len)
    p = 0.0
    for i in range(out_len):
        if p >= len(x) - 2:
            return _cubic_read(x, pos[:i])
        pos[i] = p
        p += hop_rate[min(n_hops - 1, int(p / HOP))]
    return _cubic_read(x, pos)


def _cubic_read(x, pos):
    i = np.floor(pos).astype(int)
    f = pos - i
    xm1 = x[np.clip(i - 1, 0, len(x) - 1)]
    x0 = x[np.clip(i, 0, len(x) - 1)]
    x1 = x[np.clip(i + 1, 0, len(x) - 1)]
    x2 = x[np.clip(i + 2, 0, len(x) - 1)]
    c1 = 0.5 * (x1 - xm1)
    c2 = xm1 - 2.5 * x0 + 2 * x1 - 0.5 * x2
    c3 = 0.5 * (x2 - xm1) + 1.5 * (x0 - x1)
    return ((c3 * f + c2) * f + c1) * f + x0


def render(melody, sources, assignments, bpm=None, gap_ms=GAP_S * 1000, accent_db=1.5, target_rms_db=-20):
    """Play each note's fart raw (ADR 0012): the Recording's fart from its start, every burst
    included (ADR 0016), at its own pitch and speed, cut at the note's end (its written length less the gap, at least 60 ms) or
    where the fart ends, faded, set to a level and mixed. A note that starts on one of the score's
    bar lines (melody.bar_lines) is set accent_db louder. A note's shift_semitones isn't used.

    The fart's attack lands on the note's beat. Its quiet lead-in (Source.lead_in) plays just
    before it, in the rest before the note: as far back as it reaches, but never before the notes
    before it end as written or stop playing, nor before the Song's start (#287). So it never fills
    the gap between two notes and is never mixed over another fart: a lead-in in the gap hid the
    next attack from the onset check on 5 of 7 libraries with 009 placed by ear. The level is
    still set from the attack on.
    An event's start_s is its beat, len_s the length from there and lead_s the lead-in played."""
    by_id = {s.id: s for s in sources}
    bpm = bpm or melody.bpm
    spb = 60 / bpm
    total = int((melody.length_beats * spb + 1.0) * SR)
    mix = np.zeros(total)
    events = []
    played_to = 0  # where the notes placed so far end as written or stop playing, in samples
    for a in sorted(assignments, key=lambda a: melody.notes[a.note_index].start):
        n = melody.notes[a.note_index]
        s = by_id[a.source_id]
        start = int(n.start * spb * SR)
        max_len = int(max(0.06, n.dur * spb - gap_ms / 1000) * SR)
        body = s.audio[:max_len]
        lead = min(len(s.lead_in), max(0, start - played_to))
        seg = np.concatenate([s.lead_in[len(s.lead_in) - lead :], body])
        fi, fo = int(0.003 * SR), int(min(0.03, len(body) / SR / 3) * SR)
        env = np.ones(len(seg))
        env[:fi] = np.linspace(0, 1, fi)
        if fo > 0:
            env[-fo:] *= np.linspace(1, 0, fo) ** 2
        seg = seg * env
        rms = np.sqrt(np.mean(seg[lead : lead + int(0.25 * SR)] ** 2)) + 1e-9
        on_downbeat = any(abs(n.start - line) < 1e-6 for line in melody.bar_lines)  # the score's own (melody.py)
        gain_db = target_rms_db - 20 * np.log10(rms) + (accent_db if on_downbeat else 0)
        seg = seg * 10 ** (gain_db / 20)
        mix[start - lead : start + len(body)] += seg
        played_to = max(played_to, start + len(body), int((n.start * spb + n.dur * spb) * SR))  # as the port sums seconds
        events.append(
            {
                **asdict(a),
                "start_s": round(start / SR, 3),
                "len_s": round(len(body) / SR, 3),
                "gain_db": round(gain_db, 1),
                "lead_s": round(lead / SR, 3),
            }
        )
    peak = np.abs(mix).max()
    mix = np.tanh(mix / peak * 1.2) / np.tanh(1.2) * 0.89  # gentle limiter, -1 dBFS peak
    return mix, events


# ---------------------------------------------------------------- Naive baseline (for contrast)


def render_naive(melody, sources, bpm=None):
    """What 'place raw recordings on notes' does without analysis: file start on the beat,
    no trimming, no pitch. Kept only to show why the melody disappears."""
    manifest = {r["id"]: r for r in json.loads(MANIFEST.read_text())["recordings"]}
    spb = 60 / (bpm or melody.bpm)
    mix = np.zeros(int((melody.length_beats * spb + 2) * SR))
    ids = [s.id for s in sources]
    for i, n in enumerate(melody.notes):
        y, _ = librosa.load(AUDIO_DIR / manifest[ids[i % len(ids)]]["filename"], sr=SR, mono=True)
        y = y[: int(n.dur * spb * SR)]
        st = int(n.start * spb * SR)
        mix[st : st + len(y)] += y / (np.abs(y).max() + 1e-9) * 0.3
    return mix / np.abs(mix).max() * 0.89
