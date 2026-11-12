#include "../Sources/StudioAudio.c"

#include <assert.h>
#include <stdio.h>
#include <unistd.h>

static Rig stage(unsigned type, Controls controls) {
    return (Rig){.stages = {{type, controls}}, .count = 1};
}

static void checkEffects(void) {
    const Controls settings[] = {{.7,.5,.7,.5}, {.55,.5,.65,.5}, {.65,.12,.7,.55}, {.4,0,0,0},
                                 {.5,0,0,0}, {.5,.6,0,.58}, {.6,.11,.6,.55}, {.6,.5,1,0}};
    for (unsigned type = 5; type <= 12; ++type) {
        StudioAudio *audio = StudioAudioCreate();
        audio->rate = 48000;
        Rig rig = stage(type, settings[type - 5]);
        double delta = 0;
        double stereo = 0;
        for (unsigned frame = 0; frame < 48000; ++frame) {
            float sample = .24f * sin(2 * M_PI * 110 * frame / audio->rate) + .10f * sin(2 * M_PI * 820 * frame / audio->rate);
            Signal result = processSample(audio, sample, 0, &rig);
            assert(isfinite(result.left) && isfinite(result.right) && fabsf(result.left) <= 1 && fabsf(result.right) <= 1);
            delta += fabsf(result.left - sample);
            stereo += fabsf(result.left - result.right);
        }
        assert(delta / 48000 > 0.008);
        if (type == 11) assert(stereo / 48000 > 0.02);
        StudioAudioDestroy(audio);
    }
}

static void checkPitch(double frequency) {
    StudioAudio *audio = StudioAudioCreate();
    audio->rate = 48000;
    audio->pitchDecimation = (unsigned)ceil(audio->rate / pitchSampleRate);
    atomic_store(&audio->pitchRate, (uint32_t)lround(audio->rate / audio->pitchDecimation));
    assert(StudioAudioReadPitch(audio) == 0);
    for (unsigned frame = 0; frame < 16000; ++frame) {
        double phase = 2 * M_PI * frequency * frame / audio->rate;
        capturePitch(audio, .1f * sin(phase) + .15f * sin(phase * 2) + .06f * sin(phase * 3));
    }
    double result = StudioAudioReadPitch(audio);
    printf("Pitch %.2f Hz measured %.2f Hz\n", frequency, result);
    assert(result > 0 && fabs(1200 * log2(result / frequency)) < 3);
    for (unsigned frame = 0; frame < 12000; ++frame) capturePitch(audio, 0);
    assert(StudioAudioReadPitch(audio) == 0);
    StudioAudioDestroy(audio);
}

static void checkWah(void) {
    StudioAudio *audio = StudioAudioCreate();
    audio->rate = 48000;
    audio->wah.position = 0.2f;
    Rig rig = stage(8, (Controls){.2f, 0, 0, 0});
    double low = 0, high = 0;
    for (unsigned frame = 0; frame < 4800; ++frame) {
        const float sample = .1f * sin(2 * M_PI * 490 * frame / audio->rate);
        low += fabsf(processSample(audio, sample, 0, &rig).left);
    }
    rig.stages[0].control.first = .9f;
    for (unsigned frame = 0; frame < 4800; ++frame) {
        const float sample = .1f * sin(2 * M_PI * 490 * frame / audio->rate);
        const float level = fabsf(processSample(audio, sample, 0, &rig).left);
        if (frame > 600) high += level;
    }
    assert(low > high * 2.0 && audio->wah.position > .88f);
    rig.stages[0].control = (Controls){.6f, 1, 0, 0};
    for (unsigned frame = 0; frame < 14400; ++frame) processSample(audio, 0, 0, &rig);
    const float closed = audio->wah.position;
    for (unsigned frame = 0; frame < 2400; ++frame) {
        float pick = .004f * sin(2 * M_PI * 196 * frame / audio->rate);
        processSample(audio, .15f * sin(2 * M_PI * 490 * frame / audio->rate), pick, &rig);
    }
    assert(closed < .25f && audio->wah.position > closed + .45f);
    for (unsigned frame = 0; frame < 20000; ++frame) {
        processSample(audio, .3f, .0002f, &rig);
    }
    assert(audio->wah.position < .10f);
    rig.stages[0].control = (Controls){.5f, .5f, 0, 0};
    float lowest = 1, highest = 0;
    for (unsigned frame = 0; frame < 48000; ++frame) {
        processSample(audio, .12f * sin(2 * M_PI * 490 * frame / audio->rate), 0, &rig);
        lowest = fminf(lowest, audio->wah.position);
        highest = fmaxf(highest, audio->wah.position);
    }
    assert(lowest < .1f && highest > .9f);
    StudioAudioDestroy(audio);
    puts("Manual, dry-pick auto wah and continuous sweep passed");
}

