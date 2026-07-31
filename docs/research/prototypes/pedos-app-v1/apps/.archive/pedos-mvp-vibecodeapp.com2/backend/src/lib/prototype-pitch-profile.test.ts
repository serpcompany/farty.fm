import { describe, expect, test } from "bun:test";

import {
  aggregatePitchFrames,
  scoreMelodyFit,
} from "./prototype-pitch-profile.ts";

describe("aggregatePitchFrames", () => {
  test("derives a stable reference note and usable range from clear clustered frames", (): void => {
    const profile = aggregatePitchFrames([
      { clarity: 0.94, hz: 440, rms: 0.18 },
      { clarity: 0.91, hz: 446, rms: 0.17 },
      { clarity: 0.89, hz: 432, rms: 0.16 },
      { clarity: 0.86, hz: 438, rms: 0.15 },
      { clarity: 0.2, hz: 0, rms: 0.03 },
    ]);

    expect(profile.referenceMidi).toBe(69);
    expect(profile.pitchConfidence).toBeGreaterThan(0.4);
    expect(profile.usableMinMidi).toBeLessThanOrEqual(69);
    expect(profile.usableMaxMidi).toBeGreaterThanOrEqual(69);
  });

  test("refuses to invent a confident note from weak unclear frames", (): void => {
    const profile = aggregatePitchFrames([
      { clarity: 0.12, hz: 0, rms: 0.02 },
      { clarity: 0.18, hz: 0, rms: 0.01 },
      { clarity: 0.22, hz: 110, rms: 0.03 },
    ]);

    expect(profile.referenceMidi).toBeNull();
    expect(profile.pitchConfidence).toBe(0);
    expect(profile.usableMinMidi).toBeNull();
    expect(profile.usableMaxMidi).toBeNull();
  });
});

describe("scoreMelodyFit", () => {
  test("prefers melodies that fit the profiled sample register", (): void => {
    const lowProfile = aggregatePitchFrames([
      { clarity: 0.92, hz: 146.8, rms: 0.2 },
      { clarity: 0.88, hz: 147.9, rms: 0.19 },
      { clarity: 0.84, hz: 144.8, rms: 0.18 },
    ]);
    const highProfile = aggregatePitchFrames([
      { clarity: 0.95, hz: 659.3, rms: 0.16 },
      { clarity: 0.92, hz: 671.0, rms: 0.15 },
      { clarity: 0.9, hz: 648.0, rms: 0.14 },
    ]);

    const fit = scoreMelodyFit([lowProfile, highProfile], [50, 52, 55, 76, 78, 79]);

    expect(fit.matchScore).toBeGreaterThan(60);
    expect(fit.riskNotes.length).toBe(0);
  });
});
