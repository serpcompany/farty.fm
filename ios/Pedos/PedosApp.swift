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
    /// Release builds record for real. They carry no fixtures or prototype Song audio, so they
    /// can't make Toots until rendering (#17).
    private static func makeModel() -> SampleAppModel {
        SampleAppModel(
            source: LiveRecordingSource(analyzer: .reference, testTake: LiveRecordingSource.testTake(in: .standard)),
            songs: Song.prototypeCatalog,
            microphone: SystemMicrophone(),
            defaults: .standard
        )
    }
    #endif
}
