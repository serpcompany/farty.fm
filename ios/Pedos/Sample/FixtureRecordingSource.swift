import Foundation

/// Simulated recording for the sample data: each take is the next Fixture Library Recording in
/// the prototype's story order, and its analysis is the reference result. It can simulate each
/// recording failure once, to show the error states.
@MainActor
final class FixtureRecordingSource: RecordingSource {
    private let fixtures: [SampleFixture]
    private let story: [String]
    private var pendingFailures: SampleAppModel.Failures
    private let analysisDelay: Duration
    private let interruptionDelay: Duration
    /// Which fixture each Recording, and each take not yet saved, stands in for.
    private var fixtureOf: [UUID: SampleFixture] = [:]
    /// The Recordings this source has saved, for numbering.
    private var numbers: [UUID: Int] = [:]
    /// How many takes were saved, which picks the story fixture once every fixture is used.
    private var savedTakes: Int
    private var interruption: Task<Void, Never>?
    private let initialRecordings: [Recording]

    /// - Parameters:
    ///   - fixtures: the Recordings simulated takes come from.
    ///   - story: fixture ids in the order takes arrive; the rest follow in `fixtures` order.
    ///   - initialFixtureIDs: fixtures already saved (and analyzed) at launch, oldest first.
    ///   - failures: recording failures to simulate, each once.
    init(
        fixtures: [SampleFixture],
        story: [String],
        initialFixtureIDs: [String] = [],
        failures: SampleAppModel.Failures = [],
        analysisDelay: Duration = .milliseconds(900),
        interruptionDelay: Duration = .milliseconds(1500)
    ) {
        self.fixtures = fixtures
        self.story = story
        self.pendingFailures = failures
        self.analysisDelay = analysisDelay
        self.interruptionDelay = interruptionDelay
        self.savedTakes = min(initialFixtureIDs.count, story.count)

        var recordings: [Recording] = []
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
            fixtureOf[recording.id] = fixture
            numbers[recording.id] = recording.number
        }
        initialRecordings = recordings
    }

    func savedRecordings() -> [Recording] { initialRecordings }

    func startTake(onInterruption: @escaping @MainActor () -> Void) async throws {
        guard pendingFailures.remove(.couldNotStart) == nil, nextFixture() != nil else {
            throw CouldNotRecordError()
        }
        if pendingFailures.remove(.interrupted) != nil {
            interruption = Task { [interruptionDelay] in
                try? await Task.sleep(for: interruptionDelay)
                guard !Task.isCancelled else { return }
                onInterruption()
            }
        }
    }

    func stopTake() async -> Take? {
        interruption?.cancel()
        guard pendingFailures.remove(.nothingHeard) == nil, let fixture = nextFixture() else { return nil }
        let take = Take(id: UUID(), seconds: fixture.seconds, audioURL: fixture.audioURL)
        fixtureOf[take.id] = fixture
        return take
    }

    func cancelTake() async {
        interruption?.cancel()
    }

    func save(_ take: Take) async throws -> Recording {
        guard pendingFailures.remove(.saveFailed) == nil, let fixture = fixtureOf[take.id] else {
            throw CocoaError(.fileWriteUnknown)
        }
        fixtureOf[take.id] = nil
        let recording = Recording(
            id: UUID(),
            number: (numbers.values.max() ?? 0) + 1,
            seconds: take.seconds,
            analysis: .analyzing,
            audioURL: take.audioURL
        )
        fixtureOf[recording.id] = fixture
        numbers[recording.id] = recording.number
        savedTakes += 1
        return recording
    }

    func discard(_ take: Take) {
        fixtureOf[take.id] = nil
    }

    /// Simulates Recording Analysis with the fixture's reference result.
    func analyze(_ id: Recording.ID) async throws -> RecordingAnalysis {
        try? await Task.sleep(for: analysisDelay)
        guard let fixture = fixtureOf[id], pendingFailures.remove(.analysisFailed) == nil else {
            throw CocoaError(.fileReadUnknown)
        }
        return fixture.analysis
    }

    func delete(_ id: Recording.ID) {
        fixtureOf[id] = nil
        numbers[id] = nil
    }

    func fixtureID(of id: UUID) -> String? {
        fixtureOf[id]?.id
    }

    /// The next fixture in story order that isn't already a saved Recording.
    private func nextFixture() -> SampleFixture? {
        let saved = Set(numbers.keys.compactMap { fixtureOf[$0]?.id })
        let id = (story + fixtures.map(\.id)).first { !saved.contains($0) }
            ?? (story.isEmpty ? nil : story[savedTakes % story.count])
        return fixtures.first { $0.id == id }
    }
}
