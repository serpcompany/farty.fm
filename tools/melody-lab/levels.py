"""How loud Farty plays (#369): peak (dBFS) and integrated loudness (LUFS) of each render and of
each Fixture Library Recording as its Play hears it, against phone media's -14 LUFS with peaks
near -1 dBFS.

    .venv/bin/python -I levels.py [dir]    # default dir: out/web

`dir` holds the renders `apps/web/scripts/render-songs.ts` writes (`<song>.wav`): a Toot, and
Song Creator's preview, which plays the same render. Each Recording is raised so its peak
reaches FULL_LEVEL_PEAK and never turned down, as Review and its saved file are
(`atFullLevel`, apps/web/src/lib/recordings.ts). Prints a line each, then the median and range.
Measures with evaluate.peak_dbfs() and evaluate.loudness(); changes nothing.
"""
import json
import sys
from pathlib import Path

import librosa
import numpy as np
import soundfile as sf

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE)]

from engine import AUDIO_DIR, MANIFEST  # noqa: E402
from evaluate import loudness, peak_dbfs  # noqa: E402

FULL_LEVEL_PEAK = 0.89  # recordings.ts fullLevelPeak, as renderer.ts LIMITER_PEAK


def summary(label, rows):
    peaks, lufs = np.array([r[1] for r in rows]), np.array([r[2] for r in rows])
    print(f"{label}: {len(rows)}, peak max {peaks.max():.2f} dBFS, LUFS median {np.median(lufs):.2f}"
          f" (min {lufs.min():.2f}, max {lufs.max():.2f})")


def main():
    renders = Path(sys.argv[1]) if len(sys.argv) > 1 else HERE / "out/web"
    if not any(renders.glob("*.wav")):
        sys.exit(f"No renders in {renders}. Make them first, from apps/web:\n"
                 "    corepack pnpm@10.17.0 exec tsx scripts/render-songs.ts")
    rows = []
    for path in sorted(renders.glob("*.wav")):
        y, sr = sf.read(path)
        rows.append((path.stem, peak_dbfs(y), loudness(y, sr)))
        print(f"render {path.stem:32s} peak {rows[-1][1]:6.2f}  LUFS {rows[-1][2]:6.2f}")
    played = []
    for recording in json.loads(MANIFEST.read_text())["recordings"]:
        y, sr = librosa.load(AUDIO_DIR / recording["filename"], sr=None, mono=True)
        peak = np.max(np.abs(y))
        if 0 < peak < FULL_LEVEL_PEAK:
            y = y * (FULL_LEVEL_PEAK / peak)
        played.append((recording["id"], peak_dbfs(y), loudness(y, sr)))
        print(f"recording {recording['id']:29s} peak {played[-1][1]:6.2f}  LUFS {played[-1][2]:6.2f}")
    summary(f"renders in {renders}", rows)
    summary("Recordings at full level", played)


if __name__ == "__main__":
    main()
