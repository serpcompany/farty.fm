import AVFAudio
import Observation

/// Plays one audio file at a time and reports which item is playing.
@MainActor
@Observable
final class AudioPlayer {
    /// The item playing now, cleared when it finishes.
    private(set) var nowPlaying: PlaybackItem?

    @ObservationIgnored private var player: AVAudioPlayer?
    @ObservationIgnored private var finishObserver: FinishObserver?

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
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback)
            let player = try AVAudioPlayer(contentsOf: url)
            let observer = FinishObserver { [weak self] in self?.finished(item) }
            player.delegate = observer
            guard player.play() else { return }
            self.player = player
            finishObserver = observer
            nowPlaying = item
        } catch {
            nowPlaying = nil
        }
    }

    func stop() {
        player?.stop()
        player = nil
        finishObserver = nil
        nowPlaying = nil
    }

    private func finished(_ item: PlaybackItem) {
        if nowPlaying == item { stop() }
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
