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
        struct SongEntry: Decodable {
            let id: String
        }
        let recordings: [String]
        let melodicRecordings: [String]
        let sampleRate: Int
        let hop: Int
        let songs: [SongEntry]
        let libraries: [String: [String]]
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

    /// A catalog Song as the reference imported it (`songs/<id>.json`).
    struct Song: Decodable, Sendable {
        struct Note: Decodable, Sendable {
            let start: Double
            let dur: Double
            let pitch: Int
        }
        let id: String
        let bpm: Double
        let beatsPerBar: Double
        let lengthBeats: Double
        let notes: [Note]
    }

    /// The reference's Arrangement and render checks for one Song and library
    /// (`arrangements/<library>/<song>.json`).
    struct Arrangement: Decodable, Sendable {
        struct Note: Decodable, Sendable {
            struct Render: Decodable, Sendable {
                let startS: Double
                let lenS: Double
                let gainDb: Double
            }
            let index: Int
            let targetMidi: Int
            let recording: String
            let shiftSemitones: Double
            let heardCents: Double?
            let render: Render
        }
        struct Metrics: Decodable, Sendable {
            let notes: Int
            let pitchReadablePct: Int
            let within50cPct: Int
            let medianAbsCents: Double?
            let onsetsOnTimePct: Int
            let notesWithRetrigger: Int

            /// `.convertFromSnakeCase` turns `within_50c_pct` into `within50CPct`.
            private enum CodingKeys: String, CodingKey {
                case notes, pitchReadablePct, medianAbsCents, onsetsOnTimePct, notesWithRetrigger
                case within50cPct = "within50CPct"
            }
        }
        struct RenderSettings: Decodable, Sendable {
            let bpm: Double
            let tune: Double
        }
        let library: String
        let song: String
        let notes: [Note]
        let metrics: Metrics
        let renderSettings: RenderSettings
    }

    static func song(_ id: String) -> Song {
        let data = try! Data(contentsOf: goldenDir.appending(path: "songs/\(id).json"))
        return try! decoder().decode(Song.self, from: data)
    }

    /// `library` is `full` or `small`.
    static func arrangement(_ library: String, _ song: String) -> Arrangement {
        let data = try! Data(contentsOf: goldenDir.appending(path: "arrangements/\(library)/\(song).json"))
        return try! decoder().decode(Arrangement.self, from: data)
    }

    static func recording(_ id: String) -> Recording {
        recordings.first { $0.id == id }!
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
    cells.map { cell in
        let s = "\(cell)"
        return s + String(repeating: " ", count: max(0, 10 - s.count))
    }.joined(separator: " ")
}
