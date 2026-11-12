import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source = readFileSync(new URL('../Resources/studio-assets/guitar-tuner.js', import.meta.url), 'utf8');

class Element {
  constructor() {
    this.attributes = {};
    this.dataset = {};
    this.style = {setProperty() {}};
    this.children = [];
    this.listeners = {};
    this.textContent = '';
  }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(key, callback) { this.listeners[key] = callback; }
  append(child) { this.children.push(child); }
  click() { if (!this.disabled) this.listeners.click(); }
}

const elements = new Map();
const root = new Element();
root.querySelector = (key) => {
  if (!elements.has(key)) elements.set(key, new Element());
  return elements.get(key);
};
const element = (key) => root.querySelector('#tuner-' + key);
element('tuning').value = 'standard';

const GuitarTuner = runInNewContext(source + '\nGuitarTuner', {
  document: {createElement: () => new Element()}
});
const {targets, hz, detectString, centsBetween} = GuitarTuner;
assert.equal(targets('standard').join(','), '40,45,50,55,59,64');
assert.equal(targets('drop-d').join(','), '38,45,50,55,59,64');
assert.equal(detectString(64, 'standard'), 1);
assert.equal(detectString(38, 'drop-d'), 6);
assert.equal(detectString(52, 'standard'), null);
assert.equal(Math.round(centsBetween(hz(64), hz(52))), 1200);

const tuner = GuitarTuner.mount(root);
const [lowE] = element('strings').children;
assert.match(lowE.textContent, /6 · E2 · Mi/);
assert.match(element('instruction').textContent, /Sanal pedalları aç/);
tuner.setRunning(true);
tuner.update(hz(40));
assert.equal(lowE.dataset.detected, true);
assert.match(element('instruction').textContent, /6\. tel.*Akortta/);
element('intonation').click();
assert.match(lowE.textContent, /6 · E3/);

const measure = (frequency) => [1, 2, 3].forEach(() => tuner.update(frequency));
measure(hz(40));
assert.equal(element('capture').disabled, true, 'reject open string in octave check');
measure(hz(52));
assert.equal(element('capture').disabled, false);
element('capture').click();
assert.match(element('instruction').textContent, /Teli sustur/);
measure(hz(52));
assert.equal(element('capture').disabled, true, 'require silence before next capture');
tuner.update(0);
measure(hz(52.12));
element('capture').click();
assert.match(element('result').textContent, /\+12 cent.*saptan uzağa/);
assert.equal(element('capture').disabled, true);
element('reset').click();
measure(hz(52));
element('capture').click();
tuner.update(0);
measure(hz(51.91));
element('capture').click();
assert.match(element('result').textContent, /-9 cent.*sapa yaklaştır/);
element('tuning').value = 'drop-d';
element('tuning').listeners.change();
assert.match(lowE.textContent, /6 · D3 · Re/);
assert.equal(element('capture').disabled, true);
console.log('Tuner targets, pitch stability, octave check, release and sharp/flat intonation verified.');
