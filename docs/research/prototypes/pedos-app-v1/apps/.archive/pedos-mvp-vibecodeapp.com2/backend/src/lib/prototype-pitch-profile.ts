export interface PrototypePitchFrame {
  clarity: number;
  hz: number;
  rms: number;
}

export interface PrototypeSampleProfile {
  pitchConfidence: number;
  pitchedFrameRatio: number;
  referenceHz: number | null;
  referenceMidi: number | null;
  usableMaxMidi: number | null;
  usableMinMidi: number | null;
}

export interface PrototypeMelodyFit {
  averagePenalty: number;
  bestTranspose: number;
  matchScore: number;
  riskNotes: number[];
}

const MIN_CLARITY = 0.75;
const MIN_RMS = 0.05;
const MAX_STABLE_SPREAD = 4;
const RANGE_PADDING = 2;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function hzToMidi(hz: number): number {
  return 69 + 12 * Math.log2(hz / 440);
}

function mean(values: number[]): number {
  if (!values.length) {
    return 0;
  }

  let total = 0;

  for (const value of values) {
    total += value;
  }

  return total / values.length;
}

function median(values: number[]): number {
  if (!values.length) {
    return 0;
  }

  const sorted = values.slice().sort((left, right) => left - right);
  const middleIndex = Math.floor(sorted.length / 2);

  if (sorted.length % 2) {
    return sorted[middleIndex] ?? 0;
  }

  const left = sorted[middleIndex - 1] ?? 0;
  const right = sorted[middleIndex] ?? 0;
  return (left + right) / 2;
}

function standardDeviation(values: number[], center: number): number {
  if (!values.length) {
    return 0;
  }

  let total = 0;

  for (const value of values) {
    total += (value - center) ** 2;
  }

  return Math.sqrt(total / values.length);
}

function isUsableFrame(frame: PrototypePitchFrame): boolean {
  return frame.hz > 0 && frame.clarity >= MIN_CLARITY && frame.rms >= MIN_RMS;
}

function notePenalty(noteMidi: number, profile: PrototypeSampleProfile): number {
  if (
    profile.referenceMidi === null ||
    profile.usableMinMidi === null ||
    profile.usableMaxMidi === null
  ) {
    return 12;
  }

  const rangePenalty = noteMidi < profile.usableMinMidi
    ? profile.usableMinMidi - noteMidi
    : noteMidi > profile.usableMaxMidi
      ? noteMidi - profile.usableMaxMidi
      : 0;

  const centerPenalty = Math.abs(noteMidi - profile.referenceMidi) * 0.2;
  const confidencePenalty = (1 - profile.pitchConfidence) * 6;

  return centerPenalty + rangePenalty * 1.5 + confidencePenalty;
}

export function aggregatePitchFrames(frames: PrototypePitchFrame[]): PrototypeSampleProfile {
  const usableFrames = frames.filter(isUsableFrame);

  if (!usableFrames.length) {
    return {
      pitchConfidence: 0,
      pitchedFrameRatio: 0,
      referenceHz: null,
      referenceMidi: null,
      usableMaxMidi: null,
      usableMinMidi: null,
    };
  }

  const midiValues = usableFrames.map((frame) => hzToMidi(frame.hz));
  const referenceMidiRaw = median(midiValues);
  const stableFrames = usableFrames.filter((frame) =>
    Math.abs(hzToMidi(frame.hz) - referenceMidiRaw) <= MAX_STABLE_SPREAD
  );

  const stableMidiValues = stableFrames.map((frame) => hzToMidi(frame.hz));
  const stableHzValues = stableFrames.map((frame) => frame.hz);
  const stableReferenceMidi = Math.round(median(stableMidiValues));
  const stableSpread = standardDeviation(stableMidiValues, stableReferenceMidi);
  const averageClarity = mean(stableFrames.map((frame) => frame.clarity));
  const pitchedFrameRatio = usableFrames.length / frames.length;
  const stability = 1 - clamp(stableSpread / 3, 0, 1);
  const pitchConfidence = clamp(averageClarity * pitchedFrameRatio * stability, 0, 1);

  if (pitchConfidence < 0.2) {
    return {
      pitchConfidence: 0,
      pitchedFrameRatio,
      referenceHz: null,
      referenceMidi: null,
      usableMaxMidi: null,
      usableMinMidi: null,
    };
  }

  const usableMinMidi = Math.round(Math.min(...stableMidiValues)) - RANGE_PADDING;
  const usableMaxMidi = Math.round(Math.max(...stableMidiValues)) + RANGE_PADDING;
  const referenceHz = mean(stableHzValues);

  return {
    pitchConfidence,
    pitchedFrameRatio,
    referenceHz,
    referenceMidi: stableReferenceMidi,
    usableMaxMidi,
    usableMinMidi,
  };
}

export function scoreMelodyFit(
  profiles: PrototypeSampleProfile[],
  melodyMidis: number[],
): PrototypeMelodyFit {
  let bestTranspose = 0;
  let bestAveragePenalty = Number.POSITIVE_INFINITY;
  let bestRiskNotes: number[] = [];

  for (let transpose = -5; transpose <= 5; transpose++) {
    const shiftedNotes = melodyMidis.map((midi) => midi + transpose);
    const penalties: number[] = [];
    const riskNotes: number[] = [];

    for (const noteMidi of shiftedNotes) {
      let bestNotePenalty = Number.POSITIVE_INFINITY;

      for (const profile of profiles) {
        const penalty = notePenalty(noteMidi, profile);
        if (penalty < bestNotePenalty) {
          bestNotePenalty = penalty;
        }
      }

      penalties.push(bestNotePenalty);

      if (bestNotePenalty > 4) {
        riskNotes.push(noteMidi);
      }
    }

    const averagePenalty = mean(penalties);

    if (averagePenalty < bestAveragePenalty) {
      bestAveragePenalty = averagePenalty;
      bestTranspose = transpose;
      bestRiskNotes = riskNotes;
    }
  }

  const matchScore = Math.round(clamp(100 - bestAveragePenalty * 10, 0, 100));

  return {
    averagePenalty: bestAveragePenalty,
    bestTranspose,
    matchScore,
    riskNotes: bestRiskNotes,
  };
}
