#ifndef STUDIO_AUDIO_H
#define STUDIO_AUDIO_H

#include <stdint.h>
#include <CoreAudio/CoreAudio.h>

typedef struct StudioAudio StudioAudio;
typedef struct StudioCapture StudioCapture;
enum { StudioPedalCount = 12 };
enum { StudioRecordingChannels = 4 };

StudioAudio *StudioAudioCreate(void);
void StudioAudioDestroy(StudioAudio *audio);
int32_t StudioAudioProbe(void);
int32_t StudioAudioStart(StudioAudio *audio);
void StudioAudioStop(StudioAudio *audio);
int32_t StudioAudioCheckOutput(const StudioAudio *audio);
void StudioAudioSetRig(StudioAudio *audio, uint64_t order, const uint32_t *controls);
void StudioAudioSetLevel(StudioAudio *audio, uint32_t level);
void StudioAudioTestUSB(StudioAudio *audio);
void StudioAudioSetLevelMatching(StudioAudio *audio, int32_t enabled);
uint32_t StudioAudioLevelMatchPermille(const StudioAudio *audio);
uint32_t StudioAudioWahHz(const StudioAudio *audio);
uint32_t StudioAudioInputLevel(const StudioAudio *audio);
uint32_t StudioAudioOutputLevel(const StudioAudio *audio);
double StudioAudioReadPitch(const StudioAudio *audio);
int32_t StudioAudioBeginRecording(StudioAudio *audio);
uint32_t StudioAudioSampleRate(const StudioAudio *audio);
StudioCapture *StudioAudioCapture(StudioAudio *audio);
StudioCapture *StudioCaptureCreate(uint32_t channels);
void StudioCaptureDestroy(StudioCapture *capture);
int32_t StudioCaptureStart(StudioCapture *capture);
void StudioCaptureEnd(StudioCapture *capture);
int32_t StudioCaptureIsWriting(const StudioCapture *capture);
int32_t StudioCaptureOverflowed(const StudioCapture *capture);
uint64_t StudioCaptureFrames(const StudioCapture *capture);
uint32_t StudioCaptureRead(StudioCapture *capture, float *samples, uint32_t frames);
void StudioCaptureWriteStereo(StudioCapture *capture, const AudioBufferList *input);

#endif
