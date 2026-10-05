import Foundation

/// The single clean gesture of a Recording, in samples of the decoded 44.1 kHz file.
struct Gesture: Equatable, Sendable {
    var start: Int
    /// Exclusive.
    var end: Int
    /// The gesture ends at a second attack rather than where the sound fades out.
    var cutAtReattack: Bool
}

/// Automatic trimming: `note_segment()` of the reference engine.
package enum Trimming {
    /// Finds the single-attack part of a Recording that can act as one note.
    ///
    /// - Start: on a 5 ms RMS envelope, the first frame within 12 dB of the peak, minus 8 ms,
    ///   so slow swells don't make the note sound late.
    /// - End: on a 50 ms RMS envelope (fast flutter is smoothed away), the first slow re-attack:
    ///   a dip of more than 6 dB below the running maximum, then a rise of more than 4 dB, more
    ///   than 60 ms after the start. Otherwise where the level falls 30 dB below its peak.
    static func noteSegment(_ y: [Float]) -> Gesture {
        let sr = Double(analysisSampleRate)
        let hop = Int(0.005 * sr)  // 220 samples
        let fine = levelDB(y, frameLength: 2 * hop, hop: hop)
        let db = levelDB(y, frameLength: 10 * hop, hop: hop)

        let peak = fine.max()!
        let a0 = fine.firstIndex { $0 >= peak - 12 }!
        let start = max(0, a0 * hop - Int(0.008 * sr))

        let dbMax = db.max()!
        let endI = db.lastIndex { $0 > dbMax - 30 }! + 1
        var runMax = db[a0]
        var dipI: Int?
        var reattackAt: Int?
        if a0 + 1 < endI {
            for i in (a0 + 1)..<endI {
                if db[i] > runMax && dipI == nil {
                    runMax = db[i]
                }
                if db[i] < runMax - 6 {
                    if dipI == nil || db[i] < db[dipI!] {
                        dipI = i
                    }
                }
                if let dip = dipI, db[i] > db[dip] + 4, Double((i - a0) * hop) > 0.06 * sr {
                    reattackAt = dip
                    break
                }
            }
        }
        let end = (reattackAt ?? endI) * hop + hop
        return Gesture(start: start, end: min(y.count, end), cutAtReattack: reattackAt != nil)
    }

    /// `20 * log10(librosa.feature.rms(y, frame_length, hop_length) + 1e-9)`: centered frames
    /// (frame `i` is centered on sample `i * hop`), zero-padded at both ends, `1 + n / hop` frames.
    package static func levelDB(_ y: [Float], frameLength: Int, hop: Int) -> [Double] {
        let half = frameLength / 2
        let count = 1 + y.count / hop
        var out = [Double](repeating: 0, count: count)
        y.withUnsafeBufferPointer { y in
            for t in 0..<count {
                let lo = max(0, t * hop - half)
                let hi = min(y.count, t * hop - half + frameLength)
                var sum = 0.0
                if lo < hi {
                    for i in lo..<hi {
                        let s = Double(y[i])
                        sum += s * s
                    }
                }
                out[t] = 20 * log10((sum / Double(frameLength)).squareRoot() + 1e-9)
            }
        }
        return out
    }
}
