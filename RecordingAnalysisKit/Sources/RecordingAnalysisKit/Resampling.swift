import Foundation

/// The core render primitive: reading a Recording's own waveform at a variable rate.
///
/// Fart-only (ADR 0004): every output sample is interpolated from the input Recording. The
/// only operations are a low-pass filter before reading faster than 1x (anti-aliasing) and
/// cubic interpolation. No oscillators, resonators, loops or granular re-triggering.
public enum Resampling {
    /// Samples per pitch-contour frame.
    public static let hopLength = 256

    /// Reads `x` at a rate that can change every `hopLength` input samples; a rate above 1
    /// raises the pitch. Port of the reference engine's `variable_resample()`.
    ///
    /// - Parameters:
    ///   - x: The Recording's gesture, mono at 44.1 kHz.
    ///   - f0: Its pitch contour in Hz, one value per `hopLength` samples of `x`, NaN when unvoiced.
    ///   - ratio: The constant rate, `2^(semitones / 12)` for a shift in semitones.
    ///   - tune: 0 keeps a constant rate (plain transposition, the fart keeps its natural glide).
    ///     1 makes the rate follow the pitch contour so the note holds steady on
    ///     `referenceMIDI × ratio`. Deviations are clipped to ±5 semitones and interpolated
    ///     across unvoiced frames.
    ///   - outputLength: How many samples to produce. Fewer come back if `x` runs out first.
    ///   - referenceMIDI: The pitch the contour is pulled toward (the Recording Pitch); nil
    ///     disables tuning.
    /// - Returns: The resampled audio.
    public static func variableResample(
        _ x: [Double], f0: [Double], ratio: Double, tune: Double, outputLength: Int, referenceMIDI: Double?
    ) -> [Double] {
        let nHops = f0.count
        var hopRate = [Double](repeating: ratio, count: max(1, nHops))
        if tune > 0, let reference = referenceMIDI, nHops > 0 {
            let known = (0..<nHops).filter { f0[$0].isFinite }
            if known.count >= 2 {
                let deviation = known.map { reference - hzToMIDI(f0[$0]) }  // semitones toward reference
                let interpolated = interp((0..<nHops).map(Double.init), xp: known.map(Double.init), fp: deviation)
                hopRate = interpolated.map { ratio * pow(2.0, tune * min(max($0, -5), 5) / 12) }
            }
        }

        // Anti-alias when reading faster than 1x.
        var source = x
        let fastest = hopRate.max()!
        if fastest > 1.02, x.count > 3 * 9 {
            let (b, a) = Butterworth.lowpass(order: 8, cutoff: min(0.95, 0.9 / fastest))
            source = Butterworth.filtfilt(b: b, a: a, x)
        }

        var positions = [Double]()
        positions.reserveCapacity(max(0, outputLength))
        var p = 0.0
        let end = Double(source.count - 2)
        for _ in 0..<max(0, outputLength) {
            if p >= end { break }
            positions.append(p)
            p += hopRate[min(hopRate.count - 1, Int(p / Double(hopLength)))]
        }
        return cubicRead(source, at: positions)
    }

    /// Catmull-Rom cubic interpolation of `x` at fractional sample positions (indices outside
    /// `x` are clamped to its ends). Port of the reference engine's `_cubic_read()`.
    public static func cubicRead(_ x: [Double], at positions: [Double]) -> [Double] {
        guard !x.isEmpty else { return [Double](repeating: 0, count: positions.count) }
        let last = x.count - 1
        return x.withUnsafeBufferPointer { x in
            positions.map { pos in
                let i = Int(pos.rounded(.down))
                let f = pos - Double(i)
                let xm1 = x[min(max(i - 1, 0), last)]
                let x0 = x[min(max(i, 0), last)]
                let x1 = x[min(max(i + 1, 0), last)]
                let x2 = x[min(max(i + 2, 0), last)]
                let c1 = 0.5 * (x1 - xm1)
                let c2 = xm1 - 2.5 * x0 + 2 * x1 - 0.5 * x2
                let c3 = 0.5 * (x2 - xm1) + 1.5 * (x0 - x1)
                return ((c3 * f + c2) * f + c1) * f + x0
            }
        }
    }

    /// `np.interp(x, xp, fp)` for increasing `xp`: linear in between, the end values outside.
    static func interp(_ x: [Double], xp: [Double], fp: [Double]) -> [Double] {
        var j = 0
        return x.map { v in
            if v < xp[0] { return fp[0] }
            if v >= xp[xp.count - 1] { return fp[fp.count - 1] }
            while xp[j + 1] <= v { j += 1 }
            if xp[j] == v { return fp[j] }
            let slope = (fp[j + 1] - fp[j]) / (xp[j + 1] - xp[j])
            return slope * (v - xp[j]) + fp[j]
        }
    }
}

