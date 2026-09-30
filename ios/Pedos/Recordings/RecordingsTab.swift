import SwiftUI

/// Every Recording, with its note, and the strip of collected notes. Tap a row to play it.
struct RecordingsTab: View {
    let model: any AppModel
    @State private var pendingDelete: Recording?

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

/// A Recording's row: play state, name, length, "first fart used", and its pitch badge.
private struct RecordingRow: View {
    let recording: Recording
    let isPlaying: Bool
    let play: () -> Void
    let retry: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Button(action: play) {
                HStack(spacing: 12) {
                    Image(systemName: isPlaying ? "stop.circle.fill" : "play.circle")
                        .font(.title2)
                        .foregroundStyle(.tint)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(recording.name)
                        Text(details)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 8)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(recording.name)
            .accessibilityValue(accessibilityValue)
            .accessibilityHint(isPlaying ? "Stops playing" : "Plays the Recording")
            .accessibilityIdentifier(recording.name)
            badge
        }
        .listRowBackground(isPlaying ? Color(.systemFill) : nil)
    }

    /// "1.1 s · first fart used".
    private var details: String {
        var text = formattedLength(recording.seconds)
        if case .analyzed(let analysis) = recording.analysis, analysis.firstFartUsed {
            text += " · first fart used"
        }
        return text
    }

    @ViewBuilder
    private var badge: some View {
        switch recording.analysis {
        case .analyzing:
            ProgressView()
                .accessibilityLabel("Analyzing")
                .accessibilityIdentifier("analyzing-\(recording.number)")
        case .notAnalyzed:
            HStack(spacing: 8) {
                Text("not analyzed")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Button("Retry", action: retry)
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                    .accessibilityLabel("Retry analyzing \(recording.name)")
            }
        case .analyzed(let analysis):
            if let pitch = analysis.pitch {
                Text(Pitch.name(pitch))
                    .font(.subheadline.weight(.semibold))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(.fill.tertiary, in: .capsule)
                    .accessibilityHidden(true)
            } else {
                Text("noise-like")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .accessibilityHidden(true)
            }
        }
    }

    private var accessibilityValue: String {
        var parts = [formattedLength(recording.seconds)]
        switch recording.analysis {
        case .analyzing: parts.append("analyzing")
        case .notAnalyzed: parts.append("not analyzed")
        case .analyzed(let analysis):
            parts.append(analysis.pitch.map(Pitch.name) ?? "noise-like")
            if analysis.firstFartUsed { parts.append("first fart used") }
        }
        if isPlaying { parts.append("playing") }
        return parts.joined(separator: ", ")
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
