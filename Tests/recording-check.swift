import AVFoundation

@main
struct RecordingCheck {
    static func main() throws {
        let destination = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
        let rate: UInt32 = 48_000
        let frames: UInt32 = 4096
        let blocks = 120
        let samples: [Float] = Array(repeating: [0.1, 0.2, 0.3, -0.4], count: Int(frames)).flatMap { $0 }
        let checks: [(String, [Int], [Float])] = [
            ("Ham-Gitar.wav", [0], [0.1]), ("Blackstar-EQ.wav", [1], [0.2]),
            ("Gitar.wav", [2, 3], [0.3, -0.4])
        ]
        for (name, source, reference) in checks {
            let url = destination.appendingPathComponent(name)
            let writer = try StudioWaveFile(url: url, rate: rate, channels: source)
            for _ in 0..<blocks { try writer.append(samples, frames: frames, stride: 4) }
            writer.close()
            let file = try AVAudioFile(forReading: url)
            precondition(file.length == Int64(frames) * Int64(blocks))
            precondition(file.fileFormat.sampleRate == Double(rate) && file.fileFormat.channelCount == reference.count)
            let buffer = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: frames)!
            try file.read(into: buffer)
            for (channel, sample) in reference.enumerated() {
                precondition(abs(buffer.floatChannelData![channel][0] - sample) < 0.00001)
            }
        }
        print("Streaming WAV: mono diagnostic and stereo guitar tracks, 10.24 seconds with matching samples")
    }
}
