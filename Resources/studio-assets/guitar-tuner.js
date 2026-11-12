const GuitarTuner = (() => {
  const strings = [40, 45, 50, 55, 59, 64];
  const letters = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  const names = ['Do', 'Do♯', 'Re', 'Re♯', 'Mi', 'Fa', 'Fa♯', 'Sol', 'Sol♯', 'La', 'La♯', 'Si'];
  const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);
  const midiOf = (frequency) => 69 + 12 * Math.log2(frequency / 440);
  const centsBetween = (frequency, target) => 1200 * Math.log2(frequency / target);
  const note = (midi) => `${letters[midi % 12]}${Math.floor(midi / 12) - 1}`;
  const name = (midi) => names[midi % 12];
  const formatHz = new Intl.NumberFormat('tr-TR', {maximumFractionDigits: 2, minimumFractionDigits: 2});
  const signed = (cents) => Math.round(cents) > 0 ? `+${Math.round(cents)}` : String(Math.round(cents));
  const targets = (tuning) => strings.map((midi, index) => index === 0 && tuning === 'drop-d' ? 38 : midi);

  function detectString(midi, tuning) {
    const index = targets(tuning).findIndex((target) => Math.abs(target - midi) <= 0.8);
    return index < 0 ? null : 6 - index;
  }

  function bridgeAdvice(cents) {
    if (Math.abs(cents) <= 3) return 'Entonasyon hedefe yakın.';
    return cents > 0 ? '12. perde tiz. Teli uzatmak için köprü eşiğini saptan uzağa al.' :
      '12. perde pes. Teli kısaltmak için köprü eşiğini sapa yaklaştır.';
  }

  function mount(root) {
    const get = (key) => root.querySelector(`#tuner-${key}`);
    const tuning = get('tuning');
    const scale = get('offset');
    const capture = get('capture');
    const result = get('result');
    let running = false;
    let selected = null;
    let checking = false;
    let frequency = 0;
    let windowHz = [];
    let reference = null;
    let waitForSilence = false;
    let done = false;
    const results = new Map();

    function reset() {
      frequency = 0;
      windowHz = [];
      reference = null;
      waitForSilence = false;
      done = false;
    }

    function select(number) {
      selected = number;
      reset();
      render();
    }

    const buttons = strings.map((_, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.addEventListener('click', () => select(6 - index));
      get('strings').append(button);
      return button;
    });

    function currentTarget() {
      const midi = targets(tuning.value)[6 - selected];
      return selected === null ? null : midi + (checking ? 12 : 0);
    }

    function update(value) {
      frequency = Number.isFinite(value) && value > 0 ? value : 0;
      if (checking && !done) {
        if (!frequency) waitForSilence = false;
        const target = currentTarget();
        const valid = frequency && Math.abs(centsBetween(frequency, hz(target))) <= 80;
        windowHz = valid && !waitForSilence ? [...windowHz.slice(-2), frequency] : [];
      }
      render();
    }

    function text(node, value) {
      if (node.textContent !== value) node.textContent = value;
    }

    function render() {
      const midi = frequency ? midiOf(frequency) : null;
      const heard = midi === null ? null : Math.round(midi);
      const detected = !checking && midi !== null ? detectString(midi, tuning.value) : null;
      const active = selected ?? detected;
      const activeTarget = currentTarget() ?? (detected === null ? heard : targets(tuning.value)[6 - detected]);
      const targetHz = activeTarget === null ? null : hz(activeTarget);
      const cents = frequency && targetHz ? centsBetween(frequency, targetHz) : null;
      const direction = cents === null ? '' : Math.abs(cents) <= 3 ? 'Akortta' : cents < 0 ? 'Pes · teli ger' : 'Tiz · teli gevşet';
      text(get('note'), heard === null ? '—' : `${note(heard)} · ${name(heard)}`);
      text(get('detail'), frequency ? `${formatHz.format(frequency)} Hz${checking ? ` · ${signed(cents)} cent` : ''}` : '');
      const displayCents = Math.max(-50, Math.min(50, cents ?? 0));
      scale.style.setProperty('--position', `${displayCents + 50}%`);
      scale.setAttribute('aria-valuenow', Math.round(displayCents));
      scale.setAttribute('aria-valuetext', cents === null ? 'Sinyal bekleniyor' : `${signed(cents)} cent`);
      scale.dataset.signal = cents !== null;
      scale.dataset.centered = cents !== null && Math.abs(cents) <= 3;
      const targetText = targetHz ? `Hedef ${note(activeTarget)} · ${formatHz.format(targetHz)} Hz` : 'Tek bir açık tel çal.';
      let instruction = targetText;
      if (!running) instruction = `Ölçmek için Sanal pedalları aç. ${targetText}`;
      else if (checking) {
        const step = done ? 'Ölçüm tamamlandı.' : waitForSilence ? 'Teli sustur.' : reference === null ? '12. perde harmoniğini çal.' : '12. perdeye normal kuvvetle basıp çal.';
        instruction = `${step} ${targetText}${cents !== null && Math.abs(cents) > 80 ? ' Seçili tel ve oktavı kontrol et.' : ''}`;
      } else if (cents !== null) {
        instruction = detected === null && selected === null ? `${signed(cents)} cent · Seçili düzende açık tel hedefi algılanmadı.` :
          `${active}. tel · ${targetText} · ${signed(cents)} cent · ${Math.abs(cents) > 150 ? 'Seçili teli ve oktavı kontrol et.' : direction}`;
      }
      text(get('instruction'), instruction);
      get('open').setAttribute('aria-pressed', String(!checking));
      get('intonation').setAttribute('aria-pressed', String(checking));
      get('auto').hidden = checking;
      get('auto').setAttribute('aria-pressed', String(selected === null));
      get('check').hidden = !checking;
      targets(tuning.value).forEach((open, index) => {
        const number = 6 - index;
        const button = buttons[index];
        const measured = results.get(number);
        const pitch = open + (checking ? 12 : 0);
        text(button, `${number} · ${note(pitch)} · ${name(pitch)}${checking && measured !== undefined ? ` (${signed(measured)} c)` : ''}`);
        button.setAttribute('aria-pressed', String(number === selected));
        button.dataset.detected = number === detected && selected === null;
      });
      const stable = windowHz.length === 3 && centsBetween(Math.max(...windowHz), Math.min(...windowHz)) <= 4;
      capture.disabled = !checking || !running || !stable || done;
      text(capture, reference === null ? '1. Harmoniği al' : '2. 12. perdeyi al');
      const measured = results.get(selected);
      text(result, measured !== undefined ? `Basılan nota − harmonik · ${signed(measured)} cent. ${bridgeAdvice(measured)} ${Math.abs(measured) > 3 ? 'Sonra açık teli yeniden akort edip ölç.' : ''}`.trim() :
        reference === null ? 'Gösterge sabitlenince ölçümü al.' : `Harmonik alındı · ${formatHz.format(reference)} Hz.`);
    }

    get('open').addEventListener('click', () => { if (checking) { checking = false; select(selected); } });
    get('intonation').addEventListener('click', () => { if (!checking) { checking = true; select(selected ?? 6); } });
    get('auto').addEventListener('click', () => select(null));
    tuning.addEventListener('change', () => { results.clear(); select(selected); });
    get('reset').addEventListener('click', () => { results.delete(selected); select(selected); });
    capture.addEventListener('click', () => {
      const sample = [...windowHz].sort((left, right) => left - right)[1];
      if (reference === null) {
        results.delete(selected);
        reference = sample;
        waitForSilence = true;
      } else {
        results.set(selected, centsBetween(sample, reference));
        done = true;
      }
      windowHz = [];
      render();
    });
    function suspend() { frequency = 0; windowHz = []; render(); }

    root.addEventListener('toggle', () => { if (!root.open) suspend(); });
    render();
    return {
      update,
      suspend,
      setRunning(active) {
        if (active === running) return;
        running = active;
        if (!running) reset();
        render();
      }
    };
  }

  return {mount, hz, centsBetween, detectString, targets, bridgeAdvice};
})();
