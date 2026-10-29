/* "Neon Sprint" - original upbeat 144 BPM arcade loop for this game.
 * Synthesized locally once with Web Audio: no downloads, samples, or streaming.
 * Playback starts only after a user gesture, pauses with the game, and never stacks
 * multiple loops on restart. Music failures must not interrupt gameplay.
 * Gameplay cues share the mute control and audio context. Successful soft drops
 * get a quiet, rate-limited tick; hard drops an impact; completed clears an
 * ascending reward; game over stops the backing track for a descending cadence.
 */
(function (root) {
  'use strict';
  const BPM = 144;
  const BEAT = 60 / BPM;
  const BARS = 16;
  const DURATION = BARS * 4 * BEAT;
  const SAMPLE_RATE = 44100;
  const VOLUME = 0.36;
  const STORAGE_KEY = 'one-more-line.tetris.music.v1';
  const CHORDS = [[48, 52, 55], [45, 48, 52], [41, 45, 48], [43, 47, 50]];
  // Sixteenth-note positions, MIDI pitches, and sixteenth-note durations.
  const MELODY = [
    [[0, 76, 2], [3, 79, 1], [4, 81, 2], [6, 79, 2], [8, 76, 2], [10, 72, 2], [12, 74, 2], [14, 76, 2]],
    [[0, 76, 3], [4, 81, 2], [6, 79, 1], [8, 76, 2], [11, 72, 1], [12, 76, 2], [14, 79, 2]],
    [[0, 77, 2], [2, 81, 2], [5, 84, 1], [6, 81, 2], [8, 79, 2], [10, 77, 2], [12, 76, 2], [14, 72, 2]],
    [[0, 74, 2], [3, 79, 1], [4, 83, 2], [6, 81, 2], [8, 79, 3], [12, 74, 2], [14, 71, 2]],
    [[0, 72, 2], [2, 76, 2], [4, 79, 2], [7, 76, 1], [8, 81, 2], [10, 79, 2], [12, 76, 3]],
    [[0, 81, 3], [4, 79, 2], [6, 76, 2], [8, 72, 2], [10, 76, 2], [13, 79, 1], [14, 81, 2]],
    [[0, 81, 2], [2, 84, 2], [4, 81, 2], [6, 77, 2], [9, 79, 1], [10, 81, 2], [12, 77, 2], [14, 76, 2]],
    [[0, 79, 2], [2, 74, 2], [4, 71, 2], [6, 74, 2], [8, 79, 2], [10, 81, 1], [11, 79, 1], [12, 76, 2], [14, 74, 2]]
  ];
  const frequency = midi => 440 * Math.pow(2, (midi - 69) / 12);

  async function renderTrack() {
    const length = Math.round(DURATION * SAMPLE_RATE);
    const buffer = new AudioBuffer({ numberOfChannels: 2, length, sampleRate: SAMPLE_RATE });
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);
    // Build PCM in short, yielded batches instead of a large native audio graph.
    // This keeps initial synthesis responsive and independent of audio-driver timing.
    function add(index, value, l, r) {
      const position = index >= length ? index - length : index;
      left[position] += value * l;
      right[position] += value * r;
    }

    function note(midi, time, duration, volume, type = 'triangle', pan = 0) {
      const start = Math.round(time * SAMPLE_RATE);
      const count = Math.round(duration * SAMPLE_RATE);
      const phaseStep = 2 * Math.PI * frequency(midi) / SAMPLE_RATE;
      const l = Math.sqrt((1 - pan) / 2);
      const r = Math.sqrt((1 + pan) / 2);
      for (let i = 0; i < count; i++) {
        const phase = i * phaseStep;
        // Truncated harmonic series: bright chiptune timbre without harsh upper aliases.
        let wave = Math.sin(phase);
        if (type === 'triangle') wave = (wave - Math.sin(phase * 3) / 9 + Math.sin(phase * 5) / 25) * 0.81;
        else if (type === 'square') wave = (wave + Math.sin(phase * 3) / 3 + Math.sin(phase * 5) / 5) * 0.85;
        const progress = i / count;
        const envelope = Math.min(1, i / (SAMPLE_RATE * 0.008)) * (1 - 0.55 * progress) * Math.min(1, (1 - progress) / 0.15);
        // Modulo mixing also wraps delayed notes across the loop boundary.
        add(start + i, wave * volume * envelope, l, r);
      }
    }

    const samples = new Float32Array(SAMPLE_RATE);
    let seed = 92741;
    for (let i = 0; i < samples.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      samples[i] = seed / 2147483648 - 1;
    }
    function percussion(time, duration, volume, cutoff, pan = 0) {
      const start = Math.round(time * SAMPLE_RATE);
      const count = Math.round(duration * SAMPLE_RATE);
      const coefficient = Math.exp(-2 * Math.PI * cutoff / SAMPLE_RATE);
      const l = Math.sqrt((1 - pan) / 2);
      const r = Math.sqrt((1 + pan) / 2);
      let previous = 0;
      let filtered = 0;
      for (let i = 0; i < count; i++) {
        const input = samples[i];
        filtered = coefficient * (filtered + input - previous);
        previous = input;
        const envelope = Math.min(1, i / (SAMPLE_RATE * 0.002)) * Math.pow(1 - i / count, 3);
        add(start + i, filtered * volume * envelope, l, r);
      }
    }
    function kick(time) {
      const start = Math.round(time * SAMPLE_RATE);
      const count = Math.round(0.23 * SAMPLE_RATE);
      for (let i = 0; i < count; i++) {
        const t = i / SAMPLE_RATE;
        const phase = 2 * Math.PI * (46 * t + 89 * 0.03 * (1 - Math.exp(-t / 0.03)));
        const envelope = Math.min(1, t / 0.003) * Math.exp(-t / 0.045) * Math.min(1, (0.23 - t) / 0.02);
        add(start + i, Math.sin(phase) * envelope * 0.45, 0.707, 0.707);
      }
    }

    for (let bar = 0; bar < BARS; bar++) {
      const time = bar * 4 * BEAT;
      const chord = CHORDS[bar % CHORDS.length];
      for (const [step, pitch, duration] of MELODY[bar % MELODY.length]) {
        const at = time + step * BEAT / 4;
        note(pitch, at, duration * BEAT / 4 * 0.9, 0.19, 'triangle', -0.08);
        note(pitch, at, duration * BEAT / 4 * 0.75, 0.035, 'square', 0.08);
        // Soft single-tap echo adds space without muddying the rhythm.
        note(pitch, at + BEAT * 0.75, duration * BEAT / 4 * 0.65, 0.035, 'triangle', 0.42);
      }
      chord.forEach((pitch, i) => note(pitch + 12, time, BEAT * 3.8, 0.026, 'triangle', (i - 1) * 0.5));
      for (let eighth = 0; eighth < 8; eighth++) {
        const at = time + eighth * BEAT / 2;
        note(chord[0] - (eighth % 2 ? 0 : 12), at, BEAT * 0.38, 0.17, 'triangle');
        note(chord[[0, 1, 2, 1][eighth % 4]] + 24, at + BEAT / 4, BEAT * 0.18,
          bar < 8 ? 0.035 : 0.055, 'sine', eighth % 2 ? -0.45 : 0.45);
        percussion(at, eighth % 2 ? 0.09 : 0.045, eighth % 2 ? 0.055 : 0.032, 7500, 0.3);
      }
      for (let beat = 0; beat < 4; beat++) {
        kick(time + beat * BEAT);
        if (beat % 2) {
          percussion(time + beat * BEAT, 0.12, 0.13, 1600, -0.15);
          note(50, time + beat * BEAT, 0.08, 0.085, 'sine');
        }
      }
      if (bar % 8 === 7) {
        for (let step = 13; step < 16; step++) percussion(time + step * BEAT / 4, 0.06, 0.045, 2300);
      }
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    let peak = 0;
    for (const channel of [left, right]) for (const value of channel) peak = Math.max(peak, Math.abs(value));
    // Fixed headroom regardless of summed instrumentation; no clipping on the master.
    if (peak > 0) for (let channel = 0; channel < 2; channel++) {
      const samples = buffer.getChannelData(channel);
      for (let i = 0; i < samples.length; i++) samples[i] *= 0.7 / peak;
    }
    return buffer;
  }

  function renderEffect(context, kind, count = 1) {
    // [start seconds, MIDI pitch, length seconds, relative gain, final MIDI pitch]
    // Small cached PCM buffers avoid per-frame synthesis or audio-node explosions.
    let notes;
    let peak;
    if (kind === 'soft') {
      notes = [[0, 72, 0.045, 1, 67]];
      peak = 0.045;
    } else if (kind === 'hard') {
      notes = [[0, 60, 0.16, 1, 31], [0.005, 84, 0.045, 0.25, 60]];
      peak = 0.20;
    } else if (kind === 'clear') {
      const pitches = [72, 76, 79, 84, 88, 91].slice(0, count + 2);
      notes = pitches.map((pitch, i) => [i * BEAT / 6, pitch, 0.23, 0.65, pitch]);
      const end = (pitches.length - 1) * BEAT / 6;
      notes.push([end, 60, 0.30, 0.24, 60], [end, 67, 0.30, 0.22, 67]);
      peak = 0.23;
    } else if (kind === 'over') {
      notes = [76, 72, 67, 60].map((pitch, i) => [i * BEAT / 2, pitch, i === 3 ? 0.65 : 0.25, 0.65, pitch]);
      notes.push([BEAT * 1.5, 48, 0.65, 0.30, 48]);
      peak = 0.22;
    } else return null;

    const duration = Math.max(...notes.map(note => note[0] + note[2]));
    const buffer = context.createBuffer(1, Math.ceil(duration * SAMPLE_RATE), SAMPLE_RATE);
    const samples = buffer.getChannelData(0);
    for (const [at, pitch, length, gain, endPitch] of notes) {
      const start = Math.round(at * SAMPLE_RATE);
      const frames = Math.floor(length * SAMPLE_RATE);
      const hz = frequency(pitch);
      const endHz = frequency(endPitch);
      let phase = 0;
      for (let i = 0; i < frames && start + i < samples.length; i++) {
        const progress = i / frames;
        const envelope = Math.min(1, i / (SAMPLE_RATE * 0.004)) * Math.pow(1 - progress, 2);
        const wave = Math.sin(phase) + 0.18 * Math.sin(phase * 2) + 0.06 * Math.sin(phase * 3);
        samples[start + i] += wave * gain * envelope;
        phase += 2 * Math.PI * hz * Math.pow(endHz / hz, progress) / SAMPLE_RATE;
      }
    }
    let maximum = 0;
    for (const value of samples) maximum = Math.max(maximum, Math.abs(value));
    if (maximum > 0) for (let i = 0; i < samples.length; i++) samples[i] *= peak / maximum;
    return buffer;
  }

  class Music {
    constructor(onChange = () => {}) {
      this.onChange = onChange;
      this.enabled = true;
      this.available = Boolean((root.AudioContext || root.webkitAudioContext) && root.AudioBuffer);
      this.context = null;
      this.buffer = null;
      this.bufferPromise = null;
      this.source = null;
      this.envelope = null;
      this.wanted = false;
      this.offset = 0;
      this.startedAt = 0;
      this.generation = 0;
      this.effectBuffers = new Map();
      this.effects = new Map();
      this.lastSoftAt = -Infinity;
      try { this.enabled = localStorage.getItem(STORAGE_KEY) !== 'off'; } catch (_) { /* Session-only preference. */ }
    }

    play(restart = false) {
      this.wanted = true;
      if (restart) { this.stopSource(); this.stopEffects(); this.offset = 0; }
      this.sync();
    }

    pause() {
      this.wanted = false;
      this.generation++;
      this.stopSource();
      this.stopEffects();
      this.onChange();
    }

    toggle() {
      this.enabled = !this.enabled;
      if (!this.enabled) this.stopEffects();
      try { localStorage.setItem(STORAGE_KEY, this.enabled ? 'on' : 'off'); } catch (_) { /* Audio remains usable without storage. */ }
      this.sync();
      this.onChange();
    }

    stopEffect(kind) {
      const voice = this.effects.get(kind);
      if (!voice) return;
      const now = this.context.currentTime;
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
      voice.gain.gain.linearRampToValueAtTime(0, now + 0.01);
      voice.source.stop(now + 0.012);
      this.effects.delete(kind);
    }

    stopEffects() {
      for (const kind of this.effects.keys()) this.stopEffect(kind);
      this.lastSoftAt = -Infinity;
    }

    effect(kind, count = 1) {
      // Never unlock audio from a simulation event or queue sounds for a later tab.
      if (!this.available || !this.enabled || !this.context || this.context.state !== 'running') return false;
      if (!['soft', 'hard', 'clear', 'over'].includes(kind)) return false;
      if (kind !== 'over' && !this.wanted) return false;
      const now = this.context.currentTime;
      if (kind === 'soft' && now - this.lastSoftAt < 0.065) return false;
      count = Math.max(1, Math.min(4, Math.trunc(count) || 1));
      try {
        if (kind === 'over') {
          this.pause();
        } else {
          this.stopEffect(kind);
          if (kind === 'hard' || kind === 'clear') this.stopEffect('soft');
        }
        const key = kind === 'clear' ? `clear-${count}` : kind;
        if (!this.effectBuffers.has(key)) this.effectBuffers.set(key, renderEffect(this.context, kind, count));
        const source = this.context.createBufferSource();
        const gain = this.context.createGain();
        source.buffer = this.effectBuffers.get(key);
        gain.gain.setValueAtTime(1, now);
        source.connect(gain).connect(this.context.destination);
        const voice = { source, gain, key };
        source.onended = () => {
          source.disconnect();
          gain.disconnect();
          if (this.effects.get(kind) === voice) this.effects.delete(kind);
        };
        source.start(now);
        this.effects.set(kind, voice);
        if (kind === 'soft') this.lastSoftAt = now;
        return true;
      } catch (_) {
        // Sound is optional; an unsupported audio operation never breaks input.
        this.stopEffects();
        return false;
      }
    }

    stopSource() {
      if (!this.source) return;
      const now = this.context.currentTime;
      this.offset = (this.offset + Math.max(0, now - this.startedAt)) % this.buffer.duration;
      this.envelope.gain.cancelScheduledValues(now);
      this.envelope.gain.setValueAtTime(this.envelope.gain.value, now);
      this.envelope.gain.linearRampToValueAtTime(0, now + 0.02);
      this.source.stop(now + 0.025);
      this.source = null;
      this.envelope = null;
    }

    async sync() {
      const generation = ++this.generation;
      if (!this.available || !this.wanted || !this.enabled) { this.stopSource(); return; }
      try {
        if (!this.context) {
          const AudioContext = root.AudioContext || root.webkitAudioContext;
          this.context = new AudioContext();
        }
        // Called directly from start/resume/toggle user gestures, respecting autoplay rules.
        await this.context.resume();
        if (generation !== this.generation) return;
        if (!this.bufferPromise) this.bufferPromise = renderTrack();
        this.buffer = await this.bufferPromise;
        if (generation !== this.generation || !this.wanted || !this.enabled || this.source) return;
        const source = this.context.createBufferSource();
        const envelope = this.context.createGain();
        source.buffer = this.buffer;
        source.loop = true;
        const now = this.context.currentTime;
        envelope.gain.setValueAtTime(0, now);
        envelope.gain.linearRampToValueAtTime(VOLUME, now + 0.03);
        source.connect(envelope).connect(this.context.destination);
        source.onended = () => { source.disconnect(); envelope.disconnect(); };
        this.startedAt = now;
        source.start(now, this.offset);
        this.source = source;
        this.envelope = envelope;
        this.onChange();
      } catch (_) {
        // Unsupported/denied audio is non-fatal, and no rejected promise escapes.
        if (generation !== this.generation) return;
        this.available = false;
        this.stopSource();
        this.onChange();
      }
    }
  }

  Music.track = Object.freeze({ title: 'Neon Sprint', bpm: BPM, duration: DURATION });
  Music.renderTrack = renderTrack;
  root.TetrisMusic = Music;
})(globalThis);