static double levelFor(StudioAudio *audio, float amount) {
    enum { frames = 256, blocks = 350 };
    float input[frames * 4] = {0};
    float output[frames * 2] = {0};
    AudioBufferList inputs = {1, {{4, sizeof(input), input}}};
    AudioBufferList outputs = {1, {{2, sizeof(output), output}}};
    for (unsigned block = 0; block < blocks; ++block) {
        for (unsigned frame = 0; frame < frames; ++frame) {
            double phase = 2 * M_PI * 110 * (block * frames + frame) / audio->rate;
            float pluck = sin(phase);
            input[frame * 4 + preampChannel] = amount * pluck;
            input[frame * 4 + dryChannel] = .008f * pluck;
        }
        renderAudio(0, NULL, &inputs, NULL, &outputs, NULL, audio);
        for (unsigned sample = 0; sample < frames * 2; ++sample) assert(fabsf(output[sample]) <= .60001f);
    }
    double energy = 0;
    for (unsigned sample = 0; sample < frames * 2; ++sample) energy += output[sample] * output[sample];
    return sqrt(energy / (frames * 2));
}

static void checkLevelMatching(void) {
    StudioAudio *audio = StudioAudioCreate();
    audio->rate = 48000;
    audio->pitchDecimation = 3;
    StudioAudioSetLevel(audio, 100);
    double clean = levelFor(audio, .009f);
    assert(StudioAudioLevelMatchPermille(audio) > 7000);
    double drive = levelFor(audio, .10f);
    assert(StudioAudioLevelMatchPermille(audio) < 900);
    assert(fabs(20 * log10(clean / drive)) < 2);
    StudioAudioSetLevelMatching(audio, 0);
    double dryClean = levelFor(audio, .009f);
    double dryDrive = levelFor(audio, .10f);
    assert(20 * log10(dryDrive / dryClean) > 18);
    StudioAudioSetLevelMatching(audio, 1);
    double silent = levelFor(audio, 0);
    assert(silent == 0 && StudioAudioLevelMatchPermille(audio) < 1100);
    StudioAudioDestroy(audio);
    printf("Clean/drive mismatch %.1f dB before balancing, %.1f dB after\n",
           20 * log10(dryDrive / dryClean), 20 * log10(drive / clean));
}

static void checkMacHardware(void) {
    StudioAudio *audio = StudioAudioCreate();
    int32_t probe = StudioAudioProbe();
    if (probe != noErr) {
        printf("Hardware test skipped: Blackstar probe %d\n", probe);
        StudioAudioDestroy(audio);
        return;
    }
    StudioAudioSetLevel(audio, 0);
    for (unsigned attempt = 0; attempt < 2; ++attempt) {
        assert(StudioAudioStart(audio) == noErr);
        assert(StudioAudioCheckOutput(audio) == noErr);
        const uint32_t rate = StudioAudioSampleRate(audio);
        StudioCapture *recording = StudioAudioCapture(audio);
        assert(rate >= 44100);
        assert(StudioAudioBeginRecording(audio) == noErr);
        assert(StudioAudioBeginRecording(audio) != noErr);
        usleep(400000);
        StudioAudioStop(audio);
        const uint64_t frames = StudioCaptureFrames(recording);
        float samples[256 * StudioRecordingChannels];
        assert(frames > 0 && StudioCaptureRead(recording, samples, 256) > 0);
        assert(!StudioCaptureIsWriting(recording) && StudioAudioOutputLevel(audio) == 0);
        printf("Blackstar USB at zero monitor volume: %llu frames at %u Hz\n", (unsigned long long)frames, rate);
    }
    StudioAudioDestroy(audio);
}

