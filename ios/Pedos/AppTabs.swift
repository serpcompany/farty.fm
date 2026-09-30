import SwiftUI

/// The five tabs from `docs/design/app-map.md`, left to right: Recordings, Compose, Record (in
/// the center, for thumb reach), Toots and Profile. Record opens first. Recording, Review and
/// Result cover the tabs, full screen.
///
/// The app comes back to the foreground on the Record tab, unless Recording, Review or Result is
/// open. Playback stops in the background.
struct AppTabs: View {
    let model: any AppModel
    @State private var selection = AppTab.record
    @State private var wasInBackground = false
    @Environment(\.scenePhase) private var scenePhase
    /// The Songs pushed on the Compose tab.
    @State private var composePath: [Song.ID] = []

    var body: some View {
        TabView(selection: $selection) {
            Tab("Recordings", systemImage: "waveform", value: .recordings) {
                RecordingsTab(model: model)
            }

            Tab("Compose", systemImage: "music.note", value: .compose) {
                ComposeTab(model: model, path: $composePath, onRecord: { selection = .record })
            }

            Tab("Record", systemImage: "record.circle", value: .record) {
                RecordTab(model: model)
            }

            Tab("Toots", systemImage: "music.note.list", value: .toots) {
                TootsTab(model: model)
            }

            Tab("Profile", systemImage: "person.crop.circle", value: .profile) {
                ProfileTab(model: model)
            }
        }
        .onChange(of: selection) {
            model.stopPlayback()
        }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .background:
                wasInBackground = true
                model.didEnterBackground()
            case .active where wasInBackground:
                wasInBackground = false
                selection = model.tabOnReturn(from: selection)
            default:
                break
            }
        }
        .sheet(isPresented: Binding(get: { model.isShowingWelcome }, set: { if !$0 { model.skipWelcome() } })) {
            WelcomeSheet(model: model)
        }
        .fullScreenCover(isPresented: Binding(get: { model.showsRecordFlow }, set: { if !$0 { model.finishFlow() } })) {
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

enum AppTab: Hashable, CaseIterable {
    case recordings
    case compose
    case record
    case toots
    case profile
}

extension AppModel {
    /// The app went to the background: nothing keeps playing.
    func didEnterBackground() {
        stopPlayback()
    }

    /// The tab to show when the app comes back to the foreground: Record, unless Recording,
    /// Review or Result is open, which stay where they are.
    func tabOnReturn(from tab: AppTab) -> AppTab {
        showsRecordFlow ? tab : .record
    }
}

#if DEBUG
#Preview("Tabs") {
    AppTabs(model: SampleAppModel.preview(start: .all, toots: ["mary"]))
}

#Preview("Tabs, first launch") {
    AppTabs(model: SampleAppModel.preview(showsWelcome: true))
}
#endif
