/* PhoneGyro design system - tiny vanilla helpers. No dependencies. window.PhoneGyro */
(function () {
  var PG = {};
  PG.setTheme = function (t) { document.documentElement.setAttribute('data-theme', t === 'dark' ? 'dark' : 'light'); };
  PG.theme = function () { return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'; };
  /* sparkline: values -> <svg><path/></svg>; color = CSS var name, e.g. '--accent' */
  PG.spark = function (el, values, color) {
    var w = 200, h = 56, min = Math.min.apply(null, values), max = Math.max.apply(null, values);
    var span = max - min || 1, step = w / (values.length - 1), d = '';
    values.forEach(function (v, i) { d += (i ? 'L' : 'M') + (i * step).toFixed(1) + ' ' + (h - 8 - ((v - min) / span) * (h - 16)).toFixed(1); });
    el.innerHTML = '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none"><path d="' + d + '" style="stroke:var(' + (color || '--accent') + ')"/></svg>';
  };
  /* segmented control: only one .is-active button at a time */
  PG.segmented = function (root) {
    root.addEventListener('click', function (e) {
      var b = e.target.closest('.pg-seg__btn'); if (!b) return;
      root.querySelectorAll('.pg-seg__btn').forEach(function (x) { x.classList.toggle('is-active', x === b); });
    });
  };
  /* range slider: paints the accent fill */
  PG.slider = function (input) {
    var paint = function () { input.style.setProperty('--fill', ((input.value - input.min) / (input.max - input.min) * 100) + '%'); };
    input.addEventListener('input', paint); paint();
  };

  /* hold-to-unlock: press and hold `el` for opts.ms (default 4000). Sets --hold (0..1) on el and .is-holding on el and
     its .pg-lock ancestor. opts.onProgress(p, msLeft), opts.onDone(). Works with pointer and Space/Enter. Returns {reset()}. */
  PG.holdToUnlock = function (el, opts) {
    opts = opts || {}; var ms = opts.ms || 4000, t0 = 0, raf = 0, done = false, host = el.closest('.pg-lock');
    function set(p) { el.style.setProperty('--hold', p); if (opts.onProgress) opts.onProgress(p, Math.max(0, ms * (1 - p))); }
    function cls(on) { el.classList.toggle('is-holding', on); if (host) host.classList.toggle('is-holding', on); }
    function tick() { var p = Math.min(1, (performance.now() - t0) / ms); set(p); if (p >= 1) { done = true; cancelAnimationFrame(raf); cls(false); if (host) host.classList.add('is-unlocked'); if (opts.onDone) opts.onDone(); } else raf = requestAnimationFrame(tick); }
    function start() { if (done || raf) return; t0 = performance.now(); cls(true); raf = requestAnimationFrame(tick); }
    function stop() { if (done) return; cancelAnimationFrame(raf); raf = 0; cls(false); var from = parseFloat(el.style.getPropertyValue('--hold')) || 0, s = performance.now();
      (function back() { var k = Math.min(1, (performance.now() - s) / 250); set(from * (1 - k)); if (k < 1 && !raf) requestAnimationFrame(back); })(); }
    el.addEventListener('pointerdown', function (e) { try { el.setPointerCapture(e.pointerId); } catch (_) {} start(); });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (n) { el.addEventListener(n, stop); });
    el.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    el.addEventListener('keydown', function (e) { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); start(); } });
    el.addEventListener('keyup', function (e) { if (e.key === ' ' || e.key === 'Enter') stop(); });
    return { reset: function () { done = false; raf = 0; cls(false); if (host) host.classList.remove('is-unlocked'); set(0); } };
  };

  /* ============ GyroScene: themed Three.js stage (works with three r128 to current) ============ */
  /* PhoneGyro.loadGLB(url) -> Promise<THREE.BufferGeometry>: minimal reader for the supplied gamepad.glb (one mesh, no GLTFLoader needed). */
  PG.loadGLB = function (url) {
    return fetch(url).then(function (r) { return /\.(txt|b64)$/.test(url) ? r.text().then(function (t) { var s = atob(t.trim()), u = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u.buffer; }) : r.arrayBuffer(); }).then(function (buf) {
      var T = window.THREE, dv = new DataView(buf), jl = dv.getUint32(12, true);
      var json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jl)));
      var bin = buf.slice(20 + jl + 8);
      var CT = { 5121: Uint8Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array }, NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
      function acc(i) { var a = json.accessors[i], bv = json.bufferViews[a.bufferView], C = CT[a.componentType], n = NC[a.type];
        return { arr: new C(bin, (bv.byteOffset || 0) + (a.byteOffset || 0), a.count * n), n: n }; }
      var p = json.meshes[0].primitives[0], g = new T.BufferGeometry(), pos = acc(p.attributes.POSITION);
      g.setAttribute('position', new T.BufferAttribute(pos.arr, 3));
      if (p.attributes.NORMAL) g.setAttribute('normal', new T.BufferAttribute(acc(p.attributes.NORMAL).arr, 3));
      if (p.indices != null) g.setIndex(new T.BufferAttribute(acc(p.indices).arr, 1));
      if (!p.attributes.NORMAL) g.computeVertexNormals();
      var nd = json.nodes && json.nodes[0];
      if (nd) { var m = new T.Matrix4();
        if (nd.matrix) m.fromArray(nd.matrix);
        else m.compose(new T.Vector3().fromArray(nd.translation || [0, 0, 0]), new T.Quaternion().fromArray(nd.rotation || [0, 0, 0, 1]), new T.Vector3().fromArray(nd.scale || [1, 1, 1]));
        g.applyMatrix4(m); }
      return g;
    });
  };
  /* colours the parts of the supplied gamepad (found as separate mesh islands): body, d-pad, two sticks, A/B/X/Y, two bumpers */
  PG.tintGamepad = function (g, c) {
    var pos = g.attributes.position, idx = g.index.array, n = pos.count, key = {}, rep = new Array(n), par = [], i, k;
    for (i = 0; i < n; i++) { k = pos.getX(i).toFixed(4) + ',' + pos.getY(i).toFixed(4) + ',' + pos.getZ(i).toFixed(4); if (key[k] === undefined) key[k] = i; rep[i] = key[k]; par[i] = i; }
    function f(x) { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; }
    for (i = 0; i < idx.length; i += 3) for (var e = 0; e < 2; e++) { var a = f(rep[idx[i + e]]), b = f(rep[idx[i + e + 1]]); if (a !== b) par[a] = b; }
    var comp = {}; for (i = 0; i < n; i++) { k = f(rep[i]); (comp[k] = comp[k] || []).push(i); }
    var list = Object.keys(comp).map(function (q) { return comp[q]; }).sort(function (x, y) { return y.length - x.length; });
    var col = new Float32Array(n * 3);
    function paint(vs, cc) { vs.forEach(function (v) { col[v * 3] = cc.r; col[v * 3 + 1] = cc.g; col[v * 3 + 2] = cc.b; }); }
    function ctr(vs) { var x = 0, z = 0; vs.forEach(function (v) { x += pos.getX(v); z += pos.getZ(v); }); return { x: x / vs.length, z: z / vs.length }; }
    list.forEach(function (vs, j) { paint(vs, c.body); });
    if (list.length === 10) {
      paint(list[1], c.dpad); paint(list[2], c.stick); paint(list[3], c.stick); paint(list[8], c.bumper); paint(list[9], c.bumper);
      var bt = list.slice(4, 8).map(function (vs) { return { vs: vs, c: ctr(vs) }; });
      bt.sort(function (p, q) { return p.c.x - q.c.x; });
      paint(bt[0].vs, c.y); paint(bt[3].vs, c.a);
      var mid = [bt[1], bt[2]].sort(function (p, q) { return p.c.z - q.c.z; });
      paint(mid[0].vs, c.b); paint(mid[1].vs, c.x);
    }
    g.setAttribute('color', new window.THREE.BufferAttribute(col, 3)); return g;
  };
  PG.createScene = function (host, opts) {
    opts = opts || {};
    var T = opts.THREE || window.THREE, LEG = !T.SRGBColorSpace, root = document.documentElement;
    var S = { mode: opts.model || 'gamepad', step: opts.step || 'idle', rec: 0, paused: false, q: null, tilt: [0, 0], geom: null, vis: true, t0: performance.now(), dead: false };
    var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    function tok(n) { return getComputedStyle(root).getPropertyValue('--' + n).trim() || '#888888'; }
    function col(n, mul) { var c = new T.Color(n.charAt(0) === '#' ? n : tok(n)); if (LEG) c.convertSRGBToLinear(); if (mul !== undefined) c.multiplyScalar(mul); return c; }
    var ren;
    try { ren = new T.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' }); }
    catch (e) { host.insertAdjacentHTML('beforeend', '<div class="pg-scene-fallback">3D is unavailable</div>'); return { setStep: function () {}, setModel: function () {}, setRecording: function () {}, setQuaternion: function () {}, setTilt: function () {}, setPaused: function () {}, dispose: function () {} }; }
    if (LEG) ren.outputEncoding = T.sRGBEncoding; else ren.outputColorSpace = T.SRGBColorSpace;
    ren.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); ren.setClearColor(0x000000, 0);
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    ren.domElement.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;display:block'; host.insertBefore(ren.domElement, host.firstChild);
    var scene = new T.Scene(), cam = new T.PerspectiveCamera(28, 1, .1, 60), world = new T.Group(), stage = new T.Group(), rig = new T.Group(), model = new T.Group(), guide = new T.Group();
    scene.add(world); world.add(stage); world.add(rig); rig.add(model); world.add(guide);
    cam.position.set(2.5, 2.4, 7.1); cam.lookAt(0, -.12, 0);
    var FLOOR = -.95, dyn = { rings: [], dot: null, arcs: [], recMesh: null, shadow: null, ball: null, ballHome: null };
    function disposeTree(o) { o.traverse(function (m) { if (m.geometry) m.geometry.dispose(); if (m.material) { (Array.isArray(m.material) ? m.material : [m.material]).forEach(function (x) { if (x.map) x.map.dispose(); x.dispose(); }); } }); }
    function clear(g) { while (g.children.length) { var c = g.children[0]; g.remove(c); disposeTree(c); } }
    function label(text, bg, fg) { var c = document.createElement('canvas'); c.width = c.height = 256; var x = c.getContext('2d'); x.fillStyle = bg; x.fillRect(0, 0, 256, 256);
      x.fillStyle = fg; x.font = '800 46px ' + (tok('font-display') || 'sans-serif'); x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text, 128, 132);
      var t = new T.CanvasTexture(c); if (LEG) t.encoding = T.sRGBEncoding; t.anisotropy = 4; return t; }
    function sprite(text, color) { var c = document.createElement('canvas'); c.width = c.height = 64; var x = c.getContext('2d'); x.fillStyle = color; x.font = '700 40px ' + (tok('font-mono') || 'monospace'); x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text, 32, 34);
      var t = new T.CanvasTexture(c); var s = new T.Sprite(new T.SpriteMaterial({ map: t, transparent: true, depthTest: false })); s.scale.set(.22, .22, 1); return s; }
    function build() {
      clear(stage); clear(model); clear(guide); dyn.rings = []; dyn.arcs = []; dyn.dot = null; dyn.recMesh = null; dyn.ball = null;
      /* lights */
      stage.add(new T.HemisphereLight(0xffffff, col('bg', 1), .5));
      var key = new T.DirectionalLight(0xffffff, .78); key.position.set(3, 6, 4.5); stage.add(key);
      var rim = new T.DirectionalLight(col('info'), .7); rim.position.set(-5, 2.5, -3); stage.add(rim);
      /* floor rings (the texture motif, in 3D) */
      for (var r = .55; r < 4.2; r += .3) { var m = new T.Mesh(new T.RingGeometry(r - .007, r + .007, 160), new T.MeshBasicMaterial({ color: col('accent'), transparent: true, opacity: .5, depthWrite: false })); m.rotation.x = -Math.PI / 2; m.position.y = FLOOR; m.userData.r = r; stage.add(m); dyn.rings.push(m); }
      [0, Math.PI / 2].forEach(function (a) { var l = new T.Mesh(new T.PlaneGeometry(8.4, .008), new T.MeshBasicMaterial({ color: col('info'), transparent: true, opacity: .35, depthWrite: false })); l.rotation.x = -Math.PI / 2; l.rotation.z = a; l.position.y = FLOOR + .001; stage.add(l); });
      var sc = document.createElement('canvas'); sc.width = sc.height = 128; var sx = sc.getContext('2d'), gr = sx.createRadialGradient(64, 64, 4, 64, 64, 62); gr.addColorStop(0, 'rgba(0,0,0,.34)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); sx.fillStyle = gr; sx.fillRect(0, 0, 128, 128);
      var sh = new T.Mesh(new T.PlaneGeometry(3.2, 3.2), new T.MeshBasicMaterial({ map: new T.CanvasTexture(sc), transparent: true, depthWrite: false })); sh.rotation.x = -Math.PI / 2; sh.position.y = FLOOR + .002; stage.add(sh); dyn.shadow = sh;
      /* model */
      if (S.mode === 'cube') {
        var faces = [['RIGHT', 'viz-coral'], ['LEFT', 'viz-slate'], ['TOP', 'viz-leaf'], ['BOTTOM', 'viz-dusk'], ['FRONT', 'viz-teal'], ['BACK', 'viz-amber']];
        var mats = faces.map(function (f) { return new T.MeshStandardMaterial({ map: label(f[0], tok(f[1]), '#0b0b0b'), roughness: .6, metalness: 0 }); });
        var cube = new T.Mesh(new T.BoxGeometry(1.3, 1.3, 1.3), mats); model.add(cube);
        model.add(new T.LineSegments(new T.EdgesGeometry(cube.geometry), new T.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: .55 })));
      } else if (S.mode === 'platform') {
        var slab = new T.Mesh(new T.BoxGeometry(2.5, .14, 2.5), new T.MeshStandardMaterial({ color: col('surface-raised'), roughness: .7 })); model.add(slab);
        for (var q = .3; q < 1.25; q += .3) { var g2 = new T.Mesh(new T.RingGeometry(q - .008, q + .008, 96), new T.MeshBasicMaterial({ color: col('accent'), transparent: true, opacity: .55, side: T.DoubleSide })); g2.rotation.x = -Math.PI / 2; g2.position.y = .072; model.add(g2); }
        var wm = new T.MeshStandardMaterial({ color: col('ink-3'), roughness: .6 });
        [[0, 1.29, 2.6, .1], [0, -1.29, 2.6, .1], [1.29, 0, .1, 2.6], [-1.29, 0, .1, 2.6]].forEach(function (w) { var b = new T.Mesh(new T.BoxGeometry(w[2], .16, w[3]), wm); b.position.set(w[0], .1, w[1]); model.add(b); });
        var goal = new T.Mesh(new T.RingGeometry(.14, .2, 48), new T.MeshBasicMaterial({ color: col('accent'), side: T.DoubleSide })); goal.rotation.x = -Math.PI / 2; goal.position.set(.75, .075, -.75); model.add(goal);
        var ball = new T.Mesh(new T.SphereGeometry(.12, 32, 24), new T.MeshStandardMaterial({ color: col('viz-amber'), roughness: .3, metalness: .15 })); ball.position.set(0, .2, 0); model.add(ball); dyn.ball = ball;
      } else {
        var body = { body: col('viz-slate'), dpad: col('viz-slate', .55), stick: col('viz-slate', .3), bumper: col('viz-dusk'), a: col('viz-leaf'), b: col('viz-coral'), x: col('viz-teal'), y: col('viz-amber') };
        var holder = new T.Group();
        if (S.geom) {
          var g = S.geom.clone(); if (!g.attributes.color) PG.tintGamepad(g, body);
          var mesh = new T.Mesh(g, new T.MeshStandardMaterial({ vertexColors: true, roughness: .5, metalness: .04 })); mesh.rotation.y = -Math.PI / 2; holder.add(mesh);
        } else { holder.add(new T.Mesh(new T.BoxGeometry(2, .5, 1.2), new T.MeshStandardMaterial({ color: body.body, roughness: .5 }))); }
        var bb = new T.Box3().setFromObject(holder), size = bb.getSize(new T.Vector3()), s = 2.05 / (Math.max(size.x, size.y, size.z) || 1); holder.scale.setScalar(s); holder.updateMatrixWorld(true);
        var b2 = new T.Box3().setFromObject(holder), ce = b2.getCenter(new T.Vector3()); holder.position.sub(ce); model.add(holder);
      }
      if (S.mode !== 'platform' && (opts.axes === true || (opts.axes !== false && (S.step === 'axes' || S.step === 'live')))) {
        [['X', [1, 0, 0], 'axis-x'], ['Y', [0, 1, 0], 'axis-y'], ['Z', [0, 0, 1], 'axis-z']].forEach(function (a) { var d = new T.Vector3().fromArray(a[1]), c = col(a[2]), L = a[0] === 'Y' ? 1.15 : 1.35;
          var ar = new T.ArrowHelper(d, new T.Vector3(0, 0, 0), L, c.getHex(), .16, .09); [ar.line.material, ar.cone.material].forEach(function (mm) { mm.transparent = true; mm.opacity = .9; mm.depthTest = false; }); ar.renderOrder = 5; model.add(ar);
          var sp = sprite(a[0], tok(a[2])); sp.position.copy(d.multiplyScalar(L + .2)); sp.renderOrder = 6; model.add(sp); });
      }
      /* calibration guide: arc(s) around the moving axis with an orbiting dot (the logo's orbit) */
      function arc(axis) { var R = 1.55, tr = new T.Mesh(new T.TorusGeometry(R, .014, 8, 96, Math.PI * 1.1), new T.MeshBasicMaterial({ color: col('accent'), transparent: true, opacity: .85 }));
        var gg = new T.Group(); tr.rotation.z = -Math.PI * .55; gg.add(tr);
        if (axis === 'x') gg.rotation.y = Math.PI / 2; if (axis === 'y') gg.rotation.x = Math.PI / 2; guide.add(gg); return { g: gg, R: R, axis: axis }; }
      if (S.step === 'pitch') dyn.arcs.push(arc('x')); if (S.step === 'roll') dyn.arcs.push(arc('z')); if (S.step === 'axes') { dyn.arcs.push(arc('x')); dyn.arcs.push(arc('z')); }
      if (dyn.arcs.length) { dyn.dot = new T.Mesh(new T.SphereGeometry(.06, 16, 12), new T.MeshBasicMaterial({ color: col('warn') })); guide.add(dyn.dot); }
      setRec(S.rec);
    }
    function setRec(p) { S.rec = p; if (dyn.recMesh) { stage.remove(dyn.recMesh); disposeTree(dyn.recMesh); dyn.recMesh = null; }
      if (p > 0) { var m = new T.Mesh(new T.RingGeometry(1.78, 1.86, 128, 1, 0, Math.max(.01, p * Math.PI * 2)), new T.MeshBasicMaterial({ color: col('accent'), side: T.DoubleSide })); m.rotation.x = -Math.PI / 2; m.rotation.z = Math.PI / 2; m.position.y = FLOOR + .004; stage.add(m); dyn.recMesh = m; } }
    var eul = new T.Euler(), qt = new T.Quaternion();
    function update(t) {
      var st = S.step, bob = Math.sin(t * 1.5) * (st === 'rest' ? .008 : .045), x = 0, y = 0, z = 0;
      if (S.mode === 'platform') { var tx = S.tilt[0], tz = S.tilt[1]; if (st !== 'live') { tx = Math.sin(t * .9) * .22; tz = Math.sin(t * 1.3 + 1) * .22; } x = tz; z = -tx; y = 0;
        if (dyn.ball) { dyn.ball.position.x += ((tx * 5) - dyn.ball.position.x) * .06; dyn.ball.position.z += ((tz * -5) - dyn.ball.position.z) * .06; dyn.ball.position.x = Math.max(-1.1, Math.min(1.1, dyn.ball.position.x)); dyn.ball.position.z = Math.max(-1.1, Math.min(1.1, dyn.ball.position.z)); } }
      else if (st === 'pitch') x = .5 * Math.sin(t * 1.6);
      else if (st === 'roll') z = .5 * Math.sin(t * 1.6);
      else if (st === 'axes') { x = .42 * Math.sin(t * 1.1); z = .42 * Math.sin(t * 1.7 + 1); y = .7 * Math.sin(t * .7); }
      else if (st === 'rest') { y = .04 * Math.sin(t * .4); }
      else { y = .42 * Math.sin(t * .5); x = -.08 + .05 * Math.sin(t * .8); }
      if (S.q) rig.quaternion.slerp(S.q, .25); else { eul.set(x - (st === 'idle' ? 0 : .12), y, z, 'YXZ'); qt.setFromEuler(eul); rig.quaternion.slerp(qt, reduce ? 1 : .35); }
      rig.position.y = bob; if (dyn.shadow) { var k = 1 - bob * 2; dyn.shadow.scale.set(k, k, 1); dyn.shadow.material.opacity = .85 - bob; }
      dyn.rings.forEach(function (m) { var r = m.userData.r; m.material.opacity = Math.max(0, (.62 - r * .13)) * (.6 + .4 * Math.sin(t * 1.3 - r * 1.7)); });
      if (dyn.dot && dyn.arcs.length) { var ph = .5 + .5 * Math.sin(t * 1.6), a = dyn.arcs[Math.floor(t * .5) % dyn.arcs.length]; var ang = -Math.PI * .55 + ph * Math.PI * 1.1 * (st === 'axes' ? 1 : 1);
        var v = new T.Vector3(Math.cos(ang) * a.R, Math.sin(ang) * a.R, 0); v.applyEuler(a.g.rotation); dyn.dot.position.copy(v); }
    }
    var W = 0, H = 0;
    function size() { var w = host.clientWidth || 300, h = host.clientHeight || 200; if (w === W && h === H) return; W = w; H = h; ren.setSize(w, h, false); cam.aspect = w / h; cam.fov = w / h < 1.15 ? 34 : 28; cam.updateProjectionMatrix(); }
    function draw(now) { size(); update((now - S.t0) / 1000); ren.render(scene, cam); }
    var raf = 0; function loop(now) { raf = requestAnimationFrame(loop); if (S.paused || document.hidden || !S.vis) return; draw(now); }
    var ro = window.ResizeObserver ? new ResizeObserver(function () { size(); if (S.paused || reduce) draw(performance.now()); }) : null; if (ro) ro.observe(host);
    var io = window.IntersectionObserver ? new IntersectionObserver(function (e) { S.vis = e[0].isIntersecting; }) : null; if (io) io.observe(host);
    var mo = new MutationObserver(function () { build(); }); mo.observe(root, { attributes: true, attributeFilter: ['data-theme', 'data-accent'] });
    build(); raf = requestAnimationFrame(loop);
    var api = {
      ready: Promise.resolve(),
      setStep: function (s) { if (s !== S.step) { S.step = s; build(); } },
      setModel: function (m) { if (m !== S.mode) { S.mode = m; build(); } },
      setRecording: setRec, setTilt: function (x, z) { S.tilt = [x, z]; },
      setQuaternion: function (q) { S.q = q ? (q.isQuaternion ? q : new T.Quaternion().fromArray(q)) : null; },
      setPaused: function (b) { S.paused = !!b; }, dispose: function () { S.dead = true; cancelAnimationFrame(raf); if (ro) ro.disconnect(); if (io) io.disconnect(); mo.disconnect(); clear(stage); clear(model); clear(guide); ren.dispose(); if (ren.domElement.parentNode) ren.domElement.parentNode.removeChild(ren.domElement); },
      render: function () { draw(performance.now()); }
    };
    if (opts.glb) { api.ready = PG.loadGLB(opts.glb).then(function (g) { S.geom = g; build(); }).catch(function () {}); }
    return api;
  };

  /* splash: PhoneGyro.playSplash(root, {ready: Promise, status: [..4 strings..], onDone}). root has class .pg-splash. Phases: is-run (rings unroll, wordmark, progress) -> is-grown (window grows to the app) -> is-app (islands slide in). */
  PG.playSplash = function (root, opts) {
    opts = opts || {}; var timers = [], reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    var st = root.querySelector('.pg-splash__status span'), txt = opts.status || ['Starting…', 'Loading profiles', 'Starting DSU server', 'Ready'];
    function at(ms, fn) { timers.push(setTimeout(fn, ms)); }
    root.classList.remove('is-run', 'is-grown', 'is-app'); void root.offsetWidth;
    if (st) st.textContent = txt[0];
    if (reduce) { root.classList.add('is-run', 'is-grown', 'is-app'); if (opts.onDone) opts.onDone(); return { cancel: function () {} }; }
    root.classList.add('is-run');
    at(1000, function () { if (st) st.textContent = txt[1]; }); at(1500, function () { if (st) st.textContent = txt[2]; }); at(1950, function () { if (st) st.textContent = txt[3]; });
    var minT = new Promise(function (r) { at(2250, r); });
    Promise.all([minT, opts.ready || Promise.resolve()]).then(function () {
      root.classList.add('is-grown'); at(420, function () { root.classList.add('is-app'); }); at(1500, function () { if (opts.onDone) opts.onDone(); });
    });
    return { cancel: function () { timers.forEach(clearTimeout); } };
  };


  /* accent colours: PhoneGyro.accent.set('teal', {from: swatchElementOrEvent}) — recolours the app with a wave that starts
     at the swatch (View Transition, circular reveal) and flies rings out with it (same ring motif as the splash).
     Falls back to an instant switch + rings where View Transitions are missing; prefers-reduced-motion: instant, no rings. */
  PG.accent = (function () {
    var LIST = ['green', 'teal', 'blue', 'violet', 'pink', 'coral', 'amber', 'graphite'], KEY = 'pg-accent', root = document.documentElement, busy = 0;
    function get() { var a = root.getAttribute('data-accent'); return LIST.indexOf(a) < 0 ? 'green' : a; }
    function sync(n) { document.querySelectorAll('[data-accent-pick]').forEach(function (b) { b.setAttribute('aria-checked', b.getAttribute('data-accent-pick') === n ? 'true' : 'false'); }); }
    function apply(n) { sync(n); if (n === 'green') root.removeAttribute('data-accent'); else root.setAttribute('data-accent', n); try { localStorage.setItem(KEY, n); } catch (e) {} }
    function origin(f) {
      if (f && f.clientX != null && (f.clientX || f.clientY) && !f.getBoundingClientRect) return { x: f.clientX, y: f.clientY };
      var el = f && (f.currentTarget || f.target || f); if (el && el.getBoundingClientRect) { var r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
      return { x: innerWidth / 2, y: innerHeight / 2 };
    }
    function burst(o, col, R) {
      var NS = 'http://www.w3.org/2000/svg', d = document.createElement('div'), s = document.createElementNS(NS, 'svg'), anims = [];
      d.className = 'pg-burst'; d.appendChild(s);
      var spec = [ /* width, dash, delay, duration, opacity, scale-to */
        [4, '', 0, 900, 1, 1], [2.5, '', 90, 1050, .9, 1.02], [2, '2 9', 170, 1250, 1, 1.05], [3, '', 250, 1300, .7, 1.08], [1.5, '1 6', 340, 1500, .8, 1.12], [2, '', 430, 1500, .5, 1.15]];
      spec.forEach(function (p, i) {
        var c = document.createElementNS(NS, 'circle'); c.setAttribute('cx', o.x); c.setAttribute('cy', o.y); c.setAttribute('r', R);
        c.setAttribute('stroke', col); c.setAttribute('stroke-width', p[0]); if (p[1]) { c.setAttribute('stroke-dasharray', p[1]); c.setAttribute('stroke-linecap', 'round'); }
        c.style.transformOrigin = o.x + 'px ' + o.y + 'px'; c.style.opacity = 0; s.appendChild(c);
        anims.push(c.animate([{ transform: 'scale(.001)', opacity: p[4] }, { opacity: p[4], offset: .6 }, { transform: 'scale(' + p[5] + ')', opacity: 0 }], { duration: p[3], delay: p[2], easing: 'cubic-bezier(.15,.7,.2,1)', fill: 'both' }));
      });
      /* core flash */
      var g = document.createElementNS(NS, 'circle'); g.setAttribute('cx', o.x); g.setAttribute('cy', o.y); g.setAttribute('r', 46); g.setAttribute('fill', col); g.style.transformOrigin = o.x + 'px ' + o.y + 'px';
      s.insertBefore(g, s.firstChild); anims.push(g.animate([{ transform: 'scale(.2)', opacity: .5 }, { transform: 'scale(2.2)', opacity: 0 }], { duration: 520, easing: 'cubic-bezier(.1,.7,.2,1)', fill: 'both' }));
      document.body.appendChild(d);
      return { el: d, done: Promise.all(anims.map(function (a) { return a.finished.catch(function () {}); })).then(function () { d.remove(); }) };
    }
    function set(n, opts) {
      opts = opts || {}; if (LIST.indexOf(n) < 0) return get();
      if (n === get() && !opts.force) return n;
      var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (opts.animate === false || reduce || busy) { apply(n); return n; }
      var o = origin(opts.from), R = Math.hypot(Math.max(o.x, innerWidth - o.x), Math.max(o.y, innerHeight - o.y)) * 1.02, sw = opts.from && opts.from.classList ? opts.from : null;
      if (sw) { sw.classList.remove('is-pop'); void sw.offsetWidth; sw.classList.add('is-pop'); }
      function colour() { return getComputedStyle(root).getPropertyValue('--accent').trim() || '#888'; }
      busy = 1; setTimeout(function () { busy = 0; }, 1000);
      if (document.startViewTransition) {
        var b, vt = document.startViewTransition(function () { apply(n); });
        vt.ready.then(function () {
          b = burst(o, colour(), R);
          root.animate({ clipPath: ['circle(0px at ' + o.x + 'px ' + o.y + 'px)', 'circle(' + R + 'px at ' + o.x + 'px ' + o.y + 'px)'] }, { duration: 900, easing: 'cubic-bezier(.15,.7,.2,1)', pseudoElement: '::view-transition-new(root)' });
        }).catch(function () {});
        vt.finished.catch(function () {}).then(function () { busy = 0; });
      } else { apply(n); burst(o, colour(), R); }
      return n;
    }
    document.addEventListener('click', function (e) { var t = e.target.closest && e.target.closest('[data-accent-pick]'); if (t) PG.accent.set(t.getAttribute('data-accent-pick'), { from: t }); });
    function init() { var a = 'green'; try { a = localStorage.getItem(KEY) || 'green'; } catch (e) {} if (LIST.indexOf(a) >= 0) apply(a); else sync('green'); }
    return { list: LIST, get: get, set: set, init: init, burst: function (from) { var o = origin(from); return burst(o, getComputedStyle(root).getPropertyValue('--accent').trim(), Math.hypot(innerWidth, innerHeight)); } };
  })();

  /* ---- interface zoom: 50%..300%, default 100%. Ctrl/Cmd + '+', '-', '0', Ctrl + wheel.
     Sets --pg-zoom on <html>; #pg-root applies it as CSS zoom, so the layout re-flows
     (container queries see the zoomed width: 300% on a 1280px window = a 427px window). */
  PG.zoom = (function () {
    var MIN = 0.5, MAX = 3, KEY = 'pg-zoom', STEPS = [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];
    var z = 1, toast, timer, subs = [], lastWheel = 0, inited = false;
    function clamp(v) { v = Math.round(v * 100) / 100; return v < MIN ? MIN : v > MAX ? MAX : (isNaN(v) ? 1 : v); }
    function flash() {
      if (!toast) {
        toast = document.createElement('div'); toast.className = 'pg-zoomtoast pg-app';
        toast.innerHTML = '<span></span><small>Ctrl 0</small><button class="pg-btn" type="button">Reset</button>';
        toast.querySelector('button').onclick = function () { PG.zoom.set(1); };
        document.body.appendChild(toast);
      }
      toast.firstChild.textContent = Math.round(z * 100) + '%';
      toast.classList.add('is-on'); clearTimeout(timer); timer = setTimeout(function () { toast.classList.remove('is-on'); }, 1600);
    }
    function set(v, quiet) {
      z = clamp(v);
      document.documentElement.style.setProperty('--pg-zoom', String(z));
      try { localStorage.setItem(KEY, String(z)); } catch (e) {}
      if (!quiet) flash();
      subs.forEach(function (f) { try { f(z); } catch (e) {} });
      return z;
    }
    function step(dir) {
      var i, n = z;
      if (dir > 0) { for (i = 0; i < STEPS.length; i++) if (STEPS[i] > z + 0.001) { n = STEPS[i]; break; } if (n === z) n = MAX; }
      else { for (i = STEPS.length - 1; i >= 0; i--) if (STEPS[i] < z - 0.001) { n = STEPS[i]; break; } if (n === z) n = MIN; }
      return set(n);
    }
    function init() {
      if (inited) return z; inited = true;
      var saved = 1; try { saved = parseFloat(localStorage.getItem(KEY)) || 1; } catch (e) {}
      set(saved, true);
      window.addEventListener('keydown', function (e) {
        if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
        var k = e.key;
        if (k === '+' || k === '=' || k === 'Add') { e.preventDefault(); step(1); }
        else if (k === '-' || k === '_' || k === 'Subtract') { e.preventDefault(); step(-1); }
        else if (k === '0' || k === 'Numpad0') { e.preventDefault(); set(1); }
      }, true);
      window.addEventListener('wheel', function (e) {
        if (!(e.ctrlKey || e.metaKey)) return;
        e.preventDefault();
        var now = Date.now(); if (now - lastWheel < 70) return; lastWheel = now;
        set(z + (e.deltaY < 0 ? 0.1 : -0.1));
      }, { passive: false });
      return z;
    }
    return { init: init, set: set, get: function () { return z; }, step: step, reset: function () { return set(1); },
             onChange: function (f) { subs.push(f); }, MIN: MIN, MAX: MAX, STEPS: STEPS };
  })();
  /* mount: call once; puts the app in #pg-root (fills the window, zoom-aware) */
  PG.mount = function (win) {
    document.documentElement.classList.add('pg-root');
    var root = document.getElementById('pg-root');
    if (!root) { root = document.createElement('div'); root.id = 'pg-root'; document.body.appendChild(root); }
    if (win && win.parentNode !== root) root.appendChild(win);
    PG.zoom.init(); PG.accent.init(); return root;
  };

  /* ---- Level 3D: the bubble-level dial rendered with Three.js (r128). Same look as the CSS
     .pg-dial (plate, guide rings, ticks, green arrow, bubble in a well) but driven by the real
     gravity vector, so it survives any orientation: tilt, standing on edge, face down.
     Feed it the accelerometer reading in device axes (x right, y up the screen, z out of the
     screen; a phone lying face up reads 0,0,1). No Euler angles, no gimbal jumps. */
  PG.ensureThree = function (cb) {
    if (window.THREE) return cb(true);
    if (PG._threeQ) return PG._threeQ.push(cb);
    PG._threeQ = [cb];
    var s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
    s.onload = function () { var q = PG._threeQ; PG._threeQ = null; q.forEach(function (f) { f(true); }); };
    s.onerror = function () { var q = PG._threeQ; PG._threeQ = null; q.forEach(function (f) { f(false); }); };
    document.head.appendChild(s);
  };
  PG.createLevel = function (el, opts) {
    var T = window.THREE; if (!T) return null;
    opts = opts || {};
    var renderer;
    try { renderer = new T.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' }); } catch (e) { return null; }
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr); if (T.sRGBEncoding) renderer.outputEncoding = T.sRGBEncoding; renderer.setClearColor(0x000000, 0);
    var cv = renderer.domElement; cv.className = 'pg-level3d__cv'; el.appendChild(cv);
    var scene = new T.Scene(), cam = new T.PerspectiveCamera(28, 1, 0.1, 30); cam.position.set(0, 0, 5.4);
    var labels = opts.labels || {};
    var RGB = document.createElement('canvas').getContext('2d');
    function css(name, fb) { var v = getComputedStyle(el).getPropertyValue(name).trim() || fb; RGB.fillStyle = '#000'; RGB.fillStyle = v; return RGB.fillStyle; }
    function C(v) { var c = new T.Color(v); if (c.convertSRGBToLinear) c.convertSRGBToLinear(); return c; }
    var K = {}, mats = {}, faceTex = [null, null];
    function palette() { K = { surf: css('--surface', '#fff'), inset: css('--surface-inset', '#eee'), line: css('--line', '#ccc'), ctl: css('--line-control', '#aaa'), ink: css('--ink', '#111'), ink3: css('--ink-3', '#777'), acc: css('--accent', '#5b7c26'), info: css('--info', '#3f7a86'), warn: css('--warn', '#b7791f'), accT: css('--accent-text', '#5b7c26'), ink2: css('--ink-2', '#444') }; var mm = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(K.surf); K.dark = mm ? (parseInt(mm[1], 16) * .299 + parseInt(mm[2], 16) * .587 + parseInt(mm[3], 16) * .114) / 255 < .4 : false; }
    function face(back) {
      var S = 1024, c = document.createElement('canvas'); c.width = c.height = S; var g = c.getContext('2d'), R = S / 2, u = R;
      g.fillStyle = back ? K.inset : K.surf; g.fillRect(0, 0, S, S);
      for (var n = 0; n < 9000; n++) { g.fillStyle = 'rgba(' + (K.dark ? '255,255,255' : '0,0,0') + ',' + (Math.random() * .035).toFixed(3) + ')'; g.fillRect(Math.random() * S, Math.random() * S, 2, 2); }
      g.translate(R, R);
      function arc(r, w, col, dash, a0, a1) { g.beginPath(); g.arc(0, 0, r * u, a0 || 0, a1 === undefined ? 6.2832 : a1); g.lineWidth = w; g.strokeStyle = col; g.setLineDash(dash || []); g.stroke(); g.setLineDash([]); }
      // outer band, engraved
      g.beginPath(); g.arc(0, 0, .99 * u, 0, 6.2832); g.arc(0, 0, .85 * u, 0, 6.2832, true); g.fillStyle = K.inset; g.globalAlpha = back ? .5 : .75; g.fill(); g.globalAlpha = 1;
      arc(.85, 3, K.ctl);
      // concentric ripples (the ring motif of the app), fading outward
      g.globalAlpha = 1; for (var r = .30; r < .84; r += .055) { g.globalAlpha = (.10 + .34 * (1 - (r - .3) / .54)) * (K.dark ? 1.9 : 1); arc(r, 3, K.acc); } g.globalAlpha = 1;
      // engraved dashes on the band; a diamond every 30 degrees
      for (var k = 0; k < 72; k++) {
        var a = k * Math.PI / 36, mj = k % 6 === 0;
        g.lineCap = 'round'; g.strokeStyle = mj ? K.ink : (K.dark ? K.ink3 : K.ctl); g.lineWidth = mj ? 7 : 3.5;
        var r1 = mj ? .875 : .895, r2 = mj ? .955 : .935;
        if (k === 0 && !back) continue;
        g.beginPath(); g.moveTo(Math.sin(a) * r1 * u, -Math.cos(a) * r1 * u); g.lineTo(Math.sin(a) * r2 * u, -Math.cos(a) * r2 * u); g.stroke();
      }
      arc(.70, 3, K.dark ? K.ink3 : K.ctl); arc(.47, 3, K.dark ? K.ink3 : K.ctl, [5, 15]);
      g.lineWidth = 2.5; g.strokeStyle = K.dark ? K.ctl : K.line; g.beginPath();
      [[0, -1], [1, 0], [0, 1], [-1, 0]].forEach(function (d) { g.moveTo(d[0] * .36 * u, d[1] * .36 * u); g.lineTo(d[0] * .70 * u, d[1] * .70 * u); }); g.stroke();
      // cardinal chevrons pointing in
      [[1, 0], [0, 1], [-1, 0]].forEach(function (d) { var cx = d[0] * .79 * u, cy = d[1] * .79 * u, nx = -d[0], ny = -d[1], px = -ny, py = nx; g.fillStyle = K.ink3; g.beginPath(); g.moveTo(cx + nx * 20, cy + ny * 20); g.lineTo(cx - nx * 12 + px * 18, cy - ny * 12 + py * 18); g.lineTo(cx - nx * 12 - px * 18, cy - ny * 12 - py * 18); g.closePath(); g.fill(); });
      if (!back) { g.fillStyle = K.acc; g.beginPath(); g.moveTo(0, -.80 * u + 22); g.lineTo(22, -.80 * u - 14); g.lineTo(-22, -.80 * u - 14); g.closePath(); g.fill(); }
      // focus reticle: four brackets around the well
      for (var q = 0; q < 4; q++) { var qa = Math.PI / 4 + q * Math.PI / 2 - Math.PI / 2; g.lineCap = 'round'; arc(.35, 7, K.acc, null, qa - .30, qa + .30); }
      var gr = g.createRadialGradient(0, 0.02 * u, 0.02 * u, 0, 0, 0.26 * u); gr.addColorStop(0, K.inset); gr.addColorStop(1, K.line);
      g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 0.24 * u, 0, 6.2832); g.fill(); arc(.24, 3, K.ctl);
      var t = new T.CanvasTexture(c); t.center.set(.5, .5); t.rotation = Math.PI / 2 * (back ? -1 : 1); t.anisotropy = 4; if (T.sRGBEncoding) t.encoding = T.sRGBEncoding; return t;
    }
    var plate = new T.Group(), flipG = new T.Group(); scene.add(plate); plate.add(flipG);
    var H = 0.09;
    function build() {
      palette();
      mats.face0 = new T.MeshBasicMaterial({ map: (faceTex[0] = face(false)) });
      mats.face1 = new T.MeshBasicMaterial({ map: (faceTex[1] = face(true)) });
      mats.edge = new T.MeshStandardMaterial({ color: C(K.ctl), roughness: .6, metalness: .1 });
      mats.bezel = new T.MeshStandardMaterial({ color: C(K.ink3), roughness: .55, metalness: 0 });
      mats.glass = new T.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: .16, roughness: .04, metalness: 0, clearcoat: 1, clearcoatRoughness: .05, depthWrite: false, side: T.DoubleSide });
      mats.bub = new T.MeshStandardMaterial({ color: C(K.ink), roughness: .28, metalness: .1, emissive: C(K.acc), emissiveIntensity: 0 });
    }
    build();
    var body = new T.Mesh(new T.CylinderGeometry(1, 1, H * 2, 96, 1), [mats.edge, mats.face0, mats.face1]);
    body.rotation.x = Math.PI / 2; flipG.add(body);
    // cylinder caps: +Y cap is the front after the x-rotation (points +z); texture orientation fixed below
    [1, -1].forEach(function (s) { var b = new T.Mesh(new T.TorusGeometry(0.99, 0.028, 14, 96), mats.bezel); b.position.z = s * H; flipG.add(b); });
    var glowMat = new T.MeshBasicMaterial({ color: C(K.acc), transparent: true, opacity: .45 });
    [1, -1].forEach(function (s) { var gl = new T.Mesh(new T.TorusGeometry(0.955, 0.0065, 8, 128), glowMat); gl.position.z = s * (H + 0.004); gl.userData.keep = 1; flipG.add(gl); });
    var CAP_R = 2.4, CAP_A = 0.78, capH = CAP_R - Math.sqrt(CAP_R * CAP_R - CAP_A * CAP_A);
    var dGeo = new T.SphereGeometry(CAP_R, 48, 16, 0, Math.PI * 2, 0, Math.asin(CAP_A / CAP_R)); dGeo.rotateX(Math.PI / 2);
    [1, -1].forEach(function (s) { var d = new T.Mesh(dGeo, mats.glass); d.position.z = s * (H + 0.005 - (CAP_R - capH)) ; d.scale.z = s; flipG.add(d); });
    var BR = 0.12, bub = new T.Mesh(new T.SphereGeometry(BR, 32, 20), mats.bub); flipG.add(bub);
    var hc = document.createElement('canvas'); hc.width = hc.height = 128; var hg = hc.getContext('2d'), hr = hg.createRadialGradient(64, 64, 4, 64, 64, 64); hr.addColorStop(0, 'rgba(255,255,255,.9)'); hr.addColorStop(.4, 'rgba(255,255,255,.28)'); hr.addColorStop(1, 'rgba(255,255,255,0)'); hg.fillStyle = hr; hg.fillRect(0, 0, 128, 128);
    var halo = new T.Sprite(new T.SpriteMaterial({ map: new T.CanvasTexture(hc), transparent: true, depthWrite: false, opacity: .4 })); halo.scale.set(.62, .62, 1); flipG.add(halo);
    var pulse = new T.Mesh(new T.RingGeometry(0.90, 0.96, 128), new T.MeshBasicMaterial({ color: C(K.acc), transparent: true, opacity: 0, depthWrite: false, side: T.DoubleSide })); pulse.position.z = H + 0.02; pulse.visible = false; plate.add(pulse); var pulseT = -1;
    // soft contact shadow
    var sc = document.createElement('canvas'); sc.width = sc.height = 128; var sg = sc.getContext('2d'), gg = sg.createRadialGradient(64, 64, 20, 64, 64, 64); gg.addColorStop(0, 'rgba(0,0,0,.34)'); gg.addColorStop(1, 'rgba(0,0,0,0)'); sg.fillStyle = gg; sg.fillRect(0, 0, 128, 128);
    var shadow = new T.Mesh(new T.PlaneGeometry(2.6, 2.6), new T.MeshBasicMaterial({ map: new T.CanvasTexture(sc), transparent: true, depthWrite: false })); shadow.position.set(0.05, -0.12, -0.55); scene.add(shadow);
    var hemi = new T.HemisphereLight(0xffffff, 0x8a8f96, .9); scene.add(hemi); var dl = new T.DirectionalLight(0xffffff, .9); dl.position.set(-2, 3, 4); scene.add(dl);
    function tune() { var m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(K.surf), lum = m ? (parseInt(m[1], 16) * .299 + parseInt(m[2], 16) * .587 + parseInt(m[3], 16) * .114) / 255 : 1; K.dark = lum < .4; hemi.intensity = K.dark ? .5 : .9; dl.intensity = K.dark ? .4 : .9; mats.glass.opacity = K.dark ? .04 : .14; mats.bezel.color.copy(C(K.ink3)); shadow.material.opacity = K.dark ? .7 : 1; glowMat.color.copy(C(K.acc)); pulse.material.color.copy(C(K.acc)); }
    tune();
    // ---- state
    var tgt = new T.Vector3(0, 0, 1), cur = new T.Vector3(0, 0, 1), flipT = 0, flip = 0, dirty = true, running = false, visible = true, raf = 0, last = 0, state = '', size = 0, disposed = false;
    var LIM = Math.sin(20 * Math.PI / 180), LEVEL = Math.sin(1.5 * Math.PI / 180), TRAVEL = 0.70;
    function setAccel(x, y, z) {
      var v = new T.Vector3(+x || 0, +y || 0, +z || 0), n = v.length(); if (n < 0.2) return;
      tgt.copy(v.divideScalar(n));
      if (tgt.z < -0.2) flipT = 1; else if (tgt.z > 0.2) flipT = 0;
      kick();
    }
    function setQuaternion(q) { var v = new T.Vector3(0, 0, 1).applyQuaternion(new T.Quaternion(q.x, q.y, q.z, q.w).invert()); setAccel(v.x, v.y, v.z); }
    function frame(ts) {
      raf = 0; if (disposed) return;
      var dt = Math.min(0.05, (ts - (last || ts)) / 1000); last = ts;
      var k = 1 - Math.exp(-dt * 16), kf = 1 - Math.exp(-dt * 9);
      cur.lerp(tgt, k); if (cur.lengthSq() > 1e-6) cur.normalize();
      flip += (flipT - flip) * kf;
      var mx = Math.abs(tgt.x - cur.x) + Math.abs(tgt.y - cur.y) + Math.abs(tgt.z - cur.z) + Math.abs(flipT - flip);
      var back = flip > 0.5, sx = back ? -1 : 1;
      flipG.rotation.y = flip * Math.PI;
      var rxy = Math.hypot(cur.x, cur.y), sat = Math.min(rxy / LIM, 1), ang = Math.min(Math.asin(Math.min(rxy, 1)), 0.9) * 0.42;
      var ux = rxy > 1e-4 ? cur.x / rxy : 0, uy = rxy > 1e-4 ? cur.y / rxy : 0;
      // plate leans toward the uphill side, in view space
      plate.quaternion.setFromAxisAngle(new T.Vector3(-uy, ux * sx, 0).normalize(), (rxy > 1e-4 ? ang : 0));
      // bubble lives in plate space on the dome of the visible face
      var bx = ux * sat * TRAVEL, by = uy * sat * TRAVEL, r2 = bx * bx + by * by;
      var hz = Math.sqrt(Math.max(0, CAP_R * CAP_R - r2)) - (CAP_R - capH);
      var bz = H + Math.max(hz - BR * 0.3, BR * 0.6); bub.position.set(bx, by, back ? -bz : bz);
      var st = cur.z < -0.2 ? 'down' : (rxy < LEVEL ? 'level' : (rxy >= LIM * 1.9 ? 'steep' : 'tilt'));
      if (st !== state) { var was = state; state = st; var sc2 = st === 'level' ? K.acc : st === 'steep' ? K.warn : st === 'down' ? K.ink3 : K.info; mats.bub.color.copy(C(sc2)); mats.bub.emissive.copy(C(sc2)); mats.bub.emissiveIntensity = st === 'level' ? .3 : .16; halo.material.color.copy(C(sc2)); halo.material.opacity = st === 'level' ? .95 : st === 'down' ? .15 : .5; glowMat.opacity = st === 'level' ? .95 : .4; if (st === 'level' && was && !back) { pulseT = 0; pulse.visible = true; } el.setAttribute('data-state', st); el.dispatchEvent(new CustomEvent('pglevel', { detail: { state: st, tilt: Math.asin(Math.min(rxy, 1)) * 180 / Math.PI } })); }
      if (pulseT >= 0) { pulseT += dt; var pp = Math.min(pulseT / 0.9, 1), es = 1 - Math.pow(1 - pp, 3); pulse.scale.setScalar(.3 + .7 * es); pulse.material.opacity = .75 * (1 - pp); if (pp >= 1) { pulseT = -1; pulse.visible = false; } else mx += 1; }
      halo.position.set(bub.position.x, bub.position.y, bub.position.z + (back ? -.02 : .02));
      dirty = false; if (visible) renderer.render(scene, cam);
      if (mx > 0.0008) raf = requestAnimationFrame(frame); else running = false;
    }
    function kick() { dirty = true; if (!running && !disposed) { running = true; last = 0; raf = requestAnimationFrame(frame); } }
    function resize() { var w = Math.max(60, el.clientWidth || 224), h = Math.max(60, el.clientHeight || w); if (w === size) return; size = w; renderer.setSize(w, h, false); cv.style.width = '100%'; cv.style.height = '100%'; cam.aspect = w / h; cam.updateProjectionMatrix(); kick(); }
    var ro = window.ResizeObserver ? new ResizeObserver(resize) : null; if (ro) ro.observe(el); resize();
    var io = window.IntersectionObserver ? new IntersectionObserver(function (e) { visible = e[0].isIntersecting && !document.hidden; if (visible) kick(); }, { threshold: 0 }) : null; if (io) io.observe(el);
    function vis() { visible = !document.hidden; if (visible) kick(); } document.addEventListener('visibilitychange', vis);
    var mo = new MutationObserver(function () { faceTex.forEach(function (t) { if (t) t.dispose(); }); build(); body.material = [mats.edge, mats.face0, mats.face1]; bub.material = mats.bub; flipG.children.forEach(function (c) { if (c.userData.keep) return; if (c.geometry.type === 'TorusGeometry') c.material = mats.bezel; else if (c !== body && c !== bub) c.material = mats.glass; }); tune(); state = ''; kick(); });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-accent'] });
    if (opts.accel) setAccel(opts.accel[0], opts.accel[1], opts.accel[2]);
    cur.copy(tgt); flip = flipT; kick();
    return {
      canvas: cv, setAccel: setAccel, setQuaternion: setQuaternion,
      get state() { return state; },
      dispose: function () { disposed = true; cancelAnimationFrame(raf); if (ro) ro.disconnect(); if (io) io.disconnect(); mo.disconnect(); document.removeEventListener('visibilitychange', vis); renderer.dispose(); if (cv.parentNode) cv.parentNode.removeChild(cv); }
    };
  };
  /* declarative mount: <div class="pg-level3d" data-ax data-ay data-az data-labels='{"level":"LEVEL",...}'>fallback</div> */
  PG.mountLevels = function (root) {
    var nodes = (root || document).querySelectorAll('.pg-level3d:not([data-pg])'); if (!nodes.length) return;
    Array.prototype.forEach.call(nodes, function (el) { el.setAttribute('data-pg', '1'); });
    PG.ensureThree(function (ok) {
      if (!ok) return;
      Array.prototype.forEach.call(nodes, function (el) {
        var lb = {}; try { lb = JSON.parse(el.getAttribute('data-labels') || '{}'); } catch (e) {}
        var fb = el.querySelector('.pg-level3d__fb');
        var L = PG.createLevel(el, { labels: lb, accel: [parseFloat(el.dataset.ax) || 0, parseFloat(el.dataset.ay) || 0, el.dataset.az === undefined ? 1 : parseFloat(el.dataset.az)] });
        if (!L) return; if (fb) fb.style.display = 'none'; el.classList.add('is-3d'); el._pgLevel = L;
        var lab = el.parentNode && el.parentNode.querySelector('.pg-dial__label');
        if (lab) el.addEventListener('pglevel', function (e) { var d = e.detail; lab.textContent = d.state === 'level' ? (lb.level || 'LEVEL') : d.state === 'down' ? (lb.down || 'FACE DOWN') : d.state === 'steep' ? (lb.steep || 'STEEP') : (lb.tilt || 'TILT') + ' ' + Math.round(d.tilt) + '°'; });
      });
    });
  };
  if (typeof document !== 'undefined') {
    var scanLv = function () { PG.mountLevels(document); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scanLv); else setTimeout(scanLv, 0);
    new MutationObserver(function () { PG.mountLevels(document); }).observe(document.documentElement, { childList: true, subtree: true });
  }
  window.PhoneGyro = PG;
})();
