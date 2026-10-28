import numpy as np

from analysis import SR


def samples(seconds):
    return round(seconds * SR)


def harmonic(freq, seconds, harmonics=6):
    t = np.arange(samples(seconds)) / SR
    return sum(np.sin(2 * np.pi * freq * k * t) / k for k in range(1, harmonics + 1))


def faded(x, fade_s):
    env = np.ones(len(x))
    n = samples(fade_s)
    env[:n] = np.linspace(0, 1, n)
    env[-n:] = np.linspace(1, 0, n)
    return x * env


def padded(x, before_s, after_s):
    return np.concatenate([np.zeros(samples(before_s)), x, np.zeros(samples(after_s))]).astype(np.float32)


def burst(seconds=0.5):
    return faded(harmonic(110.0, seconds), 0.01) * 0.3
