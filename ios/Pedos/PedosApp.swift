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
    /// Release builds carry no fixtures: they start empty.
    private static func makeModel() -> SampleAppModel {
        SampleAppModel(
            fixtures: [],
            story: [],
            songs: Song.prototypeCatalog,
            microphone: SystemMicrophone(),
            defaults: .standard
        )
    }
    #endif
}
