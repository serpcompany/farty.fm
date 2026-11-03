export function analyzedTake() {
  return {
    seconds: 0.1,
    sampleRate: 48_000,
    waveform: [0, 0.5, 1],
    analysis: {
      state: 'analyzed',
      analysis: {
        gestureStartSeconds: 0.01,
        gestureEndSeconds: 0.09,
        cutAtReattack: false,
        pitchEstimateMidi: 52,
        pitchConfidence: 0.8,
        recordingPitchMidi: 52.3,
        shortestNoteSeconds: 0.05
      }
    }
  }
}
