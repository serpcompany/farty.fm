import AVFAudio
import Foundation

public struct RecordingAnalysisResult: Codable, Sendable, Equatable {
    public let durationSeconds: Double
    public let soundBounds: SoundBounds?
    public let level: LevelAnalysis
    public let pitch: PitchAnalysis

    public init(
        durationSeconds: Double,
        soundBounds: SoundBounds?,
        level: LevelAnalysis,
        pitch: PitchAnalysis
    ) {
        self.durationSeconds = durationSeconds
        self.soundBounds = soundBounds
        self.level = level
        self.pitch = pitch
    }
}

public struct SoundBounds: Codable, Sendable, Equatable {
    public let startSeconds: Double
    public let endSeconds: Double

    public var durationSeconds: Double { endSeconds - startSeconds }

    public init(startSeconds: Double, endSeconds: Double) {
        self.startSeconds = startSeconds
        self.endSeconds = endSeconds
    }
}

public struct LevelAnalysis: Codable, Sendable, Equatable {
    /// Root-mean-square level over the detected sound bounds, relative to digital full scale.
    public let rmsDBFS: Double

    /// Highest absolute sample magnitude in the Recording, relative to digital full scale.
    public let peakDBFS: Double

    /// Windowed RMS values over the complete Recording.
    public let envelope: [EnvelopePoint]

    public init(rmsDBFS: Double, peakDBFS: Double, envelope: [EnvelopePoint]) {
        self.rmsDBFS = rmsDBFS
        self.peakDBFS = peakDBFS
        self.envelope = envelope
    }
}

public struct EnvelopePoint: Codable, Sendable, Equatable {
    public let timeSeconds: Double
    public let rmsDBFS: Double

    public init(timeSeconds: Double, rmsDBFS: Double) {
        self.timeSeconds = timeSeconds
        self.rmsDBFS = rmsDBFS
    }
}

public struct PitchAnalysis: Codable, Sendable, Equatable {
    public let status: PitchStatus

    /// Median fundamental-frequency estimate across accepted frames, or nil when unavailable.
    public let referenceFrequencyHz: Double?

    /// The same estimate on the fractional MIDI-note scale, or nil when unavailable.
    public let referenceMIDINote: Double?

    /// Accepted pitch frames divided by all analyzed frames within the detected sound bounds.
    public let voicedFrameRatio: Double

    /// Median accepted YIN periodicity multiplied by voicedFrameRatio. This is not a probability.
    public let periodicityEvidence: Double

    /// Frame-level evidence, including explicit unavailable frames.
    public let frames: [PitchFrame]

    public var isAvailable: Bool { status == .available }

    public init(
        referenceFrequencyHz: Double?,
        referenceMIDINote: Double?,
        voicedFrameRatio: Double,
        periodicityEvidence: Double,
        frames: [PitchFrame]
    ) {
        self.status = referenceFrequencyHz == nil ? .unavailable : .available
        self.referenceFrequencyHz = referenceFrequencyHz
        self.referenceMIDINote = referenceMIDINote
        self.voicedFrameRatio = voicedFrameRatio
        self.periodicityEvidence = periodicityEvidence
        self.frames = frames
    }
}

public enum PitchStatus: String, Codable, Sendable, Equatable {
    case available
    case unavailable
}

public struct PitchFrame: Codable, Sendable, Equatable {
    public let timeSeconds: Double
    public let frequencyHz: Double?
    public let periodicity: Double

    public var isAvailable: Bool { frequencyHz != nil }

    public init(timeSeconds: Double, frequencyHz: Double?, periodicity: Double) {
        self.timeSeconds = timeSeconds
        self.frequencyHz = frequencyHz
        self.periodicity = periodicity
    }
}

public struct RecordingAnalysisConfiguration: Sendable, Equatable {
    public var envelopeWindowSeconds: Double
    public var envelopeHopSeconds: Double
    public var absoluteActivityFloorDBFS: Double
    public var activityFloorBelowPeakDB: Double
    public var minimumPitchHz: Double
    public var maximumPitchHz: Double
    public var minimumPitchPeriodicity: Double
    public var minimumVoicedFrameRatio: Double

