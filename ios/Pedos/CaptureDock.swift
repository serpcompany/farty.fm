import SwiftUI

/// The approved Capture Dock layout (ADR 0005): a stable dock with three peer areas,
/// and a record control that is one tap away from each of them.
///
/// The areas are placeholders until their slices land.
struct CaptureDock: View {
    @State private var isShowingRecorder = false

    var body: some View {
        TabView {
            DockArea(title: "Recordings", record: showRecorder) {
                ContentUnavailableView(
                    "No Recordings yet",
                    systemImage: "waveform",
                    description: Text("Tap Record to capture one fart per Recording.")
                )
            }
            .tabItem { Label("Recordings", systemImage: "waveform") }

            DockArea(title: "Create", record: showRecorder) {
                ContentUnavailableView(
                    "Nothing to create with yet",
                    systemImage: "music.note",
                    description: Text("Song Creator and AI Song Creator play melodies using only your Recordings.")
                )
            }
            .tabItem { Label("Create", systemImage: "music.note") }

            DockArea(title: "Created Melodies", record: showRecorder) {
                ContentUnavailableView(
                    "No Created Melodies yet",
                    systemImage: "music.note.list",
                    description: Text("Create one from your Recordings.")
                )
            }
            .tabItem { Label("Melodies", systemImage: "music.note.list") }
        }
        .sheet(isPresented: $isShowingRecorder) {
            RecordSheet()
        }
    }

    private func showRecorder() {
        isShowingRecorder = true
    }
}

/// One area of the Capture Dock, with the record control pinned to its bottom edge.
private struct DockArea<Content: View>: View {
    let title: String
    let record: () -> Void
    @ViewBuilder let content: Content

    var body: some View {
        NavigationStack {
            content
                .navigationTitle(title)
                .safeAreaInset(edge: .bottom) {
                    Button(action: record) {
                        Label("Record", systemImage: "record.circle")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .padding()
                }
        }
    }
}

#Preview {
    CaptureDock()
}
