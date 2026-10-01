# Frontend bench

Headless-Chrome checks for the Windows app's UI (`gui/frontend/src`), with the Go
backend replaced by a stub fed from `fixtures/` (anonymised state and settings).
Needs Node 22+ and Chrome or Edge (`CHROME=path` if not found). No npm packages.

| Command | What it answers |
|---|---|
| `node compare.mjs [ref]` | Did anything visible change against a git ref (default `HEAD`)? Computed styles of every element in both windows, 5 UI states, both themes; plus which elements are visible after each of ~80 steps through wizards, dialogs, settings and guides; plus script errors. Exit code 1 on any difference. |
| `node perf.mjs [page] --scenario rest\|move\|dsu\|offline` | Main-thread cost per second (script, style, layout), layouts per second, heap. `--ref` measures a git ref, `--eval` sets up a screen first, `--shot` saves a screenshot. |
| `node snap.mjs out.json` / `--diff a b [noise…]` | Style snapshots on their own. |
| `node flows.mjs out.json` / `--diff a b` | The visibility flow on its own. |
| `node phone.mjs --state connected\|off\|usb\|warn\|lock\|holding [--theme --lang --w --h --tilt]` | A picture of the phone page (`web/index.html`) served like the Go server does, with a fake socket and synthetic sensor events. |
| `node phone-compare.mjs [ref]` | Do the binary frames the phone page sends stay byte-identical to a git ref (default `HEAD`)? |
| `node phone-perf.mjs [ref]` | Main-thread cost of the phone page per second under 60 Hz sensor events (main screen and Touch Shield) against a git ref. |

Typical use while restyling: commit, change CSS, run `node compare.mjs` — only
the differences you meant should show up.

Notes
- The stub knows the bound methods the UI calls at startup; a new binding the UI
  needs to render may need a line in `backendStub` (`lib.mjs`).
- Snapshots cover what exists in the DOM; hover/focus looks are not compared.
- Canvas and WebGL content is not compared (use `--shot`).
