import Foundation

/// Where takes come from and where Recordings are kept: the microphone, files and Recording
/// Analysis (`LiveRecordingSource`), or the Fixture Library in Debug builds
/// (`FixtureRecordingSource`). The app model runs the screens' states on top of either.
@MainActor
protocol RecordingSource: AnyObject {
    /// The Recordings saved before launch, oldest first. Ones still to analyze are `.analyzing`.
    func savedRecordings() -> [Recording]
    /// Starts a take. `onInterruption` runs if a call or another app takes the microphone.
    /// Throws when recording can't start.
    func startTake(onInterruption: @escaping @MainActor () -> Void) async throws
    /// Stops the take and returns it, or nil when nothing was recorded.
    func stopTake() async -> Take?
    /// Stops and throws away a take that was interrupted.
    func cancelTake() async
    /// Saves a take as the next Recording, not yet analyzed.
    func save(_ take: Take) async throws -> Recording
    /// Throws away a take that won't be saved.
    func discard(_ take: Take)
    /// Runs Recording Analysis on a saved Recording.
    func analyze(_ id: Recording.ID) async throws -> RecordingAnalysis
    func delete(_ id: Recording.ID)
    /// The Fixture Library id a Recording or take stands in for; nil for real ones.
    func fixtureID(of id: UUID) -> String?

    #if INTERNAL
    /// Whether "Load the Fixture Library" can add fixtures as Recordings (not with sample data).
    var canLoadFixtures: Bool { get }
    /// Saves a Fixture Library file as the next Recording, as if it had just been recorded.
    func loadFixture(_ fixture: FixtureLibrary.Fixture) async throws -> Recording
    #endif
}

#if INTERNAL
extension RecordingSource {
    var canLoadFixtures: Bool { false }

    func loadFixture(_ fixture: FixtureLibrary.Fixture) async throws -> Recording {
        throw CocoaError(.featureUnsupported)
    }
}
#endif

/// A finished take, before it's saved or discarded.
struct Take: Identifiable, Hashable, Sendable {
    let id: UUID
    let seconds: Double
    let audioURL: URL?
}

/// Recording failed to start.
struct CouldNotRecordError: Error {}
