import SwiftUI

/// A Recording's row: play state, name, length, "first fart used", and its pitch badge.
///
/// In Song Creator and a Toot's screen it shows the color of its notes, its waveform next to its
/// length, and the note it plays in the Song in place of its own pitch.
struct RecordingRow: View {
    let recording: Recording
    let isPlaying: Bool
    /// The color of the notes it plays in the note view.
    var color: Color?
    var showsWaveform = false
    /// The note it plays in the Song, "A3".
    var playsNote: String?
    /// Its notes are highlighted in the note view.
    var isHighlighted = false
    let play: () -> Void
    var retry: () -> Void = {}

    @State private var levels: [Float] = []

    var body: some View {
        HStack(spacing: 12) {
            Button(action: play) {
                HStack(spacing: 12) {
                    if let color {
                        Circle()
                            .fill(color)
                            .frame(width: 10, height: 10)
                            .accessibilityHidden(true)
                    }
                    Image(systemName: isPlaying ? "stop.circle.fill" : "play.circle")
                        .font(.title2)
                        .foregroundStyle(.tint)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(recording.name)
                        if showsWaveform {
                            HStack(spacing: 8) {
                                WaveformView(levels: levels, isPlaying: isPlaying, spacing: 1.5)
                                    .frame(width: 72, height: 18)
                                Text(formattedLength(recording.seconds))
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                            }
                        } else {
                            Text(details)
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
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
            if let playsNote {
                NoteBadge(text: "plays \(playsNote)")
            } else {
                badge
            }
        }
        .listRowBackground(isPlaying || isHighlighted ? Color(.systemFill) : nil)
        .task(id: showsWaveform ? recording.audioURL : nil) {
            guard showsWaveform, let url = recording.audioURL else { return }
            // Decoding the file can block, so it runs off the main actor.
            levels = await Task.detached(priority: .userInitiated) { Waveform.levels(of: url, count: 16) }.value
        }
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
                NoteBadge(text: Pitch.name(pitch))
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
        if let playsNote { parts.insert("plays \(playsNote)", at: 0) }
        if isHighlighted { parts.append("highlighted") }
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

/// A Recording a Toot used that has since been deleted: the note it played, and no play button.
/// The Toot still plays, because its audio is its own.
struct DeletedRecordingRow: View {
    let color: Color
    let playsNote: String
    let isHighlighted: Bool

    var body: some View {
        HStack(spacing: 12) {
            Circle()
                .fill(color)
                .frame(width: 10, height: 10)
            Image(systemName: "trash.circle")
                .font(.title2)
                .foregroundStyle(.secondary)
            Text("Recording deleted")
                .foregroundStyle(.secondary)
            Spacer(minLength: 8)
            NoteBadge(text: "plays \(playsNote)")
        }
        .listRowBackground(isHighlighted ? Color(.systemFill) : nil)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Recording deleted")
        .accessibilityValue(isHighlighted ? "plays \(playsNote), highlighted" : "plays \(playsNote)")
        .accessibilityIdentifier("Recording deleted")
    }
}

/// A note name in a capsule, like the pitch badge.
private struct NoteBadge: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.subheadline.weight(.semibold))
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(.fill.tertiary, in: .capsule)
            .accessibilityHidden(true)
    }
}
