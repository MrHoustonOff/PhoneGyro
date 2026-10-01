A disclosure is a collapsed explanation with a one-line question as its title; it keeps the wizard short while the reassurance ("why is this certificate needed, is it safe?") is one click away.

```html
<details class="pg-disclosure"><summary>Why is this certificate needed and is it safe?</summary><div class="pg-disclosure__body">…</div></details>
```

**Rules**
- Native `<details>`: keyboard and screen readers work; the chevron is CSS. Title is a question, 15px `label`-weight; body `body-sm` in `ink-2`, bold lead-ins stay `ink`.
- Card recipe (`surface` + grain, `line`, `shadow-card`). Never nest disclosures.
