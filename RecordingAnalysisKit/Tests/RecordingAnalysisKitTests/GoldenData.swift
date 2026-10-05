import Foundation
@testable import RecordingAnalysisKit

/// The Fixture Library and the reference engine's golden answers, read from the repo.
/// Test input only: none of this is bundled into the library.
enum Golden {
    static let repoRoot = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()  // RecordingAnalysisKitTests
        .deletingLastPathComponent()  // Tests
        .deletingLastPathComponent()  // RecordingAnalysisKit
        .deletingLastPathComponent()
    static let recordingsDir = repoRoot.appending(path: "fixtures/recordings")
    static let goldenDir = repoRoot.appending(path: "fixtures/golden")

    struct Index: Decodable {
        let recordings: [String]
        let melodicRecordings: [String]
        let sampleRate: Int
        let hop: Int
    }

    struct Recording: Decodable, Sendable {
        struct File: Decodable, Sendable {
            let name: String
            let sampleRate: Int
            let channels: Int
            let frames: Int
        }
        struct GestureBounds: Decodable, Sendable {
            let startSample: Int
            let endSample: Int
            let startS: Double
            let endS: Double
            let cutAtReattack: Bool
        }
        struct Contour: Decodable, Sendable {
            let frames: Int
            let hop: Int
            let midi: [Double?]
        }
        let id: String
        let file: File
        let gesture: GestureBounds
        let pitchContour: Contour
        let pitchEstimateMidi: Double?
        let pitchConfidence: Double
        let recordingPitchMidi: Double?
        let shortestNoteS: Double?
        let melodic: Bool
    }

    static func decoder() -> JSONDecoder {
        let d = JSONDecoder()
        d.keyDecodingStrategy = .convertFromSnakeCase
        return d
    }

    static let index: Index = {
        let data = try! Data(contentsOf: goldenDir.appending(path: "index.json"))
        return try! decoder().decode(Index.self, from: data)
    }()

    static let recordings: [Recording] = index.recordings.map { id in
        let data = try! Data(contentsOf: goldenDir.appending(path: "recordings/\(id).json"))
        return try! decoder().decode(Recording.self, from: data)
    }

    static func fileURL(_ recording: Recording) -> URL {
        recordingsDir.appending(path: recording.file.name)
    }

    /// Decoded fixture audio, cached so each file is decoded once per test run.
    static func decoded(_ recording: Recording) throws -> [Float] {
        try cache.decoded(recording)
    }

    private static let cache = DecodeCache()

    private final class DecodeCache: @unchecked Sendable {
        private let lock = NSLock()
        private var store: [String: [Float]] = [:]

        func decoded(_ recording: Recording) throws -> [Float] {
            lock.lock()
            if let y = store[recording.id] {
                lock.unlock()
                return y
            }
            lock.unlock()
            let y = try AudioDecoder.decodeMono(fileAt: Golden.fileURL(recording))
            lock.lock()
            store[recording.id] = y
            lock.unlock()
            return y
        }
    }
}

/// Formats a table row with fixed-width columns.
func row(_ cells: Any...) -> String {
    cells.map { "\($0)".padding(toLength: 10, withPad: " ", startingAt: 0) }.joined(separator: " ")
}
