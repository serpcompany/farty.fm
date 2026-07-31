import AVFAudio
import Foundation

struct Recording {
    let id: String
    let url: URL
}

private struct FixtureManifest: Decodable {
    struct Entry: Decodable {
        let id: String
        let filename: String
    }

    let recordings: [Entry]
}

private struct DecodedRecording {
    let id: String
    let filename: String
    let samples: [Float]
    let sampleRate: Double
}

private struct Observation: Codable {
    let durationSeconds: Double
    let soundStartSeconds: Double
    let soundEndSeconds: Double
    let rmsDBFS: Double
    let peakDBFS: Double
    let referenceHz: Double?
    let referenceMIDINote: Double?
    let pitchEvidence: Double
    let pitchAvailable: Bool
}

private struct RecordingComparison: Codable {
    let id: String
    let filename: String
    let windowedYINV2: Observation
    let paperYINV1: Observation
}

private struct RenderEvent: Codable {
    let index: Int
    let targetOffsetSemitones: Int
    let recordingID: String
    let sourceMIDINote: Double?
    let pitchShiftSemitones: Double
    let gain: Double
    let soundStartSeconds: Double
    let soundEndSeconds: Double
}

private struct RenderPlan: Codable {
    let method: String
    let outputFilename: String
    let baseMIDINote: Double?
    let events: [RenderEvent]
}

private struct ComparisonEvidence: Codable {
    let evidenceVersion: Int
    let generatedAt: Date
    let contourSemitones: [Int]
    let noteDurationSeconds: Double
    let recordings: [RecordingComparison]
    let blindFiles: [String]
    let plans: [RenderPlan]
}

private struct CandidateProfile {
    let recording: DecodedRecording
    let observation: Observation
}

private struct PitchFrame {
    let hz: Double?
    let periodicity: Double
}

private enum Method: String {
    case windowedYINV2 = "windowed-yin-v2"
    case paperYINV1 = "paper-yin-v1"
    case durationOnly = "duration-only-control"
}

@main
private enum ComparativeRenderingCLI {
    private static let outputSampleRate = 44_100.0
    private static let noteDuration = 0.34
    private static let gapDuration = 0.025
    private static let targetRMSDBFS = -18.0
    private static let contour = [0, 2, 4, 0, 0, 2, 4, 0, 4, 5, 7, 4, 5, 7, 7, 9, 7, 5, 4, 0, 7, 9, 7, 5, 4, 0]

