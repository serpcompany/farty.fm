import Accelerate
import Foundation
@testable import RecordingAnalysisKit

/// The objective checks on a rendered Song: a port of `tools/melody-lab/evaluate.py`.
///
/// If an automatic pitch tracker can read the melody back out of the audio note by note, a
/// listener almost certainly can too. Necessary, not sufficient: the owner's ears decide.
enum RenderChecks {
    struct NoteToCheck {
        var startSeconds: Double
        /// `min(len_s, note length)`: how long the note actually sounds.
        var heardSeconds: Double
        var targetMIDI: Double
    }

    struct Metrics {
        var notes: Int
        /// Read-back error per note in cents, nil if fewer than 2 voiced frames.
        var cents: [Double?]
        var onTime: [Bool]
        var retrigger: [Bool]

        /// `round(100 × k / n)`, half to even like numpy, as `evaluate.py` reports it.
        static func pct(_ k: Int, _ n: Int) -> Int {
            Int((100 * Double(k) / Double(n)).rounded(.toNearestOrEven))
        }

        var pitchReadablePct: Int { Self.pct(cents.count { $0 != nil }, notes) }
        /// `within_50c_pct`; `edge` lists notes accepted up to ±`edgeCents` instead of ±50.
        func within50cPct(edge: Set<Int> = [], edgeCents: Double = 50) -> Int {
            Self.pct(cents.indices.count { i in
                guard let c = cents[i] else { return false }
                return abs(c) <= (edge.contains(i) ? edgeCents : 50)
            }, notes)
        }
        var onsetsOnTimePct: Int { Self.pct(onTime.count { $0 }, notes) }
        var notesWithRetrigger: Int { retrigger.count { $0 } }
        var medianAbsCents: Double? {
            let a = cents.compactMap { $0.map(abs) }
            return a.isEmpty ? nil : RecordingPitch.median(a)
        }
    }

    static let sr = Double(analysisSampleRate)
    static let hop = 256
    /// `evaluate.py` reads renders back with fmax 1200 Hz (analysis uses 900).
    static let pyin = PYIN(fmax: 1200)

    static func evaluate(_ audio: [Double], notes: [NoteToCheck]) -> Metrics {
        let tracked = pyin(audio)
        let onsets = onsetTimes(audio)
        var metrics = Metrics(notes: notes.count, cents: [], onTime: [], retrigger: [])
        for note in notes {
            let s = note.startSeconds
            let lo = s + 0.03, hi = s + max(0.06, note.heardSeconds - 0.02)
            let heard = tracked.f0.indices.filter { i in
                let t = Double(i * hop) / sr
                return t >= lo && t <= hi && tracked.voiced[i] && tracked.f0[i].isFinite
            }.map { hzToMIDI(tracked.f0[$0]) }
            metrics.cents.append(heard.count >= 2 ? (RecordingPitch.median(heard) - note.targetMIDI) * 100 : nil)

            let a = min(audio.count, Int(s * sr)), b = min(audio.count, max(a, Int((s + note.heardSeconds) * sr)))
            metrics.retrigger.append(hasReattack(Array(audio[a..<b])))
            metrics.onTime.append(onsets.contains { abs($0 - s) < 0.05 })
        }
        return metrics
    }

    /// A second audible attack inside one note, with the trimming's definition: on a 50 ms
    /// level, a dip of more than 6 dB below the running maximum, then a rise of more than 4 dB,
    /// more than 60 ms after the attack.
    static func hasReattack(_ segment: [Double]) -> Bool {
        let hop = Int(0.005 * sr)
        if segment.count < 20 * hop { return false }
        let db = Trimming.levelDB(segment.map(Float.init), frameLength: 10 * hop, hop: hop)
        let peak = db.max()!
        let a0 = db.firstIndex { $0 >= peak - 12 }!
        var runMax = db[a0]
        var dip: Int?
        guard a0 + 1 < db.count - 2 else { return false }
        for i in (a0 + 1)..<(db.count - 2) {
            if db[i] > runMax && dip == nil { runMax = db[i] }
            if db[i] < runMax - 6 && (dip == nil || db[i] < db[dip!]) { dip = i }
            if let d = dip, db[i] > db[d] + 4, Double((i - a0) * hop) > 0.06 * sr { return true }
        }
        return false
    }

