import SwiftUI

/// Every Recording, newest first, with its note and waveform, and how many notes you've
/// collected. Tap a row to play it.
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
                ForEach(model.recordings.reversed()) { recording in
                    RecordingsRow(
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
            } header: {
                // Side by side when they fit; stacked at large text sizes.
                ViewThatFits(in: .horizontal) {
                    HStack {
                        Text(melodicSummary)
                        Spacer()
                        Text(count(model.recordings.count, "Recording"))
                    }
                    .lineLimit(1)
                    VStack(alignment: .leading) {
                        Text(melodicSummary)
                        Text(count(model.recordings.count, "Recording"))
                    }
                }
                .font(.footnote)
                .textCase(nil)
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("pitch-summary")
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

    /// "9 Melodic Recordings across 7 notes": notes with their octave, so G3 and G4 are two.
    private var melodicSummary: String {
        "\(count(model.melodicRecordings.count, "Melodic Recording")) across \(count(model.collectedNotes.count, "note"))"
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
