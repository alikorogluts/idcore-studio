import AppKit
import AVFoundation
import IOKit.hid
import OSLog
import WebKit

private let nativeTransport = """
(() => {
  const events = new EventTarget();
  const native = (command, data) => window.webkit.messageHandlers.amp.postMessage({command, data});
  const device = new EventTarget();
  device.opened = false;
  device.open = async () => { device.directBefore = await native('open', null); device.opened = true; };
  device.close = async () => { await native('close', null); device.opened = false; };
  device.sendReport = async (reportId, bytes) => {
    if (reportId !== 0 || !device.opened) throw new Error('USB bağlantısı açık değil.');
    await native('send', Array.from(bytes));
  };
  device.setDirectVolume = (before, after) => native('directVolume', [before, after]);
  events.requestDevice = async () => (await native('detect', null)) ? [device] : [];
  Object.defineProperty(navigator, 'hid', {value: events});
  window.studioNative = true;
  window.studioSettings = {
    load: () => native('loadSettings', null),
    save: (data) => native('saveSettings', data),
    preview: (data) => native('previewSettings', data),
    loadTones: () => native('loadTones', null),
    saveTones: (data) => native('saveTones', data)
  };
  window.studioAudio = {
    start: () => native('startAudio', null), stop: () => native('stopAudio', null),
    setLevel: (value) => native('audioLevel', value), meter: (tuning) => native('audioMeter', tuning),
    testUSB: () => native('testUSB', null), beginRecording: (snapshot) => native('beginRecording', snapshot),
    recordingStatus: () => native('recordingStatus', null), endRecording: () => native('endRecording', null),
    chooseRecordingFolder: () => native('chooseRecordingFolder', null), revealRecording: () => native('revealRecording', null)
  };
  window.studioReceive = (reportId, bytes) => {
    if (!device.opened) return;
    device.dispatchEvent(Object.assign(new Event('inputreport'), {
      reportId, data: new DataView(Uint8Array.from(bytes).buffer)
    }));
  };
  window.studioDisconnect = () => {
    device.opened = false;
    events.dispatchEvent(Object.assign(new Event('disconnect'), {device}));
  };
})();
"""

private struct VirtualPedal: Decodable {
    let type: Int
    let amount: Int
    let enabled: Bool
    let extra: [Int]?

    var isValid: Bool {
        let counts = [0, 0, 0, 0, 2, 2, 3, 1, 0, 3, 3, 3]
        guard (1...counts.count).contains(type), (0...100).contains(amount) else { return false }
        let values = extra ?? []
        let validCount = values.count == counts[type - 1] || (type == 8 && values.isEmpty)
        return validCount && values.allSatisfy { (0...100).contains($0) }
    }
}

private struct StudioSettings: Decodable {
    let names: [String]
    let pedals: [VirtualPedal]
    let balanceLevels: Bool?

    var isValid: Bool {
        names.count == 6 && names.allSatisfy { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && $0.utf16.count <= 32 } &&
        pedals.count <= Int(StudioPedalCount) && Set(pedals.map(\.type)).count == pedals.count && pedals.allSatisfy(\.isValid)
    }

    func apply(to audio: OpaquePointer?) {
        var order: UInt64 = 0
        var controls = [UInt32](repeating: 0, count: Int(StudioPedalCount))
        for (index, pedal) in pedals.enumerated() {
            order |= UInt64(pedal.type) << (4 * index)
            var packed: UInt32 = pedal.enabled ? 1 : 0
            for (controlIndex, value) in ([pedal.amount] + (pedal.extra ?? [])).enumerated() {
                packed |= UInt32(value) << (1 + 7 * controlIndex)
            }
            controls[pedal.type - 1] = packed
        }
        StudioAudioSetRig(audio, order, controls)
        StudioAudioSetLevelMatching(audio, balanceLevels == false ? 0 : 1)
    }
}

final class AmpBridge: NSObject, WKScriptMessageHandlerWithReply, WKNavigationDelegate {
    weak var view: WKWebView?
    private let reportBuffer = UnsafeMutablePointer<UInt8>.allocate(capacity: 64)
    private var device: IOHIDDevice?
    private var volumeKey: String?
    private var lastVolume: UInt8?
    private var mutedHere = false
    private let loop = CFRunLoopGetMain()!
    private let settingsKey = "studio.virtualRig"
    private let logger = Logger(subsystem: "local.idcore.studio", category: "Blackstar")
    private let recording = StudioRecording()
    private let audio = StudioAudioCreate()
    private var audioGeneration = 0
    private var audioRunning = false
    private var audioStarting = false
    private var nextRouteCheck = 0.0