    public init(
        envelopeWindowSeconds: Double = 0.020,
        envelopeHopSeconds: Double = 0.010,
        absoluteActivityFloorDBFS: Double = -50,
        activityFloorBelowPeakDB: Double = 32,
        minimumPitchHz: Double = 45,
        maximumPitchHz: Double = 500,
        minimumPitchPeriodicity: Double = 0.80,
        minimumVoicedFrameRatio: Double = 0.25
    ) {
        self.envelopeWindowSeconds = envelopeWindowSeconds
        self.envelopeHopSeconds = envelopeHopSeconds
        self.absoluteActivityFloorDBFS = absoluteActivityFloorDBFS
        self.activityFloorBelowPeakDB = activityFloorBelowPeakDB
        self.minimumPitchHz = minimumPitchHz
        self.maximumPitchHz = maximumPitchHz
        self.minimumPitchPeriodicity = minimumPitchPeriodicity
        self.minimumVoicedFrameRatio = minimumVoicedFrameRatio
    }

    public static let `default` = RecordingAnalysisConfiguration()
}

public enum RecordingAnalysisError: LocalizedError {
    case emptyAudio
    case invalidSampleRate
    case unsupportedPCM

    public var errorDescription: String? {
        switch self {
        case .emptyAudio:
            "The Recording has no audio samples."
        case .invalidSampleRate:
            "The Recording sample rate is invalid."
        case .unsupportedPCM:
            "The Recording could not be decoded to floating-point PCM."
        }
    }
}

public enum RecordingAudioAnalyzer {
    public static let algorithmID = "pedos-yin-frame-v1"

    public static func analyze(
        samples input: [Float],
        sampleRate: Double,
        configuration: RecordingAnalysisConfiguration = .default
    ) throws -> RecordingAnalysisResult {
        guard !input.isEmpty else { throw RecordingAnalysisError.emptyAudio }
        guard sampleRate.isFinite, sampleRate > 0 else {
            throw RecordingAnalysisError.invalidSampleRate
        }

        let samples = input.map { $0.isFinite ? $0 : 0 }
        let duration = Double(samples.count) / sampleRate
        let peak = samples.reduce(0.0) { max($0, abs(Double($1))) }
        let envelope = amplitudeEnvelope(
            samples: samples,
            sampleRate: sampleRate,
            configuration: configuration
        )
        let bounds = detectSoundBounds(
            samples: samples,
            sampleRate: sampleRate,
            peak: peak,
            configuration: configuration
        )
        let activeRange = bounds.map {
            max(0, Int($0.startSeconds * sampleRate))..<min(samples.count, Int($0.endSeconds * sampleRate))
        } ?? samples.startIndex..<samples.endIndex
        let activeSamples = Array(samples[activeRange])
        let level = LevelAnalysis(
            rmsDBFS: amplitudeToDB(rootMeanSquare(activeSamples)),
            peakDBFS: amplitudeToDB(peak),
            envelope: envelope
        )
        let pitch = analyzePitch(
            samples: activeSamples,
            sampleRate: sampleRate,
            startTimeSeconds: bounds?.startSeconds ?? 0,
            configuration: configuration
        )

        return RecordingAnalysisResult(
            durationSeconds: duration,
            soundBounds: bounds,
            level: level,
            pitch: pitch
        )
    }

    private static func amplitudeEnvelope(
        samples: [Float],
        sampleRate: Double,
        configuration: RecordingAnalysisConfiguration
    ) -> [EnvelopePoint] {
        let window = max(1, Int(configuration.envelopeWindowSeconds * sampleRate))
        let hop = max(1, Int(configuration.envelopeHopSeconds * sampleRate))
        return stride(from: 0, to: samples.count, by: hop).map { start in
            let end = min(start + window, samples.count)
            return EnvelopePoint(
                timeSeconds: Double(start) / sampleRate,
                rmsDBFS: amplitudeToDB(rootMeanSquare(samples[start..<end]))
            )
        }
    }

