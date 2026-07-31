import SwiftUI

@main
struct PedosRecorderProofApp: App {
    @State private var recorder = RecorderStore()
#if INTERNAL_FIXTURE_LIBRARY
    @State private var fixtureLibrary = FixtureLibraryStore()
#endif

    var body: some Scene {
        WindowGroup {
#if INTERNAL_FIXTURE_LIBRARY
            ContentView(recorder: recorder, fixtureLibrary: fixtureLibrary)
#else
            ContentView(recorder: recorder)
#endif
        }
    }
}
