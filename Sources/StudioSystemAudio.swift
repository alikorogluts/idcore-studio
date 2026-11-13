import CoreAudio
import Foundation

protocol StudioMacCapture: AnyObject {
    var samples: OpaquePointer { get }
    var sampleRate: UInt32 { get }
    func stop()
}

@available(macOS 14.2, *)
final class StudioSystemAudio: StudioMacCapture {
    let samples: OpaquePointer
    private(set) var sampleRate: UInt32 = 0
    private var tap = AudioObjectID(kAudioObjectUnknown)
    private var aggregate = AudioObjectID(kAudioObjectUnknown)
    private var process: AudioDeviceIOProcID?
    private var started = false

    init() throws {
        guard let samples = StudioCaptureCreate(2) else { throw CocoaError(.fileWriteUnknown) }
        self.samples = samples
        do { try start() }
        catch {
            stop()
            throw error
        }
    }

    deinit {
        stop()
        StudioCaptureDestroy(samples)
    }

    private func start() throws {
        var pid = getpid()
        var identity = AudioObjectID(kAudioObjectUnknown)
        var size = UInt32(MemoryLayout<AudioObjectID>.size)
        var address = property(kAudioHardwarePropertyTranslatePIDToProcessObject)
        let status = AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address,
            UInt32(MemoryLayout<pid_t>.size), &pid, &size, &identity)
        // The current process may not have an audio object when only Mac playback is recorded.
        let excluded = status == noErr && identity != kAudioObjectUnknown ? [identity] : []
        let description = CATapDescription(stereoGlobalTapButExcludeProcesses: excluded)
        description.name = "IDCORE Studio · Mac sesi"
        description.isPrivate = true
        description.muteBehavior = .unmuted
        try check(AudioHardwareCreateProcessTap(description, &tap))

        var format = AudioStreamBasicDescription()
        size = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
        address = property(kAudioTapPropertyFormat)
        try check(AudioObjectGetPropertyData(tap, &address, 0, nil, &size, &format))
        let channelsPerBuffer = format.mFormatFlags & kAudioFormatFlagIsNonInterleaved == 0 ? 2 : 1
        guard format.mFormatID == kAudioFormatLinearPCM, format.mChannelsPerFrame == 2,
              format.mFormatFlags & kAudioFormatFlagIsFloat != 0, format.mBitsPerChannel == 32,
              format.mBytesPerFrame == channelsPerBuffer * MemoryLayout<Float>.size,
              format.mFormatFlags & kAudioFormatFlagIsBigEndian == 0,
              format.mSampleRate.isFinite, (8_000...192_000).contains(format.mSampleRate) else {
            throw CocoaError(.fileWriteUnknown)
        }
        sampleRate = UInt32(format.mSampleRate.rounded())

        let settings: [String: Any] = [
            kAudioAggregateDeviceNameKey: "IDCORE Studio · Mac kaydı",
            kAudioAggregateDeviceUIDKey: UUID().uuidString,
            kAudioAggregateDeviceIsPrivateKey: true,
            kAudioAggregateDeviceTapAutoStartKey: true,
            kAudioAggregateDeviceTapListKey: [[
                kAudioSubTapUIDKey: description.uuid.uuidString,
                kAudioSubTapDriftCompensationKey: true
            ]]
        ]
        try check(AudioHardwareCreateAggregateDevice(settings as CFDictionary, &aggregate))
        try check(AudioDeviceCreateIOProcIDWithBlock(&process, aggregate, nil) { [samples] _, input, timestamp, _, _ in
            StudioCaptureWriteStereoAt(samples, input, timestamp)
        })
        try check(AudioDeviceStart(aggregate, process))
        started = true
    }

    func stop() {
        StudioCaptureEnd(samples)
        if let process {
            if started { AudioDeviceStop(aggregate, process) }
            AudioDeviceDestroyIOProcID(aggregate, process)
            self.process = nil
            started = false
        }
        if aggregate != kAudioObjectUnknown {
            AudioHardwareDestroyAggregateDevice(aggregate)
            aggregate = AudioObjectID(kAudioObjectUnknown)
        }
        if tap != kAudioObjectUnknown {
            AudioHardwareDestroyProcessTap(tap)
            tap = AudioObjectID(kAudioObjectUnknown)
        }
    }

    private func check(_ status: OSStatus) throws {
        if status != noErr { throw NSError(domain: NSOSStatusErrorDomain, code: Int(status)) }
    }

    private func property(_ selector: AudioObjectPropertySelector) -> AudioObjectPropertyAddress {
        .init(mSelector: selector, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
    }
}
