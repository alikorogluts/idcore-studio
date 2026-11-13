#include "StudioAudio.h"

#include <CoreAudio/CoreAudio.h>
#include <math.h>
#include <stdatomic.h>
#include <stdbool.h>
#include <stdlib.h>
#include <string.h>

enum { maxRate = 192000, ringSize = maxRate / 2 + 2, echoSize = maxRate * 3 + 2, preampChannel = 2, dryChannel = 3, captureChannels = dryChannel + 1 };
enum { pitchSampleRate = 16000, pitchSize = 4096, pitchWindow = 1360, pitchLags = 255 };
enum { captureCapacity = 65536 };
enum { deviceMissing = -1, formatUnsupported = -2, audioUnavailable = -3 };

typedef struct { float left; float right; } Signal;
typedef struct { float first; float second; float third; float fourth; } Controls;
typedef struct { unsigned type; Controls control; } Stage;
typedef struct { Stage stages[StudioPedalCount]; unsigned count; } Rig;
typedef struct { float previousInput; float previousOutput; float lastInput; float lastOutput; } Filter;
typedef struct { float direct; float first; float last; float feedbackFirst; float feedbackLast; } BandPass;
typedef struct { float driveTone, germaniumDC, screamerBass, screamerTone, envelope, echoTone; Filter wah; float phase90[4], vibe[4]; } Voice;
typedef struct {
    float position, fast, baseline, pulseAge;
    unsigned frames;
    BandPass filter;
} Wah;

typedef struct {
    float gain, target;
    double dryEnergy, preampEnergy;
    unsigned frames;
} LevelMatch;

struct StudioCapture {
    uint32_t channels;
    _Atomic uint64_t written;
    _Atomic uint64_t read;
    _Atomic uint64_t firstHostTime;
    _Atomic uint64_t endHostTime;
    uint64_t startHostTime;
    double rate;
    _Atomic bool active;
    _Atomic bool writing;
    _Atomic bool overflowed;
    float samples[];
};

struct StudioAudio {
    AudioDeviceID device;
    AudioDeviceIOProcID process;
    UInt32 originalBufferFrames;
    UInt32 configuredBufferFrames;
    _Atomic uint32_t rigRevision;
    _Atomic uint64_t order;
    _Atomic uint32_t controls[StudioPedalCount];
    Rig lastRig;
    _Atomic uint32_t level;
    _Atomic uint32_t inputLevel;
    _Atomic uint32_t outputLevel;
    _Atomic uint32_t bufferFrames;
    _Atomic uint32_t latencyMicros;
    _Atomic bool testUSB;
    _Atomic bool matchLevels;
    _Atomic uint32_t matchPermille;
    _Atomic uint32_t wahHz;
    _Atomic uint32_t pitchWritten;
    _Atomic uint32_t pitchRate;
    _Atomic int32_t pitch[pitchSize];
    double rate;
    float gain;
    uint32_t testFrame;
    uint32_t testFrames;
    LevelMatch levelMatch;
    Wah wah;
    StudioCapture *recording;
    Voice voices[2];
    double phase[StudioPedalCount];
    Signal chorus[ringSize];
    Signal delay[ringSize];
    Signal echo[echoSize];
    size_t position;
    size_t echoPosition;
    unsigned pitchDecimation;
    unsigned pitchFrames;
    float pitchSum;
};

static AudioObjectPropertyAddress address(AudioObjectPropertySelector selector, AudioObjectPropertyScope scope) {
    return (AudioObjectPropertyAddress){selector, scope, kAudioObjectPropertyElementMain};
}

static bool property(AudioObjectID object, AudioObjectPropertyAddress key, void *value, UInt32 size) {
    return AudioObjectGetPropertyData(object, &key, 0, NULL, &size, value) == noErr;
}

static bool deviceRate(AudioDeviceID device, double *rate) {
    return property(device, address(kAudioDevicePropertyNominalSampleRate, kAudioObjectPropertyScopeGlobal), rate, sizeof(*rate)) &&
        isfinite(*rate) && *rate >= 8000 && *rate <= maxRate;
}

static CFStringRef deviceString(AudioDeviceID device, AudioObjectPropertySelector selector) {
    CFStringRef value = NULL;
    return property(device, address(selector, kAudioObjectPropertyScopeGlobal), &value, sizeof(value)) ? value : NULL;
}

static bool sameString(AudioObjectID object, AudioObjectPropertySelector selector, CFStringRef expected) {
    CFStringRef value = deviceString(object, selector);
    if (!value) return false;
    bool matches = CFStringCompare(value, expected, kCFCompareCaseInsensitive) == kCFCompareEqualTo;
    CFRelease(value);
    return matches;
}

static AudioDeviceID *systemDevices(UInt32 *count) {
    AudioObjectPropertyAddress key = address(kAudioHardwarePropertyDevices, kAudioObjectPropertyScopeGlobal);
    UInt32 size = 0;
    *count = 0;
    if (AudioObjectGetPropertyDataSize(kAudioObjectSystemObject, &key, 0, NULL, &size) != noErr || size == 0) return NULL;
    AudioDeviceID *devices = malloc(size);
    if (!devices) return NULL;
    if (AudioObjectGetPropertyData(kAudioObjectSystemObject, &key, 0, NULL, &size, devices) != noErr) {
        free(devices);
        return NULL;
    }
    *count = size / sizeof(*devices);
    return devices;
}

static bool isAmplifier(AudioDeviceID device) {
    UInt32 transport = 0;
    return property(device, address(kAudioDevicePropertyTransportType, kAudioObjectPropertyScopeGlobal), &transport, sizeof(transport)) &&
        transport == kAudioDeviceTransportTypeUSB && sameString(device, kAudioObjectPropertyName, CFSTR("ID:Core v4")) &&
        sameString(device, kAudioObjectPropertyManufacturer, CFSTR("Blackstar Amplification Limited"));
}

