// Telemetry & 3D Viewport controller
// Handles metrics cards, SVG sparklines, CSV recording, USB protocol status,
// and Three.js GyroScene orientation viewport with multi-camera modes.

import { $, setText, setVar, show, toggleClass } from '../../core/dom.js';
import { call, on, off } from '../../core/bridge.js';
import { onState, getState } from '../../core/state.js';
import { t } from '../../core/i18n.js';
import { TelemetryRecorder } from './recorder.js';
import { createGyroScene } from '../../ui/scene.js';
import { TelemetryDeriveEngine } from './derive.js';

const MAX_HISTORY = 30;
const quatBuf = new Float32Array(4); // Reused quaternion array: zero per-frame allocation

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

function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatDsuClientsLabel(count) {
  const lang = (window.__i18nLang || document.documentElement.lang || 'ru').toLowerCase();
  if (lang.startsWith('en')) {
    return count === 1
      ? (t('live_debug.stats_dsu_clients_one') || 'active')
      : (t('live_debug.stats_dsu_clients_many') || 'active');
  }
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod100 >= 11 && mod100 <= 14) {
    return t('live_debug.stats_dsu_clients_many') || 'активных';
  }
  if (mod10 === 1) {
    return t('live_debug.stats_dsu_clients_one') || 'активный';
  }
  return t('live_debug.stats_dsu_clients_many') || 'активных';
}

function setBadge(el, status, text = null) {
  if (!el) return;
  if (status === 'none') {
    el.className = 'pg-badge pg-badge--none';
    setText(el, text != null ? text : 'нет данных');
  } else {
    el.className = `pg-badge pg-badge--${status || 'ok'}`;
    if (text != null) setText(el, text);
  }
}

function getCoreHost() {
  const h = window.location.hostname;
  if (!h || h === 'wails.localhost' || h === 'localhost.wails' || window.location.protocol === 'file:') {
    const port = getState()?.httpPort || 8080;
    return `127.0.0.1:${port}`;
  }
  if (h === 'localhost' || h === '127.0.0.1') {
    return `${h}:${window.location.port || getState()?.httpPort || '8080'}`;
  }
  return window.location.host;
}

