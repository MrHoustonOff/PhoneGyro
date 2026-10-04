/* PhoneGyro landing: hero scene.
   Uses the design system's own themed 3D stage (PhoneGyro.createScene: ring floor, axis triad, painted gamepad).
   The mouse sets the model's orientation; when the pointer rests, a slow demo motion takes over. */
(function () {
  'use strict';
  var BASE = (document.currentScript && document.currentScript.src) || '';

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  /* The gamepad model ships inline (gamepad-data.js sets window.PG_GLB, base64), so no network request is needed. */
  function b64buf(s) {
    var b = atob(s), u = new Uint8Array(b.length), i;
    for (i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
    return u.buffer;
  }
  function parseGLB(buf) {
    var T = window.THREE, dv = new DataView(buf), jl = dv.getUint32(12, true);
    var json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jl)));
    var bin = buf.slice(20 + jl + 8);
    var CT = { 5121: Uint8Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array }, NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
    function acc(i) {
      var a = json.accessors[i], bv = json.bufferViews[a.bufferView], C = CT[a.componentType], n = NC[a.type];
      return { arr: new C(bin, (bv.byteOffset || 0) + (a.byteOffset || 0), a.count * n), n: n };
    }
    var p = json.meshes[0].primitives[0], g = new T.BufferGeometry(), pos = acc(p.attributes.POSITION);
    g.setAttribute('position', new T.BufferAttribute(pos.arr, 3));
    if (p.attributes.NORMAL) g.setAttribute('normal', new T.BufferAttribute(acc(p.attributes.NORMAL).arr, 3));
    if (p.indices != null) g.setIndex(new T.BufferAttribute(acc(p.indices).arr, 1));
    if (!p.attributes.NORMAL) g.computeVertexNormals();
    var nd = json.nodes && json.nodes[0];
    if (nd) {
      var m = new T.Matrix4();
      if (nd.matrix) m.fromArray(nd.matrix);
      else m.compose(new T.Vector3().fromArray(nd.translation || [0, 0, 0]), new T.Quaternion().fromArray(nd.rotation || [0, 0, 0, 1]), new T.Vector3().fromArray(nd.scale || [1, 1, 1]));
      g.applyMatrix4(m);
    }
    return g;
  }

  /* A THREE namespace for the hero stage without the floor linework (thin floor rings and the two floor axis lines). */
  function noFloorThree() {
    var T = window.THREE, N = Object.create(T);
    N.RingGeometry = function (a, b, s) {
      if (s === 160 && b - a < 0.02) return new T.BufferGeometry();
      return new T.RingGeometry(a, b, s, arguments[3], arguments[4], arguments[5]);
    };
    N.PlaneGeometry = function (w, h) {
      if (h < 0.01 && w > 8) return new T.BufferGeometry();
      return new T.PlaneGeometry(w, h, arguments[2], arguments[3]);
    };
    return N;
  }

  function mount(host) {
    var T = window.THREE, PG = window.PhoneGyro;
    if (!T || !PG || !PG.createScene || !host) return null;
    var rel = 'ds/phonegyro/models/gamepad.glb.txt';
    var bases = [];
    if (BASE) bases.push(BASE);
    bases.push(document.baseURI);
    var scene = null, dead = false;

    function start(glb) {
      if (dead) return;
      scene = PG.createScene(host, { glb: glb, model: 'gamepad', step: 'live', THREE: noFloorThree() });
      if (scene) host.classList.add('is-3d');
    }
    function tryNext(i) {
      if (dead) return;
      if (i >= bases.length) { start(''); return; }
      var url;
      try { url = new URL(rel, bases[i]).href; } catch (e) { return tryNext(i + 1); }
      fetch(url).then(function (r) { if (!r.ok) throw new Error('glb'); start(url); }).catch(function () { tryNext(i + 1); });
    }
    if (window.PG_GLB) {
      try {
        var buf = b64buf(window.PG_GLB);
        PG.loadGLB = function () { return Promise.resolve(parseGLB(buf)); };
      } catch (e) {}
      start('inline');
    } else {
      tryNext(0);
    }

    var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    var qFlip = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), Math.PI);
    var q = new T.Quaternion(), eul = new T.Euler(0, 0, 0, 'YXZ');
    var tx = 0, ty = 0, nx = 0, ny = 0, lastMove = -1, raf = 0;
    var t0 = performance.now();

    function onMove(e) {
      var w = window.innerWidth || 1, h = window.innerHeight || 1;
      tx = clamp(e.clientX / w * 2 - 1, -1, 1);
      ty = clamp(e.clientY / h * 2 - 1, -1, 1);
      lastMove = performance.now();
    }
    window.addEventListener('pointermove', onMove, { passive: true });

    function frame() {
      if (dead) return;
      var now = performance.now(), t = (now - t0) / 1000;
      var idle = lastMove < 0 || now - lastMove > 3000;
      var gx = tx, gy = ty;
      if (idle) {
        if (reduce) { gx = 0; gy = 0; }
        else { gx = Math.sin(t * 0.55) * 0.7; gy = Math.sin(t * 0.83 + 1) * 0.5; }
      }
      nx += (gx - nx) * 0.08; ny += (gy - ny) * 0.08;
      var sp = (window.PGLanding && window.PGLanding.sp) || 0;
      eul.set(ny * 0.55 + 0.5 - sp * 0.35, nx * 0.95 + sp * 2.4, -nx * 0.3, 'YXZ');
      q.setFromEuler(eul).multiply(qFlip);
      if (scene) scene.setQuaternion(q);
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    return {
      dispose: function () {
        dead = true;
        if (raf) cancelAnimationFrame(raf);
        window.removeEventListener('pointermove', onMove);
        if (scene && scene.dispose) scene.dispose();
      }
    };
  }


  /* Calibration card: the app's own 3D stage, cycling its calibration steps (pitch, roll, axes) with the guide arcs. */
  function mountDemo(host) {
    var T = window.THREE, PG = window.PhoneGyro;
    if (!T || !PG || !PG.createScene || !host) return null;
    if (window.PG_GLB) {
      try { var buf = b64buf(window.PG_GLB); PG.loadGLB = function () { return Promise.resolve(parseGLB(buf)); }; } catch (e) {}
    }
    var steps = ['pitch', 'roll', 'axes'], idx = 0, dead = false, timer = 0;
    var scene = PG.createScene(host, { glb: window.PG_GLB ? 'inline' : '', model: 'gamepad', step: steps[0], axes: true });
    if (scene) host.classList.add('is-3d');
    function mark() {
      var els = host.parentNode.querySelectorAll('.pg-step'), links = host.parentNode.querySelectorAll('.pg-step__link'), a = idx + 1, i;
      for (i = 0; i < els.length; i++) { els[i].classList.toggle('is-active', i === a); els[i].classList.toggle('is-done', i < a); }
      for (i = 0; i < links.length; i++) links[i].classList.toggle('is-done', i < a);
    }
    mark();
    timer = setInterval(function () {
      if (dead || !scene) return;
      idx = (idx + 1) % steps.length;
      scene.setStep(steps[idx]);
      mark();
    }, 5000);
    return { dispose: function () { dead = true; clearInterval(timer); if (scene && scene.dispose) scene.dispose(); } };
  }

  /* Desktop scroll choreography (fine pointer, wide screen, no reduced motion): scrubbed reveals, hero parallax,
     progress bar, scroll-spy, marquee that speeds up with the scroll, a filling line through the quick-start steps.
     Fail-safe by design: content is visible by default (--t falls back to 1); if anything misbehaves the whole layer switches itself off. */
  function mountScroll(root) {
    if (!root || !window.matchMedia) return null;
    var mq = window.matchMedia('(min-width: 901px) and (pointer: fine) and (prefers-reduced-motion: no-preference)');
    var items = [], on = false, raf = 0, lastY = null, vel = 0, dead = false, errs = 0, beat = 0, dog = 0, strikes = 0;
    var bar = null, heroText = null, heroScene = null, hero = null, marq = null, steps = null, tabs = [], secs = [];
    function q(sel, ctx) { return Array.prototype.slice.call((ctx || root).querySelectorAll(sel)); }
    function vh() { return document.documentElement.clientHeight || window.innerHeight || 800; }
    function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
    function ease(t) { return 1 - Math.pow(1 - t, 3); }
    function tag(els, d0, dstep) {
      els.forEach(function (el, i) {
        if (el.hasAttribute('data-sc')) return;
        el.setAttribute('data-sc', '');
        items.push({ el: el, d: (d0 || 0) + (dstep || 0) * i });
      });
    }
    function collect() {
      items = [];
      q('.lp-head').forEach(function (h) { tag(q('.pg-overline, .lp-h2, .lp-lead', h), 0, 0.08); });
      q('.lp-facts').forEach(function (f) { q('.lp-fact', f).forEach(function (c, i) { c.setAttribute('data-sc', ''); items.push({ el: c, d: (i % 4) * 0.08 }); }); });
      tag(q('.lp-qs__side > *'), 0.05, 0.08);
      tag(q('.lp-how__i'), 0, 0.14);
      q('.lp-bento > .lp-b').forEach(function (c, i) { c.setAttribute('data-sc', ''); items.push({ el: c, d: (i % 3) * 0.12 }); });
      tag(q('.lp-steps li'), 0, 0);
      tag(q('.lp-qs__act, .lp-qs__main > .pg-notice, .lp-qs__main > .pg-card'), 0, 0);
      tag(q('.lp-faq'), 0.06, 0);
      tag(q('.lp-final'), 0, 0);
      tag(q('.lp-footer__cols > *'), 0, 0.1);
    }
    function frame() {
      var H = vh(), rr = root.getBoundingClientRect(), y = -rr.top, i, it, r, t;
      beat = performance.now();
      if (lastY === null) lastY = y;
      vel += ((y - lastY) - vel) * 0.18; lastY = y;
      for (i = 0; i < items.length; i++) {
        it = items[i]; r = it.el.getBoundingClientRect();
        t = ease(clamp01((H * 0.97 - r.top) / (H * 0.30) - it.d));
        it.el.style.setProperty('--t', t.toFixed(3));
      }
      var total = Math.max(1, rr.height - H);
      if (bar) bar.style.transform = 'scaleX(' + clamp01(y / total).toFixed(4) + ')';
      if (hero) {
        var hh = hero.offsetHeight || 760, py = Math.max(0, y), p = clamp01(py / (hh * 0.9));
        window.PGLanding.sp = p;
        if (heroText) { heroText.style.transform = 'translate3d(0,' + (-py * 0.14).toFixed(1) + 'px,0)'; heroText.style.opacity = (1 - clamp01(p * 1.25)).toFixed(3); }
        if (heroScene) heroScene.style.transform = 'translate3d(0,' + (py * 0.22).toFixed(1) + 'px,0) scale(' + (1 + p * 0.1).toFixed(3) + ')';
      }
      if (steps) {
        var sr = steps.getBoundingClientRect();
        steps.style.setProperty('--p', clamp01((H * 0.62 - sr.top) / Math.max(1, sr.height)).toFixed(3));
      }
      if (marq && marq.getAnimations) {
        var an = marq.getAnimations();
        if (an[0]) an[0].playbackRate = 1 + Math.min(10, Math.abs(vel) * 0.35);
      }
      var cur = -1;
      for (i = 0; i < secs.length; i++) if (secs[i] && secs[i].getBoundingClientRect().top < H * 0.4) cur = i;
      for (i = 0; i < tabs.length; i++) tabs[i].classList.toggle('is-active', i === cur);
    }
    function loop() {
      if (!on || dead) return;
      try { frame(); errs = 0; } catch (e) { if (++errs > 4) { disable(); return; } }
      raf = requestAnimationFrame(loop);
    }
    function watchdog() {
      if (!on) return;
      if (performance.now() - beat > 1800) {
        if (++strikes > 1) { disable(); return; }
        if (raf) cancelAnimationFrame(raf); raf = requestAnimationFrame(loop);
      } else strikes = 0;
    }
    function enable() {
      if (on) return;
      if (vh() > 2400) return; /* the page is embedded at full content height, so there is no real viewport to scroll in */
      on = true; errs = 0; strikes = 0; lastY = null;
      hero = root.querySelector('.lp-hero'); heroText = root.querySelector('.lp-hero__text'); heroScene = root.querySelector('.lp-hero__scene');
      marq = root.querySelector('.lp-marq__track'); steps = root.querySelector('.lp-steps');
      tabs = q('.lp-header .pg-tab');
      secs = tabs.map(function (a) { var h = (a.getAttribute('href') || '').replace('#', ''); return h ? document.getElementById(h) : null; });
      if (!bar) { bar = document.createElement('div'); bar.className = 'lp-prog'; bar.setAttribute('aria-hidden', 'true'); root.appendChild(bar); }
      collect();
      try { frame(); } catch (e) { disable(); return; }
      root.classList.add('is-anim');
      raf = requestAnimationFrame(loop);
      dog = setInterval(watchdog, 1000);
    }
    function disable() {
      on = false; root.classList.remove('is-anim');
      if (raf) cancelAnimationFrame(raf); raf = 0;
      if (dog) clearInterval(dog); dog = 0;
      items.forEach(function (it) { it.el.style.removeProperty('--t'); });
      if (heroText) { heroText.style.transform = ''; heroText.style.opacity = ''; }
      if (heroScene) heroScene.style.transform = '';
      if (steps) steps.style.removeProperty('--p');
      if (bar && bar.parentNode) bar.parentNode.removeChild(bar);
      bar = null;
      if (window.PGLanding) window.PGLanding.sp = 0;
    }
    function sync() { if (dead) return; if (mq.matches) { if (!on) enable(); } else if (on) disable(); }
    sync();
    window.addEventListener('resize', sync);
    if (mq.addEventListener) mq.addEventListener('change', sync); else if (mq.addListener) mq.addListener(sync);
    return { dispose: function () { dead = true; disable(); window.removeEventListener('resize', sync); if (mq.removeEventListener) mq.removeEventListener('change', sync); } };
  }

  /* Telemetry card: the X / Y / Z bars drift slowly, like a phone being held nearly upright (gravity stays on Y). */
  function mountAxes(host) {
    var rows = host ? Array.prototype.slice.call(host.querySelectorAll('.lp-axis')) : [];
    if (rows.length < 3) return null;
    var bars = rows.map(function (r) { return r.querySelector('.lp-axis__bar i'); });
    var nums = rows.map(function (r) { return r.querySelector('.mono'); });
    var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    var vis = true, dead = false, raf = 0, last = 0, t0 = performance.now();
    function put(i, v) {
      var w = Math.abs(v) * 50;
      bars[i].style.left = (v >= 0 ? 50 : 50 - w) + '%';
      bars[i].style.width = w.toFixed(1) + '%';
      nums[i].textContent = (v >= 0 ? '+' : '-') + Math.abs(v).toFixed(2);
    }
    function frame(now) {
      if (dead) return;
      raf = requestAnimationFrame(frame);
      if (reduce || !vis || document.hidden || now - last < 40) return;
      last = now;
      var t = (now - t0) / 1000;
      var x = 0.12 + 0.2 * Math.sin(t * 0.32), z = 0.04 + 0.16 * Math.sin(t * 0.24 + 1.3);
      var y = -Math.sqrt(Math.max(0.02, 1 - x * x - z * z));
      put(0, x); put(1, y); put(2, z);
    }
    var io = window.IntersectionObserver ? new IntersectionObserver(function (e) { vis = e[0].isIntersecting; }) : null;
    if (io) io.observe(host);
    raf = requestAnimationFrame(frame);
    return { dispose: function () { dead = true; if (raf) cancelAnimationFrame(raf); if (io) io.disconnect(); } };
  }

  /* Desktop flourishes: card glow that follows the cursor, magnetic primary buttons, mosaic tiles with depth.
     Rings inside the mosaic are SVG <animate>; they are paused under reduced motion. */
  function mountFx(root) {
    if (!root || !window.matchMedia) return null;
    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var svgs = Array.prototype.slice.call(root.querySelectorAll('.lp-mz__svg'));
    if (reduce) { svgs.forEach(function (s) { try { s.pauseAnimations(); } catch (e) {} }); return null; }
    var mq = window.matchMedia('(min-width: 901px) and (pointer: fine)');
    var mags = Array.prototype.slice.call(root.querySelectorAll('.pg-btn--primary.pg-btn--lg'));
    var arts = Array.prototype.slice.call(root.querySelectorAll('.lp-mz')).map(function (m) {
      return { el: m, tiles: Array.prototype.slice.call(m.querySelectorAll('.lp-mz__t')) };
    });
    var depth = [1.0, 0.55, 0.8, 0.65, 0.45, 0.35];
    var px = 0, py = 0, pending = false, on = false;
    function apply() {
      pending = false;
      var i, r, el = document.elementFromPoint(px, py);
      var card = el && el.closest ? el.closest('.pg-card:not(.lp-tile)') : null;
      if (card) { r = card.getBoundingClientRect(); card.style.setProperty('--mx', (px - r.left) + 'px'); card.style.setProperty('--my', (py - r.top) + 'px'); }
      for (i = 0; i < mags.length; i++) {
        r = mags[i].getBoundingClientRect();
        var cx = r.left + r.width / 2, cy = r.top + r.height / 2, dx = px - cx, dy = py - cy, d = Math.sqrt(dx * dx + dy * dy);
        mags[i].style.translate = d < 140 ? (dx * 0.18).toFixed(1) + 'px ' + (dy * 0.28).toFixed(1) + 'px' : '0 0';
      }
      arts.forEach(function (a) {
        r = a.el.getBoundingClientRect();
        if (r.bottom < 0 || r.top > (window.innerHeight || 900)) return;
        var nx = Math.max(-1, Math.min(1, (px - (r.left + r.width / 2)) / (r.width))), ny = Math.max(-1, Math.min(1, (py - (r.top + r.height / 2)) / (r.height)));
        a.tiles.forEach(function (t, k) { var f = depth[k % depth.length] * 22; t.setAttribute('transform', 'translate(' + (nx * f).toFixed(1) + ' ' + (ny * f).toFixed(1) + ')'); });
      });
    }
    function onMove(e) { px = e.clientX; py = e.clientY; if (!pending) { pending = true; requestAnimationFrame(apply); } }
    function sync() {
      if (mq.matches && !on) { on = true; root.classList.add('is-fx'); window.addEventListener('pointermove', onMove, { passive: true }); }
      else if (!mq.matches && on) {
        on = false; root.classList.remove('is-fx'); window.removeEventListener('pointermove', onMove);
        mags.forEach(function (m) { m.style.translate = ''; });
        arts.forEach(function (a) { a.tiles.forEach(function (t) { t.removeAttribute('transform'); }); });
      }
    }
    sync();
    if (mq.addEventListener) mq.addEventListener('change', sync);
    return { dispose: function () { window.removeEventListener('pointermove', onMove); root.classList.remove('is-fx'); } };
  }

  window.PGLanding = { mount: mount, mountDemo: mountDemo, mountScroll: mountScroll, mountAxes: mountAxes, mountFx: mountFx };
})();
