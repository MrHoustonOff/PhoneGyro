// Benchmark for Task 3B: Calibration save step with slot picker, icon choice, and empty-slot labels
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { browser, serve, backendStub, sleep, FRONTEND } from './lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(HERE, 'out');
mkdirSync(OUT_DIR, { recursive: true });

async function main() {
  console.log('[Bench 3B] Serving frontend...');
  const srv = await serve(FRONTEND);
  console.log(`[Bench 3B] Server running at ${srv.base}`);

  console.log('[Bench 3B] Launching browser...');
  const b = await browser({ width: 1100, height: 800 });
  const p = await b.page(backendStub());
  const ev = (fn) => p.evaluate(typeof fn === 'function' ? `(${fn.toString()})()` : fn);

  try {
    console.log('[Bench 3B] Loading app...');
    await p.goto(`${srv.base}/index.html`, 2500);

    // Bring backend online
    await ev(() => {
      window.__emit('state:change', window.__stateAt('rest', 0));
    });
    await sleep(300);

    // Open calibration wizard
    console.log('[Bench 3B] Opening calibration...');
    await ev(() => {
      const btn = document.getElementById('btn-calibrate');
      if (btn) btn.click();
    });
    await sleep(500);

    // Fast advance through Steps 1 to 4 to reach Verify
    console.log('[Bench 3B] Advancing through Steps 1 to 4...');
    for (let step = 0; step < 4; step++) {
      await ev(() => {
        const cap = document.querySelector('[data-act="capture"]');
        if (cap) cap.click();
      });
      await sleep(step === 3 ? 1500 : 4200);

      await ev(() => {
        const next = document.querySelector('#cal-foot [data-act="next"]');
        if (next) next.click();
      });
      await sleep(400);
    }

    // Now on Verify step. Advance to Save screen.
    console.log('[Bench 3B] Advancing from Verify to Save screen...');
    await ev(() => {
      const saveBtn = document.querySelector('#cal-foot [data-act="tosave"]');
      if (saveBtn) saveBtn.click();
    });
    await sleep(500);

    // ── 1. Check Initial Save Screen (Occupied Slot 0) ──
    console.log('[Bench 3B] Verifying occupied slot state (Slot 0)...');
    const occupiedState = await ev(() => {
      const trigger = document.getElementById('cal-save-slot-trigger');
      const triggerTitle = document.getElementById('cal-save-trigger-title')?.textContent.trim();
      const triggerDevice = document.getElementById('cal-save-trigger-device')?.textContent.trim();
      const triggerBadge = document.getElementById('cal-save-trigger-badge')?.textContent.trim();
      const warnBox = document.querySelector('.app-cal-warn');
      const nameInput = document.getElementById('cal-name');
      const iconCards = Array.from(document.querySelectorAll('.app-cal-icon-card')).map(c => ({
        icon: c.dataset.icon,
        selected: c.classList.contains('is-selected'),
        title: c.textContent.trim(),
      }));
      const deviceBadge = document.querySelector('.app-cal-device-badge')?.textContent.trim();

      return {
        hasTrigger: !!trigger,
        triggerTitle,
        triggerDevice,
        triggerBadge,
        hasWarn: !!warnBox,
        warnText: warnBox?.textContent.trim(),
        nameValue: nameInput?.value,
        nameSelected: nameInput ? nameInput.selectionStart === 0 && nameInput.selectionEnd === nameInput.value.length : false,
        iconCards,
        deviceBadge,
      };
    });

    console.log('[Bench 3B] Occupied slot state:', occupiedState);
    if (!occupiedState.hasTrigger) throw new Error('Slot trigger button missing');
    if (!occupiedState.hasWarn) throw new Error('Overwrite warning MUST be visible on occupied active slot');
    if (!occupiedState.warnText?.includes('Profile 3')) {
      throw new Error(`Warning text should name Profile 3, got: ${occupiedState.warnText}`);
    }
    if (occupiedState.nameValue !== 'Profile 3') {
      throw new Error(`Expected name input "Profile 3", got: ${occupiedState.nameValue}`);
    }
    // Profile 3 (slot 2) icon in fixture is "default"
    const defaultCard = occupiedState.iconCards.find(c => c.icon === 'default');
    if (!defaultCard || !defaultCard.selected) {
      throw new Error(`Default icon should be auto-selected for Profile 3, got: ${JSON.stringify(occupiedState.iconCards)}`);
    }

    // Save screenshot 12_save_occupied_dark.png
    console.log('[Bench 3B] Saving screenshot: 12_save_occupied_dark.png...');
    writeFileSync(path.join(OUT_DIR, '12_save_occupied_dark.png'), await p.screenshot());

    // ── 2. Open Slot Dropdown ──
    console.log('[Bench 3B] Opening slot dropdown menu...');
    await ev(() => {
      const trigger = document.getElementById('cal-save-slot-trigger');
      if (trigger) trigger.click();
    });
    await sleep(250);

    const menuState = await ev(() => {
      const menu = document.getElementById('cal-save-slot-menu');
      const isVisible = menu && !menu.hidden;
      const items = Array.from(menu?.querySelectorAll('.app-menu__item') || []).map((el, i) => ({
        slot: el.dataset.slot,
        active: el.classList.contains('is-active'),
        isEmpty: el.classList.contains('app-cal-menu-item--empty'),
        title: el.querySelector('.pg-profile__t')?.textContent.trim(),
        sub: el.querySelector('.pg-profile__s')?.textContent.trim(),
        hasCheck: !!el.querySelector('.app-menu__check'),
      }));
      return { isVisible, items };
    });

    console.log('[Bench 3B] Dropdown menu state:', menuState);
    if (!menuState.isVisible) throw new Error('Dropdown menu not visible after clicking trigger');
    if (menuState.items.length !== 6) throw new Error(`Expected 6 slot items, got ${menuState.items.length}`);
    if (!menuState.items[2].active || !menuState.items[2].hasCheck) {
      throw new Error('Slot 2 should be active and have checkmark');
    }
    // Check empty slot 3 (index 3, slot 4)
    const slot3 = menuState.items[3];
    if (!slot3.isEmpty) throw new Error('Slot 3 (Slot 4) should be marked as empty');
    if (!slot3.title.includes('Пустой слот') && !slot3.title.includes('новый профиль') && !slot3.title.includes('Empty')) {
      throw new Error(`Empty slot title unexpected: ${slot3.title}`);
    }
    if (!slot3.sub.includes('при сохранении') && !slot3.sub.includes('on save')) {
      throw new Error(`Empty slot subtitle unexpected: ${slot3.sub}`);
    }

    // Save screenshot 13_save_dropdown_open.png
    console.log('[Bench 3B] Saving screenshot: 13_save_dropdown_open.png...');
    writeFileSync(path.join(OUT_DIR, '13_save_dropdown_open.png'), await p.screenshot());

    // ── 3. Test Escape Key on Open Dropdown ──
    console.log('[Bench 3B] Testing Escape key closes dropdown without closing wizard...');
    await p.S('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await sleep(250);

    const escapeClosedState = await ev(() => {
      const menu = document.getElementById('cal-save-slot-menu');
      const modal = document.querySelector('.app-cal-modal');
      return {
        menuHidden: menu?.hidden,
        wizardStillOpen: !!modal && !modal.hidden,
      };
    });
    console.log('[Bench 3B] Escape result:', escapeClosedState);
    if (!escapeClosedState.menuHidden) throw new Error('Escape key did not close dropdown');
    if (!escapeClosedState.wizardStillOpen) throw new Error('Escape key closed the entire wizard while dropdown was open!');

    // Reopen dropdown
    await ev(() => document.getElementById('cal-save-slot-trigger')?.click());
    await sleep(200);

    // ── 4. Select Empty Slot 3 ──
    console.log('[Bench 3B] Selecting empty slot 3...');
    await ev(() => {
      const item3 = document.querySelector('.app-menu__item[data-slot="3"]');
      if (item3) item3.click();
    });
    await sleep(350);

    const emptySlotState = await ev(() => {
      const trigger = document.getElementById('cal-save-slot-trigger');
      const triggerTitle = document.getElementById('cal-save-trigger-title')?.textContent.trim();
      const triggerDevice = document.getElementById('cal-save-trigger-device')?.textContent.trim();
      const warnBox = document.querySelector('.app-cal-warn');
      const nameInput = document.getElementById('cal-name');
      const iconCards = Array.from(document.querySelectorAll('.app-cal-icon-card')).map(c => ({
        icon: c.dataset.icon,
        selected: c.classList.contains('is-selected'),
      }));

      return {
        triggerTitle,
        triggerDevice,
        hasWarn: !!warnBox,
        nameValue: nameInput?.value,
        iconCards,
      };
    });

    console.log('[Bench 3B] Selected empty slot state:', emptySlotState);
    if (emptySlotState.hasWarn) {
      throw new Error('Overwrite warning MUST NOT be shown for empty slot 3!');
    }
    if (emptySlotState.nameValue !== 'iPhone 4') {
      throw new Error(`Expected default name "iPhone 4", got: "${emptySlotState.nameValue}"`);
    }
    const defaultIconCard = emptySlotState.iconCards.find(c => c.icon === 'default');
    if (!defaultIconCard || !defaultIconCard.selected) {
      throw new Error('Empty slot should auto-select "default" icon');
    }

    // Save screenshot 14_save_empty_slot.png
    console.log('[Bench 3B] Saving screenshot: 14_save_empty_slot.png...');
    writeFileSync(path.join(OUT_DIR, '14_save_empty_slot.png'), await p.screenshot());

    // ── 5. Test Manual Icon Choice ──
    console.log('[Bench 3B] Selecting "horizontal" icon...');
    await ev(() => {
      const horizBtn = document.querySelector('.app-cal-icon-card[data-icon="horizontal"]');
      if (horizBtn) horizBtn.click();
    });
    await sleep(200);

    const iconChosenState = await ev(() => {
      const horizCard = document.querySelector('.app-cal-icon-card[data-icon="horizontal"]');
      const trigIcon = document.getElementById('cal-save-trigger-icon');
      return {
        horizSelected: horizCard?.classList.contains('is-selected'),
        hasTrigIcon: !!trigIcon?.querySelector('svg'),
      };
    });
    console.log('[Bench 3B] Icon chosen state:', iconChosenState);
    if (!iconChosenState.horizSelected) throw new Error('Horizontal icon was not selected');

    // Save screenshot 15_save_icon_selected.png
    console.log('[Bench 3B] Saving screenshot: 15_save_icon_selected.png...');
    writeFileSync(path.join(OUT_DIR, '15_save_icon_selected.png'), await p.screenshot());

    // ── 6. Test Light Theme ──
    console.log('[Bench 3B] Switching to light theme...');
    await ev(() => document.documentElement.setAttribute('data-theme', 'light'));
    await sleep(300);

    console.log('[Bench 3B] Saving screenshot: 16_save_light.png...');
    writeFileSync(path.join(OUT_DIR, '16_save_light.png'), await p.screenshot());

    await ev(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await sleep(200);

    // ── 7. Responsive Narrow Window (820px) ──
    console.log('[Bench 3B] Testing narrow window (820px)...');
    await p.S('Emulation.setDeviceMetricsOverride', {
      width: 820,
      height: 720,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await sleep(400);

    console.log('[Bench 3B] Saving screenshot: 17_save_narrow_820px.png...');
    writeFileSync(path.join(OUT_DIR, '17_save_narrow_820px.png'), await p.screenshot());

    // Restore viewport
    await p.S('Emulation.setDeviceMetricsOverride', {
      width: 1100,
      height: 800,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await sleep(200);

    // ── 8. Test Saving Profile ──
    console.log('[Bench 3B] Submitting save...');
    // Type custom name into #cal-name
    await ev(() => {
      const inp = document.getElementById('cal-name');
      if (inp) inp.value = 'Custom Phone 4';
    });

    // Intercept SaveProfile call
    let saveProfileArgs = null;
    let setActiveArgs = null;
    await ev(() => {
      const origSave = window.go.app.App.SaveProfile;
      const origActive = window.go.app.App.SetActiveProfile;
      window.__saveCalls = [];
      window.go.app.App.SaveProfile = (...args) => {
        window.__saveCalls.push(args);
        return Promise.resolve('ok');
      };
      window.__activeCalls = [];
      window.go.app.App.SetActiveProfile = (...args) => {
        window.__activeCalls.push(args);
        return Promise.resolve('ok');
      };
    });

    // Click "Сохранить"
    await ev(() => {
      const saveBtn = document.querySelector('#cal-foot [data-act="save"]');
      if (saveBtn) saveBtn.click();
    });
    await sleep(400);

    const callResults = await ev(() => ({
      saveCalls: window.__saveCalls,
      activeCalls: window.__activeCalls,
      wizardClosed: document.getElementById('cal')?.hidden,
    }));

    console.log('[Bench 3B] Call results:', callResults);
    if (!callResults.saveCalls || callResults.saveCalls.length === 0) {
      throw new Error('SaveProfile was not called!');
    }
    const [savedSlot, savedName, savedDevice, savedIcon, savedMatrix] = callResults.saveCalls[0];
    if (savedSlot !== 3) throw new Error(`Expected slot 3 saved, got ${savedSlot}`);
    if (savedName !== 'Custom Phone 4') throw new Error(`Expected name "Custom Phone 4", got "${savedName}"`);
    if (savedIcon !== 'horizontal') throw new Error(`Expected selected icon "horizontal", got "${savedIcon}"`);
    if (!Array.isArray(savedMatrix)) throw new Error('Expected matrix array');
    if (callResults.activeCalls[0][0] !== 3) {
      throw new Error(`Expected SetActiveProfile(3), got ${callResults.activeCalls[0][0]}`);
    }
    if (!callResults.wizardClosed) {
      throw new Error('Wizard modal should be closed after successful save');
    }

    console.log('\n[Bench 3B] ALL VERIFICATIONS PASSED SUCCESSFULLY!\n');
  } finally {
    await b.close();
    srv.close();
  }
}

main().catch((err) => {
  console.error('[Bench 3B] FAILED:', err);
  process.exit(1);
});
