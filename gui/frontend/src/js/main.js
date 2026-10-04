// Entry point. Everything local (clicks, the title bar, the launch animation)
// starts at once; what needs Go waits for the bridge, then the first state.

import { ready, openURL, call } from './core/bridge.js';
import { setSoundConfig, playSound, startSound } from './core/sound.js';
import { startI18n } from './core/i18n.js';

if (typeof window !== 'undefined') {
  window.playSound = playSound;
}
import { startState } from './core/state.js';
import { startTitlebar } from './shell/titlebar.js';
import { startHeader } from './shell/header.js';
import { startFooter } from './shell/footer.js';
import { startRouter } from './shell/router.js';
import { startCopy } from './ui/copy.js';
import { startTooltips } from './ui/tooltip.js';
import { startSelects } from './ui/select.js';
import { startZoom } from './ui/zoom.js';
import { startAccent } from './ui/accent.js';
import { startDebug, debugBooted } from './debug/toggle.js';
import { startBannerTriggers } from './debug/banners.js';
import { startCloseDialog } from './ui/close-dialog.js';
import { startNotices } from './ui/notices.js';
import { startConnect } from './screens/connect/connect.js';
import { startSetup } from './screens/setup.js';
import { startSettings } from './screens/settings.js';
import { startDocs } from './screens/docs.js';
import { startCalibration } from './screens/calibration.js';
import { startStats } from './screens/stats/stats.js';
import { startGames } from './screens/games/games.js';
import { startSplash, syncSplashSetting } from './splash.js';

// ── Phase 0: runs synchronously, before the first animation frame ─────────
// Only what is needed for the splash and the window frame. Screen modules
// (connect, settings, stats ...) are deferred to phase 1 so the main thread
// is free to paint the first splash frame without a long task in the way.
startDebug();              // first: with the setting on, the debug panel sees the start too
const splash = startSplash();

startTitlebar();
startRouter();
startCopy();
startTooltips();
startSelects();
startCloseDialog();

// Links in locale text open in the system browser, never inside the window.
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href^="http"]');
  if (!a) return;
  e.preventDefault();
  openURL(a.href);
});
startSound();

// ── Phase 1: deferred after the first paint ───────────────────────────────
// All screen modules are hidden behind `hidden` and not needed until the
// splash ends (~2.25 s). Deferring them into the next rAF clears the long
// task that was blocking the first animation frame.
requestAnimationFrame(() => {
  setTimeout(() => {
    startConnect();
    startSetup();
    startSettings();
    startDocs();
    startCalibration();
    startStats();
    startGames();
  }, 0);
});

async function boot() {
  await ready;
  await startI18n();        // strings first: every renderer below uses them

  splash.setStatus('splash.starting', 'Initializing');

  const appSettings = await call('GetAppSettings');
  if (appSettings) {
    setSoundConfig(appSettings);
  }
  if (splash.active && (!appSettings || appSettings.splash !== false)) {
    playSound('intro');
  }

  splash.setStatus('splash.profiles', 'Profiles loaded');

  splash.setStatus('splash.server', 'DSU server started');
  await Promise.all([startHeader(), startState()]);
  startFooter();
  startZoom();
  startAccent();
  syncSplashSetting();

  splash.setStatus('splash.ready', 'Ready');

  // DEV-only: banner trigger panel (same channel check as the titlebar badge).
  const appVersion = await call('GetAppVersion').catch(() => null);
  if (appVersion && appVersion.channel !== 'release') {
    const toggleBtn = document.getElementById('dbg-banner-toggle');
    if (toggleBtn) toggleBtn.hidden = false;
    startBannerTriggers();
  }

  startNotices();         // after the strings: they are shown in full
  debugBooted();

  // Rule 0: Pause background drift animation when window is blurred or hidden
  document.addEventListener('visibilitychange', () => {
    document.documentElement.classList.toggle('is-hidden', document.hidden);
  });
  window.addEventListener('blur', () => {
    document.documentElement.classList.add('is-blur');
  });
  window.addEventListener('focus', () => {
    document.documentElement.classList.remove('is-blur');
  });
}

const booted = boot().catch((e) => console.error('PhoneGyro UI start failed:', e));
splash.finish(booted);
