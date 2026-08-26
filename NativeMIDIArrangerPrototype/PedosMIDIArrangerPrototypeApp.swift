import SwiftUI

@main
struct PedosMIDIArrangerPrototypeApp: App {
    @State private var model = ArrangerModel()

    var body: some Scene {
        WindowGroup {
            ArrangerRootView(model: model)
                .tint(.orange)
        }
    }
}
