Buttons trigger one action; the primary button is a solid `ink` slab, everything else is a raised `surface` key with a 1px lip.

**Markup**

```html
<button class="pg-btn pg-btn--primary pg-btn--lg"><span class="pg-kbd">Space</span>Recenter</button>
<button class="pg-btn">Back</button>
<button class="pg-btn-icon" aria-label="Close"><svg>...</svg></button>
```

**Variants:** `--primary` (fill `ink`, text `on-ink`), default secondary (`surface` + `line`), `--danger` (`danger` / `on-danger`, only for Stop recording and destructive confirms), `--ghost` (link-like, e.g. "Manual Setup"). **Sizes:** default 40px, `--sm` 28px, `--lg` 52px (uppercase, tracked: the one big action on a screen). `--block` stretches to the container.

**Rules**
- One `--primary` per card or screen. The rest are secondary or ghost.
- Icons are 16px strokes at 1.8 width inheriting `currentColor`; icon-only buttons are `pg-btn-icon` (36px) and need `aria-label`.
- Keyboard hints go in `pg-kbd` inside the button, before the label.
- Disabled = `disabled` attribute (45% opacity, no lip). Never recolor a disabled button.
- Hover changes fill only; press moves the key down 1px. No glow, no gradients.

**Replaces:** `btn-apple-primary` → `pg-btn pg-btn--primary pg-btn--lg`, `btn-apple-secondary` → `pg-btn`, `btn-icon` → `pg-btn-icon`.
