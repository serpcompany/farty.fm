import AVFAudio
import Foundation

/// Renders a Song played by Recordings: a port of the reference engine's `render()` with
/// `tune=1` (`tools/melody-lab/engine.py`).
///
/// Fart-only (ADR 0004): every output sample comes from a Recording's own waveform. Per note,
/// the renderer trims (the gesture, then the note length), resamples (`Resampling`), fades and
/// sets the gain; then it mixes the notes and limits the peak. There are no oscillators, noise
/// generators, resonators, loops or granular re-triggering. Silent Recordings render silence.
public enum Renderer {
    /// Output sample rate, the same as Recording Analysis.
    public static let sampleRate = analysisSampleRate
    /// Silence between consecutive notes: a note plays for its length minus this.
    public static let gapSeconds = 0.025
    /// A note never plays shorter than this, even when its length minus the gap is shorter.
    static let shortestNoteSeconds = 0.06
    static let fadeInSeconds = 0.003
    /// The fade-out is this long, or a third of the note if that is shorter. Squared curve.
    static let longestFadeOutSeconds = 0.03
    /// Each note is set to this RMS level over its first `levelWindowSeconds`.
    static let noteLevelDB = -20.0
    static let levelWindowSeconds = 0.25
    /// Extra gain for notes that start a bar.
    static let downbeatAccentDB = 1.5
    /// Silence after the last beat, so the last note can ring out.
    static let tailSeconds = 1.0
    /// The limiter's drive and output peak (0.89 is about −1 dBFS).
    static let limiterDrive = 1.2
    static let limiterPeak = 0.89

    /// One Melodic Recording, ready to play notes.
    public struct Source: Sendable {
        /// The Recording's single clean gesture, mono at 44.1 kHz.
        public var gesture: [Double]
        /// The gesture's pitch contour in Hz, one value per 256 samples, NaN when unvoiced.
        public var pitchContourHz: [Double]
        /// The Recording Pitch in MIDI.
        public var recordingPitchMIDI: Double

        public init(gesture: [Double], pitchContourHz: [Double], recordingPitchMIDI: Double) {
            self.gesture = gesture
            self.pitchContourHz = pitchContourHz
            self.recordingPitchMIDI = recordingPitchMIDI
        }
    }

    /// One note of the Song and the Recording that plays it (one row of an Arrangement).
    public struct Note: Sendable {
        public var source: Source
        /// The pitch to play, in MIDI.
        public var targetMIDI: Double
        /// When the note starts, in seconds from the start of the Song.
        public var startSeconds: Double
        /// The note's written length in seconds (beats × 60 / bpm).
        public var lengthSeconds: Double
        /// The note starts a bar, so it is played slightly louder.
        public var isDownbeat: Bool

        public init(source: Source, targetMIDI: Double, startSeconds: Double, lengthSeconds: Double, isDownbeat: Bool) {
            self.source = source
            self.targetMIDI = targetMIDI
            self.startSeconds = startSeconds
            self.lengthSeconds = lengthSeconds
            self.isDownbeat = isDownbeat
        }

        /// A note of a Song as the catalog writes it, in beats. Converts to seconds and finds
        /// downbeats exactly like the reference, so notes land on the same samples.
        ///
        /// - Parameters:
        ///   - startBeats: The note's start in beats from the start of the Song.
        ///   - lengthBeats: The note's written length in beats.
        ///   - bpm: The tempo the Song is played at.
        ///   - beatsPerBar: The Song's beats per bar; a note starting a bar is a downbeat.
        public init(source: Source, targetMIDI: Double, startBeats: Double, lengthBeats: Double, bpm: Double, beatsPerBar: Double) {
            let secondsPerBeat = 60 / bpm
            let bar = startBeats / beatsPerBar
            self.init(source: source, targetMIDI: targetMIDI, startSeconds: startBeats * secondsPerBeat,
                      lengthSeconds: lengthBeats * secondsPerBeat,
                      isDownbeat: abs(bar - bar.rounded(.toNearestOrEven)) < 1e-6)
        }
    }

    /// The length of a Song in seconds, for `render(_:songSeconds:)`.
    public static func songSeconds(lengthBeats: Double, bpm: Double) -> Double {
        lengthBeats * (60 / bpm)
    }

    /// Where and how loud a note was placed.
    public struct PlacedNote: Sendable, Equatable {
        public var startSample: Int
        public var lengthSamples: Int
        public var gainDB: Double
        /// The pitch shift used, in semitones (target minus Recording Pitch, to 0.01).
        public var shiftSemitones: Double
    }

    public struct Output: Sendable {
        /// Mono, 44.1 kHz, peak at about −1 dBFS.
        public var samples: [Float]
        public var notes: [PlacedNote]
    }

    /// Renders the notes offline.
    ///
    /// - Parameters:
    ///   - notes: The Song's notes with the Recording that plays each one.
    ///   - songSeconds: The Song's length, `songSeconds(lengthBeats:bpm:)`. The output is one second
    ///     longer.
    public static func render(_ notes: [Note], songSeconds: Double) -> Output {
        let sr = Double(sampleRate)
        var mix = [Double](repeating: 0, count: Int((songSeconds + tailSeconds) * sr))
        var placed: [PlacedNote] = []
        placed.reserveCapacity(notes.count)

        for note in notes {
            let start = Int(note.startSeconds * sr)
            let maxLength = Int(max(shortestNoteSeconds, note.lengthSeconds - gapSeconds) * sr)
            // The reference rounds the shift to 0.01 semitone (at most 0.5 cent).
            let shift = ((note.targetMIDI - note.source.recordingPitchMIDI) * 100).rounded() / 100
            var segment = Resampling.variableResample(
                note.source.gesture, f0: note.source.pitchContourHz, ratio: pow(2, shift / 12), tune: 1,
                outputLength: maxLength, referenceMIDI: note.source.recordingPitchMIDI)
            applyFades(&segment)

            let measured = segment.prefix(Int(levelWindowSeconds * sr))
            let rms = (measured.reduce(0) { $0 + $1 * $1 } / Double(max(1, measured.count))).squareRoot() + 1e-9
            let gainDB = noteLevelDB - 20 * log10(rms) + (note.isDownbeat ? downbeatAccentDB : 0)
            let gain = pow(10, gainDB / 20)

            let end = min(mix.count, start + segment.count)
            if start < end {
                for i in start..<end { mix[i] += segment[i - start] * gain }
            }
            placed.append(PlacedNote(startSample: start, lengthSamples: segment.count, gainDB: gainDB, shiftSemitones: shift))
        }

        return Output(samples: limit(mix), notes: placed)
    }