static AudioDeviceID findAmplifier(void) {
    UInt32 count = 0;
    AudioDeviceID *devices = systemDevices(&count);
    AudioDeviceID result = kAudioObjectUnknown;
    for (UInt32 index = 0; index < count; ++index) {
        if (isAmplifier(devices[index])) {
            result = devices[index];
            break;
        }
    }
    free(devices);
    return result;
}

static bool supportsChannels(AudioDeviceID device, AudioObjectPropertyScope scope, UInt32 channels, double rate) {
    AudioObjectPropertyAddress key = address(kAudioDevicePropertyStreams, scope);
    UInt32 size = 0;
    if (AudioObjectGetPropertyDataSize(device, &key, 0, NULL, &size) != noErr || size == 0) return false;
    AudioStreamID *streams = malloc(size);
    if (!streams) return false;
    UInt32 count = 0;
    if (AudioObjectGetPropertyData(device, &key, 0, NULL, &size, streams) == noErr) {
        for (size_t index = 0; index < size / sizeof(*streams); ++index) {
            AudioStreamBasicDescription format = {0};
            if (!property(streams[index], address(kAudioStreamPropertyVirtualFormat, kAudioObjectPropertyScopeGlobal), &format, sizeof(format)) ||
                format.mFormatID != kAudioFormatLinearPCM || !(format.mFormatFlags & kAudioFormatFlagIsFloat) ||
                (format.mFormatFlags & kAudioFormatFlagIsBigEndian) || format.mBitsPerChannel != 32 ||
                format.mBytesPerFrame != sizeof(float) * ((format.mFormatFlags & kAudioFormatFlagIsNonInterleaved) ? 1 : format.mChannelsPerFrame) ||
                fabs(format.mSampleRate - rate) > 1.0) {
                count = 0;
                break;
            }
            count += format.mChannelsPerFrame;
        }
    }
    free(streams);
    return count >= channels;
}

static int32_t amplifierFormat(AudioDeviceID *device, double *rate) {
    *device = findAmplifier();
    if (*device == kAudioObjectUnknown) return deviceMissing;
    if (!deviceRate(*device, rate) ||
        !supportsChannels(*device, kAudioObjectPropertyScopeInput, captureChannels, *rate) ||
        !supportsChannels(*device, kAudioObjectPropertyScopeOutput, 2, *rate)) return formatUnsupported;
    return noErr;
}

static AudioObjectPropertyAddress bufferSizeAddress(void) {
    return address(kAudioDevicePropertyBufferFrameSize, kAudioObjectPropertyScopeGlobal);
}

static bool deviceIsIdle(AudioDeviceID device) {
    UInt32 running = 0;
    return property(device, address(kAudioDevicePropertyDeviceIsRunning, kAudioObjectPropertyScopeGlobal),
                    &running, sizeof(running)) && !running;
}

static void preferLowLatency(StudioAudio *audio) {
    AudioObjectPropertyAddress size = bufferSizeAddress();
    AudioValueRange range = {0};
    Boolean settable = false;
    UInt32 current = 0;
    if (!deviceIsIdle(audio->device) ||
        !property(audio->device, size, &current, sizeof(current)) ||
        AudioObjectIsPropertySettable(audio->device, &size, &settable) != noErr || !settable ||
        !property(audio->device, address(kAudioDevicePropertyBufferFrameSizeRange, kAudioObjectPropertyScopeGlobal),
                  &range, sizeof(range))) return;
    const UInt32 preferred = 128;
    if (preferred >= current || preferred < range.mMinimum || preferred > range.mMaximum) return;
    if (AudioObjectSetPropertyData(audio->device, &size, 0, NULL, sizeof(preferred), &preferred) == noErr) {
        audio->originalBufferFrames = current;
        audio->configuredBufferFrames = preferred;
        property(audio->device, size, &audio->configuredBufferFrames, sizeof(audio->configuredBufferFrames));
    }
}

static void restoreBufferSize(StudioAudio *audio) {
    if (!audio->originalBufferFrames) return;
    AudioObjectPropertyAddress size = bufferSizeAddress();
    UInt32 current = 0;
    if (deviceIsIdle(audio->device) && property(audio->device, size, &current, sizeof(current)) &&
        current == audio->configuredBufferFrames) {
        AudioObjectSetPropertyData(audio->device, &size, 0, NULL, sizeof(audio->originalBufferFrames), &audio->originalBufferFrames);
    }
    audio->originalBufferFrames = audio->configuredBufferFrames = 0;
}

static float bound(float value) { return fmaxf(-1.0f, fminf(1.0f, value)); }

static float mix(float dry, float wet, float amount) { return dry + amount * (wet - dry); }

static float lowPass(float sample, float *state, float coefficient) {
    *state += coefficient * (sample - *state);
    return *state;
}

static float softClip(float sample) { return sample / (1.0f + fabsf(sample)); }

static Signal interpolateDelay(const Signal *ring, size_t size, size_t position, double offset) {
    size_t frames = (size_t)offset;
    size_t first = (position + size - frames) % size;
    Signal current = ring[first];
    Signal next = ring[(first + size - 1) % size];
    float fraction = (float)(offset - frames);
    return (Signal){mix(current.left, next.left, fraction), mix(current.right, next.right, fraction)};
}

static float oscillator(StudioAudio *audio, unsigned type, float frequency) {
    double *phase = &audio->phase[type - 1];
    float output = (float)sin(*phase);
    *phase += 2 * M_PI * frequency / audio->rate;
    if (*phase >= 2 * M_PI) *phase -= 2 * M_PI;
    return output;
}

static float wahFrequency(float position) {
    return 300.0f * exp2f(3.0f * position);
}