    private static func detectSoundBounds(
        samples: [Float],
        sampleRate: Double,
        peak: Double,
        configuration: RecordingAnalysisConfiguration
    ) -> SoundBounds? {
        guard peak > 0 else { return nil }
        let window = max(1, Int(configuration.envelopeWindowSeconds * sampleRate))
        let hop = max(1, Int(configuration.envelopeHopSeconds * sampleRate))
        let absoluteFloor = dbToAmplitude(configuration.absoluteActivityFloorDBFS)
        let relativeFloor = peak * dbToAmplitude(-configuration.activityFloorBelowPeakDB)
        let threshold = max(absoluteFloor, relativeFloor)
        var first: Int?
        var last: Int?

        for start in stride(from: 0, to: samples.count, by: hop) {
            let end = min(start + window, samples.count)
            if rootMeanSquare(samples[start..<end]) >= threshold {
                first = first ?? start
                last = end
            }
        }

        guard let first, let last else { return nil }
        return SoundBounds(
            startSeconds: Double(first) / sampleRate,
            endSeconds: Double(last) / sampleRate
        )
    }

    private static func analyzePitch(
        samples: [Float],
        sampleRate: Double,
        startTimeSeconds: Double,
        configuration: RecordingAnalysisConfiguration
    ) -> PitchAnalysis {
        let downsampleFactor = max(1, Int(ceil(sampleRate / 11_025)))
        let analysisRate = sampleRate / Double(downsampleFactor)
        let downsampled = stride(from: 0, to: samples.count, by: downsampleFactor).map { start -> Float in
            let end = min(start + downsampleFactor, samples.count)
            return samples[start..<end].reduce(0, +) / Float(end - start)
        }
        let frameSize = 1024
        let hopSize = 512
        guard downsampled.count >= frameSize else {
            return PitchAnalysis(
                referenceFrequencyHz: nil,
                referenceMIDINote: nil,
                voicedFrameRatio: 0,
                periodicityEvidence: 0,
                frames: []
            )
        }

        var frames: [PitchFrame] = []
        for start in stride(from: 0, through: downsampled.count - frameSize, by: hopSize) {
            let frame = Array(downsampled[start..<(start + frameSize)])
            let time = startTimeSeconds + Double(start) / analysisRate
            guard rootMeanSquare(frame) >= dbToAmplitude(configuration.absoluteActivityFloorDBFS) else {
                frames.append(PitchFrame(timeSeconds: time, frequencyHz: nil, periodicity: 0))
                continue
            }
            let candidate = yin(
                frame: frame,
                sampleRate: analysisRate,
                minimumHz: configuration.minimumPitchHz,
                maximumHz: configuration.maximumPitchHz
            )
            let frequency = candidate.periodicity >= configuration.minimumPitchPeriodicity
                ? candidate.frequencyHz
                : nil
            frames.append(
                PitchFrame(
                    timeSeconds: time,
                    frequencyHz: frequency,
                    periodicity: candidate.periodicity
                )
            )
        }

        let available = frames.compactMap { frame -> (frequency: Double, periodicity: Double)? in
            guard let frequency = frame.frequencyHz else { return nil }
            return (frequency, frame.periodicity)
        }
        let voicedRatio = Double(available.count) / Double(frames.count)
        let accepted = voicedRatio >= configuration.minimumVoicedFrameRatio && !available.isEmpty
        let reference = accepted ? median(available.map(\.frequency)) : nil
        let evidence = available.isEmpty
            ? 0
            : median(available.map(\.periodicity)) * voicedRatio

        return PitchAnalysis(
            referenceFrequencyHz: reference,
            referenceMIDINote: reference.map(hzToMIDI),
            voicedFrameRatio: voicedRatio,
            periodicityEvidence: evidence,
            frames: frames
        )
    }

