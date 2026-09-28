'use strict';

  // ── Network Telemetry Mini-Sparkline (Ping & Jitter) ──────────────────────
  const NetSparkline = {
    history: [], // only real RTT samples (state.pingMs), never seeded
    maxLen: 32,
    lastRenderTs: 0,

    push(pingMs) {
      if (typeof pingMs !== 'number' || pingMs < 0) return; // not measured: draw nothing
      this.history.push(pingMs);
      if (this.history.length > this.maxLen) {
        this.history.shift();
      }
      const now = performance.now();
      if (now - this.lastRenderTs >= 250) {
        this.lastRenderTs = now;
        this.render();
      }
    },

    render() {
      this.drawToCanvas('main-net-spark-canvas', 48, 14);
      if (typeof SettingsManager !== 'undefined' && SettingsManager.isOpen) {
        this.drawToCanvas('bench-net-spark-canvas', 60, 15);
      }
    },

    drawToCanvas(canvasId, w, h) {
      const canvas = document.getElementById(canvasId);
      if (!canvas || canvas.offsetParent === null) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
        canvas.width = Math.floor(w * dpr);
        canvas.height = Math.floor(h * dpr);
      }
      const ctx = canvas.getContext('2d');
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const n = this.history.length;
      if (n < 2) {
        ctx.restore();
        return;
      }

      let minVal = 0;
      let maxVal = 16;
      for (let i = 0; i < n; i++) {
        if (this.history[i] > maxVal) maxVal = this.history[i];
      }
      const range = maxVal - minVal || 1;
      const pad = 1.5;
      const availH = h - pad * 2;
      const dx = (w - pad * 2) / (this.maxLen - 1);
      const startX = w - pad - (n - 1) * dx;

      const lastPing = this.history[n - 1];
      let strokeColor = '#30D158'; // Apple Green
      let fillColor = 'rgba(48, 209, 88, 0.22)';
      if (lastPing > 35) {
        strokeColor = '#FF9F0A'; // Apple Orange
        fillColor = 'rgba(255, 159, 10, 0.22)';
      }
      if (lastPing > 75) {
        strokeColor = '#FF453A'; // Apple Red
        fillColor = 'rgba(255, 69, 58, 0.22)';
      }

      ctx.beginPath();
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 1.2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      for (let i = 0; i < n; i++) {
        const x = startX + i * dx;
        const norm = (this.history[i] - minVal) / range;
        const y = h - pad - norm * availH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Translucent gradient fill under curve
      ctx.lineTo(startX + (n - 1) * dx, h);
      ctx.lineTo(startX, h);
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, fillColor);
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = grad;
      ctx.fill();

      ctx.restore();
    }
  };
