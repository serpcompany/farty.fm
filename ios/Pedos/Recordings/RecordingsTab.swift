import SwiftUI

/// Every Recording, with its note, and the strip of collected notes. Tap a row to play it.
struct RecordingsTab: View {
    let model: any AppModel
    @State private var pendingDelete: Recording?
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        NavigationStack {
            Group {
                if model.recordings.isEmpty {
                    ContentUnavailableView(
                        "No Recordings yet",
                        systemImage: "waveform",
                        description: Text("Go to the Record tab and tap the red button.")
                    )
                } else {
                    list
                }
            }
            .navigationTitle("Recordings")
            .navigationBarTitleDisplayMode(.large)
        }
        .onChange(of: scenePhase) { _, phase in
            // The app comes back on the Record tab, so the confirmation doesn't stay open.
            if phase == .background { pendingDelete = nil }
        }
    }

    private var list: some View {
        List {
            Section {
                PitchStrip(collected: model.collectedPitchClasses)
                    .listRowSeparator(.hidden)
            } footer: {
                HStack {
                    Text(melodicSummary)
                    Spacer()
                    Text(count(model.recordings.count, "Recording"))
                }
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("pitch-summary")
            }

            Section {
                ForEach(model.recordings.reversed()) { recording in
                    RecordingRow(
                        recording: recording,
                        isPlaying: model.nowPlaying == .recording(recording.id),
                        play: { model.togglePlayback(of: .recording(recording.id)) },
                        retry: { Task { await model.retryAnalysis(of: recording.id) } }
                    )
                    .swipeActions {
                        Button { pendingDelete = recording } label: { Label("Delete", systemImage: "trash") }
                            .tint(.red)
                    }
                    .contextMenu {
                        Button(role: .destructive) { pendingDelete = recording } label: { Label("Delete", systemImage: "trash") }
                    }
                }
            }
        }
        .confirmationDialog(
            pendingDelete.map { "Delete \($0.name)?" } ?? "",
            isPresented: Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } }),
            titleVisibility: .visible,
            presenting: pendingDelete
        ) { recording in
            Button("Delete Recording", role: .destructive) {
                withAnimation { model.delete(recording.id) }
            }
        } message: { _ in
            Text("This can't be undone.")
        }
    }

    /// "7 Melodic Recordings across 6 notes".
    private var melodicSummary: String {
        "\(count(model.melodicRecordings.count, "Melodic Recording")) across \(count(model.collectedPitchClasses.count, "note"))"
    }

    private func count(_ number: Int, _ noun: String) -> String {
        "\(number) \(noun)\(number == 1 ? "" : "s")"
    }
}

#if DEBUG
#Preview("Recordings") {
    RecordingsTab(model: SampleAppModel.preview(start: .all))
}

#Preview("Recordings, empty") {
    RecordingsTab(model: SampleAppModel.preview())
}
#endif
