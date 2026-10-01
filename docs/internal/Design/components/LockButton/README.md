The lock button is the Touch Shield unlock control: a large disc with a padlock that must be pressed and held for 4 seconds; a ring fills around it while you hold.

```html
<div class="pg-lock">
  <div class="pg-lockwrap">
    <div class="pg-sonar"><i></i><i></i><i></i></div>
    <button class="pg-lockbtn" aria-label="Hold 4 seconds to unlock">
    <svg class="pg-lockbtn__ring" viewBox="0 0 176 176"><circle class="pg-lockbtn__track" cx="88" cy="88" r="82"/><circle class="pg-lockbtn__prog" cx="88" cy="88" r="82"/></svg>
    <svg class="pg-lockbtn__icon" viewBox="0 0 64 64">…padlock, shackle has class "shackle"…</svg>
    </button>
  </div>
</div>
```
```js
PhoneGyro.holdToUnlock(btn, { ms: 4000, onProgress: (p, msLeft) => {…}, onDone: () => unlockTouchShield() });
```

**Rules**
- The helper sets `--hold` (0 to 1) on the button and `is-holding` on button and `.pg-lock`; on completion it adds `is-unlocked` to `.pg-lock` (shackle opens, ring and icon turn `accent`) and calls `onDone`. Releasing early animates the ring back in 250ms; a short tap does nothing.
- 148px disc, ring 4px in `accent` over a `line-control` track. Space and Enter also hold, for keyboard users; add `aria-label` naming the 4-second hold.
- `touch-action:none`, no text selection, context menu suppressed: leave these, a long press must not open the browser menu.
- Confirm unlock with the ring, the opened shackle and text ("Unlocked"), plus a `navigator.vibrate(20)` where available.
