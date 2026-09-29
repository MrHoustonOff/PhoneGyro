'use strict';

  // ── Responsive Header Collapse Manager ─────────────────────────────────────
  // The header is a three-column grid (navigation.css), so its parts never
  // overlap; when they no longer fit side by side they would overflow instead.
  // Measure that and step down: first the nav buttons lose their labels
  // (header-collapsed), then the status capsule its text (header-tight).
  // Measuring beats a width breakpoint: the status text ("ожидание usb"), the
  // language and the font scale all change how much room the header needs.
  const HeaderManager = {
    init() {
      const header = document.querySelector('.app-header');
      if (!header) return;
      this.update();
      window.addEventListener('resize', () => this.update());
      if (typeof ResizeObserver !== 'undefined') {
        // The header's own box only changes with the window; its parts change
        // with the status text and the language.
        const ro = new ResizeObserver(() => this.update());
        ro.observe(header);
        header.querySelectorAll('.header-left, .header-nav-bubbles, .header-controls').forEach(el => ro.observe(el));
      }
    },

    overflows(header) {
      return header.scrollWidth > header.clientWidth + 1;
    },

    update() {
      const header = document.querySelector('.app-header');
      if (!header) return;
      // Measured synchronously within one task, so the full layout never paints:
      // the header only ever shows the final classes.
      header.classList.remove('header-collapsed', 'header-tight');
      if (this.overflows(header)) {
        header.classList.add('header-collapsed');
        if (this.overflows(header)) header.classList.add('header-tight');
      }
    }
  };
