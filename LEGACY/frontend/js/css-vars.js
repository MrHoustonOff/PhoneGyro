'use strict';

  // ── Design tokens for canvas and WebGL drawing ────────────────────────────
  // CSS uses var(--…) directly; canvas and three.js need the values, so they
  // read them here from tokens.css. Cached per theme: a semantic token can
  // differ between themes, palette tokens never do.
  const CssVars = {
    _cache: new Map(),
    _theme: null,

    get(name) {
      const theme = document.documentElement.getAttribute('data-theme');
      if (theme !== this._theme) {
        this._cache.clear();
        this._theme = theme;
      }
      let v = this._cache.get(name);
      if (v === undefined) {
        v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
        this._cache.set(name, v);
      }
      return v;
    },

    // rgba() of a palette colour with alpha (uses its *-rgb token).
    rgba(name, alpha) {
      return `rgba(${this.get(name + '-rgb')}, ${alpha})`;
    },

    // 0xRRGGBB for three.js colours.
    hex(name) {
      return parseInt(this.get(name).replace('#', ''), 16);
    },
  };
