from dataclasses import replace

import numpy as np

from analysis import SR, lead_in_start, note_segment


def sample_range(y, start_s, end_s):
    a = max(0, min(len(y), round(start_s * SR)))
    return a, max(a, min(len(y), round(end_s * SR)))


def trim_bounds(y, start_s, end_s):
    a, b = sample_range(y, start_s, end_s)
    if b - a < 2:
        raise ValueError("a Trim keeps at least two samples")
    start, end, _, _ = note_segment(y[a:b])
    return (a + start) / SR, (a + end) / SR


def trimmed(src, y, start_s, end_s, handles=None):
    a, b = sample_range(y, start_s, end_s)
    lead_from = a
    if handles is not None:
        ha, hb = sample_range(y, *handles)
        if ha <= a <= hb:
            lead_from = ha + lead_in_start(y[ha:hb], a - ha)
    lead_in = y[lead_from:a].astype(np.float64)
    return replace(src, audio=y[a:b].astype(np.float64), start=a, end=b, pitch_end=b, lead_in=lead_in)