    // MARK: - Onsets: librosa.onset.onset_detect(onset_strength(y, hop_length=256))

    /// Onset times in seconds: spectral flux of the log-power mel spectrogram (2048-point
    /// STFT, 128 Slaney mel bands, 80 dB range), normalized to 0...1, then librosa's greedy
    /// peak picking with its default 30 ms / 100 ms windows and delta 0.07.
    static func onsetTimes(_ y: [Double]) -> [Double] {
        let envelope = onsetStrength(y)
        let lo = envelope.min() ?? 0
        let shifted = envelope.map { $0 - lo }
        let hi = shifted.max() ?? 0
        let x = shifted.map { $0 / (hi + Double.leastNormalMagnitude) }
        guard x.contains(where: { $0 != 0 }), x.allSatisfy(\.isFinite) else { return [] }
        let frame = { (n: Double) in Int((n * sr / Double(hop)).rounded(.down)) }
        let peaks = pickPeaks(x, preMax: frame(0.03), postMax: frame(0) + 1, preAvg: frame(0.1), postAvg: frame(0.1) + 1,
                              delta: 0.07, wait: frame(0.03))
        return peaks.map { Double($0 * hop) / sr }
    }

    static func onsetStrength(_ y: [Double]) -> [Double] {
        let nFFT = 2048
        let bins = nFFT / 2 + 1
        let frames = 1 + y.count / hop
        let mel = melFilters
        var padded = [Double](repeating: 0, count: y.count + nFFT)
        for i in 0..<y.count { padded[nFFT / 2 + i] = y[i] }
        let window = (0..<nFFT).map { 0.5 - 0.5 * cos(2 * Double.pi * Double($0) / Double(nFFT)) }

        let log2n = vDSP_Length(11)
        guard let setup = vDSP_create_fftsetupD(log2n, FFTRadix(kFFTRadix2)) else { fatalError("vDSP FFT setup failed") }
        defer { vDSP_destroy_fftsetupD(setup) }
        var frame = [Double](repeating: 0, count: nFFT)
        var re = [Double](repeating: 0, count: nFFT / 2)
        var im = [Double](repeating: 0, count: nFFT / 2)
        var power = [Double](repeating: 0, count: bins)
        var logMel = [[Double]](repeating: [Double](repeating: 0, count: frames), count: mel.count)

        for t in 0..<frames {
            for i in 0..<nFFT { frame[i] = padded[t * hop + i] * window[i] }
            re.withUnsafeMutableBufferPointer { rp in
                im.withUnsafeMutableBufferPointer { ip in
                    var split = DSPDoubleSplitComplex(realp: rp.baseAddress!, imagp: ip.baseAddress!)
                    frame.withUnsafeBufferPointer { f in
                        f.baseAddress!.withMemoryRebound(to: DSPDoubleComplex.self, capacity: nFFT / 2) {
                            vDSP_ctozD($0, 2, &split, 1, vDSP_Length(nFFT / 2))
                        }
                    }
                    vDSP_fft_zripD(setup, &split, 1, log2n, FFTDirection(FFT_FORWARD))
                    // vDSP's forward real FFT is 2 × the DFT; packed DC in realp[0], Nyquist in imagp[0].
                    power[0] = rp[0] * rp[0] / 4
                    power[bins - 1] = ip[0] * ip[0] / 4
                    for k in 1..<(nFFT / 2) { power[k] = (rp[k] * rp[k] + ip[k] * ip[k]) / 4 }
                }
            }
            for (m, filter) in mel.enumerated() {
                var sum = 0.0
                for (j, w) in filter.weights.enumerated() { sum += power[filter.first + j] * w }
                logMel[m][t] = 10 * log10(max(1e-10, sum))
            }
        }
        // power_to_db(top_db=80): nothing below the loudest cell − 80 dB.
        let floor = logMel.map { $0.max()! }.max()! - 80
        for m in logMel.indices { for t in 0..<frames { logMel[m][t] = max(logMel[m][t], floor) } }

        // Mean positive flux over the bands, delayed by lag 1 + n_fft / (2 hop) = 5 frames.
        let delay = 1 + nFFT / (2 * hop)
        var envelope = [Double](repeating: 0, count: frames)
        for t in delay..<max(delay, frames) {
            let d = t - delay
            var sum = 0.0
            for m in logMel.indices { sum += max(0, logMel[m][d + 1] - logMel[m][d]) }
            envelope[t] = sum / Double(logMel.count)
        }
        return envelope
    }

