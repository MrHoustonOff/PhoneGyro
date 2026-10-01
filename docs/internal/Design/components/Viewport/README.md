The viewport is an inset stage that shows the phone's orientation as a cube or gamepad, with the ring floor and crosshair; the aim bench is its 2D sibling.

```html
<div class="pg-viewport"><span class="pg-viewport__tag">FRONT</span>
  <div class="pg-scene"><div class="pg-rings-floor"></div><div class="pg-cross"></div><div class="pg-cube">…faces…</div></div>
</div>
```

**Rules**
- Stage fill is `surface-inset`; the floor is `repeating-radial-gradient` rings in `accent-line`, the crosshair `info-line`. These are the only places the ring motif is drawn as geometry.
- Cube faces use the reference palette tokens (`viz-teal` front, `viz-coral` right, `viz-leaf` top, `viz-amber` back, `viz-slate` left, `viz-dusk` bottom) with `#0b0b0b` labels in `display` 800. Faces are the same in both themes.
- View tag (`pg-viewport__tag`, top-left): FRONT / RIGHT / TOP / 3/4 VIEW, `mono` 10px tracked.
- Camera layout switch (Static / 4 Cameras / Dynamic) is a `pg-seg` floated top-right, on a `surface` pill.
- The aim bench (`pg-bench`) places a `pg-target` (danger centre, warn halo) on a crosshair; its X/Y readout is a `pg-bench__readout` chip bottom-right.
- Rendering with Three.js keeps the same tokens: read them with `getComputedStyle(document.documentElement).getPropertyValue('--viz-teal')` and never hard-code the old cyan/red/yellow face colours.
