import SwiftUI

/// A one-octave keyboard, C to B, that fills in each pitch class you've collected.
///
/// - `collected`: pitch classes with a Melodic Recording, filled in.
/// - `outlined`: the pitch class of a Recording just made, outlined.
/// - `needed`: pitch classes a locked Song still needs, dashed.
struct PitchStrip: View {
    var collected: Set<Int>
    var outlined: Int?
    var needed: Set<Int> = []

    var body: some View {
        HStack(spacing: 3) {
            ForEach(0..<12, id: \.self) { pitchClass in
                key(pitchClass)
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityDescription)
        .accessibilityIdentifier("pitch-strip")
    }

    private func key(_ pitchClass: Int) -> some View {
        let isNeeded = needed.contains(pitchClass)
        let isCollected = collected.contains(pitchClass) && !isNeeded
        let shape = RoundedRectangle(cornerRadius: 5, style: .continuous)
        return shape
            .fill(isCollected ? AnyShapeStyle(.tint) : Pitch.sharpPitchClasses.contains(pitchClass) ? AnyShapeStyle(.fill.tertiary) : AnyShapeStyle(.clear))
            .overlay {
                if isNeeded {
                    shape.strokeBorder(.primary, style: StrokeStyle(lineWidth: 2, dash: [4, 3]))
                } else if !isCollected {
                    shape.strokeBorder(.separator, lineWidth: 1)
                }
            }
            .overlay(alignment: .bottom) {
                Text(Pitch.pitchClassNames[pitchClass])
                    .font(.caption2.weight(isCollected || isNeeded ? .semibold : .regular))
                    .foregroundStyle(isCollected ? AnyShapeStyle(.white) : isNeeded ? AnyShapeStyle(.primary) : AnyShapeStyle(.secondary))
                    .padding(.bottom, 3)
            }
            .overlay {
                if outlined == pitchClass {
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .stroke(.primary, lineWidth: 3)
                        .padding(-3)
                }
            }
            .frame(height: 38)
    }

    private var accessibilityDescription: String {
        func names(_ set: Set<Int>) -> String {
            set.sorted().map { Pitch.pitchClassNames[$0] }.formatted(.list(type: .and))
        }
        var parts = [collected.isEmpty ? "No notes collected yet" : "Notes collected: \(names(collected))"]
        if let outlined { parts.append("New: \(Pitch.pitchClassNames[outlined])") }
        if !needed.isEmpty { parts.append("Needed: \(names(needed))") }
        return parts.joined(separator: ". ")
    }
}

#Preview {
    VStack(spacing: 24) {
        PitchStrip(collected: [])
        PitchStrip(collected: [0, 7, 8, 10], outlined: 8)
        PitchStrip(collected: [0, 7], needed: [2, 5])
    }
    .padding()
}
