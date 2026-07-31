# Blind Recording Analysis render comparison

This is throwaway evidence for
[Choose a post-save Recording Analysis approach](https://github.com/serpcompany/pedos-app/issues/4),
not a production renderer or an approved analysis schema.

## Listen first

Play these files without opening `answer-key.txt` or
`comparison-evidence.json`:

1. `blind-1.wav`
2. `blind-2.wav`
3. `blind-3.wav`

Each uses the same 26-note comparison contour and only approved Fixture
Library Recordings. Compare:

- how clearly the same pitch contour comes through;
- whether note levels are distractingly uneven;
- whether starts and stops feel clean;
- whether the result still sounds like fart Recordings rather than a
  conventional instrument;
- which file you would keep, or whether none is acceptable.

After choosing, open `answer-key.txt`. One render uses the existing
`windowed-yin-v2` candidate, one uses the stricter `paper-yin-v1` challenger,
and one is a duration-only control with one Recording, relative pitch shifts,
no sound-boundary detection, and no gain matching.

## Inspect second

`comparison-evidence.json` contains all 23 candidate analyses and the complete
render state for every note: source Recording, detected pitch, applied pitch
shift, gain, and sound start/end. The current candidate exposes pitch for 10 of
23 Recordings; the stricter challenger exposes pitch for 7 of 23. Neither count
is ground truth or an approval criterion.

The renderer deliberately repeats source audio when a selected sound is
shorter than a note. Repetition, note duration, the fixed contour, thresholds,
and gain policy are prototype hypotheses that later listening decisions may
replace.
