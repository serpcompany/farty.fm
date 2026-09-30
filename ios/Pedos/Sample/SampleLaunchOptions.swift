#if DEBUG
import Foundation

/// Debug-only launch arguments that set up the sample model, for UI tests and for trying states
/// by hand (Xcode: Product › Scheme › Edit Scheme › Arguments). For example:
///
///     -PedosSampleStart all          new (default) | few | all | a count of story takes
///     -PedosSampleFailure saveFailed couldNotStart, interrupted, nothingHeard, saveFailed,
///                                    analysisFailed (comma-separated, each happens once)
///     -PedosMicrophone denied        granted | denied | undetermined: skip the system prompt
///     -PedosAnalysisSeconds 2        how long the simulated analysis takes
///     -welcomeSeen YES               skip (or with NO, show) the Welcome sheet
@MainActor
struct SampleLaunchOptions {
    let defaults: UserDefaults

    func makeModel() -> SampleAppModel {
        SampleAppModel(
            fixtures: SampleFixture.prototypeLibrary,
            story: SampleFixture.prototypeStory,
            songs: Song.prototypeCatalog,
            initialFixtureIDs: initialFixtureIDs,
            microphone: microphone,
            defaults: defaults,
            failures: failures,
            analysisDelay: .seconds(defaults.object(forKey: "PedosAnalysisSeconds") == nil ? 0.9 : defaults.double(forKey: "PedosAnalysisSeconds"))
        )
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
            default: break
            }
        }
    }
}
#endif
