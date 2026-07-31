import { execSync } from "child_process";

export interface BuildPitchTempoFilterOptions {
  pitchRatio: number;
  preferRubberband: boolean;
  sampleRate: number;
  tempoRatio: number;
}

export interface BuildRenderedNoteFilterOptions
  extends BuildPitchTempoFilterOptions {
  duration: number;
  velocity: number;
}

let rubberbandAvailable: boolean | null = null;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function buildTempoChain(tempo: number): string {
  const clampedTempo = clamp(tempo, 0.01, 100);
  const filters: string[] = [];
  let remaining = clampedTempo;

  while (remaining > 2) {
    filters.push("atempo=2.000000");
    remaining /= 2;
  }

  while (remaining < 0.5) {
    filters.push("atempo=0.500000");
    remaining /= 0.5;
  }

  filters.push(`atempo=${remaining.toFixed(6)}`);

  return filters.join(",");
}

function buildRubberbandFilter(pitchRatio: number, tempoRatio: number): string {
  return `rubberband=pitch=${pitchRatio.toFixed(6)}:tempo=${tempoRatio.toFixed(6)}:transients=crisp:formant=preserved:pitchq=quality`;
}

function buildFallbackFilter(
  sampleRate: number,
  pitchRatio: number,
  tempoRatio: number,
): string {
  const finalTempo = clamp(tempoRatio / pitchRatio, 0.01, 100);

  return [
    `asetrate=${(sampleRate * pitchRatio).toFixed(6)}`,
    `aresample=${sampleRate}`,
    buildTempoChain(finalTempo),
  ].join(",");
}

export function buildPitchTempoFilter(options: BuildPitchTempoFilterOptions): string {
  if (options.preferRubberband) {
    return buildRubberbandFilter(options.pitchRatio, options.tempoRatio);
  }

  return buildFallbackFilter(options.sampleRate, options.pitchRatio, options.tempoRatio);
}

export function buildRenderedNoteFilter(
  options: BuildRenderedNoteFilterOptions,
): string {
  const pitchTempoFilter = buildPitchTempoFilter(options);
  const fadeOutStart = Math.max(0, options.duration - 0.015);

  return [
    pitchTempoFilter,
    `volume=${options.velocity.toFixed(4)}`,
    "afade=t=in:d=0.015",
    `afade=t=out:st=${fadeOutStart.toFixed(3)}:d=0.015`,
  ].join(",");
}

export function hasRubberbandFilter(): boolean {
  if (rubberbandAvailable !== null) {
    return rubberbandAvailable;
  }

  try {
    const output = execSync("ffmpeg -filters", {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });

    rubberbandAvailable = output.includes(" rubberband ");
  } catch {
    rubberbandAvailable = false;
  }

  return rubberbandAvailable;
}
