import AppKit
import AVFoundation
import CoreAudio

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

    func pad(frames: UInt32, stride: Int) throws {
        var remaining = frames
        let zeros = [Float](repeating: 0, count: Int(writeFrames) * stride)
        while remaining > 0 {
            let count = min(remaining, writeFrames)
            try append(zeros, frames: count, stride: stride)
            remaining -= count
        }
    }
}

private struct SignalLevel {
    var peak: Float = 0
    var energy: Double = 0
    var count = 0

    mutating func add(_ sample: Float) {
        let value = sample.isFinite ? sample : 0
        peak = max(peak, abs(value))
        energy += Double(value) * Double(value)
        count += 1
    }

    var peakDB: Double { 20 * log10(Double(max(peak, 0.000001))) }
    var rmsDB: Double { 10 * log10(max(energy / Double(max(count, 1)), 1e-12)) }
}

private final class RecordingStream {
    let capture: OpaquePointer
    let rate: UInt32
    private var samples: [Float]
    private let stride: Int
    private let files: [StudioWaveFile]
    private let startHost: UInt64
    private(set) var levels: [SignalLevel]
    private(set) var timing: [String: Any]?
    private(set) var hasSignal = false
    private var leadingFrames: UInt32 = 0
    private var firstBlock = true
    private var framesWritten: UInt64 = 0

    var seconds: Double { Double(framesWritten) / Double(rate) }

    init(capture: OpaquePointer, rate: UInt32, stride: Int, files: [StudioWaveFile], startHost: UInt64, measure: Bool = false) {
        self.capture = capture
        self.rate = rate
        self.stride = stride
        self.files = files
        self.startHost = startHost
        levels = measure ? Array(repeating: SignalLevel(), count: stride) : []
        samples = [Float](repeating: 0, count: Int(writeFrames) * stride)
    }

    func drain() throws {
        // One pass can drain the whole fixed-capacity ring. Return to the serial queue between passes.
        for _ in 0..<16 {
            let frames = samples.withUnsafeMutableBufferPointer { StudioCaptureRead(capture, $0.baseAddress, writeFrames) }
            if frames == 0 { return }
            if firstBlock {
                firstBlock = false
                let first = StudioCaptureFirstHostTime(capture)
                if let seconds = Self.seconds(from: startHost, to: first), seconds <= 30 {
                    leadingFrames = UInt32((seconds * Double(rate)).rounded())
                    for file in files { try file.pad(frames: leadingFrames, stride: stride) }
                    framesWritten += UInt64(leadingFrames)
                }
            }
            if !hasSignal { hasSignal = samples.prefix(Int(frames) * stride).contains { abs($0) > 0.0001 } }
            for file in files { try file.append(samples, frames: frames, stride: stride) }
            framesWritten += UInt64(frames)
            if !levels.isEmpty {
                for frame in 0..<Int(frames) {
                    for channel in levels.indices { levels[channel].add(samples[frame * stride + channel]) }
                }
            }
        }
    }

    func close() {
        files.forEach { $0.close() }
        let first = StudioCaptureFirstHostTime(capture)
        let end = StudioCaptureEndHostTime(capture)
        var values: [String: Any] = ["sampleRate": rate, "frames": framesWritten, "leadingSilenceFrames": leadingFrames]
        if let start = Self.seconds(from: startHost, to: first) { values["firstSampleSeconds"] = start }
        if let finish = Self.seconds(from: startHost, to: end), !firstBlock {
            values["lastSampleEndSeconds"] = finish
            values["fileEndMinusClockMilliseconds"] = (seconds - finish) * 1000
        }
        timing = values
    }

    private static func seconds(from start: UInt64, to end: UInt64) -> Double? {
        guard start != 0, end >= start else { return nil }
        return Double(AudioConvertHostTimeToNanos(end - start)) / 1e9
    }
}

private final class Take {
    let folder: URL
    let guitar: RecordingStream?
    let mac: RecordingStream?
    let system: StudioMacCapture?
    let started: Double
    var timer: DispatchSourceTimer?
    var guitarActive: Bool
    var guitarNotice: String?

    init(folder: URL, guitar: RecordingStream?, mac: RecordingStream?, system: StudioMacCapture?, lead: Double) {
        self.folder = folder
        self.guitar = guitar
        self.mac = mac
        self.system = system
        started = ProcessInfo.processInfo.systemUptime + lead
        guitarActive = guitar != nil
    }

    var streams: [RecordingStream] { [guitar, mac].compactMap { $0 } }
    var activeStreams: [RecordingStream] { [guitarActive ? guitar : nil, mac].compactMap { $0 } }
}