export function initTelemetry(paneEl) {
  if (!paneEl) return null;

  let isActive = false;
  let lastTuning = null;
  let sceneInstance = null;
  let selectedModel = 'gamepad';
  let selectedCamMode = 'static';
  let latestQuat = null;
  let orbitYaw = 0;
  let orbitPitch = 0;
  let orbitZoom = 1.0;
  let isDragging = false;
  let startX = 0;
  let startY = 0;

  // Derivation engine for Groups A and B
  const deriveEngine = new TelemetryDeriveEngine();
  let deriveInterval = null;

  // WebSocket connection to livedebug stream
  let ws = null;
  let wsReconnectTimer = null;

  const history = {
    hz: [],
    lat: [],
    jitter: [],
    loss: [],
    pipe: [],
    noise: [],
  };

  let latestUsbProto = null;

  function renderUsbProto(msg) {
    const card = $('stats-usb-card');
    if (!card) return;

    if (!msg) {
      setText($('stats-usb-l1'), '—');
      setBadge($('stats-usb-badge-l1'), 'none', '—');
      setText($('stats-usb-l2'), '—');
      setBadge($('stats-usb-badge-l2'), 'none', '—');
      setText($('stats-usb-l3'), '—');
      setBadge($('stats-usb-badge-l3'), 'none', '—');
      setText($('stats-usb-l4'), '—');
      setBadge($('stats-usb-badge-l4'), 'none', '—');
      setText($('stats-usb-l5'), '—');
      setBadge($('stats-usb-badge-l5'), 'none', '—');
      return;
    }

    // L1: Transport (connected, port, baud)
    const port = msg.port || 'USB';
    const baud = msg.baud ? `${msg.baud} ${t('live_debug.stats_usb_baud_unit') || 'бод'}` : '—';
    setText($('stats-usb-l1'), `${port} · ${baud}`);
    setBadge(
      $('stats-usb-badge-l1'),
      msg.connected ? 'ok' : 'none',
      msg.connected ? (t('live_debug.stats_usb_conn_ok') || 'подключен') : (t('live_debug.stats_usb_conn_none') || 'нет')
    );

    // L2: Frames (rate_hz, frames, lost, crc_rejects, garbage_bytes)
    const rate = msg.rate_hz != null ? Number(msg.rate_hz) : 0;
    const frames = msg.frames || 0;
    const lost = msg.lost || 0;
    const crc = msg.crc_rejects || 0;
    const hzUnit = t('live_debug.stats_hz_unit') || 'Гц';
    const frUnit = t('live_debug.stats_usb_frames') || 'фр.';
    const lossUnit = t('live_debug.stats_usb_loss') || 'потерь';
    const crcUnit = t('live_debug.stats_usb_crc') || 'CRC';
    const l2Val = `${rate > 0 ? rate.toFixed(0) : '—'} ${hzUnit} · ${frames} ${frUnit} (${lossUnit}: ${lost}, ${crcUnit}: ${crc})`;
    setText($('stats-usb-l2'), l2Val);
    if (lost > 0 || crc > 0) {
      setBadge($('stats-usb-badge-l2'), 'warn', `${lost + crc} ош.`);
    } else if (rate > 0 || frames > 0) {
      setBadge($('stats-usb-badge-l2'), 'ok', 'стабильно');
    } else {
      setBadge($('stats-usb-badge-l2'), 'none', '—');
    }

    // L3: Protocol (meta_seen, protocol, gyro_range_dps, accel_range_g, declared_hz, meta_age_ms)
    const proto = msg.protocol ? `v${msg.protocol}` : '—';
    const gyroR = msg.gyro_range_dps ? `±${msg.gyro_range_dps}°/s` : '—';
    const accR = msg.accel_range_g ? `±${msg.accel_range_g}g` : '—';
    const declHz = msg.declared_hz ? `${msg.declared_hz} ${hzUnit}` : '—';
    setText($('stats-usb-l3'), `${proto} · ${gyroR} · ${accR} · ${declHz}`);
    const metaAge = msg.meta_age_ms || 0;
    if (msg.meta_seen && metaAge > 5000) {
      setBadge($('stats-usb-badge-l3'), 'warn', t('live_debug.stats_usb_meta_stale') || 'устарели');
    } else if (msg.meta_seen) {
      setBadge($('stats-usb-badge-l3'), 'ok', t('live_debug.stats_usb_meta_ok') || 'актуален');
    } else {
      setBadge($('stats-usb-badge-l3'), 'none', '—');
    }

    // L4: Device (name)
    setText($('stats-usb-l4'), msg.name || '—');
    setBadge(
      $('stats-usb-badge-l4'),
      msg.name ? 'ok' : 'none',
      msg.name ? (t('live_debug.stats_usb_identified') || 'определен') : '—'
    );

    // L5: Reset (reset_button, reset_presses)
    const hasReset = !!msg.reset_button;
    const presses = msg.reset_presses || 0;
    const l5Val = hasReset
      ? `${t('live_debug.stats_usb_btn_present') || 'Кнопка есть'} · ${presses} наж.`
      : (t('live_debug.stats_usb_btn_none') || 'Нет кнопки');
    setText($('stats-usb-l5'), l5Val);
    setBadge(
      $('stats-usb-badge-l5'),
      hasReset ? 'ok' : 'none',
      hasReset ? 'ok' : '—'
    );
  }

  function handleUsbProto(msg) {
    if (!msg) return;
    latestUsbProto = msg;
    if (msg.declared_hz) deriveEngine.setDeclaredUsbHz(msg.declared_hz);
    renderUsbProto(msg);
  }

  function feedStreamFrame(msg) {
    if (!isActive || !msg) return;
    if (msg.type === 'usb_proto') {
      handleUsbProto(msg);
      if (msg.declared_hz) deriveEngine.setDeclaredUsbHz(msg.declared_hz);
      return;
    }
    deriveEngine.feedFrame(msg);
    if (recorder.isRecording) {
      recorder.recordFrame({
        q0: msg.q0 ?? 1,
        q1: msg.q1 ?? 0,
        q2: msg.q2 ?? 0,
        q3: msg.q3 ?? 0,
        rawGx: msg.raw_gx ?? msg.rawRotX ?? 0,
        rawGy: msg.raw_gy ?? msg.rawRotY ?? 0,
        rawGz: msg.raw_gz ?? msg.rawRotZ ?? 0,
        rawAx: msg.raw_ax ?? msg.rawAccX ?? 0,
        rawAy: msg.raw_ay ?? msg.rawAccY ?? 0,
        rawAz: msg.raw_az ?? msg.rawAccZ ?? 0,
        outGx: msg.out_gx ?? lastTuning?.OutX ?? 0,
        outGy: msg.out_gy ?? lastTuning?.OutY ?? 0,
        outGz: msg.out_gz ?? lastTuning?.OutZ ?? 0,
        stickLx: msg.stick_lx ?? 0,
        stickLy: msg.stick_ly ?? 0,
        inHz: msg.in_hz ?? 0,
        outHz: msg.out_hz ?? 0,
        pipeMs: msg.pipe_ms ?? 0,
        dsuClients: msg.dsu_clients ?? 0,
        linkRttMs: msg.link_rtt_ms ?? -1,
      });
    }
  }

  function connectWebSocket() {
    if (wsReconnectTimer) {
      clearTimeout(wsReconnectTimer);
      wsReconnectTimer = null;
    }
    if (!isActive) return;

    try {
      const wsUrl = `ws://${getCoreHost()}/livedebug/ws`;
      ws = new WebSocket(wsUrl);

      ws.onmessage = (event) => {
        if (!isActive) return;
        try {
          const data = JSON.parse(event.data);
          feedStreamFrame(data);
        } catch (_) {}
      };

      ws.onclose = () => {
        scheduleWsReconnect();
      };

      ws.onerror = () => {
        try { ws.close(); } catch (_) {}
      };
    } catch (_) {
      scheduleWsReconnect();
    }
  }

  function scheduleWsReconnect() {
    if (wsReconnectTimer || !isActive) return;
    wsReconnectTimer = setTimeout(connectWebSocket, 1500);
  }

  // 3D Scene loader and manager
  async function mountScene() {
    const host = $('stats-3d-canvas-host');
    if (!host || sceneInstance) return;

    try {
      const sc = await createGyroScene(host, {
        model: selectedModel,
        axes: true,
        still: true,
        views: selectedCamMode === 'quad' ? 'quad' : 'single',
      });
      if (!isActive) {
        sc.dispose();
        return;
      }
      sceneInstance = sc;
      if (typeof sc.setViews === 'function') {
        sc.setViews(selectedCamMode === 'quad' ? 'quad' : 'single');
      }
      const fallback = $('stats-3d-fallback');
      if (fallback) fallback.style.display = 'none';

      if (latestQuat) {
        update3DOrientation(latestQuat);
      }
    } catch (err) {
      console.warn('Failed to load GyroScene, keeping CSS fallback:', err);
    }
  }

  function unmountScene() {
    if (sceneInstance) {
      try {
        sceneInstance.dispose();
      } catch (_) {}
      sceneInstance = null;
    }
    const fallback = $('stats-3d-fallback');
    if (fallback) fallback.style.display = 'flex';
  }

  function update3DOrientation(rawQ) {
    if (!rawQ) return;
    latestQuat = rawQ;
    if (!sceneInstance) return;

    if (selectedCamMode === 'orbit' && (orbitYaw !== 0 || orbitPitch !== 0 || orbitZoom !== 1.0)) {
      if (window.THREE) {
        const qOrbit = new window.THREE.Quaternion().setFromEuler(
          new window.THREE.Euler(orbitPitch, orbitYaw, 0, 'YXZ')
        );
        const qRaw = new window.THREE.Quaternion().fromArray(rawQ);
        const qFinal = qOrbit.multiply(qRaw);
        sceneInstance.setQuaternion(qFinal);
      } else {
        sceneInstance.setQuaternion(rawQ);
      }
    } else {
      sceneInstance.setQuaternion(rawQ);
    }
  }

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

  // Reset Orbit / View helper
  const resetCamera = () => {
    orbitYaw = 0;
    orbitPitch = 0;
    orbitZoom = 1.0;
    if (latestQuat) update3DOrientation(latestQuat);
  };

  // Recenter helper
  const recenterAll = () => {
    resetCamera();
    call('ResetAHRS').catch(() => {});
    if (latestQuat) update3DOrientation(latestQuat);
  };

  // Recenter button
  const btnRecenter = $('btn-stats-recenter');
  if (btnRecenter) {
    btnRecenter.onclick = recenterAll;
  }

  // Hotkeys: Space (recenter) & R (reset orbit)
  const onKeyDown = (e) => {
    if (!isActive) return;
    const activeTag = document.activeElement ? document.activeElement.tagName : '';
    if (activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT') return;

    if (e.code === 'Space') {
      e.preventDefault();
      recenterAll();
    } else if (e.code === 'KeyR') {
      if (selectedCamMode === 'orbit') {
        e.preventDefault();
        resetCamera();
      }
    }
  };

  // 3D Model toggle (Gamepad <-> Cube)
  const modelBtns = paneEl.querySelectorAll('#stats-model-seg button');
  const applyModel = (model) => {
    selectedModel = model;
    modelBtns.forEach((btn) => {
      toggleClass(btn, 'is-active', btn.dataset.model === model);
    });
    if (sceneInstance) {
      sceneInstance.setModel(model);
      if (latestQuat) update3DOrientation(latestQuat);
    }
    try {
      localStorage.setItem('pg-stats-model', model);
    } catch (_) {}
  };
  modelBtns.forEach((btn) => {
    btn.onclick = () => applyModel(btn.dataset.model || 'gamepad');
  });
  try {
    const savedModel = localStorage.getItem('pg-stats-model');
    if (savedModel) applyModel(savedModel);
  } catch (_) {}

  // Camera modes (Static / 4 Cameras / Dynamic Orbit)
  const camBtns = paneEl.querySelectorAll('#stats-cam-mode-seg button');
  const applyCamMode = (mode) => {
    selectedCamMode = mode;
    camBtns.forEach((btn) => {
      toggleClass(btn, 'is-active', btn.dataset.cam === mode);
    });

    const isQuad = mode === 'quad';
    const isOrbit = mode === 'orbit';
    const quadWrap = $('stats-3d-quad-wrap');
    const orbitHint = $('stats-orbit-hint');
    const host = $('stats-3d-canvas-host');

    if (sceneInstance && typeof sceneInstance.setViews === 'function') {
      sceneInstance.setViews(isQuad ? 'quad' : 'single');
    }

    if (quadWrap) quadWrap.style.display = isQuad ? 'grid' : 'none';
    if (orbitHint) orbitHint.style.display = isOrbit ? 'inline-flex' : 'none';
    if (host) host.style.cursor = isOrbit ? 'grab' : 'default';

    const tag = $('stats-viewport-tag');
    if (tag) {
      tag.textContent = isOrbit ? 'DYNAMIC ORBIT' : isQuad ? '4 CAMERAS' : 'STATIC VIEW';
    }
    if (latestQuat) update3DOrientation(latestQuat);
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

  // Orbit pointer interactions on canvas host
  const host = $('stats-3d-canvas-host');
  if (host) {
    host.onpointerdown = (e) => {
      if (selectedCamMode !== 'orbit') return;
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      host.style.cursor = 'grabbing';
      try {
        host.setPointerCapture(e.pointerId);
      } catch (_) {}
    };

    host.onpointermove = (e) => {
      if (!isDragging || selectedCamMode !== 'orbit') return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      startX = e.clientX;
      startY = e.clientY;
      orbitYaw += dx * 0.008;
      orbitPitch += dy * 0.008;
      orbitPitch = Math.max(-1.4, Math.min(1.4, orbitPitch));
      if (latestQuat) update3DOrientation(latestQuat);
    };

    const endDrag = (e) => {
      if (!isDragging) return;
      isDragging = false;
      host.style.cursor = selectedCamMode === 'orbit' ? 'grab' : 'default';
      try {
        host.releasePointerCapture(e.pointerId);
      } catch (_) {}
    };
    host.onpointerup = endDrag;
    host.onpointercancel = endDrag;

    host.ondblclick = () => {
      if (selectedCamMode === 'orbit') {
        resetCamera();
      }
    };

    // Wheel zoom
    host.onwheel = (e) => {
      if (selectedCamMode !== 'orbit') return;
      e.preventDefault();
      orbitZoom += e.deltaY * -0.001;
      orbitZoom = Math.max(0.6, Math.min(2.0, orbitZoom));
      if (latestQuat) update3DOrientation(latestQuat);
    };
  }

  // Orbit hint click also resets
  const orbitHintEl = $('stats-orbit-hint');
  if (orbitHintEl) {
    orbitHintEl.style.pointerEvents = 'auto';
    orbitHintEl.style.cursor = 'pointer';
    orbitHintEl.onclick = resetCamera;
  }

  // Resource saving toggle & Window blur/focus listeners
  const ecoToggle = $('stats-eco-toggle');
  if (ecoToggle) {
    try {
      const savedEco = localStorage.getItem('gb_eco_mode') ?? localStorage.getItem('pg-stats-eco');
      if (savedEco !== null) ecoToggle.checked = savedEco === 'true';
    } catch (_) {}
    ecoToggle.onchange = () => {
      try {
        localStorage.setItem('gb_eco_mode', String(ecoToggle.checked));
        localStorage.setItem('pg-stats-eco', String(ecoToggle.checked));
      } catch (_) {}
    };
  }

  const onWindowBlur = () => {
    if (!isActive) return;
    if (ecoToggle && ecoToggle.checked) {
      if (sceneInstance) sceneInstance.setPaused(true);
      const pauseBadge = $('stats-3d-ecopause');
      if (pauseBadge) pauseBadge.style.display = 'inline-flex';
    }
  };

  const onWindowFocus = () => {
    if (!isActive) return;
    if (sceneInstance) sceneInstance.setPaused(false);
    const pauseBadge = $('stats-3d-ecopause');
    if (pauseBadge) pauseBadge.style.display = 'none';
  };

  // Handle tuning frames (60Hz)
  const handleTuningFrame = (tf) => {
    if (!isActive || !tf) return;
    lastTuning = tf;
    deriveEngine.feedTuning(tf);
    setText($('tel-out-gx'), (tf.OutX >= 0 ? '+' : '') + tf.OutX.toFixed(2));
    setText($('tel-out-gy'), (tf.OutY >= 0 ? '+' : '') + tf.OutY.toFixed(2));
    setText($('tel-out-gz'), (tf.OutZ >= 0 ? '+' : '') + tf.OutZ.toFixed(2));
    if (recorder.isRecording && (!ws || ws.readyState !== 1)) {
      recorder.recordFrame({
        rawGx: tf.RawX,
        rawGy: tf.RawY,
        rawGz: tf.RawZ,
        outGx: tf.OutX,
        outGy: tf.OutY,
        outGz: tf.OutZ,
        inHz: tf.Hz,
      });
    }
  };

  // Handle livedebug telemetry messages (e.g. from wails bridge)
  const handleLiveTelemetry = (raw) => {
    if (!isActive || !raw) return;
    try {
      const msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
      feedStreamFrame(msg);
    } catch (_) {}
  };

  const handleResourceStats = (r) => {
    if (!isActive || !r) return;
    deriveEngine.feedResources(r);
  };

  // Handle 3D orientation quaternion (60Hz)
  const handleAhrsQuat = (data) => {
    if (!isActive || !data) return;
    quatBuf[0] = data.q1 ?? 0;
    quatBuf[1] = data.q2 ?? 0;
    quatBuf[2] = data.q3 ?? 0;
    quatBuf[3] = data.q0 ?? 1;
    update3DOrientation(quatBuf);
  };

  // 10 Hz derivation tick updating Groups A and B
  const tickDerive = () => {
    if (!isActive) return;
    const res = deriveEngine.compute();

    // ═══ HERO TILE: Channel Quality Index ═══
    setText($('stat-quality-val'), res.isConnected ? String(res.quality) : '0');
    const qualBadge = $('stat-quality-badge');
    if (qualBadge) {
      setBadge(qualBadge, res.qualityStatus, res.isConnected ? `${res.quality}%` : 'OFF');
    }
    const qualCircle = $('stat-quality-circle');
    if (qualCircle) {
      const offset = (113.1 * (1 - (res.isConnected ? res.quality : 0) / 100)).toFixed(1);
      qualCircle.style.strokeDashoffset = String(offset);
      qualCircle.style.stroke = res.isConnected
        ? (res.qualityStatus === 'ok' ? 'var(--accent)' : res.qualityStatus === 'warn' ? 'var(--warn)' : 'var(--danger)')
        : 'var(--danger)';
    }
    const qualVerdict = $('stat-quality-verdict');
    if (qualVerdict) {
      setText(qualVerdict, res.isConnected ? res.qualityVerdict : (t('ui.stats_offline') || 'ОФФЛАЙН'));
    }
    const qualDesc = $('stat-quality-desc');
    if (qualDesc) {
      setText(
        qualDesc,
        res.isConnected
          ? `Потери ${res.lossPct}% · RTT ${res.rttMs} ms · ${res.inHz} Hz`
          : (t('ui.stats_offline_tip') || 'Подключите устройство')
      );
    }
    const qualSpark = $('stat-quality-spark');
    if (qualSpark) {
      const p = buildSparkline(res.qualityHistory, 0, 100, 100, 32);
      if (p) qualSpark.setAttribute('d', p);
    }

    // ═══ GROUP A: Network / Connection ═══
    // 2. Frequency In (Hz)
    setText($('stat-hz-val'), res.inHz);
    setBadge($('stat-hz-badge'), res.hzStatus);
    const hzVal = Number(res.inHz) || 0;
    history.hz.push(hzVal);
    if (history.hz.length > MAX_HISTORY) history.hz.shift();
    const hzSpark = $('stat-hz-spark');
    if (hzSpark) hzSpark.setAttribute('d', buildSparkline(history.hz, 0, 70));

    // 3. Latency RTT (ms)
    setText($('stat-lat-val'), res.rttMs);
    setBadge($('stat-lat-badge'), res.rttStatus);
    if (res.rttMs !== '—') {
      const latVal = Number(res.rttMs) || 0;
      history.lat.push(latVal);
      if (history.lat.length > MAX_HISTORY) history.lat.shift();
      const latSpark = $('stat-lat-spark');
      if (latSpark) latSpark.setAttribute('d', buildSparkline(history.lat, 0, Math.max(25, ...history.lat)));
    }

    // 4. Jitter (ms)
    setText($('stat-jitter-val'), res.jitterMs);
    setBadge($('stat-jitter-badge'), res.jitterStatus);
    const jitVal = Number(res.jitterMs) || 0;
    history.jitter.push(jitVal);
    if (history.jitter.length > MAX_HISTORY) history.jitter.shift();
    const jitSpark = $('stat-jitter-spark');
    if (jitSpark) jitSpark.setAttribute('d', buildSparkline(history.jitter, 0, Math.max(12, ...history.jitter)));

    // 5. Latency Tail
    setText($('stat-tail-p95'), res.tailP95);
    setText($('stat-tail-max'), res.tailMax);
    setText($('stat-tail-dt'), res.tailAvg);
    setBadge($('stat-tail-badge'), res.tailStatus, res.tailStatus === 'ok' ? 'ok' : 'spike');

    // 6. Loss / Merged
    setText($('stat-loss-val'), String(res.lossCount));
    setText($('stat-loss-unit'), `(${res.lossPct}%)`);
    setBadge($('stat-loss-badge'), res.lossStatus, `${res.lossPct}%`);
    const lossVal = Number(res.lossPct) || 0;
    history.loss.push(lossVal);
    if (history.loss.length > MAX_HISTORY) history.loss.shift();
    const lossSpark = $('stat-loss-spark');
    if (lossSpark) lossSpark.setAttribute('d', buildSparkline(history.loss, 0, 10));

    // ═══ GROUP B: Signal State ═══
    // 7. Drift in Rest
    const dxEl = $('stat-drift-x');
    if (dxEl) {
      setText(dxEl, res.driftX);
      setText($('stat-drift-y'), res.driftY);
      setText($('stat-drift-z'), res.driftZ);
    }
    const dValEl = $('stat-drift-val');
    if (dValEl) {
      setText(dValEl, res.driftDps);
    }
    setBadge(
      $('stat-drift-badge'),
      res.driftStatus,
      res.isResting ? (t('ui.stats_drift_still') || 'Покой') : (t('ui.stats_drift_motion') || 'Движение')
    );

    // 8. Noise in Rest
    setText($('stat-noise-val'), res.noiseDps);
    const nTagEl = $('stat-noise-tag');
    if (nTagEl) setText(nTagEl, res.noiseTag);
    setBadge($('stat-noise-badge'), res.noiseStatus, res.noiseTag);

    // 9. Gravity |a|
    setText($('stat-gravity-val'), res.gravityMag);
    setText($('stat-gravity-delta'), res.gravityDelta);
    setBadge($('stat-gravity-badge'), res.gravityStatus, res.gravityStatus === 'ok' ? 'ok' : 'bias');

    // 10. Omega |ω|
    setText($('stat-omega-val'), res.omegaMag);
    setText($('stat-omega-peak'), res.omegaPeak);
    setBadge($('stat-omega-badge'), res.omegaStatus, res.omegaMag);

    // ═══ GROUP C: Pipeline & Active Filter Chips ═══
    setText($('stat-pipe-profile'), `Профиль: ${res.activeProfileName}`);
    const pMount = $('stat-pipe-mount');
    if (pMount) {
      setText(pMount, `Наклон: ${res.mountText}`);
      toggleClass(pMount, 'pg-badge--ok', res.mountActive);
    }
    const pCemu = $('stat-pipe-cemu');
    if (pCemu) {
      setText(pCemu, `Защита Cemu: ${res.cemuGuardText}`);
      toggleClass(pCemu, 'pg-badge--ok', res.cemuGuardActive);
    }
    setText($('stat-pipe-deadband'), `Deadband: ${res.deadbandText}`);
    setText($('stat-pipe-sens'), `Sens: ${res.sensText}`);

    setText($('stat-pipe-val'), res.pipeMs);
    setText($('stat-out-hz-val'), res.outHz);
    setBadge($('stat-pipe-badge'), res.pipeStatus, res.pipeStatus === 'none' ? 'нет данных' : 'ok');
    if (res.pipeMs !== '—') {
      const pVal = Number(res.pipeMs) || 0;
      history.pipe.push(pVal);
      if (history.pipe.length > MAX_HISTORY) history.pipe.shift();
      const pipeSpark = $('stat-pipe-spark');
      if (pipeSpark) pipeSpark.setAttribute('d', buildSparkline(history.pipe, 0, 5));
    }

    // ═══ GROUP D: Raw & Output Gyro/Accel (Numbers) ═══
    setText($('tel-raw-gx'), res.rawGx);
    setText($('tel-raw-gy'), res.rawGy);
    setText($('tel-raw-gz'), res.rawGz);
    setText($('tel-raw-ax'), res.rawAx);
    setText($('tel-raw-ay'), res.rawAy);
    setText($('tel-raw-az'), res.rawAz);
    setText($('tel-out-gx'), res.outGx);
    setText($('tel-out-gy'), res.outGy);
    setText($('tel-out-gz'), res.outGz);

    // ═══ GROUP E: DSU Clients & Session ═══
    setText($('stat-dsu-count'), String(res.dsuCount));
    setText($('stat-dsu-label'), formatDsuClientsLabel(res.dsuCount));
    setBadge($('stat-dsu-badge'), res.dsuCount > 0 ? 'ok' : 'none', String(res.dsuCount));

    const dsuNameEl = $('stat-dsu-client-name');
    if (dsuNameEl) {
      if (res.dsuList && res.dsuList.length > 0) {
        dsuNameEl.style.display = '';
        dsuNameEl.innerHTML = `
          <div class="app-dsu-client-list">
            ${res.dsuList.map((c) => `
              <div class="app-dsu-client-row">
                <b>${escapeHtml(c.process || c.name || 'DSU Client')}</b>
                <span>${escapeHtml(c.address || c.addr || '')}</span>
                <span class="pg-badge pg-badge--ok">${escapeHtml(c.status || t('live_debug.stats_dsu_client_active_status') || 'активен')}</span>
              </div>
            `).join('')}
          </div>
        `;
      } else {
        dsuNameEl.style.display = 'none';
        dsuNameEl.innerHTML = '';
      }
    }

    setText($('stat-sess-time'), res.connectedTime);
    setText($('stat-sess-pkts'), String(res.sessionPackets));
    setText($('stat-sess-loss'), String(res.sessionLost));
    setText($('stat-sess-bytes'), `${res.sessionKb} KB`);

    setText($('stat-res-cpu'), res.cpuPercent === '—' ? '—' : `${res.cpuPercent}%`);
    setText($('stat-res-ram'), res.ramMb === '—' ? '—' : `${res.ramMb} MB`);
    setBadge($('stat-res-badge'), res.resStatus, res.resStatus === 'ok' ? 'ok' : 'warn');

    // ═══ GROUP F: USB Protocol (Live Update) ═══
    const isUsb = !!(latestState?.inputMode === 'usb');
    const usbCard = $('stats-usb-card');
    if (usbCard) {
      usbCard.hidden = !isUsb;
      if (isUsb) {
        renderUsbProto(latestUsbProto);
      }
    }

    // Offline overlay
    const offlineOverlay = $('stats-3d-offline');
    if (offlineOverlay) {
      offlineOverlay.style.display = res.isConnected ? 'none' : 'flex';
    }
    const liveBadge = $('stats-live-badge');
    if (liveBadge) {
      toggleClass(liveBadge, 'pg-badge--ok', res.hasLiveStream);
      toggleClass(liveBadge, 'pg-badge--warn', !res.hasLiveStream);
      setText(liveBadge, !res.isConnected ? (t('ui.stats_offline') || 'ОФФЛАЙН') : (!res.hasLiveStream ? 'НЕТ ДАННЫХ' : (t('ui.stats_live') || 'LIVE')));
    }
  };

  let latestState = null;

  // Render State (15Hz from Go AppState)
  const renderState = (state) => {
    if (!isActive || !state) return;
    latestState = state;
    deriveEngine.feedState(state);

    // USB Status (Group F)
    const isUsb = !!(state.inputMode === 'usb');
    const usbCard = $('stats-usb-card');
    if (usbCard) {
      usbCard.hidden = !isUsb;
      if (isUsb) {
        if (!latestUsbProto && state.usbPort) {
          renderUsbProto({
            connected: !!state.usbConnected,
            port: state.usbPort,
            baud: 115200,
          });
        } else {
          renderUsbProto(latestUsbProto);
        }
      }
    }

    // If AHRS quaternion available from state and no standalone event yet
    if (!latestQuat && (state.ahrsQ0 != null || state.qw != null)) {
      quatBuf[0] = state.ahrsQ1 ?? state.qx ?? 0;
      quatBuf[1] = state.ahrsQ2 ?? state.qy ?? 0;
      quatBuf[2] = state.ahrsQ3 ?? state.qz ?? 0;
      quatBuf[3] = state.ahrsQ0 ?? state.qw ?? 1;
      update3DOrientation(quatBuf);
    }
  };

  // State subscriber (always receives state:change, but renders only if isActive)
  onState(renderState);

  return {
    activate: () => {
      if (isActive) return;
      isActive = true;
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('blur', onWindowBlur);
      window.addEventListener('focus', onWindowFocus);
      on('tuning:frame', handleTuningFrame);
      on('livedebug:telemetry', handleLiveTelemetry);
      on('ahrs:quat', handleAhrsQuat);
      on('usb_proto', handleUsbProto);
      on('usb:status', handleUsbProto);
      call('SetTuningActive', true).catch(() => {});
      call('GetAppSettings').then((s) => deriveEngine.feedSettings(s)).catch(() => {});
      call('GetResourceStats').then((r) => deriveEngine.feedResources(r)).catch(() => {});
      on('resource-stats', handleResourceStats);
      mountScene();
      connectWebSocket();
      deriveInterval = setInterval(tickDerive, 100);
      renderState(getState());
      tickDerive();
    },
    deactivate: () => {
      if (!isActive) return;
      isActive = false;
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('blur', onWindowBlur);
      window.removeEventListener('focus', onWindowFocus);
      off('tuning:frame', handleTuningFrame);
      off('livedebug:telemetry', handleLiveTelemetry);
      off('ahrs:quat', handleAhrsQuat);
      off('usb_proto', handleUsbProto);
      off('usb:status', handleUsbProto);
      off('resource-stats', handleResourceStats);
      call('SetTuningActive', false).catch(() => {});
      if (ws) {
        try { ws.close(); } catch (_) {}
        ws = null;
      }
      if (wsReconnectTimer) {
        clearTimeout(wsReconnectTimer);
        wsReconnectTimer = null;
      }
      if (deriveInterval) {
        clearInterval(deriveInterval);
        deriveInterval = null;
      }
      deriveEngine.reset();
      unmountScene();
      if (recorder.isRecording) {
        recorder.stop();
      }
    },
    getRecorder: () => recorder,
    getScene: () => sceneInstance,
    getDeriveEngine: () => deriveEngine,
  };
}
