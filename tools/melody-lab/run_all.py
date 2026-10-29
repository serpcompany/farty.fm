from librosa import midi_to_note

from analysis import load_library
from engine import melody_fit, plan, render
from evaluate import bar_problems, evaluate, metrics_line
from melody import load_catalog


def locked_line(c, fit):
    needs = " ".join(f"{midi_to_note(p)} ({s:.1f} s)" for p, s in fit.missing)
    return f"{c['id']:12s} T={fit.transpose:+d} locked: {fit.covered} of {fit.total} notes covered, needs {needs}"


def main():
    lib = load_library()
    for c, m in load_catalog():
        fit = melody_fit(m, lib)
        if not fit.unlocked:
            print(locked_line(c, fit))
            continue
        transpose, assignments = plan(m, lib)
        audio, events = render(m, lib, assignments, bpm=m.bpm)
        r = evaluate(audio, m, events, m.bpm, lib)
        problems = bar_problems(r)
        verdict = "FAIL: " + "; ".join(problems) if problems else "PASS"
        print(metrics_line(c["id"], transpose, r, fit.octave_moves, verdict))


if __name__ == "__main__":
    main()
