import AVFAudio
import Foundation

struct RecordingAnalysis: Codable, Sendable {
    static let schemaVersion = 2
    static let algorithmVersion = "windowed-yin-v2"

    let version: Int
    let algorithmVersion: String
    let recordingID: String
    let audioRevision: String
    let analyzedAt: Date
    let durationSeconds: Double
    let usableStartSeconds: Double
    let usableDurationSeconds: Double
    let rmsDBFS: Double
    let peakDBFS: Double
    let brightness: Double
    let referenceHz: Double?
    let referenceMIDINote: Int?
    let stablePitchLowMIDINote: Double?
    let stablePitchHighMIDINote: Double?
    let pitchConfidence: Double
    let pitchedFrameRatio: Double

    var referenceNoteLabel: String {
        guard let midi = referenceMIDINote else { return "not confidently pitched" }
        let names = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"]
        let octave = midi / 12 - 1
        return "\(names[(midi % 12 + 12) % 12])\(octave)"
    }
}

enum RecordingAnalysisSource: String {
    case fresh = "fresh analysis"
    case preserved = "preserved JSON"
}

enum RecordingAnalysisStatus {
    case missing
    case analyzing
    case ready(RecordingAnalysis, source: RecordingAnalysisSource)
    case failed(String)
}

struct RecordingCharacteristics: Sendable {
    let durationSeconds: Double
    let usableStartSeconds: Double
    let usableDurationSeconds: Double
    let rmsDBFS: Double
    let peakDBFS: Double
    let brightness: Double
    let referenceHz: Double?
    let referenceMIDINote: Int?
    let stablePitchLowMIDINote: Double?
    let stablePitchHighMIDINote: Double?
    let pitchConfidence: Double
    let pitchedFrameRatio: Double
}

/// Pure prototype logic. It deliberately keeps spectral brightness separate
/// from fundamental pitch: the archived prototype showed that treating a
/// spectral centroid as a musical note overestimated pitch.
enum RecordingAnalyzer {
    static func analyze(samples input: [Float], sampleRate: Double) throws -> RecordingCharacteristics {
        guard !input.isEmpty, sampleRate > 0 else {
            throw RecordingAnalysisError.emptyAudio
        }

        let samples = input.map { $0.isFinite ? $0 : 0 }
        let duration = Double(samples.count) / sampleRate
        let peak = samples.reduce(0.0) { max($0, abs(Double($1))) }
        let gate = max(dbToAmplitude(-45), peak * dbToAmplitude(-30))
        let region = usableRegion(samples: samples, gate: gate)
        let usable = Array(samples[region])
        let usableStart = Double(region.lowerBound) / sampleRate
        let usableDuration = Double(region.count) / sampleRate
        let rms = rootMeanSquare(usable)
        let differenceRMS = rootMeanSquare(zip(usable, usable.dropFirst()).map { $1 - $0 })
        let brightness = rms > 0 ? min(1, differenceRMS / (rms * 1.414)) : 0
        let pitch = pitchProfile(samples: usable, sampleRate: sampleRate)

        return RecordingCharacteristics(
            durationSeconds: duration,
            usableStartSeconds: usableStart,
            usableDurationSeconds: usableDuration,
            rmsDBFS: amplitudeToDB(rms),
            peakDBFS: amplitudeToDB(peak),
            brightness: brightness,
            referenceHz: pitch.referenceHz,
            referenceMIDINote: pitch.referenceMIDINote,
            stablePitchLowMIDINote: pitch.stablePitchLowMIDINote,
            stablePitchHighMIDINote: pitch.stablePitchHighMIDINote,
            pitchConfidence: pitch.confidence,
            pitchedFrameRatio: pitch.pitchedFrameRatio
        )
    }

    private static func usableRegion(samples: [Float], gate: Double) -> Range<Int> {
        let windowSize = 512
        var first: Int?
        var last = samples.count

        for start in stride(from: 0, to: samples.count, by: windowSize) {
            let end = min(start + windowSize, samples.count)
            let rms = rootMeanSquare(samples[start..<end])
            if rms >= gate {
                first = first ?? start
                last = end
            }
        }

        guard let first else { return samples.startIndex..<samples.endIndex }
        return first..<last
    }

