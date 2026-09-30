// Initial setup (design: ScreenSetup): pick the platform, then Android shows the
// address to open, iOS walks through six steps with the phone screenshots.

import { $, setText, setHTML, show, toggleClass, setAttr, md } from '../core/dom.js';
import { t, onLang } from '../core/i18n.js';
import { onState } from '../core/state.js';
import { go, onScreen } from '../shell/router.js';

const STEPS = 6;
let mode = 'pick'; // 'pick' | 'android' | 'ios'
let step = 1;

function render() {
  show($('wiz-pick'), mode === 'pick');
  show($('wiz-android'), mode === 'android');
  show($('wiz-ios'), mode === 'ios');
  show($('wiz-foot'), mode !== 'pick');
  const dots = $('wiz-dots');
  show(dots, mode === 'ios');
  if (mode !== 'ios') {
    setText($('wiz-next'), t('setup.btn_finish'));
    return;
  }
  setText($('wiz-step-badge'), t('setup.step_x_of_y', { x: step, y: STEPS }));
  setText($('wiz-step-title'), t(`setup.ios_step${step}_title`));
  setHTML($('wiz-step-text'), md(t(`setup.ios_step${step}_text`)));
  setHTML($('wiz-step-hint'), md(t(`setup.ios_step${step}_badge`)));
  show($('wiz-step1-extra'), step === 1);
  show($('wiz-step-hint'), step !== 1);
  setAttr($('wiz-shot'), 'src', `img/wizard/step-${step}.webp`);
  [...dots.children].forEach((d, i) => {
    toggleClass(d, 'is-active', i === step - 1);
    toggleClass(d, 'is-done', i < step - 1);
  });
  setText($('wiz-next'), t(step === STEPS ? 'setup.btn_finish' : 'setup.btn_next'));
}

function back() {
  if (mode === 'ios' && step > 1) step--;
  else mode = 'pick';
  render();
}

function next() {
  if (mode === 'ios' && step < STEPS) { step++; render(); return; }
  go('connect');
}

export function startSetup() {
  $('wiz-pick').addEventListener('click', (e) => {
    const b = e.target.closest('[data-platform]');
    if (!b) return;
    mode = b.dataset.platform;
    step = 1;
    render();
  });
  $('wiz-back').onclick = back;
  $('wiz-next').onclick = next;
  $('wiz-close').onclick = () => go('connect');
  addEventListener('keydown', (e) => {
    if ($('screen-setup').hidden) return;
    if (e.key === 'Escape') go('connect');
    else if (mode === 'ios' && e.key === 'ArrowRight' && step < STEPS) next();
    else if (mode !== 'pick' && e.key === 'ArrowLeft') back();
  });
  onScreen((s) => { if (s === 'setup') { mode = 'pick'; step = 1; render(); } });
  onLang(render);
  onState((st) => {
    if (st.setupQrCode) setAttr($('wiz-setup-qr'), 'src', st.setupQrCode);
    if (st.setupUrl) setText($('wiz-setup-url'), st.setupUrl);
    if (st.qrCode) setAttr($('wiz-android-qr'), 'src', st.qrCode);
    if (st.gamepadUrl) setText($('wiz-android-url'), st.gamepadUrl);
  });
}
