/**
 * @file derive.js
 * Telemetry metrics derivation engine for Groups A and B.
 * Computes Link Quality Index, Jitter, Latency Tail percentiles,
 * resting state, gyro drift, gyro noise, gravity magnitude, and omega rate.
 *
 * ТОЧНАЯ ФОРМУЛА КАЧЕСТВА КАНАЛА (0–100):
 * Индекс качества канала Q рассчитывается по 4 нормализованным компонентам S_i in [0, 1]
 * со строгими утвержденными весами:
 * 1. S_loss (вес 40% = 0.40):
 *    - lossPct == 0% -> 1.0
 *    - lossPct in (0%, 5%] -> 1.0 - (lossPct / 5.0)
 *    - lossPct > 5% -> 0.0
 * 2. S_tail (вес 25% = 0.25):
 *    - p95 хвост интервала/RTT <= 15.0 ms -> 1.0
 *    - p95 in (15.0 ms, 80.0 ms) -> 1.0 - (p95 - 15.0) / 65.0
 *    - p95 >= 80.0 ms -> 0.0
 *    - Для USB (где сетевой RTT = -1) -> 1.0 (нет сетевого джиттера задержки)
 * 3. S_jitter (вес 20% = 0.20):
 *    - СКО интервалов пакетов <= 2.0 ms -> 1.0
 *    - СКО in (2.0 ms, 15.0 ms) -> 1.0 - (jitter - 2.0) / 13.0
 *    - СКО >= 15.0 ms -> 0.0
 * 4. S_rate (вес 15% = 0.15):
 *    - Отношение входящей частоты к целевой r = inHz / targetHz (targetHz = 60 для Wi-Fi, 200 для USB)
 *    - r >= 0.95 -> 1.0
 *    - r in (0.30, 0.95) -> (r - 0.30) / 0.65
 *    - r <= 0.30 -> 0.0
 *
 * ИТОГОВЫЙ ИНДЕКС:
 * Q = Math.round(100 * (0.40 * S_loss + 0.25 * S_tail + 0.20 * S_jitter + 0.15 * S_rate))
 * Если устройство не подключено (offline): Q = 0.
 *
 * ПОРОГИ ВЕРДИКТА:
 * Q >= 80: 'ok' ('Отличное качество связи' / 'Excellent')
 * 50 <= Q <= 79: 'warn' ('Среднее качество связи' / 'Fair')
 * Q < 50: 'danger' ('Нестабильный канал' / 'Unstable')
 * Офлайн: 'danger' ('ОФФЛАЙН' / 'OFFLINE')
 *
 * ОПРЕДЕЛЕНИЕ ПОКОЯ:
 * |ω| < 0.5 °/с непрерывно в течение >= 1.0 секунды.
 * (Порог согласуется с gyrobias.go: шум сенсора телефона в покое < 0.1 °/с, в руке > 1.3 °/с).
 */

export class TelemetryDeriveEngine {
  constructor() {
    // Ring buffer for packet arrival intervals (last ~30 seconds at 60Hz = 1800 samples)
    this.MAX_INTERVALS = 1800;
    this.intervals = new Float32Array(this.MAX_INTERVALS);
    this.intervalCount = 0;
    this.intervalIdx = 0;

    // Rolling raw gyro and accel buffers (last 5 seconds at 60Hz = 300 samples)
    this.MAX_SAMPLES = 300;
    this.gyroX = new Float32Array(this.MAX_SAMPLES);
    this.gyroY = new Float32Array(this.MAX_SAMPLES);
    this.gyroZ = new Float32Array(this.MAX_SAMPLES);
    this.accelX = new Float32Array(this.MAX_SAMPLES);
    this.accelY = new Float32Array(this.MAX_SAMPLES);
    this.accelZ = new Float32Array(this.MAX_SAMPLES);
    this.sampleCount = 0;
    this.sampleIdx = 0;

    // Rest detection state
    this.REST_OMEGA_THRESHOLD = 0.5; // deg/s
    this.REST_TIME_REQUIRED_MS = 1000; // 1.0 s
    this.restStartTime = 0;
    this.isResting = false;
    this.lastComputedDrift = null;
    this.lastComputedNoise = null;

    // Rolling 60-second peak for |ω|
    this.PEAK_WINDOW_MS = 60000;
    this.omegaHistory = []; // array of { ts, val }
    this.peakOmega = 0;

    // History of quality index for sparkline (last 20 points)
    this.qualityHistory = [];

    // State tracking
    this.lastRecvTs = 0;
    this.lastFrameWallTime = 0;
    this.declaredUsbHz = 0;
    this.rollingInHzSum = 0;
    this.rollingInHzCount = 0;
    this.latestFrame = null;
    this.latestState = null;
    this.latestSettings = null;
    this.latestResources = null;
    this.latestTuning = null;
    this.lastDeriveTime = 0;
    this.cachedResult = null;
  }

