import AVFAudio
import Foundation

/// Real recording: the microphone records each take to a draft file, `RecordingStore` keeps
/// saved Recordings as files, and Recording Analysis runs after each save (ADR 0002). Its result
/// is kept next to the Recording and re-run when the analysis changes version.
@MainActor
final class LiveRecordingSource: RecordingSource {
    /// Runs Recording Analysis on an audio file. It can take a while, so it runs off the main actor.
    struct Analyzer: Sendable {
        /// Results kept with another version are analyzed again.
        let version: Int
        let analyze: @Sendable (URL) throws -> SavedAnalysis
    }

    private let store: RecordingStore
    private let analyzer: Analyzer
    private let recorder = Recorder()
    /// UI tests on a machine without a microphone: each take is a copy of this file.
    private let testTake: URL?
    private var testTakeStarted = false
    private var interruptionObserver: (any NSObjectProtocol)?

    /// The file UI tests ask for with the `-PedosTestTake <path>` launch argument, in any build.
    static func testTake(in defaults: UserDefaults) -> URL? {
        defaults.string(forKey: "PedosTestTake").map { URL(filePath: $0) }
    }

    init(store: RecordingStore = .standard, analyzer: Analyzer, testTake: URL? = nil) {
        self.store = store
        self.analyzer = analyzer
        self.testTake = testTake
    }

    func savedRecordings() -> [Recording] {
        let stored = (try? store.load()) ?? []
        return stored.map { saved in
            let kept = store.analysis(of: saved.id, as: SavedAnalysis.self)
            return Recording(
                id: saved.id,
                number: saved.number,
                seconds: saved.seconds,
                analysis: kept.flatMap { $0.version == analyzer.version ? .analyzed($0.analysis) : nil } ?? .analyzing,
                audioURL: saved.audioURL
            )
        }
    }

    func startTake(onInterruption: @escaping @MainActor () -> Void) async throws {
        if testTake != nil {
            testTakeStarted = true
        } else {
            try await recorder.start(to: store.newDraftURL())
        }
        interruptionObserver = NotificationCenter.default.addObserver(
            forName: AVAudioSession.interruptionNotification, object: nil, queue: .main
        ) { notification in
            let type = (notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt)
                .flatMap(AVAudioSession.InterruptionType.init(rawValue:))
            guard type == .began else { return }
            MainActor.assumeIsolated { onInterruption() }
        }
    }

    func stopTake() async -> Take? {
        stopObservingInterruptions()
        if let testTake, testTakeStarted {
            testTakeStarted = false
            let draft = store.newDraftURL()
            guard (try? FileManager.default.copyItem(at: testTake, to: draft)) != nil,
                  let seconds = AudioLength.seconds(of: draft)
            else { return nil }
            return Take(id: UUID(), seconds: seconds, audioURL: draft)
        }
        guard case let (url, seconds)? = await recorder.stop() else { return nil }
        guard seconds > 0 else {
            store.discard(draftAt: url)
            return nil
        }
        return Take(id: UUID(), seconds: seconds, audioURL: url)
    }

    func cancelTake() async {
        stopObservingInterruptions()
        testTakeStarted = false
        if case let (url, _)? = await recorder.stop() { store.discard(draftAt: url) }
    }

    func save(_ take: Take) async throws -> Recording {
        guard let audioURL = take.audioURL else { throw CocoaError(.fileNoSuchFile) }
        let store = store
        let saved = try await Task.detached(priority: .userInitiated) {
            try store.save(draftAt: audioURL, seconds: take.seconds)
        }.value
        return Recording(id: saved.id, number: saved.number, seconds: saved.seconds, analysis: .analyzing, audioURL: saved.audioURL)
    }

    func discard(_ take: Take) {
        if let audioURL = take.audioURL { store.discard(draftAt: audioURL) }
    }

    func analyze(_ id: Recording.ID) async throws -> RecordingAnalysis {
        let (store, analyzer) = (store, analyzer)
        guard let audioURL = try store.load().first(where: { $0.id == id })?.audioURL else {
            throw CocoaError(.fileNoSuchFile)
        }
        let result = try await Task.detached(priority: .userInitiated) {
            let result = try analyzer.analyze(audioURL)
            try store.saveAnalysis(result, of: id)
            return result
        }.value
        return result.analysis
    }

    func delete(_ id: Recording.ID) {
        try? store.delete(id)
    }

    func fixtureID(of id: UUID) -> String? { nil }

    private func stopObservingInterruptions() {
        if let interruptionObserver { NotificationCenter.default.removeObserver(interruptionObserver) }
        interruptionObserver = nil
    }
}

/// Recording Analysis as kept next to a Recording (`<id>.analysis.json`).
struct SavedAnalysis: Codable, Hashable, Sendable {
    let version: Int
    /// Where the single clean gesture starts and ends in the file, in seconds.
    let gestureStartSeconds: Double
    let gestureEndSeconds: Double
    /// A second fart was cut off.
    let cutAtReattack: Bool
    /// The pitch estimate before audition, as a MIDI note number, and its confidence (0...1).
    let pitchEstimateMIDI: Double?
    let pitchConfidence: Double
    /// The Recording Pitch: nil for a Noise-like Recording.
    let recordingPitchMIDI: Double?
    /// The shortest note the Recording holds on pitch.
    let shortestNoteSeconds: Double?

    var analysis: RecordingAnalysis {
        RecordingAnalysis(
            pitch: recordingPitchMIDI,
            firstFartUsed: cutAtReattack,
            startSeconds: gestureStartSeconds,
            endSeconds: gestureEndSeconds
        )
    }
}

/// Records the microphone to a file: mono 44.1 kHz AAC (ADR 0002). It runs off the main actor,
/// because activating the audio session can block.
///
/// The session uses `.playAndRecord` with the speaker while recording, and is let go after, so
/// playback (`AudioPlayer`) can take it again.
private actor Recorder {
    private var recorder: AVAudioRecorder?

    func start(to url: URL) throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker])
        try session.setActive(true)
        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 44_100,
            AVNumberOfChannelsKey: 1,
            AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue,
        ]
        do {
            let recorder = try AVAudioRecorder(url: url, settings: settings)
            guard recorder.prepareToRecord(), recorder.record() else { throw CouldNotRecordError() }
            self.recorder = recorder
        } catch {
            try? FileManager.default.removeItem(at: url)
            letGoOfSession()
            throw error
        }
    }

    /// Stops recording and returns the file and its length, or nil when nothing was recording.
    func stop() -> (URL, Double)? {
        guard let recorder else { return nil }
        let seconds = recorder.currentTime
        recorder.stop()
        self.recorder = nil
        letGoOfSession()
        return (recorder.url, seconds)
    }

    private func letGoOfSession() {
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}
