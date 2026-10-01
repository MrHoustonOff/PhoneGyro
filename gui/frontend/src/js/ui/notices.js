// Notices Go raises on its own (no design mockup, built on the modal sheet):
//   cemu:notice      a Cemu instance connected: its gyro bug and the drift guard
//   firewall:alert   phone mode, Windows Firewall would block the phone
//   update:available the optional update check found a newer release
// Each also has a Pending* call: the event can fire before the window loaded.

import { on, call, openURL } from '../core/bridge.js';
import { md, esc } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { render, slug } from '../core/markdown.js';
import { openDocsAt } from '../screens/docs.js';
import { openModal } from './modal.js';

const p = (key, vars) => `<p>${md(t(key, vars))}</p>`;
const queue = [];
let busy = false;

// One dialog at a time; the next waits.
function show(fn) {
  queue.push(fn);
  if (!busy) next();
}
async function next() {
  const fn = queue.shift();
  if (!fn) { busy = false; return; }
  busy = true;
  await fn();
  next();
}

export function cemu(n) {
  const statusMd = n.guardOn !== false ? t('cemu_notice.guard_on') : t('cemu_notice.guard_off');
  const prMd = n.prUrl ? t('cemu_notice.pr', { url: n.prUrl }) : t('cemu_notice.pr_none');
  const infoList = [t('cemu_notice.settings'), t('cemu_notice.upstream'), prMd].join('\n');
  const { html } = render([t('cemu_notice.bug'), statusMd, infoList].join('\n\n'));

  return show(() => openModal({
    title: t('cemu_notice.title'),
    dialogClass: 'app-modal-dialog--notice',
    body: `<div class="pg-prose app-notice-prose">${html}</div>`,
    check: t('cemu_notice.dont_show'),
    actions: [{ label: t('cemu_notice.close'), kind: 'primary', onClick: (hide) => call('CloseCemuNotice', hide) }],
  }).then((i) => { if (i < 0) call('CloseCemuNotice', false); }));
}

// Windows Firewall blocks the phone. The rule is made by hand: the dialog points at the guide.
export function firewall(st) {
  const text = [t('firewall.alert_text'), st && st.network === 'public' ? t('firewall.alert_public') : ''].filter(Boolean).join('\n\n');
  const { html } = render(text);
  return show(() => openModal({
    title: t('firewall.alert_title'),
    dialogClass: 'app-modal-dialog--notice',
    body: `<div class="pg-prose app-notice-prose">${html}</div>`,
    actions: [
      { label: t('firewall.later') },
      { label: t('firewall.how'), kind: 'primary', onClick: () => openDocsAt(slug(t('firewall.docs_heading'))) },
    ],
  }).then(() => call('CloseFirewallAlert')));
}

export function update(info) {
  show(() => openModal({
    title: t('update_notice.title', { version: info.latest }),
    body: p('update_notice.versions', { current: info.current }) + `<ol class="app-steps"><li>${md(t('update_notice.step_download'))}</li><li>${md(t('update_notice.step_run'))}</li></ol>`
      + `<p class="app-modal-link"><a class="pg-link" href="${esc(info.releaseUrl)}">${esc(t('update_notice.release_page'))}</a></p>`,
    check: t('update_notice.skip'),
    actions: [
      { label: t('update_notice.later'), onClick: (skip) => call('CloseUpdateNotice', skip) },
      { label: t('update_notice.download'), kind: 'primary', onClick: (skip) => { openURL(info.downloadUrl || info.releaseUrl); call('CloseUpdateNotice', skip); } },
    ],
  }).then((i) => { if (i < 0) call('CloseUpdateNotice', false); }));
}

export function startNotices() {
  on('cemu:notice', cemu);
  on('firewall:alert', firewall);
  on('update:available', update);
  call('PendingCemuNotice').then((n) => n && cemu(n));
  call('PendingFirewallAlert').then((s) => s && firewall(s));
  call('PendingUpdate').then((u) => u && update(u));
}
