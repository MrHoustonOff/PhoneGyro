The pause card is the phone page's one big action: a full-width tinted card that pauses or resumes motion transmission with a single tap.

```html
<button class="pg-pause">
  <div class="pg-pause__head"><span class="pg-badge pg-badge--ok pg-badge--dot">CONNECTED · STREAMING</span><span class="mono">62 Hz</span></div>
  <div class="pg-pause__title">Pause</div>
  <div class="pg-pause__desc">Tap to temporarily pause motion transmission</div>
</button>
```

**Rules**
- Streaming: `accent` tint, title `accent-text` "PAUSE". Paused: add `pg-pause--paused` (`warn` tint), title "RESUME", badge "PAUSED · NOT SENDING", rate `0 Hz`.
- Title is `display` 800 uppercase, 34px. The card is a `<button>`; the whole surface is the target (min 88px tall).
- State always appears in words in the badge; tint is a reinforcement only.