static BandPass wahFilter(float position, double rate) {
    double omega = 2 * M_PI * wahFrequency(position) / rate;
    double alpha = sin(omega) / 5.8;
    float gain = (float)(alpha / (1 + alpha));
    return (BandPass){gain, 0, -gain, (float)(2 * cos(omega) / (1 + alpha)), (float)((alpha - 1) / (1 + alpha))};
}

static float bandPass(float sample, Filter *state, BandPass filter) {
    float output = filter.direct * sample + filter.first * state->previousInput + filter.last * state->lastInput +
                   filter.feedbackFirst * state->previousOutput + filter.feedbackLast * state->lastOutput;
    *state = (Filter){sample, output, state->previousInput, state->previousOutput};
    return output;
}

static float allPass(float sample, float *state, const float *coefficients) {
    for (unsigned index = 0; index < 4; ++index) {
        float output = state[index] - coefficients[index] * sample;
        state[index] = sample + coefficients[index] * output;
        sample = output;
    }
    return sample;
}

static void phaserCoefficients(float *coefficients, float sweep, const float *bands, double rate) {
    for (unsigned index = 0; index < 4; ++index) {
        float ratio = (float)(M_PI * sweep * bands[index] / rate);
        coefficients[index] = (1 - ratio) / (1 + ratio);
    }
}

static Rig readRig(StudioAudio *audio) {
    uint32_t revision = atomic_load_explicit(&audio->rigRevision, memory_order_acquire);
    if (revision & 1) return audio->lastRig;
    Rig rig = {0};
    uint64_t order = atomic_load_explicit(&audio->order, memory_order_relaxed);
    for (unsigned index = 0; index < StudioPedalCount; ++index) {
        unsigned type = (order >> (4 * index)) & 15u;
        if (type < 1 || type > StudioPedalCount) break;
        uint32_t values = atomic_load_explicit(&audio->controls[type - 1], memory_order_relaxed);
        if (!(values & 1)) continue;
        Controls controls = {(float)((values >> 1) & 127) * 0.01f, (float)((values >> 8) & 127) * 0.01f,
                             (float)((values >> 15) & 127) * 0.01f, (float)((values >> 22) & 127) * 0.01f};
        rig.stages[rig.count++] = (Stage){type, controls};
    }
    atomic_thread_fence(memory_order_acquire);
    if (revision == atomic_load_explicit(&audio->rigRevision, memory_order_relaxed)) audio->lastRig = rig;
    return audio->lastRig;
}

static float germanium(float sample, Voice *voice, Controls controls, double rate) {
    float bias = (controls.second - 0.5f) * 0.75f;
    float headroom = 0.18f + controls.third * 0.72f;
    float driven = sample * (1.6f + 7.0f * controls.first);
    float clipped = (softClip((driven + bias) / headroom) - softClip(bias / headroom)) * headroom;
    return (clipped - lowPass(clipped, &voice->germaniumDC, (float)(95.0 / rate))) * (0.65f + 1.0f * controls.first);
}

static float screamer(float sample, Voice *voice, Controls controls, double rate) {
    float bass = lowPass(sample, &voice->screamerBass, (float)(3900.0 / rate));
    float driven = (sample - bass * 0.78f) * (2.0f + 21.0f * controls.first);
    float tone = lowPass(softClip(driven), &voice->screamerTone, (float)fmin(0.9, (5000.0 + 20000.0 * controls.second) / rate));
    return (tone * 0.72f + sample * 0.14f) * (1.85f * controls.third);
}

static float compressor(float sample, Voice *voice, Controls controls, double rate) {
    float attack = (float)(1.0 / (rate * (0.001 + 0.099 * controls.second)));
    float release = (float)(1.0 / (rate * 0.16));
    float magnitude = fabsf(sample);
    float envelope = lowPass(magnitude, &voice->envelope, magnitude > voice->envelope ? attack : release);
    float threshold = 0.32f - 0.29f * controls.first;
    float reduction = envelope > threshold ? (threshold + (envelope - threshold) / (1.0f + 11.0f * controls.first)) / envelope : 1.0f;
    return mix(sample, sample * reduction * 2.0f * controls.fourth, controls.third);
}

static float wahAttack(Wah *wah, float dry, float sensitivity, float rate) {
    float level = fabsf(dry);
    lowPass(level, &wah->fast, (level > wah->fast ? 460.0f : 120.0f) / rate);
    lowPass(level, &wah->baseline, 24.0f / rate);
    float threshold = (0.0013f + wah->baseline * 0.55f) / (0.6f + 1.7f * sensitivity);
    if (wah->pulseAge >= 0.12f && wah->fast - wah->baseline > threshold) wah->pulseAge = 0;
    wah->pulseAge = fminf(1.0f, wah->pulseAge + 1.0f / rate);
    float sweep = wah->pulseAge < 0.043f ? wah->pulseAge / 0.043f : fmaxf(0.0f, 1.0f - (wah->pulseAge - 0.043f) / 0.24f);
    return 0.05f + 0.93f * sweep;
}

static Signal processWah(StudioAudio *audio, Signal input, float dry, Controls controls) {
    Wah *wah = &audio->wah;
    float target = controls.first;
    if (controls.second >= 0.75f) target = wahAttack(wah, dry, controls.first, (float)audio->rate);
    else if (controls.second >= 0.25f) target = 0.5f + 0.46f * oscillator(audio, 8, 0.6f + 2.4f * controls.first);
    lowPass(target, &wah->position, (float)(170.0 / audio->rate));
    if (wah->frames++ % 24 == 0) wah->filter = wahFilter(wah->position, audio->rate);
    return (Signal){input.left * 0.10f + bandPass(input.left, &audio->voices[0].wah, wah->filter) * 3.2f,
                    input.right * 0.10f + bandPass(input.right, &audio->voices[1].wah, wah->filter) * 3.2f};
}

