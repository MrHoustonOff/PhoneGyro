// Synthesized audio alerts (Web Audio API) and system sounds via Go bridge.
// Settings come from setSoundConfig() (AppSettings: soundMode, soundVolume, soundVolumes).

import { call, on } from './bridge.js';
import { onState } from './state.js';
import { getCurrentScreen } from '../shell/router.js';

let soundMode = 'cute'; // 'cute' | 'windows' | 'off'
let soundVolume = 1;    // master volume: 0..3
let soundVolumes = {
  connect: 1,
  disconnect: 1,
  dsu: 1,
  recenter: 1,
  goal: 1,
  defeat: 1,
  loss: 1,
  intro: 1,
};

const lastPlayTs = {
  connect: 0,
  disconnect: 0,
  dsu: 0,
  recenter: 0,
  goal: 0,
  defeat: 0,
  loss: 0,
  intro: 0,
};

let curEffectiveVol = 1.0;
let audioCtx = null;

const WIN_SOUNDS = ['connect', 'disconnect', 'dsu', 'recenter', 'defeat', 'loss'];

export function setSoundConfig(cfg = {}) {
  if (cfg.soundMode !== undefined) soundMode = cfg.soundMode;
  if (cfg.soundVolume !== undefined) soundVolume = cfg.soundVolume;
  if (cfg.soundVolumes) {
    soundVolumes = Object.assign({}, soundVolumes, cfg.soundVolumes);
  }
}

function getAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = (typeof window !== 'undefined') && (window.AudioContext || window.webkitAudioContext);
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

function getEffectiveVolume(type, force = false) {
  const master = soundVolume;
  if (master <= 0 && !force) return 0;
  let ind = soundVolumes[type];
  if (ind == null) ind = 1;
  if (force && ind <= 0) ind = 1;
  if (ind <= 0) return 0;
  const effMaster = (master > 0) ? master : 1;
  return Math.min(3.0, effMaster * ind);
}

// ── Synthesizer primitives (1-to-1 from LEGACY) ─────────────────────────────

function playTone(freq, startTime, duration, gainValue = 0.12, type = 'sine') {
  const vol = curEffectiveVol || soundVolume || 1.0;
  if (vol <= 0) return;
  const ctx = getAudioContext();
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
}

function playFMBell(freq, startTime, duration, gainVal = 0.16, modRatio = 2.756, modDepth = 2.4) {
  const vol = curEffectiveVol || soundVolume || 1.0;
  if (vol <= 0) return;
  const ctx = getAudioContext();
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
}

function playToneSweep(fromFreq, toFreq, startTime, duration, gainVal = 0.15) {
  const vol = curEffectiveVol || soundVolume || 1.0;
  if (vol <= 0) return;
  const ctx = getAudioContext();
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
}

function playVoidPlunge(startTime, gainVal = 0.28, duration = 0.55) {
  const vol = curEffectiveVol || soundVolume || 1.0;
  if (vol <= 0) return;
  const ctx = getAudioContext();
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
}

// ── Cute Melodies ────────────────────────────────────────────────────────────

function playCuteConnect() {
  const ctx = getAudioContext();
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
    playTone(n.f, now + n.t, n.d, n.g, 'sine');
  }
}

function playCuteDisconnect() {
  const ctx = getAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  // Soft descending drop: G5 (784Hz), Eb5 (622Hz), C5 (523Hz)
  const notes = [
    { f: 783.99, t: 0.00, d: 0.18, g: 0.13 },
    { f: 622.25, t: 0.08, d: 0.20, g: 0.12 },
    { f: 523.25, t: 0.17, d: 0.32, g: 0.11 }
  ];
  for (const n of notes) {
    playTone(n.f, now + n.t, n.d, n.g, 'sine');
  }
}

function playCuteLoss() {
  const ctx = getAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  // Quiet two-note sigh (D5 -> B4)
  playTone(587.33, now + 0.00, 0.30, 0.06, 'sine');
  playTone(493.88, now + 0.16, 0.42, 0.05, 'sine');
}

function playCuteDSUConnect() {
  const ctx = getAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  // Bright crystalline 2-tone FM bell chime: E6 -> A6
  playFMBell(1318.51, now + 0.00, 0.26, 0.16, 2.756, 2.2);
  playFMBell(1760.00, now + 0.10, 0.44, 0.18, 2.756, 2.2);
}

function playCuteRecenter() {
  const ctx = getAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  // Tactile electronic crosshair zero-lock snap
  playTone(220, now, 0.035, 0.18, 'triangle');
  playTone(880.00, now + 0.015, 0.10, 0.14, 'sine');
  playFMBell(1108.73, now + 0.045, 0.22, 0.16, 2.0, 1.5);
}

function playCuteGoal() {
  const ctx = getAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  // Zelda Secret / Puzzle Solved Fanfare (8 notes + resolving major chord)
  const melody = [
    { f: 783.99, t: 0.00, d: 0.22, g: 0.16 }, // G5
    { f: 739.99, t: 0.10, d: 0.22, g: 0.16 }, // F#5
    { f: 622.25, t: 0.20, d: 0.22, g: 0.17 }, // D#5
    { f: 440.00, t: 0.30, d: 0.22, g: 0.18 }, // A4
    { f: 415.30, t: 0.40, d: 0.24, g: 0.18 }, // G#4
    { f: 659.25, t: 0.50, d: 0.24, g: 0.19 }, // E5
    { f: 830.61, t: 0.60, d: 0.26, g: 0.20 }, // G#5
    { f: 1046.5, t: 0.70, d: 0.95, g: 0.22 }, // C6
    { f: 523.25, t: 0.71, d: 0.90, g: 0.13 }, // C5
    { f: 1318.5, t: 0.72, d: 0.85, g: 0.14 }, // E6
    { f: 1567.9, t: 0.73, d: 0.80, g: 0.12 }  // G6
  ];
  for (const n of melody) {
    playFMBell(n.f, now + n.t, n.d, n.g, 2.756, 2.4);
  }
}

