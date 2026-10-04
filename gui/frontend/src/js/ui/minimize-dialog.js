// "Minimize the window or hide it to the tray?" — on every click of the title
// bar's minimize button, by design with no "remember" option. The tray unloads
// the page and puts WebView2 in efficiency mode (Go: hideWindow, SetTrayMode).

import { call, runtime } from '../core/bridge.js';
import { t } from '../core/i18n.js';
import { openModal } from './modal.js';

let open = false;

export async function askMinimize() {
  if (open) return;
  open = true;
  await openModal({
    title: t('minimize_modal.title'),
    text: t('minimize_modal.desc'),
    actions: [
      { label: t('minimize_modal.window'), onClick: () => runtime().WindowMinimise() },
      { label: t('minimize_modal.tray'), kind: 'primary', onClick: () => call('HideToTray') },
    ],
  });
  open = false;
}
