#if DEBUG
import Foundation

/// Debug-only launch arguments that set up the sample model, for UI tests and for trying states
/// by hand (Xcode: Product › Scheme › Edit Scheme › Arguments). For example:
///
///     -PedosSampleStart all          new (default) | few | all | a count of story takes
///     -PedosSampleToots mary,ode     Songs made and saved as Toots at launch, oldest first
///     -PedosSampleFailure saveFailed couldNotStart, interrupted, nothingHeard, saveFailed,
///                                    analysisFailed, couldNotMakeToot, tootAudioMissing
///                                    (comma-separated, each happens once)
///     -PedosMicrophone denied        granted | denied | undetermined: skip the system prompt
///     -PedosAnalysisSeconds 2        how long the simulated analysis takes
///     -PedosMakingSeconds 3          the least time making a Toot takes
///     -welcomeSeen YES               skip (or with NO, show) the Welcome sheet
///     -PedosLive YES                 record for real, as Release builds do, instead of the
///                                    Fixture Library (with -PedosTestTake <paths>, each take is
///                                    a copy of the next of those files)
///     -PedosFreshStore YES           with -PedosLive: keep Recordings and Toots in new empty
///                                    folders for this launch, not the app's own
@MainActor
struct SampleLaunchOptions {
    let defaults: UserDefaults

    func makeModel() -> SampleAppModel {
        if defaults.bool(forKey: "PedosLive") {
            let (store, tootStore) = stores
            return SampleAppModel(
                source: LiveRecordingSource(store: store, analyzer: .reference, testTakes: LiveRecordingSource.testTakes(in: defaults)),
                songs: Song.prototypeCatalog,
                initialTootSongIDs: tootSongIDs,
                tootStore: tootStore,
                microphone: microphone,
                defaults: defaults,
                failures: failures,
                minimumMakingTime: seconds("PedosMakingSeconds", default: 0)
            )
        }
        return SampleAppModel(
            fixtures: SampleFixture.prototypeLibrary,
            story: SampleFixture.prototypeStory,
            songs: Song.prototypeCatalog,
            initialFixtureIDs: initialFixtureIDs,
            initialTootSongIDs: tootSongIDs,
            microphone: microphone,
            defaults: defaults,
            failures: failures,
            analysisDelay: seconds("PedosAnalysisSeconds", default: 0.9),
            minimumMakingTime: seconds("PedosMakingSeconds", default: 0)
        )
    }
    /// The app's own Recordings and Toots, or with -PedosFreshStore new empty folders for this
    /// launch.
    private var stores: (RecordingStore, TootStore) {
        guard defaults.bool(forKey: "PedosFreshStore") else { return (.standard, .standard) }
        let root = URL.temporaryDirectory.appending(path: "PedosFreshStore-\(UUID().uuidString)", directoryHint: .isDirectory)
        return (
            RecordingStore(folder: root.appending(path: "Recordings", directoryHint: .isDirectory), draftFolder: root),
            TootStore(folder: root.appending(path: "Toots", directoryHint: .isDirectory))
        )
    }

    private var tootSongIDs: [Song.ID] {
        (defaults.string(forKey: "PedosSampleToots") ?? "")
            .split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }
    }

    private func seconds(_ key: String, default value: Double) -> Duration {
        .seconds(defaults.object(forKey: key) == nil ? value : defaults.double(forKey: key))
    }

    /// The prototype's starting points: a new user, 3 Recordings, or all 23.
    private var initialFixtureIDs: [String] {
        let story = SampleFixture.prototypeStory
        switch defaults.string(forKey: "PedosSampleStart") {
        case "few": return Array(story.prefix(3))
        case "all": return SampleFixture.prototypeLibrary.map(\.id)
        case let count?: return Array(story.prefix(Int(count) ?? 0))
        case nil: return []
        }
    }

    private var microphone: any MicrophoneAccess {
        switch defaults.string(forKey: "PedosMicrophone") {
        case "granted": SimulatedMicrophone(permission: .granted)
        case "denied": SimulatedMicrophone(permission: .denied)
        case "undetermined": SimulatedMicrophone(permission: .undetermined)
        default: SystemMicrophone()
        }
    }

    private var failures: SampleAppModel.Failures {
        let names = (defaults.string(forKey: "PedosSampleFailure") ?? "").split(separator: ",")
        return names.reduce(into: []) { failures, name in
            switch name.trimmingCharacters(in: .whitespaces) {
            case "couldNotStart": failures.insert(.couldNotStart)
            case "interrupted": failures.insert(.interrupted)
            case "nothingHeard": failures.insert(.nothingHeard)
            case "saveFailed": failures.insert(.saveFailed)
            case "analysisFailed": failures.insert(.analysisFailed)
            case "couldNotMakeToot": failures.insert(.couldNotMakeToot)
            case "tootAudioMissing": failures.insert(.tootAudioMissing)
            default: break
            }
        }
    }
}
#endif
