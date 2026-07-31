#if INTERNAL_FIXTURE_LIBRARY
import AVFAudio
import Foundation
import Observation

struct FixtureRecording: Identifiable {
    let fixtureID: String
    let url: URL
    let duration: TimeInterval

    var id: String { fixtureID }
}

@MainActor
@Observable
final class FixtureLibraryStore: NSObject, AVAudioPlayerDelegate {
    private(set) var recordings: [FixtureRecording] = []
    private(set) var playingID: String?
    private(set) var isSeeding = false
    private(set) var statusMessage: String?
    private(set) var statusIsError = false

    let expectedCount = 23

    private var audioPlayer: AVAudioPlayer?
    private let fileManager = FileManager.default

    override init() {
        super.init()
        reload()
        if ProcessInfo.processInfo.arguments.contains("--seed-fixture-library") {
            seed()
        }
    }

    var persistentDirectory: URL {
        URL.applicationSupportDirectory.appending(
            path: "FixtureLibrary",
            directoryHint: .isDirectory
        )
    }

    func seed() {
        guard !isSeeding else { return }
        stopPlayback()
        isSeeding = true
        statusMessage = "Validating bundled Recordings…"
        statusIsError = false

        do {
            let bundleDirectory = try bundledFixtureDirectory()
            let manifest = try loadManifest(from: bundleDirectory)
            guard manifest.recordings.count == expectedCount else {
                throw FixtureLibraryError.unexpectedRecordingCount(
                    expected: expectedCount,
                    actual: manifest.recordings.count
                )
            }

            let stagingDirectory = URL.applicationSupportDirectory.appending(
                path: "FixtureLibrary-staging-\(UUID().uuidString)",
                directoryHint: .isDirectory
            )
            let backupDirectory = URL.applicationSupportDirectory.appending(
                path: "FixtureLibrary-backup-\(UUID().uuidString)",
                directoryHint: .isDirectory
            )

            try fileManager.createDirectory(
                at: stagingDirectory,
                withIntermediateDirectories: true
            )

            do {
                for item in manifest.recordings {
                    let source = bundleDirectory.appending(path: item.filename)
                    guard fileManager.isReadableFile(atPath: source.path) else {
                        throw FixtureLibraryError.missingBundledRecording(item.filename)
                    }
                    guard let player = try? AVAudioPlayer(contentsOf: source),
                          player.duration > 0 else {
                        throw FixtureLibraryError.undecodableBundledRecording(item.filename)
                    }
                    try fileManager.copyItem(
                        at: source,
                        to: stagingDirectory.appending(path: item.filename)
                    )
                }

                let manifestSource = bundleDirectory.appending(path: "approved-recordings.json")
                try fileManager.copyItem(
                    at: manifestSource,
                    to: stagingDirectory.appending(path: "approved-recordings.json")
                )

                if fileManager.fileExists(atPath: persistentDirectory.path) {
                    try fileManager.moveItem(at: persistentDirectory, to: backupDirectory)
                }

                do {
                    try fileManager.moveItem(at: stagingDirectory, to: persistentDirectory)
                    try? fileManager.removeItem(at: backupDirectory)
                } catch {
                    if fileManager.fileExists(atPath: backupDirectory.path) {
                        try? fileManager.moveItem(at: backupDirectory, to: persistentDirectory)
                    }
                    throw error
                }
            } catch {
                try? fileManager.removeItem(at: stagingDirectory)
                throw error
            }

            reload()
            guard recordings.count == expectedCount else {
                throw FixtureLibraryError.installedRecordingCount(
                    expected: expectedCount,
                    actual: recordings.count
                )
            }
            statusMessage = "Installed and verified \(recordings.count) approved Recordings."
            print("[FixtureLibrary] \(statusMessage ?? "")")
        } catch {
            reload()
            statusMessage = "Fixture Library could not be seeded: \(error.localizedDescription)"
            statusIsError = true
            print("[FixtureLibrary] ERROR: \(error)")
        }

        isSeeding = false
    }

