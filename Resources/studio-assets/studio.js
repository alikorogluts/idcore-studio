  const usbIds = {vendorId: 0x27d4, productId: 0x0013};
  const {voices, toneControls, effects} = AmpProtocol;
  const demos = [
    ['Classic Clean', 0, 27, 70, 65, 78, 45], ['Boutique Clean', 1, 39, 62, 71, 85, 75],
    ['Classic Crunch', 2, 58, 76, 80, 59, 65], ['Modern Drive', 3, 76, 77, 55, 68, 46],
    ['Smooth Solo', 4, 86, 70, 90, 61, 80], ['Tight Metal Rhythm', 5, 110, 76, 42, 80, 36]
  ];
  const byId = (id) => document.getElementById(id);
  const paramViews = new Map();
  const ampValues = new Map();
  const demoValues = new Map([[1, 3], [2, 61], [3, 38], [4, 84], [5, 54], [6, 58], [7, 78], [11, 89], [12, 64], [15, 0], [16, 0], [17, 1], [18, 0], [19, 15], [20, 64], [21, 55], [22, 64], [23, 0], [24, 12], [26, 30], [28, 40], [29, 0], [30, 16], [32, 34], [38, 64], [39, 40], [40, 1]]);
  const songTones = new Map(songAlbums.flatMap(({tones}) => tones.map((tone) => [tone.key, tone])));
  const tuner = GuitarTuner.mount(byId('tuner'));
  const settingsKey = 'studio.virtualRig';
  let presetNames = demos.map(([name]) => name);
  let personalPedals = [{type: 1, amount: 34, enabled: true}, {type: 4, amount: 36, enabled: false}];
  let virtualPedals = personalPedals;
  let selectedSong = '';
  let autoSongVoice = false;
  let songVoiceRequest = '';
  let balanceLevels = true;
  let audioMeters = {input: 0, matchPermille: 1000, wahHz: 0};
  let settingsLoaded = false;
  let settingsWrite = Promise.resolve();
  let previewFrame = null;
  let previewQueued = false;
  let renamingSlot = null;
  let audioRunning = false;
  let audioPending = false;
  let audioMessage = '';
  let directPending = false;
  let directMessage = '';
  let recording = {active: false, folder: '', seconds: 0, hasSaved: false, supportsMac: false};
  let recordingBusy = false;
  let recordingMessage = '';
  let recordingTimer = null;
  let ampFeedback = '';
  const usbEvents = [];
  let meterTimer = null;
  let session = null;
  let busy = false;
  let demoSlot = null;

  function element(tag, className, label) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (label) node.textContent = label;
    return node;
  }

  function setNotice(message) { byId('notice').textContent = message; }

  function setText(id, text) {
    const node = byId(id);
    if (node.textContent !== text) node.textContent = text;
  }

  function showView(id) {
    for (const button of viewButtons) {
      const selected = button.dataset.view === id;
      button.setAttribute('aria-current', String(selected));
      byId(button.dataset.view).hidden = !selected;
    }
    if (id !== 'pedals-view') tuner.suspend();
  }

  function addInfo(node, bar, message) {
    const defaultText = bar.dataset.defaultText ?? bar.textContent;
    bar.dataset.defaultText = defaultText;
    const show = () => {
      bar.textContent = message();
      bar.dataset.detail = 'true';
    };
    const hide = () => {
      bar.textContent = defaultText;
      delete bar.dataset.detail;
    };
    node.addEventListener('pointerenter', show);
    node.addEventListener('pointerleave', () => { if (!node.contains(document.activeElement)) hide(); });
    node.addEventListener('focusin', show);
    node.addEventListener('focusout', (event) => {
      if (!node.contains(event.relatedTarget) && !node.matches(':hover')) hide();
    });
    return show;
  }

  function resetPedalInfo() {
    const bar = byId('pedal-info');
    if (bar.dataset.defaultText) bar.textContent = bar.dataset.defaultText;
    delete bar.dataset.detail;
  }

  function newPedal(type, enabled) {
    const [first, ...rest] = pedalTypes.get(type).controls.map(({initial}) => initial);
    return {type, amount: first, enabled, extra: rest};
  }

  function renderListenTools() {
    const balance = byId('balance-status');
    const correction = Math.round(20 * Math.log10(audioMeters.matchPermille / 1000));
    const text = balanceLevels && audioRunning ? `${correction > 0 ? '+' : ''}${correction} dB telafi` : '';
    if (balance.textContent !== text) balance.textContent = text;
    const volume = ampValues.get(3);
    const direct = byId('direct-volume');
    const saved = session?.directBefore;
    const restore = volume === 0 && saved > 0;
    direct.disabled = !session?.ready || directPending || session.pendingWrites.has(3) || (volume === 0 && !restore) || volume === undefined;
    direct.textContent = restore ? 'Doğrudan sesi geri aç' : volume === 0 ? 'Doğrudan ses kısık' : 'Doğrudan sesi kıs';
    const directHelp = byId('direct-help');
    const help = directMessage || (restore
      ? (session.reconnectedMuted ? 'Önceki seviye saklandı. Geri aç düğmesiyle amfi sesini geri alabilirsin.' : 'Şu an amfiden USB pedal dönüşünü dinliyorsun. Geri aç ile önceki amfi sesine dön.')
      : volume === 0 ? 'Amfi sesini açmak için Amfi ve EQ bölümündeki Amfi Volume’u kullan.'
      : 'Sanal pedalları tek başına dinlemek için amfinin doğrudan sesini kıs.');
    if (directHelp.textContent !== help) directHelp.textContent = help;
    byId('usb-test').disabled = !audioRunning || audioPending;
    const latency = byId('audio-latency');
    latency.hidden = !audioRunning || !audioMeters.bufferFrames;
    const measured = audioMeters.latencyMicros ? ` · USB giriş–çıkış tahmini ${(audioMeters.latencyMicros / 1000).toFixed(1)} ms` : '';
    const latencyText = audioMeters.bufferFrames ? `Ses bloğu ${audioMeters.bufferFrames} örnek${measured}` : '';
    if (latency.textContent !== latencyText) latency.textContent = latencyText;
    const readout = byId('wah-live');
    if (readout) {
      const frequency = audioRunning && virtualPedals.some(({type, enabled}) => type === 8 && enabled) ? audioMeters.wahHz : 0;
      readout.hidden = !frequency;
      if (frequency) readout.textContent = `${frequency} Hz`;
    }
  }

  function selectSong(key) {
    const tone = songTones.get(key);
    selectedSong = tone ? key : '';
    songVoiceRequest = autoSongVoice ? selectedSong : '';
    virtualPedals = tone ? tone.chain.map(([type, amount, ...extra]) => ({type, amount, enabled: true, extra})) : personalPedals;
    const listen = byId('song-listen');
    listen.hidden = !tone;
    if (tone) {
      const recording = new URL('https://music.youtube.com/watch');
      recording.searchParams.set('v', tone.video);
      listen.href = recording.href;
      listen.setAttribute('aria-label', `${tone.title} kaydını YouTube Music’te aç`);
    } else {
      listen.removeAttribute('href');
      listen.removeAttribute('aria-label');
    }
    byId('song-hint').textContent = tone ? tone.hint : 'Şarkıyı ve çalacağın bölümü seç. Pedallar otomatik yüklenir. Amfinin altı yuvası ayrı seçilir.';
    render();
    renderPedals();
    applyPendingSongVoice();
    return saveSettings(false);
  }

  function applySongVoice() {
    const voice = voices.indexOf(songTones.get(selectedSong)?.voice);
    if (voice < 0 || !session?.ready || busy || session.mode !== 'manual') return false;
    const current = session.pendingWrites.get(1)?.value ?? ampValues.get(1);
    if (current !== voice) edit(1, voice, {manualOnly: true});
    return true;
  }

  function applyPendingSongVoice() {
    if (songVoiceRequest && songVoiceRequest === selectedSong && applySongVoice()) songVoiceRequest = '';
  }

  function renderSongVoice(tone, live) {
    const voice = voices.indexOf(tone.voice);
    const pending = live && session.pendingWrites.has(1);
    const current = live ? (session.mode === 'patch' && session.slot ? session.slot - 1 : ampValues.get(1)) : undefined;
    const matched = current === voice;
    const button = byId('song-apply-voice');
    button.disabled = !live || session.mode !== 'manual' || pending || matched;
    byId('song-voice').textContent = tone.voice;
    const prefix = current === undefined ? '' : `Şu an ${voices[current]}. `;
    let detail = 'Blackstar’daki VOICE düğmesinden bu modu seçebilir veya USB ile bağlanabilirsin.';
    if (live) {
      if (pending) detail = 'Voice ayarı amfiden doğrulanıyor…';
      else if (matched) detail = `${tone.voice} seçili.`;
      else if (session.mode !== 'manual') {
        const action = songVoiceRequest === selectedSong ? 'Otomatik seçim MANUAL ışığı yanınca uygulanır.' : 'MANUAL ışığı yanınca Voice’u uygula düğmesini kullan.';
        detail = `${prefix}MANUAL ışığı sönükse amfinin Volume’ünü düşük tutup MANUAL’a kısa bas. ${action}`;
      } else if (session.rejectedVoice === voice) {
        detail = `${prefix}Amfi değişikliği doğrulamadı. Tekrar dene veya VOICE düğmesini elle çevir.`;
      } else detail = `${prefix}Bu tonu amfiye uygulayabilirsin.`;
    }
    const status = byId('song-voice-status');
    if (status.textContent !== detail) status.textContent = detail;
  }

  function renderSong() {
    const tone = songTones.get(selectedSong);
    byId('song-details').hidden = !tone;
    if (!tone) return;
    byId('song-active').textContent = `${tone.title} · ${tone.section} · ${audioRunning ? 'Canlı pedal tonu' : 'Pedallar hazır'}`;
    const active = virtualPedals.filter(({enabled}) => enabled).map(({type}) => pedalTypes.get(type).name);
    byId('song-chain').textContent = active.length ? active.join(' → ') : 'Tüm pedallar bypass konumunda.';
    const button = byId('song-eq');
    const status = byId('song-eq-status');
    const eq = Object.entries(tone.eq ?? {});
    const live = session?.ready && !busy;
    renderSongVoice(tone, live);
    const pending = live && eq.some(([id]) => session.pendingWrites.has(Number(id)));
    const matching = live && eq.every(([id, value]) => ampValues.get(Number(id)) === value);
    button.hidden = status.hidden = !eq.length;
    button.disabled = !live || pending || matching;
    const message = !live ? 'EQ önerisini uygulamak için USB ile bağlan.' : pending ? 'EQ ayarları amfiden doğrulanıyor…' :
      matching ? 'Amfi EQ’su öneriyle eşleşiyor.' : 'Bu ton için isteğe bağlı amfi EQ önerisi var.';
    if (status.textContent !== message) status.textContent = message;
  }

  function addDial(group, input) {
    const face = element('span', 'dial-face');
    group.classList.add('dial');
    face.append(input);
    const position = () => {
      const span = Number(input.max) - Number(input.min);
      face.style.setProperty('--angle', `${-135 + 270 * (input.value - input.min) / span}deg`);
    };
    let drag;
    input.addEventListener('pointerdown', (event) => {
      if (input.disabled || !event.isPrimary || event.button !== 0) return;
      event.preventDefault();
      input.focus();
      input.setPointerCapture(event.pointerId);
      drag = {y: event.clientY, value: Number(input.value)};
      input.dataset.dragging = 'true';
    });
    input.addEventListener('pointermove', (event) => {
      if (!drag || !input.hasPointerCapture(event.pointerId)) return;
      const step = (input.max - input.min) / (event.shiftKey ? 380 : 140);
      const old = input.value;
      input.value = Math.round(drag.value + (drag.y - event.clientY) * step);
      if (input.value !== old) input.dispatchEvent(new Event('input'));
    });
    input.addEventListener('lostpointercapture', () => {
      if (!drag) return;
      const changed = Number(input.value) !== drag.value;
      drag = undefined;
      delete input.dataset.dragging;
      if (changed) input.dispatchEvent(new Event('change'));
    });
    input.addEventListener('input', position);
    position();
    group.append(face);
    return position;
  }

  function buildPedalControl(pedal, definition, control, index) {
    const group = element('label', 'control');
    const label = element('span', 'control-label');
    const current = index === 0 ? pedal.amount : pedal.extra[index - 1];
    const name = `${definition.name} ${control.label}`;
    const update = (next) => {
      if (index === 0) pedal.amount = next;
      else pedal.extra[index - 1] = next;
    };
    label.append(element('span', '', control.label));
    if (control.choices) {
      const select = element('select');
      const step = 100 / (control.choices.length - 1);
      control.choices.forEach((choice, choiceIndex) => select.add(new Option(choice, Math.round(choiceIndex * step))));
      select.value = Math.round(Math.round(current / step) * step);
      select.setAttribute('aria-label', name);
      select.addEventListener('change', () => { update(Number(select.value)); renderListenTools(); saveSettings(); });
      group.append(label, select);
      return group;
    }
    const display = (number) => control.format(number, pedal);
    const value = element('output', '', display(current));
    const slider = element('input');
    slider.type = 'range';
    slider.min = 0;
    slider.max = 100;
    slider.value = current;
    slider.setAttribute('aria-label', name);
    slider.addEventListener('input', () => {
      const next = Number(slider.value);
      update(next);
      value.textContent = display(next);
      slider.setAttribute('aria-valuetext', display(next));
      previewSettings();
    });
    slider.setAttribute('aria-valuetext', display(current));
    slider.addEventListener('change', () => { update(Number(slider.value)); saveSettings(); });
    label.append(value);
    group.append(label);
    if (control.kind === 'wah') {
      group.classList.add('wah-position');
      group.append(slider);
    } else addDial(group, slider);
    return group;
  }

  function renderPedals() {
    renderSong();
    renderListenTools();
    const picker = byId('pedal-type');
    const selected = picker.value;
    picker.replaceChildren();
    for (const [type, definition] of pedalTypes) {
      if (!virtualPedals.some((pedal) => pedal.type === type)) picker.add(new Option(definition.name, type));
    }
    if (Array.from(picker.options).some((option) => option.value === selected)) picker.value = selected;
    if (!picker.options.length) picker.add(new Option('Tüm pedallar eklendi', ''));
    const canAdd = settingsLoaded && virtualPedals.length < pedalTypes.size;
    picker.disabled = !canAdd;
    byId('add-pedal').disabled = !canAdd;
    const hasSet = mutlugilSet.every((type) => virtualPedals.some((pedal) => pedal.type === type));
    byId('add-mutlugil').disabled = !settingsLoaded || hasSet;
    byId('add-mutlugil').textContent = hasSet ? 'Mutlugil seti eklendi' : 'Mutlugil setini ekle';
    byId('pedal-empty').hidden = virtualPedals.length !== 0;
    const list = byId('pedal-list');
    list.replaceChildren();
    resetPedalInfo();
    virtualPedals.forEach((pedal, index) => {
      const definition = pedalTypes.get(pedal.type);
      const item = element('article', 'virtual-card');
      const head = element('div', 'virtual-head');
      item.dataset.type = pedal.type;
      const toggle = element('button', 'footswitch', pedal.enabled ? 'Açık' : 'Bypass');
      const controls = element('div', 'virtual-controls');
      const actions = element('div', 'pedal-actions');
      const up = element('button', '', '←');
      const down = element('button', '', '→');
      const remove = element('button', 'remove', 'Kaldır');
      const show = addInfo(item, byId('pedal-info'), () => `${definition.name} · ${definition.info}`);
      toggle.setAttribute('aria-label', `${definition.name} etkin`);
      toggle.setAttribute('aria-pressed', String(pedal.enabled));
      toggle.setAttribute('aria-describedby', 'pedal-info');
      toggle.addEventListener('click', () => {
        pedal.enabled = !pedal.enabled;
        toggle.setAttribute('aria-pressed', String(pedal.enabled));
        toggle.textContent = pedal.enabled ? 'Açık' : 'Bypass';
        show();
        renderSong();
        renderListenTools();
        saveSettings();
      });
      definition.controls.forEach((control, controlIndex) => controls.append(buildPedalControl(pedal, definition, control, controlIndex)));
      if (pedal.type === 8) controls.querySelector('select').addEventListener('change', () => {
        controls.querySelector('input').dispatchEvent(new Event('input'));
      });
      if (pedal.type === 12) controls.children[3].querySelector('select').addEventListener('change', () => {
        controls.children[1].querySelector('input').dispatchEvent(new Event('input'));
      });
      up.setAttribute('aria-label', `${definition.name}, zincirde önceye taşı`);
      down.setAttribute('aria-label', `${definition.name}, zincirde sonraya taşı`);
      remove.setAttribute('aria-label', `${definition.name}, zincirden kaldır`);
      up.disabled = index === 0;
      down.disabled = index === virtualPedals.length - 1;
      up.addEventListener('click', () => movePedal(index, -1));
      down.addEventListener('click', () => movePedal(index, 1));
      remove.addEventListener('click', () => {
        virtualPedals.splice(index, 1);
        renderPedals();
        saveSettings();
        (list.children[Math.min(index, list.children.length - 1)]?.querySelector('.remove') ?? picker).focus();
      });
      head.append(element('h3', '', definition.name), toggle);
      actions.append(up, down);
      if (pedal.type === 11) {
        const tap = element('button', '', 'Tap Tempo');
        const time = controls.children[1].querySelector('input');
        let lastTap = null;
        tap.addEventListener('click', () => {
          const now = performance.now();
          const elapsed = lastTap === null ? 0 : now - lastTap;
          lastTap = now;
          if (elapsed < 100 || elapsed > 3000) {
            byId('pedal-info').textContent = 'Tempoyu ayarlamak için bir kez daha bas.';
            return;
          }
          time.value = Math.round(Math.sqrt((elapsed - 45) / 2955) * 100);
          time.dispatchEvent(new Event('input'));
          time.dispatchEvent(new Event('change'));
          byId('pedal-info').textContent = `Delay · ${delayTime(Number(time.value))}`;
        });
        actions.append(tap);
      }
      actions.append(remove);
      if (pedal.type === 8) {
        const motion = element('span', 'wah-live');
        motion.id = 'wah-live';
        motion.hidden = true;
        controls.append(motion);
      }
      item.append(head, controls, actions);
      list.append(item);
    });
    renderListenTools();
  }

  function settingsStatus(message) {
    byId('settings-status').textContent = message;
    byId('settings-status').hidden = !message;
  }

  function previewSettings() {
    if (!audioRunning || !window.studioSettings || previewFrame !== null || previewQueued) return;
    previewFrame = requestAnimationFrame(() => {
      previewFrame = null;
      previewQueued = true;
      settingsWrite = settingsWrite.then(async () => {
        if (audioRunning) await window.studioSettings.preview(JSON.stringify({names: presetNames, pedals: virtualPedals, balanceLevels}));
      }).catch(() => settingsStatus('Pedal ayarı uygulanamadı.')).finally(() => { previewQueued = false; });
    });
  }

  function saveSettings(persist = !selectedSong) {
    const data = JSON.stringify({names: presetNames, pedals: virtualPedals, balanceLevels});
    const stored = persist ? JSON.stringify({names: presetNames, pedals: personalPedals, autoSongVoice, balanceLevels}) : null;
    settingsWrite = settingsWrite.then(async () => {
      if (window.studioSettings) {
        if (stored) await window.studioSettings.save(stored);
        await window.studioSettings.preview(data);
      } else if (stored) localStorage.setItem(settingsKey, stored);
      settingsStatus('');
      return true;
    }).catch(() => {
      settingsStatus('Ayarlar kaydedilemedi.');
      return false;
    });
    return settingsWrite;
  }

  function movePedal(index, step) {
    const next = index + step;
    [virtualPedals[index], virtualPedals[next]] = [virtualPedals[next], virtualPedals[index]];
    renderPedals();
    saveSettings();
    const controls = byId('pedal-list').children[next].querySelector('.pedal-actions').children;
    const requested = controls[step < 0 ? 0 : 1];
    (requested.disabled ? controls[step < 0 ? 1 : 0] : requested).focus();
  }

  function restoredControls(pedal) {
    const extra = pedal.extra ?? [];
    return pedal.type === 8 && Array.isArray(extra) && extra.length === 0 ? [0] : extra;
  }

  async function restoreSettings() {
    try {
      const stored = window.studioSettings ? await window.studioSettings.load() : localStorage.getItem(settingsKey);
      const data = JSON.parse(stored ?? 'null');
      autoSongVoice = data?.autoSongVoice === true;
      balanceLevels = data?.balanceLevels !== false;
      if (Array.isArray(data?.names) && data.names.length === 6 && data.names.every((name) => typeof name === 'string' && name.trim() && name.length <= 32)) presetNames = data.names;
      if (Array.isArray(data?.pedals) && data.pedals.length <= pedalTypes.size && new Set(data.pedals.map((pedal) => pedal?.type)).size === data.pedals.length &&
          data.pedals.every((pedal) => {
            if (!pedalTypes.has(pedal?.type) || typeof pedal.enabled !== 'boolean') return false;
            const extra = restoredControls(pedal);
            return Array.isArray(extra) && extra.length === pedalTypes.get(pedal.type).controls.length - 1 &&
              [pedal.amount, ...extra].every((value) => Number.isInteger(value) && value >= 0 && value <= 100);
          })) personalPedals = data.pedals.map((pedal) => ({...pedal, extra: restoredControls(pedal)}));
    } catch {}
    virtualPedals = personalPedals;
    settingsLoaded = true;
    byId('song-title').disabled = false;
    byId('song-auto-voice').checked = autoSongVoice;
    byId('balance-levels').checked = balanceLevels;
    renderPedals();
    render();
  }

  function renderAudio() {
    const toggle = byId('audio-toggle');
    toggle.disabled = audioPending || (!audioRunning && (!session?.ready || busy)) || !settingsLoaded || !window.studioAudio;
    toggle.textContent = audioPending ? 'Ses akışı hazırlanıyor…' : audioRunning ? 'Sanal pedalları kapat' : 'Sanal pedalları aç';
    toggle.setAttribute('aria-pressed', String(audioRunning));
    byId('audio-level').disabled = audioPending;
    const idleMessage = session?.ready ? 'Blackstar’dan sanal pedalları dinlemek için sesi aç.' : 'Önce Blackstar’ı USB ile bağla.';
    const status = byId('audio-status');
    const message = audioMessage || (audioRunning ? 'Sanal pedallar etkin · Blackstar USB' : idleMessage);
    if (status.textContent !== message) status.textContent = message;
    tuner.setRunning(audioRunning);
    renderListenTools();
    renderSong();
    renderRecording();
  }

  function renderRecording() {
    const guitar = byId('record-guitar');
    const mac = byId('record-mac');
    const locked = recordingBusy || recording.active;
    const sourceReady = (guitar.checked || mac.checked) && (!guitar.checked || audioRunning);
    byId('record-folder').disabled = !window.studioAudio || locked;
    setText('record-folder-label', recording.folder || 'Henüz klasör seçilmedi.');
    guitar.disabled = locked;
    mac.disabled = locked || !recording.supportsMac;
    byId('record-diagnostics').disabled = locked || !guitar.checked;
    const start = byId('record-start');
    start.disabled = !window.studioAudio || recordingBusy || (!recording.active && (!recording.folder || !sourceReady || (guitar.checked && audioPending)));
    setText('record-start', recording.active ? 'Kaydı durdur' : 'Kaydı başlat');
    start.dataset.recording = String(recording.active);
    byId('record-live').hidden = !recording.active;
    setText('record-guitar-state', recording.guitarActive ? 'Kaydediliyor · Gitar.wav' :
      recording.guitarNotice ? 'Gitar kesildi · dosya korundu' : 'Pedallardan geçen gitar · Gitar.wav');
    setText('record-mac-state', recording.macActive ? 'Kaydediliyor · Mac-Sesi.wav' :
      recording.supportsMac ? 'Bilgisayarda çalan eşlik · Mac-Sesi.wav' : 'macOS 14.2 veya sonrası gerekir');
    byId('record-reveal').disabled = locked || !recording.hasSaved;
    const audio = byId('record-audio');
    audio.hidden = !guitar.checked || audioRunning || recording.active;
    audio.disabled = !window.studioAudio || !session?.ready || audioPending;
    const seconds = Math.floor(recording.seconds);
    setText('record-time', `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`);
    const status = byId('record-status');
    const text = recordingMessage || (recording.active ? recording.guitarNotice || 'Kayıt alınıyor.' : recording.message ||
      (!window.studioAudio ? 'Kayıt için ID:CORE Studio Mac uygulamasını aç.' :
       !recording.folder ? 'Kaydetmek istediğin klasörü seç.' :
       !sourceReady ? 'Bir ses kaynağı seç. Sanal gitar için sanal sesi aç.' : 'Kayda hazır.'));
    if (status.textContent !== text) status.textContent = text;
    byId('record-report').hidden = !recording.toneSummary;
    setText('record-report-text', recording.toneSummary || '');
  }

  function resetAudioUI() {
    audioRunning = false;
    audioPending = false;
    audioMessage = '';
    clearTimeout(meterTimer);
    meterTimer = null;
    byId('audio-meter').value = 0;
    byId('audio-send-meter').value = 0;
    audioMeters = {input: 0, matchPermille: 1000, wahHz: 0};
    tuner.setRunning(false);
  }

  function setRecording(next) {
    recording = next;
    clearTimeout(recordingTimer);
    if (recording.active) recordingTimer = setTimeout(() => refreshRecording(), 250);
    renderRecording();
  }

  async function refreshRecording() {
    if (!window.studioAudio) return;
    try { setRecording(await window.studioAudio.recordingStatus()); }
    catch { if (recording.active) recordingTimer = setTimeout(() => refreshRecording(), 500); }
  }

  async function recordingAction(operation) {
    if (!window.studioAudio || recordingBusy) return;
    recordingBusy = true;
    recordingMessage = '';
    clearTimeout(recordingTimer);
    renderRecording();
    try { setRecording(await operation()); }
    catch (error) {
      recordingMessage = error.message || String(error);
      if (recording.active) recordingTimer = setTimeout(() => refreshRecording(), 250);
    } finally {
      recordingBusy = false;
      renderRecording();
    }
  }

  function toggleRecording() {
    if (recording.active) return recordingAction(() => window.studioAudio.endRecording());
    return recordingAction(async () => {
      await settingsWrite;
      return window.studioAudio.beginRecording({
        version: 2, song: songTones.get(selectedSong)?.name || 'Zincirim',
        guitar: byId('record-guitar').checked, mac: byId('record-mac').checked,
        diagnostics: byId('record-diagnostics').checked,
        amp: Object.fromEntries(ampValues), mode: session?.mode ?? null, slot: session?.slot ?? null,
        firmware: session?.firmware ?? null, pedals: virtualPedals, balanceLevels
      });
    });
  }

  function scheduleMeter(link) {
    meterTimer = setTimeout(async () => {
      try {
        const tuning = byId('tuner').open && !byId('pedals-view').hidden;
        const reading = await window.studioAudio.meter(tuning);
        if (!audioRunning || session !== link) return;
        if (reading.stopped) {
          resetAudioUI();
          audioMessage = reading.stopped;
          renderAudio();
          return;
        }
        byId('audio-meter').value = reading.input;
        byId('audio-send-meter').value = reading.output;
        audioMeters = reading;
        renderListenTools();
        if (tuning && byId('tuner').open && !byId('pedals-view').hidden) tuner.update(reading.frequency);
      } catch {}
      if (audioRunning && session === link) scheduleMeter(link);
    }, 120);
  }

  async function toggleAudio() {
    const link = session;
    if ((!audioRunning && !link?.ready) || !window.studioAudio || audioPending || !settingsLoaded) return;
    audioPending = true;
    audioMessage = '';
    renderAudio();
    try {
      if (audioRunning) {
        await window.studioAudio.stop();
        resetAudioUI();
        return;
      }
      if (!await saveSettings(false)) throw new Error('Sanal zincir yüklenemedi.');
      if (session !== link) return;
      await window.studioAudio.setLevel(Number(byId('audio-level').value));
      if (session !== link) return;
      await window.studioAudio.start();
      if (session !== link) return;
      audioRunning = true;
      scheduleMeter(link);
    } catch (error) {
      if (session === link) audioMessage = error.message || String(error);
    } finally {
      if (session === link) {
        audioPending = false;
        renderAudio();
      }
    }
  }

  function render() {
    const mode = busy || (session && !session.ready) ? 'sync' : session ? 'live' : 'demo';
    const live = mode === 'live';
    const demo = mode === 'demo';
    document.body.dataset.mode = mode;
    byId('status').textContent = {demo: 'Demo', sync: 'Senkronize ediliyor', live: 'USB bağlı'}[mode];
    byId('connect').textContent = session ? 'Bağlantıyı kes' : 'USB ile bağlan';
    byId('connect').disabled = busy;
    byId('voice-mode').textContent = session?.mode === 'patch' ? 'Preset modu · Voice için amfide MANUAL’a bas' : session?.mode === 'manual' ? 'Manuel mod' : 'Ton karakteri';
    byId('amp-refresh').disabled = !live;
    byId('amp-feedback').textContent = demo ? 'Demo · ayarlar amfiye gönderilmez.' : ampFeedback;
    const slot = demo ? demoSlot : session?.slot;
    byId('patch-state').textContent = slot ? `${demo ? 'Demo' : 'Aktif yuva'} · ${slot}. ${presetNames[slot - 1]}` :
      session?.mode === 'manual' ? 'Amfi manuel modda.' : 'Şarkı tonlarından bağımsız amfi ayarları.';

    const values = demo ? demoValues : ampValues;
    for (const [parameter, view] of paramViews) {
      const value = session?.pendingWrites.get(parameter)?.value ?? values.get(parameter);
      view.render(value, (demo || live) && value !== undefined);
    }
    const currentVoice = live && session.mode === 'patch' && session.slot ? session.slot - 1 : values.get(1);
    voiceButtons.forEach((button, index) => {
      button.disabled = !demo && !(live && session.mode !== 'patch');
      button.setAttribute('aria-pressed', String((session?.pendingWrites.get(1)?.value ?? currentVoice) === index));

    });
    patchButtons.forEach(({button, name, rename}, index) => {
      button.disabled = !demo && !live;
      button.setAttribute('aria-pressed', String((demo ? demoSlot : session?.slot) === index + 1));
      if (name.textContent !== presetNames[index]) name.textContent = presetNames[index];
      rename.disabled = !settingsLoaded;
      rename.setAttribute('aria-label', `Yuva ${index + 1}, ${presetNames[index]}, adı düzenle`);
    });
    renderAudio();
  }

  function addRange(parent, parameter, label, max = 127, groupLabel = '', description = '') {
    const group = element('label', 'control');
    const heading = element('span', 'control-label');
    const output = element('output');
    const slider = element('input');
    slider.type = 'range';
    slider.min = 0;
    slider.max = max;
    slider.setAttribute('aria-label', groupLabel ? `${groupLabel} · ${label}` : label);
    heading.append(element('span', '', label), output);
    group.append(heading);
    const position = addDial(group, slider);
    if (description) {
      slider.setAttribute('aria-describedby', 'amp-hint');
      addInfo(group, byId('amp-hint'), () => description);
    }
    parent.append(group);
    slider.addEventListener('input', () => { output.textContent = slider.value; });
    slider.addEventListener('change', () => edit(parameter, Number(slider.value)));
    paramViews.set(parameter, {label, max, render(value, enabled) {
      slider.disabled = !enabled;
      if (enabled && slider.dataset.dragging) return;
      slider.value = value ?? 0;
      output.textContent = value ?? '—';
      position();
    }});
  }

  function addEffect(effect) {
    const card = element('div', 'fx');
    card.dataset.fx = effect.toggle;
    const heading = element('div', 'fx-head');
    const controls = element('div', 'fx-controls');
    const toggle = element('button');
    toggle.setAttribute('aria-label', effect.name);
    heading.append(element('h3', '', effect.name));
    card.append(heading);
    toggle.addEventListener('click', () => edit(effect.toggle, toggle.getAttribute('aria-pressed') === 'true' ? 0 : 1));
    paramViews.set(effect.toggle, {label: effect.name, max: 1, render(value, enabled) {
      toggle.disabled = !enabled;
      toggle.textContent = value === undefined ? '—' : value ? 'Açık' : 'Kapalı';
      toggle.setAttribute('aria-pressed', String(value === 1));
    }});
    if (effect.types) {
      const select = element('select');
      select.setAttribute('aria-label', `${effect.name} türü`);
      effect.types.forEach((name, index) => select.add(new Option(name, index)));
      select.addEventListener('change', () => edit(effect.type, Number(select.value)));
      paramViews.set(effect.type, {label: `${effect.name} türü`, max: effect.types.length - 1, render(value, enabled) {
        select.disabled = !enabled;
        select.selectedIndex = value ?? -1;
      }});
      card.append(select);
    }
    effect.controls.forEach(([parameter, label, max]) => addRange(controls, parameter, label, max, effect.name));
    card.append(controls, toggle);
    byId('effects').append(card);
  }

  function edit(parameter, value, {manualOnly = false} = {}) {
    const max = parameter === 1 ? voices.length - 1 : paramViews.get(parameter)?.max;
    if (!Number.isInteger(value) || max === undefined || value < 0 || value > max || busy) return;
    const link = session;
    if (!link) {
      demoValues.set(parameter, value);
      demoSlot = null;
      render();
      return;
    }
    if (!link.ready || (parameter === 1 && link.mode === 'patch') || (manualOnly && link.mode !== 'manual')) return;
    const expected = {value};
    if (parameter === 1) link.rejectedVoice = null;
    link.pendingWrites.set(parameter, expected);
    ampFeedback = 'USB ayarı doğrulanıyor…';
    render();
    const canSend = manualOnly ? () => link.ready && link.mode === 'manual' && link.pendingWrites.get(parameter) === expected : undefined;
    transmit(link, AmpProtocol.setParameter(parameter, value), canSend).then((sent) => {
      if (session !== link) return;
      if (sent) {
        expected.sent = true;
        verifyWrites(link);
      } else if (link.pendingWrites.get(parameter) === expected) {
        link.pendingWrites.delete(parameter);
        render();
      }
    });
  }

  function loadSlot(slot) {
    if (busy || !Number.isInteger(slot) || slot < 1 || slot > demos.length) return;
    const link = session;
    if (!link) {
      const [, voice, gain, bass, middle, treble, isf] = demos[slot - 1];
      [voice, gain, 38, bass, middle, treble, isf].forEach((value, index) => demoValues.set(index + 1, value));
      demoSlot = slot;
      render();
      return;
    }
    if (!link.ready) return;
    link.ready = false;
    clearReadback(link);
    link.pendingWrites.clear();
    link.pendingSlot = slot;
    link.slot = null;
    link.directBefore = null;
    render();
    setNotice(`Yuva ${slot} çağrılıyor…`);
    transmit(link, AmpProtocol.loadSlot(slot)).then((sent) => {
      if (sent && session === link && link.pendingSlot === slot) requestState(link, 220);
    });
  }

  function logUSB(message) {
    usbEvents.push({at: new Date().toISOString(), message});
    if (usbEvents.length > 20) usbEvents.shift();
  }

  function storeParam(parameter, value) {
    const max = parameter === 1 ? voices.length - 1 : paramViews.get(parameter)?.max;
    if (Number.isInteger(value) && value >= 0 && value <= max) ampValues.set(parameter, value);
  }

  function clearReadback(link) {
    clearTimeout(link.verifyTimer);
    clearTimeout(link.verifyTimeout);
    link.readback = null;
  }

  function finishReadback(link, received) {
    const verifying = link.readback;
    if (!verifying) return;
    clearTimeout(link.verifyTimeout);
    link.readback = null;
    const rejected = [];
    let checked = 0;
    for (const [parameter, expected] of verifying) {
      if (link.pendingWrites.get(parameter) !== expected) continue;
      link.pendingWrites.delete(parameter);
      checked++;
      const matched = received && ampValues.get(parameter) === expected.value;
      if (!matched) rejected.push(parameter);
      if (parameter === 3 && expected.direct) {
        directMessage = matched ? '' : 'Amfi yeni ses seviyesini doğrulamadı. Amfi ve EQ bölümünden ayarları yeniden oku.';
      }
      if (parameter === 1) link.rejectedVoice = matched ? null : expected.value;
      logUSB(`Parametre ${parameter} → ${expected.value} · ${received ? (ampValues.get(parameter) ?? 'okunamadı') : 'zaman aşımı'}`);
    }
    if (rejected.length) {
      const names = rejected.map((parameter) => parameter === 1 ? 'Voice' : paramViews.get(parameter)?.label || parameter);
      ampFeedback = `Amfi doğrulamadı · ${names.join(', ')}.`;
      if (rejected.includes(1)) ampFeedback += ' Amfide MANUAL ışığını kontrol et.';
    } else if (checked) ampFeedback = 'Amfi ayarı USB üzerinden doğrulandı.';
    if (link.pendingWrites.size) verifyWrites(link);
  }

  function verifyWrites(link) {
    clearTimeout(link.verifyTimer);
    if (link.readback) return;
    link.verifyTimer = setTimeout(() => {
      if (session !== link || !link.ready || link.readback) return;
      const values = [...link.pendingWrites].filter(([, expected]) => expected.sent);
      if (!values.length) return;
      link.readback = new Map(values);
      link.verifyTimeout = setTimeout(() => {
        if (session !== link) return;
        finishReadback(link, false);
        render();
      }, 1500);
      transmit(link, AmpProtocol.readState());
    }, 150);
  }

  function receive(link, event) {
    if (session !== link || event.reportId !== 0 || event.data.byteLength < 5) return;
    const bytes = new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength);
    const report = AmpProtocol.decode(bytes);
    if (!report) return;
    switch (report.type) {
      case 'firmware':
        link.firmware = report.version;
        return;
      case 'state': {
        ampValues.clear();
        for (const key of [1, ...paramViews.keys()]) storeParam(key, report.bytes[key + 3]);
        if (ampValues.get(3) > 0 && link.pendingWrites.get(3)?.value !== 0 && !directPending) {
          link.directBefore = null;
          link.reconnectedMuted = false;
        }
        const unconfirmed = link.pendingSlot !== null && link.pendingSlot !== link.slot;
        if (link.pendingSlot !== null) logUSB(`Yuva ${link.pendingSlot} · ${unconfirmed ? 'doğrulanamadı' : 'doğrulandı'}`);
        link.pendingSlot = null;
        link.ready = true;
        clearTimers(link);
        if (link.readback) finishReadback(link, true);
        else if (!link.pendingWrites.size) ampFeedback = 'Amfi ayarları USB üzerinden okundu.';
        setNotice(unconfirmed ? 'Amfi ayarları okundu. Seçilen yuva doğrulanamadı.' : 'Amfi USB ile bağlı. Amfi/EQ ayarları canlıdır.');
        break;
      }
      case 'manual':
        link.mode = 'manual';
        link.slot = null;
        storeParam(1, report.value);
        if (link.ready && !link.pendingWrites.size) requestState(link, 130);
        break;
      case 'patch':
        link.mode = 'patch';
        link.slot = report.slot;
        if (link.ready && !link.pendingWrites.size) requestState(link, 150);
        break;
      case 'startup-manual':
        if (link.mode === 'unknown' && link.pendingSlot === null) link.mode = 'manual';
        break;
      case 'slot':
        if (report.slot === link.pendingSlot || (report.startup && link.mode === 'unknown' && link.pendingSlot === null)) {
          link.mode = 'patch';
          link.slot = report.slot;
        } else if (link.ready && link.mode === 'patch' && report.slot !== link.slot && !link.pendingWrites.size) {
          link.slot = report.slot;
          requestState(link, 150);
        }
        break;
      case 'values':
        report.values.forEach(([parameter, value]) => storeParam(parameter, value));
        if (!directPending && link.pendingWrites.get(3)?.value !== 0 && report.values.some(([parameter, value]) => parameter === 3 && value > 0)) {
          link.directBefore = null;
          link.reconnectedMuted = false;
        }
        break;
    }
    render();
    applyPendingSongVoice();
  }

  function clearTimers(link) { link.timers.splice(0).forEach((timer) => clearTimeout(timer)); }

  function requestState(link, delay = 0) {
    clearTimers(link);
    link.timers.push(setTimeout(() => transmit(link, AmpProtocol.readState()), delay));
    link.timers.push(setTimeout(() => transmit(link, AmpProtocol.readState()), delay + 1000));
    link.timers.push(setTimeout(() => transmit(link, AmpProtocol.readStartup()), delay + 2000));
    link.timers.push(setTimeout(() => {
      if (session !== link) return;
      if (!link.ready) endSession('Amfi ayarları okunamadı. Architect açıksa kapatıp tekrar dene.');
      else { ampFeedback = 'Amfi yeni bir okuma göndermedi.'; render(); }
    }, delay + 3500));
  }

  function transmit(link, data, canSend) {
    const operation = link.queue.then(async () => {
      if (session !== link || !link.device.opened || (canSend && !canSend())) return false;
      try {
        await link.device.sendReport(0, data);
        return true;
      } catch (error) {
        logUSB(`USB komutu ${data[0]}/${data[1]} · ${error.message || error}`);
        if (session === link) await endSession('USB iletişimi kesildi. Amfiyi tekrar bağlayabilirsin.');
        return false;
      }
    });
    link.queue = operation;
    return operation;
  }

  async function endSession(message) {
    const link = session;
    session = null;
    directMessage = '';
    songVoiceRequest = '';
    resetAudioUI();
    if (link) {
      busy = true;
      clearTimers(link);
      clearReadback(link);
      link.device.removeEventListener('inputreport', link.listener);
      ampValues.clear();
      render();
      try { if (link.device.opened) await link.device.close(); } catch {}
      busy = false;
    }
    render();
    setNotice(message);
  }

  async function connect() {
    if (session) return endSession('Bağlantı kesildi. Demo modu açık.');
    if (!navigator.hid) return setNotice('Bu tarayıcı USB kontrolünü desteklemiyor. Dosyayı Chrome veya Edge ile aç.');
    busy = true;
    render();
    try {
      const [device] = await navigator.hid.requestDevice({filters: [usbIds]});
      if (!device) {
        setNotice('Amfi seçilmedi. Listede görünmüyorsa Architect’i kapatıp USB kablosunu yeniden takmayı dene.');
        return;
      }
      const link = {
        device, ready: false, mode: 'unknown', firmware: null, slot: null, pendingSlot: null,
        pendingWrites: new Map(), readback: null, timers: [], queue: Promise.resolve()
      };
      link.listener = (event) => receive(link, event);
      session = link;
      await device.open();
      if (session !== link) {
        if (device.opened) await device.close();
        return;
      }
      link.directBefore = device.directBefore || null;
      link.reconnectedMuted = Boolean(link.directBefore);
      device.addEventListener('inputreport', link.listener);
      setNotice('Amfi ayarları okunuyor…');
      requestState(link);
    } catch {
      await endSession('USB bağlantısı açılamadı. Architect açıksa kapatıp tekrar dene.');
    } finally {
      busy = false;
      render();
    }
  }

  const voiceButtons = voices.map((name, index) => {
    const button = element('button', '', name);
    button.addEventListener('click', () => edit(1, index));
    byId('voices').append(button);
    return button;
  });
  const patchButtons = demos.map((preset, index) => {
    const row = element('div', 'patch-row');
    const button = element('button');
    const name = element('span', 'patch-name', preset[0]);
    const rename = element('button', 'rename', '✎');
    rename.type = 'button';
    button.setAttribute('aria-keyshortcuts', String(index + 1));
    button.setAttribute('aria-describedby', 'patch-note');
    button.append(element('span', 'slot', String(index + 1)), name);
    button.addEventListener('click', () => loadSlot(index + 1));
    rename.addEventListener('click', () => {
      renamingSlot = index;
      byId('rename-label').textContent = `Yuva ${index + 1} adı`;
      byId('rename-form').hidden = false;
      const input = byId('preset-name');
      input.value = presetNames[index];
      input.focus();
      input.select();
    });
    addInfo(row, byId('patch-note'), () => `${presetNames[index]} · Yuva ${index + 1} · Tuş ${index + 1}. ${session ? 'Amfideki tonu çağırır.' : 'Demo tonunu açar.'} Ad bu uygulamada saklanır.`);
    row.append(button, rename);
    byId('patches').append(row);
    return {button, name, rename};
  });

  function closeRename() {
    const index = renamingSlot;
    byId('rename-form').hidden = true;
    renamingSlot = null;
    patchButtons[index]?.rename.focus();
  }

  toneControls.forEach(([parameter, label, description]) => addRange(byId('tone'), parameter, label, 127, '', description));
  effects.forEach(addEffect);
  const viewButtons = document.querySelectorAll('[data-view]');
  viewButtons.forEach((button) => button.addEventListener('click', () => showView(button.dataset.view)));
  byId('pedal-setup').addEventListener('click', () => {
    showView('pedals-view');
    byId('pedals-heading').focus();
  });
  byId('pedal-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const picker = byId('pedal-type');
    const type = Number(picker.value);
    const definition = pedalTypes.get(type);
    if (!settingsLoaded || !definition || virtualPedals.some((pedal) => pedal.type === type)) return;
    virtualPedals.push(newPedal(type, true));
    renderPedals();
    saveSettings();
    byId('pedal-list').lastElementChild.querySelector('.virtual-head button').focus();
  });
  byId('add-mutlugil').addEventListener('click', () => {
    if (!settingsLoaded) return;
    const missing = mutlugilSet.filter((type) => !virtualPedals.some((pedal) => pedal.type === type));
    if (!missing.length) return;
    virtualPedals.push(...missing.map((type) => newPedal(type, false)));
    renderPedals();
    saveSettings();
    byId('pedal-info').textContent = `${missing.length} model bypass konumunda eklendi. Kullanacağın pedalları aç.`;
  });
  byId('rename-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const name = byId('preset-name').value.trim();
    if (renamingSlot === null || !name || name.length > 32) return;
    presetNames[renamingSlot] = name;
    render();
    saveSettings(true);
    closeRename();
  });
  byId('rename-cancel').addEventListener('click', closeRename);
  byId('rename-form').addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.preventDefault(); closeRename(); }
  });
  byId('audio-toggle').addEventListener('click', toggleAudio);
  byId('balance-levels').addEventListener('change', (event) => {
    balanceLevels = event.target.checked;
    renderListenTools();
    saveSettings(true);
  });
  byId('direct-volume').addEventListener('click', async () => {
    const link = session;
    const volume = ampValues.get(3);
    if (!link?.ready || directPending || link.pendingWrites.has(3) || volume === undefined) return;
    const next = volume > 0 ? 0 : link.directBefore;
    if (next === null || next === undefined) return;
    if (!link.device.setDirectVolume) {
      if (volume > 0) link.directBefore = volume;
      edit(3, next);
      return;
    }
    directPending = true;
    directMessage = 'Amfi ses seviyesi değiştiriliyor…';
    renderListenTools();
    try {
      const operation = link.queue.then(async () => {
        if (session !== link || !link.ready) return false;
        await link.device.setDirectVolume(volume, next);
        return true;
      });
      link.queue = operation.catch(() => false);
      if (await operation && session === link) {
        if (volume > 0) link.directBefore = volume;
        const expected = {value: next, sent: true, direct: true};
        link.pendingWrites.set(3, expected);
        verifyWrites(link);
      }
      directMessage = '';
    } catch (error) {
      directMessage = error.message || String(error);
    } finally {
      directPending = false;
      render();
    }
  });
  byId('usb-test').addEventListener('click', async () => {
    try {
      await window.studioAudio.testUSB();
      audioMessage = 'USB’ye kısa bir test tonu gönderildi. Duyulmuyorsa Blackstar’da TAP’ı tutup Volume ile USB dinleme seviyesini kontrol et.';
    } catch (error) { audioMessage = error.message || String(error); }
    renderAudio();
  });
  byId('record-audio').addEventListener('click', toggleAudio);
  byId('record-folder').addEventListener('click', () => recordingAction(() => window.studioAudio.chooseRecordingFolder()));
  byId('record-start').addEventListener('click', toggleRecording);
  byId('record-reveal').addEventListener('click', () => window.studioAudio.revealRecording().catch(() => {}));
  for (const id of ['record-guitar', 'record-mac', 'record-diagnostics']) {
    byId(id).addEventListener('change', () => { recordingMessage = ''; renderRecording(); });
  }
  byId('amp-refresh').addEventListener('click', () => {
    if (!session?.ready) return;
    ampFeedback = 'Amfiden okunuyor…';
    render();
    requestState(session);
  });
  byId('song-apply-voice').addEventListener('click', applySongVoice);
  byId('song-auto-voice').addEventListener('change', (event) => {
    autoSongVoice = event.target.checked;
    songVoiceRequest = autoSongVoice ? selectedSong : '';
    renderSong();
    applyPendingSongVoice();
    saveSettings(true);
  });
  byId('song-eq').addEventListener('click', () => {
    const eq = songTones.get(selectedSong)?.eq;
    if (!session?.ready || !eq) return;
    for (const [parameter, value] of Object.entries(eq)) {
      if (ampValues.get(Number(parameter)) !== value) edit(Number(parameter), value);
    }
  });
  const songPicker = byId('song-title');
  const sectionPicker = byId('song-section');
  const sectionsBySong = new Map();
  songPicker.disabled = true;
  byId('song-count').textContent = `${songTones.size} ton`;
  for (const album of songAlbums) {
    const group = element('optgroup');
    group.label = album.name;
    const songs = new Map();
    for (const tone of album.tones) {
      if (!songs.has(tone.title)) songs.set(tone.title, []);
      songs.get(tone.title).push(tone);
    }
    for (const [title, sections] of songs) {
      const id = sections[0].key;
      group.append(new Option(title, id));
      sectionsBySong.set(id, sections);
    }
    songPicker.append(group);
  }
  songPicker.addEventListener('change', () => {
    if (!settingsLoaded) return;
    const sections = sectionsBySong.get(songPicker.value) ?? [];
    byId('song-section-wrap').hidden = sections.length < 2;
    sectionPicker.replaceChildren(...sections.map(({section, key}) => new Option(section, key)));
    selectSong(sections[0]?.key ?? '');
  });
  sectionPicker.addEventListener('change', () => { if (settingsLoaded) selectSong(sectionPicker.value); });
  const outputLevel = byId('audio-level');
  let levelFrame = null;
  outputLevel.addEventListener('pointerdown', () => outputLevel.focus());
  outputLevel.addEventListener('keydown', (event) => {
    if (event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    outputLevel.value = event.key === 'Home' ? outputLevel.min : outputLevel.max;
    outputLevel.dispatchEvent(new Event('input'));
    outputLevel.dispatchEvent(new Event('change'));
  });
  outputLevel.addEventListener('input', (event) => {
    byId('output-value').textContent = `${event.target.value}%`;
    if (!audioRunning || levelFrame !== null) return;
    levelFrame = requestAnimationFrame(() => {
      levelFrame = null;
      if (audioRunning) window.studioAudio.setLevel(Number(outputLevel.value)).catch(() => {});
    });
  });
  document.addEventListener('keydown', (event) => {
    if (event.repeat || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || !/^[1-6]$/.test(event.key)) return;
    if (event.target.closest?.('input, select, textarea, [contenteditable], #tuner')) return;
    event.preventDefault();
    loadSlot(Number(event.key));
  });
  byId('connect').addEventListener('click', connect);
  if (window.studioNative) byId('usb-help').textContent = 'Bu panel Mac üzerinden USB ile bağlanır.';
  navigator.hid?.addEventListener('disconnect', ({device}) => {
    if (session?.device === device) endSession('Amfi USB bağlantısını kesti. Demo modu açık.');
  });
  renderPedals();
  restoreSettings();
  refreshRecording();
  render();