final class StudioRecording {
    private let writer = DispatchQueue(label: "local.idcore.studio.recording", qos: .userInitiated)
    private var take: Take?
    private var lastFolder: URL?
    private var lastSeconds = 0.0
    private var message = ""
    private var toneSummary = ""
    private var folder = UserDefaults.standard.url(forKey: "studio.recordingFolder")
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
            if response == .OK {
                folder = panel.url
                UserDefaults.standard.set(folder, forKey: "studio.recordingFolder")
            }
            reply(status(), nil)
        }
    }

    func status() -> [String: Any] {
        let directory = folder?.path ?? ""
        let supportsMac: Bool
        if #available(macOS 14.2, *) { supportsMac = true } else { supportsMac = false }
        return writer.sync {
            let seconds = take.map { max(0, ProcessInfo.processInfo.systemUptime - $0.started) } ?? lastSeconds
            return [
                "active": take != nil, "seconds": seconds, "folder": directory,
                "hasSaved": lastFolder != nil, "message": message, "supportsMac": supportsMac,
                "guitarActive": take?.guitarActive == true, "macActive": take?.mac != nil,
                "guitarNotice": take?.guitarNotice ?? "", "toneSummary": toneSummary
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
        var startedGuitar = false
        do {
            var guitarFiles: [StudioWaveFile] = []
            if guitar {
                guitarFiles = [try StudioWaveFile(url: directory.appendingPathComponent("Gitar.wav"), rate: guitarRate, channels: [2, 3])]
                if diagnostics {
                    guitarFiles.append(try StudioWaveFile(url: directory.appendingPathComponent("Ham-Gitar.wav"), rate: guitarRate, channels: [0]))
                    guitarFiles.append(try StudioWaveFile(url: directory.appendingPathComponent("Blackstar-EQ.wav"), rate: guitarRate, channels: [1]))
                    try settings.write(to: directory.appendingPathComponent("Ayarlar.json"), options: .atomic)
                }
            }
            var macFile: StudioWaveFile?
            if mac {
                guard #available(macOS 14.2, *) else { throw Failure("Mac sesi kaydı için macOS 14.2 veya sonrası gerekir.") }
                do { system = try StudioSystemAudio() }
                catch { throw Failure("Mac sesi başlatılamadı. Sistem Ayarları’nda IDCORE Studio’nun sistem sesi kaydı iznini kontrol et.") }
                if let system {
                    macFile = try StudioWaveFile(url: directory.appendingPathComponent("Mac-Sesi.wav"), rate: system.sampleRate, channels: [0, 1])
                }
            }
            // Schedule both inputs against the same host clock after the files and the tap are ready.
            let lead = 0.1
            let start = AudioGetCurrentHostTime() + AudioConvertNanosToHostTime(UInt64(lead * 1e9))
            var guitarStream: RecordingStream?
            if guitar, let guitarCapture {
                guitarStream = RecordingStream(capture: guitarCapture, rate: guitarRate, stride: Int(StudioRecordingChannels),
                                               files: guitarFiles, startHost: start, measure: diagnostics)
                guard StudioAudioBeginRecordingAt(audio, start) == 0 else { throw Failure("Blackstar USB ses kaydı başlatılamadı.") }
                startedGuitar = true
            }
            var macStream: RecordingStream?
            if let system, let macFile {
                macStream = RecordingStream(capture: system.samples, rate: system.sampleRate, stride: 2, files: [macFile], startHost: start)
                guard StudioCaptureStartAt(system.samples, start, Double(system.sampleRate)) == 0 else { throw Failure("Mac sesi kaydı başlatılamadı.") }
            }
            let newTake = Take(folder: directory, guitar: guitarStream, mac: macStream, system: system, lead: lead)
            let timer = DispatchSource.makeTimerSource(queue: writer)
            timer.schedule(deadline: .now(), repeating: .milliseconds(25), leeway: .milliseconds(5))
            timer.setEventHandler { [weak self] in self?.drain() }
            writer.sync {
                take = newTake
                message = ""
                toneSummary = ""
                newTake.timer = timer
                timer.resume()
            }
        } catch {
            if startedGuitar { StudioCaptureEnd(guitarCapture) }
            system?.stop()
            try? manager.removeItem(at: directory)
            throw error
        }
    }

    func end() {
        writer.sync {
            guard let take else { return }
            finish(take)
        }
    }

    func stopGuitar(reason: String) {
        writer.sync {
            guard let take, take.guitarActive, let guitar = take.guitar else { return }
            if take.mac == nil {
                finish(take, reason: "\(reason). Gitar kaydı klasörde.")
                return
            }
            let issue = close(guitar)
            take.guitarActive = false
            let time = Self.timeLabel(guitar.seconds)
            take.guitarNotice = "\(reason) · \(time). Mac sesi kaydedilmeye devam ediyor."
            if let issue { take.guitarNotice = "\(take.guitarNotice ?? "") \(issue)" }
        }
    }

    func reveal() {
        if let url = writer.sync(execute: { lastFolder }) { NSWorkspace.shared.activateFileViewerSelecting([url]) }
    }

    private func drain() {
        guard let take else { return }
        do {
            for stream in take.activeStreams { try stream.drain() }
            if take.activeStreams.contains(where: { StudioCaptureOverflowed($0.capture) != 0 }) {
                finish(take, reason: "Disk yazımı yetişemedi. Kaydedilen bölüm klasörde.")
            }
        } catch {
            finish(take, reason: "Dosyaya yazma kesildi. Kaydedilen bölümü ve disk alanını kontrol et.")
        }
    }

    private func finish(_ active: Take, reason: String? = nil) {
        active.timer?.cancel()
        active.timer = nil
        if active.guitarActive, let guitar = active.guitar { StudioCaptureEnd(guitar.capture) }
        active.system?.stop()
        var issue = reason
        for stream in active.activeStreams {
            if let error = close(stream) { issue = error }
        }
        let containsFrames = active.streams.contains { $0.seconds > 0 }
        var notice = issue ?? (containsFrames ? "Kayıt kaydedildi · \(active.folder.lastPathComponent)" : "Ses örneği alınamadı.")
        if let guitar = active.guitar, !active.guitarActive { notice += " Gitar \(Self.timeLabel(guitar.seconds)) konumunda kesildi." }
        if let mac = active.mac, !mac.hasSignal { notice += " Mac parçasında ses algılanmadı." }
        if let guitar = active.guitar, let mac = active.mac, let guitarTiming = guitar.timing, let macTiming = mac.timing {
            var timing: [String: Any] = ["guitar": guitarTiming, "mac": macTiming]
            if !active.guitarActive { timing["guitarStoppedAtSeconds"] = guitar.seconds }
            do {
                let data = try JSONSerialization.data(withJSONObject: timing, options: [.prettyPrinted, .sortedKeys])
                try data.write(to: active.folder.appendingPathComponent("Zamanlama.json"), options: .atomic)
            } catch { notice += " Zamanlama bilgisi yazılamadı." }
        }
        if let guitar = active.guitar, guitar.levels.count == 4 {
            toneSummary = Self.describe(guitar.levels)
            do { try toneSummary.write(to: active.folder.appendingPathComponent("Ton-Olcumu.txt"), atomically: true, encoding: .utf8) }
            catch { notice += " Ton ölçümü dosyaya yazılamadı." }
        }
        message = notice
        lastFolder = active.folder
        lastSeconds = active.streams.map(\.seconds).max() ?? 0
        take = nil
    }

    private func close(_ stream: RecordingStream) -> String? {
        StudioCaptureEnd(stream.capture)
        for _ in 0..<50 {
            if StudioCaptureIsWriting(stream.capture) == 0 { break }
            usleep(1_000)
        }
        defer { stream.close() }
        do {
            try stream.drain()
            return nil
        } catch {
            return "Disk yazımı tamamlanamadı. Kaydedilen bölümü ve disk alanını kontrol et."
        }
    }

    private static func timeLabel(_ seconds: Double) -> String {
        let total = Int(seconds)
        return String(format: "%d:%02d", total / 60, total % 60)
    }

    private static func describe(_ levels: [SignalLevel]) -> String {
        let dry = levels[0], amp = levels[1], left = levels[2], right = levels[3]
        let pedalPeak = max(left.peakDB, right.peakDB)
        let pedalRMS = 10 * log10(max((left.energy + right.energy) / Double(max(left.count + right.count, 1)), 1e-12))
        let readings = String(format: "Ham gitar %.1f · Blackstar EQ %.1f · Pedal çıkışı %.1f dBFS (tepe).", dry.peakDB, amp.peakDB, pedalPeak)
        let tip: String
        if dry.peakDB < -42 { tip = "Ham gitar seviyesi düşük. Bir riff çaldıysan gitarın ses düğmesini ve kabloyu kontrol edip tekrar kaydet." }
        else if amp.peakDB >= -1 { tip = "Blackstar EQ sinyali tavana yakın. Amfi Gain’i veya USB kayıt seviyesini azaltıp karşılaştır." }
        else if pedalRMS - amp.rmsDB < -6 && pedalPeak < -8 {
            tip = "Pedal çıkışı ön kattan belirgin düşük. Seviyesi ayarlanabilen son açık pedalın Level ayarını az artırıp aynı riffi tekrar kaydet."
        } else { tip = "Dijital seviyelerden belirgin bir ayar sorunu çıkmadı. Hoparlördeki tonu değerlendirmek için aynı riffin oda kaydı gerekir." }
        return "\(readings)\n\(tip)"
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
