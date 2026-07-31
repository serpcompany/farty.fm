import Foundation
import RecordingAnalysisKit

private struct FixtureManifest: Decodable {
    struct Entry: Decodable {
        let id: String
        let filename: String
    }

    let recordings: [Entry]
}

private struct CorpusResult: Codable {
    let id: String
    let filename: String
    let analysis: RecordingAnalysisResult?
    let error: String?
}

@main
private enum RecordingAnalysisCLI {
    static func main() throws {
        let arguments = Array(CommandLine.arguments.dropFirst())
        guard arguments.count == 3 else {
            FileHandle.standardError.write(
                Data("Usage: recording-analysis <manifest> <audio-directory> <output-json>\n".utf8)
            )
            Foundation.exit(2)
        }

        let manifestURL = URL(fileURLWithPath: arguments[0])
        let audioDirectory = URL(fileURLWithPath: arguments[1], isDirectory: true)
        let outputURL = URL(fileURLWithPath: arguments[2])
        let manifest = try JSONDecoder().decode(
            FixtureManifest.self,
            from: Data(contentsOf: manifestURL)
        )

        let results = manifest.recordings.map { entry -> CorpusResult in
            do {
                return CorpusResult(
                    id: entry.id,
                    filename: entry.filename,
                    analysis: try RecordingFileAnalyzer.analyze(
                        url: audioDirectory.appending(path: entry.filename)
                    ),
                    error: nil
                )
            } catch {
                return CorpusResult(
                    id: entry.id,
                    filename: entry.filename,
                    analysis: nil,
                    error: error.localizedDescription
                )
            }
        }

        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        try encoder.encode(results).write(to: outputURL, options: .atomic)

        let succeeded = results.filter { $0.analysis != nil }.count
        let pitched = results.filter { $0.analysis?.pitch.isAvailable == true }.count
        print("Analyzed \(succeeded)/\(results.count) approved Recordings")
        print("Pitch available: \(pitched)")
        print("Pitch unavailable: \(succeeded - pitched)")
        print("Output: \(outputURL.path)")
    }
}
