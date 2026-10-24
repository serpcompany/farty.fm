/**
 * The Recording Analysis version. Version 1 is the Swift `RecordingAnalysis.currentVersion`;
 * version 2 adds the settle time (#116), and version 3 the pitch contour that keeps the attack
 * (#208). Swift has neither. A stored analysis carries the version that made it from version 3
 * on, so one without is older, and `upgradeAnalyses` runs Recording Analysis on it again.
 *
 * Its own module, so the app reads it without loading Recording Analysis itself.
 */
export const ANALYSIS_VERSION = 3
