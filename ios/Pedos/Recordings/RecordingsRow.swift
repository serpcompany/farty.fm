import SwiftUI

/// A Recording on the Recordings tab: a big play button, its name, its note in a pill ("B3"),
/// and the waveform of the fart replay plays, without the silence around it. Tap to play.
struct RecordingsRow: View {
    let recording: Recording
    let isPlaying: Bool
    let play: () -> Void
    let retry: () -> Void

    @State private var levels: [Float] = []

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button(action: play) {
                HStack(spacing: 14) {
                    PlayCircle(isPlaying: isPlaying)
                    VStack(alignment: .leading, spacing: 8) {
                        HStack(alignment: .center) {
                            Text(recording.name).font(.headline)
                            Spacer(minLength: 8)
                            note
                        }
                        WaveformView(levels: levels, isPlaying: isPlaying, spacing: 2)
                            .frame(height: 30)
                        if firstFartUsed {
                            HStack(spacing: 4) {
                                Image(systemName: "scissors")
                                Text("First fart used")
                            }
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                        }
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(recording.name)
            .accessibilityValue(accessibilityValue)
            .accessibilityHint(isPlaying ? "Stops playing" : "Plays the Recording")
            .accessibilityIdentifier(recording.name)

            status
                .padding(.leading, PlayCircle.size + 14)
        }
        .padding(.vertical, 8)
        .listRowBackground(isPlaying ? Color.accentColor.opacity(0.12) : nil)
        .task(id: WaveformSource(url: recording.audioURL, segment: recording.replaySegment)) {
            guard let url = recording.audioURL else { return }
            let segment = recording.replaySegment
            // Decoding the file can block, so it runs off the main actor.
            levels = await Task.detached(priority: .userInitiated) {
                Waveform.levels(of: url, count: 48, segment: segment)
            }.value
        }
    }

    private var firstFartUsed: Bool {
        if case .analyzed(let analysis) = recording.analysis { analysis.firstFartUsed } else { false }
    }

    /// The note in a pill, or "noise-like".
    @ViewBuilder
    private var note: some View {
        if case .analyzed(let analysis) = recording.analysis {
            if let pitch = analysis.pitch {
                Text(Pitch.name(pitch))
                    .font(.headline)
                    .monospacedDigit()
                    .padding(.horizontal, 12)
                    .padding(.vertical, 4)
                    .background(.fill.secondary, in: .capsule)
            } else {
                Text("noise-like")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
    }

    /// Analyzing, or not analyzed with Retry.
    @ViewBuilder
    private var status: some View {
        switch recording.analysis {
        case .analyzing:
            ProgressView()
                .accessibilityLabel("Analyzing")
                .accessibilityIdentifier("analyzing-\(recording.number)")
        case .notAnalyzed:
            HStack(spacing: 10) {
                Text("not analyzed")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Button("Retry", action: retry)
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                    .accessibilityLabel("Retry analyzing \(recording.name)")
            }
        case .analyzed:
            EmptyView()
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

/// What the waveform is drawn from: it's drawn again when the analysis finds the fart.
private struct WaveformSource: Hashable {
    let url: URL?
    let segment: Segment?
}

/// The row's play button: a tinted circle, filled while playing.
private struct PlayCircle: View {
    static let size: CGFloat = 44
    let isPlaying: Bool

    var body: some View {
        Image(systemName: isPlaying ? "stop.fill" : "play.fill")
            .font(.system(size: 16, weight: .semibold))
            .foregroundStyle(isPlaying ? AnyShapeStyle(.white) : AnyShapeStyle(.tint))
            .frame(width: Self.size, height: Self.size)
            .background(isPlaying ? AnyShapeStyle(.tint) : AnyShapeStyle(.tint.opacity(0.14)), in: .circle)
            .contentTransition(.symbolEffect(.replace))
            .accessibilityHidden(true)
    }
}