static float echoFilter(float sample, Voice *voice, float position, double rate) {
    float distance = fabsf(position - 0.5f) * 2.0f;
    float lowCutoff = 650.0f + 7800.0f * (1.0f - distance) * (1.0f - distance);
    float highCutoff = 55.0f + 1815.0f * distance * distance;
    float cutoff = position < 0.5f ? lowCutoff : highCutoff;
    float low = lowPass(sample, &voice->echoTone, (float)fmin(0.88, 2.0 * M_PI * cutoff / rate));
    return mix(sample, position < 0.5f ? low : sample - low, fminf(1.0f, distance * 5.0f));
}

static Signal processSample(StudioAudio *audio, float sample, float dry, const Rig *rig) {
    Signal signal = {sample, sample};
    Signal chorusInput = {0};
    Signal delayInput = {0};
    Signal echoInput = {0};
    Voice *left = &audio->voices[0];
    Voice *right = &audio->voices[1];
    for (unsigned index = 0; index < rig->count; ++index) {
        unsigned type = rig->stages[index].type;
        Controls controls = rig->stages[index].control;
        float amount = controls.first;
        switch (type) {
        case 1: {
            float drive = 1 + 17 * amount;
            float alpha = (float)fmin(1.0, 6500.0 / audio->rate);
            signal.left = mix(signal.left, lowPass(softClip(signal.left * drive), &left->driveTone, alpha), amount);
            signal.right = mix(signal.right, lowPass(softClip(signal.right * drive), &right->driveTone, alpha), amount);
            break;
        }
        case 2: {
            double offset = (0.018 + 0.004 * oscillator(audio, type, 0.75f)) * audio->rate;
            Signal delayed = interpolateDelay(audio->chorus, ringSize, audio->position, offset);
            chorusInput = signal;
            signal = (Signal){mix(signal.left, delayed.left, amount * 0.55f), mix(signal.right, delayed.right, amount * 0.55f)};
            break;
        }
        case 3: case 12: {
            float speed = type == 3 ? 4.5f : (0.55f + 10.0f * controls.second) * (controls.fourth >= 0.5f ? 0.5f : 1.0f);
            float wave = oscillator(audio, type, speed);
            if (type == 12 && controls.third >= 0.5f) wave = bound(wave * 5);
            float multiplier = 1.0f - amount * (0.5f - 0.5f * wave);
            signal = (Signal){signal.left * multiplier, signal.right * multiplier};
            break;
        }
        case 4: {
            Signal delayed = interpolateDelay(audio->delay, ringSize, audio->position, 0.32 * audio->rate);
            delayInput = (Signal){bound(signal.left + delayed.left * 0.42f * amount), bound(signal.right + delayed.right * 0.42f * amount)};
            signal = (Signal){signal.left + delayed.left * amount * 0.75f, signal.right + delayed.right * amount * 0.75f};
            break;
        }
        case 5:
            signal = (Signal){germanium(signal.left, left, controls, audio->rate), germanium(signal.right, right, controls, audio->rate)};
            break;
        case 6:
            signal = (Signal){screamer(signal.left, left, controls, audio->rate), screamer(signal.right, right, controls, audio->rate)};
            break;
        case 7:
            signal = (Signal){compressor(signal.left, left, controls, audio->rate), compressor(signal.right, right, controls, audio->rate)};
            break;
        case 8:
            signal = processWah(audio, signal, dry, controls);
            break;
        case 9: case 10: {
            const float phaseBands[] = {1, 1, 1, 1};
            const float vibeBands[] = {0.34f, 0.81f, 1.39f, 2.25f};
            bool vibe = type == 10;
            float speed = 0.14f + 7.7f * amount * amount;
            float wave = oscillator(audio, type, speed);
            float intensity = vibe ? controls.second : 1;
            float sweep = 670.0f + 480.0f * intensity * wave;
            float coefficients[4];
            phaserCoefficients(coefficients, sweep, vibe ? vibeBands : phaseBands, audio->rate);
            float blend = vibe && controls.third >= 0.5f ? 1 : 0.5f;
            float volume = vibe ? 1.8f * controls.fourth : 1;
            signal = (Signal){mix(signal.left, allPass(signal.left, vibe ? left->vibe : left->phase90, coefficients), blend) * volume,
                              mix(signal.right, allPass(signal.right, vibe ? right->vibe : right->phase90, coefficients), blend) * volume};
            break;
        }
        case 11: {
            double offset = (0.045 + 2.955 * controls.second * controls.second) * audio->rate;
            Signal delayed = interpolateDelay(audio->echo, echoSize, audio->echoPosition, offset);
            float echoLeft = echoFilter(delayed.left, left, controls.fourth, audio->rate);
            float echoRight = echoFilter(delayed.right, right, controls.fourth, audio->rate);
            echoInput = (Signal){bound(signal.left + echoRight * controls.third * 0.82f), bound(signal.right * 0.10f + echoLeft * controls.third * 0.82f)};
            signal = (Signal){mix(signal.left, echoLeft, amount), mix(signal.right, echoRight, amount)};
            break;
        }
        }
    }
    audio->chorus[audio->position] = chorusInput;
    audio->delay[audio->position] = delayInput;
    audio->echo[audio->echoPosition] = echoInput;
    audio->position = (audio->position + 1) % ringSize;
    audio->echoPosition = (audio->echoPosition + 1) % echoSize;
    return (Signal){bound(signal.left), bound(signal.right)};
}

static void capturePitch(StudioAudio *audio, float sample) {
    audio->pitchSum += sample;
    if (++audio->pitchFrames < audio->pitchDecimation) return;
    uint32_t count = atomic_load_explicit(&audio->pitchWritten, memory_order_relaxed);
    atomic_store_explicit(&audio->pitch[count % pitchSize], (int32_t)(audio->pitchSum * 32767 / audio->pitchFrames), memory_order_relaxed);
    atomic_store_explicit(&audio->pitchWritten, count + 1, memory_order_release);
    audio->pitchSum = 0;
    audio->pitchFrames = 0;
}