  reset() {
    this.intervalCount = 0;
    this.intervalIdx = 0;
    this.sampleCount = 0;
    this.sampleIdx = 0;
    this.restStartTime = 0;
    this.isResting = false;
    this.lastComputedDrift = null;
    this.lastComputedDriftX = null;
    this.lastComputedDriftY = null;
    this.lastComputedDriftZ = null;
    this.lastComputedNoise = null;
    this.omegaHistory = [];
    this.peakOmega = 0;
    this.qualityHistory = [];
    this.lastRecvTs = 0;
    this.lastFrameWallTime = 0;
    this.rollingInHzSum = 0;
    this.rollingInHzCount = 0;
    this.latestFrame = null;
    this.latestState = null;
    this.latestSettings = null;
    this.latestResources = null;
    this.latestTuning = null;
    this.cachedResult = null;
  }

  setDeclaredUsbHz(hz) {
    if (typeof hz === 'number' && hz > 0) {
      this.declaredUsbHz = hz;
    }
  }

  feedSettings(s) {
    if (s) this.latestSettings = s;
  }

  feedResources(r) {
    if (r) this.latestResources = r;
  }

  feedTuning(t) {
    if (t) this.latestTuning = t;
  }

  /**
   * Feed a telemetry sample frame from WebSocket or Wails tuning/state
   * @param {Object} f
   */
  feedFrame(f) {
    if (!f) return;
    this.latestFrame = f;

    const now = performance.now();
    this.lastFrameWallTime = now;
    if (typeof f.in_hz === 'number' && f.in_hz > 0) {
      this.rollingInHzSum += f.in_hz;
      this.rollingInHzCount++;
      if (this.rollingInHzCount > 120) {
        this.rollingInHzSum /= 2;
        this.rollingInHzCount /= 2;
      }
    }

    let recvMs = now;
    if (typeof f.recv_ts === 'number' && f.recv_ts > 0) {
      recvMs = f.recv_ts > 1e12 ? f.recv_ts / 1000 : f.recv_ts;
    }

    if (this.lastRecvTs > 0) {
      const dt = recvMs - this.lastRecvTs;
      // Filter out gaps (e.g. pause, disconnect, stream start): nominal intervals are ~16.6ms (60Hz) or ~5ms (200Hz).
      // Only treat dt in [1, 200] ms as inter-packet interval for jitter/tail statistics.
      if (dt >= 1 && dt <= 200) {
        this.intervals[this.intervalIdx] = dt;
        this.intervalIdx = (this.intervalIdx + 1) % this.MAX_INTERVALS;
        if (this.intervalCount < this.MAX_INTERVALS) this.intervalCount++;
      }
    }
    this.lastRecvTs = recvMs;

    // Store raw gyro and accel
    const gx = f.rawGx ?? f.raw_gx ?? f.rawRotX ?? 0;
    const gy = f.rawGy ?? f.raw_gy ?? f.rawRotY ?? 0;
    const gz = f.rawGz ?? f.raw_gz ?? f.rawRotZ ?? 0;
    const ax = f.rawAx ?? f.raw_ax ?? f.rawAccX ?? 0;
    const ay = f.rawAy ?? f.raw_ay ?? f.rawAccY ?? 0;
    const az = f.rawAz ?? f.raw_az ?? f.rawAccZ ?? 0;

    this.gyroX[this.sampleIdx] = gx;
    this.gyroY[this.sampleIdx] = gy;
    this.gyroZ[this.sampleIdx] = gz;
    this.accelX[this.sampleIdx] = ax;
    this.accelY[this.sampleIdx] = ay;
    this.accelZ[this.sampleIdx] = az;

    this.sampleIdx = (this.sampleIdx + 1) % this.MAX_SAMPLES;
    if (this.sampleCount < this.MAX_SAMPLES) this.sampleCount++;

    // Track |ω|
    const omega = Math.sqrt(gx * gx + gy * gy + gz * gz);
    const frameTime = recvMs;
    this.omegaHistory.push({ ts: frameTime, val: omega });
    while (this.omegaHistory.length > 0 && frameTime - this.omegaHistory[0].ts > this.PEAK_WINDOW_MS) {
      this.omegaHistory.shift();
    }
    let p = 0;
    for (let i = 0; i < this.omegaHistory.length; i++) {
      if (this.omegaHistory[i].val > p) p = this.omegaHistory[i].val;
    }
    this.peakOmega = p;

    // Resting state evaluation (|ω| < 0.5 deg/s for >= 1.0 s)
    if (omega < this.REST_OMEGA_THRESHOLD) {
      if (this.restStartTime === 0) {
        this.restStartTime = frameTime;
      } else if (frameTime - this.restStartTime >= this.REST_TIME_REQUIRED_MS) {
        this.isResting = true;
      }
    } else {
      this.restStartTime = 0;
      this.isResting = false;
    }
  }

