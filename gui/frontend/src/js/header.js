'use strict';

  // ── Responsive Header Collapse Manager ─────────────────────────────────────
  const HeaderManager = {
    init() {
      this.update();
      window.addEventListener('resize', () => this.update());
      const header = document.querySelector('.app-header');
      if (header && typeof ResizeObserver !== 'undefined') {
        new ResizeObserver(() => this.update()).observe(header);
      }
    },

    update() {
      const header = document.querySelector('.app-header');
      if (!header) return;

      // Stable width-based collapse check - independent of dynamic badge text length
      if (window.innerWidth <= 1020) {
        header.classList.add('header-collapsed');
      } else {
        header.classList.remove('header-collapsed');
      }
    }
  };
