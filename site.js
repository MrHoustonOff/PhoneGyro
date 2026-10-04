/* PhoneGyro landing: theme switch, 3D scenes, scroll effects and flourishes. */
(function () {
  'use strict';
  var root = document.documentElement, lp = document.querySelector('.lp');
  var th = document.getElementById('lp-theme');
  if (th) th.addEventListener('click', function () {
    var t = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', t);
    try { localStorage.setItem('pg-theme', t); } catch (e) {}
  });
  document.querySelectorAll('.pg-seg__btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var l = btn.getAttribute('lang') || (btn.textContent.trim().toLowerCase() === 'en' ? 'en' : 'ru');
      try { localStorage.setItem('pg-lang', l); } catch (e) {}
    });
  });
  function mount(n) {
    var stage = document.getElementById('pg-hero-stage');
    if (stage && window.PGLanding && window.PhoneGyro && window.THREE) {
      try { window.PGLanding.mount(stage); } catch (e) {}
      var cal = document.getElementById('pg-cal-stage');
      if (cal && window.PGLanding.mountDemo) {
        var go = function () { try { window.PGLanding.mountDemo(cal); } catch (e) {} };
        if (window.IntersectionObserver) {
          var io = new IntersectionObserver(function (en) { if (en[0].isIntersecting) { io.disconnect(); go(); } }, { rootMargin: '400px 0px' });
          io.observe(cal);
        } else go();
      }
      var ax = document.querySelector('.lp-axes');
      if (ax && window.PGLanding.mountAxes) { try { window.PGLanding.mountAxes(ax); } catch (e) {} }
      try { window.PGLanding.mountFx(lp); } catch (e) {}
      try { window.PGLanding.mountScroll(lp); } catch (e) {}
    } else if (n < 60) setTimeout(function () { mount(n + 1); }, 100);
  }
  mount(0);
})();