    private static func pitchProfile(
        samples: [Float],
        sampleRate: Double
    ) -> (
        referenceHz: Double?,
        referenceMIDINote: Int?,
        stablePitchLowMIDINote: Double?,
        stablePitchHighMIDINote: Double?,
        confidence: Double,
        pitchedFrameRatio: Double
    ) {
        let downsampleFactor = max(1, Int(ceil(sampleRate / 11_025)))
        let downsampledRate = sampleRate / Double(downsampleFactor)
        let downsampled = stride(from: 0, to: samples.count, by: downsampleFactor).map { start -> Float in
            let end = min(start + downsampleFactor, samples.count)
            let slice = samples[start..<end]
            return slice.reduce(0, +) / Float(slice.count)
        }

        let frameSize = 1024
        let hopSize = 512
        guard downsampled.count >= frameSize else {
            return (nil, nil, nil, nil, 0, 0)
        }

        var frames: [(hz: Double, clarity: Double)] = []
        var consideredFrameCount = 0

        for start in stride(from: 0, through: downsampled.count - frameSize, by: hopSize) {
            let rawFrame = Array(downsampled[start..<(start + frameSize)])
            guard rootMeanSquare(rawFrame) >= dbToAmplitude(-45) else { continue }
            consideredFrameCount += 1

            if let candidate = yinPitch(frame: rawFrame, sampleRate: downsampledRate),
               candidate.hz >= 45,
               candidate.hz <= 500,
               candidate.clarity >= 0.65 {
                frames.append(candidate)
            }
        }

        guard consideredFrameCount > 0, !frames.isEmpty else {
            return (nil, nil, nil, nil, 0, 0)
        }

        let midiValues = frames.map { hzToMIDI($0.hz) }
        let center = median(midiValues)
        let stableFrames = zip(frames, midiValues)
            .filter { abs($0.1 - center) <= 4 }
            .map(\.0)

        guard !stableFrames.isEmpty else {
            return (nil, nil, nil, nil, 0, Double(frames.count) / Double(consideredFrameCount))
        }

        let stableMidis = stableFrames.map { hzToMIDI($0.hz) }
        let referenceMIDI = median(stableMidis)
        let spread = standardDeviation(stableMidis, around: referenceMIDI)
        let averageClarity = stableFrames.map(\.clarity).reduce(0, +) / Double(stableFrames.count)
        let pitchedRatio = Double(stableFrames.count) / Double(consideredFrameCount)
        let stability = 1 - min(1, spread / 3)
        let confidence = max(0, min(1, averageClarity * pitchedRatio * stability))

        guard confidence >= 0.2 else {
            return (nil, nil, nil, nil, confidence, pitchedRatio)
        }

        return (
            stableFrames.map(\.hz).reduce(0, +) / Double(stableFrames.count),
            Int(referenceMIDI.rounded()),
            stableMidis.min(),
            stableMidis.max(),
            confidence,
            pitchedRatio
        )
    }

    private static func yinPitch(frame: [Float], sampleRate: Double) -> (hz: Double, clarity: Double)? {
        let mean = frame.reduce(0, +) / Float(frame.count)
        let centered = frame.enumerated().map { index, value -> Double in
            let hann = 0.5 - 0.5 * cos(2 * .pi * Double(index) / Double(frame.count - 1))
            return Double(value - mean) * hann
        }
        let minimumLag = max(2, Int(sampleRate / 500))
        let maximumLag = min(frame.count / 2, Int(sampleRate / 45))
        guard minimumLag < maximumLag else { return nil }

        var differences = Array(repeating: 0.0, count: maximumLag + 1)
        for lag in 1...maximumLag {
            var sum = 0.0
            for index in 0..<(centered.count - lag) {
                let difference = centered[index] - centered[index + lag]
                sum += difference * difference
            }
            differences[lag] = sum
        }

        var cumulative = 0.0
        var normalized = Array(repeating: 1.0, count: maximumLag + 1)
        for lag in 1...maximumLag {
            cumulative += differences[lag]
            normalized[lag] = cumulative > 0 ? differences[lag] * Double(lag) / cumulative : 1
        }

        var candidate: Int?
        for lag in minimumLag..<maximumLag where normalized[lag] < 0.2 {
            var valley = lag
            while valley + 1 <= maximumLag, normalized[valley + 1] < normalized[valley] {
                valley += 1
            }
            candidate = valley
            break
        }

        if candidate == nil {
            candidate = (minimumLag...maximumLag).min { normalized[$0] < normalized[$1] }
        }

        guard let lag = candidate else { return nil }
        let clarity = 1 - normalized[lag]
        return (sampleRate / Double(lag), clarity)
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

    private static func standardDeviation(_ values: [Double], around center: Double) -> Double {
        let variance = values.map { pow($0 - center, 2) }.reduce(0, +) / Double(values.count)
        return sqrt(variance)
    }
}

struct RecordingAnalysisService: Sendable {
    let directory: URL

