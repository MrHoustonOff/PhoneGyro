// Response Test Bench & Real-Time Motion Oscilloscope
// Provides real-time waveform tracking (Raw vs Filtered DSU),
// stability classification, noise suppression analysis,
// and live parameter tuning synchronized with Settings Motion group.
// Adheres strictly to Rule 0: zero continuous rAF or streaming when idle or offline.

import { $, toggleClass } from '../../core/dom.js';
import { on, off, call } from '../../core/bridge.js';
import { getState } from '../../core/state.js';
import { t } from '../../core/i18n.js';

export function initBench(container, options = {}) {
  if (!container) return { activate: () => {}, deactivate: () => {}, setParams: () => {}, setConnected: () => {} };

  // DOM Elements
  const canvas = $('bench-oscilloscope-canvas');
  const oscWrap = $('bench-osc-wrap');
  const sourceSeg = $('bench-source-seg');
  const axisSeg = $('bench-axis-seg');
  const recenterBtn = $('btn-bench-recenter');
  const stabilityBadge = $('bench-stability-badge');
  const noiseValEl = $('bench-noise-val');
  const rateValEl = $('bench-rate-val');
  const pingValEl = $('bench-ping-val');
  const sparkCanvas = $('bench-net-spark-canvas');
  const offlineOverlay = $('bench-offline-overlay');

  // State
  const MAX_HISTORY = 140;
  let activeAxis = localStorage.getItem('pg-bench-axis') || 'all'; // 'x' | 'y' | 'z' | 'all'
  let dataFeed = localStorage.getItem('pg-bench-feed') || 'dsu';    // 'dsu' | 'raw'
  let isActive = false;
  let isConnected = false;
  let renderScheduled = false;
  let lastFrameTs = 0;
  let lastDomUpdateTs = 0;
  let lastSpeed = 0;

  let currentDeadband = 0.10;
  let currentDeadbandUsb = 0.50;
  let currentSensitivity = 1.0;

  // Telemetry Buffers
  const pingHistory = [];
  const historyRaw = {
    x: new Array(MAX_HISTORY).fill(0),
    y: new Array(MAX_HISTORY).fill(0),
    z: new Array(MAX_HISTORY).fill(0),
  };
  const historyFilt = {
    x: new Array(MAX_HISTORY).fill(0),
    y: new Array(MAX_HISTORY).fill(0),
    z: new Array(MAX_HISTORY).fill(0),
  };
  const recentRawDev = [];
  const recentFiltDev = [];

  // Theme Tokens Reader
  function getThemeColors() {
    const cs = getComputedStyle(document.documentElement);
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    const axisX = cs.getPropertyValue('--axis-x').trim() || (isLight ? '#c2432f' : '#f29b88');
    const axisY = cs.getPropertyValue('--axis-y').trim() || (isLight ? '#5b7c26' : '#a3bc69');
    const axisZ = cs.getPropertyValue('--axis-z').trim() || (isLight ? '#3f7583' : '#87aab5');
    const warn = cs.getPropertyValue('--warn').trim() || (isLight ? '#b07c0c' : '#f2cc85');
    const ink = cs.getPropertyValue('--ink').trim() || (isLight ? '#0b0b0b' : '#f4f4f4');

    return {
      isLight,
      axisX,
      axisY,
      axisZ,
      warn,
      gridSeparator: isLight ? 'rgba(0, 0, 0, 0.10)' : 'rgba(255, 255, 255, 0.08)',
      gridCenter: isLight ? 'rgba(0, 0, 0, 0.24)' : 'rgba(255, 255, 255, 0.18)',
      gridBounds: isLight ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.06)',
      badgeBg: isLight ? 'rgba(0, 0, 0, 0.06)' : 'rgba(255, 255, 255, 0.10)',
      textColor: ink,
      rawColorSingle: isLight ? 'rgba(176, 124, 12, 0.55)' : 'rgba(242, 204, 133, 0.55)',
      rawColorAll: isLight ? 'rgba(176, 124, 12, 0.45)' : 'rgba(242, 204, 133, 0.45)',
    };
  }

  // Initialize UI Selections
  function syncUI() {
    if (sourceSeg) {
      sourceSeg.querySelectorAll('.pg-seg__btn').forEach((btn) => {
        toggleClass(btn, 'is-active', btn.dataset.source === dataFeed);
      });
    }
    if (axisSeg) {
      axisSeg.querySelectorAll('.pg-seg__btn').forEach((btn) => {
        toggleClass(btn, 'is-active', btn.dataset.axis === activeAxis);
      });
    }
    if (oscWrap) {
      toggleClass(oscWrap, 'mode-single', activeAxis !== 'all');
    }
  }

  function applyTuningParams() {
    call('SetTuningFilterParams', currentDeadband, currentDeadbandUsb, currentSensitivity);
  }

  // Event Listeners for UI Controls
  if (sourceSeg) {
    sourceSeg.addEventListener('click', (e) => {
      const btn = e.target.closest('.pg-seg__btn');
      if (!btn || !btn.dataset.source) return;
      dataFeed = btn.dataset.source;
      try {
        localStorage.setItem('pg-bench-feed', dataFeed);
      } catch (_) {}
      syncUI();
      scheduleDraw();
    });
  }

  if (axisSeg) {
    axisSeg.addEventListener('click', (e) => {
      const btn = e.target.closest('.pg-seg__btn');
      if (!btn || !btn.dataset.axis) return;
      activeAxis = btn.dataset.axis;
      try {
        localStorage.setItem('pg-bench-axis', activeAxis);
      } catch (_) {}
      syncUI();
      scheduleDraw();
    });
  }

  function handleRecenter() {
    call('ResetAHRS');
  }

  if (recenterBtn) {
    recenterBtn.addEventListener('click', handleRecenter);
  }

  // Keyboard shortcut: Space for recenter when active
  function handleKeyDown(e) {
    if (!isActive) return;
    if (e.code === 'Space' && !e.target.matches('input, textarea, select')) {
      e.preventDefault();
      handleRecenter();
    }
  }

  // Frame Receiver (Rule 0: draws on frame arrival, no continuous idle rAF)
  function handleFrame(frame) {
    if (!isActive || !frame) return;

    const rawX = frame.rawX ?? frame.RawX ?? 0;
    const rawY = frame.rawY ?? frame.RawY ?? 0;
    const rawZ = frame.rawZ ?? frame.RawZ ?? 0;
    const outX = frame.outX ?? frame.OutX ?? 0;
    const outY = frame.outY ?? frame.OutY ?? 0;
    const outZ = frame.outZ ?? frame.OutZ ?? 0;
    const hz = frame.hz ?? frame.Hz ?? 60;

    const now = performance.now();
    lastFrameTs = now;

    // Push into history buffers
    historyRaw.x.push(rawX);
    historyRaw.y.push(rawY);
    historyRaw.z.push(rawZ);
    historyFilt.x.push(outX);
    historyFilt.y.push(outY);
    historyFilt.z.push(outZ);

    if (historyRaw.x.length > MAX_HISTORY) {
      historyRaw.x.shift();
      historyRaw.y.shift();
      historyRaw.z.shift();
      historyFilt.x.shift();
      historyFilt.y.shift();
      historyFilt.z.shift();
    }

    // Active axis deviations for noise estimation
    const curRaw = activeAxis === 'y' ? rawY : activeAxis === 'z' ? rawZ : rawX;
    const curFilt = activeAxis === 'y' ? outY : activeAxis === 'z' ? outZ : outX;
    recentRawDev.push(Math.abs(curRaw));
    recentFiltDev.push(Math.abs(curFilt));
    if (recentRawDev.length > 50) recentRawDev.shift();
    if (recentFiltDev.length > 50) recentFiltDev.shift();

    // Throttled DOM metrics update (~10 Hz / 100ms)
    lastSpeed = Math.hypot(outX, outY, outZ);
    if (now - lastDomUpdateTs >= 100) {
      lastDomUpdateTs = now;
      updateDOM(hz);
    }

    scheduleDraw();
  }

  function handleState(s) {
    if (!s) return;
    if (s.pingMs !== undefined && pingValEl) {
      pingValEl.textContent = s.pingMs >= 0 ? `${Math.round(s.pingMs)} ms` : '-- ms';
      if (s.pingMs >= 0) {
        pingHistory.push(s.pingMs);
        if (pingHistory.length > 24) pingHistory.shift();
        drawNetSparkline();
      }
    }
    if (s.status === 'offline') {
      handleDisconnect();
    }
  }

  function drawNetSparkline() {
    if (!sparkCanvas) return;
    const w = sparkCanvas.clientWidth || 48;
    const h = sparkCanvas.clientHeight || 14;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pw = Math.floor(w * dpr);
    const ph = Math.floor(h * dpr);
    if (sparkCanvas.width !== pw || sparkCanvas.height !== ph) {
      sparkCanvas.width = pw;
      sparkCanvas.height = ph;
    }
    const ctx = sparkCanvas.getContext('2d');
    if (!ctx) return;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const n = pingHistory.length;
    if (n >= 2) {
      let maxVal = 50;
      for (let i = 0; i < n; i++) if (pingHistory[i] > maxVal) maxVal = pingHistory[i];
      const dx = (w - 2) / (n - 1);
      const colors = getThemeColors();
      ctx.beginPath();
      ctx.strokeStyle = colors.axisY;
      ctx.lineWidth = 1.2;
      for (let i = 0; i < n; i++) {
        const x = 1 + i * dx;
        const y = h - 2 - (Math.min(pingHistory[i], maxVal) / maxVal) * (h - 4);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  function updateDOM(hz) {
    if (rateValEl) {
      rateValEl.textContent = `${Math.round(hz)} Hz`;
    }

    // Stability Badge
    if (stabilityBadge) {
      let modeClass = 'pg-badge--ok';
      let modeText = t('ui.bench_status_still') || 'Покой';

      if (lastSpeed < 0.12) {
        modeClass = 'pg-badge--ok';
        modeText = t('ui.bench_status_still') || 'Покой';
      } else if (lastSpeed < 3.2) {
        modeClass = 'pg-badge--info';
        modeText = t('ui.bench_status_aim') || 'Прицел';
      } else {
        modeClass = 'pg-badge--accent';
        modeText = t('ui.bench_status_active') || 'Движение';
      }

      stabilityBadge.className = `pg-badge ${modeClass} pg-badge--dot`;
      stabilityBadge.textContent = modeText;
    }

    // Noise Reduction Readout
    if (noiseValEl) {
      if (recentRawDev.length < 15) {
        noiseValEl.textContent = '--%';
      } else {
        const avgRaw = recentRawDev.reduce((a, b) => a + b, 0) / recentRawDev.length;
        const avgFilt = recentFiltDev.reduce((a, b) => a + b, 0) / recentFiltDev.length;

        if (avgRaw < 0.05 && avgFilt === 0) {
          noiseValEl.textContent = '-99%';
        } else if (lastSpeed < 2.5 && avgRaw > 0.03) {
          const ratio = Math.max(0, Math.min(0.99, (avgRaw - avgFilt) / avgRaw));
          const pct = Math.round(ratio * 100);
          noiseValEl.textContent = pct > 0 ? `-${pct}%` : '0%';
        } else {
          noiseValEl.textContent = t('ui.bench_zero_lag') || '0-задержка';
        }
      }
    }
  }

  function handleDisconnect() {
    if (stabilityBadge) {
      stabilityBadge.className = 'pg-badge pg-badge--dot';
      stabilityBadge.textContent = t('ui.bench_status_offline') || 'Офлайн';
    }
    if (rateValEl) rateValEl.textContent = '-- Hz';
    if (noiseValEl) noiseValEl.textContent = '--%';
    if (pingValEl) pingValEl.textContent = '-- ms';
  }

  function handleConnect() {
    updateDOM(60);
  }

  // Canvas Oscilloscope Renderer
  function drawOscilloscope() {
    if (!canvas || !isActive) return;

    // Check watchdog: if packets stopped for >1.5s, show offline
    if (lastFrameTs && performance.now() - lastFrameTs > 1500) {
      handleDisconnect();
    }

    const w = canvas.clientWidth || 340;
    const h = canvas.clientHeight || (activeAxis === 'all' ? 150 : 120);
    const dpr = window.devicePixelRatio || 1;
    const pixelW = Math.round(w * dpr);
    const pixelH = Math.round(h * dpr);

    if (canvas.width !== pixelW || canvas.height !== pixelH) {
      canvas.width = pixelW;
      canvas.height = pixelH;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const colors = getThemeColors();

    if (activeAxis === 'all') {
      // 3 Stacked Axes Mode (Pitch, Yaw, Roll)
      const trackH = h / 3;
      const axes = ['x', 'y', 'z'];
      const titles = [
        'Pitch (X)',
        'Yaw (Y)',
        'Roll (Z)',
      ];
      const filtColors = [colors.axisX, colors.axisY, colors.axisZ];
      const rawColor = colors.rawColorAll;

      for (let k = 0; k < 3; k++) {
        const axis = axes[k];
        const topY = k * trackH;
        const centerY = topY + trackH / 2;

        // Track Separator
        if (k > 0) {
          ctx.beginPath();
          ctx.strokeStyle = colors.gridSeparator;
          ctx.lineWidth = 1;
          ctx.moveTo(0, topY);
          ctx.lineTo(w, topY);
          ctx.stroke();
        }

        // Track Center Zero Dashed Line
        ctx.beginPath();
        ctx.strokeStyle = colors.gridCenter;
        ctx.setLineDash([3, 3]);
        ctx.lineWidth = 1;
        ctx.moveTo(0, centerY);
        ctx.lineTo(w, centerY);
        ctx.stroke();
        ctx.setLineDash([]);

        const rawArr = historyRaw[axis] || [];
        const filtArr = historyFilt[axis] || [];
        const n = rawArr.length;

        // Title Badge
        const title = titles[k];
        ctx.font = '600 10px system-ui, -apple-system, sans-serif';
        const titleW = ctx.measureText(title).width + 10;
        const badgeH = 16;
        const badgeX = 6;
        const badgeY = topY + 4;

        ctx.fillStyle = colors.badgeBg;
        if (ctx.roundRect) {
          ctx.beginPath();
          ctx.roundRect(badgeX, badgeY, titleW, badgeH, 3);
          ctx.fill();
        } else {
          ctx.fillRect(badgeX, badgeY, titleW, badgeH);
        }

        ctx.fillStyle = colors.textColor;
        ctx.fillText(title, badgeX + 5, badgeY + 12);

        // Numeric Readout on right
        const curFilt = filtArr.length ? filtArr[filtArr.length - 1] : 0;
        const curRaw = rawArr.length ? rawArr[rawArr.length - 1] : 0;
        const readoutVal = dataFeed === 'raw' ? curRaw : curFilt;
        const readoutText = `${dataFeed.toUpperCase()}: ${(readoutVal >= 0 ? '+' : '')}${readoutVal.toFixed(1)}°/s`;

        ctx.font = '600 10px ui-monospace, SFMono-Regular, monospace';
        ctx.fillStyle = filtColors[k];
        const readoutW = ctx.measureText(readoutText).width;
        ctx.fillText(readoutText, w - readoutW - 6, badgeY + 12);

        if (n < 2) continue;

        // Auto-scale
        let maxAmp = 8.0;
        for (let i = 0; i < n; i++) {
          const ar = Math.abs(rawArr[i]);
          const af = Math.abs(filtArr[i]);
          if (ar > maxAmp) maxAmp = ar;
          if (af > maxAmp) maxAmp = af;
        }
        const scale = (trackH * 0.38) / maxAmp;
        const dx = w / (MAX_HISTORY - 1);
        const startX = w - (n - 1) * dx;

        // 1. Raw trace (thin line using warn token)
        ctx.beginPath();
        ctx.strokeStyle = rawColor;
        ctx.lineWidth = 1.2;
        for (let i = 0; i < n; i++) {
          const x = startX + i * dx;
          const y = centerY - rawArr[i] * scale;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();

        // 2. Filtered DSU trace (solid smooth line using axis token)
        ctx.beginPath();
        ctx.strokeStyle = filtColors[k];
        ctx.lineWidth = 2.0;
        for (let i = 0; i < n; i++) {
          const x = startX + i * dx;
          const y = centerY - filtArr[i] * scale;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    } else {
      // Single Axis Mode (Pitch, Yaw, or Roll)
      const centerY = h / 2;

      // Center Reference Zero Line
      ctx.beginPath();
      ctx.strokeStyle = colors.gridCenter;
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1;
      ctx.moveTo(0, centerY);
      ctx.lineTo(w, centerY);
      ctx.stroke();

      // Top and Bottom Boundary Guides
      ctx.beginPath();
      ctx.strokeStyle = colors.gridBounds;
      ctx.setLineDash([2, 4]);
      ctx.moveTo(0, centerY - h * 0.35);
      ctx.lineTo(w, centerY - h * 0.35);
      ctx.moveTo(0, centerY + h * 0.35);
      ctx.lineTo(w, centerY + h * 0.35);
      ctx.stroke();
      ctx.setLineDash([]);

      const rawArr = historyRaw[activeAxis] || [];
      const filtArr = historyFilt[activeAxis] || [];
      const n = rawArr.length;

      const title = activeAxis === 'y' ? 'Yaw (Y)' : activeAxis === 'z' ? 'Roll (Z)' : 'Pitch (X)';
      const activeColor = activeAxis === 'y' ? colors.axisY : activeAxis === 'z' ? colors.axisZ : colors.axisX;

      ctx.font = '600 11px system-ui, -apple-system, sans-serif';
      const titleW = ctx.measureText(title).width + 12;
      const badgeH = 18;
      const badgeX = 8;
      const badgeY = 8;

      ctx.fillStyle = colors.badgeBg;
      if (ctx.roundRect) {
        ctx.beginPath();
        ctx.roundRect(badgeX, badgeY, titleW, badgeH, 4);
        ctx.fill();
      } else {
        ctx.fillRect(badgeX, badgeY, titleW, badgeH);
      }

      ctx.fillStyle = colors.textColor;
      ctx.fillText(title, badgeX + 6, badgeY + 13);

      // Numeric Readout on right
      const curFilt = filtArr.length ? filtArr[filtArr.length - 1] : 0;
      const curRaw = rawArr.length ? rawArr[rawArr.length - 1] : 0;
      const readoutVal = dataFeed === 'raw' ? curRaw : curFilt;
      const readoutText = `${dataFeed.toUpperCase()}: ${(readoutVal >= 0 ? '+' : '')}${readoutVal.toFixed(1)}°/s`;

      ctx.font = '600 11px ui-monospace, SFMono-Regular, monospace';
      ctx.fillStyle = activeColor;
      const readoutW = ctx.measureText(readoutText).width;
      ctx.fillText(readoutText, w - readoutW - 8, badgeY + 13);

      if (n >= 2) {
        let maxAmp = 8.0;
        for (let i = 0; i < n; i++) {
          const ar = Math.abs(rawArr[i]);
          const af = Math.abs(filtArr[i]);
          if (ar > maxAmp) maxAmp = ar;
          if (af > maxAmp) maxAmp = af;
        }
        const scale = (h * 0.42) / maxAmp;
        const dx = w / (MAX_HISTORY - 1);
        const startX = w - (n - 1) * dx;

        // 1. Raw trace (thin line using warn token)
        ctx.beginPath();
        ctx.strokeStyle = colors.rawColorSingle;
        ctx.lineWidth = 1.4;
        for (let i = 0; i < n; i++) {
          const x = startX + i * dx;
          const y = centerY - rawArr[i] * scale;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();

        // 2. Filtered DSU trace (solid smooth line using active axis token)
        ctx.beginPath();
        ctx.strokeStyle = activeColor;
        ctx.lineWidth = 2.4;
        for (let i = 0; i < n; i++) {
          const x = startX + i * dx;
          const y = centerY - filtArr[i] * scale;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  function scheduleDraw() {
    if (renderScheduled || !isActive) return;
    renderScheduled = true;
    requestAnimationFrame(() => {
      renderScheduled = false;
      if (isActive) drawOscilloscope();
    });
  }

  // Set parameters externally from Settings screen Motion group
  function setParams({ deadband, sensitivity, deadbandUsb }) {
    if (deadband !== undefined) currentDeadband = deadband;
    if (sensitivity !== undefined) currentSensitivity = sensitivity;
    if (deadbandUsb !== undefined) currentDeadbandUsb = deadbandUsb;
    applyTuningParams();
  }

  // Set connected status and manage blur overlay
  function setConnected(connected) {
    isConnected = !!connected;
    if (offlineOverlay) {
      offlineOverlay.hidden = isConnected;
    }
    if (!isConnected) {
      handleDisconnect();
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    }
  }

  // Lifecycle
  async function activate() {
    if (isActive) return;
    isActive = true;
    syncUI();

    // Reset history buffers
    for (const k of ['x', 'y', 'z']) {
      historyRaw[k] = new Array(MAX_HISTORY).fill(0);
      historyFilt[k] = new Array(MAX_HISTORY).fill(0);
    }
    recentRawDev.length = 0;
    recentFiltDev.length = 0;
    lastFrameTs = 0;

    // Load initial parameters from settings
    if (options.getInitialParams) {
      const p = options.getInitialParams();
      if (p) {
        if (p.deadband !== undefined) currentDeadband = p.deadband;
        if (p.sensitivity !== undefined) currentSensitivity = p.sensitivity;
        if (p.deadbandUsb !== undefined) currentDeadbandUsb = p.deadbandUsb;
      }
    } else {
      try {
        const s = await call('GetAppSettings');
        if (s) {
          if (s.GyroDeadband !== undefined) currentDeadband = s.GyroDeadband;
          if (s.GyroSensitivity !== undefined) currentSensitivity = s.GyroSensitivity;
          if (s.GyroDeadbandUsb !== undefined) currentDeadbandUsb = s.GyroDeadbandUsb;
        }
      } catch (_) {}
    }

    // Enable live high-frequency streaming on Go backend
    call('SetTuningActive', true);
    applyTuningParams();

    // Subscribe to events
    on('tuning:frame', handleFrame);
    on('state:change', handleState);
    on('device:disconnected', handleDisconnect);
    on('device:connected', handleConnect);
    window.addEventListener('keydown', handleKeyDown);

    handleState(getState());
    scheduleDraw();
  }

  function deactivate() {
    if (!isActive) return;
    isActive = false;
    renderScheduled = false;

    // Stop streaming on backend (Strict Rule 0)
    call('SetTuningActive', false);

    // Unsubscribe from events
    off('tuning:frame', handleFrame);
    off('state:change', handleState);
    off('device:disconnected', handleDisconnect);
    off('device:connected', handleConnect);
    window.removeEventListener('keydown', handleKeyDown);
  }

  return {
    activate,
    deactivate,
    setParams,
    setConnected,
  };
}
