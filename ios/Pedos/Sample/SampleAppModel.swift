import Foundation
import Observation

/// The app model with sample data: recording is simulated, and each take is the next Fixture
/// Library Recording in the prototype's story order, with its reference analysis.
///
/// Debug builds start it with the Fixture Library (`SampleFixture.prototypeLibrary`). Release
/// builds carry no fixtures, so they start empty and can't record until the real recorder (#12)
/// replaces this model.
@MainActor
@Observable
final class SampleAppModel: AppModel {
    /// Failures to simulate once each, to show the error states.
    struct Failures: OptionSet, Sendable {
        let rawValue: Int
        static let couldNotStart = Failures(rawValue: 1 << 0)
        static let interrupted = Failures(rawValue: 1 << 1)
        static let nothingHeard = Failures(rawValue: 1 << 2)
        static let saveFailed = Failures(rawValue: 1 << 3)
        static let analysisFailed = Failures(rawValue: 1 << 4)
    }

    /// Takes shorter than this count as nothing heard.
    static let minimumTakeSeconds = 0.5
    /// The UserDefaults key that remembers Welcome was shown.
    static let welcomeSeenKey = "welcomeSeen"

    private(set) var recordings: [Recording] = []
    let songs: [Song]
    private(set) var isShowingWelcome: Bool
    private(set) var capture: CaptureState = .idle
    private(set) var recordProblem: RecordProblem?
    private(set) var flow: RecordFlow?
    var nowPlaying: PlaybackItem? { player.nowPlaying }

    @ObservationIgnored private let fixtures: [SampleFixture]
    @ObservationIgnored private let story: [String]
    /// Which fixture each Recording stands in for.
    @ObservationIgnored private var fixtureOfRecording: [Recording.ID: SampleFixture] = [:]
    /// Which fixture each unsaved take stands in for.
    @ObservationIgnored private var fixtureOfDraft: [Draft.ID: SampleFixture] = [:]
    /// How many takes were saved, which picks the story fixture once every fixture is used.
    @ObservationIgnored private var savedTakes: Int
    @ObservationIgnored private var pendingFailures: Failures
    @ObservationIgnored private let microphone: any MicrophoneAccess
    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private let now: () -> Date
    @ObservationIgnored private let analysisDelay: Duration
    @ObservationIgnored private let interruptionDelay: Duration
    @ObservationIgnored private var interruption: Task<Void, Never>?
    @ObservationIgnored private let player = AudioPlayer()

    /// - Parameters:
    ///   - fixtures: the Recordings simulated takes come from.
    ///   - story: fixture ids in the order takes arrive; the rest follow in `fixtures` order.
    ///   - initialFixtureIDs: fixtures already saved (and analyzed) at launch, oldest first.
    ///   - failures: failures to simulate, each once.
    init(
        fixtures: [SampleFixture],
        story: [String],
        songs: [Song],
        initialFixtureIDs: [String] = [],
        microphone: any MicrophoneAccess,
        defaults: UserDefaults,
        failures: Failures = [],
        now: @escaping () -> Date = Date.init,
        analysisDelay: Duration = .milliseconds(900),
        interruptionDelay: Duration = .milliseconds(1500)
    ) {
        self.fixtures = fixtures
        self.story = story
        self.songs = songs
        self.microphone = microphone
        self.defaults = defaults
        self.pendingFailures = failures
        self.now = now
        self.analysisDelay = analysisDelay
        self.interruptionDelay = interruptionDelay
        self.isShowingWelcome = !defaults.bool(forKey: Self.welcomeSeenKey)
        self.savedTakes = min(initialFixtureIDs.count, story.count)

        for fixtureID in initialFixtureIDs {
            guard let fixture = fixtures.first(where: { $0.id == fixtureID }) else { continue }
            let recording = Recording(
                id: UUID(),
                number: recordings.count + 1,
                seconds: fixture.seconds,
                analysis: .analyzed(fixture.analysis),
                audioURL: fixture.audioURL
            )
            recordings.append(recording)
            fixtureOfRecording[recording.id] = fixture
        }
    }

    // MARK: First launch

    func allowMicrophoneFromWelcome() async {
        closeWelcome()
        _ = await microphone.requestPermission()
    }

    func skipWelcome() {
        closeWelcome()
    }

    private func closeWelcome() {
        defaults.set(true, forKey: Self.welcomeSeenKey)
        isShowingWelcome = false
    }

    // MARK: Record tab

    func startRecording() async {
        guard capture == .idle, flow == nil else { return }
        recordProblem = nil
        stopPlayback()

        switch microphone.permission {
        case .granted:
            break
        case .denied:
            recordProblem = .microphoneOff
            return
        case .undetermined:
            // Saying no to the system prompt is an answer, not an error.
            guard await microphone.requestPermission() else { return }
        }

        guard pendingFailures.remove(.couldNotStart) == nil, nextFixture() != nil else {
            recordProblem = .couldNotStart
            return
        }
        capture = .recording(startedAt: now())
        if pendingFailures.remove(.interrupted) != nil {
            interruption = Task { [interruptionDelay] in
                try? await Task.sleep(for: interruptionDelay)
                guard !Task.isCancelled else { return }
                self.interruptRecording()
            }
        }
    }

