import AVFAudio
import Observation

/// Plays one audio file at a time and reports which item is playing.
@MainActor
@Observable
final class AudioPlayer {
    /// The item playing now, cleared when it finishes.
    private(set) var nowPlaying: PlaybackItem?

    @ObservationIgnored private let engine = PlaybackEngine()
    /// The last engine operation; each new one waits for it, so they run in order.
    @ObservationIgnored private var lastOperation: Task<Void, Never>?

    /// Plays `url` as `item`, or stops `item` if it's already playing.
    func toggle(_ item: PlaybackItem, url: URL?) {
        if nowPlaying == item {
            stop()
        } else {
            play(item, url: url)
        }
    }

    func play(_ item: PlaybackItem, url: URL?) {
        guard let url else { return stop() }
        // The engine replaces what's playing without letting the session go in between.
        nowPlaying = item
        let observer = FinishObserver { [weak self] in self?.finished(item) }
        enqueue { [weak self] engine in
            if await !engine.play(url, observer: observer) { await self?.finished(item) }
        }
    }

    /// Stops playing and lets the audio session go, so other apps' audio resumes.
    func stop() {
        guard nowPlaying != nil else { return }
        nowPlaying = nil
        enqueue { engine in await engine.stop() }
    }

    private func finished(_ item: PlaybackItem) {
        if nowPlaying == item { stop() }
    }

    private func enqueue(_ operation: @escaping @Sendable (PlaybackEngine) async -> Void) {
        let previous = lastOperation
        let engine = engine
        lastOperation = Task {
            await previous?.value
            await operation(engine)
        }
    }
}

/// Owns the AVAudioPlayer off the main actor: activating the audio session and preparing a
/// player can block, and Xcode flags it as a hang risk on the main thread.
///
/// The audio session is only active while something plays: it uses `.playback` (so other apps'
/// audio pauses), and deactivating with `.notifyOthersOnDeactivation` lets that audio resume.
/// The recorder (#12) owns the session category for recording (`.playAndRecord`) and has to
/// take this over, so playback and recording don't fight over the session.
private actor PlaybackEngine {
    private var player: AVAudioPlayer?
    private var observer: FinishObserver?

    /// Starts playing `url`, telling `observer` when it ends. Returns false if it can't play.
    func play(_ url: URL, observer: FinishObserver) -> Bool {
        release()
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback)
        try? session.setActive(true)
        guard let player = try? AVAudioPlayer(contentsOf: url) else { return false }
        player.delegate = observer
        guard player.play() else { return false }
        self.player = player
        self.observer = observer
        return true
    }

    /// Stops playing and deactivates the session, telling other apps they can resume.
    func stop() {
        release()
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    private func release() {
        player?.stop()
        player = nil
        observer = nil
    }
}

/// Forwards AVAudioPlayer's "finished" callback to the main actor.
private final class FinishObserver: NSObject, AVAudioPlayerDelegate, Sendable {
    private let onFinish: @MainActor @Sendable () -> Void

    init(onFinish: @escaping @MainActor @Sendable () -> Void) {
        self.onFinish = onFinish
    }

    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        Task { @MainActor [onFinish] in onFinish() }
    }
}
