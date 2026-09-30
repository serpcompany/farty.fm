import SwiftUI

/// Placeholder for capturing a new Recording. The record slice replaces its content.
struct RecordSheet: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ContentUnavailableView(
                "Recording isn't available yet",
                systemImage: "mic",
                description: Text("Each Recording holds a single fart.")
            )
            .navigationTitle("New Recording")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
    }
}

#Preview {
    RecordSheet()
}
