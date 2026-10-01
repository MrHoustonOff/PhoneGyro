The URL chip shows the pairing address in mono with a Copy button; the QR plate sits above it.

```html
<div class="pg-qr"><svg …/></div>
<div class="pg-url"><svg>…link…</svg><span class="pg-url__text">https://192.168.31.82:8443/</span><button class="pg-btn pg-btn--sm">Copy</button></div>
```

**Rules**
- The QR plate is always pure white (`#ffffff`) with black modules in BOTH themes, so phone cameras can read it; it is the one place a literal colour is correct. Keep 16px quiet zone (the plate padding).
- The chip is a pill well (`surface-inset` + `shadow-inset`), URL in `mono` 15px 600, Copy is a `pg-btn--sm`. After copying, change the label to "Copied" for 1.5s.
- Centre both under the "Scan with phone camera to connect" line (`body`, `ink-2`).

**Replaces:** `url-chip`, `url-icon`, `url-text`, `copy-badge` → `pg-url`, `pg-url__text`, `pg-btn--sm`; `qr-image` → `pg-qr`.
