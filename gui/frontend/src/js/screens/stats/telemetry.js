// Telemetry & 3D Viewport controller
// Handles metrics cards, SVG sparklines, CSV recording, USB protocol status, and 3D mode controls.

import { $, setText, setVar, show, toggleClass } from '../../core/dom.js';
import { call, on, off } from '../../core/bridge.js';
import { onState, getState } from '../../core/state.js';
import { t } from '../../core/i18n.js';
import { TelemetryRecorder } from './recorder.js';

const MAX_HISTORY = 30;

function buildSparkline(history, minVal = null, maxVal = null, w = 100, h = 32) {
  if (!history || history.length < 2) return '';
  let min = minVal != null ? minVal : Math.min(...history);
  let max = maxVal != null ? maxVal : Math.max(...history);
  if (Math.abs(max - min) < 0.001) {
    min -= 1;
    max += 1;
  }
  const padY = 2;
  const drawH = h - padY * 2;
  const stepX = w / (history.length - 1);
  const pts = history.map((val, i) => {
    const clamped = Math.max(min, Math.min(max, val));
    const x = (i * stepX).toFixed(1);
    const y = (h - padY - ((clamped - min) / (max - min)) * drawH).toFixed(1);
    return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
  });
  return pts.join(' ');
}

export function initTelemetry(paneEl) {
  if (!paneEl) return null;

  let isActive = false;
  let lastLatency = 0;
  let lastTuning = null;

  const history = {
    hz: [],
    lat: [],
    jitter: [],
    loss: [],
    pipe: [],
  };

  // Recorder
  const recorder = new TelemetryRecorder({
    onUpdate: (data) => {
      setText($('stats-rec-time'), data.timeStr);
      setVar($('stats-rec-prog'), '--p', `${data.percent.toFixed(1)}%`);
      setText(
        $('stats-rec-meta'),
        `${data.lineCount} ${t('live_debug.stats_rows_unit') || 'строк'} · ${data.sizeKb} KB`
      );
      toggleClass($('btn-stats-record'), 'is-recording', data.isRecording);
      setText(
        $('btn-stats-record-label'),
        data.isRecording
          ? t('live_debug.stats_record_stop') || 'Остановить'
          : t('live_debug.stats_record_start') || 'Начать запись'
      );
    },
    onStop: () => {
      toggleClass($('btn-stats-record'), 'is-recording', false);
      setText($('btn-stats-record-label'), t('live_debug.stats_record_start') || 'Начать запись');
    },
  });

  // Record button
  const btnRecord = $('btn-stats-record');
  if (btnRecord) {
    btnRecord.onclick = () => {
      if (recorder.isRecording) {
        recorder.stop();
      } else {
        recorder.start();
      }
    };
  }

  // Recenter button
  const btnRecenter = $('btn-stats-recenter');
  if (btnRecenter) {
    btnRecenter.onclick = () => {
      call('ResetAHRS');
    };
  }

  // Spacebar hotkey
  const onKeyDown = (e) => {
    if (!isActive) return;
    if (e.code === 'Space' && !e.repeat) {
      const activeTag = document.activeElement ? document.activeElement.tagName : '';
      if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') return;
      e.preventDefault();
      call('ResetAHRS');
    }
  };

  // Model selector
  const modelBtns = paneEl.querySelectorAll('#stats-model-seg .pg-seg__btn');
  modelBtns.forEach((btn) => {
    btn.onclick = () => {
      const m = btn.dataset.model || 'gamepad';
      modelBtns.forEach((b) => toggleClass(b, 'is-active', b === btn));
      try {
        localStorage.setItem('pg-stats-model', m);
      } catch (_) {}
    };
  });
  try {
    const savedModel = localStorage.getItem('pg-stats-model');
    if (savedModel) {
      modelBtns.forEach((b) => toggleClass(b, 'is-active', b.dataset.model === savedModel));
    }
  } catch (_) {}

  // Cam mode selector
  const camBtns = paneEl.querySelectorAll('#stats-cam-mode-seg .pg-seg__btn');
  const applyCamMode = (mode) => {
    camBtns.forEach((b) => toggleClass(b, 'is-active', b.dataset.cam === mode));
    const isQuad = mode === 'quad';
    const quadWrap = $('stats-3d-quad-wrap');
    const singleVp = $('stats-3d-viewport-single');
    if (quadWrap) quadWrap.style.display = isQuad ? 'grid' : 'none';
    if (singleVp) singleVp.style.display = isQuad ? 'none' : 'flex';

    const tag = $('stats-viewport-tag');
    if (tag) {
      tag.textContent = mode === 'orbit' ? 'DYNAMIC ORBIT' : 'STATIC VIEW';
    }
    try {
      localStorage.setItem('pg-stats-cam', mode);
    } catch (_) {}
  };
  camBtns.forEach((btn) => {
    btn.onclick = () => applyCamMode(btn.dataset.cam || 'static');
  });
  try {
    const savedCam = localStorage.getItem('pg-stats-cam');
    if (savedCam) applyCamMode(savedCam);
  } catch (_) {}

  // Resource saving toggle
  const ecoToggle = $('stats-eco-toggle');
  if (ecoToggle) {
    try {
      const savedEco = localStorage.getItem('pg-stats-eco');
      if (savedEco !== null) ecoToggle.checked = savedEco === 'true';
    } catch (_) {}
    ecoToggle.onchange = () => {
      try {
        localStorage.setItem('pg-stats-eco', String(ecoToggle.checked));
      } catch (_) {}
    };
  }

  // Handle tuning frames (60Hz)
  const handleTuningFrame = (tf) => {
    if (!isActive || !tf) return;
    lastTuning = tf;

    setText($('tel-out-gx'), (tf.OutX >= 0 ? '+' : '') + tf.OutX.toFixed(2));
    setText($('tel-out-gy'), (tf.OutY >= 0 ? '+' : '') + tf.OutY.toFixed(2));
    setText($('tel-out-gz'), (tf.OutZ >= 0 ? '+' : '') + tf.OutZ.toFixed(2));
  };

  // Handle livedebug telemetry messages (e.g. usb_proto)
  const handleLiveTelemetry = (raw) => {
    if (!isActive || !raw) return;
    try {
      const msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (msg && msg.type === 'usb_proto') {
        const l1 = $('stats-usb-l1');
        const l2 = $('stats-usb-l2');
        const l3 = $('stats-usb-l3');
        const l4 = $('stats-usb-l4');
        if (l1) setText(l1, `${msg.port || 'USB'} · ${msg.baud || 115200}`);
        if (l2) setText(l2, `${(msg.rate_hz || 0).toFixed(0)} Гц · ${msg.frames || 0} фр.`);
        if (l3) setText(l3, `${msg.protocol || 'v1.1.0'} · ±${msg.gyro_range_dps || 2000}°/s · ±${msg.accel_range_g || 8}g`);
        if (l4) setText(l4, `${msg.crc_rejects || 0} CRC · ${msg.lost || 0} потерь`);
      }
    } catch (_) {}
  };

  // Render State
  const renderState = (state) => {
    if (!isActive || !state) return;

    // Frequency
    const hz = state.hz || 0;
    history.hz.push(hz);
    if (history.hz.length > MAX_HISTORY) history.hz.shift();
    setText($('stat-hz-val'), hz.toFixed(1));
    const hzBadge = $('stat-hz-badge');
    if (hzBadge) {
      toggleClass(hzBadge, 'pg-badge--ok', hz >= 45);
      toggleClass(hzBadge, 'pg-badge--warn', hz > 0 && hz < 45);
      toggleClass(hzBadge, 'pg-badge--danger', hz === 0);
      setText(hzBadge, hz >= 45 ? 'ok' : hz > 0 ? 'low' : 'off');
    }
    const hzSpark = $('stat-hz-spark');
    if (hzSpark) hzSpark.setAttribute('d', buildSparkline(history.hz, 0, 70));

    // Latency
    const lat = state.pingMs >= 0 ? state.pingMs : 0;
    history.lat.push(lat);
    if (history.lat.length > MAX_HISTORY) history.lat.shift();
    setText($('stat-lat-val'), lat.toFixed(1));
    const latBadge = $('stat-lat-badge');
    if (latBadge) {
      toggleClass(latBadge, 'pg-badge--ok', lat <= 15);
      toggleClass(latBadge, 'pg-badge--warn', lat > 15 && lat <= 40);
      toggleClass(latBadge, 'pg-badge--danger', lat > 40);
      setText(latBadge, lat <= 15 ? 'ok' : lat <= 40 ? 'warn' : 'bad');
    }
    const latSpark = $('stat-lat-spark');
    if (latSpark) latSpark.setAttribute('d', buildSparkline(history.lat, 0, Math.max(25, ...history.lat)));

    // Jitter
    const jitter = Math.abs(lat - lastLatency);
    lastLatency = lat;
    history.jitter.push(jitter);
    if (history.jitter.length > MAX_HISTORY) history.jitter.shift();
    setText($('stat-jitter-val'), jitter.toFixed(1));
    const jitterBadge = $('stat-jitter-badge');
    if (jitterBadge) {
      toggleClass(jitterBadge, 'pg-badge--ok', jitter <= 5);
      toggleClass(jitterBadge, 'pg-badge--warn', jitter > 5);
      setText(jitterBadge, jitter <= 5 ? 'ok' : 'warn');
    }
    const jitterSpark = $('stat-jitter-spark');
    if (jitterSpark) jitterSpark.setAttribute('d', buildSparkline(history.jitter, 0, Math.max(12, ...history.jitter)));

    // Loss (from state or simulated 0)
    const lossPct = 0;
    history.loss.push(lossPct);
    if (history.loss.length > MAX_HISTORY) history.loss.shift();
    setText($('stat-loss-val'), '0');
    setText($('stat-loss-unit'), '(0.0%)');
    const lossSpark = $('stat-loss-spark');
    if (lossSpark) lossSpark.setAttribute('d', buildSparkline(history.loss, 0, 10));

    // Raw Gyro
    setText($('tel-raw-gx'), (state.rawRotX >= 0 ? '+' : '') + (state.rawRotX || 0).toFixed(2));
    setText($('tel-raw-gy'), (state.rawRotY >= 0 ? '+' : '') + (state.rawRotY || 0).toFixed(2));
    setText($('tel-raw-gz'), (state.rawRotZ >= 0 ? '+' : '') + (state.rawRotZ || 0).toFixed(2));

    // Raw Accel
    setText($('tel-raw-ax'), (state.rawAccX >= 0 ? '+' : '') + (state.rawAccX || 0).toFixed(2));
    setText($('tel-raw-ay'), (state.rawAccY >= 0 ? '+' : '') + (state.rawAccY || 0).toFixed(2));
    setText($('tel-raw-az'), (state.rawAccZ >= 0 ? '+' : '') + (state.rawAccZ || 0).toFixed(2));

    // DSU Gyro fallback if no recent tuning frame
    if (!lastTuning) {
      setText($('tel-out-gx'), (state.rawRotX >= 0 ? '+' : '') + (state.rawRotX || 0).toFixed(2));
      setText($('tel-out-gy'), (state.rawRotY >= 0 ? '+' : '') + (state.rawRotY || 0).toFixed(2));
      setText($('tel-out-gz'), (state.rawRotZ >= 0 ? '+' : '') + (state.rawRotZ || 0).toFixed(2));
    }

    // Pipeline delay
    const pipeMs = Math.max(0.6, (lat * 0.15) || 0.8);
    history.pipe.push(pipeMs);
    if (history.pipe.length > MAX_HISTORY) history.pipe.shift();
    setText($('stat-pipe-val'), pipeMs.toFixed(1));
    const pipeSpark = $('stat-pipe-spark');
    if (pipeSpark) pipeSpark.setAttribute('d', buildSparkline(history.pipe, 0, 4));

    // DSU Clients
    const dsuCount = state.dsuClients || 0;
    setText($('stat-dsu-count'), dsuCount);
    const dsuBadge = $('stat-dsu-badge');
    if (dsuBadge) {
      toggleClass(dsuBadge, 'pg-badge--ok', dsuCount > 0);
      setText(dsuBadge, dsuCount > 0 ? 'LIVE' : '0');
    }
    const dsuName = $('stat-dsu-client-name');
    if (dsuName) {
      if (state.dsuClientList && state.dsuClientList.length > 0) {
        setText(
          dsuName,
          state.dsuClientList.map((c) => `${c.name || 'App'} (${c.endpoint || ''})`).join(', ')
        );
      } else {
        setText(dsuName, t('live_debug.stats_dsu_desc_waiting') || 'Ожидание...');
      }
    }

    // Euler angles
    const p = state.pitch || 0;
    const r = state.roll || 0;
    const y = state.yaw || 0;
    setText($('tel-angle-pitch'), (p >= 0 ? '+' : '') + p.toFixed(1) + '°');
    setText($('tel-angle-roll'), (r >= 0 ? '+' : '') + r.toFixed(1) + '°');
    setText($('tel-angle-yaw'), (y >= 0 ? '+' : '') + y.toFixed(1) + '°');

    // CSS 3D fallback cube rotation
    const cube = $('stats-cube-css');
    if (cube) {
      setVar(cube, '--rx', `${(-p).toFixed(1)}deg`);
      setVar(cube, '--ry', `${y.toFixed(1)}deg`);
      setVar(cube, '--rz', `${(-r).toFixed(1)}deg`);
    }

    // USB Status
    const isUsb = !!state.usbConnected;
    show($('stats-usb-card'), isUsb);
    if (isUsb && state.usbPort) {
      const l1 = $('stats-usb-l1');
      if (l1 && l1.textContent === '—') {
        setText(l1, `${state.usbPort} · 115200`);
      }
    }

    // Record frame if active
    if (recorder.isRecording) {
      recorder.recordFrame({
        q0: state.ahrsQ0 ?? 1,
        q1: state.ahrsQ1 ?? 0,
        q2: state.ahrsQ2 ?? 0,
        q3: state.ahrsQ3 ?? 0,
        rawGx: state.rawRotX ?? 0,
        rawGy: state.rawRotY ?? 0,
        rawGz: state.rawRotZ ?? 0,
        rawAx: state.rawAccX ?? 0,
        rawAy: state.rawAccY ?? 0,
        rawAz: state.rawAccZ ?? 0,
        outGx: lastTuning ? lastTuning.OutX : state.rawRotX ?? 0,
        outGy: lastTuning ? lastTuning.OutY : state.rawRotY ?? 0,
        outGz: lastTuning ? lastTuning.OutZ : state.rawRotZ ?? 0,
        stickLx: 0,
        stickLy: 0,
        inHz: state.hz ?? 0,
        outHz: state.hz ?? 0,
        pipeMs: pipeMs,
        dsuClients: state.dsuClients ?? 0,
        linkRttMs: state.pingMs ?? -1,
      });
    }
  };

  // State subscriber (always receives state:change, but renders only if isActive)
  onState(renderState);

  return {
    activate: () => {
      if (isActive) return;
      isActive = true;
      window.addEventListener('keydown', onKeyDown);
      on('tuning:frame', handleTuningFrame);
      on('livedebug:telemetry', handleLiveTelemetry);
      call('SetTuningActive', true).catch(() => {});
      renderState(getState());
    },
    deactivate: () => {
      if (!isActive) return;
      isActive = false;
      window.removeEventListener('keydown', onKeyDown);
      off('tuning:frame', handleTuningFrame);
      off('livedebug:telemetry', handleLiveTelemetry);
      call('SetTuningActive', false).catch(() => {});
      if (recorder.isRecording) {
        recorder.stop();
      }
    },
    getRecorder: () => recorder,
  };
}
