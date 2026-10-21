import Accelerate
import Foundation

/// Probabilistic YIN pitch tracking: a step-by-step port of librosa 1.0.0's
/// `pyin(y, fmin=45, fmax=900, sr=44100, frame_length=2048, hop_length=256)` with all of
/// librosa's other defaults (centered, zero-padded frames; 100 thresholds with a Beta(2, 18)
/// prior; Boltzmann trough prior 2; 0.1-semitone pitch bins starting at fmin; a voicing HMM
/// with 35.92 octaves/s maximum transition rate, switch probability 0.01, decoded with
/// Viterbi over transitions of probability at least 1e-4).
///
/// The pitch grid matters: Recording Pitches sit on it (MIDI x.x259), so the port keeps the
/// reference's bins, its rounding (half to even) and its tie-breaking.
package struct PYIN: Sendable {
    package struct Output: Sendable {
        /// Hz per frame, NaN when unvoiced.
        package var f0: [Double]
        package var voiced: [Bool]
        var voicedProbability: [Double]
    }

    static let shared = PYIN()

    static let sampleRate = 44_100.0
    static let frameLength = 2048
    static let hopLength = 256
    static let fmin = 45.0
    /// The highest pitch Recording Analysis looks for. The render checks (`evaluate.py`) read
    /// renders back with a 1200 Hz ceiling instead: `PYIN(fmax: 1200)`.
    static let fmax = 900.0

    let minPeriod: Int
    let maxPeriod: Int
    let pitchBins: Int
    let binsPerOctave: Double
    let thresholds: [Double]
    let betaProbs: [Double]
    /// `beta_probs[:n].sum()` for every n.
    let betaHeadSums: [Double]
    /// Boltzmann normalization `(1 - e^-2) / (1 - e^(-2N))` for N troughs.
    let boltzmannFactor: [Double]
    /// `e^(-2k)`.
    let boltzmannDecay: [Double]
    /// Bin center frequencies.
    let freqs: [Double]
    /// Viterbi predecessors of each state (voiced bins, then unvoiced bins), ascending.
    let predOffsets: [Int]
    let predStates: [Int32]
    let predLogTransition: [Double]
    let logInitial: Double

    static let tiny = Double.leastNormalMagnitude

    package init(fmax: Double = PYIN.fmax) {
        let sr = Self.sampleRate
        minPeriod = Int((sr / fmax).rounded(.down))
        maxPeriod = min(Int((sr / Self.fmin).rounded(.up)), Self.frameLength - 1)
        let binsPerSemitone = Int((1.0 / 0.1).rounded(.up))
        binsPerOctave = Double(12 * binsPerSemitone)
        pitchBins = Int((binsPerOctave * log2(fmax / Self.fmin)).rounded(.down)) + 1

        // Prior over thresholds: np.diff(scipy.stats.beta.cdf(np.linspace(0, 1, 101), 2, 18)).
        // For integer shape parameters the regularized incomplete beta function has a closed
        // form: I_x(2, 18) = 1 - (1-x)^19 - 19 x (1-x)^18.
        var t = (0...100).map { Double($0) * 0.01 }
        t[100] = 1.0
        thresholds = t
        let cdf = t.map { x in 1 - pow(1 - x, 19) - 19 * x * pow(1 - x, 18) }
        let beta = (0..<100).map { cdf[$0 + 1] - cdf[$0] }
        betaProbs = beta
        betaHeadSums = (0...100).map { n in beta.withUnsafeBufferPointer { pairwiseSum($0, 0, n) } }

        let maxTroughs = maxPeriod - minPeriod + 2
        boltzmannFactor = (0...maxTroughs).map { n in (1 - exp(-2.0)) / (1 - exp(-2.0 * Double(n))) }
        boltzmannDecay = (0...maxTroughs).map { k in exp(-2.0 * Double(k)) }

        let bpo = binsPerOctave
        freqs = (0..<pitchBins).map { Self.fmin * pow(2.0, Double($0) / bpo) }

        // Transition matrix: a triangular local window within voiced and within unvoiced
        // bins (sequence.transition_local), times the voicing switch (transition_loop(2, 0.99)).
        let maxSemitonesPerFrame = Int((35.92 * 12 * Double(Self.hopLength) / sr).rounded(.toNearestOrEven))
        let width = maxSemitonesPerFrame * binsPerSemitone + 1
        let half = width / 2
        let n = pitchBins
        let window = (1...(half + 1)).map { 2 * Double($0) / (Double(width) + 1) }  // scipy triang, rising half
        func w(_ d: Int) -> Double { window[half - d] }
        var rowSum = [Double](repeating: 0, count: n)
        for i in 0..<n {
            var s = 0.0
            for j in max(0, i - half)...min(n - 1, i + half) { s += w(abs(i - j)) }
            rowSum[i] = s
        }
        func local(_ i: Int, _ j: Int) -> Double {
            abs(i - j) <= half ? w(abs(i - j)) / rowSum[i] : 0
        }
        let stay = 0.99
        let switchProb = (1.0 - stay) / 1.0
        let logThreshold = log(1e-4 + Self.tiny)
        var offsets = [0]
        var states: [Int32] = []
        var logs: [Double] = []
        for target in 0..<(2 * n) {
            let tv = target < n
            let tj = target % n
            for source in 0..<(2 * n) {
                let sv = source < n
                let si = source % n
                guard abs(si - tj) <= half else { continue }
                let p = (sv == tv ? stay : switchProb) * local(si, tj)
                let lp = log(p + Self.tiny)
                if lp >= logThreshold {
                    states.append(Int32(source))
                    logs.append(lp)
                }
            }
            offsets.append(states.count)
        }
        predOffsets = offsets
        predStates = states
        predLogTransition = logs
        logInitial = log(1.0 / Double(2 * n) + Self.tiny)
    }

    package func callAsFunction(_ y: [Double]) -> Output {
        let frameLength = Self.frameLength
        let hop = Self.hopLength
        let nFrames = 1 + y.count / hop
        let nStates = 2 * pitchBins
        let nYin = maxPeriod - minPeriod + 1
        let fftLength = 4096  // scipy.fft.next_fast_len(2 * 2048 - 1)
        let log2n = vDSP_Length(12)

        // Zero-padded signal so frame t is centered on y[t * hop].
        var padded = [Double](repeating: 0, count: y.count + frameLength)
        padded.withUnsafeMutableBufferPointer { p in
            y.withUnsafeBufferPointer { src in
                if !src.isEmpty {
                    (p.baseAddress! + frameLength / 2).update(from: src.baseAddress!, count: src.count)
                }
            }
        }

        guard let setup = vDSP_create_fftsetupD(log2n, FFTRadix(kFFTRadix2)) else {
            fatalError("vDSP FFT setup failed")
        }
        defer { vDSP_destroy_fftsetupD(setup) }

        var fftIn = [Double](repeating: 0, count: fftLength)
        var re = [Double](repeating: 0, count: fftLength / 2)
        var im = [Double](repeating: 0, count: fftLength / 2)
        var acf = [Double](repeating: 0, count: fftLength)
        var energy = [Double](repeating: 0, count: maxPeriod)
        var diff = [Double](repeating: 0, count: maxPeriod + 1)
        var yin = [Double](repeating: 0, count: nYin)
        var shifts = [Double](repeating: 0, count: nYin)
        var troughs: [Int] = []
        var firstBelow: [Int] = []
        var troughProbs: [Double] = []
        var countBelow = [Int](repeating: 0, count: 100)
        var obsVoiced = [Double](repeating: 0, count: pitchBins)
        var touched: [Int] = []
        var logObs = [Double](repeating: 0, count: nStates)
        var value = [Double](repeating: 0, count: nStates)
        var next = [Double](repeating: 0, count: nStates)
        var ptr = [UInt16](repeating: 0, count: nFrames * nStates)
        var voicedProbability = [Double](repeating: 0, count: nFrames)
        let logTiny = log(Self.tiny)
        let fftScale = 1.0 / Double(4 * fftLength)
        let sr = Self.sampleRate

        for t in 0..<nFrames {
            // 1. Autocorrelation of the frame (librosa.autocorrelate, via FFT).
            padded.withUnsafeBufferPointer { p in
                fftIn.withUnsafeMutableBufferPointer { f in
                    f.baseAddress!.update(from: p.baseAddress! + t * hop, count: frameLength)
                }
            }
            re.withUnsafeMutableBufferPointer { rp in
                im.withUnsafeMutableBufferPointer { ip in
                    var split = DSPDoubleSplitComplex(realp: rp.baseAddress!, imagp: ip.baseAddress!)
                    fftIn.withUnsafeBufferPointer { f in
                        f.baseAddress!.withMemoryRebound(to: DSPDoubleComplex.self, capacity: fftLength / 2) {
                            vDSP_ctozD($0, 2, &split, 1, vDSP_Length(fftLength / 2))
                        }
                    }
                    vDSP_fft_zripD(setup, &split, 1, log2n, FFTDirection(FFT_FORWARD))
                    // Power spectrum. Packed format: DC in realp[0], Nyquist in imagp[0].
                    let dc = rp[0], nyquist = ip[0]
                    rp[0] = dc * dc
                    ip[0] = nyquist * nyquist
                    for k in 1..<(fftLength / 2) {
                        let a = rp[k], b = ip[k]
                        rp[k] = a * a + b * b
                        ip[k] = 0
                    }
                    vDSP_fft_zripD(setup, &split, 1, log2n, FFTDirection(FFT_INVERSE))
                    acf.withUnsafeMutableBufferPointer { out in
                        out.baseAddress!.withMemoryRebound(to: DSPDoubleComplex.self, capacity: fftLength / 2) {
                            vDSP_ztocD(&split, 1, $0, 2, vDSP_Length(fftLength / 2))
                        }
                    }
                }
            }

            // 2. Cumulative mean normalized difference (_cumulative_mean_normalized_difference).
            padded.withUnsafeBufferPointer { p in
                let frame = p.baseAddress! + t * hop
                var e = 0.0
                for m in 0..<maxPeriod {
                    e += frame[m] * frame[m]
                    energy[m] = e
                }
            }
            let acf0 = acf[0] * fftScale
            diff[0] = 0
            // librosa zeroes the first energy term before using it: d(1) subtracts 0.
            diff[1] = 2 * (acf0 - acf[1] * fftScale) - 0
            if maxPeriod >= 2 {
                for k in 2...maxPeriod {
                    diff[k] = 2 * (acf0 - acf[k] * fftScale) - energy[k - 1]
                }
            }
            var cumulative = 0.0
            for k in 1...maxPeriod {
                cumulative += diff[k]
                if k >= minPeriod {
                    let mean = cumulative / Double(k)
                    yin[k - minPeriod] = diff[k] / (mean + Self.tiny)
                }
            }

            // 3. Parabolic interpolation offsets (_parabolic_interpolation).
            shifts[0] = 0
            shifts[nYin - 1] = 0
            for i in 1..<(nYin - 1) {
                let a = yin[i + 1] + yin[i - 1] - 2 * yin[i]
                let b = (yin[i + 1] - yin[i - 1]) / 2
                shifts[i] = abs(b) >= abs(a) ? 0 : -b / a
            }

            // 4. Troughs and their probabilities (__pyin_helper).
            troughs.removeAll(keepingCapacity: true)
            if yin[0] < yin[1] { troughs.append(0) }
            for i in 1..<(nYin - 1) where yin[i] < yin[i - 1] && yin[i] <= yin[i + 1] {
                troughs.append(i)
            }
            if yin[nYin - 1] < yin[nYin - 2] { troughs.append(nYin - 1) }

            for b in touched { obsVoiced[b] = 0 }
            touched.removeAll(keepingCapacity: true)
            var voicedProb = 0.0
            if !troughs.isEmpty {
                // firstBelow[t]: the first threshold index j with height < thresholds[j + 1].
                firstBelow.removeAll(keepingCapacity: true)
                for j in 0..<100 { countBelow[j] = 0 }
                for idx in troughs {
                    let h = yin[idx]
                    var j = 0
                    while j < 100 && !(h < thresholds[j + 1]) { j += 1 }
                    firstBelow.append(j)
                    if j < 100 { countBelow[j] += 1 }
                }
                for j in 1..<100 { countBelow[j] += countBelow[j - 1] }
                troughProbs.removeAll(keepingCapacity: true)
                troughProbs.append(contentsOf: repeatElement(0.0, count: troughs.count))
                for j in 0..<100 {
                    let nBelow = countBelow[j]
                    if nBelow == 0 { continue }
                    let factor = boltzmannFactor[nBelow]
                    let beta = betaProbs[j]
                    var rank = 0
                    for (ti, fb) in firstBelow.enumerated() where fb <= j {
                        troughProbs[ti] += factor * boltzmannDecay[rank] * beta
                        rank += 1
                    }
                }
                var globalMin = 0
                for ti in 1..<troughs.count where yin[troughs[ti]] < yin[troughs[globalMin]] {
                    globalMin = ti
                }
                troughProbs[globalMin] += 0.01 * betaHeadSums[firstBelow[globalMin]]

                // Pitch bin of each candidate; later (longer-period) candidates overwrite.
                for (ti, idx) in troughs.enumerated() where troughProbs[ti] != 0 {
                    let period = Double(minPeriod + idx) + shifts[idx]
                    let f0 = sr / period
                    let bin = min(max((binsPerOctave * log2(f0 / Self.fmin)).rounded(.toNearestOrEven), 0), Double(pitchBins))
                    let b = Int(bin)
                    if b < pitchBins {
                        if obsVoiced[b] == 0 { touched.append(b) }
                        obsVoiced[b] = troughProbs[ti]
                    }
                }
                touched.sort()
                var sum = 0.0
                for b in touched { sum += obsVoiced[b] }
                voicedProb = min(max(sum, 0), 1)
            }
            voicedProbability[t] = voicedProb

            // 5. One Viterbi step (sequence.viterbi with transition_min_prob=1e-4).
            for b in 0..<pitchBins { logObs[b] = logTiny }
            for b in touched { logObs[b] = log(obsVoiced[b] + Self.tiny) }
            let unvoicedLog = log((1 - voicedProb) / Double(pitchBins) + Self.tiny)
            for s in pitchBins..<nStates { logObs[s] = unvoicedLog }

            if t == 0 {
                for s in 0..<nStates { value[s] = logObs[s] + logInitial }
                continue
            }
            value.withUnsafeBufferPointer { prev in
                next.withUnsafeMutableBufferPointer { cur in
                    ptr.withUnsafeMutableBufferPointer { ptrs in
                        predOffsets.withUnsafeBufferPointer { offsets in
                            predStates.withUnsafeBufferPointer { states in
                                predLogTransition.withUnsafeBufferPointer { logs in
                                    let row = t * nStates
                                    for j in 0..<nStates {
                                        var best = -Double.infinity
                                        var bestK: Int32 = 0
                                        for q in offsets[j]..<offsets[j + 1] {
                                            let k = states[q]
                                            let cost = prev[Int(k)] + logs[q]
                                            if cost > best {
                                                best = cost
                                                bestK = k
                                            }
                                        }
                                        ptrs[row + j] = UInt16(bestK)
                                        cur[j] = logObs[j] + best
                                    }
                                }
                            }
                        }
                    }
                }
            }
            swap(&value, &next)
        }

        // Backtrack from the best final state (first maximum).
        var state = 0
        for s in 1..<nStates where value[s] > value[state] { state = s }
        var states = [Int](repeating: 0, count: nFrames)
        states[nFrames - 1] = state
        if nFrames >= 2 {
            for t in stride(from: nFrames - 2, through: 0, by: -1) {
                states[t] = Int(ptr[(t + 1) * nStates + states[t + 1]])
            }
        }
        let voiced = states.map { $0 < pitchBins }
        let f0 = states.map { $0 < pitchBins ? freqs[$0] : Double.nan }
        return Output(f0: f0, voiced: voiced, voicedProbability: voicedProbability)
    }
}