typedef struct { float *samples; UInt32 stride; UInt32 frames; } AudioChannel;

static AudioChannel channel(const AudioBufferList *buffers, UInt32 target) {
    if (!buffers) return (AudioChannel){0};
    for (UInt32 index = 0; index < buffers->mNumberBuffers; ++index) {
        AudioBuffer buffer = buffers->mBuffers[index];
        if (target < buffer.mNumberChannels) {
            if (buffer.mData) return (AudioChannel){(float *)buffer.mData + target, buffer.mNumberChannels, buffer.mDataByteSize / (buffer.mNumberChannels * sizeof(float))};
            break;
        }
        target -= buffer.mNumberChannels;
    }
    return (AudioChannel){0};
}

static float sampleAt(AudioChannel input, UInt32 frame) {
    if (frame >= input.frames) return 0;
    float sample = input.samples[frame * input.stride];
    return isfinite(sample) ? bound(sample) : 0;
}

static void updateMeter(_Atomic uint32_t *meter, float peak) {
    uint32_t previous = atomic_load_explicit(meter, memory_order_relaxed);
    uint32_t measured = (uint32_t)(sqrtf(peak) * 100.0f);
    atomic_store_explicit(meter, measured > previous * 0.975f ? measured : (uint32_t)(previous * 0.975f), memory_order_relaxed);
}

static float matchGain(LevelMatch *match, bool enabled, float dry, float preamp, float rate) {
    if (enabled) {
        match->dryEnergy += dry * dry;
        match->preampEnergy += preamp * preamp;
        if (++match->frames >= (unsigned)(0.24f * rate)) {
            if (match->dryEnergy > match->frames * 0.00000324 && match->preampEnergy > match->frames * 0.0000005625) {
                float ratio = 10.0f * sqrtf((float)(match->dryEnergy / match->preampEnergy));
                float target = fmaxf(0.5f, fminf(8.0f, ratio));
                if (target < match->target * 0.88f || target > match->target * 1.14f) match->target = target;
            }
            match->dryEnergy = match->preampEnergy = 0;
            match->frames = 0;
        }
    } else if (match->target != 1.0f || match->frames) {
        *match = (LevelMatch){.gain = match->gain, .target = 1.0f};
    }
    float speed = match->target < match->gain ? 7.0f : 3.0f;
    return lowPass(match->target, &match->gain, speed / rate);
}

typedef struct { uint64_t position; uint32_t skip; } CaptureBlock;

static uint64_t hostTime(const AudioTimeStamp *timestamp) {
    return timestamp && (timestamp->mFlags & kAudioTimeStampHostTimeValid) ? timestamp->mHostTime : 0;
}

static bool reserveCapture(StudioCapture *capture, uint32_t frames, uint64_t host, CaptureBlock *block) {
    if (!capture || !frames || !atomic_load(&capture->active)) return false;
    atomic_store(&capture->writing, true);
    if (!atomic_load(&capture->active)) {
        atomic_store(&capture->writing, false);
        return false;
    }
    uint64_t written = atomic_load_explicit(&capture->written, memory_order_relaxed);
    double rate = capture->rate;
    uint32_t skip = 0;
    uint64_t clock = host ? host : AudioGetCurrentHostTime();
    if (capture->startHostTime > clock && rate > 0) {
        double preceding = (double)AudioConvertHostTimeToNanos(capture->startHostTime - clock) * rate / 1e9;
        if (!host || preceding >= frames) {
            atomic_store(&capture->writing, false);
            return false;
        }
        skip = (uint32_t)ceil(preceding);
    }
    if (skip >= frames) {
        atomic_store(&capture->writing, false);
        return false;
    }
    uint64_t read = atomic_load_explicit(&capture->read, memory_order_acquire);
    if (frames - skip > captureCapacity || written - read + frames - skip > captureCapacity) {
        atomic_store(&capture->overflowed, true);
        atomic_store(&capture->active, false);
        atomic_store(&capture->writing, false);
        return false;
    }
    if (host && rate > 0) {
        if (!written) atomic_store_explicit(&capture->firstHostTime, host + AudioConvertNanosToHostTime((uint64_t)llround(skip * 1e9 / rate)), memory_order_relaxed);
        atomic_store_explicit(&capture->endHostTime, host + AudioConvertNanosToHostTime((uint64_t)llround(frames * 1e9 / rate)), memory_order_relaxed);
    } else {
        atomic_store_explicit(&capture->endHostTime, 0, memory_order_relaxed);
    }
    *block = (CaptureBlock){written, skip};
    return true;
}

static float *captureFrame(StudioCapture *capture, uint64_t position) {
    return capture->samples + (position % captureCapacity) * capture->channels;
}

static void commitCapture(StudioCapture *capture, uint64_t position) {
    atomic_store_explicit(&capture->written, position, memory_order_release);
    atomic_store(&capture->writing, false);
}

static float keepHeadroom(float sample) {
    const float knee = 0.82f;
    float excess = fabsf(sample) - knee;
    if (excess <= 0) return sample;
    const float room = 1.0f - knee;
    return copysignf(knee + room * excess / (room + excess), sample);
}

