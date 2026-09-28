'use strict';

  // ── Profile Icons Helper ───────────────────────────────────────────────────
  function getProfileIconSVG(iconType, size = 20) {
    if (iconType === 'vertical') {
      return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8">
        <rect x="6" y="2" width="12" height="20" rx="2.5"></rect>
        <line x1="12" y1="18" x2="12.01" y2="18" stroke-width="2.5"></line>
        <line x1="10" y1="5" x2="14" y2="5"></line>
      </svg>`;
    }
    if (iconType === 'horizontal') {
      return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8">
        <rect x="2" y="6" width="20" height="12" rx="2.5"></rect>
        <line x1="18" y1="12" x2="18.01" y2="12" stroke-width="2.5"></line>
        <line x1="5" y1="10" x2="5" y2="14"></line>
      </svg>`;
    }
    // Default gamepad
    return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8">
      <rect x="2" y="6" width="20" height="12" rx="4"></rect>
      <path d="M6 12h4m-2-2v4"></path>
      <circle cx="15" cy="10" r="1" fill="currentColor"></circle>
      <circle cx="18" cy="13" r="1" fill="currentColor"></circle>
    </svg>`;
  }