    override init() {
        super.init()
        StudioAudioSetLevel(audio, 20)
    }

    deinit {
        shutdown()
        StudioAudioDestroy(audio)
        reportBuffer.deallocate()
    }

    private func findDevice() -> IOHIDDevice? {
        // Refresh matching after a USB replug or when Architect has just released the interface.
        let discovery = IOHIDManagerCreate(kCFAllocatorDefault, 0)
        IOHIDManagerSetDeviceMatching(discovery, [
            kIOHIDVendorIDKey: 0x27d4,
            kIOHIDProductIDKey: 0x0013
        ] as CFDictionary)
        return (IOHIDManagerCopyDevices(discovery) as? Set<IOHIDDevice>)?.first
    }

    private func openDevice() -> Bool {
        if device != nil { return true }
        guard let amp = findDevice() else { return false }
        let result = IOHIDDeviceOpen(amp, 0)
        guard result == kIOReturnSuccess else { logger.error("HID open failed: \(result)"); return false }
        device = amp
        let serial = IOHIDDeviceGetProperty(amp, kIOHIDSerialNumberKey as CFString) as? String
        let location = IOHIDDeviceGetProperty(amp, kIOHIDLocationIDKey as CFString) as? NSNumber
        if let serial, !serial.isEmpty { volumeKey = "studio.directVolume.serial.\(serial)" }
        else if let location { volumeKey = "studio.directVolume.usb.\(location)" }
        lastVolume = nil
        mutedHere = false
        let owner = Unmanaged.passUnretained(self).toOpaque()
        IOHIDDeviceScheduleWithRunLoop(amp, loop, CFRunLoopMode.commonModes.rawValue)
        IOHIDDeviceRegisterInputReportCallback(amp, reportBuffer, 64, { context, result, _, _, reportId, bytes, count in
            guard let context, result == kIOReturnSuccess, count > 0, count <= 64 else { return }
            let bridge = Unmanaged<AmpBridge>.fromOpaque(context).takeUnretainedValue()
            let report = UnsafeBufferPointer(start: bytes, count: count)
            if reportId == 0 { bridge.observeVolume(report) }
            let payload = report.map(String.init).joined(separator: ",")
            bridge.view?.evaluateJavaScript("window.studioReceive(\(reportId), [\(payload)]);")
        }, owner)
        IOHIDDeviceRegisterRemovalCallback(amp, { context, _, _ in
            guard let context else { return }
            let bridge = Unmanaged<AmpBridge>.fromOpaque(context).takeUnretainedValue()
            bridge.closeDevice(restore: false, reason: "Blackstar bağlantısı kesildi")
            bridge.view?.evaluateJavaScript("window.studioDisconnect();")
        }, owner)
        return true
    }

    private var previousVolume: UInt8? {
        guard let volumeKey, let value = UInt8(exactly: UserDefaults.standard.integer(forKey: volumeKey)),
              (1...127).contains(value) else { return nil }
        return value
    }

    private func observeVolume(_ report: UnsafeBufferPointer<UInt8>) {
        guard report.count >= 5 else { return }
        if (report[0] == 3 && report[1] == 1 && (40...41).contains(report[3])) ||
            (report[0] == 2 && report[1] == 6 && (1...6).contains(report[2]) && report[3] != 60) {
            mutedHere = false
            lastVolume = nil
        }
        guard report[0] == 3 else { return }
        let value: UInt8
        if report[3] == 42 && report.count >= 44 && report[5] <= 127 { value = report[6] }
        else if report[1] == 3 && (1...2).contains(report[3]) { value = report[4] }
        else { return }
        guard value <= 127 else { return }
        lastVolume = value
        if value > 0 {
            mutedHere = false
            if let volumeKey { UserDefaults.standard.removeObject(forKey: volumeKey) }
        }
    }

    private func setDirectVolume(_ value: UInt8, on amp: IOHIDDevice) -> Bool {
        var report = [UInt8](repeating: 0, count: 64)
        report.replaceSubrange(0..<5, with: [3, 3, 0, 1, value])
        let result = send(report, to: amp)
        if result == kIOReturnSuccess { lastVolume = nil }
        return result == kIOReturnSuccess
    }

    private func send(_ report: [UInt8], to amp: IOHIDDevice) -> IOReturn {
        let result = report.withUnsafeBufferPointer { bytes in
            IOHIDDeviceSetReport(amp, kIOHIDReportTypeOutput, 0, bytes.baseAddress!, bytes.count)
        }
        if result != kIOReturnSuccess { logger.error("HID write failed: \(result), command \(report[0]), parameter \(report[1])") }
        return result
    }