static OSStatus renderAudio(AudioDeviceID device, const AudioTimeStamp *now, const AudioBufferList *input,
                            const AudioTimeStamp *inputTime, AudioBufferList *output,
                            const AudioTimeStamp *outputTime, void *context) {
    StudioAudio *audio = context;
    AudioChannel preamp = channel(input, preampChannel);
    AudioChannel dry = channel(input, dryChannel);
    AudioChannel left = channel(output, 0);
    AudioChannel right = channel(output, 1);
    UInt32 frames = preamp.frames < left.frames ? preamp.frames : left.frames;
    if (right.frames < frames) frames = right.frames;
    Rig rig = readRig(audio);
    bool balance = atomic_load_explicit(&audio->matchLevels, memory_order_relaxed);
    bool hasWah = false;
    for (unsigned index = 0; index < rig.count; ++index) hasWah |= rig.stages[index].type == 8;
    float volume = atomic_load_explicit(&audio->level, memory_order_relaxed) * 0.01f;
    float target = volume * (0.36f + 0.24f * volume);
    if (atomic_exchange_explicit(&audio->testUSB, false, memory_order_relaxed)) {
        audio->testFrame = 0;
        audio->testFrames = (uint32_t)(0.32 * audio->rate);
    }
    float inputPeak = 0;
    float outputPeak = 0;
    StudioCapture *recording = audio->recording;
    uint64_t inputHost = hostTime(inputTime);
    uint64_t outputHost = hostTime(outputTime);
    if (frames) {
        atomic_store_explicit(&audio->bufferFrames, frames, memory_order_relaxed);
        uint64_t latency = outputHost > inputHost && inputHost ? AudioConvertHostTimeToNanos(outputHost - inputHost) / 1000 : 0;
        atomic_store_explicit(&audio->latencyMicros, latency <= UINT32_MAX ? (uint32_t)latency : 0, memory_order_relaxed);
    }
    CaptureBlock block = {0};
    bool recordingActive = reserveCapture(recording, frames, inputHost, &block);
    float monitorStep = (float)(40.0 / audio->rate);
    for (UInt32 frame = 0; frame < frames; ++frame) {
        float sample = sampleAt(preamp, frame);
        float unprocessed = sampleAt(dry, frame);
        inputPeak = fmaxf(inputPeak, fabsf(sample));
        capturePitch(audio, unprocessed);
        audio->gain += (target - audio->gain) * monitorStep;
        Signal result = processSample(audio, sample, unprocessed, &rig);
        float correction = matchGain(&audio->levelMatch, balance, unprocessed, sample, (float)audio->rate);
        result.left = keepHeadroom(result.left * correction);
        result.right = keepHeadroom(result.right * correction);
        Signal monitor = {result.left * audio->gain, result.right * audio->gain};
        if (audio->testFrame < audio->testFrames) {
            uint32_t edge = audio->testFrame < audio->testFrames - audio->testFrame ? audio->testFrame : audio->testFrames - audio->testFrame;
            float envelope = fminf(1.0f, edge / (0.012f * (float)audio->rate));
            float tone = 0.028f * envelope * (float)sin(2 * M_PI * 440 * audio->testFrame++ / audio->rate);
            monitor = (Signal){tone, tone};
        }
        left.samples[frame * left.stride] = monitor.left;
        right.samples[frame * right.stride] = monitor.right;
        outputPeak = fmaxf(outputPeak, fmaxf(fabsf(monitor.left), fabsf(monitor.right)));
        if (recordingActive && frame >= block.skip) {
            float *track = captureFrame(recording, block.position++);
            track[0] = unprocessed;
            track[1] = sample;
            track[2] = result.left * 0.75f;
            track[3] = result.right * 0.75f;
        }
    }
    if (recordingActive) commitCapture(recording, block.position);
    updateMeter(&audio->inputLevel, inputPeak);
    updateMeter(&audio->outputLevel, outputPeak);
    atomic_store_explicit(&audio->matchPermille, (uint32_t)lroundf(audio->levelMatch.gain * 1000.0f), memory_order_relaxed);
    atomic_store_explicit(&audio->wahHz, hasWah && frames ? (uint32_t)lroundf(wahFrequency(audio->wah.position)) : 0, memory_order_relaxed);
    return noErr;
}

StudioAudio *StudioAudioCreate(void) {
    StudioAudio *audio = calloc(1, sizeof(StudioAudio));
    if (audio && !(audio->recording = StudioCaptureCreate(StudioRecordingChannels))) {
        free(audio);
        return NULL;
    }
    if (audio) {
        atomic_init(&audio->rigRevision, 0);
        atomic_init(&audio->order, 0);
        for (unsigned index = 0; index < StudioPedalCount; ++index) atomic_init(&audio->controls[index], 0);
        atomic_init(&audio->level, 20);
        atomic_init(&audio->inputLevel, 0);
        atomic_init(&audio->outputLevel, 0);
        atomic_init(&audio->bufferFrames, 0);
        atomic_init(&audio->latencyMicros, 0);
        atomic_init(&audio->testUSB, false);
        atomic_init(&audio->matchLevels, true);
        atomic_init(&audio->matchPermille, 1000);
        atomic_init(&audio->wahHz, 0);
        audio->levelMatch = (LevelMatch){.gain = 1.0f, .target = 1.0f};
        audio->wah.pulseAge = 1.0f;
        atomic_init(&audio->pitchWritten, 0);
        atomic_init(&audio->pitchRate, 0);
        for (unsigned index = 0; index < pitchSize; ++index) atomic_init(&audio->pitch[index], 0);
    }
    return audio;
}

void StudioAudioDestroy(StudioAudio *audio) {
    StudioAudioStop(audio);
    if (audio) StudioCaptureDestroy(audio->recording);
    free(audio);
}

int32_t StudioAudioProbe(void) {
    AudioDeviceID device;
    double rate;
    return amplifierFormat(&device, &rate);
}

static int32_t startDevice(StudioAudio *audio) {
    if (AudioDeviceCreateIOProcID(audio->device, renderAudio, audio, &audio->process) != noErr) return audioUnavailable;
    if (AudioDeviceStart(audio->device, audio->process) == noErr) return noErr;
    AudioDeviceDestroyIOProcID(audio->device, audio->process);
    audio->process = NULL;
    return audioUnavailable;
}

