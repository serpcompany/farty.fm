import AVFAudio

/// The sample rate every analysis stage works at, like the reference engine (`SR`).
package let analysisSampleRate = 44_100

/// Decodes a Recording the way the reference loads it (`librosa.load(sr=44100, mono=True)`):
/// channels averaged to mono, then resampled to 44.1 kHz if the file has another rate.
enum AudioDecoder {
    enum Failure: Error {
        case cannotAllocateBuffer
        case cannotResample(fromSampleRate: Double)
    }

    static func decodeMono(fileAt url: URL) throws -> [Float] {
        let file = try AVAudioFile(forReading: url, commonFormat: .pcmFormatFloat32, interleaved: false)
        let format = file.processingFormat
        let channels = Int(format.channelCount)
        let chunk: AVAudioFrameCount = 65_536
        guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: chunk) else {
            throw Failure.cannotAllocateBuffer
        }
        var mono: [Float] = []
        mono.reserveCapacity(Int(file.length))
        while file.framePosition < file.length {
            try file.read(into: buffer, frameCount: chunk)
            let n = Int(buffer.frameLength)
            if n == 0 { break }
            guard let data = buffer.floatChannelData else { throw Failure.cannotAllocateBuffer }
            if channels == 1 {
                mono.append(contentsOf: UnsafeBufferPointer(start: data[0], count: n))
            } else {
                // librosa.to_mono: the mean over channels, in float32.
                for i in 0..<n {
                    var sum = data[0][i]
                    for c in 1..<channels { sum += data[c][i] }
                    mono.append(sum / Float(channels))
                }
            }
        }
        if format.sampleRate == Double(analysisSampleRate) { return mono }
        return try resample(mono, from: format.sampleRate)
    }

    /// Band-limited resampling to 44.1 kHz with no added latency. The output has
    /// `ceil(n * 44100 / rate)` samples, like `librosa.resample`.
    static func resample(_ x: [Float], from rate: Double) throws -> [Float] {
        let target = Double(analysisSampleRate)
        let outCount = Int((Double(x.count) * target / rate).rounded(.up))
        guard !x.isEmpty else { return [] }
        guard
            let inFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: rate, channels: 1, interleaved: false),
            let outFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: target, channels: 1, interleaved: false),
            let converter = AVAudioConverter(from: inFormat, to: outFormat),
            let input = AVAudioPCMBuffer(pcmFormat: inFormat, frameCapacity: AVAudioFrameCount(x.count)),
            let output = AVAudioPCMBuffer(pcmFormat: outFormat, frameCapacity: AVAudioFrameCount(outCount + 1024))
        else { throw Failure.cannotResample(fromSampleRate: rate) }
        converter.sampleRateConverterAlgorithm = AVSampleRateConverterAlgorithm_Mastering
        converter.sampleRateConverterQuality = AVAudioQuality.max.rawValue
        converter.primeMethod = .normal
        x.withUnsafeBufferPointer { src in
            input.floatChannelData![0].update(from: src.baseAddress!, count: x.count)
        }
        input.frameLength = AVAudioFrameCount(x.count)
        nonisolated(unsafe) var supplied = false
        var error: NSError?
        let status = converter.convert(to: output, error: &error) { _, inputStatus in
            if supplied {
                inputStatus.pointee = .endOfStream
                return nil
            }
            supplied = true
            inputStatus.pointee = .haveData
            return input
        }
        guard status != .error, error == nil else { throw Failure.cannotResample(fromSampleRate: rate) }
        var y = Array(UnsafeBufferPointer(start: output.floatChannelData![0], count: Int(output.frameLength)))
        if y.count > outCount {
            y.removeLast(y.count - outCount)
        } else if y.count < outCount {
            y.append(contentsOf: repeatElement(0, count: outCount - y.count))
        }
        return y
    }
}
