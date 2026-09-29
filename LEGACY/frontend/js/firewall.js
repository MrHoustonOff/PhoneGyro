'use strict';

  // ── Windows Firewall ─────────────────────────────────────────────────────────
  // The Settings row (status + "Allow") and the startup alert shown in phone mode
  // while the firewall would block the phone (gui/internal/app/firewall.go).
  const FirewallUI = {
    status: null,
    busy: false,
    alertOpen: false,

    blocked(st) {
      return !!st && (st.state === 'blocked' || st.state === 'pending');
    },

    // Why the permission is needed, plus a note when the network is public.
    whyText(st) {
      let text = I18n.t('firewall.why');
      if (st && st.network === 'public') text += ' ' + I18n.t('firewall.why_public');
      return text;
    },

    render(st) {
      this.status = st;
      const chip = document.getElementById('firewall-status');
      const text = document.getElementById('firewall-status-text');
      const btn = document.getElementById('btn-firewall-allow');
      const why = document.getElementById('firewall-why');
      const state = this.busy ? 'checking' : (st ? st.state : 'checking');
      if (chip) {
        chip.dataset.state = state;
        const net = st && st.network ? I18n.t('firewall.network_' + st.network) : '';
        chip.title = [net, st && st.detail].filter(Boolean).join(' · ');
      }
      if (text) text.textContent = this.busy ? I18n.t('firewall.waiting') : I18n.t('firewall.state_' + state);
      if (btn) {
        setShown(btn, this.blocked(st) || (st && st.state === 'unknown'));
        btn.disabled = this.busy;
      }
      if (why) {
        const show = this.blocked(st);
        setShown(why, show);
        if (show) why.textContent = this.whyText(st);
      }
      const modalWhy = document.getElementById('firewall-modal-why');
      if (modalWhy) modalWhy.textContent = this.whyText(st);
    },

    async refresh() {
      try {
        const st = await window.go?.app?.App?.GetFirewallStatus?.();
        if (st) this.render(st);
      } catch (e) { /* the row keeps its last state */ }
    },

    // Asks for admin rights (UAC) and allows PhoneGyro; true when it worked.
    async allow() {
      if (this.busy) return false;
      this.busy = true;
      this.render(this.status);
      let res = null;
      try {
        res = await window.go?.app?.App?.AllowFirewall?.();
      } catch (e) { /* reported below as not allowed */ }
      this.busy = false;
      if (res && res.status) this.render(res.status); else this.render(this.status);
      const ok = !!res && res.status && (res.status.state === 'allowed' || res.status.state === 'off');
      if (ok) showToast(I18n.t('firewall.toast_ok'));
      else if (res && res.result === 'cancelled') showToast(I18n.t('firewall.toast_cancelled'));
      else showToast(I18n.t('firewall.toast_failed'));
      return ok;
    },

    openAlert(st) {
      const overlay = document.getElementById('firewall-modal');
      if (!overlay || this.alertOpen || !this.blocked(st)) return;
      this.alertOpen = true;
      this.render(st);
      const later = document.getElementById('firewall-later');
      const allowBtn = document.getElementById('firewall-allow');

      setShown(overlay, true);
      overlay.offsetHeight; // reflow for the scale transition
      overlay.classList.add('visible');

      const close = () => {
        this.alertOpen = false;
        overlay.classList.remove('visible');
        setTimeout(() => { setShown(overlay, false); }, 180);
        window.removeEventListener('keydown', onKey);
        later?.removeEventListener('click', close);
        allowBtn?.removeEventListener('click', onAllow);
        window.go?.app?.App?.CloseFirewallAlert?.();
      };
      const onAllow = async () => {
        if (allowBtn) allowBtn.disabled = true;
        const ok = await this.allow();
        if (allowBtn) allowBtn.disabled = false;
        if (ok) close();
      };
      const onKey = (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          close();
        }
      };
      later?.addEventListener('click', close);
      allowBtn?.addEventListener('click', onAllow);
      window.addEventListener('keydown', onKey);
      allowBtn?.focus();
    },

    init() {
      if (this.initialized) return;
      this.initialized = true;
      document.getElementById('btn-firewall-allow')?.addEventListener('click', () => this.allow());
      const register = () => {
        if (!(window.runtime && typeof window.runtime.EventsOn === 'function')) return false;
        window.runtime.EventsOn('firewall:status', (st) => FirewallUI.render(st));
        window.runtime.EventsOn('firewall:alert', (st) => CemuNotice.whenI18nReady(() => FirewallUI.openAlert(st)));
        window.go?.app?.App?.PendingFirewallAlert?.().then(st => {
          if (st) CemuNotice.whenI18nReady(() => FirewallUI.openAlert(st));
        });
        return true;
      };
      if (!register()) {
        const interval = setInterval(() => { if (register()) clearInterval(interval); }, 40);
        setTimeout(() => clearInterval(interval), 10000);
      }
    },
  };

  FirewallUI.init();
