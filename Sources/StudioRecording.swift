import AppKit
import AVFoundation

private let writeFrames: AVAudioFrameCount = 4096

final class StudioWaveFile {
    private var file: AVAudioFile?
    private let buffer: AVAudioPCMBuffer
    private let channels: [Int]

    init(url: URL, rate: UInt32, channels: [Int]) throws {
        self.channels = channels
        guard let format = AVAudioFormat(standardFormatWithSampleRate: Double(rate), channels: AVAudioChannelCount(channels.count)),
              let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: writeFrames) else { throw CocoaError(.fileWriteUnknown) }
        self.buffer = buffer
        var settings = format.settings
        settings[AVLinearPCMBitDepthKey] = 24
        settings[AVLinearPCMIsFloatKey] = false
        settings[AVLinearPCMIsNonInterleaved] = false
        file = try AVAudioFile(forWriting: url, settings: settings, commonFormat: .pcmFormatFloat32, interleaved: false)
    }

    func append(_ samples: [Float], frames: UInt32, stride: Int) throws {
        guard let file, let data = buffer.floatChannelData, frames <= buffer.frameCapacity else { throw CocoaError(.fileWriteUnknown) }
        buffer.frameLength = frames
        for (channel, source) in channels.enumerated() {
            for frame in 0..<Int(frames) { data[channel][frame] = samples[frame * stride + source] }
        }
        try file.write(from: buffer)
    }

    func close() { file = nil }
}

private final class RecordingStream {
    let capture: OpaquePointer
    let rate: UInt32
    private var samples: [Float]
    private let stride: Int
    private let files: [StudioWaveFile]
    private(set) var hasSignal = false

    init(capture: OpaquePointer, rate: UInt32, stride: Int, files: [StudioWaveFile]) {
        self.capture = capture
        self.rate = rate
        self.stride = stride
        self.files = files
        samples = [Float](repeating: 0, count: Int(writeFrames) * stride)
    }

    func drain() throws {
        // One pass can drain the whole fixed-capacity ring. Return to the serial queue between passes.
        for _ in 0..<16 {
            let frames = samples.withUnsafeMutableBufferPointer { StudioCaptureRead(capture, $0.baseAddress, writeFrames) }
            if frames == 0 { return }
            if !hasSignal { hasSignal = samples.prefix(Int(frames) * stride).contains { abs($0) > 0.0001 } }
            for file in files { try file.append(samples, frames: frames, stride: stride) }
        }
    }

    func close() { files.forEach { $0.close() } }
}

private final class Take {
    let folder: URL
    let guitar: RecordingStream?
    let mac: RecordingStream?
    let system: StudioMacCapture?
    let started = ProcessInfo.processInfo.systemUptime
    var timer: DispatchSourceTimer?

    init(folder: URL, guitar: RecordingStream?, mac: RecordingStream?, system: StudioMacCapture?) {
        self.folder = folder
        self.guitar = guitar
        self.mac = mac
        self.system = system
    }

    var streams: [RecordingStream] { [guitar, mac].compactMap { $0 } }
}

final class StudioRecording {
    private let writer = DispatchQueue(label: "local.idcore.studio.recording", qos: .userInitiated)
    private var take: Take?
    private var lastFolder: URL?
    private var lastSeconds = 0.0
    private var message = ""
    private var folder: URL?
    private var choosing = false

    func chooseFolder(window: NSWindow, reply: @escaping (Any?, String?) -> Void) {
        guard !choosing, writer.sync(execute: { take == nil }) else { reply(nil, "Önce kaydı durdur."); return }
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.canCreateDirectories = true
        panel.directoryURL = folder
        panel.prompt = "Klasörü seç"
        panel.message = "Yeni kayıtlar için bir klasör seç."
        choosing = true
        panel.beginSheetModal(for: window) { [self] response in
            choosing = false
            if response == .OK { folder = panel.url }
            reply(status(), nil)
        }
    }

    func status() -> [String: Any] {
        let directory = folder?.path ?? ""
        let supportsMac: Bool
        if #available(macOS 14.2, *) { supportsMac = true } else { supportsMac = false }
        return writer.sync {
            let seconds = take.map { ProcessInfo.processInfo.systemUptime - $0.started } ?? lastSeconds
            return [
                "active": take != nil, "seconds": seconds, "folder": directory,
                "hasSaved": lastFolder != nil, "message": message, "supportsMac": supportsMac
            ]
        }
    }