    /// Linear 3 ms fade-in and a squared fade-out of up to 30 ms (a third of the note if shorter).
    static func applyFades(_ segment: inout [Double]) {
        let sr = Double(sampleRate)
        let n = segment.count
        let fadeIn = min(n, Int(fadeInSeconds * sr))
        for i in 0..<fadeIn {
            segment[i] *= fadeIn > 1 ? Double(i) / Double(fadeIn - 1) : 0
        }
        let fadeOut = min(n, Int(min(longestFadeOutSeconds, Double(n) / sr / 3) * sr))
        for i in 0..<fadeOut {
            let ramp = fadeOut > 1 ? 1 - Double(i) / Double(fadeOut - 1) : 1
            segment[n - fadeOut + i] *= ramp * ramp
        }
    }

    /// The gentle tanh limiter: peak to about −1 dBFS. Silence stays silence.
    static func limit(_ mix: [Double]) -> [Float] {
        let peak = mix.reduce(0) { max($0, abs($1)) }
        guard peak > 0 else { return [Float](repeating: 0, count: mix.count) }
        let knee = tanh(limiterDrive)
        return mix.map { Float(tanh($0 / peak * limiterDrive) / knee * limiterPeak) }
    }

    /// Writes mono 44.1 kHz audio: `.wav` as 16-bit PCM, `.m4a` as AAC.
    public static func write(_ samples: [Float], to url: URL) throws {
        var settings: [String: Any] = [AVSampleRateKey: sampleRate, AVNumberOfChannelsKey: 1]
        switch url.pathExtension.lowercased() {
        case "m4a":
            settings[AVFormatIDKey] = kAudioFormatMPEG4AAC
            settings[AVEncoderAudioQualityKey] = AVAudioQuality.high.rawValue
        default:
            settings[AVFormatIDKey] = kAudioFormatLinearPCM
            settings[AVLinearPCMBitDepthKey] = 16
            settings[AVLinearPCMIsFloatKey] = false
            settings[AVLinearPCMIsBigEndianKey] = false
        }
        let file = try AVAudioFile(forWriting: url, settings: settings, commonFormat: .pcmFormatFloat32, interleaved: false)
        guard let buffer = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: AVAudioFrameCount(samples.count)) else {
            throw AudioDecoder.Failure.cannotAllocateBuffer
        }
        samples.withUnsafeBufferPointer { src in
            if let base = src.baseAddress { buffer.floatChannelData![0].update(from: base, count: samples.count) }
        }
        buffer.frameLength = AVAudioFrameCount(samples.count)
        try file.write(from: buffer)
        file.close()
    }
}

extension RecordingAnalyzer {
    public enum RenderSourceError: Error, Equatable {
        /// Only Melodic Recordings can play notes.
        case noiseLike
        /// The analysis is from an older version: re-analyze the Recording first, so the
        /// gesture, Recording Pitch and recomputed contour all come from the same analysis.
        case staleAnalysis(version: Int)
    }

    /// What the renderer needs from a Melodic Recording: its gesture, cut from the file at the
    /// stored analysis's bounds, and the gesture's pitch contour. The contour isn't stored in
    /// `RecordingAnalysis`, so this recomputes it with the same pYIN pass the analysis uses.
    /// Throws `staleAnalysis` if `analysis` is older than `RecordingAnalysis.currentVersion`.
    ///
    /// Synchronous and CPU-bound: call it off the main actor.
    public static func renderSource(fileAt url: URL, analysis: RecordingAnalysis) throws -> Renderer.Source {
        guard analysis.version == RecordingAnalysis.currentVersion else {
            throw RenderSourceError.staleAnalysis(version: analysis.version)
        }
        guard let recordingPitch = analysis.recordingPitchMIDI else { throw RenderSourceError.noiseLike }
        return try renderSource(fileAt: url, gestureStartSeconds: analysis.gestureStartSeconds,
                                gestureEndSeconds: analysis.gestureEndSeconds, recordingPitchMIDI: recordingPitch)
    }

    /// The same from the parts of a stored analysis the renderer uses. The caller makes sure
    /// they come from an analysis of `RecordingAnalysis.currentVersion`.
    ///
    /// Synchronous and CPU-bound: call it off the main actor.
    public static func renderSource(fileAt url: URL, gestureStartSeconds: Double, gestureEndSeconds: Double,
                                    recordingPitchMIDI: Double) throws -> Renderer.Source {
        let y = try AudioDecoder.decodeMono(fileAt: url)
        let sr = Double(analysisSampleRate)
        let start = min(y.count, Int((gestureStartSeconds * sr).rounded()))
        let end = min(y.count, max(start, Int((gestureEndSeconds * sr).rounded())))
        let gesture = y[start..<end].map(Double.init)
        return Renderer.Source(gesture: gesture, pitchContourHz: RecordingPitch.contour(gesture), recordingPitchMIDI: recordingPitchMIDI)
    }
}