function playCuteDefeat() {
  const ctx = getAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  // Zelda shrine orb plunging into the bottomless abyss
  const chimes = [
    { f: 783.99, t: 0.00, d: 0.32, g: 0.24, r: 2.756, m: 2.0 }, // G5
    { f: 622.25, t: 0.10, d: 0.35, g: 0.25, r: 2.756, m: 2.0 }, // Eb5
    { f: 523.25, t: 0.20, d: 0.38, g: 0.26, r: 2.756, m: 2.2 }, // C5
    { f: 415.30, t: 0.30, d: 0.42, g: 0.27, r: 2.756, m: 2.2 }, // Ab4
    { f: 349.23, t: 0.40, d: 0.58, g: 0.28, r: 2.756, m: 2.4 }  // F4
  ];
  for (const n of chimes) {
    playFMBell(n.f, now + n.t, n.d, n.g, n.r, n.m);
  }
  playToneSweep(880, 180, now + 0.02, 0.48, 0.24);
  playVoidPlunge(now + 0.02, 0.28, 0.52);
  playFMBell(115, now + 0.44, 0.48, 0.32, 1.5, 2.6);
  playTone(95, now + 0.44, 0.35, 0.26, 'sine');
}

const INTRO_BASE = 0.2;

function playIntroAudio(gain) {
  try {
    const soundUrl = new URL('../../assets/sounds/intro.wav', import.meta.url).href;
    const audio = new Audio(soundUrl);
    audio.volume = gain;
    audio.play().catch((e) => {
      console.warn('Intro playback blocked or failed:', e);
    });
  } catch (err) {
    console.warn('Intro audio error:', err);
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

export async function playSound(type, { force = false } = {}) {
  const mode = soundMode;
  const masterVol = soundVolume;

  if (type === 'intro') {
    if (!force && (mode === 'off' || masterVol <= 0)) return;
    const indVol = soundVolumes.intro != null ? soundVolumes.intro : 1;
    if (!force && indVol <= 0) return;

    const effMaster = (!force && masterVol <= 0) ? 0 : (masterVol > 0 ? masterVol : 1);
    const effInd = (!force && indVol <= 0) ? 0 : (indVol > 0 ? indVol : 1);
    const gain = Math.min(1.0, INTRO_BASE * effMaster * effInd);
    if (gain <= 0) return;

    playIntroAudio(gain);
    return;
  }

  if (!force && (mode === 'off' || masterVol <= 0)) return;

  const indVol = soundVolumes[type] != null ? soundVolumes[type] : 1;
  if (!force && indVol <= 0) return;

  const now = Date.now();
  const minInterval = (type === 'loss') ? 5000 : (type === 'defeat') ? 1200 : (type === 'goal') ? 700 : (type === 'recenter') ? 140 : 600;
  if (!force && lastPlayTs[type] && (now - lastPlayTs[type] < minInterval)) {
    return;
  }

  lastPlayTs[type] = now;
  curEffectiveVol = getEffectiveVolume(type, force) || 1.0;

  if (type === 'goal') {
    playCuteGoal();
    return;
  }

  if (mode === 'windows' && WIN_SOUNDS.includes(type)) {
    try {
      await call('PlaySystemSound', type);
    } catch (e) {
      console.warn('PlaySystemSound error:', e);
    }
    return;
  }

  if (type === 'connect') {
    playCuteConnect();
  } else if (type === 'disconnect') {
    playCuteDisconnect();
  } else if (type === 'dsu') {
    playCuteDSUConnect();
  } else if (type === 'recenter') {
    playCuteRecenter();
  } else if (type === 'defeat') {
    playCuteDefeat();
  } else if (type === 'loss') {
    playCuteLoss();
  }
}

export function previewSound(type = 'connect') {
  if (soundMode === 'off') return;
  if (soundVolume <= 0) return;
  const ind = soundVolumes[type] != null ? soundVolumes[type] : 1;
  if (ind <= 0) return;
  playSound(type, { force: true });
}

export function startSound() {
  onState((st, prev) => {
    if (!prev) return; // First state on launch is ignored

    // Connect / Disconnect: status switch between offline and non-offline
    const prevOffline = !prev.status || prev.status === 'offline';
    const curOffline = !st.status || st.status === 'offline';
    if (prevOffline !== curOffline) {
      if (getCurrentScreen() !== 'calibration') {
        playSound(curOffline ? 'disconnect' : 'connect');
      }
    }

    // DSU: client count increased
    const prevDsu = prev.dsuClientList ? prev.dsuClientList.length : (prev.dsuClients || 0);
    const curDsu = st.dsuClientList ? st.dsuClientList.length : (st.dsuClients || 0);
    if (curDsu > prevDsu) {
      playSound('dsu');
    }
  });

  on('recenter:triggered', () => {
    playSound('recenter');
  });

  on('link:loss', () => {
    playSound('loss');
  });
}

