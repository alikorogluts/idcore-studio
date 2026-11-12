const AmpProtocol = (() => {
  const voices = ['Clean Warm', 'Clean Bright', 'Crunch', 'Super Crunch', 'OD1', 'OD2'];
  const toneControls = [
    [2, 'Gain', 'Ön katın kırılma miktarını ayarlar.'],
    [3, 'Amfi Volume', 'Amfinin doğrudan gitar sesini ayarlar. USB pedal dönüşünün seviyesi pedal panosundadır.'],
    [4, 'Bas', 'Alt frekansları ayarlar.'], [5, 'Orta', 'Akorların ve soloların orta frekanslarını ayarlar.'],
    [6, 'Tiz', 'Üst frekansları ayarlar.'], [7, 'ISF', 'Blackstar’ın EQ karakterini değiştirir.'],
    [11, 'Resonance', 'Alt frekansların gövdesini ayarlar.'], [12, 'Presence', 'Üst frekansların açıklığını ayarlar.']
  ];
  const effects = [
    {name: 'Modülasyon', toggle: 15, type: 18, types: ['Phaser', 'Chorus / Flanger', 'Envelope', 'Tremolo'],
      controls: [[19, 'Parametre 1', 31], [20, 'Parametre 2'], [21, 'Parametre 3'], [22, 'Hız']]},
    {name: 'Delay', toggle: 16, type: 23, types: ['Linear', 'Analogue', 'Tape', 'Multi'], controls: [[26, 'Seviye'], [24, 'Geri besleme', 31], [28, 'Süre']]},
    {name: 'Reverb', toggle: 17, type: 29, types: ['Room', 'Hall', 'Spring', 'Plate'], controls: [[32, 'Seviye'], [30, 'Boyut', 31]]},
    {name: 'Noise Gate', toggle: 40, controls: [[39, 'Miktar'], [38, 'Hassasiyet']]}
  ];
  const switches = new Set([15, 16, 17]);
  const pairedParameters = new Map([[18, 19], [23, 24], [29, 30]]);

  function packet(...bytes) {
    const report = new Uint8Array(64);
    report.set(bytes);
    return report;
  }

  function decode(bytes) {
    const [kind, parameter, slot, context, value, second] = bytes;
    if (kind === 7 && bytes.length >= 7) return {type: 'firmware', version: bytes.slice(4, 7).join('.')};
    if (kind === 2 && parameter === 6) {
      if (slot >= 1 && slot <= 6) return {type: 'slot', slot, startup: context === 60};
      // A startup reply with slot zero and no patch data means that the amp is in Manual mode.
      if (slot === 0 && context === 60 && bytes.length === 64 && bytes.slice(4).every((byte) => byte === 0)) {
        return {type: 'startup-manual'};
      }
    }
    if (kind !== 3 || bytes.length < 5) return null;
    if (context === 42 && bytes.length >= 44 && bytes[5] <= 127 && bytes[6] <= 127) return {type: 'state', bytes};
    if (parameter === 1 && context === 40) return {type: 'manual', value};
    if (parameter === 1 && context === 41 && value < 6) return {type: 'patch', slot: value + 1};
    if (![1, 2].includes(context)) return null;
    const reading = switches.has(parameter) && context === 1 ? second : value;
    const values = [[parameter, reading]];
    if (context === 2 && pairedParameters.has(parameter)) values.push([pairedParameters.get(parameter), second]);
    return {type: 'values', values};
  }

  return {
    voices, toneControls, effects, decode,
    readState: () => packet(0x81, 0, 0, 4, 3, 6, 2, 0x7a),
    readStartup: () => packet(7),
    setParameter: (parameter, value) => packet(3, parameter, 0, 1, value),
    loadSlot: (slot) => packet(2, 1, slot)
  };
})();
