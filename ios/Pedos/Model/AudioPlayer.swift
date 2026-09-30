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
        stop()
        guard let url else { return }
        nowPlaying = item
        let observer = FinishObserver { [weak self] in self?.finished(item) }
        enqueue { [weak self] engine in
            if await !engine.play(url, observer: observer) { await self?.finished(item) }
        }
    }

    func stop() {
        guard nowPlaying != nil else { return }
        nowPlaying = nil
        enqueue { engine in await engine.stop() }
    }

    private func finished(_ item: PlaybackItem) {
        if nowPlaying == item { nowPlaying = nil }
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
private actor PlaybackEngine {
    private var player: AVAudioPlayer?
    private var observer: FinishObserver?

    /// Starts playing `url`, telling `observer` when it ends. Returns false if it can't play.
    func play(_ url: URL, observer: FinishObserver) -> Bool {
        stop()
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

    func stop() {
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