static void checkStreamingCapture(void) {
    enum { block = 512, iterations = 1100 };
    StudioCapture *capture = StudioCaptureCreate(2);
    float input[block * 2], output[block * 2];
    AudioBufferList buffers = {1, {{2, sizeof(input), input}}};
    assert(capture && StudioCaptureStart(capture) == 0);
    for (unsigned batch = 0; batch < iterations; ++batch) {
        for (unsigned i = 0; i < block * 2; ++i) input[i] = (float)(batch % 31) / 32;
        StudioCaptureWriteStereo(capture, &buffers);
        assert(StudioCaptureRead(capture, output, block) == block);
        assert(memcmp(input, output, sizeof(input)) == 0);
    }
    assert(StudioCaptureFrames(capture) == block * iterations);
    assert(StudioCaptureOverflowed(capture) == 0);
    StudioCaptureEnd(capture);
    StudioCaptureWriteStereo(capture, &buffers);
    assert(StudioCaptureRead(capture, output, block) == 0);
    assert(StudioCaptureStart(capture) == 0);
    for (unsigned batch = 0; batch <= captureCapacity / block; ++batch) StudioCaptureWriteStereo(capture, &buffers);
    assert(StudioCaptureOverflowed(capture) && StudioCaptureFrames(capture) == captureCapacity);
    StudioCaptureDestroy(capture);
    puts("Streaming stereo capture: over 11 seconds with exact samples and clean stop");
}

int main(void) {
    StudioAudio *audio = StudioAudioCreate();
    assert(audio);
    audio->rate = 48000;
    Rig bypass = {0};
    assert(processSample(audio, 0.1f, 0, &bypass).left == 0.1f);
    Rig overdrive = stage(1, (Controls){.8,0,0,0});
    float driven = 0;
    for (size_t frame = 0; frame < 1000; ++frame) driven = processSample(audio, 0.1f, 0, &overdrive).left;
    assert(driven > 0.3f && driven < 1.0f);
    Rig tremolo = stage(3, (Controls){.8,0,0,0});
    audio->phase[2] = 1.5 * M_PI;
    assert(fabsf(processSample(audio, 0.1f, 0, &tremolo).left - 0.02f) < 0.001f);
    Rig chorus = stage(2, (Controls){.8,0,0,0});
    float wet = processSample(audio, 0.8f, 0, &chorus).left;
    assert(wet < 0.8f && wet > 0.3f);
    Rig delay = stage(4, (Controls){.8,0,0,0});
    processSample(audio, 0.7f, 0, &delay);
    for (size_t frame = 1; frame < 15360; ++frame) processSample(audio, 0, 0, &delay);
    assert(processSample(audio, 0, 0, &delay).left > 0.4f);
    uint32_t packed[StudioPedalCount] = {0};
    packed[11] = 1 | (65 << 1) | (40 << 8) | (100 << 15) | (100 << 22);
    StudioAudioSetRig(audio, 12 | (9 << 4), packed);
    Rig loaded = readRig(audio);
    assert(loaded.count == 1 && loaded.stages[0].type == 12 && loaded.stages[0].control.fourth == 1);
    StudioAudioSetRig(audio, 0, packed);
    float inputFrames[] = {0.99f, 0.98f, 0.20f, 0.02f, 0.99f, 0.98f, 0.40f, 0.04f};
    float outputFrames[8] = {0};
    AudioBufferList input = {1, {{4, sizeof(inputFrames), inputFrames}}};
    AudioBufferList output = {1, {{4, sizeof(outputFrames), outputFrames}}};
    StudioAudioSetLevel(audio, 100);
    audio->gain = 0.32f;
    StudioCapture *recording = StudioAudioCapture(audio);
    assert(StudioCaptureStart(recording) == 0);
    renderAudio(0, NULL, &input, NULL, &output, NULL, audio);
    float tracks[8] = {0};
    assert(StudioCaptureFrames(recording) == 2 && StudioCaptureRead(recording, tracks, 2) == 2);
    assert(tracks[0] == 0.02f && tracks[1] == 0.20f);
    assert(fabsf(tracks[2] - .15f) < .0001f && tracks[2] == tracks[3]);
    assert(tracks[4] == 0.04f && tracks[5] == 0.40f);
    StudioCaptureEnd(recording);
    assert(fabsf(outputFrames[0] - 0.06405f) < 0.0001f && outputFrames[0] == outputFrames[1]);
    assert(fabsf(outputFrames[4] - 0.12819f) < 0.0001f && outputFrames[4] == outputFrames[5]);
    assert(outputFrames[2] == 0 && outputFrames[3] == 0 && outputFrames[6] == 0 && outputFrames[7] == 0);
    assert(StudioAudioInputLevel(audio) > 0);
    StudioAudioDestroy(audio);
    checkEffects();
    const double guitar[] = {73.42, 82.41, 110, 146.83, 196, 246.94, 329.63};
    for (unsigned index = 0; index < sizeof(guitar) / sizeof(guitar[0]); ++index) {
        checkPitch(guitar[index]);
        checkPitch(2 * guitar[index]);
    }
    checkWah();
    checkLevelMatching();
    puts("DSP and isolated channel routing passed");
    checkStreamingCapture();
    checkMacHardware();
    return 0;
}
