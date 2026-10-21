import Foundation
import Observation

/// The app model: it runs every screen's states. Recordings come from a `RecordingSource`: the
/// microphone, files and Recording Analysis (`LiveRecordingSource`), or in Debug builds the
/// Fixture Library (`FixtureRecordingSource`). Pitch Coverage and Auto-map come from
/// `RecordingAnalysisKit.AutoMap`, and Song Creator renders each Toot from the Recordings' own
/// audio (`TootRenderer`), in every build.
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
    /// Where Song Creator writes the Toots it makes, before they're saved.
    @ObservationIgnored private let tootFolder: URL
    /// Where saved Toots are kept.
    @ObservationIgnored private let tootStore: TootStore
    /// Making a Toot takes at least this long, so its "Making" state can be seen (UI tests).
    @ObservationIgnored private let minimumMakingTime: Duration
    /// Toots Song Creator made, saved or not, for playback.
    @ObservationIgnored private var tootDrafts: [TootDraft.ID: TootDraft] = [:]
    @ObservationIgnored private var coverageCache: CoverageCache

    /// - Parameters:
    ///   - source: where takes come from and Recordings are kept.
    ///   - initialTootSongIDs: Songs to make and save as Toots at launch, oldest first (sample
    ///     data); a locked Song is skipped.
    ///   - tootFolder: where Song Creator writes the Toots it makes, before they're saved.
    ///   - tootStore: where saved Toots are kept; they're loaded from it at launch.
    ///   - failures: Song Creator failures to simulate, each once.
    ///   - minimumMakingTime: making a Toot takes at least this long.
    init(
        source: any RecordingSource,
        songs: [Song],
        initialTootSongIDs: [Song.ID] = [],
        tootFolder: URL = SampleAppModel.temporaryTootFolder,
        tootStore: TootStore = .temporary(),
        microphone: any MicrophoneAccess,
        defaults: UserDefaults,
        failures: Failures = [],
        now: @escaping () -> Date = Date.init,
        minimumMakingTime: Duration = .zero
    ) {
        self.source = source
        self.songs = songs
        self.microphone = microphone
        self.defaults = defaults
        self.pendingFailures = failures
        self.now = now
        self.tootFolder = tootFolder
        self.tootStore = tootStore
        self.minimumMakingTime = minimumMakingTime
        self.coverageCache = CoverageCache(songs: songs)
        self.isShowingWelcome = !defaults.bool(forKey: Self.welcomeSeenKey)
        self.recordings = source.savedRecordings()
        self.toots = (try? tootStore.load()) ?? []
        #if INTERNAL
        self.bundledFixtures = source.canLoadFixtures ? FixtureLibrary.bundled() : []
        #endif

        // Sample data: made right away, so the Toots are there from the first frame.
        for songID in initialTootSongIDs {
            guard let song = songs.first(where: { $0.id == songID }),
                  let arrangement = coverage(of: song).matchedArrangement
            else { continue }
            let id = UUID()
            let url = tootFolder.appending(path: "\(id.uuidString).m4a")
            try? FileManager.default.createDirectory(at: tootFolder, withIntermediateDirectories: true)
            guard let output = try? TootRenderer.render(song, arrangement: arrangement, recordings: recordings, to: url) else { continue }
            addToot(id: id, song: song, arrangement: arrangement, seconds: output.seconds, audioURL: url)
        }

        // Recordings saved before an analysis update, or before analysis finished, are analyzed now.
        for recording in recordings where recording.analysis == .analyzing {
            Task { await analyze(recording.id) }
        }
    }

    /// A new folder in the temporary directory, for Toots that aren't kept.
    static var temporaryTootFolder: URL {
        URL.temporaryDirectory.appending(path: "Toots-\(UUID().uuidString)", directoryHint: .isDirectory)
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
        tootFolder: URL = SampleAppModel.temporaryTootFolder,
        tootStore: TootStore = .temporary(),
        microphone: any MicrophoneAccess,
        defaults: UserDefaults,
        failures: Failures = [],
        now: @escaping () -> Date = Date.init,
        analysisDelay: Duration = .milliseconds(900),
        interruptionDelay: Duration = .milliseconds(1500),
        minimumMakingTime: Duration = .zero
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
            tootFolder: tootFolder,
            tootStore: tootStore,
            microphone: microphone,
            defaults: defaults,
            failures: failures,
            now: now,
            minimumMakingTime: minimumMakingTime
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
        // The cover calls this again when it has finished closing; by then Song Creator may
        // already be playing the Toot that "Try it" opened.
        guard flow != nil else { return }
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

    /// Song Creator: renders the Song with Auto-map's Arrangement, from the Recordings' own audio
    /// (`TootRenderer`), off the main actor, into a new file in `tootFolder`.
    func makeToot(of song: Song) async throws -> TootDraft {
        let started = ContinuousClock.now
        guard let arrangement = coverage(of: song).matchedArrangement else { throw TootError.locked }
        let used = arrangement.recordings.compactMap { recording($0) }
        let id = UUID()
        let url = tootFolder.appending(path: "\(id.uuidString).m4a")
        let failed = pendingFailures.remove(.couldNotMakeToot) != nil
        let rendered = await Task.detached(priority: .userInitiated) { [tootFolder] in
            Result {
                if failed { throw TootError.couldNotMake }
                try FileManager.default.createDirectory(at: tootFolder, withIntermediateDirectories: true)
                return try TootRenderer.render(song, arrangement: arrangement, recordings: used, to: url)
            }
        }.value
        try? await Task.sleep(until: started + minimumMakingTime)
        // Song Creator left before the Toot was made: it makes it again when it's back.
        try Task.checkCancellation()
        guard case .success(let output) = rendered else { throw TootError.couldNotMake }
        let draft = TootDraft(id: id, song: song, arrangement: arrangement, seconds: output.seconds, audioURL: url, notes: output.notes)
        tootDrafts[draft.id] = draft
        return draft
    }

    func saveToot(_ draft: TootDraft) {
        guard toot(draft.id) == nil else { return }
        addToot(id: draft.id, song: draft.song, arrangement: draft.arrangement, seconds: draft.seconds, audioURL: draft.audioURL)
    }

    /// Saves a Toot to the store, which keeps its own copy of the audio, and lists it.
    private func addToot(id: UUID, song: Song, arrangement: Arrangement, seconds: Double, audioURL: URL) {
        let made = Toot(
            id: id,
            title: song.title,
            songID: song.id,
            createdAt: now(),
            seconds: seconds,
            audioURL: audioURL,
            arrangement: arrangement,
            isAudioMissing: false
        )
        // If the store can't keep it, it's listed until the app quits.
        var toot = (try? tootStore.save(made)) ?? made
        if pendingFailures.remove(.tootAudioMissing) != nil {
            try? FileManager.default.removeItem(at: toot.audioURL)
            toot = toot.keeping(audioURL: toot.audioURL)
        }
        toots.append(toot)
    }

    // MARK: Toots

    func renameToot(_ id: Toot.ID, to title: String) {
        let title = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty, let index = toots.firstIndex(where: { $0.id == id }) else { return }
        toots[index].title = title
        try? tootStore.rename(id, to: title)
    }

    func deleteToot(_ id: Toot.ID) {
        if nowPlaying == .toot(id) { stopPlayback() }
        toots.removeAll { $0.id == id }
        try? tootStore.delete(id)
    }
}

