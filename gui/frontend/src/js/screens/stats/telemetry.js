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

function setBadge(el, status, text = null) {
  if (!el) return;
  el.className = `pg-badge pg-badge--${status || 'ok'}`;
  if (text != null) setText(el, text);
}

function getCoreHost() {
  const h = window.location.hostname;
  if (!h || h === 'wails.localhost' || h === 'localhost.wails' || window.location.protocol === 'file:') {
    return '127.0.0.1:8080';
  }
  if (h === 'localhost' || h === '127.0.0.1') {
    return `${h}:${window.location.port || '8080'}`;
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
          deriveEngine.feedFrame(data);
          if (data && data.type === 'usb_proto') {
            handleUsbProto(data);
          }
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
    setText($('tel-out-gx'), (tf.OutX >= 0 ? '+' : '') + tf.OutX.toFixed(2));
    setText($('tel-out-gy'), (tf.OutY >= 0 ? '+' : '') + tf.OutY.toFixed(2));
    setText($('tel-out-gz'), (tf.OutZ >= 0 ? '+' : '') + tf.OutZ.toFixed(2));
  };

  function handleUsbProto(msg) {
    if (!msg) return;
    const l1 = $('stats-usb-l1');
    const l2 = $('stats-usb-l2');
    const l3 = $('stats-usb-l3');
    const l4 = $('stats-usb-l4');
    if (l1) setText(l1, `${msg.port || 'USB'} · ${msg.baud || 115200}`);
    if (l2) setText(l2, `${(msg.rate_hz || 0).toFixed(0)} Гц · ${msg.frames || 0} фр.`);
    if (l3) setText(l3, `${msg.protocol || 'v1.1.0'} · ±${msg.gyro_range_dps || 2000}°/s · ±${msg.accel_range_g || 8}g`);
    if (l4) setText(l4, `${msg.crc_rejects || 0} CRC · ${msg.lost || 0} потерь`);
  }

  // Handle livedebug telemetry messages (e.g. from wails bridge)
  const handleLiveTelemetry = (raw) => {
    if (!isActive || !raw) return;
    try {
      const msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
      deriveEngine.feedFrame(msg);
      if (msg && msg.type === 'usb_proto') {
        handleUsbProto(msg);
      }
    } catch (_) {}
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

    // Offline overlay
    const offlineOverlay = $('stats-3d-offline');
    if (offlineOverlay) {
      offlineOverlay.style.display = res.isConnected ? 'none' : 'flex';
    }
    const liveBadge = $('stats-live-badge');
    if (liveBadge) {
      toggleClass(liveBadge, 'pg-badge--ok', res.isConnected);
      toggleClass(liveBadge, 'pg-badge--warn', !res.isConnected);
      setText(liveBadge, res.isConnected ? (t('ui.stats_live') || 'LIVE') : (t('ui.stats_offline') || 'ОФФЛАЙН'));
    }
  };

  // Render State (15Hz from Go AppState)
  const renderState = (state) => {
    if (!isActive || !state) return;
    deriveEngine.feedState(state);

    // ═══ GROUP C: Pipeline & Active Filter Chips ═══
    const activeProf = state.activeSlot?.name || state.profileName || 'По умолчанию';
    setText($('stat-pipe-profile'), `Профиль: ${activeProf}`);
    setText($('stat-pipe-mount'), `Наклон: ${state.mountCorrection ? 'Вкл' : 'Выкл'}`);
    setText($('stat-pipe-cemu'), `Защита Cemu: ${state.cemuGuardActive ? 'Вкл' : 'Выкл'}`);
    setText($('stat-pipe-deadband'), `Deadband: ${state.deadbandActive ? 'Вкл' : 'Выкл'}`);
    setText($('stat-pipe-sens'), `Sens: ${state.sensitivity != null ? state.sensitivity.toFixed(1) + 'x' : '1.0x'}`);

    const pipeMs = Number(state.pipeMs ?? 0.4);
    setText($('stat-pipe-val'), pipeMs.toFixed(1));
    setText($('stat-out-hz-val'), (state.outHz || state.hz || 60).toFixed(0));
    history.pipe.push(pipeMs);
    if (history.pipe.length > MAX_HISTORY) history.pipe.shift();
    const pipeSpark = $('stat-pipe-spark');
    if (pipeSpark) pipeSpark.setAttribute('d', buildSparkline(history.pipe, 0, 5));

    // ═══ GROUP D: Raw & Output Gyro/Accel (Numbers) ═══
    const gx = state.rawRotX || 0;
    const gy = state.rawRotY || 0;
    const gz = state.rawRotZ || 0;
    const ax = state.rawAccX || 0;
    const ay = state.rawAccY || 0;
    const az = state.rawAccZ != null ? state.rawAccZ : -1.0;

    const elRgx = $('tel-raw-gx') || $('stat-raw-gx');
    if (elRgx) setText(elRgx, (gx >= 0 ? '+' : '') + gx.toFixed(2));
    const elRgy = $('tel-raw-gy') || $('stat-raw-gy');
    if (elRgy) setText(elRgy, (gy >= 0 ? '+' : '') + gy.toFixed(2));
    const elRgz = $('tel-raw-gz') || $('stat-raw-gz');
    if (elRgz) setText(elRgz, (gz >= 0 ? '+' : '') + gz.toFixed(2));

    const elRax = $('tel-raw-ax') || $('stat-raw-ax');
    if (elRax) setText(elRax, (ax >= 0 ? '+' : '') + ax.toFixed(2));
    const elRay = $('tel-raw-ay') || $('stat-raw-ay');
    if (elRay) setText(elRay, (ay >= 0 ? '+' : '') + ay.toFixed(2));
    const elRaz = $('tel-raw-az') || $('stat-raw-az');
    if (elRaz) setText(elRaz, (az >= 0 ? '+' : '') + az.toFixed(2));

    // ═══ GROUP E: DSU Clients & Session ═══
    const dsuCount = state.dsuClients || 0;
    setText($('stat-dsu-count'), String(dsuCount));
    setText($('stat-dsu-badge'), String(dsuCount));
    const dsuList = state.dsuClientList;
    const clientName = Array.isArray(dsuList) && dsuList.length > 0
      ? dsuList.map((c) => c.name || c.ip || 'Client').join(', ')
      : '—';
    setText($('stat-dsu-client-name'), clientName);

    // Session stats
    if (state.connectedTime) {
      setText($('stat-sess-time'), state.connectedTime);
    }
    if (state.sessionPackets != null) {
      setText($('stat-sess-pkts'), String(state.sessionPackets));
    }
    if (state.sessionLoss != null) {
      setText($('stat-sess-loss'), String(state.sessionLoss));
    }
    if (state.sessionBytes != null) {
      const kb = (state.sessionBytes / 1024).toFixed(0);
      setText($('stat-sess-bytes'), `${kb} KB`);
    }

    // Process Resources
    if (state.cpuPercent != null) {
      setText($('stat-res-cpu'), `${state.cpuPercent.toFixed(1)}%`);
    }
    if (state.ramMb != null) {
      setText($('stat-res-ram'), `${state.ramMb.toFixed(0)} MB`);
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

    // If AHRS quaternion available from state and no standalone event yet
    if (!latestQuat && (state.ahrsQ0 != null || state.qw != null)) {
      quatBuf[0] = state.ahrsQ1 ?? state.qx ?? 0;
      quatBuf[1] = state.ahrsQ2 ?? state.qy ?? 0;
      quatBuf[2] = state.ahrsQ3 ?? state.qz ?? 0;
      quatBuf[3] = state.ahrsQ0 ?? state.qw ?? 1;
      update3DOrientation(quatBuf);
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
      window.addEventListener('blur', onWindowBlur);
      window.addEventListener('focus', onWindowFocus);
      on('tuning:frame', handleTuningFrame);
      on('livedebug:telemetry', handleLiveTelemetry);
      on('ahrs:quat', handleAhrsQuat);
      call('SetTuningActive', true).catch(() => {});
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