/// numpy's pairwise summation of `a[start ..< start + n]` (what `np.sum` does on a
/// contiguous float64 array).
func pairwiseSum(_ a: UnsafeBufferPointer<Double>, _ start: Int, _ n: Int) -> Double {
    if n < 8 {
        var res = 0.0
        for i in 0..<n { res += a[start + i] }
        return res
    } else if n <= 128 {
        var r = (0..<8).map { a[start + $0] }
        var i = 8
        while i < n - (n % 8) {
            for j in 0..<8 { r[j] += a[start + i + j] }
            i += 8
        }
        var res = ((r[0] + r[1]) + (r[2] + r[3])) + ((r[4] + r[5]) + (r[6] + r[7]))
        while i < n {
            res += a[start + i]
            i += 1
        }
        return res
    } else {
        var n2 = n / 2
        n2 -= n2 % 8
        return pairwiseSum(a, start, n2) + pairwiseSum(a, start + n2, n - n2)
    }
}

/// librosa.hz_to_midi.
@inline(__always) package func hzToMIDI(_ hz: Double) -> Double {
    12 * (log2(hz) - log2(440.0)) + 69
}

/// librosa.midi_to_hz.
@inline(__always) func midiToHz(_ midi: Double) -> Double {
    440.0 * pow(2.0, (midi - 69.0) / 12.0)
}
