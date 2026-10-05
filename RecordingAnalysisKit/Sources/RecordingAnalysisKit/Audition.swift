import Foundation

/// `audition()` of the reference engine: play the Recording through the real render path at
/// its own pitch for a few note lengths and read the pitch back. This is analysis only; the
/// rendered notes are measured and thrown away, never played to the user.
enum Audition {
    /// Note lengths tried, shortest first, in seconds.
    static let noteLengths = [0.12, 0.2, 0.35, 0.6]
    /// How far off the read-back pitch may be.
    static let toleranceCents = 40.0

    /// The shortest note length (s) that still reads back within 40 cents of `referenceMIDI`,
    /// or nil if none does (the Recording is Noise-like after all). Catches farts whose pitch
    /// only settles after the attack.
    static func shortestNote(audio: [Double], f0: [Double], referenceMIDI: Double) -> Double? {
        let seconds = Double(audio.count) / Double(analysisSampleRate)
        for length in noteLengths {
            if let cents = readBackCents(audio: audio, f0: f0, referenceMIDI: referenceMIDI, length: length),
               cents <= toleranceCents {
                return length
            }
            if length >= seconds { break }
        }
        return nil
    }

    /// Renders a note of `length` seconds (or the whole gesture if shorter) at the Recording's
    /// own pitch and returns how far its median pYIN pitch is from `referenceMIDI`, in cents.
    /// Nil if fewer than 2 frames are voiced.
    static func readBackCents(audio: [Double], f0: [Double], referenceMIDI: Double, length: Double) -> Double? {
        let sr = Double(analysisSampleRate)
        let n = Int(min(length, Double(audio.count) / sr) * sr)
        let note = Resampling.variableResample(audio, f0: f0, ratio: 1, tune: 1, outputLength: n, referenceMIDI: referenceMIDI)
        let pyin = PYIN.shared(note)
        let heard = (0..<pyin.f0.count).filter { pyin.voiced[$0] && pyin.f0[$0].isFinite }.map { hzToMIDI(pyin.f0[$0]) }
        guard heard.count >= 2 else { return nil }
        return abs(RecordingPitch.median(heard) - referenceMIDI) * 100
    }
}
