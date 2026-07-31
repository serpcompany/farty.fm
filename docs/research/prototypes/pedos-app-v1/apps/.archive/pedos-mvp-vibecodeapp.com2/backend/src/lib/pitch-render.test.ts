import { describe, expect, test } from "bun:test";

import {
  buildPitchTempoFilter,
  buildRenderedNoteFilter,
  buildTempoChain,
} from "./pitch-render.ts";

describe("buildTempoChain", () => {
  test("returns a single atempo filter when the ratio is already in range", (): void => {
    expect(buildTempoChain(1.25)).toBe("atempo=1.250000");
  });

  test("splits large tempo ratios into multiple atempo stages", (): void => {
    expect(buildTempoChain(3)).toBe("atempo=2.000000,atempo=1.500000");
  });

  test("splits very small tempo ratios into multiple atempo stages", (): void => {
    expect(buildTempoChain(0.125)).toBe("atempo=0.500000,atempo=0.500000,atempo=0.500000");
  });
});

describe("buildPitchTempoFilter", () => {
  test("prefers rubberband when available", (): void => {
    const filter = buildPitchTempoFilter({
      pitchRatio: 1.2,
      preferRubberband: true,
      sampleRate: 44100,
      tempoRatio: 0.9,
    });

    expect(filter).toContain("rubberband=pitch=1.200000:tempo=0.900000");
  });

  test("falls back to asetrate plus atempo when rubberband is unavailable", (): void => {
    const filter = buildPitchTempoFilter({
      pitchRatio: 1.5,
      preferRubberband: false,
      sampleRate: 44100,
      tempoRatio: 1.125,
    });

    expect(filter).toBe(
      "asetrate=66150.000000,aresample=44100,atempo=0.750000",
    );
  });
});

describe("buildRenderedNoteFilter", () => {
  test("renders only the pitched fart sample with no synthetic tone mix", (): void => {
    const filter = buildRenderedNoteFilter({
      duration: 1.2,
      pitchRatio: 1.1,
      preferRubberband: false,
      sampleRate: 44100,
      tempoRatio: 0.95,
      velocity: 0.82,
    });

    expect(filter).toContain("asetrate=");
    expect(filter).toContain("volume=0.8200");
    expect(filter).toContain("afade=t=in:d=0.015");
    expect(filter).toContain("afade=t=out:st=1.185:d=0.015");
    expect(filter).not.toContain("sine=");
    expect(filter).not.toContain("amix=");
  });
});