    static func main() throws {
        let arguments = Array(CommandLine.arguments.dropFirst())
        guard arguments.count == 3 else {
            FileHandle.standardError.write(
                Data("Usage: comparative-rendering <manifest> <audio-directory> <output-directory>\n".utf8)
            )
            Foundation.exit(2)
        }

        let manifestURL = URL(fileURLWithPath: arguments[0])
        let audioDirectory = URL(fileURLWithPath: arguments[1], isDirectory: true)
        let outputDirectory = URL(fileURLWithPath: arguments[2], isDirectory: true)
        let manifest = try JSONDecoder().decode(
            FixtureManifest.self,
            from: Data(contentsOf: manifestURL)
        )

        let decoded = try manifest.recordings.map { entry in
            try decode(
                id: entry.id,
                filename: entry.filename,
                url: audioDirectory.appending(path: entry.filename)
            )
        }

        print("Analyzing \(decoded.count) approved Recordings with both candidates…")
        let comparisons = try decoded.map(compare)
        let currentProfiles = zip(decoded, comparisons).map {
            CandidateProfile(recording: $0.0, observation: $0.1.windowedYINV2)
        }
        let challengerProfiles = zip(decoded, comparisons).map {
            CandidateProfile(recording: $0.0, observation: $0.1.paperYINV1)
        }

        try FileManager.default.createDirectory(at: outputDirectory, withIntermediateDirectories: true)

        // Blind filenames intentionally do not identify the analysis method.
        let assignments: [(filename: String, method: Method, profiles: [CandidateProfile])] = [
            ("blind-1.wav", .paperYINV1, challengerProfiles),
            ("blind-2.wav", .durationOnly, currentProfiles),
            ("blind-3.wav", .windowedYINV2, currentProfiles),
        ]

        var plans: [RenderPlan] = []
        for assignment in assignments {
            let result = render(method: assignment.method, profiles: assignment.profiles)
            try writeWAV(
                samples: result.samples,
                to: outputDirectory.appending(path: assignment.filename)
            )
            plans.append(
                RenderPlan(
                    method: assignment.method.rawValue,
                    outputFilename: assignment.filename,
                    baseMIDINote: result.baseMIDINote,
                    events: result.events
                )
            )
        }

        let evidence = ComparisonEvidence(
            evidenceVersion: 1,
            generatedAt: .now,
            contourSemitones: contour,
            noteDurationSeconds: noteDuration,
            recordings: comparisons,
            blindFiles: assignments.map(\.filename),
            plans: plans
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        try encoder.encode(evidence).write(
            to: outputDirectory.appending(path: "comparison-evidence.json"),
            options: .atomic
        )

        let answerKey = plans
            .map { "\($0.outputFilename): \($0.method)" }
            .joined(separator: "\n") + "\n"
        try Data(answerKey.utf8).write(
            to: outputDirectory.appending(path: "answer-key.txt"),
            options: .atomic
        )

        printSummary(comparisons, outputDirectory: outputDirectory)
    }

    private static func compare(_ recording: DecodedRecording) throws -> RecordingComparison {
        let current = try RecordingAnalyzer.analyze(
            samples: recording.samples,
            sampleRate: recording.sampleRate
        )
        let challenger = PaperYINAnalyzer.analyze(
            samples: recording.samples,
            sampleRate: recording.sampleRate
        )

        return RecordingComparison(
            id: recording.id,
            filename: recording.filename,
            windowedYINV2: Observation(
                durationSeconds: current.durationSeconds,
                soundStartSeconds: current.usableStartSeconds,
                soundEndSeconds: current.usableStartSeconds + current.usableDurationSeconds,
                rmsDBFS: current.rmsDBFS,
                peakDBFS: current.peakDBFS,
                referenceHz: current.referenceHz,
                referenceMIDINote: current.referenceHz.map(hzToMIDI),
                pitchEvidence: current.pitchConfidence,
                pitchAvailable: current.referenceHz != nil
            ),
            paperYINV1: challenger
        )
    }

    private static func decode(id: String, filename: String, url: URL) throws -> DecodedRecording {
        let file = try AVAudioFile(forReading: url)
        guard file.length > 0,
              file.length <= AVAudioFramePosition(UInt32.max),
              let buffer = AVAudioPCMBuffer(
                pcmFormat: file.processingFormat,
                frameCapacity: AVAudioFrameCount(file.length)
              ) else {
            throw NSError(domain: "ComparativeRendering", code: 1)
        }

        try file.read(into: buffer)
        guard let channels = buffer.floatChannelData, buffer.frameLength > 0 else {
            throw NSError(domain: "ComparativeRendering", code: 2)
        }

        let frameCount = Int(buffer.frameLength)
        let channelCount = Int(buffer.format.channelCount)
        var mono = Array(repeating: Float.zero, count: frameCount)
        for channel in 0..<channelCount {
            for frame in 0..<frameCount {
                mono[frame] += channels[channel][frame] / Float(channelCount)
            }
        }

        return DecodedRecording(
            id: id,
            filename: filename,
            samples: mono,
            sampleRate: buffer.format.sampleRate
        )
    }

    private static func render(
        method: Method,
        profiles: [CandidateProfile]
    ) -> (samples: [Float], baseMIDINote: Double?, events: [RenderEvent]) {
        let pitched = profiles.filter { $0.observation.referenceMIDINote != nil }
        let availableMIDIs = pitched.compactMap(\.observation.referenceMIDINote).sorted()
        let baseMIDI = availableMIDIs.isEmpty ? nil : median(availableMIDIs).rounded()
        let fallback = profiles.first!
        let outputNoteFrames = Int(noteDuration * outputSampleRate)
        let gapFrames = Int(gapDuration * outputSampleRate)
        var output: [Float] = []
        var events: [RenderEvent] = []

        for (index, offset) in contour.enumerated() {
            let profile: CandidateProfile
            let shift: Double

            if method == .durationOnly {
                profile = fallback
                shift = Double(offset)
            } else if let baseMIDI {
                let target = baseMIDI + Double(offset)
                profile = pitched.min {
                    abs(($0.observation.referenceMIDINote ?? target) - target)
                        < abs(($1.observation.referenceMIDINote ?? target) - target)
                } ?? fallback
                shift = target - (profile.observation.referenceMIDINote ?? target)
            } else {
                profile = fallback
                shift = Double(offset)
            }

            let sourceStart: Double
            let sourceEnd: Double
            let gain: Double
            if method == .durationOnly {
                sourceStart = 0
                sourceEnd = profile.observation.durationSeconds
                gain = 1
            } else {
                sourceStart = profile.observation.soundStartSeconds
                sourceEnd = profile.observation.soundEndSeconds
                gain = normalizedGain(rmsDBFS: profile.observation.rmsDBFS)
            }

            let eventSamples = renderEvent(
                profile.recording,
                startSeconds: sourceStart,
                endSeconds: sourceEnd,
                pitchShiftSemitones: shift,
                gain: gain,
                frameCount: outputNoteFrames
            )
            output.append(contentsOf: eventSamples)
            output.append(contentsOf: repeatElement(0, count: gapFrames))
            events.append(
                RenderEvent(
                    index: index,
                    targetOffsetSemitones: offset,
                    recordingID: profile.recording.id,
                    sourceMIDINote: profile.observation.referenceMIDINote,
                    pitchShiftSemitones: shift,
                    gain: gain,
                    soundStartSeconds: sourceStart,
                    soundEndSeconds: sourceEnd
                )
            )
        }

        return (output, baseMIDI, events)
    }

    private static func renderEvent(
        _ recording: DecodedRecording,
        startSeconds: Double,
        endSeconds: Double,
        pitchShiftSemitones: Double,
        gain: Double,
        frameCount: Int
    ) -> [Float] {
        let start = max(0, min(recording.samples.count - 1, Int(startSeconds * recording.sampleRate)))
        let proposedEnd = min(recording.samples.count, Int(endSeconds * recording.sampleRate))
        let end = max(start + 1, proposedEnd)
        let sourceCount = end - start
        let pitchRatio = pow(2, pitchShiftSemitones / 12)
        let sourceAdvance = recording.sampleRate / outputSampleRate * pitchRatio
        let fadeFrames = max(1, Int(0.012 * outputSampleRate))
        var rendered = Array(repeating: Float.zero, count: frameCount)

        for outputIndex in 0..<frameCount {
            let wrapped = (Double(outputIndex) * sourceAdvance).truncatingRemainder(dividingBy: Double(sourceCount))
            let sourcePosition = Double(start) + wrapped
            let lower = Int(sourcePosition)
            let upper = lower + 1 < end ? lower + 1 : start
            let fraction = Float(sourcePosition - Double(lower))
            let value = recording.samples[lower] * (1 - fraction) + recording.samples[upper] * fraction
            let fadeIn = min(1, Float(outputIndex) / Float(fadeFrames))
            let fadeOut = min(1, Float(frameCount - 1 - outputIndex) / Float(fadeFrames))
            rendered[outputIndex] = value * Float(gain) * min(fadeIn, fadeOut)
        }
        return rendered
    }

    private static func writeWAV(samples: [Float], to url: URL) throws {
        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatLinearPCM,
            AVSampleRateKey: outputSampleRate,
            AVNumberOfChannelsKey: 1,
            AVLinearPCMBitDepthKey: 16,
            AVLinearPCMIsFloatKey: false,
            AVLinearPCMIsBigEndianKey: false,
        ]
        let file = try AVAudioFile(
            forWriting: url,
            settings: settings,
            commonFormat: .pcmFormatFloat32,
            interleaved: false
        )
        guard let format = AVAudioFormat(
            commonFormat: .pcmFormatFloat32,
            sampleRate: outputSampleRate,
            channels: 1,
            interleaved: false
        ),
              let buffer = AVAudioPCMBuffer(
                pcmFormat: format,
                frameCapacity: AVAudioFrameCount(samples.count)
              ),
              let channel = buffer.floatChannelData?[0] else {
            throw NSError(domain: "ComparativeRendering", code: 3)
        }
        buffer.frameLength = AVAudioFrameCount(samples.count)
        channel.update(from: samples, count: samples.count)
        try file.write(from: buffer)
    }

