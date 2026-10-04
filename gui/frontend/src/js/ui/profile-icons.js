// Profile icon SVG helpers. The icon key is stored in Profile.icon:
//   'default'    → gamepad (generic use, when orientation is unknown)
//   'vertical'   → phone portrait (phone held vertically)
//   'horizontal' → phone landscape (phone held sideways)

const ICONS = {
  vertical: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <rect x="6" y="2" width="12" height="20" rx="2.5"/><line x1="12" y1="18" x2="12.01" y2="18" stroke-width="2.5"/><line x1="10" y1="5" x2="14" y2="5"/>
  </svg>`,
  horizontal: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <rect x="2" y="6" width="20" height="12" rx="2.5"/><line x1="18" y1="12" x2="18.01" y2="12" stroke-width="2.5"/><line x1="5" y1="10" x2="5" y2="14"/>
  </svg>`,
  default: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <rect x="2" y="6" width="20" height="12" rx="4"/>
    <path d="M6 12h4m-2-2v4"/><circle cx="15" cy="10" r="1" fill="currentColor"/><circle cx="18" cy="13" r="1" fill="currentColor"/>
  </svg>`,
};

/** Returns the SVG string for a profile icon key. Falls back to 'default'. */
export function profileIconSvg(key) {
  return ICONS[key] || ICONS.default;
}

/** The three selectable icon variants in order for the picker. */
export const ICON_KEYS = ['default', 'vertical', 'horizontal'];
