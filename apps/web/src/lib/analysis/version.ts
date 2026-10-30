/**
 * The Recording Analysis version. Version 1 is the Swift `RecordingAnalysis.currentVersion`;
 * version 2 adds the settle time (#116), version 3 the pitch contour that keeps the attack (#208),
 * and version 4 the whole fart: the gesture runs to where the sound fades out, every burst, and
 * only the pitch is read from the first burst (ADR 0016). Swift has none of these. A stored
 * analysis carries the version that made it from version 3 on, so one without is older, and
 * `upgradeAnalyses` runs Recording Analysis on it again.
 *
 * Its own module, so the app reads it without loading Recording Analysis itself.
 */
export const ANALYSIS_VERSION = 4
