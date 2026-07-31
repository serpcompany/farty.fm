import AVFAudio
import Foundation
import RecordingAnalysisKit

public struct MelodyEvent: Codable, Sendable {
    public let midiNote: Double?
    public let beats: Double

    public init(_ midiNote: Double?, _ beats: Double) {
        self.midiNote = midiNote
        self.beats = beats
    }
}

public struct CuratedMelody: Codable, Sendable {
    public let id: String
    public let title: String
    public let provenance: String
    public let bpm: Double
    public let events: [MelodyEvent]

    public init(id: String, title: String, provenance: String, bpm: Double, events: [MelodyEvent]) {
        self.id = id
        self.title = title
        self.provenance = provenance
        self.bpm = bpm
        self.events = events
    }
}

public enum CuratedMelodyCatalog {
    // Short, recognizable excerpts are encoded directly instead of importing a modern
    // arrangement or recording. All three compositions substantially predate 1931.
    public static let all: [CuratedMelody] = [
        CuratedMelody(
            id: "mary-lamb",
            title: "Mary Had a Little Lamb",
            provenance: "Traditional melody; published in the nineteenth century. Direct note-plan encoding.",
            bpm: 132,
            events: notes([64, 62, 60, 62, 64, 64, 64, nil, 62, 62, 62, nil, 64, 67, 67], beats: 1)
                + [MelodyEvent(nil, 0.5)]
                + notes([64, 62, 60, 62, 64, 64, 64, 64, 62, 62, 64, 62, 60], beats: 1)
        ),
        CuratedMelody(
            id: "twinkle",
            title: "Twinkle, Twinkle, Little Star",
            provenance: "The eighteenth-century 'Ah! vous dirai-je, Maman' melody. Direct note-plan encoding.",
            bpm: 120,
            events: [
                MelodyEvent(60, 1), MelodyEvent(60, 1), MelodyEvent(67, 1), MelodyEvent(67, 1),
                MelodyEvent(69, 1), MelodyEvent(69, 1), MelodyEvent(67, 2),
                MelodyEvent(65, 1), MelodyEvent(65, 1), MelodyEvent(64, 1), MelodyEvent(64, 1),
                MelodyEvent(62, 1), MelodyEvent(62, 1), MelodyEvent(60, 2),
                MelodyEvent(nil, 0.5),
                MelodyEvent(67, 1), MelodyEvent(67, 1), MelodyEvent(65, 1), MelodyEvent(65, 1),
                MelodyEvent(64, 1), MelodyEvent(64, 1), MelodyEvent(62, 2),
            ]
        ),
        CuratedMelody(
            id: "ode-to-joy",
            title: "Ode to Joy",
            provenance: "Theme from Beethoven's Symphony No. 9 (1824). Direct note-plan encoding.",
            bpm: 132,
            events: [
                MelodyEvent(64, 1), MelodyEvent(64, 1), MelodyEvent(65, 1), MelodyEvent(67, 1),
                MelodyEvent(67, 1), MelodyEvent(65, 1), MelodyEvent(64, 1), MelodyEvent(62, 1),
                MelodyEvent(60, 1), MelodyEvent(60, 1), MelodyEvent(62, 1), MelodyEvent(64, 1),
                MelodyEvent(64, 1.5), MelodyEvent(62, 0.5), MelodyEvent(62, 2),
                MelodyEvent(nil, 0.5),
                MelodyEvent(64, 1), MelodyEvent(64, 1), MelodyEvent(65, 1), MelodyEvent(67, 1),
                MelodyEvent(67, 1), MelodyEvent(65, 1), MelodyEvent(64, 1), MelodyEvent(62, 1),
                MelodyEvent(60, 1), MelodyEvent(60, 1), MelodyEvent(62, 1), MelodyEvent(64, 1),
                MelodyEvent(62, 1.5), MelodyEvent(60, 0.5), MelodyEvent(60, 2),
            ]
        ),
    ]

    private static func notes(_ values: [Double?], beats: Double) -> [MelodyEvent] {
        values.map { MelodyEvent($0, beats) }
    }
}

public struct RecordingCandidate: Sendable {
    public let id: String
    public let filename: String
    public let url: URL
    public let permission: String
    public let analysis: RecordingAnalysisResult

    public init(id: String, filename: String, url: URL, permission: String, analysis: RecordingAnalysisResult) {
        self.id = id
        self.filename = filename
        self.url = url
        self.permission = permission
        self.analysis = analysis
    }
}

public enum SourceMode: String, Codable, CaseIterable, Sendable {
    case chooseIndividual = "choose-individual"
    case useAll = "use-all"
    case recommendBestFit = "recommend-best-fit"
}