    private static func normalizedGain(rmsDBFS: Double) -> Double {
        guard rmsDBFS.isFinite else { return 1 }
        return min(4, max(0.25, pow(10, (targetRMSDBFS - rmsDBFS) / 20)))
    }

    private static func printSummary(
        _ comparisons: [RecordingComparison],
        outputDirectory: URL
    ) {
        let currentPitched = comparisons.filter(\.windowedYINV2.pitchAvailable).count
        let challengerPitched = comparisons.filter(\.paperYINV1.pitchAvailable).count
        print("\nCandidate observations")
        print("  windowed-yin-v2: \(currentPitched)/\(comparisons.count) with pitch evidence")
        print("  paper-yin-v1:    \(challengerPitched)/\(comparisons.count) with pitch evidence")
        print("\nBlind renders")
        print("  \(outputDirectory.appending(path: "blind-1.wav").path)")
        print("  \(outputDirectory.appending(path: "blind-2.wav").path)")
        print("  \(outputDirectory.appending(path: "blind-3.wav").path)")
        print("\nListen before opening answer-key.txt.")
        print("The full source choice, shift, gain, and sound-boundary state is in comparison-evidence.json.")
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

private enum PaperYINAnalyzer {
    static func analyze(samples input: [Float], sampleRate: Double) -> Observation {
        let samples = input.map { $0.isFinite ? $0 : 0 }
        let duration = Double(samples.count) / sampleRate
        let peak = samples.map { abs(Double($0)) }.max() ?? 0
        let activity = activityRange(samples: samples, sampleRate: sampleRate, peak: peak)
        let activeSamples = Array(samples[activity])
        let rms = rootMeanSquare(activeSamples)
        let track = pitchTrack(samples: activeSamples, sampleRate: sampleRate)
        let available = track.compactMap { frame -> (hz: Double, periodicity: Double)? in
            guard let hz = frame.hz, frame.periodicity >= 0.80 else { return nil }
            return (hz, frame.periodicity)
        }
        let pitchedRatio = track.isEmpty ? 0 : Double(available.count) / Double(track.count)
        let referenceHz = pitchedRatio >= 0.25 && !available.isEmpty
            ? median(available.map(\.hz))
            : nil
        let evidence = available.isEmpty
            ? 0
            : median(available.map(\.periodicity)) * pitchedRatio

        return Observation(
            durationSeconds: duration,
            soundStartSeconds: Double(activity.lowerBound) / sampleRate,
            soundEndSeconds: Double(activity.upperBound) / sampleRate,
            rmsDBFS: amplitudeToDB(rms),
            peakDBFS: amplitudeToDB(peak),
            referenceHz: referenceHz,
            referenceMIDINote: referenceHz.map { 69 + 12 * log2($0 / 440) },
            pitchEvidence: evidence,
            pitchAvailable: referenceHz != nil
        )
    }

    private static func activityRange(
        samples: [Float],
        sampleRate: Double,
        peak: Double
    ) -> Range<Int> {
        let windowSize = max(128, Int(sampleRate * 0.02))
        let absoluteFloor = pow(10, -50.0 / 20)
        let relativeFloor = peak * pow(10, -32.0 / 20)
        let threshold = max(absoluteFloor, relativeFloor)
        var first: Int?
        var last = samples.count

        for start in stride(from: 0, to: samples.count, by: windowSize) {
            let end = min(start + windowSize, samples.count)
            if rootMeanSquare(samples[start..<end]) >= threshold {
                first = first ?? start
                last = end
            }
        }
        guard let first else { return samples.startIndex..<samples.endIndex }
        return first..<last
    }

    private static func pitchTrack(
        samples: [Float],
        sampleRate: Double
    ) -> [PitchFrame] {
        let downsampleFactor = max(1, Int(ceil(sampleRate / 11_025)))
        let analysisRate = sampleRate / Double(downsampleFactor)
        let downsampled = stride(from: 0, to: samples.count, by: downsampleFactor).map { start -> Float in
            let end = min(start + downsampleFactor, samples.count)
            return samples[start..<end].reduce(0, +) / Float(end - start)
        }
        let frameSize = 1024
        let hopSize = 512
        guard downsampled.count >= frameSize else { return [] }

        var result: [PitchFrame] = []
        for start in stride(from: 0, through: downsampled.count - frameSize, by: hopSize) {
            let frame = Array(downsampled[start..<(start + frameSize)])
            guard rootMeanSquare(frame) >= pow(10, -50.0 / 20) else {
                result.append(PitchFrame(hz: nil, periodicity: 0))
                continue
            }
            result.append(yin(frame: frame, sampleRate: analysisRate))
        }
        return result
    }

    private static func yin(
        frame: [Float],
        sampleRate: Double
    ) -> PitchFrame {
        let minimumLag = max(2, Int(sampleRate / 500))
        let maximumLag = min(frame.count / 2, Int(sampleRate / 45))
        guard minimumLag < maximumLag else {
            return PitchFrame(hz: nil, periodicity: 0)
        }

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
            let periodicity = best.map { max(0, min(1, 1 - normalized[$0])) } ?? 0
            return PitchFrame(hz: nil, periodicity: periodicity)
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

        return PitchFrame(
            hz: sampleRate / refinedLag,
            periodicity: max(0, min(1, 1 - normalized[lag]))
        )
    }

    private static func rootMeanSquare<S: Sequence>(_ samples: S) -> Double where S.Element == Float {
        var sum = 0.0
        var count = 0
        for sample in samples {
            sum += Double(sample * sample)
            count += 1
        }
        return count > 0 ? sqrt(sum / Double(count)) : 0
    }

    private static func amplitudeToDB(_ amplitude: Double) -> Double {
        20 * log10(max(amplitude, 0.000_001))
    }

    private static func median(_ values: [Double]) -> Double {
        let sorted = values.sorted()
        let middle = sorted.count / 2
        return sorted.count.isMultiple(of: 2)
            ? (sorted[middle - 1] + sorted[middle]) / 2
            : sorted[middle]
    }
}