    func stopRecording() async {
        guard case .recording(let startedAt) = capture else { return }
        interruption?.cancel()
        capture = .finishing

        let longEnough = now().timeIntervalSince(startedAt) >= Self.minimumTakeSeconds
        guard longEnough, pendingFailures.remove(.nothingHeard) == nil, let fixture = nextFixture() else {
            capture = .idle
            recordProblem = .nothingHeard
            return
        }
        // Decoding the whole file for the waveform can block, so it runs off the main actor.
        let audioURL = fixture.audioURL
        let waveform = await Task.detached(priority: .userInitiated) {
            Waveform.levels(of: audioURL, count: 40)
        }.value
        let draft = Draft(id: UUID(), seconds: fixture.seconds, audioURL: audioURL, waveform: waveform)
        fixtureOfDraft[draft.id] = fixture
        capture = .idle
        flow = .review(draft)
    }

    /// A call or another app took the microphone: the take is lost.
    func interruptRecording() {
        guard case .recording = capture else { return }
        interruption?.cancel()
        capture = .idle
        recordProblem = .interrupted
    }

    func dismissRecordProblem() {
        recordProblem = nil
    }

    /// The next fixture in story order that isn't already a Recording.
    private func nextFixture() -> SampleFixture? {
        let saved = Set(fixtureOfRecording.values.map(\.id))
        let id = (story + fixtures.map(\.id)).first { !saved.contains($0) }
            ?? (story.isEmpty ? nil : story[savedTakes % story.count])
        return fixtures.first { $0.id == id }
    }

    // MARK: Review and Result

    func saveDraft() async {
        let draft: Draft
        switch flow {
        case .review(let reviewed), .saveFailed(let reviewed): draft = reviewed
        default: return
        }
        stopPlayback()
        guard pendingFailures.remove(.saveFailed) == nil, let fixture = fixtureOfDraft[draft.id] else {
            flow = .saveFailed(draft)
            return
        }
        fixtureOfDraft[draft.id] = nil

        let recording = Recording(
            id: UUID(),
            number: (recordings.map(\.number).max() ?? 0) + 1,
            seconds: draft.seconds,
            analysis: .analyzing,
            audioURL: draft.audioURL
        )
        recordings.append(recording)
        fixtureOfRecording[recording.id] = fixture
        savedTakes += 1
        flow = .analyzing(recording.id)
        await analyze(recording.id)
    }

    func discardDraft() {
        stopPlayback()
        fixtureOfDraft.removeAll()
        flow = nil
    }

    func retryAnalysis(of id: Recording.ID) async {
        guard let index = recordings.firstIndex(where: { $0.id == id }),
              recordings[index].analysis == .notAnalyzed
        else { return }
        recordings[index].analysis = .analyzing
        if flow == .analysisFailed(id) {
            flow = .analyzing(id)
        }
        await analyze(id)
    }

    /// Simulates Recording Analysis with the fixture's reference result, and shows the Result
    /// when the cover is waiting for it.
    private func analyze(_ id: Recording.ID) async {
        try? await Task.sleep(for: analysisDelay)
        guard let index = recordings.firstIndex(where: { $0.id == id }),
              let fixture = fixtureOfRecording[id]
        else { return }

        let showsResult = flow == .analyzing(id)
        if pendingFailures.remove(.analysisFailed) != nil {
            recordings[index].analysis = .notAnalyzed
            if showsResult { flow = .analysisFailed(id) }
            return
        }
        let before = recordings
        recordings[index].analysis = .analyzed(fixture.analysis)
        if showsResult {
            flow = .result(RecordResult(
                recordingID: id,
                changes: CoverageChanges(songs: songs, before: before, after: recordings)
            ))
        }
    }

    func finishFlow() {
        stopPlayback()
        fixtureOfDraft.removeAll()
        flow = nil
    }

    /// The Fixture Library id an unsaved take stands in for.
    func fixtureID(ofDraft id: Draft.ID) -> String? {
        fixtureOfDraft[id]?.id
    }

    #if DEBUG
    func simulatedSource(ofDraft id: Draft.ID) -> String? {
        fixtureID(ofDraft: id).map { "Fixture Library Recording \($0)" }
    }
    #endif

    // MARK: Playback

    func togglePlayback(of item: PlaybackItem) {
        player.toggle(item, url: audioURL(of: item))
    }

    func stopPlayback() {
        player.stop()
    }

    private func audioURL(of item: PlaybackItem) -> URL? {
        switch item {
        case .draft(let id):
            switch flow {
            case .review(let draft) where draft.id == id, .saveFailed(let draft) where draft.id == id: draft.audioURL
            default: nil
            }
        case .recording(let id):
            recording(id)?.audioURL
        }
    }

    // MARK: Recordings

    func delete(_ id: Recording.ID) {
        if nowPlaying == .recording(id) { stopPlayback() }
        recordings.removeAll { $0.id == id }
        fixtureOfRecording[id] = nil
    }
}

/// A Fixture Library Recording with its reference analysis, standing in for a take.
struct SampleFixture: Identifiable, Hashable, Sendable {
    /// The Fixture Library id, for example "069".
    let id: String
    /// The Recording Pitch as a MIDI note number, or nil when Noise-like.
    let pitch: Double?
    let seconds: Double
    let firstFartUsed: Bool

    var analysis: RecordingAnalysis { RecordingAnalysis(pitch: pitch, firstFartUsed: firstFartUsed) }

    /// The trimmed fixture audio from the prototype, bundled in Debug builds only.
    var audioURL: URL? { Bundle.main.url(forResource: "rec-\(id)", withExtension: "mp3") }
}
