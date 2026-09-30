// Stats & 3D Screen (Telemetry, 3D Orientation & Metrics)
// Coordinates lazy loading of telemetry components and lifecycle management.

import { $ } from '../../core/dom.js';
import { onScreen } from '../../shell/router.js';

let isStatsActive = false;
let telemetryLoaded = false;
let telemetryController = null;

/**
 * Lazily loads telemetry implementation when the Stats screen is first opened.
 */
async function ensureTelemetryLoaded() {
  if (telemetryLoaded) return;
  telemetryLoaded = true;

  try {
    const { initTelemetry } = await import('./telemetry.js');
    telemetryController = initTelemetry($('screen-stats'));
  } catch (err) {
    console.error('Failed to lazy load telemetry:', err);
    telemetryLoaded = false;
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
    await ensureTelemetryLoaded();
    if (telemetryController?.activate) {
      telemetryController.activate();
    }
  } else {
    // Screen hidden: deactivate telemetry to stop any rAF or WebGL rendering
    if (telemetryController?.deactivate) {
      telemetryController.deactivate();
    }
  }
}

/**
 * Bootstraps the stats screen.
 */
export function startStats() {
  // Clear any legacy subtab storage
  try {
    localStorage.removeItem('pg-stats-subtab');
  } catch (_) {}

  // Hook into router navigation
  onScreen((screen) => onScreenChange(screen));
}
