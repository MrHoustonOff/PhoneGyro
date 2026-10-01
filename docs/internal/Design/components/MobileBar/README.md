The mobile bar is a floating pill at the top of the phone page (device chip left, three round buttons right) and a matching pill at the bottom for the client name and link type.

```html
<div class="pg-mbar"><span class="pg-mchip">…phone icon…iPhone<span class="pg-mchip__dot"></span></span>
  <div class="pg-mbar__end"><button class="pg-btn-icon pg-btn-icon--round" aria-label="Touch Shield">…</button>…</div></div>
<div class="pg-mfoot"><span>PhoneGyro · Controller Client</span><span>LAN Direct</span></div>
```

**Rules**
- Touch targets are 44px (`pg-btn-icon--round`); the chip is 44px high. Never smaller on the phone.
- Chip dot: `accent` when linked, `danger` offline, `warn` paused. Language shows the current code ("EN") in `sans` 700, not an icon.
- Active toggles (shield on) use `pg-btn-icon--round.is-active`: accent tint, accent text.
- Footer pill is `mono` 12px in `ink-3`; it is information only, not a button.
