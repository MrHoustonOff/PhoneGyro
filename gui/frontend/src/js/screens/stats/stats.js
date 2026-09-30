// Stats & 3D Screen Shell
// Coordinates sub-tabs (3D & Telemetry, Mini-Games, Response Bench),
// lazy loading of components, and lifecycle (pause/resume on screen switch).

import { $, show, toggleClass } from '../../core/dom.js';
import { onScreen } from '../../shell/router.js';

let activeSubtab = 'telemetry';
let isStatsActive = false;
let subtabsLoaded = false;
let subtabControllers = null;

const SUBTAB_NAMES = ['telemetry', 'games', 'bench'];

/**
 * Switches the active subtab inside the Stats screen.
 * @param {string} tabName - 'telemetry' | 'games' | 'bench'
 */
export async function switchSubtab(tabName) {
  if (!SUBTAB_NAMES.includes(tabName)) tabName = 'telemetry';
  const prevSubtab = activeSubtab;
  activeSubtab = tabName;
  try {
    localStorage.setItem('pg-stats-subtab', tabName);
  } catch (_) {}

  // Update subnav buttons
  document.querySelectorAll('#stats-subnav .pg-seg__btn').forEach((btn) => {
    toggleClass(btn, 'is-active', btn.dataset.subtab === tabName);
  });

  // Toggle panes
  SUBTAB_NAMES.forEach((name) => {
    const pane = $(`pane-${name}`);
    if (pane) {
      const active = name === tabName;
      show(pane, active);
      toggleClass(pane, 'is-active', active);
    }
  });

  // If subtabs are loaded and the screen is visible, inform controllers
  if (subtabControllers && isStatsActive) {
    if (prevSubtab !== tabName && subtabControllers[prevSubtab]?.deactivate) {
      subtabControllers[prevSubtab].deactivate();
    }
    if (subtabControllers[tabName]?.activate) {
      subtabControllers[tabName].activate();
    }
  }
}

/**
 * Lazily loads subtab implementations only when the Stats screen is opened.
 */
async function ensureSubtabsLoaded() {
  if (subtabsLoaded) return;
  subtabsLoaded = true;

  try {
    const { initTelemetry } = await import('./telemetry.js');
    const { initGames } = await import('./games.js');
    subtabControllers = {
      telemetry: initTelemetry($('pane-telemetry')),
      games: initGames($('pane-games')),
      bench: null,
    };
  } catch (err) {
    console.error('Failed to lazy load stats subtabs:', err);
    subtabsLoaded = false;
  }
}

/**
 * Lifecycle hook: called when current router screen changes.
 * @param {string} screen
 */
async function onScreenChange(screen) {
  const isStats = screen === 'stats';
  if (isStats === isStatsActive) return;
  isStatsActive = isStats;

  if (isStats) {
    await ensureSubtabsLoaded();
    // Restore or apply current subtab
    try {
      const saved = localStorage.getItem('pg-stats-subtab');
      if (saved && SUBTAB_NAMES.includes(saved)) {
        activeSubtab = saved;
      }
    } catch (_) {}
    await switchSubtab(activeSubtab);
  } else {
    // Screen hidden: deactivate active subtab to stop any rendering/event loops
    if (subtabControllers && subtabControllers[activeSubtab]?.deactivate) {
      subtabControllers[activeSubtab].deactivate();
    }
  }
}

/**
 * Bootstraps the stats screen shell.
 */
export function startStats() {
  const subnav = $('stats-subnav');
  if (subnav) {
    subnav.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-subtab]');
      if (btn && btn.dataset.subtab) {
        switchSubtab(btn.dataset.subtab);
      }
    });
  }

  // Hook into router navigation
  onScreen((screen) => onScreenChange(screen));
}
