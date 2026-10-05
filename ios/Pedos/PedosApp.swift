import SwiftUI

@main
struct PedosApp: App {
    @State private var model = Self.makeModel()

    var body: some Scene {
        WindowGroup {
            AppTabs(model: model)
        }
    }

    #if DEBUG
    /// Debug builds start the sample model with the Fixture Library (see `SampleLaunchOptions`).
    private static func makeModel() -> SampleAppModel {
        SampleLaunchOptions(defaults: .standard).makeModel()
    }
    #else
    /// QA and Release builds record for real and make Toots from the user's own Recordings. QA
    /// builds (TestFlight until launch) can also load the Fixture Library (Profile tab).
    private static func makeModel() -> SampleAppModel {
        SampleAppModel(
            source: LiveRecordingSource(analyzer: .reference, testTakes: LiveRecordingSource.testTakes(in: .standard)),
            songs: Song.prototypeCatalog,
            microphone: SystemMicrophone(),
            defaults: .standard
        )
    }
    #endif
}
