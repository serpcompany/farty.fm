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

private struct CorpusEvidence: Codable {
    struct Result: Codable {
        let id: String
        let filename: String
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
        let error: String?
    }

    let evidenceVersion: Int
    let analysisSchemaVersion: Int
    let algorithmVersion: String
    let corpusSize: Int
    let succeededCount: Int
    let failedCount: Int
    let confidentlyPitchedCount: Int
    let unpitchedCount: Int
    let results: [Result]
}

@main
private enum FixtureAnalysisCLI {
    static func main() throws {
        let arguments = Array(CommandLine.arguments.dropFirst())
        guard arguments.count >= 2 else {
            FileHandle.standardError.write(
                Data("Usage: fixture-analysis <manifest> <audio-directory> [--batch] [--output <path>]\n".utf8)
            )
            Foundation.exit(2)
        }

        let manifestURL = URL(fileURLWithPath: arguments[0])
        let audioDirectory = URL(fileURLWithPath: arguments[1], isDirectory: true)
        let outputURL = outputURL(from: arguments)
        let manifest = try JSONDecoder().decode(
            FixtureManifest.self,
            from: Data(contentsOf: manifestURL)
        )

        let analysisDirectory = FileManager.default.temporaryDirectory
            .appending(path: "pedos-fixture-analysis-json", directoryHint: .isDirectory)
        try? FileManager.default.removeItem(at: analysisDirectory)
        let service = RecordingAnalysisService(directory: analysisDirectory)

        let results = manifest.recordings.map { entry -> CorpusEvidence.Result in
            let url = audioDirectory.appending(path: entry.filename)
            do {
                let analysis = try service.analyze(Recording(id: entry.id, url: url))
                return CorpusEvidence.Result(
                    id: entry.id,
                    filename: entry.filename,
                    durationSeconds: analysis.durationSeconds,
                    usableStartSeconds: analysis.usableStartSeconds,
                    usableDurationSeconds: analysis.usableDurationSeconds,
                    rmsDBFS: analysis.rmsDBFS,
                    peakDBFS: analysis.peakDBFS,
                    brightness: analysis.brightness,
                    referenceHz: analysis.referenceHz,
                    referenceMIDINote: analysis.referenceMIDINote,
                    stablePitchLowMIDINote: analysis.stablePitchLowMIDINote,
                    stablePitchHighMIDINote: analysis.stablePitchHighMIDINote,
                    pitchConfidence: analysis.pitchConfidence,
                    pitchedFrameRatio: analysis.pitchedFrameRatio,
                    error: nil
                )
            } catch {
                return CorpusEvidence.Result(
                    id: entry.id,
                    filename: entry.filename,
                    durationSeconds: 0,
                    usableStartSeconds: 0,
                    usableDurationSeconds: 0,
                    rmsDBFS: -120,
                    peakDBFS: -120,
                    brightness: 0,
                    referenceHz: nil,
                    referenceMIDINote: nil,
                    stablePitchLowMIDINote: nil,
                    stablePitchHighMIDINote: nil,
                    pitchConfidence: 0,
                    pitchedFrameRatio: 0,
                    error: error.localizedDescription
                )
            }
        }

        let evidence = CorpusEvidence(
            evidenceVersion: 1,
            analysisSchemaVersion: RecordingAnalysis.schemaVersion,
            algorithmVersion: RecordingAnalysis.algorithmVersion,
            corpusSize: results.count,
            succeededCount: results.filter { $0.error == nil }.count,
            failedCount: results.filter { $0.error != nil }.count,
            confidentlyPitchedCount: results.filter { $0.referenceMIDINote != nil }.count,
            unpitchedCount: results.filter { $0.error == nil && $0.referenceMIDINote == nil }.count,
            results: results
        )

        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let outputData = try encoder.encode(evidence)
        try FileManager.default.createDirectory(
            at: outputURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try outputData.write(to: outputURL, options: .atomic)

        printSummary(evidence, outputURL: outputURL)
        if !arguments.contains("--batch") {
            review(evidence.results, audioDirectory: audioDirectory)
        }
    }

    private static func outputURL(from arguments: [String]) -> URL {
        if let flagIndex = arguments.firstIndex(of: "--output"),
           arguments.indices.contains(flagIndex + 1) {
            return URL(fileURLWithPath: arguments[flagIndex + 1])
        }
        return URL(fileURLWithPath: "Evidence/recording-analysis-corpus.json")
    }

    private static func printSummary(_ evidence: CorpusEvidence, outputURL: URL) {
        print("Analyzed \(evidence.succeededCount)/\(evidence.corpusSize) approved Recordings")
        print("Confident pitch: \(evidence.confidentlyPitchedCount)")
        print("Explicitly unpitched: \(evidence.unpitchedCount)")
        print("Failures: \(evidence.failedCount)")
        print("Evidence: \(outputURL.path)")
    }

    private static func review(_ results: [CorpusEvidence.Result], audioDirectory: URL) {
        guard !results.isEmpty else { return }
        var index = 0

        while true {
            let result = results[index]
            print("\u{001B}[2J\u{001B}[H", terminator: "")
            print("\u{001B}[1mApproved Fixture Library Recording Analysis\u{001B}[0m")
            print("\u{001B}[2mRecording \(index + 1) of \(results.count)\u{001B}[0m\n")
            print("\u{001B}[1mFile\u{001B}[0m       \(result.filename)")
            print("\u{001B}[1mUsable\u{001B}[0m     \(format(result.usableDurationSeconds)) s from \(format(result.usableStartSeconds)) s")
            print("\u{001B}[1mLevel\u{001B}[0m      \(format(result.rmsDBFS)) dBFS RMS · \(format(result.peakDBFS)) dBFS peak")
            print("\u{001B}[1mBrightness\u{001B}[0m \(format(result.brightness))")
            print("\u{001B}[1mPitch\u{001B}[0m      \(noteLabel(result.referenceMIDINote))")
            print("\u{001B}[1mBounds\u{001B}[0m     \(pitchBounds(result))")
            print("\u{001B}[1mConfidence\u{001B}[0m \(percent(result.pitchConfidence)) · voiced \(percent(result.pitchedFrameRatio))")
            if let error = result.error {
                print("\u{001B}[1mError\u{001B}[0m      \(error)")
            }
            print("\n[n] next  [b] back  [p] play/stop  [q] quit")
            print("> ", terminator: "")

            guard let command = readLine()?.lowercased() else { return }
            switch command {
            case "n", "":
                index = (index + 1) % results.count
            case "b":
                index = (index - 1 + results.count) % results.count
            case "p":
                play(audioDirectory.appending(path: result.filename))
            case "q":
                stopPlayback()
                return
            default:
                continue
            }
        }
    }

    private static var playback: Process?

    private static func play(_ url: URL) {
        stopPlayback()
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/afplay")
        process.arguments = [url.path]
        try? process.run()
        playback = process
    }

    private static func stopPlayback() {
        playback?.terminate()
        playback = nil
    }

    private static func format(_ value: Double) -> String {
        String(format: "%.2f", value)
    }

    private static func percent(_ value: Double) -> String {
        String(format: "%.0f%%", value * 100)
    }

    private static func noteLabel(_ midi: Int?) -> String {
        guard let midi else { return "not confidently pitched" }
        let names = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"]
        return "\(names[(midi % 12 + 12) % 12])\(midi / 12 - 1) · MIDI \(midi)"
    }

    private static func pitchBounds(_ result: CorpusEvidence.Result) -> String {
        guard let low = result.stablePitchLowMIDINote,
              let high = result.stablePitchHighMIDINote else {
            return "none"
        }
        return "MIDI \(format(low))…\(format(high))"
    }
}