    func begin(audio: OpaquePointer?, snapshot: [String: Any]) throws {
        guard let folder else { throw Failure("Önce kayıt klasörünü seç.") }
        guard !choosing, writer.sync(execute: { take == nil }) else { throw Failure("Bir kayıt zaten açık.") }
        let guitar = snapshot["guitar"] as? Bool == true
        let mac = snapshot["mac"] as? Bool == true
        let diagnostics = snapshot["diagnostics"] as? Bool == true && guitar
        guard guitar || mac else { throw Failure("En az bir kayıt kaynağı seç.") }
        let guitarRate = StudioAudioSampleRate(audio)
        let guitarCapture = StudioAudioCapture(audio)
        if guitar && (guitarRate == 0 || guitarCapture == nil) { throw Failure("Gitar kaydı için Sanal pedalları aç.") }
        let settings = try JSONSerialization.data(withJSONObject: snapshot, options: [.prettyPrinted, .sortedKeys])
        guard settings.count <= 24_000 else { throw Failure("Kayıt ayarları okunamadı.") }
        let directory = folder.appendingPathComponent(Self.takeName(), isDirectory: true)
        let manager = FileManager.default
        try manager.createDirectory(at: directory, withIntermediateDirectories: false)
        var system: StudioMacCapture?
        do {
            var guitarStream: RecordingStream?
            var macStream: RecordingStream?
            if guitar, let guitarCapture {
                var files = [try StudioWaveFile(url: directory.appendingPathComponent("Gitar.wav"), rate: guitarRate, channels: [2, 3])]
                if diagnostics {
                    files.append(try StudioWaveFile(url: directory.appendingPathComponent("Ham-Gitar.wav"), rate: guitarRate, channels: [0]))
                    files.append(try StudioWaveFile(url: directory.appendingPathComponent("Blackstar-EQ.wav"), rate: guitarRate, channels: [1]))
                    try settings.write(to: directory.appendingPathComponent("Ayarlar.json"), options: .atomic)
                }
                guitarStream = RecordingStream(capture: guitarCapture, rate: guitarRate, stride: Int(StudioRecordingChannels), files: files)
            }
            if mac {
                guard #available(macOS 14.2, *) else { throw Failure("Mac sesi kaydı için macOS 14.2 veya sonrası gerekir.") }
                do { system = try StudioSystemAudio() }
                catch { throw Failure("Mac sesi başlatılamadı. Sistem Ayarları’nda IDCORE Studio’nun sistem sesi kaydı iznini kontrol et.") }
                if let system {
                    let file = try StudioWaveFile(url: directory.appendingPathComponent("Mac-Sesi.wav"), rate: system.sampleRate, channels: [0, 1])
                    macStream = RecordingStream(capture: system.samples, rate: system.sampleRate, stride: 2, files: [file])
                }
            }
            if guitar && StudioAudioBeginRecording(audio) != 0 { throw Failure("Blackstar USB ses kaydı başlatılamadı.") }
            let newTake = Take(folder: directory, guitar: guitarStream, mac: macStream, system: system)
            let timer = DispatchSource.makeTimerSource(queue: writer)
            timer.schedule(deadline: .now(), repeating: .milliseconds(25), leeway: .milliseconds(5))
            timer.setEventHandler { [weak self] in self?.drain() }
            writer.sync {
                take = newTake
                message = ""
                newTake.timer = timer
                timer.resume()
            }
        } catch {
            system?.stop()
            try? manager.removeItem(at: directory)
            throw error
        }
    }

    func end(guitarOnly: Bool = false) {
        writer.sync {
            guard let take, !guitarOnly || take.guitar != nil else { return }
            finish(take)
        }
    }

    func reveal() {
        if let url = writer.sync(execute: { lastFolder }) { NSWorkspace.shared.activateFileViewerSelecting([url]) }
    }

    private func drain() {
        guard let take else { return }
        do {
            for stream in take.streams { try stream.drain() }
            if take.streams.contains(where: { StudioCaptureOverflowed($0.capture) != 0 }) {
                finish(take, reason: "Disk yazımı yetişemedi. Kaydedilen bölüm klasörde.")
            }
        } catch {
            finish(take, reason: "Dosyaya yazma kesildi. Kaydedilen bölümü ve disk alanını kontrol et.")
        }
    }

    private func finish(_ active: Take, reason: String? = nil) {
        active.timer?.cancel()
        active.timer = nil
        if let guitar = active.guitar { StudioCaptureEnd(guitar.capture) }
        active.system?.stop()
        var issue = reason
        for _ in 0..<50 {
            if !active.streams.contains(where: { StudioCaptureIsWriting($0.capture) != 0 }) { break }
            usleep(1_000)
        }
        for stream in active.streams {
            do { try stream.drain() }
            catch { issue = "Disk yazımı tamamlanamadı. Kaydedilen bölüm klasörde." }
            stream.close()
        }
        let containsFrames = active.streams.contains { StudioCaptureFrames($0.capture) > 0 }
        var notice = issue ?? (containsFrames ? "Kayıt kaydedildi · \(active.folder.lastPathComponent)" : "Ses örneği alınamadı.")
        if issue == nil, let mac = active.mac, !mac.hasSignal { notice += " Mac parçasında ses algılanmadı." }
        message = notice
        lastFolder = active.folder
        lastSeconds = active.streams.map { Double(StudioCaptureFrames($0.capture)) / Double($0.rate) }.max() ?? 0
        take = nil
    }

    private static func takeName() -> String {
        let stamp = Date.now.formatted(.iso8601.year().month().day().time(includingFractionalSeconds: false).timeSeparator(.omitted))
        return "IDCORE Kayıt \(stamp)-\(UUID().uuidString.prefix(4))"
    }

    struct Failure: LocalizedError {
        let errorDescription: String?
        init(_ message: String) { errorDescription = message }
    }
}
