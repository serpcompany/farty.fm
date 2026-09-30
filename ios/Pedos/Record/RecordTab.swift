import SwiftUI
import UIKit

/// The Record tab: one big red button. Tap to record: recording goes full screen over the tabs
/// (`RecordingView`), where the same button is Stop.
struct RecordTab: View {
    let model: any AppModel
    @Environment(\.openURL) private var openURL

    var body: some View {
        VStack(spacing: 28) {
            // Balances the status line below, so the button stays centered.
            Color.clear.frame(height: 40)
            RecordButton(isRecording: false) {
                Task { await model.startRecording() }
            }
            status.frame(height: 40)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .alert(
            alertProblem?.title ?? "",
            isPresented: Binding(
                get: { alertProblem != nil },
                set: { if !$0 { model.dismissRecordProblem() } }
            ),
            presenting: alertProblem
        ) { problem in
            Button("Cancel", role: .cancel) {}
            if problem == .microphoneOff {
                Button("Open Settings") {
                    if let settings = URL(string: UIApplication.openSettingsURLString) { openURL(settings) }
                }
            } else {
                Button("Try again") {
                    Task { await model.startRecording() }
                }
            }
        } message: { problem in
            if let message = problem.message { Text(message) }
        }
    }

    @ViewBuilder
    private var status: some View {
        if model.recordProblem == .nothingHeard {
            Text("Didn't catch that. Try again.")
                .foregroundStyle(.secondary)
                .accessibilityIdentifier("nothing-heard")
        }
    }

    /// Problems shown as an alert; "nothing heard" is shown in place instead.
    private var alertProblem: RecordProblem? {
        model.recordProblem == .nothingHeard ? nil : model.recordProblem
    }
}

private extension RecordProblem {
    var title: String {
        switch self {
        case .microphoneOff: "Microphone is off"
        case .couldNotStart: "Couldn't start recording"
        case .interrupted: "Recording stopped"
        case .nothingHeard: "Didn't catch that"
        }
    }

    var message: String? {
        switch self {
        case .microphoneOff: "Pedos needs the microphone to record. Turn it on in Settings."
        case .couldNotStart: nil
        case .interrupted: "Nothing was saved."
        case .nothingHeard: "Try again."
        }
    }
}

/// Recording, full screen over the tabs: the big button as Stop, with its pulse and the timer.
/// Stop goes on to Review in the same cover.
struct RecordingView: View {
    let model: any AppModel

    var body: some View {
        VStack(spacing: 28) {
            // Balances the timer below, so the button stays where it was on the Record tab.
            Color.clear.frame(height: 40)
            RecordButton(isRecording: true) {
                Task { await model.stopRecording() }
            }
            // Stopping finishes the take before Review opens; a second tap does nothing.
            .disabled(!model.isRecording)
            timer.frame(height: 40)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    @ViewBuilder
    private var timer: some View {
        if case .recording(let startedAt) = model.capture {
            TimelineView(.periodic(from: startedAt, by: 1)) { context in
                Text(Duration.seconds(max(0, context.date.timeIntervalSince(startedAt))).formatted(.time(pattern: .minuteSecond)))
                    .font(.largeTitle.monospacedDigit())
                    .accessibilityIdentifier("recording-timer")
            }
        }
    }
}

/// The big red button: a circle to record, a square to stop.
private struct RecordButton: View {
    let isRecording: Bool
    let action: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Button(action: action) {
            ZStack {
                if isRecording && !reduceMotion {
                    Circle()
                        .stroke(.red.opacity(0.5), lineWidth: 4)
                        .phaseAnimator([false, true]) { pulse, grown in
                            pulse.scaleEffect(grown ? 1.2 : 1.04).opacity(grown ? 0 : 1)
                        } animation: { grown in
                            grown ? .easeOut(duration: 0.9) : .linear(duration: 0.01)
                        }
                }
                Circle()
                    .strokeBorder(.quaternary, lineWidth: 6)
                RoundedRectangle(cornerRadius: isRecording ? 14 : 82, style: .continuous)
                    .fill(.red)
                    .frame(width: isRecording ? 76 : 164, height: isRecording ? 76 : 164)
            }
            .frame(width: 200, height: 200)
            .contentShape(Circle())
            .animation(.spring(duration: 0.3), value: isRecording)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(isRecording ? "Stop" : "Record")
        // The Record tab stays under the Recording cover, so Stop has its own identifier.
        .accessibilityIdentifier(isRecording ? "stop-button" : "record-button")
    }
}

#if DEBUG
#Preview("Record") {
    RecordTab(model: SampleAppModel.preview())
}

#Preview("Recording") {
    let model = SampleAppModel.preview()
    RecordingView(model: model)
        .task { await model.startRecording() }
}

#Preview("Couldn't start recording") {
    let model = SampleAppModel.preview(failures: .couldNotStart)
    RecordTab(model: model)
        .task { await model.startRecording() }
}
#endif