    func closeDevice(restore: Bool = true, reason: String = "Blackstar USB bağlantısı kapatıldı") {
        stopAudio(reason: reason)
        guard let amp = device else { return }
        if restore, mutedHere, lastVolume == 0, let previousVolume {
            _ = setDirectVolume(previousVolume, on: amp)
        }
        device = nil
        volumeKey = nil
        lastVolume = nil
        mutedHere = false
        IOHIDDeviceUnscheduleFromRunLoop(amp, loop, CFRunLoopMode.commonModes.rawValue)
        IOHIDDeviceClose(amp, 0)
    }

    private func stopAudio(reason: String = "Sanal gitar kapatıldı") {
        audioGeneration += 1
        audioRunning = false
        audioStarting = false
        StudioAudioStop(audio)
        recording.stopGuitar(reason: reason)
    }

    func shutdown() {
        recording.end()
        closeDevice()
    }

    private func audioError(_ status: Int32) -> String {
        switch status {
        case -1: return "Mac, Blackstar’ın USB ses girişini göremiyor. Amfi açıkken USB kablosunu çıkarıp yeniden tak."
        case -2: return "USB ses biçimi uygun değil. Ses MIDI Ayarları’nda ID:Core v4’ün dört giriş kanalı olmalı."
        default: return "USB ses akışı başlatılamadı. Amfiyi kullanan kayıt uygulamalarını kapatıp tekrar dene."
        }
    }

    private func startAudio(reply: @escaping (Any?, String?) -> Void) {
        guard device != nil else { reply(nil, "Önce amfiyi USB ile bağla."); return }
        guard !audioRunning, !audioStarting else { reply(nil, "Sanal ses zaten açılıyor veya çalışıyor."); return }
        let probe = StudioAudioProbe()
        guard probe == 0 else { reply(nil, audioError(probe)); return }
        audioStarting = true
        audioGeneration += 1
        let generation = audioGeneration
        let finish: (Bool) -> Void = { [weak self] granted in
            guard let self, self.device != nil, self.audioGeneration == generation else {
                reply(nil, "USB ses başlatma iptal edildi.")
                return
            }
            self.audioStarting = false
            guard granted else {
                reply(nil, "Gitarın USB girişini okumak için Sistem Ayarları → Gizlilik ve Güvenlik → Mikrofon bölümünden izin ver.")
                return
            }
            let result = StudioAudioStart(self.audio)
            self.audioRunning = result == 0
            self.nextRouteCheck = 0
            if self.audioRunning { self.logger.info("Blackstar USB audio started") }
            else { self.logger.error("Blackstar USB audio failed: \(result)") }
            reply(self.audioRunning, self.audioRunning ? nil : self.audioError(result))
        }
        if AVCaptureDevice.authorizationStatus(for: .audio) == .notDetermined {
            AVCaptureDevice.requestAccess(for: .audio) { granted in DispatchQueue.main.async { finish(granted) } }
        } else {
            finish(AVCaptureDevice.authorizationStatus(for: .audio) == .authorized)
        }
    }

    private func decodeSettings(_ data: String) -> StudioSettings? {
        guard data.utf8.count <= 4096, let settings = try? JSONDecoder().decode(StudioSettings.self, from: Data(data.utf8)), settings.isValid else { return nil }
        return settings
    }

