import Foundation
import Observation

/// The app model: it runs every screen's states. Recordings come from a `RecordingSource`: the
/// microphone, files and Recording Analysis (`LiveRecordingSource`), or in Debug builds the
/// Fixture Library (`FixtureRecordingSource`). Song Creator is still simulated: making a Toot
/// returns the design prototype's render of the Song, which only Debug builds carry, so Release
/// builds can't make Toots until rendering (#17).
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
        /// Song Creator: "Couldn't make this Toot".
        static let couldNotMakeToot = Failures(rawValue: 1 << 5)
        /// The next Toot (at launch, or else the next one saved) has lost its audio.
        static let tootAudioMissing = Failures(rawValue: 1 << 6)
    }

    /// Takes shorter than this count as nothing heard.
    static let minimumTakeSeconds = 0.5
    /// Recording stops by itself after this long, which keeps analysis quick and small.
    static let maximumTakeSeconds = 30.0
    /// The UserDefaults key that remembers Welcome was shown.
    static let welcomeSeenKey = "welcomeSeen"

    private(set) var recordings: [Recording] = []
    let songs: [Song]
    private(set) var isShowingWelcome: Bool
    private(set) var capture: CaptureState = .idle
    private(set) var recordProblem: RecordProblem?
    private(set) var flow: RecordFlow?
    private(set) var toots: [Toot] = []
    var nowPlaying: PlaybackItem? { player.nowPlaying }
    var playbackStartedAt: Date? { player.startedAt }

    @ObservationIgnored private let source: any RecordingSource
    /// A start or a save is under way, so a second tap does nothing.
    @ObservationIgnored private var isStarting = false
    @ObservationIgnored private var isSaving = false
    /// Stops a take at `maximumTakeSeconds`.
    @ObservationIgnored private var takeLimit: Task<Void, Never>?
    #if INTERNAL
    private var isLoadingFixtures = false
    /// The Fixture Library files this build carries, when the source can load them.
    @ObservationIgnored private let bundledFixtures: [FixtureLibrary.Fixture]
    #endif
    /// Song Creator failures to simulate (recording failures are the source's).
    @ObservationIgnored private var pendingFailures: Failures
    @ObservationIgnored private let microphone: any MicrophoneAccess
    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private let now: () -> Date
    @ObservationIgnored private let player = AudioPlayer()
    /// The audio that stands in for Song Creator's render of a Song, when the build has any.
    @ObservationIgnored private let songAudio: (Song) -> URL?
    /// How that audio was rendered, by Song.
    @ObservationIgnored private let renders: [Song.ID: StandInRender]
    /// How long making a Toot takes.
    @ObservationIgnored private let makingDelay: Duration
    /// Toots Song Creator made, saved or not, for playback.
    @ObservationIgnored private var tootDrafts: [TootDraft.ID: TootDraft] = [:]
    /// Toots whose Arrangement is the one their stand-in audio was rendered with.
    @ObservationIgnored private var tootsPlayingTheirArrangement: Set<TootDraft.ID> = []
    @ObservationIgnored private var coverageCache: CoverageCache

    /// - Parameters:
    ///   - source: where takes come from and Recordings are kept.
    ///   - initialTootSongIDs: Songs already saved as Toots at launch, oldest first.
    ///   - songAudio: the audio a made Toot of each Song plays; nil where there's none.
    ///   - renders: how that audio was rendered, by Song.
    ///   - failures: Song Creator failures to simulate, each once.
    init(
        source: any RecordingSource,
        songs: [Song],
        initialTootSongIDs: [Song.ID] = [],
        songAudio: @escaping (Song) -> URL? = { _ in nil },
        renders: [Song.ID: StandInRender] = [:],
        microphone: any MicrophoneAccess,
        defaults: UserDefaults,
        failures: Failures = [],
        now: @escaping () -> Date = Date.init,
        makingDelay: Duration = .milliseconds(1200)
    ) {
        self.source = source
        self.songs = songs
        self.microphone = microphone
        self.defaults = defaults
        self.pendingFailures = failures
        self.now = now
        self.songAudio = songAudio
        self.renders = renders
        self.makingDelay = makingDelay
        self.coverageCache = CoverageCache(songs: songs)
        self.isShowingWelcome = !defaults.bool(forKey: Self.welcomeSeenKey)
        self.recordings = source.savedRecordings()
        #if INTERNAL
        self.bundledFixtures = source.canLoadFixtures ? FixtureLibrary.bundled() : []
        #endif

        for songID in initialTootSongIDs {
            guard let song = songs.first(where: { $0.id == songID }),
                  let url = songAudio(song),
                  let seconds = AudioLength.seconds(of: url)
            else { continue }
            let arrangement = renderArrangement(of: song) ?? coverage(of: song).matchedArrangement ?? .empty
            addToot(id: UUID(), song: song, arrangement: arrangement, seconds: seconds, audioURL: url)
        }

        // Recordings saved before an analysis update, or before analysis finished, are analyzed now.
        for recording in recordings where recording.analysis == .analyzing {
            Task { await analyze(recording.id) }
        }
    }

    /// The sample model: takes come from the Fixture Library (see `FixtureRecordingSource`).
    ///   - fixtures: the Recordings simulated takes come from.
    ///   - story: fixture ids in the order takes arrive; the rest follow in `fixtures` order.
    ///   - initialFixtureIDs: fixtures already saved (and analyzed) at launch, oldest first.
    ///   - failures: failures to simulate, each once.
    convenience init(
        fixtures: [SampleFixture],
        story: [String],
        songs: [Song],
        initialFixtureIDs: [String] = [],
        initialTootSongIDs: [Song.ID] = [],
        songAudio: @escaping (Song) -> URL? = { _ in nil },
        renders: [Song.ID: StandInRender] = [:],
        microphone: any MicrophoneAccess,
        defaults: UserDefaults,
        failures: Failures = [],
        now: @escaping () -> Date = Date.init,
        analysisDelay: Duration = .milliseconds(900),
        interruptionDelay: Duration = .milliseconds(1500),
        makingDelay: Duration = .milliseconds(1200)
    ) {
        self.init(
            source: FixtureRecordingSource(
                fixtures: fixtures,
                story: story,
                initialFixtureIDs: initialFixtureIDs,
                failures: failures,
                analysisDelay: analysisDelay,
                interruptionDelay: interruptionDelay
            ),
            songs: songs,
            initialTootSongIDs: initialTootSongIDs,
            songAudio: songAudio,
            renders: renders,
            microphone: microphone,
            defaults: defaults,
            failures: failures,
            now: now,
            makingDelay: makingDelay
        )
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

    #if INTERNAL
    // MARK: Internal builds

    var fixtureLibrary: FixtureLibraryStatus? {
        guard !bundledFixtures.isEmpty else { return nil }
        let loaded = loadedFixtureIDs
        return FixtureLibraryStatus(
            loaded: bundledFixtures.filter { loaded.contains($0.id) }.count,
            total: bundledFixtures.count,
            isLoading: isLoadingFixtures
        )
    }

    func loadFixtureLibrary() async {
        guard !bundledFixtures.isEmpty, !isLoadingFixtures else { return }
        isLoadingFixtures = true
        defer { isLoadingFixtures = false }
        let loaded = loadedFixtureIDs
        var added: [Recording.ID] = []
        for fixture in bundledFixtures where !loaded.contains(fixture.id) {
            guard let recording = try? await source.loadFixture(fixture) else { continue }
            recordings.append(recording)
            added.append(recording.id)
        }
        for id in added { await analyze(id) }
    }

    private var loadedFixtureIDs: Set<String> {
        Set(recordings.compactMap { source.fixtureID(of: $0.id) })
    }
    #endif

    // MARK: Record tab

    func startRecording() async {
        guard capture == .idle, flow == nil, !isStarting else { return }
        isStarting = true
        defer { isStarting = false }
        recordProblem = nil
        // Playback lets go of the audio session before the recorder takes it.
        await player.stopAndWait()

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

        do {
            try await source.startTake { [weak self] in self?.interruptRecording() }
        } catch {
            recordProblem = .couldNotStart
            return
        }
        capture = .recording(startedAt: now())
        takeLimit = Task { [weak self] in
            try? await Task.sleep(for: .seconds(Self.maximumTakeSeconds))
            guard !Task.isCancelled else { return }
            await self?.stopRecording()
        }
    }

    func stopRecording() async {
        guard case .recording(let startedAt) = capture else { return }
        takeLimit?.cancel()
        capture = .finishing

        let longEnough = now().timeIntervalSince(startedAt) >= Self.minimumTakeSeconds
        guard longEnough else {
            await source.cancelTake()
            capture = .idle
            recordProblem = .nothingHeard
            return
        }
        guard let take = await source.stopTake() else {
            capture = .idle
            recordProblem = .nothingHeard
            return
        }
        // Decoding the whole file for the waveform can block, so it runs off the main actor.
        let audioURL = take.audioURL
        let waveform = await Task.detached(priority: .userInitiated) {
            audioURL.map { Waveform.levels(of: $0, count: 40) } ?? []
        }.value
        capture = .idle
        flow = .review(Draft(id: take.id, seconds: take.seconds, audioURL: take.audioURL, waveform: waveform))
    }

    /// A call or another app took the microphone: the take is lost.
    func interruptRecording() {
        guard case .recording = capture else { return }
        takeLimit?.cancel()
        capture = .idle
        recordProblem = .interrupted
        Task { await source.cancelTake() }
    }

    func dismissRecordProblem() {
        recordProblem = nil
    }

    // MARK: Review and Result

    func saveDraft() async {
        let draft: Draft
        switch flow {
        case .review(let reviewed), .saveFailed(let reviewed): draft = reviewed
        default: return
        }
        guard !isSaving else { return }
        isSaving = true
        stopPlayback()
        let recording: Recording
        do {
            recording = try await source.save(take(of: draft))
        } catch {
            isSaving = false
            flow = .saveFailed(draft)
            return
        }
        isSaving = false
        recordings.append(recording)
        flow = .analyzing(recording.id)
        await analyze(recording.id)
    }

    func discardDraft() {
        stopPlayback()
        if let draft = flowDraft { source.discard(take(of: draft)) }
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

    /// Runs Recording Analysis, and shows the Result when the cover is waiting for it.
    private func analyze(_ id: Recording.ID) async {
        let result: RecordingAnalysis?
        do {
            result = try await source.analyze(id)
        } catch {
            result = nil
        }
        guard let index = recordings.firstIndex(where: { $0.id == id }) else { return }

        let showsResult = flow == .analyzing(id)
        guard let result else {
            recordings[index].analysis = .notAnalyzed
            if showsResult { flow = .analysisFailed(id) }
            return
        }
        let before = recordings
        recordings[index].analysis = .analyzed(result)
        if showsResult {
            flow = .result(RecordResult(
                recordingID: id,
                changes: CoverageChanges(songs: songs, before: before, after: recordings)
            ))
        }
    }

    func finishFlow() {
        stopPlayback()
        if let draft = flowDraft { source.discard(take(of: draft)) }
        flow = nil
    }

    /// The take under Review, or whose save failed.
    private var flowDraft: Draft? {
        switch flow {
        case .review(let draft), .saveFailed(let draft): draft
        default: nil
        }
    }

    private func take(of draft: Draft) -> Take {
        Take(id: draft.id, seconds: draft.seconds, audioURL: draft.audioURL)
    }

    /// The Fixture Library id an unsaved take stands in for.
    func fixtureID(ofDraft id: Draft.ID) -> String? {
        source.fixtureID(of: id)
    }

    #if INTERNAL
    func simulatedSource(ofDraft id: Draft.ID) -> String? {
        fixtureID(ofDraft: id).map { "Fixture Library Recording \($0)" }
    }
    #endif

    func coverage(of song: Song) -> CoverageResult {
        coverageCache.coverage(of: song, recordings: recordings)
    }

    func songListing(matching query: String, order: SongOrder) -> SongListing {
        coverageCache.listing(recordings: recordings, matching: query, order: order)
    }

    // MARK: Playback

    func togglePlayback(of item: PlaybackItem) {
        if case .note(let id, let index) = item {
            let (url, segment) = noteAudio(of: id, index: index)
            player.toggle(item, url: url, segment: segment)
        } else if case .recording(let id) = item, let recording = recording(id) {
            player.toggle(item, url: recording.audioURL, segment: recording.replaySegment)
        } else {
            player.toggle(item, url: audioURL(of: item))
        }
    }

    /// One note of a Toot, as rendered: its stretch of the Toot's own audio.
    private func noteAudio(of id: UUID, index: Int) -> (URL?, Segment?) {
        let song: Song?
        let url: URL?
        if let draft = tootDrafts[id] {
            (song, url) = (draft.song, draft.audioURL)
        } else if let toot = toot(id), !toot.isAudioMissing {
            (song, url) = (self.song(toot.songID), toot.audioURL)
        } else {
            return (nil, nil)
        }
        guard let song, song.notes.indices.contains(index) else { return (nil, nil) }
        let (start, length) = song.seconds(of: song.notes[index])
        return (url, Segment(start: start, length: length))
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
        case .tootDraft(let id):
            tootDrafts[id]?.audioURL
        case .toot(let id):
            toot(id).flatMap { $0.isAudioMissing ? nil : $0.audioURL }
        case .note(let id, let index):
            noteAudio(of: id, index: index).0
        }
    }

    // MARK: Recordings

    func delete(_ id: Recording.ID) {
        if nowPlaying == .recording(id) { stopPlayback() }
        recordings.removeAll { $0.id == id }
        source.delete(id)
    }

    // MARK: Compose

    /// Simulates Song Creator: after `makingDelay`, returns the stand-in audio for the Song.
    ///
    /// When the user has every Recording the stand-in was rendered with, the Toot's Arrangement
    /// is that render's, so what Song Creator shows is what plays. Otherwise it's Pitch
    /// Coverage's matching, and `simulatedSource(ofToot:)` says the audio doesn't follow it.
    func makeToot(of song: Song) async throws -> TootDraft {
        try await Task.sleep(for: makingDelay)
        guard let matched = coverage(of: song).matchedArrangement else { throw TootError.locked }
        guard pendingFailures.remove(.couldNotMakeToot) == nil, let url = songAudio(song) else {
            throw TootError.couldNotMake
        }
        // Reading the file can block, so it runs off the main actor.
        let seconds = await Task.detached(priority: .userInitiated) { AudioLength.seconds(of: url) }.value
        guard let seconds else { throw TootError.couldNotMake }
        let rendered = renderArrangement(of: song)
        let draft = TootDraft(id: UUID(), song: song, arrangement: rendered ?? matched, seconds: seconds, audioURL: url)
        tootDrafts[draft.id] = draft
        if rendered != nil { tootsPlayingTheirArrangement.insert(draft.id) }
        return draft
    }

    /// The Arrangement the stand-in audio of `song` was rendered with, played by the user's
    /// Recordings of those fixtures (the oldest of each), or nil if one of them is missing.
    private func renderArrangement(of song: Song) -> Arrangement? {
        guard let render = renders[song.id] else { return nil }
        var recordingForPitch: [Int: Recording.ID] = [:]
        for (pitch, fixtureID) in render.fixtureForPitch {
            guard let recording = recordings.first(where: { $0.isMelodic && source.fixtureID(of: $0.id) == fixtureID }) else {
                return nil
            }
            recordingForPitch[pitch] = recording.id
        }
        return Arrangement(recordingForPitch: recordingForPitch, transposition: render.transposition)
    }

    func saveToot(_ draft: TootDraft) {
        guard toot(draft.id) == nil else { return }
        addToot(id: draft.id, song: draft.song, arrangement: draft.arrangement, seconds: draft.seconds, audioURL: draft.audioURL)
    }

    private func addToot(id: UUID, song: Song, arrangement: Arrangement, seconds: Double, audioURL: URL) {
        var audioURL = audioURL
        if pendingFailures.remove(.tootAudioMissing) != nil {
            audioURL = URL.temporaryDirectory.appending(path: "missing-\(id.uuidString).mp3")
        }
        toots.append(Toot(
            id: id,
            title: song.title,
            songID: song.id,
            createdAt: now(),
            seconds: seconds,
            audioURL: audioURL,
            arrangement: arrangement,
            isAudioMissing: Toot.isAudioMissing(at: audioURL)
        ))
    }

    #if INTERNAL
    func simulatedSource(ofToot id: TootDraft.ID) -> String? {
        guard tootDrafts[id] != nil else { return nil }
        return tootsPlayingTheirArrangement.contains(id)
            ? "the design prototype's render of this Song, with these Recordings"
            : "the design prototype's render of this Song, not made from these Recordings"
    }
    #endif

    // MARK: Toots

    func renameToot(_ id: Toot.ID, to title: String) {
        let title = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty, let index = toots.firstIndex(where: { $0.id == id }) else { return }
        toots[index].title = title
    }

    func deleteToot(_ id: Toot.ID) {
        if nowPlaying == .toot(id) { stopPlayback() }
        toots.removeAll { $0.id == id }
    }
}

/// How a stand-in Song audio was rendered: its transposition, and the Fixture Library Recording
/// that plays each pitch (by pitch in the score's key).
struct StandInRender: Hashable, Sendable {
    let transposition: Int
    let fixtureForPitch: [Int: String]
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

#if INTERNAL
extension Song {
    /// The design prototype's render of this Song with the whole Fixture Library, bundled in Debug
    /// and QA builds only. It stands in for Song Creator's own render until #17. It came from the
    /// reference planner before the 3-semitone rule (#43), and `prototypeRenders` says how.
    var prototypeAudioURL: URL? { Bundle.main.url(forResource: "song-\(id)", withExtension: "mp3") }
}
#endif
