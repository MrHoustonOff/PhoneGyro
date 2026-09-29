'use strict';

// DSU clients on the main screen: the program behind a local client ("Cemu",
// "PadTest") instead of its address (gui/internal/app/dsu_clients.go). Hover shows the full
// address, a click switches to that program, the cross disconnects the client.
// A disconnected client stays in the list greyed out, with a button that brings
// it back (App.ReconnectDSUClient).
const DsuClientList = {
  tooltip: null,
  info: {},     // address -> latest client data (Cemu bias for the tooltip)
  tipRow: null, // row the tooltip is showing for, to refresh it live

  esc(s) {
    return String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  },

  // render rebuilds the list only when what it shows changes: the state arrives
  // 15 times a second, and a rebuilt row loses its hover and its click.
  render(listEl, clients, kicked = []) {
    this.info = {};
    clients.forEach(c => { this.info[c.address || (c.ip + ':' + c.port)] = c; });
    const row = (c, isKicked) => {
      const addr = c.address || (c.ip + ':' + c.port);
      const isAct = c.active !== false;
      const name = c.process || addr;
      const dot = isKicked ? 'off' : (isAct ? 'green' : 'amber');
      const badge = isKicked ? 'OFF' : (isAct ? 'ACTIVE' : 'IDLE');
      const button = isKicked
        ? `<span class="dsu-client-readmit" role="button" aria-label="reconnect">
            <svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9.8 5.2A4 4 0 1 0 10 7"></path><path d="M10 2.4v2.9H7.1"></path></svg>
          </span>`
        : `<span class="dsu-client-remove" role="button" aria-label="disconnect">
            <svg viewBox="0 0 12 12" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7"></path></svg>
          </span>`;
      return `<div class="dsu-home-client-tag${c.process ? ' has-process' : ''}${isKicked ? ' is-kicked' : ''}" data-addr="${this.esc(addr)}" data-name="${this.esc(name)}" data-process="${this.esc(c.process || '')}">
        <div class="dsu-home-client-left">
          <span class="dsu-client-pulse ${dot}"></span>
          <span class="dsu-client-addr${c.process ? ' is-name' : ''}">${this.esc(name)}</span>
        </div>
        <div class="dsu-home-client-right">
          <span class="dsu-client-status-badge ${dot}">${badge}</span>
          ${button}
        </div>
      </div>`;
    };
    const html = clients.map(c => row(c, false)).join('') + kicked.map(c => row(c, true)).join('');
    if (listEl._dsuHtml !== html) {
      listEl._dsuHtml = html;
      listEl.innerHTML = html;
      this.hideTip();
    } else if (this.tipRow && this.tipRow.isConnected && listEl.contains(this.tipRow)) {
      this.tooltip.textContent = this.rowTip(this.tipRow); // live Cemu bias
    }
    this.bind(listEl);
  },

  // rowTip: full address, what a click does, and for Cemu the gyro bias its
  // filter holds (pkg/dsu/cemubias.go) -- what the game turns by at rest.
  rowTip(row) {
    const lines = [row.dataset.addr];
    if (row.classList.contains('is-kicked')) {
      lines.push(I18n.t('status.dsu_client_kicked') || 'Отключён от DSU');
    }
    if (row.dataset.process) {
      lines.push((I18n.t('status.dsu_client_tip_switch') || 'Нажмите, чтобы переключиться на {name}').replace('{name}', row.dataset.process));
    }
    const c = this.info[row.dataset.addr];
    if (c && /^cemu$/i.test(c.process || '') && Array.isArray(c.cemuBias)) {
      const b = c.cemuBias.map(v => (v >= 0 ? '+' : '') + v.toFixed(3)).join(' / ');
      lines.push((I18n.t('status.dsu_client_cemu_bias') || 'Смещение гироскопа по версии Cemu: {bias} °/с').replace('{bias}', b));
      if (c.cemuGuard) lines.push(I18n.t('status.dsu_client_cemu_guard') || 'Защита от дрейфа включена');
    }
    return lines.join('\n');
  },

  bind(listEl) {
    if (listEl._dsuBound) return;
    listEl._dsuBound = true;

    listEl.addEventListener('mouseover', (e) => {
      const row = e.target.closest('.dsu-home-client-tag');
      if (!row) return;
      if (e.target.closest('.dsu-client-remove')) {
        this.showTip(row, I18n.t('status.dsu_client_remove') || 'Отключить клиента');
        return;
      }
      if (e.target.closest('.dsu-client-readmit')) {
        this.showTip(row, I18n.t('status.dsu_client_readmit') || 'Подключить снова');
        return;
      }
      this.tipRow = row;
      this.showTip(row, this.rowTip(row));
    });
    listEl.addEventListener('mouseout', (e) => {
      const row = e.target.closest('.dsu-home-client-tag');
      if (row && !row.contains(e.relatedTarget)) this.hideTip();
    });

    listEl.addEventListener('click', async (e) => {
      const row = e.target.closest('.dsu-home-client-tag');
      if (!row) return;
      e.stopPropagation();
      const addr = row.dataset.addr;
      if (e.target.closest('.dsu-client-remove')) {
        this.hideTip();
        const res = await window.go?.app?.App?.DisconnectDSUClient(addr);
        if (res === 'ok' && typeof showToast === 'function') {
          showToast((I18n.t('status.dsu_client_removed') || '{name} отключён от DSU').replace('{name}', row.dataset.name));
        }
        return;
      }
      if (e.target.closest('.dsu-client-readmit')) {
        this.hideTip();
        const res = await window.go?.app?.App?.ReconnectDSUClient(addr);
        if (res === 'ok' && typeof showToast === 'function') {
          showToast((I18n.t('status.dsu_client_readmitted') || '{name} снова подключён к DSU').replace('{name}', row.dataset.name));
        }
        return;
      }
      if (row.dataset.process) {
        this.hideTip();
        await window.go?.app?.App?.FocusDSUClient(addr);
      }
    });
  },

  showTip(target, text) {
    if (!this.tooltip) {
      this.tooltip = document.createElement('div');
      this.tooltip.className = 'apple-floating-tooltip dsu-client-tooltip';
      document.body.appendChild(this.tooltip);
    }
    const tip = this.tooltip;
    tip.textContent = text;
    tip.style.display = 'block';
    tip.style.visibility = 'hidden';
    const zoom = parseFloat(document.documentElement.style.zoom) || 1;
    const r = target.getBoundingClientRect();
    const tr = tip.getBoundingClientRect();
    let left = r.left + r.width / 2 - tr.width / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - tr.width - 8));
    let top = r.top - tr.height - 8;
    if (top < 8) top = r.bottom + 8;
    tip.style.left = Math.round(left / zoom) + 'px';
    tip.style.top = Math.round(top / zoom) + 'px';
    tip.style.visibility = 'visible';
    void tip.offsetWidth;
    tip.classList.add('show');
  },

  hideTip() {
    this.tipRow = null;
    if (!this.tooltip) return;
    this.tooltip.classList.remove('show');
    this.tooltip.style.display = 'none';
  },
};
