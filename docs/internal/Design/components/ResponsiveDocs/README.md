Responsive rules for the desktop app (Wails window). The window root is a container (`.pg-window`, `container: pgwin / size`), so every rule below reacts to the window's own size in CSS pixels and not to the screen. This is what makes zoom work: at 300% zoom a 1280 px window behaves like a 427 px window.

Two modes:

- **Wide, fits the height** (window ≥ 860px): columns side by side; the shell does not scroll, each panel scrolls on its own (`pg-fit` on the shell). Between 860 and 1100 the docs table of contents is dropped and the telemetry split becomes 5:6; ≥ 1100 it is 40:60.
- **Compact, fits the width** (window < 860px): one column, the whole body scrolls under the floating header and footer. Telemetry: panel first, then a 2×2 viewport grid. Settings: groups first, test bench below. USB: device card, then the right column. Docs: sections become a horizontal chip row, article below. Wizard: no phone screenshot.

Steps inside compact:

- **< 560px (sm)**: wordmark and status text hidden, only the active tab shows its label, rows wrap their controls under the label, viewports stack in one column, repo name in the footer hidden.
- **< 400px (xs)**: RAM island hidden, dial 200px, gutters 10px.
- **Height < 620px**: the wizard drops the phone screenshot and scrolls.
- **≥ 1700px**: content keeps its measure (`max-width` 1120 to 1280) and is centred; only the viewports grow.

Rules for new screens: never set a pixel width on a card, use `width:100%; max-width:N`; give grids `minmax(0, …)` columns; put scroll on the panel in wide mode and on the shell body in compact mode; hide, do not shrink, secondary chrome.
