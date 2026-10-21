import Foundation

/// The pitch half of `analyze_recording()` in the reference engine.
struct PitchAnalysis: Sendable {
    /// The smoothed pitch contour of the gesture in Hz, one value per 256-sample hop,
    /// NaN when unvoiced (the reference's `f0`).
    var f0: [Double]
    /// The Recording Pitch estimate before audition, nil if there were too few voiced frames
    /// or the confidence was below `RecordingPitch.minimumConfidence`.
    var estimateMIDI: Double?
    /// coverage × (1 − spread / 3), unrounded.
    var confidence: Double
}

package enum RecordingPitch {
    /// Loose on purpose: audition is the real gate.
    static let minimumConfidence = 0.1
    /// Voiced probability a frame needs, on top of pYIN's own voicing decision.
    static let minimumVoicedProbability = 0.05

    /// Pitch contour, Recording Pitch estimate and pitch confidence of a gesture.
    static func analyze(_ body: [Double]) -> PitchAnalysis {
        let f0 = contour(body)
        let (estimate, confidence) = estimate(body: body, f0: f0)
        return PitchAnalysis(f0: f0, estimateMIDI: estimate, confidence: confidence)
    }

    /// pYIN over the gesture, then the reference's smoothing: keep frames voiced with
    /// probability above 0.05; if at least 3, run a 5-frame median filter over the MIDI values
    /// with unvoiced frames as 0 (scipy `reflect` edges), keep it only on voiced frames, and drop
    /// values at or below MIDI 10 (the median landed on the zeros).
    static func contour(_ body: [Double]) -> [Double] {
        let pyin = PYIN.shared(body)
        var f0 = (0..<pyin.f0.count).map { i in
            pyin.voiced[i] && pyin.voicedProbability[i] > minimumVoicedProbability ? pyin.f0[i] : Double.nan
        }
        let finite = f0.map(\.isFinite)
        if finite.count(where: { $0 }) >= 3 {
            let midi = (0..<f0.count).map { finite[$0] ? hzToMIDI(f0[$0]) : 0 }
            let smoothed = medianFilter5(midi)
            f0 = (0..<f0.count).map { i in
                let m = finite[i] ? smoothed[i] : Double.nan
                return m.isFinite && m > 10 ? midiToHz(m) : Double.nan
            }
        }
        return f0
    }

    /// Recording Pitch: the energy-weighted median of the voiced frames in the first 450 ms.
    /// Confidence: coverage × (1 − spread / 3), spread being the median distance from it.
    static func estimate(body: [Double], f0: [Double]) -> (midi: Double?, confidence: Double) {
        let sr = Double(analysisSampleRate)
        let hop = PYIN.hopLength
        let head = min(f0.count, Int(0.45 * sr / Double(hop)))
        let voiced = (0..<head).filter { f0[$0].isFinite }
        let coverage = Double(voiced.count) / Double(max(1, Double(body.count) > 0.45 * sr ? head : f0.count))
        guard voiced.count >= 4 else { return (nil, 0) }

        let rms = frameRMS(body, frameLength: PYIN.frameLength, hop: hop)
        let mids = voiced.map { hzToMIDI(f0[$0]) }
        let weights = voiced.map { rms[$0] }
        let order = mids.indices.sorted { mids[$0] < mids[$1] }
        let total = weights.reduce(0, +)
        var cumulative = 0.0
        var medianIndex = order.last!
        for i in order {
            cumulative += weights[i]
            if cumulative / total >= 0.5 {
                medianIndex = i
                break
            }
        }
        let median = mids[medianIndex]
        let spread = Self.median(mids.map { abs($0 - median) })
        let confidence = min(max(coverage, 0), 1) * min(max(1 - spread / 3, 0), 1)
        return (confidence >= minimumConfidence ? median : nil, confidence)
    }

    /// `librosa.feature.rms(y, frame_length, hop_length)`: centered, zero-padded frames.
    static func frameRMS(_ y: [Double], frameLength: Int, hop: Int) -> [Double] {
        let half = frameLength / 2
        return (0..<(1 + y.count / hop)).map { t in
            let lo = max(0, t * hop - half)
            let hi = min(y.count, t * hop - half + frameLength)
            var sum = 0.0
            if lo < hi { for i in lo..<hi { sum += y[i] * y[i] } }
            return (sum / Double(frameLength)).squareRoot()
        }
    }

    /// `scipy.ndimage.median_filter(x, size=5)` with the default `reflect` edges (d c b a | a b c d).
    static func medianFilter5(_ x: [Double]) -> [Double] {
        let n = x.count
        func at(_ i: Int) -> Double {
            var j = i % (2 * n)
            if j < 0 { j += 2 * n }
            return x[j < n ? j : 2 * n - 1 - j]
        }
        return (0..<n).map { i in
            [at(i - 2), at(i - 1), x[i], at(i + 1), at(i + 2)].sorted()[2]
        }
    }

    /// `np.median`.
    package static func median(_ x: [Double]) -> Double {
        let s = x.sorted()
        let n = s.count
        return n % 2 == 1 ? s[n / 2] : (s[n / 2 - 1] + s[n / 2]) / 2
    }
}
