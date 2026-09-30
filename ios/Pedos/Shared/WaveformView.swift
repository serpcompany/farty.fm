import SwiftUI

/// Loudness bars across a take or a Recording, tinted while it plays.
struct WaveformView: View {
    let levels: [Float]
    let isPlaying: Bool
    var spacing: CGFloat = 3

    var body: some View {
        GeometryReader { geometry in
            HStack(alignment: .center, spacing: spacing) {
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