    func togglePlayback(of recording: FixtureRecording) {
        if playingID == recording.id {
            stopPlayback()
            return
        }

        do {
            stopPlayback()
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .default)
            try session.setActive(true)
            let player = try AVAudioPlayer(contentsOf: recording.url)
            player.delegate = self
            guard player.play() else {
                throw FixtureLibraryError.couldNotPlay(recording.fixtureID)
            }
            audioPlayer = player
            playingID = recording.id
        } catch {
            stopPlayback()
            statusMessage = "Playback failed: \(error.localizedDescription)"
            statusIsError = true
        }
    }

    nonisolated func audioPlayerDidFinishPlaying(
        _ player: AVAudioPlayer,
        successfully flag: Bool
    ) {
        Task { @MainActor in
            audioPlayer = nil
            playingID = nil
            deactivateAudioSession()
            if !flag {
                statusMessage = "Fixture Recording playback ended unexpectedly."
                statusIsError = true
            }
        }
    }

    private func reload() {
        do {
            guard fileManager.fileExists(atPath: persistentDirectory.path) else {
                recordings = []
                return
            }

            let manifest = try loadManifest(from: persistentDirectory)
            recordings = manifest.recordings.compactMap { item in
                let url = persistentDirectory.appending(path: item.filename)
                guard fileManager.isReadableFile(atPath: url.path),
                      let player = try? AVAudioPlayer(contentsOf: url),
                      player.duration > 0 else {
                    return nil
                }
                return FixtureRecording(
                    fixtureID: item.id,
                    url: url,
                    duration: player.duration
                )
            }
        } catch {
            recordings = []
            statusMessage = "Installed Fixture Library is invalid: \(error.localizedDescription)"
            statusIsError = true
        }
    }

    private func bundledFixtureDirectory() throws -> URL {
        guard let directory = Bundle.main.url(
            forResource: "FixtureLibrary",
            withExtension: nil
        ) else {
            throw FixtureLibraryError.missingBundledDirectory
        }
        return directory
    }

    private func loadManifest(from directory: URL) throws -> FixtureManifest {
        let url = directory.appending(path: "approved-recordings.json")
        guard fileManager.isReadableFile(atPath: url.path) else {
            throw FixtureLibraryError.missingManifest
        }
        return try JSONDecoder().decode(
            FixtureManifest.self,
            from: Data(contentsOf: url)
        )
    }

    private func stopPlayback() {
        audioPlayer?.stop()
        audioPlayer = nil
        playingID = nil
        deactivateAudioSession()
    }

    private func deactivateAudioSession() {
        try? AVAudioSession.sharedInstance().setActive(
            false,
            options: [.notifyOthersOnDeactivation]
        )
    }
}

private struct FixtureManifest: Decodable {
    let recordings: [FixtureManifestRecording]
}

private struct FixtureManifestRecording: Decodable {
    let id: String
    let filename: String
}

private enum FixtureLibraryError: LocalizedError {
    case missingBundledDirectory
    case missingManifest
    case unexpectedRecordingCount(expected: Int, actual: Int)
    case missingBundledRecording(String)
    case undecodableBundledRecording(String)
    case installedRecordingCount(expected: Int, actual: Int)
    case couldNotPlay(String)

    var errorDescription: String? {
        switch self {
        case .missingBundledDirectory:
            "The internal Fixture Library bundle directory is missing."
        case .missingManifest:
            "The approved Recording manifest is missing."
        case let .unexpectedRecordingCount(expected, actual):
            "The manifest contains \(actual) Recordings; expected \(expected)."
        case let .missingBundledRecording(filename):
            "Bundled Recording \(filename) is missing."
        case let .undecodableBundledRecording(filename):
            "Bundled Recording \(filename) cannot be decoded."
        case let .installedRecordingCount(expected, actual):
            "Only \(actual) of \(expected) Recordings were installed."
        case let .couldNotPlay(id):
            "Recording \(id) could not start playback."
        }
    }
}
#endif
