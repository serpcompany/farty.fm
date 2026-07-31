import AVFAudio
import Foundation
import Observation

struct Recording: Identifiable {
    let id: String
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
    private(set) var analysisByRecordingID: [String: RecordingAnalysisStatus] = [:]
    private(set) var analysisExecutionsThisLaunch = 0
    var errorMessage: String?

    private var audioRecorder: AVAudioRecorder?
    private var audioPlayer: AVAudioPlayer?
    private let analysisService = RecordingAnalysisService()

    private let proofCaseFilenames = [
        "017__breviceps__fart-3__446000.mp3",
        "044__walter-odington__fart-wav__69500.mp3",
        "023__the-fart__fart-attack__436834.mp3"
    ]

    override init() {
        super.init()
        reloadRecordings()

        if CommandLine.arguments.contains("--install-analysis-cases") {
            installProofCases()
        }
        if CommandLine.arguments.contains("--analyze-missing") {
            analyzeMissing()
        }
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
        print("[RecorderProof] start requested")
        stopPlayback()
        errorMessage = nil

        let granted = await hasRecordPermission()
        print("[RecorderProof] permission result: \(granted)")

        guard granted else {
            errorMessage = "Microphone permission is required. Enable it in Settings, then try again."
            return
        }

        do {
            let session = AVAudioSession.sharedInstance()
            print("[RecorderProof] configuring audio session")
            try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker])
            try session.setActive(true)
            print("[RecorderProof] audio session active")

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
            print("[RecorderProof] recording started")
        } catch {
            print("[RecorderProof] recording start failed: \(error)")
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
            if let saved = recordings.first(where: { $0.url == destination }) {
                analyze(saved)
            }
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
            analysisService.deleteAnalysis(for: recording)
            reloadRecordings()
        } catch {
            errorMessage = "The Recording could not be deleted: \(error.localizedDescription)"
        }
    }

    func analysisStatus(for recording: Recording) -> RecordingAnalysisStatus {
        analysisByRecordingID[recording.id] ?? .missing
    }

    func analyze(_ recording: Recording) {
        if case .analyzing = analysisStatus(for: recording) {
            return
        }

        analysisByRecordingID[recording.id] = .analyzing
        let service = analysisService

        Task {
            do {
                let analysis = try await Task.detached(priority: .userInitiated) {
                    try service.analyze(recording)
                }.value
                analysisExecutionsThisLaunch += 1
                analysisByRecordingID[recording.id] = .ready(analysis, source: .fresh)
            } catch {
                analysisByRecordingID[recording.id] = .failed(error.localizedDescription)
            }
        }
    }

    func analyzeMissing() {
        for recording in recordings {
            if case .missing = analysisStatus(for: recording) {
                analyze(recording)
            }
        }
    }

    func installProofCases() {
        do {
            try FileManager.default.createDirectory(
                at: persistentDirectory,
                withIntermediateDirectories: true
            )

            for filename in proofCaseFilenames {
                let sourceName = String(filename.dropLast(4))
                guard let source = Bundle.main.url(forResource: sourceName, withExtension: "mp3") else {
                    throw RecorderProofError.missingProofCase(filename)
                }
                let destination = persistentDirectory.appending(path: filename)
                if !FileManager.default.fileExists(atPath: destination.path) {
                    try FileManager.default.copyItem(at: source, to: destination)
                }
            }

            reloadRecordings()
        } catch {
            errorMessage = "Proof cases could not be installed: \(error.localizedDescription)"
        }
    }

    func forgetAllAnalysis() {
        do {
            try analysisService.deleteAll()
            reloadRecordings()
        } catch {
            errorMessage = "Recording Analysis could not be cleared: \(error.localizedDescription)"
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

    private func hasRecordPermission() async -> Bool {
#if targetEnvironment(simulator)
        // Simulator privacy callbacks can remain pending under UI automation even
        // after `simctl privacy grant`. Device builds still use the real prompt.
        return true
#else
        switch AVAudioApplication.shared.recordPermission {
        case .granted:
            return true
        case .denied:
            return false
        case .undetermined:
            return await withCheckedContinuation { continuation in
                AVAudioApplication.requestRecordPermission { permissionGranted in
                    continuation.resume(returning: permissionGranted)
                }
            }
        @unknown default:
            return false
        }
#endif
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
                .filter { ["m4a", "mp3", "wav"].contains($0.pathExtension.lowercased()) }
                .compactMap { url in
                    let values = try? url.resourceValues(forKeys: keys)
                    guard values?.isRegularFile == true,
                          let player = try? AVAudioPlayer(contentsOf: url) else {
                        return nil
                    }
                    return Recording(
                        id: url.deletingPathExtension().lastPathComponent,
                        url: url,
                        createdAt: values?.creationDate ?? .distantPast,
                        duration: player.duration
                    )
                }
                .sorted { $0.createdAt > $1.createdAt }

            analysisByRecordingID = Dictionary(
                uniqueKeysWithValues: recordings.map { recording in
                    let status = analysisService.preservedAnalysis(for: recording)
                        .map { RecordingAnalysisStatus.ready($0, source: .preserved) }
                        ?? .missing
                    return (recording.id, status)
                }
            )
        } catch {
            recordings = []
            analysisByRecordingID = [:]
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
    case missingProofCase(String)

    var errorDescription: String? {
        switch self {
        case .couldNotStart: "The audio recorder refused to start."
        case .couldNotPlay: "The audio player refused to start."
        case let .missingProofCase(filename): "Bundled proof case is missing: \(filename)"
        }
    }
}
