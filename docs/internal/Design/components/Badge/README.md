A badge is a 20px mono pill that labels a value with a verdict: it says "good", "watch it" or "bad" next to a number.

```html
<span class="pg-badge pg-badge--ok">57 Hz</span>
<span class="pg-badge pg-badge--ok pg-badge--dot">LIVE</span>
```

**Variants:** neutral (`surface-inset`, `ink-2`), `--ok` (accent), `--warn`, `--danger`, `--info`. Text always uses the matching `*-text` token on its `*-soft` fill with a `*-line` border. `--dot` prepends a 6px dot in `currentColor`.

**Rules**
- Content is short (one to three words or a number+unit). Sentences belong in `pg-notice`.
- Mapping used by the stats screen: frequency ≥ 55 Hz `ok`, latency < 20 ms `ok`, jitter normal `warn`, merged samples 0 `ok` ("no loss"), stillness `info`.
- Never invent a new hue; the four verdict hues are the palette.

**Replaces:** the ad-hoc pills (`setting-value-badge` for mono values is `pg-value`; status pills → `pg-badge`).