public struct SourceSet: Sendable {
    public let mode: SourceMode
    public let candidates: [RecordingCandidate]
}

public struct NoteAssignment: Codable, Sendable {
    public let eventIndex: Int
    public let targetMIDINote: Double
    public let renderedMIDINote: Double
    public let recordingID: String
    public let sourcePitchAvailable: Bool
    public let semitoneShift: Double
    public let durationSeconds: Double
}

public struct MelodyFitFacts: Codable, Sendable {
    public let selectedRecordingIDs: [String]
    public let usedRecordingIDs: [String]
    public let selectedPitchAvailableCount: Int
    public let pitchedAssignmentCount: Int
    public let noteAssignmentCount: Int
    public let meanAbsoluteSemitoneShift: Double
    public let maximumAbsoluteSemitoneShift: Double
    public let repeatedOrPaddedNoteCount: Int
    public let warnings: [String]
}

public struct RenderEvidence: Codable, Sendable {
    public let schemaVersion: Int
    public let renderer: String
    public let melody: CuratedMelody
    public let sourceMode: SourceMode
    public let individualRecordingID: String?
    public let fit: MelodyFitFacts
    public let assignments: [NoteAssignment]
    public let outputFilename: String
}

public enum MelodyRenderError: LocalizedError {
    case noCandidates
    case noAudio(String)
    case cannotCreateBuffer

    public var errorDescription: String? {
        switch self {
        case .noCandidates: "No Recording candidates were supplied."
        case .noAudio(let id): "Recording \(id) could not be decoded."
        case .cannotCreateBuffer: "The output audio buffer could not be created."
        }
    }
}

public enum MelodyFitPlanner {
    public static func individualCandidate(for melody: CuratedMelody, candidates: [RecordingCandidate]) throws -> RecordingCandidate {
        guard !candidates.isEmpty else { throw MelodyRenderError.noCandidates }
        let center = melodyCenter(melody)
        return candidates.min { individualCost($0, melodyCenter: center) < individualCost($1, melodyCenter: center) }!
    }

    public static func sourceSet(
        mode: SourceMode,
        melody: CuratedMelody,
        candidates: [RecordingCandidate],
        individualID: String? = nil
    ) throws -> SourceSet {
        guard !candidates.isEmpty else { throw MelodyRenderError.noCandidates }
        switch mode {
        case .chooseIndividual:
            let chosen: RecordingCandidate
            if let individualID, let match = candidates.first(where: { $0.id == individualID }) {
                chosen = match
            } else {
                chosen = try individualCandidate(for: melody, candidates: candidates)
            }
            return SourceSet(mode: mode, candidates: [chosen])
        case .useAll:
            return SourceSet(mode: mode, candidates: candidates)
        case .recommendBestFit:
            let center = melodyCenter(melody)
            let pitched = candidates
                .filter { $0.analysis.pitch.referenceMIDINote != nil }
                .sorted { recommendationCost($0, melodyCenter: center) < recommendationCost($1, melodyCenter: center) }
            if pitched.isEmpty {
                return SourceSet(mode: mode, candidates: [try individualCandidate(for: melody, candidates: candidates)])
            }
            return SourceSet(mode: mode, candidates: Array(pitched.prefix(5)))
        }
    }

