const knob = (label, initial, format) => ({label, initial, format: format ?? ((value) => `${value}%`)});
const mode = (label, first, last) => ({label, initial: 0, choices: [first, last]});
const sweepSpeed = (value) => `${(0.14 + 7.7 * (value / 100) ** 2).toFixed(2)} Hz`;
const delayTime = (value) => `${Math.round(45 + 2955 * (value / 100) ** 2)} ms`;
const wahPosition = (value, pedal) => pedal.extra?.[0] >= 75 ? `${value}%` :
  pedal.extra?.[0] >= 25 ? `${(0.6 + 0.024 * value).toFixed(1)} Hz · hız` : `${Math.round(300 * 8 ** (value / 100))} Hz`;
const echoFilter = (value) => value === 50 ? 'Düz' : `${value < 50 ? 'LP' : 'HP'} ${Math.abs(value - 50) * 2}%`;
const tremoloSpeed = (value, pedal) => `${((0.55 + value * 0.1) / (pedal.extra?.[2] >= 50 ? 2 : 1)).toFixed(2)} Hz`;
const pedalTypes = new Map([
  [5, {name: 'EHX Germanium OD', controls: [knob('Gain', 29), knob('Bias', 48), knob('Volts', 85, (value) => `${(4 + value / 20).toFixed(1)} V`)], info: 'Asimetrik kırpma. Bias kırılmanın şeklini, Volts simüle edilen pil gerilimini ve temiz ses payını değiştirir.'}],
  [6, {name: 'Ibanez TS9', controls: [knob('Drive', 28), knob('Tone', 48), knob('Level', 58)], info: 'Basları sıkılaştıran ve orta frekansları öne çıkaran overdrive. Düşük Drive ile solo yükseltmeyi dene.'}],
  [7, {name: 'Suhr Koji Comp', controls: [knob('Comp', 38), knob('Attack', 14, (value) => `${Math.round(1 + value * 0.99)} ms`), knob('Mix', 62), knob('Level', 55)], info: 'Paralel kompresyon. Mix, sıkıştırılmış sesi temiz sinyalle karıştırır. Attack pena vuruşunun ne kadarını koruduğunu ayarlar.'}],
  [8, {name: 'King Vox-Wah', controls: [{...knob('Konum / hız / hassasiyet', 46, wahPosition), kind: 'wah'}, {label: 'Kontrol', choices: ['Manuel', 'Döngü', 'Otomatik'], initial: 100}], info: 'Otomatik modda pena vuruşu wah’ı açıp kapatır. Döngü modunda filtre sürekli süpürür. Manuel modda konumu elle ayarlarsın.'}],
  [9, {name: 'MXR M101 Phase 90', controls: [knob('Speed', 31, sweepSpeed)], info: 'Dört aşamalı phaser. Speed, faz süpürmesinin hızını ayarlar.'}],
  [10, {name: 'Dunlop UV-1 Uni-Vibe', controls: [knob('Speed', 32, sweepSpeed), knob('Intensity', 62), mode('Mod', 'Chorus', 'Vibrato'), knob('Volume', 57)], info: 'Dönen hoparlör hissi veren, farklı frekanslarda hareket eden dört faz katı. Chorus temiz sesi karıştırır, Vibrato efektli sesi verir.'}],
  [11, {name: 'EHX Stereo Memory Man with Hazarai', controls: [knob('Blend', 28), knob('Delay', 30, delayTime), knob('Repeats', 32), knob('Filter', 50, echoFilter)], info: 'Stereo Echo modu, 3 saniyeye kadar. Filter merkezde düz, solda tiz keser, sağda bas keser. Tap Tempo için iki kez bas.'}],
  [12, {name: 'Fulltone Supa-Trem ST-1', controls: [knob('Mix', 48), knob('Speed', 33, tremoloSpeed), mode('Dalga', 'Soft', 'Hard'), mode('Hız aralığı', 'Normal', 'Yarım hız')], info: 'Optik tremolo karakteri. Soft yumuşak dalga, Hard kesik vuruşlar üretir. Yarım hız temposunu ikiye böler.'}],
  [1, {name: 'Overdrive', controls: [knob('Sürüş', 34)], info: 'Sinyali yumuşak biçimde kırpar.'}],
  [2, {name: 'Chorus', controls: [knob('Miks', 40)], info: 'Sinyale hafifçe dalgalanan kısa bir kopya ekler.'}],
  [3, {name: 'Tremolo', controls: [knob('Derinlik', 52)], info: 'Ses seviyesini saniyede yaklaşık 4,5 kez dalgalandırır.'}],
  [4, {name: 'Delay', controls: [knob('Miks', 36)], info: 'Yaklaşık 320 ms aralıkla tekrar ekler.'}]
]);
const mutlugilSet = [8, 7, 5, 6, 9, 10, 12, 11];
