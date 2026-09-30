import sys, json
from engine import load_library, plan, render
from melody import load_catalog
from evaluate import evaluate
lib = load_library()
variety = '--variety' in sys.argv
for c, m in load_catalog():
    T, asg = plan(m, lib, variety=variety)
    audio, ev = render(m, lib, asg, tune=1.0, bpm=m.bpm)
    r = evaluate(audio, m, ev, m.bpm); r.pop('per_note')
    shifts = [abs(a.shift_semitones) for a in asg]
    print(f"{c['id']:12s} T={T:+d} notes={r['notes']:3d} in50c={r['within_50c_pct']:3d}% med={r['median_abs_cents']:5.1f}c onTime={r['onsets_on_time_pct']}% reatk={r['notes_with_retrigger']} recs={r['distinct_recordings']} maxShift={max(shifts):.1f}")