int32_t StudioAudioStart(StudioAudio *audio) {
    if (!audio) return audioUnavailable;
    if (audio->process) return noErr;
    int32_t status = amplifierFormat(&audio->device, &audio->rate);
    if (status != noErr) return status;
    audio->gain = 0;
    audio->testFrame = audio->testFrames = 0;
    atomic_store_explicit(&audio->testUSB, false, memory_order_relaxed);
    audio->levelMatch = (LevelMatch){.gain = 1.0f, .target = 1.0f};
    audio->wah = (Wah){.position = 0.46f, .pulseAge = 1.0f};
    audio->position = audio->echoPosition = 0;
    audio->pitchFrames = 0;
    audio->pitchSum = 0;
    audio->pitchDecimation = (unsigned)ceil(audio->rate / pitchSampleRate);
    atomic_store_explicit(&audio->pitchWritten, 0, memory_order_relaxed);
    atomic_store_explicit(&audio->pitchRate, (uint32_t)lround(audio->rate / audio->pitchDecimation), memory_order_relaxed);
    memset(audio->voices, 0, sizeof(audio->voices));
    memset(audio->phase, 0, sizeof(audio->phase));
    memset(audio->chorus, 0, sizeof(audio->chorus));
    memset(audio->delay, 0, sizeof(audio->delay));
    memset(audio->echo, 0, sizeof(audio->echo));
    preferLowLatency(audio);
    status = startDevice(audio);
    if (status != noErr && audio->originalBufferFrames) {
        restoreBufferSize(audio);
        status = startDevice(audio);
    }
    if (status != noErr) StudioAudioStop(audio);
    return status;
}

void StudioAudioStop(StudioAudio *audio) {
    if (!audio) return;
    if (audio->process) {
        AudioDeviceStop(audio->device, audio->process);
        AudioDeviceDestroyIOProcID(audio->device, audio->process);
        audio->process = NULL;
    }
    restoreBufferSize(audio);
    StudioCaptureEnd(audio->recording);
    atomic_store_explicit(&audio->inputLevel, 0, memory_order_relaxed);
    atomic_store_explicit(&audio->outputLevel, 0, memory_order_relaxed);
    atomic_store_explicit(&audio->bufferFrames, 0, memory_order_relaxed);
    atomic_store_explicit(&audio->latencyMicros, 0, memory_order_relaxed);
    atomic_store_explicit(&audio->matchPermille, 1000, memory_order_relaxed);
    atomic_store_explicit(&audio->wahHz, 0, memory_order_relaxed);
    atomic_store_explicit(&audio->pitchWritten, 0, memory_order_relaxed);
}

int32_t StudioAudioCheckOutput(const StudioAudio *audio) {
    if (!audio || !audio->process) return noErr;
    double rate = 0;
    return isAmplifier(audio->device) && deviceRate(audio->device, &rate) && fabs(rate - audio->rate) < 1
        ? noErr : deviceMissing;
}

void StudioAudioSetRig(StudioAudio *audio, uint64_t order, const uint32_t *controls) {
    if (!audio || !controls) return;
    atomic_fetch_add_explicit(&audio->rigRevision, 1, memory_order_acq_rel);
    for (unsigned index = 0; index < StudioPedalCount; ++index) {
        atomic_store_explicit(&audio->controls[index], controls[index], memory_order_relaxed);
    }
    atomic_store_explicit(&audio->order, order, memory_order_relaxed);
    atomic_fetch_add_explicit(&audio->rigRevision, 1, memory_order_release);
}

void StudioAudioSetLevel(StudioAudio *audio, uint32_t level) {
    if (audio && level <= 100) atomic_store_explicit(&audio->level, level, memory_order_relaxed);
}

void StudioAudioTestUSB(StudioAudio *audio) {
    if (audio) atomic_store_explicit(&audio->testUSB, true, memory_order_relaxed);
}

void StudioAudioSetLevelMatching(StudioAudio *audio, int32_t enabled) {
    if (audio) atomic_store_explicit(&audio->matchLevels, enabled != 0, memory_order_relaxed);
}

uint32_t StudioAudioLevelMatchPermille(const StudioAudio *audio) {
    return audio ? atomic_load_explicit(&audio->matchPermille, memory_order_relaxed) : 1000;
}

uint32_t StudioAudioWahHz(const StudioAudio *audio) {
    return audio ? atomic_load_explicit(&audio->wahHz, memory_order_relaxed) : 0;
}

uint32_t StudioAudioInputLevel(const StudioAudio *audio) {
    return audio ? atomic_load_explicit(&audio->inputLevel, memory_order_relaxed) : 0;
}

uint32_t StudioAudioOutputLevel(const StudioAudio *audio) {
    return audio ? atomic_load_explicit(&audio->outputLevel, memory_order_relaxed) : 0;
}

uint32_t StudioAudioBufferFrames(const StudioAudio *audio) {
    return audio ? atomic_load_explicit(&audio->bufferFrames, memory_order_relaxed) : 0;
}

uint32_t StudioAudioLatencyMicros(const StudioAudio *audio) {
    return audio ? atomic_load_explicit(&audio->latencyMicros, memory_order_relaxed) : 0;
}

int32_t StudioAudioBeginRecording(StudioAudio *audio) {
    return StudioAudioBeginRecordingAt(audio, 0);
}

int32_t StudioAudioBeginRecordingAt(StudioAudio *audio, uint64_t hostTime) {
    return audio && audio->process ? StudioCaptureStartAt(audio->recording, hostTime, audio->rate) : audioUnavailable;
}

uint32_t StudioAudioSampleRate(const StudioAudio *audio) {
    return audio && audio->process ? (uint32_t)lround(audio->rate) : 0;
}

StudioCapture *StudioAudioCapture(StudioAudio *audio) { return audio ? audio->recording : NULL; }

