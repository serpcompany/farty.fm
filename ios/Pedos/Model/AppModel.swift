import Foundation
import Observation

/// Everything the screens read and do. `SampleAppModel` implements it with sample data until the
/// real recorder, store, analysis and rendering replace it (#12, #14, #17, #32, #37).
@MainActor
protocol AppModel: AnyObject, Observable {
    /// Every saved Recording, oldest first.
    var recordings: [Recording] { get }
    /// The Song Catalog.
    var songs: [Song] { get }
    /// A Song's Pitch Coverage by the Melodic Recordings.
    func coverage(of song: Song) -> CoverageResult
    /// The Songs matching a search, in `order`, split into Unlocked and locked Songs. Models match
    /// the Song Catalog once per change to the Melodic Recordings (`CoverageCache`), so searching
    /// and redrawing don't match it again.
    func songListing(matching query: String, order: SongOrder) -> SongListing

    // MARK: First launch

    /// Shows the Welcome sheet: first launch only.
    var isShowingWelcome: Bool { get }
    /// Welcome's "Allow microphone": asks for the microphone, then closes Welcome.
    func allowMicrophoneFromWelcome() async
    /// Welcome's "Not now".
    func skipWelcome()

    // MARK: Record tab

    var capture: CaptureState { get }
    /// Why the last attempt to record didn't produce a take, until it's dismissed.
    var recordProblem: RecordProblem? { get }
    /// Starts recording, asking for the microphone first if it hasn't been asked yet.
    func startRecording() async
    /// Stops recording, finishes the take off the main actor, then opens Review, or reports
    /// that nothing was heard.
    func stopRecording() async
    func dismissRecordProblem()

    // MARK: Review and Result

    /// The Review → Result steps, shown as a full-screen cover while not nil.
    var flow: RecordFlow? { get }
    /// Saves the draft under Review, then analyzes it.
    func saveDraft() async
    func discardDraft()
    /// Analyzes a Recording whose analysis failed, from Result or from the Recordings tab.
    func retryAnalysis(of id: Recording.ID) async
    /// Closes the Review → Result cover.
    func finishFlow()

    #if INTERNAL
    /// Where a simulated take came from, for Review to say so; nil for a real take.
    func simulatedSource(ofDraft id: Draft.ID) -> String?
    #endif

    // MARK: Playback

    var nowPlaying: PlaybackItem? { get }
    /// When `nowPlaying` started playing, for a playhead; nil until it has started.
    var playbackStartedAt: Date? { get }
    /// Plays the item, or stops it when it's already playing.
    func togglePlayback(of item: PlaybackItem)
    func stopPlayback()

    // MARK: Recordings

    func delete(_ id: Recording.ID)

    // MARK: Compose

    /// Song Creator: makes a Toot of an Unlocked Song, played only by the user's Recordings.
    /// Throws `TootError`.
    func makeToot(of song: Song) async throws -> TootDraft
    /// Saves a made Toot to the Toots tab, with the same id. Saving it again does nothing.
    func saveToot(_ draft: TootDraft)

    #if INTERNAL
    /// Where a simulated Toot's audio came from, for Song Creator to say so; nil for a real one.
    func simulatedSource(ofToot id: TootDraft.ID) -> String?
    #endif

    // MARK: Toots

    /// Every saved Toot, oldest first.
    var toots: [Toot] { get }
    /// Renames a Toot; a blank title changes nothing.
    func renameToot(_ id: Toot.ID, to title: String)
    func deleteToot(_ id: Toot.ID)

    #if INTERNAL
    // MARK: Internal builds

    /// "Load the Fixture Library" on the Profile tab; nil when the model can't (sample data).
    var fixtureLibrary: FixtureLibraryStatus? { get }
    /// Adds every Fixture Library Recording not already loaded, then analyzes them.
    func loadFixtureLibrary() async
    #endif
}

extension AppModel {
    var isRecording: Bool {
        if case .recording = capture { true } else { false }
    }

    /// Recording, Review or Result is on screen, full screen over the tabs.
    var showsRecordFlow: Bool { capture != .idle || flow != nil }

    var melodicRecordings: [Recording] { recordings.filter(\.isMelodic) }

    /// The pitch classes (0 = C … 11 = B) of every Melodic Recording.
    var collectedPitchClasses: Set<Int> { Set(recordings.compactMap(\.pitch).map(Pitch.pitchClass)) }

    /// The notes of every Melodic Recording, octave included (G3, G♯3 and G4 are three notes).
    var collectedNotes: Set<Int> { Set(recordings.compactMap(\.pitch).map(Pitch.note)) }

    func recording(_ id: Recording.ID) -> Recording? { recordings.first { $0.id == id } }

    func song(_ id: Song.ID) -> Song? { songs.first { $0.id == id } }

    func toot(_ id: Toot.ID) -> Toot? { toots.first { $0.id == id } }

    #if INTERNAL
    var fixtureLibrary: FixtureLibraryStatus? { nil }
    func loadFixtureLibrary() async {}
    func simulatedSource(ofDraft id: Draft.ID) -> String? { nil }
    func simulatedSource(ofToot id: TootDraft.ID) -> String? { nil }
    #endif
}

enum CaptureState: Hashable, Sendable {
    case idle
    case recording(startedAt: Date)
    /// Stopped, and the take is being finished before Review opens.
    case finishing
}

/// Why recording didn't produce a take.
enum RecordProblem: Hashable, Sendable {
    /// Microphone permission is denied.
    case microphoneOff
    case couldNotStart
    /// A call or another app took the microphone.
    case interrupted
    /// An empty or too-short take: nothing to save.
    case nothingHeard
}

/// The steps after a take: Review, then saving and Result, with their error states.
enum RecordFlow: Hashable, Sendable {
    case review(Draft)
    case saveFailed(Draft)
    case analyzing(Recording.ID)
    case analysisFailed(Recording.ID)
    case result(RecordResult)
}

/// What the Result screen shows for a saved, analyzed Recording.
struct RecordResult: Hashable, Sendable {
    let recordingID: Recording.ID
    let changes: CoverageChanges
}

/// Something that can play.
enum PlaybackItem: Hashable, Sendable {
    case draft(Draft.ID)
    case recording(Recording.ID)
    /// A Toot Song Creator made, saved or not.
    case tootDraft(TootDraft.ID)
    case toot(Toot.ID)
    /// One note of a made or saved Toot (by its id), as rendered: a segment of its own audio.
    case note(UUID, index: Int)
}
