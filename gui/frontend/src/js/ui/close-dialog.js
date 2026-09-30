// "Close or minimize to the tray?" — shown when the close action is "ask"
// (Go sends app:confirm-close from the title bar's or the system's close).

import { on, call } from '../core/bridge.js';
import { t } from '../core/i18n.js';
import { openModal } from './modal.js';

let open = false;

export function startCloseDialog() {
  on('app:confirm-close', async () => {
    if (open) return;
    open = true;
    await openModal({
      title: t('close_modal.title'),
      text: t('close_modal.desc'),
      check: t('close_modal.remember'),
      actions: [
        { label: t('close_modal.cancel') },
        { label: t('close_modal.quit'), onClick: (remember) => call('ConfirmCloseChoice', 'quit', remember) },
        { label: t('close_modal.minimize'), kind: 'primary', onClick: (remember) => call('ConfirmCloseChoice', 'minimize', remember) },
      ],
    });
    open = false;
  });
}