    private func isStudioCommand(_ report: [UInt8]) -> Bool {
        guard report.count == 64 else { return false }
        switch report[0] {
        case 0x81:
            return report.prefix(8).elementsEqual([0x81, 0, 0, 4, 3, 6, 2, 0x7a]) && report.dropFirst(8).allSatisfy { $0 == 0 }
        case 7:
            return report.dropFirst().allSatisfy { $0 == 0 }
        case 2:
            return report[1] == 1 && (1...6).contains(report[2]) && report.dropFirst(3).allSatisfy { $0 == 0 }
        case 3:
            let limits: [UInt8: UInt8] = [
                1: 5, 2: 127, 3: 127, 4: 127, 5: 127, 6: 127, 7: 127, 11: 127, 12: 127,
                15: 1, 16: 1, 17: 1, 18: 3, 19: 31, 20: 127, 21: 127, 22: 127,
                23: 3, 24: 31, 26: 127, 28: 127, 29: 3, 30: 31, 32: 127, 38: 127, 39: 127, 40: 1
            ]
            guard let maxValue = limits[report[1]] else { return false }
            return report[2] == 0 && report[3] == 1 && report[4] <= maxValue && report.dropFirst(5).allSatisfy { $0 == 0 }
        default:
            return false
        }
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
        guard message.frameInfo.isMainFrame,
              let url = message.frameInfo.request.url, url == Bundle.main.url(forResource: "idcore-studio", withExtension: "html"),
              let body = message.body as? [String: Any], let command = body["command"] as? String else {
            replyHandler(nil, "Geçersiz USB isteği.")
            return
        }
        switch command {
        case "loadSettings":
            let data = UserDefaults.standard.string(forKey: settingsKey) ?? "null"
            decodeSettings(data)?.apply(to: audio)
            replyHandler(data, nil)
        case "saveSettings", "previewSettings":
            guard let data = body["data"] as? String, let settings = decodeSettings(data) else {
                replyHandler(nil, "Ayarlar kaydedilemedi.")
                return
            }
            if command == "saveSettings" { UserDefaults.standard.set(data, forKey: settingsKey) }
            else { settings.apply(to: audio) }
            replyHandler(true, nil)
        case "loadTones":
            replyHandler(UserDefaults.standard.string(forKey: "studio.songTones") ?? "{}", nil)
        case "saveTones":
            guard let data = body["data"] as? String, data.utf8.count <= 180_000 else {
                replyHandler(nil, "Şarkı tonları kaydedilemedi.")
                return
            }
            UserDefaults.standard.set(data, forKey: "studio.songTones")
            replyHandler(true, nil)
        case "startAudio": startAudio(reply: replyHandler)
        case "stopAudio": stopAudio(); replyHandler(true, nil)
        case "testUSB":
            guard audioRunning else { replyHandler(nil, "Önce sanal pedalları aç."); return }
            StudioAudioTestUSB(audio)
            replyHandler(true, nil)
        case "beginRecording":
            guard let snapshot = body["data"] as? [String: Any] else { replyHandler(nil, "Kayıt kaynakları okunamadı."); return }
            do {
                try recording.begin(audio: audio, snapshot: snapshot)
                replyHandler(recording.status(), nil)
            } catch {
                logger.error("Recording start failed: \(error.localizedDescription)")
                replyHandler(nil, error.localizedDescription)
            }
        case "recordingStatus": replyHandler(recording.status(), nil)
        case "endRecording": recording.end(); replyHandler(recording.status(), nil)
        case "chooseRecordingFolder":
            guard let window = view?.window else { replyHandler(nil, "Kayıt penceresi açılamadı."); return }
            recording.chooseFolder(window: window, reply: replyHandler)
        case "revealRecording": recording.reveal(); replyHandler(true, nil)
        case "audioMeter":
            let now = ProcessInfo.processInfo.systemUptime
            if audioRunning && now >= nextRouteCheck {
                nextRouteCheck = now + 1
                let route = StudioAudioCheckOutput(audio)
                if route != 0 {
                    stopAudio(reason: "Blackstar USB sesi kesildi")
                    logger.error("Blackstar USB audio stopped: \(route)")
                    replyHandler(["stopped": audioError(route)], nil)
                    return
                }
            }
            let tune = body["data"] as? Bool == true
            replyHandler([
                "input": StudioAudioInputLevel(audio), "output": StudioAudioOutputLevel(audio),
                "matchPermille": StudioAudioLevelMatchPermille(audio), "wahHz": StudioAudioWahHz(audio),
                "frequency": tune ? StudioAudioReadPitch(audio) : 0,
                "bufferFrames": StudioAudioBufferFrames(audio), "latencyMicros": StudioAudioLatencyMicros(audio)
            ], nil)
        case "audioLevel":
            guard let value = body["data"] as? Int, (0...100).contains(value) else { replyHandler(nil, "Geçersiz çıkış seviyesi."); return }
            StudioAudioSetLevel(audio, UInt32(value))
            replyHandler(true, nil)
        case "detect": replyHandler(findDevice() != nil, nil)
        case "open":
            let opened = openDevice()
            replyHandler(opened ? Int(previousVolume ?? 0) : nil, opened ? nil : "Amfi bağlantısı açılamadı.")
        case "directVolume":
            guard let amp = device, let volumeKey, let values = body["data"] as? [Int], values.count == 2,
                  let before = UInt8(exactly: values[0]), let after = UInt8(exactly: values[1]), lastVolume == before,
                  (after == 0 && (1...127).contains(before)) || (before == 0 && after == previousVolume) else {
                replyHandler(nil, "Amfi ses seviyesi değişti. Ayarları yeniden okuyup tekrar dene.")
                return
            }
            if after == 0 { UserDefaults.standard.set(Int(before), forKey: volumeKey) }
            let sent = setDirectVolume(after, on: amp)
            if sent { mutedHere = after == 0 }
            else if after == 0 { UserDefaults.standard.removeObject(forKey: volumeKey) }
            replyHandler(sent, sent ? nil : "Amfi ses komutunu almadı.")
        case "close":
            closeDevice()
            replyHandler(true, nil)
        case "send":
            guard let amp = device, let values = body["data"] as? [Int], values.count == 64 else {
                replyHandler(nil, "USB bağlantısı açık değil.")
                return
            }
            let report = values.compactMap(UInt8.init(exactly:))
            guard isStudioCommand(report) else {
                replyHandler(nil, "USB komutu desteklenmiyor.")
                return
            }
            if report[0] == 2 || (report[0] == 3 && report[1] == 3) {
                mutedHere = false
                lastVolume = nil
            }
            let result = send(report, to: amp)
            replyHandler(result == kIOReturnSuccess, result == kIOReturnSuccess ? nil : "Amfi komutu alınamadı.")
        default: replyHandler(nil, "Geçersiz USB isteği.")
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let url = action.request.url, url == Bundle.main.url(forResource: "idcore-studio", withExtension: "html") {
            decisionHandler(.allow)
            return
        }
        let references = ["https://github.com/SirYasko/ASTRO-Blackstar", "https://www.blackstaramps.com/wp-content/uploads/2024/01/155300M-VA-1-IDCORE-V4-OWNERS-MANUAL.pdf"]
        if action.navigationType == .linkActivated, let url = action.request.url,
           references.contains(url.absoluteString) || isRecordingURL(url) {
            NSWorkspace.shared.open(url)
        }
        decisionHandler(.cancel)
    }

    private func isRecordingURL(_ url: URL) -> Bool {
        guard let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
              parts.scheme == "https", parts.host == "music.youtube.com", parts.path == "/watch",
              parts.user == nil, parts.password == nil, parts.port == nil, parts.fragment == nil,
              let query = parts.queryItems, query.count == 1, let item = query.first, item.name == "v",
              let video = item.value else { return false }
        return video.range(of: "^[A-Za-z0-9_-]{11}$", options: .regularExpression) != nil
    }
}

final class StudioApp: NSObject, NSApplicationDelegate {
    private var window: NSWindow?
    private let bridge = AmpBridge()