/// A Fixture Library Recording with its reference analysis, standing in for a take.
struct SampleFixture: Identifiable, Hashable, Sendable {
    /// The Fixture Library id, for example "069".
    let id: String
    /// The fixture's file name in `fixtures/recordings/`, bundled in Debug and QA builds.
    let file: String
    /// The file's length in seconds.
    let seconds: Double
    /// The single clean gesture, in samples at 44.1 kHz.
    let gestureSamples: Range<Int>
    let firstFartUsed: Bool
    /// The Recording Pitch as a MIDI note number, or nil when Noise-like.
    let pitch: Double?
    /// The shortest note it plays on pitch, in seconds; nil when Noise-like.
    let shortestNoteSeconds: Double?

    /// The reference engine's analysis of the fixture file (`fixtures/golden/recordings/`).
    var analysis: RecordingAnalysis {
        RecordingAnalysis(
            pitch: pitch,
            firstFartUsed: firstFartUsed,
            startSeconds: Double(gestureSamples.lowerBound) / 44_100,
            endSeconds: Double(gestureSamples.upperBound) / 44_100,
            shortestNoteSeconds: shortestNoteSeconds
        )
    }

    /// The Fixture Library file itself, bundled in Debug and QA builds only.
    var audioURL: URL? { Bundle.main.url(forResource: file, withExtension: nil) }
}

extension UUID {
    /// The id of a Recording loaded from the Fixture Library: the fixture's id in the last group
    /// ("…-000000000069"), and which copy of it in the group before. Auto-map breaks ties between
    /// equally good Arrangements by Recording id, so the same fixtures always get the same
    /// Arrangement: the reference engine's (`fixtures/golden/`).
    init(fixtureID: String, copy: Int = 0) {
        let prefix = String(format: "00000000-0000-0000-%04X-000000000", copy % 0x10000)
        let isFixtureID = fixtureID.count == 3 && fixtureID.allSatisfy(\.isASCII) && fixtureID.allSatisfy(\.isNumber)
        self = (isFixtureID ? UUID(uuidString: prefix + fixtureID) : nil) ?? UUID()
    }
}
