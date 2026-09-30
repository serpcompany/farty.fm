import AVFAudio

enum MicrophonePermission: Hashable, Sendable {
    case undetermined
    case granted
    case denied
}

/// Microphone permission, so tests can stand in for the system prompt.
@MainActor
protocol MicrophoneAccess {
    var permission: MicrophonePermission { get }
    /// Shows the system prompt when permission is undetermined, and returns whether it's granted.
    func requestPermission() async -> Bool
}

/// The real microphone permission. Asking for it records nothing.
struct SystemMicrophone: MicrophoneAccess {
    var permission: MicrophonePermission {
        switch AVAudioApplication.shared.recordPermission {
        case .granted: .granted
        case .denied: .denied
        case .undetermined: .undetermined
        @unknown default: .undetermined
        }
    }

    func requestPermission() async -> Bool {
        await AVAudioApplication.requestRecordPermission()
    }
}

/// A microphone permission that answers without the system prompt.
@MainActor
final class SimulatedMicrophone: MicrophoneAccess {
    private(set) var permission: MicrophonePermission
    /// The answer the simulated prompt gives.
    private let allows: Bool

    init(permission: MicrophonePermission, allows: Bool = true) {
        self.permission = permission
        self.allows = allows
    }

    func requestPermission() async -> Bool {
        if permission == .undetermined {
            permission = allows ? .granted : .denied
        }
        return permission == .granted
    }
}
