import SwiftUI

/// The four tabs from `docs/design/app-map.md`: Record opens first, followed by Recordings,
/// Compose and Melodies. While recording, the other tabs are disabled.
struct AppTabs: View {
    let model: any AppModel
    @State private var selection = AppTab.record
    /// The Songs pushed on the Compose tab.
    @State private var composePath: [Song.ID] = []

    var body: some View {
        TabView(selection: $selection) {
            Tab("Record", systemImage: "record.circle", value: .record) {
                RecordTab(model: model)
            }

            Tab("Recordings", systemImage: "waveform", value: .recordings) {
                RecordingsTab(model: model)
            }
            .disabled(model.isRecording)

            Tab("Compose", systemImage: "music.note", value: .compose) {
                ComposeTab(model: model, path: $composePath, onRecord: { selection = .record })
            }
            .disabled(model.isRecording)

            Tab("Melodies", systemImage: "music.note.list", value: .melodies) {
                MelodiesTab(model: model)
            }
            .disabled(model.isRecording)
        }
        .onChange(of: selection) {
            model.stopPlayback()
        }
        .sheet(isPresented: Binding(get: { model.isShowingWelcome }, set: { if !$0 { model.skipWelcome() } })) {
            WelcomeSheet(model: model)
        }
        .fullScreenCover(isPresented: Binding(get: { model.flow != nil }, set: { if !$0 { model.finishFlow() } })) {
            RecordFlowView(
                model: model,
                onDone: { selection = .recordings },
                onRecordAnother: { selection = .record },
                onTry: { song in
                    composePath = [song.id]
                    selection = .compose
                }
            )
        }
    }
}

enum AppTab: Hashable {
    case record
    case recordings
    case compose
    case melodies
}

#if DEBUG
#Preview("Tabs") {
    AppTabs(model: SampleAppModel.preview(start: .all, melodies: ["mary"]))
}

#Preview("Tabs, first launch") {
    AppTabs(model: SampleAppModel.preview(showsWelcome: true))
}
#endif
