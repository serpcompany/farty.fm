#if INTERNAL
import AVFAudio
import Foundation

/// The Fixture Library as internal builds (Debug and QA) carry it: the 23 approved fart
/// Recordings from `fixtures/recordings/`, which "Load the Fixture Library" adds as the user's
/// own Recordings. Release builds contain neither the files nor this code (AGENTS.md).
enum FixtureLibrary {
    /// A bundled fixture file and its Fixture Library id ("002").
    struct Fixture: Hashable, Sendable {
        let id: String
        let url: URL
    }

    /// The fixtures in the app bundle, in id order.
    static func bundled(in bundle: Bundle = .main) -> [Fixture] {
        let files = ["mp3", "wav"].flatMap { bundle.urls(forResourcesWithExtension: $0, subdirectory: nil) ?? [] }
        return files.compactMap { url -> Fixture? in
            let name = url.lastPathComponent
            guard let separator = name.range(of: "__") else { return nil }
            let id = String(name[..<separator.lowerBound])
            guard id.count == 3, id.allSatisfy(\.isNumber) else { return nil }
            return Fixture(id: id, url: url)
        }
        .sorted { $0.id < $1.id }
    }

    /// Writes `source` to `destination` the way the recorder writes a take (mono 44.1 kHz AAC),
    /// so a loaded fixture is stored, analyzed and played exactly like a recorded fart.
    static func writeAsTake(_ source: URL, to destination: URL) throws {
        let input = try AVAudioFile(forReading: source)
        guard let monoFormat = AVAudioFormat(standardFormatWithSampleRate: 44_100, channels: 1),
              let buffer = AVAudioPCMBuffer(pcmFormat: input.processingFormat, frameCapacity: AVAudioFrameCount(input.length)),
              let converter = AVAudioConverter(from: input.processingFormat, to: monoFormat)
        else { throw CocoaError(.fileReadCorruptFile) }
        converter.downmix = true
        try input.read(into: buffer)

        let ratio = monoFormat.sampleRate / input.processingFormat.sampleRate
        let capacity = AVAudioFrameCount((Double(buffer.frameLength) * ratio).rounded(.up)) + 1024
        guard let mono = AVAudioPCMBuffer(pcmFormat: monoFormat, frameCapacity: capacity) else {
            throw CocoaError(.fileReadCorruptFile)
        }
        var supplied = false
        var conversionError: NSError?
        let status = converter.convert(to: mono, error: &conversionError) { _, inputStatus in
            if supplied {
                inputStatus.pointee = .endOfStream
                return nil
            }
            supplied = true
            inputStatus.pointee = .haveData
            return buffer
        }
        if status == .error { throw conversionError ?? CocoaError(.fileReadCorruptFile) }

        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 44_100,
            AVNumberOfChannelsKey: 1,
            AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue,
        ]
        let output = try AVAudioFile(forWriting: destination, settings: settings)
        try output.write(from: mono)
    }
}

/// Where loading the Fixture Library stands, for the Profile tab.
struct FixtureLibraryStatus: Hashable, Sendable {
    /// Fixtures already loaded as Recordings.
    var loaded: Int
    /// Fixtures in the bundle.
    var total: Int
    var isLoading: Bool

    var isComplete: Bool { loaded >= total }
}
#endif
