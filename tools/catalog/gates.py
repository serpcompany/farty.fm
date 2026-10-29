import librosa
import mido

import pdmx
from dataset import file_hash
from engine import melody_fit, plan, render
from evaluate import bar_problems, evaluate
from melody import load_midi

GATES = ("license", "hash", "sanity", "render")


def score_url(sid):
    return f"https://musescore.com/score/{sid}"


def score_meta(path):
    mid = mido.MidiFile(path)
    tempos, meters = {0.0: 120.0}, {0.0: (4, 4)}
    for track in mid.tracks:
        tick = 0
        for msg in track:
            tick += msg.time
            if msg.type == "set_tempo":
                tempos[tick / mid.ticks_per_beat] = 60_000_000 / msg.tempo
            elif msg.type == "time_signature":
                meters[tick / mid.ticks_per_beat] = (msg.numerator, msg.denominator)
    return sorted(tempos.items()), [(at, *m) for at, m in sorted(meters.items())]


def score_notes(path):
    mid = mido.MidiFile(path)
    notes = []
    for track in mid.tracks:
        tick, sounding = 0, {}
        for msg in track:
            tick += msg.time
            if msg.type == "note_on" and msg.velocity > 0:
                sounding.setdefault((msg.channel, msg.note), []).append(tick)
            elif msg.type in ("note_on", "note_off") and sounding.get((msg.channel, msg.note)):
                start = sounding[(msg.channel, msg.note)].pop(0)
                notes.append((start / mid.ticks_per_beat, tick / mid.ticks_per_beat))
    return sorted(notes)


def new_result(match, row):
    sid = pdmx.score_id(row)
    return {
        "score_id": sid,
        "url": score_url(sid),
        "score_title": row["title"],
        "match": match,
        "rating": row["rating"],
        "n_ratings": row["n_ratings"],
        "n_views": row["n_views"],
        "license": row["license"],
        "n_tracks": row["n_tracks"],
        "dataset_path": row["mid"],
        "gates": {},
        "passed": False,
    }


def failed(result, name, problems):
    result["gates"][name] = problems or "pass"
    return bool(problems)


def import_excerpt(title, midi):
    whole = load_midi(midi)
    tempos, meters = score_meta(midi)
    options = pdmx.render_options(tempos, meters, first_onset=whole.notes[0].start)
    melody = load_midi(midi, title=title.title, **options)
    padded = pdmx.padded_pickup_problems(meters, score_notes(midi), whole.notes[0].start)
    return whole, options, melody, padded


def sanity_gate(result, title, midi):
    try:
        whole, options, melody, padded = import_excerpt(title, midi)
    except Exception as e:
        failed(result, "sanity", [f"the MIDI file doesn't import: {type(e).__name__}: {e}"])
        return None
    report = {k: v for k, v in melody.report.items() if k != "source_file"}
    pitches = [n.pitch for n in melody.notes]
    result.update(
        render=options,
        import_report=report,
        track_notes=len(whole.notes),
        range_semitones=max(pitches) - min(pitches) if pitches else None,
        distinct_pitches=len(set(pitches)),
    )
    sanity = pdmx.sanity_problems(
        pitches, report["chord_tones_dropped"], report["inner_voice_onsets_dropped"], len(whole.notes)
    ) + padded
    return None if failed(result, "sanity", sanity) else melody


def render_gate(result, melody, library):
    fit = melody_fit(melody, library)
    result["pitch_coverage"] = f"{fit.covered} of {fit.total}"
    if not fit.unlocked:
        missing = " ".join(f"{librosa.midi_to_note(p)} ({s:.1f} s)" for p, s in fit.missing)
        failed(result, "render", [f"locked with the full Fixture Library: {fit.covered} of {fit.total} notes covered, needs {missing}"])
        return
    transpose, assignments = plan(melody, library)
    audio, events = render(melody, library, assignments, bpm=melody.bpm)
    metrics = evaluate(audio, melody, events, melody.bpm, library)
    metrics.pop("per_note")
    metrics.update(
        transpose=transpose,
        octave_moves=fit.octave_moves,
        max_abs_shift_semitones=max(abs(a.shift_semitones) for a in assignments),
    )
    result["metrics"] = metrics
    result["notes"] = [[n.start, n.dur, n.pitch] for n in melody.notes]
    result["passed"] = not failed(result, "render", bar_problems(metrics))


def gate(title, match, row, midi, member_sha256, archive, library):
    result = new_result(match, row)
    if failed(result, "license", pdmx.pick_problems(row)):
        return result
    result["sha256"] = member_sha256
    hashes = pdmx.hash_problems(archive["md5"], archive["published_md5"], member_sha256, file_hash(midi, "sha256"),
                                copy="the extracted file")
    if failed(result, "hash", hashes):
        return result
    melody = sanity_gate(result, title, midi)
    if melody is not None:
        render_gate(result, melody, library)
    return result


def summary_line(song_id, r):
    m = r.get("metrics")
    if m is None:
        return f"{song_id:24s} {r['score_id']:>9s} {'PASS' if r['passed'] else 'fail'}"
    return (
        f"{song_id:24s} {r['score_id']:>9s} {'PASS' if r['passed'] else 'fail'} T={m['transpose']:+d}"
        f" notes={m['notes']:3d} in50cFart={m['within_50c_of_fart_pct']:3d}% onTime={m['onsets_on_time_pct']}%"
        f" reatk={m['notes_with_retrigger']} | in50c={m['within_50c_pct']:3d}% med={m['median_abs_cents']:5.1f}c"
        f" contour={m['contour_pct']}% recs={m['distinct_recordings']} octaveMoves={m['octave_moves']}"
    )


def first_problem(r):
    for name in GATES:
        problems = r["gates"].get(name)
        if problems and problems != "pass":
            return f"{name}: {'; '.join(problems)}"
    return None


def not_tried(row, gate_name, problem):
    sid = pdmx.score_id(row)
    return {"score_id": sid, "url": score_url(sid), "score_title": row["title"],
            "gates": {gate_name: [problem]}, "passed": False}


def no_pick_reason(title, cands, others):
    new = pdmx.new_title_problems(title, others)
    if new:
        return "; ".join(new), []
    if not cands.eligible:
        return ("no PDMX score matches" if not cands.matched else "no matching PDMX score can be picked"), []
    return None, cands.eligible


def pick_scores(titles, found, others, tries, try_score, midi_dir):
    songs, picks, picked = [], [], {}
    for title, cands in zip(titles, found, strict=True):
        reason, eligible = no_pick_reason(title, cands, others)
        song = {"id": title.id, "title": title.title, "matched": cands.matched, "eligible": len(cands.eligible),
                "rejected": cands.rejected, "tried": [], "result": "fail", "reason": reason, "picked": None}
        songs.append(song)
        for match, row in eligible[:tries]:
            if row["mid"] in picked:
                r = not_tried(row, "license", f"already picked for {picked[row['mid']]} in this batch")
            else:
                r = try_score(title, match, row)
            song["tried"].append(r)
            print(summary_line(title.id, r) + ("" if r["passed"] else f"  {first_problem(r)}"), flush=True)
            if r["passed"]:
                picked[row["mid"]] = title.id
                picks.append((title, {**r, "row": row}, midi_dir / row["mid"]))
                break
        if song["tried"] and not song["reason"]:
            song["reason"] = None if song["tried"][-1]["passed"] else (
                f"none of the {len(song['tried'])} best scores passed; the best: {first_problem(song['tried'][0])}")
    return songs, picks
