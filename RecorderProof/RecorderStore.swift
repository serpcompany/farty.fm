import AVFAudio
import Foundation
import Observation

struct Recording: Identifiable {
    let id: UUID
    let url: URL
    let createdAt: Date
    let duration: TimeInterval
}

struct DraftRecording {
    let url: URL
    let duration: TimeInterval
}

enum CapturePhase {
    case idle
    case recording(startedAt: Date)
    case reviewing(DraftRecording)

    var label: String {
        switch self {
        case .idle: "idle"
        case .recording: "recording"
        case .reviewing: "reviewing draft"
        }
    }
}

@MainActor
@Observable
final class RecorderStore: NSObject, AVAudioRecorderDelegate, AVAudioPlayerDelegate {
    private(set) var phase: CapturePhase = .idle
    private(set) var recordings: [Recording] = []
    private(set) var playingURL: URL?
    var errorMessage: String?

    private var audioRecorder: AVAudioRecorder?
    private var audioPlayer: AVAudioPlayer?

    override init() {
        super.init()
        reloadRecordings()
    }

    var persistentDirectory: URL {
        URL.applicationSupportDirectory.appending(path: "Recordings", directoryHint: .isDirectory)
    }

    var draftFilename: String {
        guard case let .reviewing(draft) = phase else { return "none" }
        return draft.url.lastPathComponent
    }

    func startRecording() async {
        guard case .idle = phase else { return }
        stopPlayback()
        errorMessage = nil

        let granted = await withCheckedContinuation { continuation in
            AVAudioApplication.requestRecordPermission { permissionGranted in
                continuation.resume(returning: permissionGranted)
            }
        }

        guard granted else {
            errorMessage = "Microphone permission is required. Enable it in Settings, then try again."
            return
        }

        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker])
            try session.setActive(true)

            let draftURL = FileManager.default.temporaryDirectory
                .appending(path: "pedos-draft-\(UUID().uuidString).m4a")
            let settings: [String: Any] = [
                AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
                AVSampleRateKey: 44_100,
                AVNumberOfChannelsKey: 1,
                AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue
            ]

            let recorder = try AVAudioRecorder(url: draftURL, settings: settings)
            recorder.delegate = self
            guard recorder.prepareToRecord(), recorder.record() else {
                throw RecorderProofError.couldNotStart
            }

            audioRecorder = recorder
            phase = .recording(startedAt: .now)
        } catch {
            audioRecorder = nil
            deactivateAudioSession()
            errorMessage = "Recording could not start: \(error.localizedDescription)"
        }
    }

    func stopRecording() {
        guard case .recording = phase, let recorder = audioRecorder else { return }
        let duration = recorder.currentTime
        let url = recorder.url
        recorder.stop()
        audioRecorder = nil
        deactivateAudioSession()

        guard duration > 0 else {
            try? FileManager.default.removeItem(at: url)
            phase = .idle
            errorMessage = "Nothing was captured. Try again."
            return
        }

        phase = .reviewing(DraftRecording(url: url, duration: duration))
    }

    func previewDraft() {
        guard case let .reviewing(draft) = phase else { return }
        togglePlayback(url: draft.url)
    }

    func saveDraft() {
        guard case let .reviewing(draft) = phase else { return }
        stopPlayback()

        do {
            try FileManager.default.createDirectory(
                at: persistentDirectory,
                withIntermediateDirectories: true
            )
            let destination = persistentDirectory.appending(path: "\(UUID().uuidString).m4a")
            try FileManager.default.moveItem(at: draft.url, to: destination)
            phase = .idle
            reloadRecordings()
        } catch {
            errorMessage = "The Recording could not be saved: \(error.localizedDescription)"
        }
    }

    func discardDraft() {
        guard case let .reviewing(draft) = phase else { return }
        stopPlayback()
        try? FileManager.default.removeItem(at: draft.url)
        phase = .idle
    }

    func togglePlayback(of recording: Recording) {
        togglePlayback(url: recording.url)
    }

    func delete(_ recording: Recording) {
        if playingURL == recording.url {
            stopPlayback()
        }

        do {
            try FileManager.default.removeItem(at: recording.url)
            reloadRecordings()
        } catch {
            errorMessage = "The Recording could not be deleted: \(error.localizedDescription)"
        }
    }

    func finishCaptureIfNeeded() {
        if case .recording = phase {
            stopRecording()
        }
    }

    private func togglePlayback(url: URL) {
        if playingURL == url {
            stopPlayback()
            return
        }

        do {
            stopPlayback()
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .default)
            try session.setActive(true)
            let player = try AVAudioPlayer(contentsOf: url)
            player.delegate = self
            guard player.play() else {
                throw RecorderProofError.couldNotPlay
            }
            audioPlayer = player
            playingURL = url
        } catch {
            stopPlayback()
            errorMessage = "Playback failed: \(error.localizedDescription)"
        }
    }

    private func stopPlayback() {
        audioPlayer?.stop()
        audioPlayer = nil
        playingURL = nil
        deactivateAudioSession()
    }

    private func reloadRecordings() {
        do {
            try FileManager.default.createDirectory(
                at: persistentDirectory,
                withIntermediateDirectories: true
            )
            let keys: Set<URLResourceKey> = [.creationDateKey, .isRegularFileKey]
            let urls = try FileManager.default.contentsOfDirectory(
                at: persistentDirectory,
                includingPropertiesForKeys: Array(keys),
                options: [.skipsHiddenFiles]
            )

            recordings = urls
                .filter { $0.pathExtension.lowercased() == "m4a" }
                .compactMap { url in
                    let values = try? url.resourceValues(forKeys: keys)
                    guard values?.isRegularFile == true,
                          let player = try? AVAudioPlayer(contentsOf: url) else {
                        return nil
                    }
                    return Recording(
                        id: UUID(uuidString: url.deletingPathExtension().lastPathComponent) ?? UUID(),
                        url: url,
                        createdAt: values?.creationDate ?? .distantPast,
                        duration: player.duration
                    )
                }
                .sorted { $0.createdAt > $1.createdAt }
        } catch {
            recordings = []
            errorMessage = "The Recording shelf could not be loaded: \(error.localizedDescription)"
        }
    }

    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        Task { @MainActor in
            audioPlayer = nil
            playingURL = nil
            deactivateAudioSession()
            if !flag {
                errorMessage = "Playback ended unexpectedly."
            }
        }
    }

    nonisolated func audioRecorderEncodeErrorDidOccur(
        _ recorder: AVAudioRecorder,
        error: (any Error)?
    ) {
        Task { @MainActor in
            audioRecorder = nil
            phase = .idle
            deactivateAudioSession()
            try? FileManager.default.removeItem(at: recorder.url)
            errorMessage = "Recording failed: \(error?.localizedDescription ?? "unknown error")"
        }
    }

    private func deactivateAudioSession() {
        try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
    }
}

private enum RecorderProofError: LocalizedError {
    case couldNotStart
    case couldNotPlay

    var errorDescription: String? {
        switch self {
        case .couldNotStart: "The audio recorder refused to start."
        case .couldNotPlay: "The audio player refused to start."
        }
    }
}