    func applicationDidFinishLaunching(_ notification: Notification) {
        guard let page = Bundle.main.url(forResource: "idcore-studio", withExtension: "html") else {
            let alert = NSAlert()
            alert.messageText = "Kontrol paneli bulunamadı."
            alert.runModal()
            NSApp.terminate(nil)
            return
        }
        let quitItem = NSMenuItem(title: "ID:CORE Studio’dan Çık", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        let appMenu = NSMenu()
        appMenu.addItem(quitItem)
        let rootMenu = NSMenu()
        let appItem = NSMenuItem()
        appItem.submenu = appMenu
        rootMenu.addItem(appItem)
        let editMenu = NSMenu(title: "Düzenle")
        editMenu.addItem(withTitle: "Kes", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "Kopyala", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Yapıştır", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "Tümünü seç", action: #selector(NSResponder.selectAll(_:)), keyEquivalent: "a")
        let editItem = NSMenuItem(title: "Düzenle", action: nil, keyEquivalent: "")
        editItem.submenu = editMenu
        rootMenu.addItem(editItem)
        NSApp.mainMenu = rootMenu

        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.userContentController.addScriptMessageHandler(bridge, contentWorld: .page, name: "amp")
        configuration.userContentController.addUserScript(WKUserScript(source: nativeTransport, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = bridge
        bridge.view = view
        view.loadFileURL(page, allowingReadAccessTo: page.deletingLastPathComponent())

        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1120, height: 810), styleMask: [.titled, .closable, .resizable, .miniaturizable], backing: .buffered, defer: false)
        window.title = "ID:CORE Studio"
        window.contentMinSize = NSSize(width: 400, height: 460)
        window.contentView = view
        window.center()
        window.makeKeyAndOrderFront(nil)
        self.window = window
        if let icon = Bundle.main.url(forResource: "StudioIcon", withExtension: "icns"), let image = NSImage(contentsOf: icon) {
            NSApp.applicationIconImage = image
        }
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    func applicationWillTerminate(_ notification: Notification) { bridge.shutdown() }
}

@main
enum IDCOREStudio {
    static func main() {
        let application = NSApplication.shared
        let delegate = StudioApp()
        application.setActivationPolicy(.regular)
        application.delegate = delegate
        application.run()
    }
}
