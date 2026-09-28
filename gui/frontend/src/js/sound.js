'use strict';

  // ── Sound Alerts Manager ───────────────────────────────────────────────────
  const SoundManager = {
    audioCtx: null,
    soundVolumes: {
      connect: 1,
      disconnect: 1,
      dsu: 1,
      recenter: 1,
      goal: 1,
      defeat: 1,
      loss: 1
    },
    _lastPlayTs: { connect: 0, disconnect: 0, dsu: 0, recenter: 0, goal: 0, defeat: 0, loss: 0 },
    _curEffectiveVol: 1,

    getAudioContext() {
      if (!this.audioCtx) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (AudioContextClass) {
          this.audioCtx = new AudioContextClass();
        }
      }
      if (this.audioCtx && this.audioCtx.state === 'suspended') {
        this.audioCtx.resume().catch(() => {});
      }
      return this.audioCtx;
    },

    getMode() {
      if (SettingsManager.currentSettings && SettingsManager.currentSettings.soundMode) {
        return SettingsManager.currentSettings.soundMode;
      }
      const sel = document.getElementById('setting-sound-mode');
      return sel?.value || 'cute';
    },

    getMasterVolume() {
      const slider = document.getElementById('setting-sound-volume');
      if (slider) {
        const parsed = parseInt(slider.value, 10);
        if (!isNaN(parsed)) return parsed;
      }
      if (SettingsManager.currentSettings && typeof SettingsManager.currentSettings.soundVolume === 'number') {
        return SettingsManager.currentSettings.soundVolume;
      }
      return 1;
    },

    getVolume(type) {
      const master = this.getMasterVolume();
      if (master <= 0) return 0;
      if (!type) return master;

      let individual = 1;
      const el = document.getElementById(`setting-sound-vol-${type}`);
      if (el) {
        const parsed = parseInt(el.value, 10);
        if (!isNaN(parsed)) individual = parsed;
      } else if (this.soundVolumes && typeof this.soundVolumes[type] === 'number') {
        individual = this.soundVolumes[type];
      } else if (SettingsManager.currentSettings?.soundVolumes && typeof SettingsManager.currentSettings.soundVolumes[type] === 'number') {
        individual = SettingsManager.currentSettings.soundVolumes[type];
      }

      if (individual <= 0) return 0;
      return individual;
    },

    getEffectiveVolume(type, force = false) {
      const master = this.getMasterVolume();
      if (master <= 0 && !force) return 0;
      let ind = this.getVolume(type);
      if (force && ind <= 0) ind = 1;
      if (ind <= 0) return 0;
      const effMaster = (master > 0) ? master : 1;
      return Math.min(3.0, (effMaster * ind) / 1.0);
    },

    async play(type, force = false) {
      const mode = this.getMode();
      const masterVol = this.getMasterVolume();
      if (!force && (mode === 'off' || masterVol <= 0)) return;

      const indVol = this.getVolume(type);
      if (!force && indVol <= 0) return;

      const now = Date.now();
      const minInterval = (type === 'loss') ? 5000 : (type === 'defeat') ? 1200 : (type === 'goal') ? 700 : (type === 'recenter') ? 140 : 600;
      if (!force && this._lastPlayTs[type] && now - this._lastPlayTs[type] < minInterval) {
        return;
      }

      this._lastPlayTs[type] = now;
      this._curEffectiveVol = this.getEffectiveVolume(type, force) || 1.0;

      if (type === 'goal') {
        this.playCuteGoal();
        return;
      }
      if (type === 'loss') {
        if (mode === 'windows') {
          if (window.go?.main?.App?.PlaySystemSound) {
            try { window.go.main.App.PlaySystemSound('loss'); } catch (e) {}
          }
        } else {
          this.playCuteLoss();
        }
        return;
      }
      if (type === 'defeat') {
        if (mode === 'windows') {
          if (window.go?.main?.App?.PlaySystemSound) {
            try { window.go.main.App.PlaySystemSound('defeat'); } catch (e) {}
          }
        } else {
          this.playCuteDefeat();
        }
        return;
      }
      if (type === 'recenter') {
        if (mode === 'windows') {
          if (window.go?.main?.App?.PlaySystemSound) {
            try { window.go.main.App.PlaySystemSound('recenter'); } catch (e) {}
          }
        } else {
          this.playCuteRecenter();
        }
        return;
      }
      if (type === 'dsu') {
        if (mode === 'windows') {
          if (window.go?.main?.App?.PlaySystemSound) {
            try { window.go.main.App.PlaySystemSound('dsu'); } catch (e) {}
          }
        } else {
          this.playCuteDSUConnect();
        }
        return;
      }

      if (mode === 'windows') {
        if (window.go?.main?.App?.PlaySystemSound) {
          try {
            window.go.main.App.PlaySystemSound(type);
          } catch (e) {
            console.warn('PlaySystemSound error:', e);
          }
        }
        return;
      }

      // Synthesized celesta arpeggios via Web Audio API
      if (type === 'connect') {
        this.playCuteConnect();
      } else if (type === 'disconnect') {
        this.playCuteDisconnect();
      }
    },

    playTone(freq, startTime, duration, gainValue = 0.12, type = 'sine') {
      const vol = this._curEffectiveVol || this.getMasterVolume();
      if (vol <= 0) return;
      const ctx = this.getAudioContext();
      if (!ctx) return;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, startTime);

      const effectiveGain = Math.min(1.0, gainValue * vol);
      gain.gain.setValueAtTime(0.0001, startTime);
      gain.gain.exponentialRampToValueAtTime(effectiveGain, startTime + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(startTime);
      osc.stop(startTime + duration);
    },

    playFMBell(freq, startTime, duration, gainVal = 0.16, modRatio = 2.756, modDepth = 2.4) {
      const vol = this._curEffectiveVol || this.getMasterVolume();
      if (vol <= 0) return;
      const ctx = this.getAudioContext();
      if (!ctx) return;

      const carrier = ctx.createOscillator();
      const modulator = ctx.createOscillator();
      const modGain = ctx.createGain();
      const mainGain = ctx.createGain();

      carrier.type = 'sine';
      carrier.frequency.setValueAtTime(freq, startTime);

      modulator.type = 'sine';
      modulator.frequency.setValueAtTime(freq * modRatio, startTime);

      modGain.gain.setValueAtTime(freq * modDepth, startTime);
      modGain.gain.exponentialRampToValueAtTime(0.01, startTime + Math.min(duration, 0.14));

      modulator.connect(modGain);
      modGain.connect(carrier.frequency);

      const effectiveGain = Math.min(1.0, gainVal * vol);
      mainGain.gain.setValueAtTime(0.0001, startTime);
      mainGain.gain.exponentialRampToValueAtTime(effectiveGain, startTime + 0.008);
      mainGain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

      carrier.connect(mainGain);
      mainGain.connect(ctx.destination);

      carrier.start(startTime);
      modulator.start(startTime);
      carrier.stop(startTime + duration);
      modulator.stop(startTime + duration);
    },

    playToneSweep(fromFreq, toFreq, startTime, duration, gainVal = 0.15) {
      const vol = this._curEffectiveVol || this.getMasterVolume();
      if (vol <= 0) return;
      const ctx = this.getAudioContext();
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(fromFreq, startTime);
      osc.frequency.exponentialRampToValueAtTime(Math.max(10, toFreq), startTime + duration);
      const effectiveGain = Math.min(1.0, gainVal * vol);
      gain.gain.setValueAtTime(effectiveGain, startTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(startTime);
      osc.stop(startTime + duration);
    },

    playVoidPlunge(startTime, gainVal = 0.28, duration = 0.55) {
      const vol = this._curEffectiveVol || this.getMasterVolume();
      if (vol <= 0) return;
      const ctx = this.getAudioContext();
      if (!ctx) return;
      const bufferSize = Math.floor(ctx.sampleRate * duration);
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.65));
      }
      const noise = ctx.createBufferSource();
      noise.buffer = buffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 2.2;
      filter.frequency.setValueAtTime(2200, startTime);
      filter.frequency.exponentialRampToValueAtTime(240, startTime + duration * 0.88);
      const gain = ctx.createGain();
      const effectiveGain = Math.min(1.0, gainVal * vol);
      gain.gain.setValueAtTime(0.001, startTime);
      gain.gain.exponentialRampToValueAtTime(effectiveGain, startTime + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
      noise.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      noise.start(startTime);
      noise.stop(startTime + duration);
    },

    playCuteConnect() {
      const ctx = this.getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      // Uplifting arpeggio: C5 (523Hz), E5 (659Hz), G5 (784Hz), C6 (1046Hz)
      const notes = [
        { f: 523.25, t: 0.00, d: 0.22, g: 0.13 },
        { f: 659.25, t: 0.07, d: 0.22, g: 0.14 },
        { f: 783.99, t: 0.14, d: 0.24, g: 0.15 },
        { f: 1046.50, t: 0.21, d: 0.38, g: 0.16 }
      ];
      for (const n of notes) {
        this.playTone(n.f, now + n.t, n.d, n.g, 'sine');
      }
    },

    playCuteDisconnect() {
      const ctx = this.getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      // Soft descending drop: G5 (784Hz), Eb5 (622Hz), C5 (523Hz)
      const notes = [
        { f: 783.99, t: 0.00, d: 0.18, g: 0.13 },
        { f: 622.25, t: 0.08, d: 0.20, g: 0.12 },
        { f: 523.25, t: 0.17, d: 0.32, g: 0.11 }
      ];
      for (const n of notes) {
        this.playTone(n.f, now + n.t, n.d, n.g, 'sine');
      }
    },

    playCuteLoss() {
      const ctx = this.getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      // Quiet two-note sigh (D5 -> B4), well below the disconnect cue: tells the
      // player the link is struggling without startling them mid-game.
      this.playTone(587.33, now + 0.00, 0.30, 0.06, 'sine');
      this.playTone(493.88, now + 0.16, 0.42, 0.05, 'sine');
    },

    playCuteDSUConnect() {
      const ctx = this.getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      // Bright crystalline 2-tone FM bell chime:
      // Note 1: E6 (1318.51 Hz) - crisp bright chime
      // Note 2: A6 (1760.00 Hz) - rising resolving bell
      this.playFMBell(1318.51, now + 0.00, 0.26, 0.16, 2.756, 2.2);
      this.playFMBell(1760.00, now + 0.10, 0.44, 0.18, 2.756, 2.2);
    },

    playCuteRecenter() {
      const ctx = this.getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      // Tactile electronic crosshair zero-lock snap:
      this.playTone(220, now, 0.035, 0.18, 'triangle');
      this.playTone(880.00, now + 0.015, 0.10, 0.14, 'sine');
      this.playFMBell(1108.73, now + 0.045, 0.22, 0.16, 2.0, 1.5);
    },

    playCuteGoal() {
      const ctx = this.getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      // Legendary Zelda Secret / Puzzle Solved Fanfare (8 notes + resolving major chord)
      const melody = [
        { f: 783.99, t: 0.00, d: 0.22, g: 0.16 }, // G5
        { f: 739.99, t: 0.10, d: 0.22, g: 0.16 }, // F#5
        { f: 622.25, t: 0.20, d: 0.22, g: 0.17 }, // D#5
        { f: 440.00, t: 0.30, d: 0.22, g: 0.18 }, // A4
        { f: 415.30, t: 0.40, d: 0.24, g: 0.18 }, // G#4
        { f: 659.25, t: 0.50, d: 0.24, g: 0.19 }, // E5
        { f: 830.61, t: 0.60, d: 0.26, g: 0.20 }, // G#5
        { f: 1046.5, t: 0.70, d: 0.95, g: 0.22 }, // C6 (triumphal resolve)
        // Resolving harmony chord under C6
        { f: 523.25, t: 0.71, d: 0.90, g: 0.13 }, // C5
        { f: 1318.5, t: 0.72, d: 0.85, g: 0.14 }, // E6
        { f: 1567.9, t: 0.73, d: 0.80, g: 0.12 }  // G6
      ];
      for (const n of melody) {
        this.playFMBell(n.f, now + n.t, n.d, n.g, 2.756, 2.4);
      }
    },

    playCuteDefeat() {
      const ctx = this.getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      // Zelda shrine orb plunging into the bottomless abyss:
      // 1. Cascading crystal FM bells (melancholy descending arpeggio, rich & punchy)
      const chimes = [
        { f: 783.99, t: 0.00, d: 0.32, g: 0.24, r: 2.756, m: 2.0 }, // G5
        { f: 622.25, t: 0.10, d: 0.35, g: 0.25, r: 2.756, m: 2.0 }, // Eb5
        { f: 523.25, t: 0.20, d: 0.38, g: 0.26, r: 2.756, m: 2.2 }, // C5
        { f: 415.30, t: 0.30, d: 0.42, g: 0.27, r: 2.756, m: 2.2 }, // Ab4
        { f: 349.23, t: 0.40, d: 0.58, g: 0.28, r: 2.756, m: 2.4 }  // F4
      ];
      for (const n of chimes) {
        this.playFMBell(n.f, now + n.t, n.d, n.g, n.r, n.m);
      }

      // 2. Visceral pitch plunge slide (880Hz -> 180Hz descending whistle glide)
      this.playToneSweep(880, 180, now + 0.02, 0.48, 0.24);

      // 3. Resonant abyss wind plunge (rushing air whoosh)
      this.playVoidPlunge(now + 0.02, 0.28, 0.52);

      // 4. Distant cavern floor impact strike ("DUNNNN" resonant gong)
      this.playFMBell(115, now + 0.44, 0.48, 0.32, 1.5, 2.6);
      this.playTone(95, now + 0.44, 0.35, 0.26, 'sine');
    },

    preview(type) {
      if (type) {
        this.play(type, true);
        return;
      }
      const sel = document.getElementById('setting-sound-mode');
      const mode = sel ? sel.value : this.getMode();
      if (mode === 'off') return;
      if (mode === 'windows') {
        if (window.go?.main?.App?.PlaySystemSound) {
          try { window.go.main.App.PlaySystemSound('connect'); } catch (e) {}
        }
      } else {
        this.playCuteConnect();
      }
    }
  };
