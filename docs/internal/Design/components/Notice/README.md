A notice is an inline banner that explains the state of a section; it does not block and does not auto-dismiss.

```html
<div class="pg-notice pg-notice--warn"><span><b>Title</b><span class="pg-notice__sub">Detail</span></span></div>
```

**Variants:** default = info (teal), `--ok`, `--warn`, `--danger`. A 8px dot in the variant solid (with a 3px halo) replaces an icon; the fill is the `*-soft` token and the border the `*-line` token. Body text is `ink`; the `pg-notice__sub` line is `ink-2`.

**Rules**
- Use `warn` for "server is up but nothing is listening" (the DSU card on the connect screen), `danger` for lost link or failed calibration, `info` for tuning hints, `ok` for the connected card.
- A trailing status badge or action goes inside `pg-notice__row`.
- Keep it to two lines. Longer explanations belong in Help.