StudioCapture *StudioCaptureCreate(uint32_t channels) {
    if (channels != 2 && channels != StudioRecordingChannels) return NULL;
    StudioCapture *capture = calloc(1, sizeof(*capture) + (size_t)captureCapacity * channels * sizeof(float));
    if (!capture) return NULL;
    capture->channels = channels;
    atomic_init(&capture->written, 0);
    atomic_init(&capture->read, 0);
    atomic_init(&capture->firstHostTime, 0);
    atomic_init(&capture->endHostTime, 0);
    atomic_init(&capture->active, false);
    atomic_init(&capture->writing, false);
    atomic_init(&capture->overflowed, false);
    return capture;
}

void StudioCaptureDestroy(StudioCapture *capture) { free(capture); }

int32_t StudioCaptureStart(StudioCapture *capture) {
    return StudioCaptureStartAt(capture, 0, 0);
}

int32_t StudioCaptureStartAt(StudioCapture *capture, uint64_t hostTime, double rate) {
    if (!capture || atomic_load(&capture->active) || atomic_load(&capture->writing)) return audioUnavailable;
    capture->startHostTime = hostTime;
    capture->rate = rate;
    atomic_store_explicit(&capture->read, 0, memory_order_relaxed);
    atomic_store_explicit(&capture->written, 0, memory_order_relaxed);
    atomic_store_explicit(&capture->firstHostTime, 0, memory_order_relaxed);
    atomic_store_explicit(&capture->endHostTime, 0, memory_order_relaxed);
    atomic_store_explicit(&capture->overflowed, false, memory_order_relaxed);
    atomic_store(&capture->active, true);
    return noErr;
}

void StudioCaptureEnd(StudioCapture *capture) {
    if (capture) atomic_store(&capture->active, false);
}

int32_t StudioCaptureIsWriting(const StudioCapture *capture) {
    return capture && atomic_load(&capture->writing);
}

int32_t StudioCaptureOverflowed(const StudioCapture *capture) {
    return capture && atomic_load(&capture->overflowed);
}

uint64_t StudioCaptureFrames(const StudioCapture *capture) {
    return capture ? atomic_load_explicit(&capture->written, memory_order_acquire) : 0;
}

uint64_t StudioCaptureFirstHostTime(const StudioCapture *capture) {
    return capture ? atomic_load_explicit(&capture->firstHostTime, memory_order_relaxed) : 0;
}

uint64_t StudioCaptureEndHostTime(const StudioCapture *capture) {
    return capture ? atomic_load_explicit(&capture->endHostTime, memory_order_relaxed) : 0;
}

uint32_t StudioCaptureRead(StudioCapture *capture, float *samples, uint32_t frames) {
    if (!capture || !samples) return 0;
    uint64_t read = atomic_load_explicit(&capture->read, memory_order_relaxed);
    uint64_t written = StudioCaptureFrames(capture);
    if (frames > written - read) frames = (uint32_t)(written - read);
    uint32_t first = captureCapacity - (uint32_t)(read % captureCapacity);
    if (first > frames) first = frames;
    size_t stride = capture->channels * sizeof(float);
    memcpy(samples, captureFrame(capture, read), first * stride);
    memcpy(samples + first * capture->channels, capture->samples, (frames - first) * stride);
    atomic_store_explicit(&capture->read, read + frames, memory_order_release);
    return frames;
}

void StudioCaptureWriteStereo(StudioCapture *capture, const AudioBufferList *input) {
    StudioCaptureWriteStereoAt(capture, input, NULL);
}

void StudioCaptureWriteStereoAt(StudioCapture *capture, const AudioBufferList *input, const AudioTimeStamp *timestamp) {
    if (!capture || capture->channels != 2) return;
    AudioChannel left = channel(input, 0);
    AudioChannel right = channel(input, 1);
    uint32_t frames = left.frames < right.frames ? left.frames : right.frames;
    CaptureBlock block = {0};
    if (!reserveCapture(capture, frames, hostTime(timestamp), &block)) return;
    for (uint32_t frame = block.skip; frame < frames; ++frame) {
        float *sample = captureFrame(capture, block.position++);
        sample[0] = sampleAt(left, frame);
        sample[1] = sampleAt(right, frame);
    }
    commitCapture(capture, block.position);
}

double StudioAudioReadPitch(const StudioAudio *audio) {
    if (!audio) return 0;
    uint32_t count = atomic_load_explicit(&audio->pitchWritten, memory_order_acquire);
    if (count < pitchWindow + pitchLags) return 0;
    uint32_t rate = atomic_load_explicit(&audio->pitchRate, memory_order_relaxed);
    if (rate < 3000) return 0;
    float samples[pitchWindow + pitchLags];
    float energy = 0;
    for (unsigned index = 0; index < pitchWindow + pitchLags; ++index) {
        uint32_t position = (count - (pitchWindow + pitchLags) + index) % pitchSize;
        samples[index] = atomic_load_explicit(&audio->pitch[position], memory_order_relaxed) / 32767.0f;
        energy += samples[index] * samples[index];
    }
    if (energy < 0.000004f * (pitchWindow + pitchLags)) return 0;
    unsigned last = rate / 64;
    if (last >= pitchLags) last = pitchLags - 1;
    unsigned first = rate / 1200;
    float normalized[pitchLags] = {1};
    float sum = 0;
    for (unsigned lag = 1; lag <= last; ++lag) {
        float difference = 0;
        for (unsigned index = 0; index < pitchWindow; ++index) {
            float delta = samples[index] - samples[index + lag];
            difference += delta * delta;
        }
        sum += difference;
        normalized[lag] = sum > 0 ? difference * lag / sum : 1;
    }
    for (unsigned lag = first; lag < last; ++lag) {
        if (normalized[lag] > 0.20f || normalized[lag] >= normalized[lag + 1]) continue;
        float divisor = 2 * (normalized[lag - 1] + normalized[lag + 1] - 2 * normalized[lag]);
        double adjusted = lag + (divisor > 0.00001f ? (normalized[lag - 1] - normalized[lag + 1]) / divisor : 0);
        return rate / adjusted;
    }
    return 0;
}
