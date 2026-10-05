import SwiftUI

/// Says what Pedos does and asks for the microphone before the first recording. First launch only.
struct WelcomeSheet: View {
    let model: any AppModel

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Spacer(minLength: 24)
            Image("WelcomeIcon")
                .resizable()
                .frame(width: 88, height: 88)
                .clipShape(.rect(cornerRadius: 20, style: .continuous))
                .accessibilityHidden(true)
                .padding(.bottom, 16)
            Text("Pedos")
                .font(.largeTitle.bold())
            Text("Record your farts. Turn them into songs.")
                .font(.title3)
                .foregroundStyle(.secondary)
                .padding(.top, 4)

            VStack(alignment: .leading, spacing: 20) {
                Label("One fart per Recording", systemImage: "record.circle")
                Label("Each fart has a note", systemImage: "music.note")
                Label("Collect notes to unlock Songs", systemImage: "lock.open")
            }
            .font(.body)
            .padding(.top, 36)

            Spacer(minLength: 24)

            VStack(spacing: 8) {
                Button {
                    Task { await model.allowMicrophoneFromWelcome() }
                } label: {
                    Text("Allow microphone")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)

                Button("Not now") {
                    model.skipWelcome()
                }
                .buttonStyle(.borderless)
                .controlSize(.large)
            }
        }
        .padding(24)
        .interactiveDismissDisabled()
    }
}

#if DEBUG
#Preview {
    WelcomeSheet(model: SampleAppModel.preview(showsWelcome: true))
}
#endif
