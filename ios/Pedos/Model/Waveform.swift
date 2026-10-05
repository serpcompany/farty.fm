import AVFAudio

enum Waveform {
    /// Peak loudness of `count` equal slices of an audio file, or of just `segment` of it, scaled
    /// so the loudest is 1. Returns flat bars when the file can't be read.
    static func levels(of url: URL?, count: Int, segment: Segment? = nil) -> [Float] {
        let flat = Array(repeating: Float(0.05), count: count)
        guard let url, let file = try? AVAudioFile(forReading: url) else { return flat }

        let rate = file.processingFormat.sampleRate
        let start = segment.map { min(max(AVAudioFramePosition($0.start * rate), 0), file.length) } ?? 0
        let end = segment.map { min(AVAudioFramePosition(($0.start + $0.length) * rate), file.length) } ?? file.length
        guard end > start,
              let buffer = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: AVAudioFrameCount(end - start))
        else { return flat }
        file.framePosition = start
        guard (try? file.read(into: buffer, frameCount: AVAudioFrameCount(end - start))) != nil,
              let samples = buffer.floatChannelData?[0]
        else { return flat }

        let frames = Int(buffer.frameLength)
        guard frames >= count, count > 0 else { return flat }
        let slice = frames / count
        let peaks = (0..<count).map { bar in
            (bar * slice..<(bar + 1) * slice).reduce(Float(0)) { max($0, abs(samples[$1])) }
        }
        let loudest = peaks.max() ?? 0
        guard loudest > 0 else { return flat }
        return peaks.map { max($0 / loudest, 0.05) }
    }
}

enum AudioLength {
    /// An audio file's length in seconds, or nil when it can't be read.
    static func seconds(of url: URL) -> Double? {
        guard let file = try? AVAudioFile(forReading: url), file.fileFormat.sampleRate > 0 else { return nil }
        return Double(file.length) / file.fileFormat.sampleRate
    }
}
