// GENERATED from the design system bundle.
// (PhoneGyro.accent). Do not edit.
export const accent = (function () {
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
      if (true) { apply(n); return n; }
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
    document.addEventListener('click', function (e) { var t = e.target.closest && e.target.closest('[data-accent-pick]'); if (t) accent.set(t.getAttribute('data-accent-pick'), { from: t }); });
    function init() { var a = 'green'; try { a = localStorage.getItem(KEY) || 'green'; } catch (e) {} if (LIST.indexOf(a) >= 0) apply(a); else sync('green'); }
    return { list: LIST, get: get, set: set, init: init, burst: function (from) { var o = origin(from); return burst(o, getComputedStyle(root).getPropertyValue('--accent').trim(), Math.hypot(innerWidth, innerHeight)); } };
  })();
