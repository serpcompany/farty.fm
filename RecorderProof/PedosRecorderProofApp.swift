import SwiftUI

@main
struct PedosRecorderProofApp: App {
    @State private var recorder = RecorderStore()

    var body: some Scene {
        WindowGroup {
            ContentView(recorder: recorder)
        }
    }
}