    public static func plan(melody: CuratedMelody, sourceSet: SourceSet) throws -> ([NoteAssignment], MelodyFitFacts) {
        guard !sourceSet.candidates.isEmpty else { throw MelodyRenderError.noCandidates }
        let sourcePitches = sourceSet.candidates.compactMap { $0.analysis.pitch.referenceMIDINote }
        let melodyNotes = melody.events.compactMap(\.midiNote)
        let sourceCenter = median(sourcePitches) ?? median(melodyNotes) ?? 60
        let melodyCenterValue = median(melodyNotes) ?? 60
        let octaveTranspose = 12 * round((sourceCenter - melodyCenterValue) / 12)
        var useCounts: [String: Int] = [:]
        var assignments: [NoteAssignment] = []
        var repeatedOrPadded = 0

        for (index, event) in melody.events.enumerated() {
            guard let target = event.midiNote else { continue }
            let renderedTarget = target + octaveTranspose
            let candidate = sourceSet.candidates.min {
                assignmentCost($0, target: renderedTarget, useCount: useCounts[$0.id, default: 0])
                    < assignmentCost($1, target: renderedTarget, useCount: useCounts[$1.id, default: 0])
            }!
            let sourcePitch = candidate.analysis.pitch.referenceMIDINote
            let assumedPitch = sourcePitch ?? sourceCenter
            let shift = renderedTarget - assumedPitch
            let duration = event.beats * 60 / melody.bpm
            let usableDuration = candidate.analysis.soundBounds?.durationSeconds ?? candidate.analysis.durationSeconds
            if usableDuration / pow(2, shift / 12) < duration * 0.88 {
                repeatedOrPadded += 1
            }
            useCounts[candidate.id, default: 0] += 1
            assignments.append(
                NoteAssignment(
                    eventIndex: index,
                    targetMIDINote: target,
                    renderedMIDINote: renderedTarget,
                    recordingID: candidate.id,
                    sourcePitchAvailable: sourcePitch != nil,
                    semitoneShift: shift,
                    durationSeconds: duration
                )
            )
        }

        let absoluteShifts = assignments.map { abs($0.semitoneShift) }
        let pitchedCount = assignments.filter(\.sourcePitchAvailable).count
        var warnings: [String] = []
        if pitchedCount < assignments.count {
            warnings.append("Some note assignments use relative spectral shifting because source pitch is unavailable.")
        }
        if absoluteShifts.max() ?? 0 > 12 {
            warnings.append("At least one note requires more than one octave of resampling.")
        }
        if repeatedOrPadded > 0 {
            warnings.append("At least one source region is shorter than its note and requires ping-pong repetition or padding.")
        }

        let facts = MelodyFitFacts(
            selectedRecordingIDs: sourceSet.candidates.map(\.id),
            usedRecordingIDs: Array(Set(assignments.map(\.recordingID))).sorted(),
            selectedPitchAvailableCount: sourceSet.candidates.filter { $0.analysis.pitch.isAvailable }.count,
            pitchedAssignmentCount: pitchedCount,
            noteAssignmentCount: assignments.count,
            meanAbsoluteSemitoneShift: absoluteShifts.isEmpty ? 0 : absoluteShifts.reduce(0, +) / Double(absoluteShifts.count),
            maximumAbsoluteSemitoneShift: absoluteShifts.max() ?? 0,
            repeatedOrPaddedNoteCount: repeatedOrPadded,
            warnings: warnings
        )
        return (assignments, facts)
    }

    private static func melodyCenter(_ melody: CuratedMelody) -> Double {
        median(melody.events.compactMap(\.midiNote)) ?? 60
    }

    private static func individualCost(_ candidate: RecordingCandidate, melodyCenter: Double) -> Double {
        recommendationCost(candidate, melodyCenter: melodyCenter)
            + (candidate.analysis.soundBounds?.durationSeconds ?? candidate.analysis.durationSeconds < 0.18 ? 8 : 0)
    }

    private static func recommendationCost(_ candidate: RecordingCandidate, melodyCenter: Double) -> Double {
        guard let pitch = candidate.analysis.pitch.referenceMIDINote else { return 100 }
        let octaveDistance = abs(nearestOctaveShift(target: melodyCenter, source: pitch))
        return octaveDistance + (1 - candidate.analysis.pitch.periodicityEvidence) * 4
    }

    private static func assignmentCost(_ candidate: RecordingCandidate, target: Double, useCount: Int) -> Double {
        guard let pitch = candidate.analysis.pitch.referenceMIDINote else {
            return 30 + Double(useCount) * 0.2
        }
        return abs(target - pitch)
            + (1 - candidate.analysis.pitch.periodicityEvidence) * 3
            + Double(useCount) * 0.12
    }

    private static func nearestOctaveShift(target: Double, source: Double) -> Double {
        target + 12 * round((source - target) / 12) - source
    }

    private static func median(_ values: [Double]) -> Double? {
        guard !values.isEmpty else { return nil }
        let sorted = values.sorted()
        let middle = sorted.count / 2
        return sorted.count.isMultiple(of: 2)
            ? (sorted[middle - 1] + sorted[middle]) / 2
            : sorted[middle]
    }
}

public enum FartOnlyRenderer {
    public static let algorithmID = "deterministic-resample-pingpong-v1"
    public static let sampleRate = 44_100.0

