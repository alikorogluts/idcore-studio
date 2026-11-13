import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const script = (name) => readFileSync(new URL(`../Resources/studio-assets/${name}.js`, import.meta.url), 'utf8');
const {songAlbums, toneEQParameters, stratPickups, stratEQ, voices, pedalTypes} = runInNewContext(
  ['duman-tonlari', 'amp-protocol', 'pedal-models'].map(script).join('\n') +
  '\n({songAlbums, toneEQParameters, stratPickups, stratEQ, voices: AmpProtocol.voices, pedalTypes})'
);

const keys = new Set();
const songs = new Map();
for (const album of songAlbums) {
  for (const tone of album.tones) {
    assert(!keys.has(tone.key), tone.key);
    keys.add(tone.key);
    assert.match(tone.video, /^[A-Za-z0-9_-]{11}$/);
    assert(voices.includes(tone.voice), tone.key);
    assert(stratPickups[tone.pickup - 1], tone.key);
    assert.equal(Object.keys(tone.eq).join(','), toneEQParameters.join(','));
    for (const guitar of ['sss', 'hss']) {
      assert(Object.values(stratEQ(tone, guitar)).every((value) => Number.isInteger(value) && value >= 0 && value <= 127), tone.key);
    }
    const pedalIds = new Set();
    for (const [type, ...values] of tone.chain) {
      assert(!pedalIds.has(type), tone.key);
      pedalIds.add(type);
      assert.equal(values.length, pedalTypes.get(type).controls.length, tone.key);
      assert(values.every((value) => Number.isInteger(value) && value >= 0 && value <= 100), tone.key);
    }
    const sections = songs.get(tone.title) ?? [];
    sections.push(tone);
    songs.set(tone.title, sections);
  }
}
assert.deepEqual(Array.from(songAlbums, ({tones}) => new Set(tones.map(({title}) => title)).size), [10, 13, 12, 10, 10, 13, 16]);
for (const [title, sections] of songs) {
  assert.equal(new Set(sections.map(({section}) => section)).size, sections.length, title);
  assert.equal(new Set(sections.map(({video}) => video)).size, 1, title);
}
const yanibasimdan = songs.get('Yanıbaşımdan');
assert.deepEqual(yanibasimdan.map(({pickup}) => pickup), [4, 1]);
assert.equal(stratEQ(yanibasimdan[0], 'hss'), yanibasimdan[0].eq);
assert.notEqual(stratEQ(yanibasimdan[1], 'hss')[4], yanibasimdan[1].eq[4]);
console.log(`${songs.size} songs and ${keys.size} unique tones verified across seven studio albums.`);
