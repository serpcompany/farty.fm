import Foundation
import Observation

/// Everything the screens read and do. `SampleAppModel` implements it with sample data until the
/// real recorder, store and analysis replace it (#12, #14, #32, #37).
@MainActor
protocol AppModel: AnyObject, Observable {
    /// Every saved Recording, oldest first.
    var recordings: [Recording] { get }
    /// The Song Catalog.
    var songs: [Song] { get }

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

    #if DEBUG
    /// Where a simulated take came from, for Review to say so; nil for a real take.
    func simulatedSource(ofDraft id: Draft.ID) -> String?
    #endif

    // MARK: Playback

    var nowPlaying: PlaybackItem? { get }
    /// Plays the item, or stops it when it's already playing.
    func togglePlayback(of item: PlaybackItem)
    func stopPlayback()

    // MARK: Recordings

    func delete(_ id: Recording.ID)
}

extension AppModel {
    var isRecording: Bool {
        if case .recording = capture { true } else { false }
    }

    var melodicRecordings: [Recording] { recordings.filter(\.isMelodic) }

    /// The pitch classes (0 = C … 11 = B) of every Melodic Recording.
    var collectedPitchClasses: Set<Int> { Set(recordings.compactMap(\.pitch).map(Pitch.pitchClass)) }

    func recording(_ id: Recording.ID) -> Recording? { recordings.first { $0.id == id } }

    func coverage(of song: Song) -> CoverageResult { CoverageResult(song: song, recordings: recordings) }

    #if DEBUG
    func simulatedSource(ofDraft id: Draft.ID) -> String? { nil }
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
}
