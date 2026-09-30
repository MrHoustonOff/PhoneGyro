// Entry point. Everything local (clicks, the title bar, the launch animation)
// starts at once; what needs Go waits for the bridge, then the first state.

import { ready } from './core/bridge.js';
import { startI18n } from './core/i18n.js';
import { startState } from './core/state.js';
import { startTitlebar } from './shell/titlebar.js';
import { startHeader } from './shell/header.js';
import { startFooter } from './shell/footer.js';
import { startRouter } from './shell/router.js';
import { startCopy } from './ui/copy.js';
import { startConnect } from './screens/connect/connect.js';
import { startSetup } from './screens/setup.js';
import { startSplash, startSplashSetting } from './splash.js';

const splash = startSplash();

startTitlebar();
startRouter();
startCopy();
startConnect();
startSetup();

async function boot() {
  await ready;
  await startI18n();        // strings first: every renderer below uses them
  await Promise.all([startHeader(), startState()]);
  startFooter();
  startSplashSetting();
}

const booted = boot().catch((e) => console.error('PhoneGyro UI start failed:', e));
splash.finish(booted);
