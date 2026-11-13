import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source = readFileSync(new URL('../Resources/studio-assets/tone-comparison.js', import.meta.url), 'utf8');
const {matchedGains} = runInNewContext(source + '\nToneComparison');

function track(channels, sampleRate = 1000) {
  return {sampleRate, length: channels[0].length, numberOfChannels: channels.length, getChannelData: (index) => channels[index]};
}

const quiet = track([new Float32Array(1000).fill(0.2)]);
const loudSamples = new Float32Array(1000);
loudSamples.fill(0.8, 500);
const loud = track([loudSamples, loudSamples]);
const [a, b] = matchedGains([quiet, loud], [0, 0], 1);
assert.equal(a, 1);
assert(Math.abs(b - 0.25) < 0.00001);
assert.equal(matchedGains([quiet, loud], [0, 0], 0.4), null);
const [c, d] = matchedGains([quiet, loud], [0, 0.5], 0.5);
assert.equal(c, 1);
assert(Math.abs(d - 0.25) < 0.00001);
assert(matchedGains([track([new Float32Array(500).fill(1)]), loud], [0, 0.5], 0.5)[0] <= 0.85);
console.log('A/B matching handles stereo and mono, silence, offsets and peak headroom.');
