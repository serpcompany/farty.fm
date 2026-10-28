from librosa import midi_to_note
from engine import load_library, melody_fit, plan, render
from melody import load_catalog
from evaluate import bar_problems, evaluate
lib = load_library()
for c, m in load_catalog():
    fit = melody_fit(m, lib)
    if not fit.unlocked:
        needs = " ".join(f"{midi_to_note(p)} ({s:.1f} s)" for p, s in fit.missing)
        print(f"{c['id']:12s} T={fit.transpose:+d} locked: {fit.covered} of {fit.total} notes covered, needs {needs}")
        continue
    T, asg = plan(m, lib)
    audio, ev = render(m, lib, asg, bpm=m.bpm)
    r = evaluate(audio, m, ev, m.bpm, lib); r.pop('per_note')
    problems = bar_problems(r)
    print(f"{c['id']:12s} T={T:+d} notes={r['notes']:3d} in50cFart={r['within_50c_of_fart_pct']:3d}% onTime={r['onsets_on_time_pct']}% reatk={r['notes_with_retrigger']} {'FAIL: ' + '; '.join(problems) if problems else 'PASS'} | in50c={r['within_50c_pct']:3d}% med={r['median_abs_cents']:5.1f}c contour={r['contour_pct']}% recs={r['distinct_recordings']} octaveMoves={fit.octave_moves} sounding={r['sounding_pct']}% mostlySilent={r['notes_mostly_silent']}")
