from pathlib import Path

import librosa
import numpy as np
from matplotlib.figure import Figure

from analysis import AUDIO_DIR, LEVEL_HOP, SR, level_db, note_segment, read_manifest

OUT = Path(__file__).parent / "out/envelopes.png"
COLUMNS = 4


def plot_envelopes(recordings, out):
    rows = -(-len(recordings) // COLUMNS)
    fig = Figure(figsize=(20, 3 * rows))
    axs = fig.subplots(rows, COLUMNS, squeeze=False)
    for ax, r in zip(axs.ravel(), recordings, strict=False):
        y, _ = librosa.load(AUDIO_DIR / r["filename"], sr=SR, mono=True)
        db = level_db(y, 2 * LEVEL_HOP)
        ax.plot(np.arange(len(db)) * LEVEL_HOP / SR, db, lw=0.8)
        start, end, _ = note_segment(y)
        ax.axvline(start / SR, color="g")
        ax.axvline(end / SR, color="r")
        ax.set_ylim(db.max() - 45, db.max() + 3)
        ax.set_title(r["id"])
    fig.tight_layout()
    out.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out, dpi=55)


if __name__ == "__main__":
    plot_envelopes(read_manifest(), OUT)
