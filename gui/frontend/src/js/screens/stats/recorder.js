import { openModal } from '../../ui/modal.js';
import { toast } from '../../ui/toast.js';
import { t } from '../../core/i18n.js';

const CSV_HEADER = 'timestamp_ms,elapsed_ms,q0,q1,q2,q3,raw_gx,raw_gy,raw_gz,raw_ax,raw_ay,raw_az,out_gx,out_gy,out_gz,stick_lx,stick_ly,in_hz,out_hz,pipe_ms,dsu_clients,link_rtt_ms';
const MAX_RECORD_MS = 60000; // 1-minute hard limit

export class TelemetryRecorder {
  constructor(options = {}) {
    this.onUpdate = options.onUpdate || (() => {});
    this.onStop = options.onStop || (() => {});
    this.isRecording = false;
    this.startTime = 0;
    this.rows = [];
    this.timerId = null;
    this.lastElapsedMs = 0;
  }

  start() {
    if (this.isRecording) return;
    this.isRecording = true;
    this.startTime = performance.now();
    this.rows = [CSV_HEADER];
    this.lastElapsedMs = 0;

    this.timerId = setInterval(() => {
      if (!this.isRecording) return;
      const elapsed = performance.now() - this.startTime;
      this.lastElapsedMs = elapsed;
      if (elapsed >= MAX_RECORD_MS) {
        this.stop(true);
        return;
      }
      this.notifyUpdate(elapsed);
    }, 100);

    this.notifyUpdate(0);
  }

  stop(byLimit = false) {
    if (!this.isRecording) return;
    this.isRecording = false;
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }

    const elapsed = performance.now() - this.startTime;
    this.lastElapsedMs = elapsed;
    this.notifyUpdate(elapsed);
    this.onStop(byLimit);

    // Open export modal if we captured data
    if (this.rows.length > 1) {
      this.showExportModal(elapsed);
    }
  }

  recordFrame(data = {}) {
    if (!this.isRecording) return;
    const now = performance.now();
    const elapsed = Math.round(now - this.startTime);
    const ts = Date.now();

    const row = [
      ts,
      elapsed,
      (data.q0 ?? 1).toFixed(4),
      (data.q1 ?? 0).toFixed(4),
      (data.q2 ?? 0).toFixed(4),
      (data.q3 ?? 0).toFixed(4),
      (data.rawGx ?? 0).toFixed(4),
      (data.rawGy ?? 0).toFixed(4),
      (data.rawGz ?? 0).toFixed(4),
      (data.rawAx ?? 0).toFixed(4),
      (data.rawAy ?? 0).toFixed(4),
      (data.rawAz ?? 0).toFixed(4),
      (data.outGx ?? 0).toFixed(4),
      (data.outGy ?? 0).toFixed(4),
      (data.outGz ?? 0).toFixed(4),
      (data.stickLx ?? 0).toFixed(2),
      (data.stickLy ?? 0).toFixed(2),
      (data.inHz ?? 0).toFixed(1),
      (data.outHz ?? 0).toFixed(1),
      (data.pipeMs ?? 0).toFixed(2),
      data.dsuClients ?? 0,
      data.linkRttMs ?? -1,
    ].join(',');

    this.rows.push(row);
  }

  notifyUpdate(elapsed) {
    const totalSec = Math.min(60, Math.floor(elapsed / 1000));
    const mm = String(Math.floor(totalSec / 60)).padStart(2, '0');
    const ss = String(totalSec % 60).padStart(2, '0');
    const timeStr = `${mm}:${ss}`;
    const percent = Math.min(100, (elapsed / MAX_RECORD_MS) * 100);
    const lineCount = Math.max(0, this.rows.length - 1);
    const sizeKb = (new Blob([this.rows.join('\n')]).size / 1024).toFixed(1);

    this.onUpdate({
      isRecording: this.isRecording,
      timeStr,
      percent,
      lineCount,
      sizeKb,
    });
  }

  showExportModal(elapsed) {
    const csvContent = this.rows.join('\n');
    const durationSec = (elapsed / 1000).toFixed(1);
    const lineCount = this.rows.length - 1;
    const sizeKb = (new Blob([csvContent]).size / 1024).toFixed(1);
    const previewLines = this.rows.slice(0, 15).join('\n');

    const bodyHtml = `
      <div style="display:flex; flex-direction:column; gap:0.75rem">
        <div style="display:flex; gap:1.25rem; font-size:0.8125rem; color:var(--ink-2); font-family:var(--font-mono)">
          <span>${t('live_debug.stats_modal_duration') || 'Длительность:'} <b style="color:var(--ink)">${durationSec} с</b></span>
          <span>${t('live_debug.stats_modal_samples') || 'Строк:'} <b style="color:var(--accent)">${lineCount}</b></span>
          <span>${t('live_debug.stats_modal_size') || 'Размер:'} <b style="color:var(--ink)">${sizeKb} KB</b></span>
        </div>
        <pre style="max-height:160px; overflow:auto; background:var(--surface-inset); border:1px solid var(--line-subtle); border-radius:var(--radius-md); padding:0.5rem 0.75rem; font:0.6875rem/1.35 var(--font-mono); color:var(--ink-2); white-space:pre; user-select:text;-webkit-user-select:text;">${previewLines}${lineCount > 15 ? '\n...' : ''}</pre>
      </div>
    `;

    openModal({
      title: t('live_debug.stats_modal_title') || 'Запись телеметрии',
      text: t('live_debug.stats_modal_desc') || 'Запись завершена. Вы можете скопировать данные или сохранить файл .csv.',
      body: bodyHtml,
      actions: [
        {
          label: t('live_debug.stats_modal_btn_copy') || 'Копировать в буфер',
          kind: '',
          onClick: () => {
            navigator.clipboard.writeText(csvContent)
              .then(() => toast(t('live_debug.stats_modal_copied') || 'Скопировано в буфер обмена'))
              .catch((err) => console.error('Failed to copy CSV:', err));
          },
        },
        {
          label: t('live_debug.stats_modal_btn_save') || 'Сохранить .csv',
          kind: 'primary',
          onClick: () => {
            const defaultName = `phonegyro_telemetry_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.csv`;
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = defaultName;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            toast(t('live_debug.stats_modal_saved') || 'Файл сохранён');
          },
        },
        {
          label: t('live_debug.stats_modal_btn_cancel') || 'Закрыть',
          kind: '',
        },
      ],
    });
  }
}
