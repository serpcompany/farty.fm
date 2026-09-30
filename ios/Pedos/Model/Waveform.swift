import AVFAudio

enum Waveform {
    /// Peak loudness of `count` equal slices of an audio file, scaled so the loudest is 1.
    /// Returns flat bars when the file can't be read.
    static func levels(of url: URL?, count: Int) -> [Float] {
        let flat = Array(repeating: Float(0.05), count: count)
        guard let url,
              let file = try? AVAudioFile(forReading: url),
              let buffer = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: AVAudioFrameCount(file.length)),
              (try? file.read(into: buffer)) != nil,
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
