The setup wizard is a single hero card that walks through six iOS steps (Android needs none). Each step has the same layout; only the text, the `assets/Wizard/step-N.webp` screenshot and the dots change. Russian is a first-class language: `ScreenSetupRU` shows the same screen with the app's Russian strings.

**Structure (top to bottom)**
1. Centre: `pg-badge pg-badge--step` "Step 1 of 6" / "Шаг 1 из 6", then the step title in `display` 800 34px ("Step 1. Download Profile" / "Шаг 1. Загрузка профиля").
2. Two columns: left the instruction (19px, key words in `pg-code`, bold for "on your phone"), the QR plate, the URL chip with Copy, and a `pg-disclosure` for "Why is this certificate needed…"; right the screenshot in `pg-devshot` with ring floor behind it.
3. Bottom row under a hairline: Back (secondary), `pg-dots` (six dots, active is a 28px accent pill, done ones are `accent` at 55%), Next (`pg-btn--primary pg-btn--lg`). Finish replaces Next on the last step; Back is disabled on step 1.

**Rules**
- Strings come from the i18n files (`setup.ios_stepN_title`, `_text`, `_badge`, `setup.disclosure_*`, `setup.step_x_of_y`); do not hard-code text, and let Russian wrap: no fixed label widths. Inline `` `x` `` in strings renders as `pg-code`, `**x**` as bold.
- Screenshots keep their own phone frame; show them at full height of the column (about 440px) with `drop-shadow`, never in a second frame.
- The QR encodes the profile URL on port 8080 (HTTP); this step is the only place the app shows an HTTP link, so keep the URL chip visible.
