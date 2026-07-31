import { describe, expect, test } from "bun:test";

import type { SampleAnalysis } from "./sample-analyzer.ts";
import { buildQualitySampleSets } from "./quality-sample-sets.ts";

const SAMPLE_ANALYSES: SampleAnalysis[] = [
  {
    brightness: 0.2,
    duration: 1.2,
    filename: "low-a.mp3",
    loudness: -20,
    midiNote: 58,
    path: "/repo/test-data/fart-samples/low-a.mp3",
    pitch: 120,
    referenceMidi: 58,
  },
  {
    brightness: 0.25,
    duration: 1.1,
    filename: "low-b.mp3",
    loudness: -22,
    midiNote: 60,
    path: "/repo/test-data/fart-samples/low-b.mp3",
    pitch: 130,
    referenceMidi: 60,
  },
  {
    brightness: 0.4,
    duration: 1.5,
    filename: "mid-a.mp3",
    loudness: -19,
    midiNote: 72,
    path: "/repo/test-data/fart-samples/mid-a.mp3",
    pitch: 220,
    referenceMidi: 72,
  },
  {
    brightness: 0.45,
    duration: 0.8,
    filename: "mid-b.mp3",
    loudness: -23,
    midiNote: 74,
    path: "/repo/test-data/fart-samples/mid-b.mp3",
    pitch: 240,
    referenceMidi: 74,
  },
  {
    brightness: 0.7,
    duration: 0.6,
    filename: "high-a.mp3",
    loudness: -18,
    midiNote: 96,
    path: "/repo/test-data/fart-samples/high-a.mp3",
    pitch: 880,
    referenceMidi: 96,
  },
  {
    brightness: 0.8,
    duration: 0.5,
    filename: "high-b.mp3",
    loudness: -17,
    midiNote: 103,
    path: "/repo/test-data/fart-samples/high-b.mp3",
    pitch: 1200,
    referenceMidi: 103,
  },
];

describe("buildQualitySampleSets", () => {
  test("returns stable non-empty sets from the analyses that actually exist", (): void => {
    const sampleSets = buildQualitySampleSets(SAMPLE_ANALYSES);

    expect(sampleSets).toHaveLength(3);
    expect(sampleSets.every((sampleSet) => sampleSet.paths.length > 0)).toBe(true);
    expect(sampleSets[0]?.label).toBe("All samples");
    expect(sampleSets[1]?.label).toBe("Wide range (bass + squeaky)");
    expect(sampleSets[2]?.label).toBe("Mid range");
  });

  test("keeps the wide-range set anchored to the lowest and highest registers", (): void => {
    const sampleSets = buildQualitySampleSets(SAMPLE_ANALYSES);
    const wideRangePaths = sampleSets[1]?.paths ?? [];

    expect(wideRangePaths).toContain("/repo/test-data/fart-samples/low-a.mp3");
    expect(wideRangePaths).toContain("/repo/test-data/fart-samples/high-b.mp3");
  });
});