    public static func render(
        melody: CuratedMelody,
        sourceSet: SourceSet,
        outputURL: URL
    ) throws -> RenderEvidence {
        let (assignments, fit) = try MelodyFitPlanner.plan(melody: melody, sourceSet: sourceSet)
        let decoded = try Dictionary(uniqueKeysWithValues: sourceSet.candidates.map { candidate in
            (candidate.id, try decode(candidate))
        })
        let totalSeconds = melody.events.reduce(0) { $0 + $1.beats * 60 / melody.bpm }
        var output = Array(repeating: Float.zero, count: Int(ceil(totalSeconds * sampleRate)))
        let assignmentsByEvent = Dictionary(uniqueKeysWithValues: assignments.map { ($0.eventIndex, $0) })
        var cursor = 0

        for (index, event) in melody.events.enumerated() {
            let eventFrames = max(1, Int(round(event.beats * 60 / melody.bpm * sampleRate)))
            defer { cursor += eventFrames }
            guard let assignment = assignmentsByEvent[index], let source = decoded[assignment.recordingID] else { continue }
            let gateFrames = max(1, Int(Double(eventFrames) * 0.88))
            let ratio = pow(2, assignment.semitoneShift / 12)
            let gain = min(4, pow(10, (-18 - source.rmsDBFS) / 20))
            let fadeFrames = min(Int(sampleRate * 0.012), gateFrames / 3)

            for frame in 0..<gateFrames where cursor + frame < output.count {
                let sourcePosition = Double(frame) * ratio
                let sample = pingPongInterpolated(source.samples, at: sourcePosition)
                let attack = fadeFrames > 0 ? min(1, Double(frame) / Double(fadeFrames)) : 1
                let release = fadeFrames > 0 ? min(1, Double(gateFrames - frame - 1) / Double(fadeFrames)) : 1
                output[cursor + frame] = Float(Double(sample) * gain * max(0, min(attack, release)))
            }
        }

        let peak = output.reduce(0.0) { max($0, abs(Double($1))) }
        if peak > 0.96 {
            let limiter = Float(0.96 / peak)
            output = output.map { $0 * limiter }
        }
        try writeWAV(samples: output, url: outputURL)
        return RenderEvidence(
            schemaVersion: 1,
            renderer: algorithmID,
            melody: melody,
            sourceMode: sourceSet.mode,
            individualRecordingID: sourceSet.mode == .chooseIndividual ? sourceSet.candidates.first?.id : nil,
            fit: fit,
            assignments: assignments,
            outputFilename: outputURL.lastPathComponent
        )
    }

    private struct DecodedAudio {
        let samples: [Float]
        let rmsDBFS: Double
    }

    private static func decode(_ candidate: RecordingCandidate) throws -> DecodedAudio {
        let file = try AVAudioFile(forReading: candidate.url)
        guard file.length > 0,
              file.length <= AVAudioFramePosition(UInt32.max),
              let buffer = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: AVAudioFrameCount(file.length)) else {
            throw MelodyRenderError.noAudio(candidate.id)
        }
        try file.read(into: buffer)
        guard let channels = buffer.floatChannelData else { throw MelodyRenderError.noAudio(candidate.id) }
        let count = Int(buffer.frameLength)
        let channelCount = Int(buffer.format.channelCount)
        var mono = Array(repeating: Float.zero, count: count)
        for channel in 0..<channelCount {
            for frame in 0..<count {
                mono[frame] += channels[channel][frame] / Float(channelCount)
            }
        }
        let start = max(0, Int((candidate.analysis.soundBounds?.startSeconds ?? 0) * buffer.format.sampleRate))
        let end = min(count, Int((candidate.analysis.soundBounds?.endSeconds ?? candidate.analysis.durationSeconds) * buffer.format.sampleRate))
        guard start < end else { throw MelodyRenderError.noAudio(candidate.id) }
        let active = Array(mono[start..<end])
        let convertedCount = max(2, Int(Double(active.count) * sampleRate / buffer.format.sampleRate))
        let converted = (0..<convertedCount).map { outputIndex -> Float in
            let position = Double(outputIndex) * buffer.format.sampleRate / sampleRate
            return interpolated(active, at: position)
        }
        return DecodedAudio(samples: converted, rmsDBFS: candidate.analysis.level.rmsDBFS)
    }

    private static func pingPongInterpolated(_ samples: [Float], at position: Double) -> Float {
        guard samples.count > 1 else { return samples.first ?? 0 }
        let span = Double(samples.count - 1)
        let cycle = span * 2
        let wrapped = position.truncatingRemainder(dividingBy: cycle)
        let reflected = wrapped <= span ? wrapped : cycle - wrapped
        return interpolated(samples, at: reflected)
    }

    private static func interpolated(_ samples: [Float], at position: Double) -> Float {
        guard !samples.isEmpty else { return 0 }
        let lower = max(0, min(samples.count - 1, Int(position.rounded(.down))))
        let upper = min(samples.count - 1, lower + 1)
        let fraction = Float(position - Double(lower))
        return samples[lower] * (1 - fraction) + samples[upper] * fraction
    }

    private static func writeWAV(samples: [Float], url: URL) throws {
        guard let format = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 1),
              let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(samples.count)),
              let channel = buffer.floatChannelData?[0] else {
            throw MelodyRenderError.cannotCreateBuffer
        }
        buffer.frameLength = AVAudioFrameCount(samples.count)
        for index in samples.indices { channel[index] = samples[index] }
        let file = try AVAudioFile(forWriting: url, settings: format.settings)
        try file.write(from: buffer)
    }
}
