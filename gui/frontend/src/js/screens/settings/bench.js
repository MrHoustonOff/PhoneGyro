// Response Test Bench & Real-Time Motion Oscilloscope
// Provides real-time waveform tracking (Raw vs Filtered DSU),
// stability classification, noise suppression analysis,
// and live parameter tuning (Deadband and Sensitivity).

import { $, toggleClass } from '../../core/dom.js';
import { on, off, call } from '../../core/bridge.js';
import { t } from '../../core/i18n.js';

export function initBench(container) {
  if (!container) return { activate: () => {}, deactivate: () => {} };

  // DOM Elements
  const canvas = $('bench-oscilloscope-canvas');
  const oscWrap = $('bench-osc-wrap');
  const sourceSeg = $('bench-source-seg');
  const axisSeg = $('bench-axis-seg');
  const recenterBtn = $('btn-bench-recenter');
  const stabilityBadge = $('bench-stability-badge');
  const noiseValEl = $('bench-noise-val');
  const rateValEl = $('bench-rate-val');
  const deadbandSlider = $('bench-deadband-slider');
  const deadbandValEl = $('bench-deadband-val');
  const sensSlider = $('bench-sens-slider');
  const sensValEl = $('bench-sens-val');

  // State
  const MAX_HISTORY = 140;
  let activeAxis = localStorage.getItem('pg-bench-axis') || 'all'; // 'x' | 'y' | 'z' | 'all'
  let dataFeed = localStorage.getItem('pg-bench-feed') || 'dsu';    // 'dsu' | 'raw'
  let isActive = false;
  let rafId = null;
  let lastFrameTs = 0;
  let lastDomUpdateTs = 0;
  let lastSpeed = 0;
  let saveTimer = null;

  // History Buffers
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
    });
  }

  function handleRecenter() {
    call('ResetAHRS');
  }

  if (recenterBtn) {
    recenterBtn.addEventListener('click', handleRecenter);
  }

  // Parameter Sliders with Debounced Backend Update
  function applyTuningParams() {
    const deadband = parseFloat(deadbandSlider?.value || 0.12);
    const sensitivity = parseFloat(sensSlider?.value || 1.0);
    call('SetTuningFilterParams', deadband, deadband, sensitivity);
  }

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(applyTuningParams, 150);
  }

  if (deadbandSlider) {
    deadbandSlider.addEventListener('input', () => {
      const val = parseFloat(deadbandSlider.value);
      if (deadbandValEl) deadbandValEl.textContent = `${val.toFixed(2)} °/s`;
      scheduleSave();
    });
  }

  if (sensSlider) {
    sensSlider.addEventListener('input', () => {
      const val = parseFloat(sensSlider.value);
      if (sensValEl) sensValEl.textContent = `${val.toFixed(2)}x`;
      scheduleSave();
    });
  }

  // Keyboard shortcut: Space for recenter
  function handleKeyDown(e) {
    if (!isActive) return;
    if (e.code === 'Space' && !e.target.matches('input, textarea, select')) {
      e.preventDefault();
      handleRecenter();
    }
  }

  // Frame Receiver
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
    const h = canvas.clientHeight || (activeAxis === 'all' ? 300 : 180);
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

    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    const gridSeparator = isLight ? 'rgba(0, 0, 0, 0.12)' : 'rgba(255, 255, 255, 0.08)';
    const gridCenter = isLight ? 'rgba(0, 0, 0, 0.28)' : 'rgba(255, 255, 255, 0.18)';
    const gridBounds = isLight ? 'rgba(0, 0, 0, 0.10)' : 'rgba(255, 255, 255, 0.06)';
    const badgeBg = isLight ? 'rgba(0, 0, 0, 0.06)' : 'rgba(255, 255, 255, 0.10)';
    const textColor = isLight ? '#1e293b' : '#f8fafc';

    if (activeAxis === 'all') {
      // 3 Stacked Axes Mode (Pitch, Yaw, Roll)
      const trackH = h / 3;
      const axes = ['x', 'y', 'z'];
      const titles = [
        'Pitch (X)',
        'Yaw (Y)',
        'Roll (Z)',
      ];
      // Colors per axis
      const filtColors = isLight
        ? ['#dc2626', '#059669', '#0284c7']
        : ['#ef4444', '#10b981', '#06b6d4'];
      const rawColors = isLight
        ? ['rgba(220, 38, 38, 0.35)', 'rgba(5, 150, 105, 0.35)', 'rgba(2, 132, 199, 0.35)']
        : ['rgba(239, 68, 68, 0.4)', 'rgba(16, 185, 129, 0.4)', 'rgba(6, 182, 212, 0.4)'];

      for (let k = 0; k < 3; k++) {
        const axis = axes[k];
        const topY = k * trackH;
        const centerY = topY + trackH / 2;

        // Track Separator
        if (k > 0) {
          ctx.beginPath();
          ctx.strokeStyle = gridSeparator;
          ctx.lineWidth = 1;
          ctx.moveTo(0, topY);
          ctx.lineTo(w, topY);
          ctx.stroke();
        }

        // Track Center Zero Dashed Line
        ctx.beginPath();
        ctx.strokeStyle = gridCenter;
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
        ctx.font = '600 11px system-ui, -apple-system, sans-serif';
        const titleW = ctx.measureText(title).width + 12;
        const badgeH = 18;
        const badgeX = 8;
        const badgeY = topY + 5;

        ctx.fillStyle = badgeBg;
        if (ctx.roundRect) {
          ctx.beginPath();
          ctx.roundRect(badgeX, badgeY, titleW, badgeH, 4);
          ctx.fill();
        } else {
          ctx.fillRect(badgeX, badgeY, titleW, badgeH);
        }

        ctx.fillStyle = textColor;
        ctx.fillText(title, badgeX + 6, badgeY + 13);

        // Numeric Readout on right
        const curFilt = filtArr.length ? filtArr[filtArr.length - 1] : 0;
        const curRaw = rawArr.length ? rawArr[rawArr.length - 1] : 0;
        const readoutVal = dataFeed === 'raw' ? curRaw : curFilt;
        const readoutText = `${dataFeed.toUpperCase()}: ${(readoutVal >= 0 ? '+' : '')}${readoutVal.toFixed(1)}°/s`;

        ctx.font = '600 11px ui-monospace, SFMono-Regular, monospace';
        ctx.fillStyle = filtColors[k];
        const readoutW = ctx.measureText(readoutText).width;
        ctx.fillText(readoutText, w - readoutW - 8, badgeY + 13);

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

        // 1. Raw trace (thin line)
        ctx.beginPath();
        ctx.strokeStyle = rawColors[k];
        ctx.lineWidth = 1.2;
        for (let i = 0; i < n; i++) {
          const x = startX + i * dx;
          const y = centerY - rawArr[i] * scale;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();

        // 2. Filtered DSU trace (solid smooth line)
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
      ctx.strokeStyle = gridCenter;
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1;
      ctx.moveTo(0, centerY);
      ctx.lineTo(w, centerY);
      ctx.stroke();

      // Top and Bottom Boundary Guides
      ctx.beginPath();
      ctx.strokeStyle = gridBounds;
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
      ctx.font = '600 12px system-ui, -apple-system, sans-serif';
      const titleW = ctx.measureText(title).width + 12;
      const badgeH = 20;
      const badgeX = 8;
      const badgeY = 8;

      ctx.fillStyle = badgeBg;
      if (ctx.roundRect) {
        ctx.beginPath();
        ctx.roundRect(badgeX, badgeY, titleW, badgeH, 4);
        ctx.fill();
      } else {
        ctx.fillRect(badgeX, badgeY, titleW, badgeH);
      }

      ctx.fillStyle = textColor;
      ctx.fillText(title, badgeX + 6, badgeY + 14);

      // Numeric Readout on right
      const curFilt = filtArr.length ? filtArr[filtArr.length - 1] : 0;
      const curRaw = rawArr.length ? rawArr[rawArr.length - 1] : 0;
      const readoutVal = dataFeed === 'raw' ? curRaw : curFilt;
      const readoutText = `${dataFeed.toUpperCase()}: ${(readoutVal >= 0 ? '+' : '')}${readoutVal.toFixed(1)}°/s`;

      ctx.font = '600 12px ui-monospace, SFMono-Regular, monospace';
      ctx.fillStyle = isLight ? '#0284c7' : '#38bdf8';
      const readoutW = ctx.measureText(readoutText).width;
      ctx.fillText(readoutText, w - readoutW - 8, badgeY + 14);

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

        // 1. Raw trace (Orange thin spike line)
        ctx.beginPath();
        ctx.strokeStyle = isLight ? 'rgba(234, 88, 12, 0.45)' : 'rgba(249, 115, 22, 0.5)';
        ctx.lineWidth = 1.4;
        for (let i = 0; i < n; i++) {
          const x = startX + i * dx;
          const y = centerY - rawArr[i] * scale;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();

        // 2. Filtered DSU trace (Cyan/Blue solid line)
        ctx.beginPath();
        ctx.strokeStyle = isLight ? '#0284c7' : '#38bdf8';
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

  // Animation Loop: runs only while active
  function loop() {
    if (!isActive) {
      rafId = null;
      return;
    }
    drawOscilloscope();
    rafId = requestAnimationFrame(loop);
  }

  // Lifecycle
  async function activate() {
    if (isActive) return;
    isActive = true;
    syncUI();

    // Reset history with zeroes
    for (const k of ['x', 'y', 'z']) {
      historyRaw[k] = new Array(MAX_HISTORY).fill(0);
      historyFilt[k] = new Array(MAX_HISTORY).fill(0);
    }
    recentRawDev.length = 0;
    recentFiltDev.length = 0;
    lastFrameTs = 0;

    // Load initial settings
    try {
      const s = await call('GetAppSettings');
      if (s) {
        if (s.GyroDeadband !== undefined && deadbandSlider && deadbandValEl) {
          deadbandSlider.value = s.GyroDeadband;
          deadbandValEl.textContent = `${s.GyroDeadband.toFixed(2)} °/s`;
        }
        if (s.GyroSensitivity !== undefined && sensSlider && sensValEl) {
          sensSlider.value = s.GyroSensitivity;
          sensValEl.textContent = `${s.GyroSensitivity.toFixed(2)}x`;
        }
      }
    } catch (_) {}

    // Enable high-frequency streaming on Go backend
    call('SetTuningActive', true);

    // Subscribe to events
    on('tuning:frame', handleFrame);
    on('device:disconnected', handleDisconnect);
    on('device:connected', handleConnect);
    window.addEventListener('keydown', handleKeyDown);

    // Start render loop
    if (!rafId) {
      rafId = requestAnimationFrame(loop);
    }
  }

  function deactivate() {
    if (!isActive) return;
    isActive = false;

    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }

    // Stop streaming on backend (Strict Rule 0)
    call('SetTuningActive', false);

    // Unsubscribe from events
    off('tuning:frame', handleFrame);
    off('device:disconnected', handleDisconnect);
    off('device:connected', handleConnect);
    window.removeEventListener('keydown', handleKeyDown);
  }

  return {
    activate,
    deactivate,
  };
}
