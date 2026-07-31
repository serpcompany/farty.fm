import type { SampleAnalysis } from "./sample-analyzer.ts";

export interface QualitySampleSet {
  label: string;
  paths: string[];
}

function dedupeAnalyses(analyses: SampleAnalysis[]): SampleAnalysis[] {
  const seen = new Set<string>();
  const unique: SampleAnalysis[] = [];

  for (const analysis of analyses) {
    if (seen.has(analysis.filename)) {
      continue;
    }

    seen.add(analysis.filename);
    unique.push(analysis);
  }

  return unique;
}

function sortByReferenceMidi(analyses: SampleAnalysis[]): SampleAnalysis[] {
  return analyses.slice().sort((left, right) => left.referenceMidi - right.referenceMidi);
}

function pickEvenlySpaced(analyses: SampleAnalysis[], count: number): SampleAnalysis[] {
  if (count <= 0 || analyses.length === 0) {
    return [];
  }

  if (count >= analyses.length) {
    return analyses;
  }

  if (count === 1) {
    return [analyses[Math.floor(analyses.length / 2)]!];
  }

  const picks: SampleAnalysis[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < count; index++) {
    const ratio = index / (count - 1);
    const pickIndex = Math.round(ratio * (analyses.length - 1));
    const analysis = analyses[pickIndex];

    if (!analysis || seen.has(analysis.filename)) {
      continue;
    }

    seen.add(analysis.filename);
    picks.push(analysis);
  }

  return picks;
}

function pickMidRange(analyses: SampleAnalysis[], count: number): SampleAnalysis[] {
  if (count <= 0 || analyses.length === 0) {
    return [];
  }

  if (count >= analyses.length) {
    return analyses;
  }

  const startIndex = Math.max(0, Math.floor((analyses.length - count) / 2));
  return analyses.slice(startIndex, startIndex + count);
}

function toPaths(analyses: SampleAnalysis[]): string[] {
  return analyses.map((analysis) => analysis.path);
}

export function buildQualitySampleSets(analyses: SampleAnalysis[]): QualitySampleSet[] {
  const uniqueAnalyses = sortByReferenceMidi(dedupeAnalyses(analyses));

  return [
    {
      label: "All samples",
      paths: toPaths(pickEvenlySpaced(uniqueAnalyses, Math.min(7, uniqueAnalyses.length))),
    },
    {
      label: "Wide range (bass + squeaky)",
      paths: toPaths(pickEvenlySpaced(uniqueAnalyses, Math.min(3, uniqueAnalyses.length))),
    },
    {
      label: "Mid range",
      paths: toPaths(pickMidRange(uniqueAnalyses, Math.min(3, uniqueAnalyses.length))),
    },
  ];
}