/// Digital Butterworth low-pass design and zero-phase filtering, ported from
/// `scipy.signal.butter(N, Wn, btype="low")` and `scipy.signal.filtfilt(b, a, x)`.
enum Butterworth {
    /// Transfer function `(b, a)` of an order-`order` low-pass with cutoff `cutoff` × Nyquist.
    static func lowpass(order: Int, cutoff: Double) -> (b: [Double], a: [Double]) {
        // Analog prototype poles (buttap), pre-warped cutoff, lp2lp, then the bilinear transform.
        let fs = 2.0
        let warped = 2 * fs * tan(Double.pi * cutoff / fs)
        let poles = stride(from: -order + 1, to: order, by: 2).map { m -> Complex in
            let theta = Double.pi * Double(m) / Double(2 * order)
            return Complex(-cos(theta), -sin(theta)).scaled(by: warped)
        }
        let gain = pow(warped, Double(order))
        let fs2 = Complex(2 * fs, 0)
        let digitalPoles = poles.map { (fs2 + $0) / (fs2 - $0) }
        var denominator = Complex(1, 0)
        for p in poles { denominator = denominator * (fs2 - p) }
        let k = gain * (Complex(1, 0) / denominator).re

        // zpk2tf: b = k * poly(zeros at -1), a = poly(poles).
        var b = [Complex(1, 0)]
        for _ in 0..<order { b = convolveWithRoot(b, Complex(-1, 0)) }
        var a = [Complex(1, 0)]
        for p in digitalPoles { a = convolveWithRoot(a, p) }
        return (b.map { k * $0.re }, a.map(\.re))
    }

    /// `scipy.signal.filtfilt(b, a, x)`: forward and backward, with odd extension of
    /// 3 × max(len(a), len(b)) samples and steady-state initial conditions.
    static func filtfilt(b: [Double], a: [Double], _ x: [Double]) -> [Double] {
        let edge = 3 * max(a.count, b.count)
        precondition(x.count > edge, "filtfilt needs more than \(edge) samples")
        let n = x.count
        var ext = [Double]()
        ext.reserveCapacity(n + 2 * edge)
        for i in stride(from: edge, through: 1, by: -1) { ext.append(2 * x[0] - x[i]) }
        ext.append(contentsOf: x)
        for i in 2...(edge + 1) { ext.append(2 * x[n - 1] - x[n - i]) }

        let zi = steadyState(b: b, a: a)
        var y = lfilter(b: b, a: a, ext, zi: zi.map { $0 * ext[0] })
        y.reverse()
        let y0 = y[0]
        y = lfilter(b: b, a: a, y, zi: zi.map { $0 * y0 })
        y.reverse()
        return Array(y[edge..<(edge + n)])
    }

    /// `scipy.signal.lfilter_zi(b, a)` (scipy 1.18): the state for a unit step's steady state.
    static func steadyState(b: [Double], a: [Double]) -> [Double] {
        let yInf = b.withUnsafeBufferPointer { pairwiseSum($0, 0, b.count) }
            / a.withUnsafeBufferPointer { pairwiseSum($0, 0, a.count) }
        let v = zip(b, a).map { $0 - yInf * $1 }
        var zi = [Double](repeating: 0, count: v.count - 1)
        var sum = v[v.count - 1]
        for k in stride(from: v.count - 2, through: 0, by: -1) {
            zi[k] = sum
            sum += v[k]
        }
        return zi
    }

    /// `scipy.signal.lfilter(b, a, x, zi=zi)` with `a[0] == 1`: direct form II transposed.
    static func lfilter(b: [Double], a: [Double], _ x: [Double], zi: [Double]) -> [Double] {
        var z = zi
        let order = b.count
        var y = [Double](repeating: 0, count: x.count)
        for i in 0..<x.count {
            let xn = x[i]
            let yn = z[0] + b[0] * xn
            for n in 0..<(order - 2) {
                z[n] = z[n + 1] + xn * b[n + 1] - yn * a[n + 1]
            }
            z[order - 2] = xn * b[order - 1] - yn * a[order - 1]
            y[i] = yn
        }
        return y
    }

    private static func convolveWithRoot(_ c: [Complex], _ root: Complex) -> [Complex] {
        var out = [Complex](repeating: Complex(0, 0), count: c.count + 1)
        for i in 0...c.count {
            var s = Complex(0, 0)
            if i < c.count { s = s + c[i] }
            if i > 0 { s = s + c[i - 1] * (Complex(0, 0) - root) }
            out[i] = s
        }
        return out
    }

    struct Complex {
        var re: Double
        var im: Double
        init(_ re: Double, _ im: Double) { self.re = re; self.im = im }
        func scaled(by s: Double) -> Complex { Complex(re * s, im * s) }
        static func + (l: Complex, r: Complex) -> Complex { Complex(l.re + r.re, l.im + r.im) }
        static func - (l: Complex, r: Complex) -> Complex { Complex(l.re - r.re, l.im - r.im) }
        static func * (l: Complex, r: Complex) -> Complex {
            Complex(l.re * r.re - l.im * r.im, l.re * r.im + l.im * r.re)
        }
        /// Smith's algorithm, like numpy's complex division.
        static func / (l: Complex, r: Complex) -> Complex {
            if abs(r.re) >= abs(r.im) {
                let rat = r.im / r.re
                let scl = 1.0 / (r.re + r.im * rat)
                return Complex((l.re + l.im * rat) * scl, (l.im - l.re * rat) * scl)
            } else {
                let rat = r.re / r.im
                let scl = 1.0 / (r.im + r.re * rat)
                return Complex((l.re * rat + l.im) * scl, (l.im * rat - l.re) * scl)
            }
        }
    }
}
