'use strict';

  // ── Show / hide ────────────────────────────────────────────────────────────
  // Visibility is the hidden attribute ([hidden] { display: none } in base.css);
  // how a shown element lays out (flex, block, …) is up to the CSS. Works for
  // SVG elements too, which have no .hidden property.
  function setShown(el, shown) {
    if (el) el.toggleAttribute('hidden', !shown);
  }