    init(
        directory: URL = URL.applicationSupportDirectory
            .appending(path: "RecordingAnalysis", directoryHint: .isDirectory)
    ) {
        self.directory = directory
    }

    func preservedAnalysis(for recording: Recording) -> RecordingAnalysis? {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601

        guard let data = try? Data(contentsOf: analysisURL(for: recording)),
              let analysis = try? decoder.decode(RecordingAnalysis.self, from: data),
              analysis.version == RecordingAnalysis.schemaVersion,
              analysis.algorithmVersion == RecordingAnalysis.algorithmVersion,
              analysis.audioRevision == (try? audioRevision(for: recording.url)) else {
            return nil
        }
        return analysis
    }

    func analyze(_ recording: Recording) throws -> RecordingAnalysis {
        let file = try AVAudioFile(forReading: recording.url)
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

        let characteristics = try RecordingAnalyzer.analyze(
            samples: mono,
            sampleRate: buffer.format.sampleRate
        )
        let analysis = RecordingAnalysis(
            version: RecordingAnalysis.schemaVersion,
            algorithmVersion: RecordingAnalysis.algorithmVersion,
            recordingID: recording.id,
            audioRevision: try audioRevision(for: recording.url),
            analyzedAt: .now,
            durationSeconds: characteristics.durationSeconds,
            usableStartSeconds: characteristics.usableStartSeconds,
            usableDurationSeconds: characteristics.usableDurationSeconds,
            rmsDBFS: characteristics.rmsDBFS,
            peakDBFS: characteristics.peakDBFS,
            brightness: characteristics.brightness,
            referenceHz: characteristics.referenceHz,
            referenceMIDINote: characteristics.referenceMIDINote,
            stablePitchLowMIDINote: characteristics.stablePitchLowMIDINote,
            stablePitchHighMIDINote: characteristics.stablePitchHighMIDINote,
            pitchConfidence: characteristics.pitchConfidence,
            pitchedFrameRatio: characteristics.pitchedFrameRatio
        )

        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        try encoder.encode(analysis).write(to: analysisURL(for: recording), options: .atomic)
        return analysis
    }

    func deleteAnalysis(for recording: Recording) {
        try? FileManager.default.removeItem(at: analysisURL(for: recording))
    }

    func deleteAll() throws {
        if FileManager.default.fileExists(atPath: directory.path) {
            try FileManager.default.removeItem(at: directory)
        }
    }

    private func analysisURL(for recording: Recording) -> URL {
        directory.appending(path: "\(recording.id).json")
    }

    private func audioRevision(for url: URL) throws -> String {
        let values = try url.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey])
        let size = values.fileSize ?? 0
        let modified = values.contentModificationDate?.timeIntervalSince1970 ?? 0
        return "\(size):\(String(format: "%.6f", modified))"
    }
}

private enum RecordingAnalysisError: LocalizedError {
    case emptyAudio
    case unsupportedPCM

    var errorDescription: String? {
        switch self {
        case .emptyAudio: "The Recording has no decodable audio frames."
        case .unsupportedPCM: "The Recording could not be decoded to PCM."
        }
    }
}
