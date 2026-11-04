"""The user's changes to an Arrangement, its Fart Choices (#360): a swap, a fart left out and a
reset, from an unchanged Song, move no other pitch's fart but the one a swap takes. Runs
arrange() on the golden Songs and Recordings in fixtures/golden/, without audio, through
export_golden.py's choice cases (the ones choices.json holds).
`apps/web/src/lib/engine/fart-choices.test.ts` replays choices.json on the web.

    .venv/bin/python -I -m unittest discover -s . -p 'test_*.py'    # from tools/melody-lab
"""
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE)]

import export_golden  # noqa: E402
from engine import FartChoices, arrange, can_play, leave_out, melody_fit, plan, swap  # noqa: E402
from test_needed_seconds import INDEX, SONGS, golden_source, melody  # noqa: E402

LIBRARIES = {name: [golden_source(rid) for rid in ids] for name, ids in INDEX["libraries"].items()}
MELODIES = {sid: melody(song) for sid, song in SONGS.items()}


def cases():
    """(library, Song id, case, the Song's states) for every choice case."""
    for name, sources in LIBRARIES.items():
        for sid, m in MELODIES.items():
            for case, steps in export_golden.choice_cases(m, sources):
                yield name, sid, case, steps, export_golden.choice_states(m, sources, steps)


CASES = list(cases())


def rfp(state):
    return {int(p): r for p, r in state["recording_for_pitch"].items()}