    private static func yin(
        frame: [Float],
        sampleRate: Double,
        minimumHz: Double,
        maximumHz: Double
    ) -> (frequencyHz: Double?, periodicity: Double) {
        let minimumLag = max(2, Int(sampleRate / maximumHz))
        let maximumLag = min(frame.count / 2, Int(sampleRate / minimumHz))
        guard minimumLag < maximumLag else { return (nil, 0) }

        var difference = Array(repeating: 0.0, count: maximumLag + 1)
        for lag in 1...maximumLag {
            var sum = 0.0
            for index in 0..<(frame.count - lag) {
                let delta = Double(frame[index] - frame[index + lag])
                sum += delta * delta
            }
            difference[lag] = sum
        }

        var cumulative = 0.0
        var normalized = Array(repeating: 1.0, count: maximumLag + 1)
        for lag in 1...maximumLag {
            cumulative += difference[lag]
            normalized[lag] = cumulative > 0
                ? difference[lag] * Double(lag) / cumulative
                : 1
        }

        var selected: Int?
        for lag in minimumLag..<maximumLag where normalized[lag] < 0.15 {
            var valley = lag
            while valley + 1 <= maximumLag && normalized[valley + 1] < normalized[valley] {
                valley += 1
            }
            selected = valley
            break
        }

        guard let lag = selected else {
            let best = (minimumLag...maximumLag).min { normalized[$0] < normalized[$1] }
            return (nil, best.map { max(0, min(1, 1 - normalized[$0])) } ?? 0)
        }

        let refinedLag: Double
        if lag > minimumLag, lag < maximumLag {
            let left = normalized[lag - 1]
            let center = normalized[lag]
            let right = normalized[lag + 1]
            let denominator = left - 2 * center + right
            refinedLag = abs(denominator) > 0.000_001
                ? Double(lag) + 0.5 * (left - right) / denominator
                : Double(lag)
        } else {
            refinedLag = Double(lag)
        }

        return (sampleRate / refinedLag, max(0, min(1, 1 - normalized[lag])))
    }

    private static func rootMeanSquare<S: Sequence>(_ samples: S) -> Double where S.Element == Float {
        var sum = 0.0
        var count = 0
        for sample in samples {
            let value = Double(sample)
            sum += value * value
            count += 1
        }
        return count > 0 ? sqrt(sum / Double(count)) : 0
    }

    private static func amplitudeToDB(_ amplitude: Double) -> Double {
        20 * log10(max(amplitude, 0.000_001))
    }

    private static func dbToAmplitude(_ decibels: Double) -> Double {
        pow(10, decibels / 20)
    }

    private static func hzToMIDI(_ hz: Double) -> Double {
        69 + 12 * log2(hz / 440)
    }

    private static func median(_ values: [Double]) -> Double {
        let sorted = values.sorted()
        let middle = sorted.count / 2
        return sorted.count.isMultiple(of: 2)
            ? (sorted[middle - 1] + sorted[middle]) / 2
            : sorted[middle]
    }
}

public enum RecordingFileAnalyzer {
    public static func analyze(
        url: URL,
        configuration: RecordingAnalysisConfiguration = .default
    ) throws -> RecordingAnalysisResult {
        let file = try AVAudioFile(forReading: url)
        guard file.length > 0,
              file.length <= AVAudioFramePosition(UInt32.max),
              let buffer = AVAudioPCMBuffer(
                pcmFormat: file.processingFormat,
                frameCapacity: AVAudioFrameCount(file.length)
              ) else {
            throw RecordingAnalysisError.emptyAudio
        }

        try file.read(into: buffer)
        guard let channels = buffer.floatChannelData, buffer.frameLength > 0 else {
            throw RecordingAnalysisError.unsupportedPCM
        }

        let frameCount = Int(buffer.frameLength)
        let channelCount = Int(buffer.format.channelCount)
        var mono = Array(repeating: Float.zero, count: frameCount)
        for channel in 0..<channelCount {
            for frame in 0..<frameCount {
                mono[frame] += channels[channel][frame] / Float(channelCount)
            }
        }

        return try RecordingAudioAnalyzer.analyze(
            samples: mono,
            sampleRate: buffer.format.sampleRate,
            configuration: configuration
        )
    }
}
