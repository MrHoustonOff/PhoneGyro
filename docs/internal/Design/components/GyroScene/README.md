The 3D scene is a themed Three.js stage used for the calibration wizard, the model viewport (gamepad / cube) and the platform test. It replaces the dark-navy vignette, cyan grid and single grey-blue model with the design system's own look: it lives in a `surface-inset` well, stands on a floor of rings (the texture motif in 3D), and every colour comes from tokens, so it follows the light/dark theme.

```js
// three.min.js (r128 in the app) is already loaded as window.THREE
const scene = PhoneGyro.createScene(document.getElementById('stage'), {
  glb: 'assets/models/gamepad.glb.txt',   // your model; read by PhoneGyro.loadGLB, no GLTFLoader needed
  model: 'gamepad',                   // 'gamepad' | 'cube' | 'platform'
  step: 'rest',                       // 'idle' | 'rest' | 'pitch' | 'roll' | 'axes' | 'live'
});
scene.setStep('pitch');               // calibration step: shows the guide arc and animates the motion
scene.setRecording(0.4);              // accent ring on the floor fills while capturing (0..1)
scene.setQuaternion([x, y, z, w]);    // live orientation from the phone (slerped); pass null to release
scene.setTilt(tiltX, tiltZ);          // platform mode: ball follows the tilt
scene.setPaused(true);                // Resource Saving: stops rendering (also stops on hidden tab / off-screen)
scene.dispose();
```
The host element needs the `pg-stage` class (a well with a soft top light) and a height; add a caption with `pg-stage__cap` and a view tag with `pg-viewport__tag`. The scene re-reads the tokens when `data-theme` changes.

**Look**
- Floor: 13 rings in `accent`, opacity fading with distance and a slow outward pulse, plus a faint `info` crosshair and a soft contact shadow. No fog, no grid, no glow.
- Gamepad: your `gamepad.glb`, matte plastic (`roughness .5`), body `viz-slate`. `PhoneGyro.tintGamepad` finds the model's separate islands and paints them: A `viz-leaf`, B `viz-coral`, X `viz-teal`, Y `viz-amber`, sticks and D-pad darker slate, bumpers `viz-dusk`. It relies on the supplied model (10 islands); any other model falls back to one body colour.
- Cube: faces in the `viz-*` palette with `display` labels and thin white edges. Platform: a light slab with ring grooves, low walls, an `accent` goal and a `viz-amber` ball (replaces the bronze/cyan Sheikah slab).
- Lighting: hemisphere + white key + `info` rim. No coloured point lights.
- Axis triad: X = `axis-x` (coral), Y = `axis-y` (leaf), Z = `axis-z` (teal) with letters, drawn on top at 90% opacity.

**Calibration guidance (animated)**
- `rest`: model settles, tiny breathing only. `pitch`: nods around X with an accent arc and an amber dot travelling on it (the logo's orbit). `roll`: same around Z. `axes`: combined tilt and twist with two arcs. `idle`: slow yaw with a floating bob. The floor ring fills during capture (`setRecording`).
- The motion is a demonstration for the user to mirror, so keep amplitudes near 0.4 to 0.5 rad and the period near 4 seconds.

**Performance and rules**
- One renderer, pixel ratio capped at 2, `powerPreference: low-power`, no shadows maps, no post-processing. Rendering pauses when the tab is hidden, the stage is off-screen or `setPaused(true)`; reduced motion snaps to poses without smoothing.
- Do not add coloured lights, bloom, cyan or gold materials, or text baked into the background. Colours go through `tok()` (CSS variables), never literals, except the cube labels' ink `#0b0b0b`.
- Newer three.js: colour management is handled (`outputColorSpace` when available). Light intensities were tuned on r128; if you upgrade past r155, multiply the three light intensities by about 3.
