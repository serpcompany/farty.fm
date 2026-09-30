#if DEBUG
import Foundation

/// Sample models for SwiftUI previews. The microphone is simulated and allowed, and nothing is
/// written to the app's own defaults.
extension SampleAppModel {
    enum PreviewStart {
        case new
        /// The first story takes, saved and analyzed.
        case takes(Int)
        /// All 23 Fixture Library Recordings.
        case all
    }

    static func preview(
        start: PreviewStart = .new,
        melodies: [Song.ID] = [],
        failures: Failures = [],
        showsWelcome: Bool = false,
        analysisDelay: Duration = .zero,
        makingDelay: Duration = .milliseconds(600)
    ) -> SampleAppModel {
        let defaults = UserDefaults(suiteName: "PedosPreviews") ?? .standard
        defaults.set(!showsWelcome, forKey: welcomeSeenKey)
        let initialFixtureIDs: [String] = switch start {
        case .new: []
        case .takes(let count): Array(SampleFixture.prototypeStory.prefix(count))
        case .all: SampleFixture.prototypeLibrary.map(\.id)
        }
        return SampleAppModel(
            fixtures: SampleFixture.prototypeLibrary,
            story: SampleFixture.prototypeStory,
            songs: Song.prototypeCatalog,
            initialFixtureIDs: initialFixtureIDs,
            initialMelodySongIDs: melodies,
            songAudio: \.prototypeAudioURL,
            microphone: SimulatedMicrophone(permission: .granted),
            defaults: defaults,
            failures: failures,
            analysisDelay: analysisDelay,
            makingDelay: makingDelay
        )
    }

    /// Records the next take for a little over the shortest length that counts, and stops,
    /// which opens Review.
    func previewTake() async {
        await startRecording()
        try? await Task.sleep(for: .seconds(Self.minimumTakeSeconds + 0.1))
        await stopRecording()
    }
}
#endif
