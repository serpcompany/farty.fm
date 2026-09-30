import SwiftUI

/// Review: hear the take before keeping it. Save or Discard.
struct ReviewView: View {
    let model: any AppModel
    let draft: Draft

    private var isPlaying: Bool { model.nowPlaying == .draft(draft.id) }

    var body: some View {
        VStack(spacing: 28) {
            Spacer()
            WaveformView(levels: draft.waveform, isPlaying: isPlaying)
                .frame(height: 96)
                .padding(.horizontal, 24)
            Text(formattedLength(draft.seconds))
                .font(.title2.monospacedDigit())
                .foregroundStyle(.secondary)
                .accessibilityLabel("Length \(formattedLength(draft.seconds))")
            Button {
                model.togglePlayback(of: .draft(draft.id))
            } label: {
                Image(systemName: isPlaying ? "stop.circle.fill" : "play.circle.fill")
                    .font(.system(size: 72))
                    .symbolRenderingMode(.hierarchical)
            }
            .buttonStyle(.plain)
            .foregroundStyle(.tint)
            .accessibilityLabel(isPlaying ? "Stop" : "Play")
            .accessibilityIdentifier("review-play")
            Spacer()
            if let fixtureID = draft.sampleFixtureID {
                Text("Sample take: Fixture Library Recording \(fixtureID), not your microphone.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)
            }
        }
        .navigationTitle("New Recording")
        .safeAreaInset(edge: .bottom) {
            FlowButtons {
                Button { model.discardDraft() } label: { FlowButtonLabel("Discard") }
            } primary: {
                Button { Task { await model.saveDraft() } } label: { FlowButtonLabel("Save") }
            }
        }
    }
}

/// Loudness bars across the take.
private struct WaveformView: View {
    let levels: [Float]
    let isPlaying: Bool

    var body: some View {
        GeometryReader { geometry in
            HStack(alignment: .center, spacing: 3) {
                ForEach(levels.indices, id: \.self) { index in
                    Capsule()
                        .fill(isPlaying ? AnyShapeStyle(.tint) : AnyShapeStyle(.secondary))
                        .frame(height: max(4, geometry.size.height * CGFloat(levels[index])))
                }
            }
            .frame(maxHeight: .infinity)
        }
        .accessibilityHidden(true)
    }
}