  /**
   * Feed high-level AppState
   * @param {Object} st
   */
  feedState(st) {
    if (!st) return;
    this.latestState = st;
  }

  /**
   * Run derivation calculations (throttled to <= 10 Hz)
   * @param {number} [forceNow]
   * @returns {Object} metrics summary
   */
  compute(forceNow) {
    const now = forceNow ?? performance.now();
    // Return cached if called faster than 100ms (10Hz)
    if (!forceNow && this.cachedResult && now >= this.lastDeriveTime && (now - this.lastDeriveTime < 95)) {
      return this.cachedResult;
    }
    if (!forceNow) {
      this.lastDeriveTime = now;
    }

    const frame = this.latestFrame || {};
    const state = this.latestState || {};

    const isConnected = !!(frame.device_connected ?? (state.status === 'online' || state.status === 'calibrating'));
    const isUsb = !!(frame.loss_kind === 'usb' || state.inputMode === 'usb' || state.usbConnected);
    const hasLiveStream = isConnected && this.lastFrameWallTime > 0 && (now - this.lastFrameWallTime <= 3000);

    // ── 1. GROUP A: Network / Transport ──
    const inHz = Number(frame.in_hz ?? state.hz ?? 0);

    // Dynamic target Hz: declared by device metadata, or minute rolling average, or default
    let targetHz = 60.0;
    if (isUsb) {
      if (this.declaredUsbHz > 0) {
        targetHz = this.declaredUsbHz;
      } else if (this.rollingInHzCount >= 10 && this.rollingInHzSum > 0) {
        targetHz = Math.round(this.rollingInHzSum / this.rollingInHzCount);
      } else {
        targetHz = 200.0;
      }
    }

    const pingVal = typeof frame.link_rtt_ms === 'number'
      ? frame.link_rtt_ms
      : typeof state.pingMs === 'number' ? state.pingMs : -1;
    const rttMs = isUsb || pingVal < 0 ? -1 : pingVal;

    // Jitter: standard deviation of intervals (ms)
    let jitterMs = 0;
    let avgInterval = 0;
    let p95Interval = 0;
    let maxInterval = 0;

    if (this.intervalCount > 1) {
      let sum = 0;
      const cnt = this.intervalCount;
      const sorted = new Float32Array(cnt);
      for (let i = 0; i < cnt; i++) {
        const v = this.intervals[i];
        sum += v;
        sorted[i] = v;
      }
      avgInterval = sum / cnt;

      let varianceSum = 0;
      for (let i = 0; i < cnt; i++) {
        const diff = this.intervals[i] - avgInterval;
        varianceSum += diff * diff;
      }
      jitterMs = Math.sqrt(varianceSum / cnt);

      // Sort for p95 and max
      sorted.sort();
      const p95Idx = Math.min(cnt - 1, Math.floor(cnt * 0.95));
      p95Interval = sorted[p95Idx];
      maxInterval = sorted[cnt - 1];
    }

    // Packet Loss & Merged
    const lossTotal = Number(frame.loss_total ?? 0);
    const lossLost = Number(frame.loss_lost ?? 0);
    const lossMerged = Number(frame.loss_merged ?? 0);
    const lossPct = lossTotal > 0 ? (lossLost / lossTotal) * 100 : 0;

    // ── 2. LINK QUALITY INDEX (0–100) ──
    let quality = 0;
    let qualityStatus = 'danger';
    let qualityVerdict = 'ОФФЛАЙН';

    if (!isConnected) {
      quality = 0;
      qualityStatus = 'danger';
      qualityVerdict = 'ОФФЛАЙН';
    } else if (!hasLiveStream) {
      quality = 0;
      qualityStatus = 'none';
      qualityVerdict = 'НЕТ ДАННЫХ';
    } else {
      // 1. Loss score (40%)
      let sLoss = 1.0;
      if (lossPct > 0) {
        sLoss = Math.max(0.0, 1.0 - (lossPct / 5.0));
      }

      // 2. Tail score (25%)
      let sTail = 1.0;
      if (!isUsb) {
        const tailMetric = p95Interval > 0 ? p95Interval : (rttMs > 0 ? rttMs : 16.6);
        if (tailMetric <= 15.0) {
          sTail = 1.0;
        } else if (tailMetric >= 80.0) {
          sTail = 0.0;
        } else {
          sTail = Math.max(0.0, Math.min(1.0, 1.0 - (tailMetric - 15.0) / 65.0));
        }
      }

      // 3. Jitter score (20%)
      let sJitter = 1.0;
      if (jitterMs <= 2.0) {
        sJitter = 1.0;
      } else if (jitterMs >= 15.0) {
        sJitter = 0.0;
      } else {
        sJitter = Math.max(0.0, Math.min(1.0, 1.0 - (jitterMs - 2.0) / 13.0));
      }

      // 4. Rate score (15%)
      let sRate = 0.0;
      const rateRatio = inHz / targetHz;
      if (rateRatio >= 0.95) {
        sRate = 1.0;
      } else if (rateRatio <= 0.30) {
        sRate = 0.0;
      } else {
        sRate = Math.max(0.0, Math.min(1.0, (rateRatio - 0.30) / 0.65));
      }

      const composite = 0.40 * sLoss + 0.25 * sTail + 0.20 * sJitter + 0.15 * sRate;
      quality = Math.max(0, Math.min(100, Math.round(100 * composite)));

      if (quality >= 80) {
        qualityStatus = 'ok';
        qualityVerdict = 'Отличное качество связи';
      } else if (quality >= 50) {
        qualityStatus = 'warn';
        qualityVerdict = 'Среднее качество связи';
      } else {
        qualityStatus = 'danger';
        qualityVerdict = 'Нестабильный канал';
      }
    }

    // Update quality sparkline history
    if (hasLiveStream) {
      this.qualityHistory.push(quality);
    } else if (isConnected) {
      this.qualityHistory.push(0);
    }
    if (this.qualityHistory.length > 25) this.qualityHistory.shift();

    // ── 3. GROUP B: Signal State ──
    const gx = frame.raw_gx ?? state.rawRotX ?? 0;
    const gy = frame.raw_gy ?? state.rawRotY ?? 0;
    const gz = frame.raw_gz ?? state.rawRotZ ?? 0;
    const ax = frame.raw_ax ?? state.rawAccX ?? 0;
    const ay = frame.raw_ay ?? state.rawAccY ?? 0;
    const az = frame.raw_az ?? state.rawAccZ ?? (hasLiveStream ? 0 : -1);

    const omegaMag = Math.sqrt(gx * gx + gy * gy + gz * gz);
    const gravityMag = Math.sqrt(ax * ax + ay * ay + az * az);
    const gravityDelta = Math.abs(gravityMag - 1.0);

    // Compute Drift & Noise during rest
    let driftDps = this.lastComputedDrift ?? 0;
    let noiseDps = this.lastComputedNoise ?? 0;
    let noiseTag = 'Движение';

    if (!isConnected) {
      noiseTag = 'Офлайн';
    } else if (!hasLiveStream) {
      noiseTag = 'Нет данных';
    } else if (this.isResting && this.sampleCount >= 20) {
      let sumGx = 0, sumGy = 0, sumGz = 0;
      const n = this.sampleCount;
      for (let i = 0; i < n; i++) {
        sumGx += this.gyroX[i];
        sumGy += this.gyroY[i];
        sumGz += this.gyroZ[i];
      }
      const meanX = sumGx / n;
      const meanY = sumGy / n;
      const meanZ = sumGz / n;

      driftDps = Math.sqrt(meanX * meanX + meanY * meanY + meanZ * meanZ);
      this.lastComputedDrift = driftDps;
      this.lastComputedDriftX = meanX;
      this.lastComputedDriftY = meanY;
      this.lastComputedDriftZ = meanZ;

      // Variance across 3 axes
      let varSum = 0;
      for (let i = 0; i < n; i++) {
        const dx = this.gyroX[i] - meanX;
        const dy = this.gyroY[i] - meanY;
        const dz = this.gyroZ[i] - meanZ;
        varSum += (dx * dx + dy * dy + dz * dz) / 3.0;
      }
      noiseDps = Math.sqrt(varSum / n);
      this.lastComputedNoise = noiseDps;

      noiseTag = noiseDps < 0.15 ? 'Стабильно' : 'Дрожание';
    } else if (!this.isResting) {
      noiseTag = 'Движение';
    }

    // Status badges according to task6.9 thresholds
    const hzStatus = !hasLiveStream ? 'none' : (inHz >= 55 ? 'ok' : (inHz >= 30 ? 'warn' : 'danger'));
    const rttStatus = !hasLiveStream ? 'none' : (rttMs < 0 ? 'ok' : (rttMs < 15 ? 'ok' : (rttMs < 35 ? 'warn' : 'danger')));
    const jitterStatus = !hasLiveStream ? 'none' : (jitterMs < 5.0 ? 'ok' : (jitterMs < 15.0 ? 'warn' : 'danger'));
    const tailStatus = !hasLiveStream ? 'none' : (p95Interval < 20.0 ? 'ok' : (p95Interval < 40.0 ? 'warn' : 'danger'));
    const lossStatus = !hasLiveStream ? 'none' : (lossLost === 0 ? 'ok' : (lossPct < 2.0 ? 'warn' : 'danger'));
    const mergedStatus = !hasLiveStream ? 'none' : (lossMerged === 0 ? 'ok' : 'warn');

    const driftStatus = !hasLiveStream ? 'none' : (driftDps < 0.3 ? 'ok' : (driftDps < 1.0 ? 'warn' : 'danger'));
    const noiseStatus = !hasLiveStream ? 'none' : (noiseDps < 0.15 ? 'ok' : (noiseDps < 0.5 ? 'warn' : 'danger'));
    const gravityStatus = !hasLiveStream ? 'none' : (gravityDelta < 0.03 ? 'ok' : (gravityDelta <= 0.08 ? 'warn' : 'danger'));

    // ── 4. GROUP C: Pipeline & Active Corrections ──
    const settings = this.latestSettings || {};
    let activeProfileName = 'По умолчанию';
    let mountActive = false;
    let mountAngle = null;

    if (state.profiles && typeof state.activeSlot === 'number' && state.activeSlot >= 0) {
      const p = state.profiles[state.activeSlot];
      if (p) {
        activeProfileName = p.name || `Профиль #${state.activeSlot + 1}`;
        if (p.mount && p.mount.enabled) {
          mountActive = true;
          mountAngle = typeof p.mount.tiltDeg === 'number' ? p.mount.tiltDeg : null;
        }
      }
    }

    const cemuGuardActive = !!(settings.cemuDriftGuard ?? state.cemuDriftGuard ?? true);
    const deadbandVal = isUsb
      ? Number(settings.gyroDeadbandUsb ?? 0.50)
      : Number(settings.gyroDeadband ?? 0.10);
    const sensVal = Number(settings.gyroSensitivity ?? 1.00);

    const outHz = Number(frame.out_hz ?? state.hz ?? (hasLiveStream ? inHz : 0));
    const pipeMs = Number(frame.pipe_ms ?? 0.4);
    const pipeStatus = !hasLiveStream ? 'none' : (pipeMs < 2.0 ? 'ok' : (pipeMs < 5.0 ? 'warn' : 'danger'));

    // ── 5. GROUP D: Raw & Output Numbers ──
    const formatAxis = (v, dec = 2) => {
      if (!hasLiveStream && !isConnected) return '—';
      const num = Number(v || 0);
      const sign = num >= 0 ? '+' : '';
      return sign + num.toFixed(dec);
    };

    const rawGx = formatAxis(gx);
    const rawGy = formatAxis(gy);
    const rawGz = formatAxis(gz);
    const rawAx = formatAxis(ax);
    const rawAy = formatAxis(ay);
    const rawAz = formatAxis(az);

    const outGxVal = frame.outGx ?? frame.out_gx ?? (this.latestTuning ? this.latestTuning.OutX : gx);
    const outGyVal = frame.outGy ?? frame.out_gy ?? (this.latestTuning ? this.latestTuning.OutY : gy);
    const outGzVal = frame.outGz ?? frame.out_gz ?? (this.latestTuning ? this.latestTuning.OutZ : gz);

    const outGx = formatAxis(outGxVal);
    const outGy = formatAxis(outGyVal);
    const outGz = formatAxis(outGzVal);

    // ── 6. GROUP E: Clients & Session ──
    const dsuCount = Number(frame.dsu_clients ?? state.dsuClients ?? (state.dsuClientList?.length ?? state.dsuClientsList?.length ?? 0));
    const dsuList = (frame.dsu_client_list ?? state.dsuClientList ?? state.dsuClientsList ?? []).map((c) => ({
      process: c.process || c.Process || c.name || 'Client',
      address: c.address || c.Address || `${c.ip || c.IP || '127.0.0.1'}:${c.port || c.Port || ''}`,
      active: c.active ?? true,
      lastSeenMs: c.lastSeenMs || c.LastSeenMs || 0,
    }));

    const connectedTime = state.connectedTime || (isConnected ? '00:00:00' : '—');
    const sessionPackets = Number(frame.loss_total ?? state.sessionPackets ?? 0);
    const sessionLost = Number(frame.loss_lost ?? state.sessionLoss ?? 0);
    const sessionMerged = Number(frame.loss_merged ?? 0);
    const sessionBytes = state.sessionBytes != null
      ? state.sessionBytes
      : (sessionPackets * 64);
    const sessionKb = (sessionBytes / 1024).toFixed(0);

    const res = this.latestResources || {};
    const cpuPercent = Number(res.cpuPercent ?? state.cpuPercent ?? 0);
    const ramMb = Number(res.ramMb ?? state.ramMb ?? 0);
    const resStatus = cpuPercent > 15 || ramMb > 200 ? 'warn' : 'ok';

    this.cachedResult = {
      isConnected,
      hasLiveStream,
      isUsb,
      // Group A
      quality,
      qualityStatus,
      qualityVerdict,
      qualityHistory: this.qualityHistory.slice(),
      inHz: hasLiveStream ? inHz.toFixed(1) : '—',
      hzStatus,
      rttMs: !hasLiveStream ? '—' : (rttMs < 0 ? '—' : rttMs.toFixed(1)),
      rttStatus,
      jitterMs: hasLiveStream ? jitterMs.toFixed(1) : '—',
      jitterStatus,
      tailP95: hasLiveStream && p95Interval > 0 ? p95Interval.toFixed(1) : '—',
      tailMax: hasLiveStream && maxInterval > 0 ? maxInterval.toFixed(1) : '—',
      tailAvg: hasLiveStream && avgInterval > 0 ? avgInterval.toFixed(1) : '—',
      tailStatus,
      lossCount: hasLiveStream ? lossLost : '—',
      lossPct: hasLiveStream ? lossPct.toFixed(1) : '—',
      lossStatus,
      mergedCount: hasLiveStream ? lossMerged : '—',
      mergedStatus,
      // Group B
      isResting: this.isResting,
      driftDps: hasLiveStream ? driftDps.toFixed(2) : '—',
      driftX: hasLiveStream ? ((this.lastComputedDriftX != null && this.lastComputedDriftX >= 0 ? '+' : '') + (this.lastComputedDriftX ?? 0).toFixed(2)) : '—',
      driftY: hasLiveStream ? ((this.lastComputedDriftY != null && this.lastComputedDriftY >= 0 ? '+' : '') + (this.lastComputedDriftY ?? 0).toFixed(2)) : '—',
      driftZ: hasLiveStream ? ((this.lastComputedDriftZ != null && this.lastComputedDriftZ >= 0 ? '+' : '') + (this.lastComputedDriftZ ?? 0).toFixed(2)) : '—',
      driftStatus,
      noiseDps: hasLiveStream ? noiseDps.toFixed(2) : '—',
      noiseStatus,
      noiseTag,
      gravityMag: hasLiveStream ? gravityMag.toFixed(2) : '—',
      gravityDelta: hasLiveStream ? gravityDelta.toFixed(2) : '—',
      gravityStatus,
      omegaMag: hasLiveStream ? omegaMag.toFixed(1) : '—',
      omegaPeak: hasLiveStream ? this.peakOmega.toFixed(1) : '—',
      omegaStatus: hasLiveStream ? 'ok' : 'none',
      // Group C
      activeProfileName,
      mountActive,
      mountText: mountActive ? (mountAngle != null ? `Вкл (+${mountAngle.toFixed(1)}°)` : 'Вкл') : 'Выкл',
      cemuGuardActive,
      cemuGuardText: cemuGuardActive ? 'Вкл' : 'Выкл',
      deadbandText: `${deadbandVal.toFixed(2)}°/s`,
      sensText: `${sensVal.toFixed(2)}x`,
      outHz: hasLiveStream ? outHz.toFixed(1) : '—',
      pipeMs: hasLiveStream ? pipeMs.toFixed(1) : '—',
      pipeStatus,
      // Group D
      rawGx,
      rawGy,
      rawGz,
      rawAx,
      rawAy,
      rawAz,
      outGx,
      outGy,
      outGz,
      // Group E
      dsuCount,
      dsuList,
      connectedTime,
      sessionPackets,
      sessionLost,
      sessionMerged,
      sessionKb,
      cpuPercent: cpuPercent > 0 ? cpuPercent.toFixed(1) : '—',
      ramMb: ramMb > 0 ? ramMb.toFixed(0) : '—',
      resStatus,
    };

    return this.cachedResult;
  }
}
