const ToneComparison = (() => {
  function matchedGains(tracks, offsets, duration) {
    const levels = tracks.map((track, index) => {
      const start = Math.round(offsets[index] * track.sampleRate);
      const end = Math.min(track.length, start + Math.round(duration * track.sampleRate));
      const channels = Array.from({length: track.numberOfChannels}, (_, channel) => track.getChannelData(channel));
      const block = Math.max(1, Math.round(track.sampleRate * 0.05));
      let peak = 0;
      const blocks = [];
      for (let from = start; from < end; from += block) {
        const to = Math.min(end, from + block);
        let energy = 0;
        for (const samples of channels) {
          for (let frame = from; frame < to; frame++) {
            const sample = samples[frame];
            energy += sample * sample;
            peak = Math.max(peak, Math.abs(sample));
          }
        }
        const count = (to - from) * channels.length;
        blocks.push({energy, count});
      }
      const threshold = Math.max(1e-7, peak * peak * 0.0001);
      let energy = 0;
      let count = 0;
      for (const entry of blocks) {
        if (entry.energy / entry.count < threshold) continue;
        energy += entry.energy;
        count += entry.count;
      }
      return {rms: count ? Math.sqrt(energy / count) : 0, peak};
    });
    if (levels.some(({rms}) => !rms)) return null;
    const target = Math.min(...levels.map(({rms, peak}) => rms * Math.min(1, 0.85 / peak)));
    return levels.map(({rms}) => target / rms);
  }

  function mount(root) {
    const item = (name) => root.querySelector(`#compare-${name}`);
    const play = item('play');
    const status = item('status');
    const tracks = [null, null];
    const revisions = [0, 0];
    const loading = [false, false];
    const offsets = ['a', 'b'].map((key) => item(`offset-${key}`));
    const switches = ['a', 'b'].map(item);
    let audio;
    let playback;
    let starting = false;
    let blocked = false;
    let selected = 0;

    function render() {
      const ready = tracks.every(Boolean) && !loading.some(Boolean) && !blocked;
      play.disabled = !ready || starting;
      play.textContent = playback ? 'Durdur' : 'Karşılaştırmayı başlat';
      switches.forEach((button, index) => {
        button.disabled = !ready;
        button.setAttribute('aria-pressed', String(index === selected));
      });
    }

    function stop() {
      const playing = playback;
      if (!playing) return;
      playback = null;
      for (const source of playing.sources) {
        source.onended = null;
        try { source.stop(); } catch {}
        source.disconnect();
      }
      playing.gains.forEach((gain) => gain.disconnect());
      status.textContent = 'Karşılaştırma durdu.';
      render();
    }

    const context = () => {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!audio) audio = new Audio();
      return audio;
    };

    for (const [index, key] of ['a', 'b'].entries()) {
      const input = item(`file-${key}`);
      input.addEventListener('change', async () => {
        stop();
        const revision = ++revisions[index];
        tracks[index] = null;
        offsets[index].value = '0';
        const file = input.files[0];
        loading[index] = Boolean(file);
        status.textContent = file ? 'Ses dosyası okunuyor…' : 'İki ses dosyası seç.';
        render();
        if (!file) return;
        try {
          if (file.size > 96 * 1024 * 1024) throw new Error('96 MB’a kadar bir ses dosyası seç.');
          const track = await context().decodeAudioData(await file.arrayBuffer());
          if (revision !== revisions[index]) return;
          if (track.duration > 600 || track.numberOfChannels > 2) throw new Error('10 dakikaya kadar mono veya stereo bir kayıt seç.');
          tracks[index] = track;
          status.textContent = tracks.every(Boolean) ? 'Hazır. Başlangıçları ayarla ve karşılaştır.' : 'Diğer ses dosyasını seç.';
        } catch (error) {
          if (revision === revisions[index]) status.textContent = error.message || 'Bu ses dosyası açılamadı.';
        } finally {
          if (revision === revisions[index]) {
            loading[index] = false;
            render();
          }
        }
      });
      offsets[index].addEventListener('change', stop);
      switches[index].addEventListener('click', () => {
        selected = index;
        if (playback) playback.gains.forEach(({gain}, channel) => {
          gain.setTargetAtTime(channel === selected ? playback.levels[channel] : 0, audio.currentTime, 0.008);
        });
        render();
      });
    }

    play.addEventListener('click', async () => {
      if (playback) { stop(); return; }
      if (blocked || starting || !tracks.every(Boolean)) return;
      const clips = tracks.slice();
      const times = offsets.map((input) => Number(input.value));
      const length = Math.min(...clips.map((clip, index) => clip.duration - times[index]));
      if (offsets.some((input) => !input.validity.valid) || times.some((time) => !Number.isFinite(time) || time < 0) || length < 0.1) {
        status.textContent = 'İki başlangıcı da dosya süresinin içinde seç.';
        return;
      }
      starting = true;
      render();
      try {
        await context().resume();
        if (blocked || clips.some((clip, index) => clip !== tracks[index])) return;
        const levels = matchedGains(clips, times, length);
        if (!levels) { status.textContent = 'Kayıtlardan birinde seçili aralıkta duyulur ses bulunamadı.'; return; }
        const gains = levels.map((level, index) => {
          const node = audio.createGain();
          node.gain.value = index === selected ? level : 0;
          node.connect(audio.destination);
          return node;
        });
        const sources = clips.map((clip, index) => {
          const source = audio.createBufferSource();
          source.buffer = clip;
          source.connect(gains[index]);
          return source;
        });
        playback = {sources, gains, levels};
        sources[0].onended = stop;
        const at = audio.currentTime + 0.025;
        sources.forEach((source, index) => source.start(at, times[index], length));
        status.textContent = 'Dinleme seviyeleri eşitlendi. Çalarken A ve B arasında geçebilirsin.';
      } catch {
        stop();
        status.textContent = 'Ses çalınamadı. Mac’in ses çıkışını kontrol et.';
      } finally {
        starting = false;
        render();
      }
    });

    return {setBlocked(value) {
      if (blocked === value) return;
      blocked = value;
      if (blocked) stop();
      render();
    }};
  }

  return {matchedGains, mount};
})();
