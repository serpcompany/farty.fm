import Foundation
import Observation

/// The app model with sample data: recording is simulated, and each take is the next Fixture
/// Library Recording in the prototype's story order, with its reference analysis. Song Creator is
/// simulated too: making a melody returns the design prototype's render of the Song.
///
/// Debug builds start it with the Fixture Library (`SampleFixture.prototypeLibrary`) and the
/// prototype's Song audio. Release builds carry neither, so they start empty, can't record until
/// the real recorder (#12) replaces this model, and can't make melodies until rendering (#17).
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
        /// Song Creator: "Couldn't make this melody".
        static let couldNotMakeMelody = Failures(rawValue: 1 << 5)
        /// The next Created Melody (at launch, or else the next one saved) has lost its audio.
        static let melodyAudioMissing = Failures(rawValue: 1 << 6)
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
    private(set) var melodies: [CreatedMelody] = []
    var nowPlaying: PlaybackItem? { player.nowPlaying }
    var playbackStartedAt: Date? { player.startedAt }

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
    /// The audio that stands in for Song Creator's render of a Song, when the build has any.
    @ObservationIgnored private let songAudio: (Song) -> URL?
    /// How long making a melody takes.
    @ObservationIgnored private let makingDelay: Duration
    /// Melodies Song Creator made, saved or not, for playback.
    @ObservationIgnored private var melodyDrafts: [MelodyDraft.ID: MelodyDraft] = [:]
    @ObservationIgnored private var coverageCache = CoverageCache()

    /// - Parameters:
    ///   - fixtures: the Recordings simulated takes come from.
    ///   - story: fixture ids in the order takes arrive; the rest follow in `fixtures` order.
    ///   - initialFixtureIDs: fixtures already saved (and analyzed) at launch, oldest first.
    ///   - initialMelodySongIDs: Songs already saved as Created Melodies at launch, oldest first.
    ///   - songAudio: the audio a made melody of each Song plays; nil where there's none.
    ///   - failures: failures to simulate, each once.
    init(
        fixtures: [SampleFixture],
        story: [String],
        songs: [Song],
        initialFixtureIDs: [String] = [],
        initialMelodySongIDs: [Song.ID] = [],
        songAudio: @escaping (Song) -> URL? = { _ in nil },
        microphone: any MicrophoneAccess,
        defaults: UserDefaults,
        failures: Failures = [],
        now: @escaping () -> Date = Date.init,
        analysisDelay: Duration = .milliseconds(900),
        interruptionDelay: Duration = .milliseconds(1500),
        makingDelay: Duration = .milliseconds(1200)
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
        self.songAudio = songAudio
        self.makingDelay = makingDelay
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

        for songID in initialMelodySongIDs {
            guard let song = songs.first(where: { $0.id == songID }),
                  let url = songAudio(song),
                  let seconds = AudioLength.seconds(of: url)
            else { continue }
            addMelody(id: UUID(), title: song.title, seconds: seconds, audioURL: url)
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

    func coverage(of song: Song) -> CoverageResult {
        coverageCache.coverage(of: song, recordings: recordings)
    }

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
        case .melodyDraft(let id):
            melodyDrafts[id]?.audioURL
        case .melody(let id):
            melody(id).flatMap { $0.isAudioMissing ? nil : $0.audioURL }
        }
    }

    // MARK: Recordings

    func delete(_ id: Recording.ID) {
        if nowPlaying == .recording(id) { stopPlayback() }
        recordings.removeAll { $0.id == id }
        fixtureOfRecording[id] = nil
    }

    // MARK: Compose

    /// Simulates Song Creator: after `makingDelay`, returns the stand-in audio for the Song with
    /// Auto-map's Arrangement of the Recordings.
    func makeMelody(of song: Song) async throws -> MelodyDraft {
        try await Task.sleep(for: makingDelay)
        guard let arrangement = coverage(of: song).arrangement else { throw MelodyError.locked }
        guard pendingFailures.remove(.couldNotMakeMelody) == nil, let url = songAudio(song) else {
            throw MelodyError.couldNotMake
        }
        // Reading the file can block, so it runs off the main actor.
        let seconds = await Task.detached(priority: .userInitiated) { AudioLength.seconds(of: url) }.value
        guard let seconds else { throw MelodyError.couldNotMake }
        let draft = MelodyDraft(id: UUID(), song: song, arrangement: arrangement, seconds: seconds, audioURL: url)
        melodyDrafts[draft.id] = draft
        return draft
    }

    func saveMelody(_ draft: MelodyDraft) {
        guard melody(draft.id) == nil else { return }
        addMelody(id: draft.id, title: draft.song.title, seconds: draft.seconds, audioURL: draft.audioURL)
    }

    private func addMelody(id: UUID, title: String, seconds: Double, audioURL: URL) {
        var audioURL = audioURL
        if pendingFailures.remove(.melodyAudioMissing) != nil {
            audioURL = URL.temporaryDirectory.appending(path: "missing-\(id.uuidString).mp3")
        }
        melodies.append(CreatedMelody(id: id, title: title, origin: title, createdAt: now(), seconds: seconds, audioURL: audioURL))
    }

    #if DEBUG
    func simulatedSource(ofMelody id: MelodyDraft.ID) -> String? {
        melodyDrafts[id] == nil ? nil : "the design prototype's render of this Song"
    }
    #endif

    // MARK: Melodies

    func renameMelody(_ id: CreatedMelody.ID, to title: String) {
        let title = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty, let index = melodies.firstIndex(where: { $0.id == id }) else { return }
        melodies[index].title = title
    }

    func deleteMelody(_ id: CreatedMelody.ID) {
        if nowPlaying == .melody(id) { stopPlayback() }
        melodies.removeAll { $0.id == id }
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

#if DEBUG
extension Song {
    /// The design prototype's render of this Song with the whole Fixture Library, bundled in Debug
    /// builds only. It stands in for Song Creator's own render until #17. It came from the
    /// reference planner before the 3-semitone rule (#43), so it doesn't follow the Arrangement.
    var prototypeAudioURL: URL? { Bundle.main.url(forResource: "song-\(id)", withExtension: "mp3") }
}
#endif