class FartChoices_(unittest.TestCase):
    def test_every_case_is_made(self):
        made = {case for _, _, case, _, _ in CASES}
        self.assertEqual(made, {"swap", "swap_taken", "use_again", "leave_out_every", "reset", "reset_all", "stale"})
        self.assertGreater(len(CASES), 800)

    def test_no_change_at_farty_transposition_is_farty_arrangement(self):
        for name, sources in LIBRARIES.items():
            for sid, m in MELODIES.items():
                auto = melody_fit(m, sources)
                held = arrange(m, sources, FartChoices(auto.transpose))
                self.assertEqual(held.recording_for_pitch, auto.recording_for_pitch, (name, sid))
                self.assertEqual(held.octave_moves, auto.octave_moves, (name, sid))
                self.assertAlmostEqual(held.cost, auto.cost, delta=1e-9, msg=(name, sid))

    def test_a_swap_moves_only_its_pitch_and_the_one_it_took(self):
        n = 0
        for name, sid, case, steps, states in CASES:
            if case not in ("swap", "swap_taken"):
                continue
            before, after = rfp(states[0]), rfp(states[1])
            p, r = steps[0]["song_pitch"], steps[0]["recording"]
            self.assertEqual(after[p], r, (name, sid, case))
            self.assertEqual(states[1]["transpose"], states[0]["transpose"], (name, sid, case))
            took = next((q for q in before if before[q] == r), None)
            self.assertEqual(took is not None, case == "swap_taken", (name, sid, case))
            if took is not None:
                self.assertNotEqual(after[took], r, (name, sid))
            if states[0]["unlocked"]:  # a locked Song's uncovered pitches are arranged again too
                moved = {q for q in before if after[q] != before[q]}
                self.assertLessEqual(moved, {p, took}, (name, sid, case))
            n += 1
        self.assertGreater(n, 150)

    def test_a_second_swap_for_a_pitch_replaces_the_first(self):
        n = 0
        for name, sid, case, steps, states in CASES:
            if case != "swap" or len(steps) < 2:
                continue
            p, first, second = steps[0]["song_pitch"], steps[0]["recording"], steps[1]["recording"]
            self.assertEqual(steps[1]["song_pitch"], p)
            self.assertEqual(states[2]["choices"]["preferred"], {p: second}, (name, sid))
            after = rfp(states[2])
            self.assertEqual(after[p], second, (name, sid))
            # The first is free again, and nobody played it before: unless the second was taken
            # from another pitch, which is then arranged again, it plays nothing.
            if second not in rfp(states[0]).values():
                self.assertNotIn(first, after.values(), (name, sid))
            n += 1
        self.assertGreater(n, 100)

    def test_a_fart_left_out_plays_nothing_and_moves_only_the_pitches_without_their_own(self):
        n = first = 0
        for name, sid, case, steps, states in CASES:
            auto = rfp(states[0])
            for i, step in enumerate(steps, 1):
                if step["op"] != "leave_out":
                    continue
                before, after = rfp(states[i - 1]), rfp(states[i])
                r = step["recording"]
                self.assertNotIn(r, after.values(), (name, sid, case))
                # Only a pitch that loses its fart moves, and one an earlier change left
                # without Farty's pick (both are arranged again together).
                for q in before:
                    if before[q] != r and before[q] == auto[q] and auto[q] is not None:
                        self.assertEqual(after[q], before[q], (name, sid, case, i, q))
                if i == 1 and states[0]["unlocked"]:
                    self.assertEqual({q for q in before if after[q] != before[q]},
                                     {q for q in before if before[q] == r}, (name, sid, case))
                    first += 1
                n += 1
        self.assertGreater(n, 400)
        self.assertGreater(first, 250)

    def test_leaving_out_every_fart_of_a_pitch_locks_the_song_until_it_is_reset(self):
        n = 0
        for name, sid, case, steps, states in CASES:
            if case != "leave_out_every":
                continue
            p = steps[-1]["song_pitch"]
            self.assertIsNone(rfp(states[-2])[p], (name, sid))
            self.assertFalse(states[-2]["unlocked"], (name, sid))
            self.assertIn(p + states[-2]["transpose"], [m["target_midi"] for m in states[-2]["missing"]])
            n += 1
        self.assertGreater(n, 100)

    def test_a_reset_brings_back_farty_pick(self):
        for name, sid, case, steps, states in CASES:
            if case not in ("reset", "reset_all", "use_again", "leave_out_every"):
                continue
            self.assertIsNone(states[-1]["choices"], (name, sid, case))
            self.assertEqual(rfp(states[-1]), rfp(states[0]), (name, sid, case))
            if case == "reset":
                # The first reset puts Farty's pick back on the swapped pitch, and the fart left
                # out stays out unless it could play that pitch.
                p, left_out = steps[0]["song_pitch"], steps[1]["recording"]
                self.assertEqual(rfp(states[3])[p], rfp(states[0])[p], (name, sid))
                c = states[3]["choices"]
                self.assertEqual(c is not None and left_out in c["excluded"], left_out not in rfp(states[3]).values())

    def test_the_engine_drops_a_pick_it_cannot_play(self):
        swaps = {(name, sid): steps[0] for name, sid, case, steps, _ in CASES if case == "swap"}
        n = 0
        for name, sid, case, steps, states in CASES:
            if case != "stale":
                continue
            # Only the swap stands, beside the fart left out.
            c, kept = steps[0]["choices"], swaps[(name, sid)]
            only = FartChoices(c["transposition"], {kept["song_pitch"]: kept["recording"]}, tuple(c["excluded"]))
            expected = arrange(MELODIES[sid], LIBRARIES[name], only).recording_for_pitch
            self.assertEqual(rfp(states[1]), expected, (name, sid))
            self.assertGreater(len(c["preferred"]), 4, (name, sid))
            n += 1
        self.assertGreater(n, 50)

    def test_plan_plays_the_choices(self):
        sources = LIBRARIES["full"]
        for sid, m in MELODIES.items():
            auto = melody_fit(m, sources)
            if not auto.unlocked:
                continue
            p, r = next(((p, s.id) for p in sorted(auto.recording_for_pitch) for s in sources
                         if s.pitched and s.id not in auto.recording_for_pitch.values()
                         and can_play(s, p, FartChoices(auto.transpose), m)), (None, None))
            if p is None:
                continue
            transpose, assignments = plan(m, sources, choices=swap(FartChoices(auto.transpose), p, r))
            self.assertEqual(transpose, auto.transpose)
            self.assertTrue(all(a.source_id == r for a in assignments if m.notes[a.note_index].pitch == p))
            return
        self.fail("no Song to swap a fart in")


if __name__ == "__main__":
    unittest.main()