    struct MelFilter {
        var first: Int
        var weights: [Double]
    }

    /// `librosa.filters.mel(sr=44100, n_fft=2048)`: 128 Slaney-scale, Slaney-normalized
    /// triangles from 0 Hz to Nyquist, kept as float32 like librosa.
    static let melFilters: [MelFilter] = {
        let nFFT = 2048, nMels = 128
        let fftFreqs = (0...(nFFT / 2)).map { Double($0) * (1.0 / (Double(nFFT) * (1.0 / sr))) }
        let maxMel = hzToMel(sr / 2)
        let step = maxMel / Double(nMels + 1)
        var melF = (0..<(nMels + 2)).map { melToHz(Double($0) * step) }
        melF[nMels + 1] = melToHz(maxMel)
        return (0..<nMels).map { i in
            let enorm = 2.0 / (melF[i + 2] - melF[i])
            let w = fftFreqs.map { f -> Double in
                let lower = -(melF[i] - f) / (melF[i + 1] - melF[i])
                let upper = (melF[i + 2] - f) / (melF[i + 2] - melF[i + 1])
                return Double(Float(Double(Float(max(0, min(lower, upper)))) * enorm))
            }
            let first = w.firstIndex { $0 > 0 } ?? 0
            let last = w.lastIndex { $0 > 0 } ?? 0
            return MelFilter(first: first, weights: Array(w[first...last]))
        }
    }()

    static func hzToMel(_ f: Double) -> Double {
        let fSp = 200.0 / 3, minLogHz = 1000.0, logStep = log(6.4) / 27
        return f >= minLogHz ? minLogHz / fSp + log(f / minLogHz) / logStep : f / fSp
    }

    static func melToHz(_ m: Double) -> Double {
        let fSp = 200.0 / 3, minLogHz = 1000.0, logStep = log(6.4) / 27
        let minLogMel = minLogHz / fSp
        return m >= minLogMel ? minLogHz * exp(logStep * (m - minLogMel)) : fSp * m
    }

    /// `librosa.util.peak_pick(method="greedy")`.
    static func pickPeaks(_ x: [Double], preMax: Int, postMax: Int, preAvg: Int, postAvg: Int, delta: Double, wait: Int) -> [Int] {
        let n = x.count
        func maxOf(_ a: Int, _ b: Int) -> Double { x[a..<b].max()! }
        func meanOf(_ a: Int, _ b: Int) -> Double { x[a..<b].reduce(0, +) / Double(b - a) }
        var peaks: [Int] = []
        var i = 1
        if x[0] >= maxOf(0, min(postMax, n)) && x[0] >= meanOf(0, min(postAvg, n)) + delta {
            peaks.append(0)
            i = wait + 1
        }
        while i < n {
            guard x[i] == maxOf(max(0, i - preMax), min(i + postMax, n)),
                  x[i] >= meanOf(max(0, i - preAvg), min(i + postAvg, n)) + delta
            else {
                i += 1
                continue
            }
            peaks.append(i)
            i += wait + 1
        }
        return peaks
    }
}
