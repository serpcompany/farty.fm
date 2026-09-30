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
            #if DEBUG
            if let source = model.simulatedSource(ofDraft: draft.id) {
                Text("Simulated take: \(source), not your microphone.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)
            }
            #endif
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
