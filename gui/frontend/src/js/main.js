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
startConnect();
startSetup();
startSettings();
startDocs();
startCalibration();
startStats();
startGames();

async function boot() {
  await ready;
  const appSettings = await call('GetAppSettings');
  if (appSettings) {
    setSoundConfig(appSettings);
  }
  if (splash.active && (!appSettings || appSettings.splash !== false)) {
    playSound('intro');
  }
  await startI18n();        // strings first: every renderer below uses them
  await Promise.all([startHeader(), startState()]);
  startFooter();
  startZoom();
  startAccent();
  syncSplashSetting();
  startNotices();         // after the strings: they are shown in full
  debugBooted();
}

const booted = boot().catch((e) => console.error('PhoneGyro UI start failed:', e));
splash.finish(booted);
