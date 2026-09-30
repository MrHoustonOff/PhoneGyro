// Entry point. Everything local (clicks, the title bar, the launch animation)
// starts at once; what needs Go waits for the bridge, then the first state.

import { ready, openURL } from './core/bridge.js';
import { startI18n } from './core/i18n.js';
import { startState } from './core/state.js';
import { startTitlebar } from './shell/titlebar.js';
import { startHeader } from './shell/header.js';
import { startFooter } from './shell/footer.js';
import { startRouter } from './shell/router.js';
import { startCopy } from './ui/copy.js';
import { startTooltips } from './ui/tooltip.js';
import { startSelects } from './ui/select.js';
import { startZoom } from './ui/zoom.js';
import { startCloseDialog } from './ui/close-dialog.js';
import { startNotices } from './ui/notices.js';
import { startConnect } from './screens/connect/connect.js';
import { startSetup } from './screens/setup.js';
import { startSettings } from './screens/settings.js';
import { startDocs } from './screens/docs.js';
import { startSplash, syncSplashSetting } from './splash.js';

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
startConnect();
startSetup();
startSettings();
startDocs();

async function boot() {
  await ready;
  await startI18n();        // strings first: every renderer below uses them
  await Promise.all([startHeader(), startState()]);
  startFooter();
  startZoom();
  syncSplashSetting();
  startNotices();         // after the strings: they are shown in full
}

const booted = boot().catch((e) => console.error('PhoneGyro UI start failed:', e));
splash.finish(booted);
