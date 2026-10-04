/* PhoneGyro landing: language and theme switches, 3D scenes, scroll effects. */
(function () {
  'use strict';
  var root = document.documentElement;
  function $(id) { return document.getElementById(id); }
  function store(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function read(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }

  var lp = document.querySelector('.lp');
  var ru = $('lp-ru'), en = $('lp-en'), th = $('lp-theme');
  var isEnPage = root.getAttribute('lang') === 'en';

  var descRu = 'PhoneGyro передаёт данные гироскопа (IMU) смартфона на iOS и Android или собственного IMU-устройства в Cemu, Ryujinx и другие эмуляторы по протоколу Cemuhook DSU. Подключение по QR-коду, без приложения на телефоне. Открытый исходный код, Windows.';
  var titleRu = 'PhoneGyro — гироскоп телефона для Cemu и Ryujinx (DSU, Windows)';
  var descEn = 'PhoneGyro streams IMU data from your iOS or Android smartphone, or from your own device, to Cemu, Ryujinx and other emulators over the Cemuhook DSU protocol. Connect by QR code, nothing to install on the phone. Open source, Windows.';
  var titleEn = 'PhoneGyro — Phone motion controls for Cemu and Ryujinx (DSU, Windows)';

  function setLang(l, save) {
    if (lp) lp.setAttribute('data-lang', l);
    root.setAttribute('lang', l);
    if (ru) {
      ru.classList.toggle('is-active', l === 'ru');
      ru.setAttribute('aria-pressed', l === 'ru');
    }
    if (en) {
      en.classList.toggle('is-active', l === 'en');
      en.setAttribute('aria-pressed', l === 'en');
    }
    var d = l === 'en' ? descEn : descRu;
    var m = document.querySelector('meta[name="description"]');
    if (m && d) m.setAttribute('content', d);
    document.title = l === 'en' ? titleEn : titleRu;
    if (save) store('pg-lang', l);
  }

  function setTheme(t, save) {
    root.setAttribute('data-theme', t);
    if (save) store('pg-theme', t);
  }

  if (isEnPage) {
    setLang('en', false);
  } else {
    var q = /[?&]lang=(en|ru)/.exec(location.search);
    var lang = q ? q[1] : read('pg-lang');
    if (lang === 'en') {
      setLang('en', false);
    } else {
      setLang('ru', false);
    }
  }

  if (ru) {
    ru.addEventListener('click', function () {
      if (isEnPage) {
        store('pg-lang', 'ru');
        window.location.href = '../';
      } else {
        setLang('ru', true);
      }
    });
  }

  if (en) {
    en.addEventListener('click', function () {
      if (!isEnPage) {
        store('pg-lang', 'en');
        window.location.href = 'en/';
      } else {
        setLang('en', true);
      }
    });
  }

  if (th) {
    th.addEventListener('click', function () {
      setTheme(root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark', true);
    });
  }

  function mount(n) {
    var stage = $('pg-hero-stage');
    if (stage && window.PGLanding && window.PhoneGyro && window.THREE) {
      try { window.PGLanding.mount(stage); } catch (e) {}
      var cal = $('pg-cal-stage');
      if (cal && window.PGLanding.mountDemo) {
        var go = function () { try { window.PGLanding.mountDemo(cal); } catch (e) {} };
        if (window.IntersectionObserver) {
          var io = new IntersectionObserver(function (en) { if (en[0].isIntersecting) { io.disconnect(); go(); } }, { rootMargin: '400px 0px' });
          io.observe(cal);
        } else go();
      }
      var ax = document.querySelector('.lp-axes');
      if (ax && window.PGLanding.mountAxes) { try { window.PGLanding.mountAxes(ax); } catch (e) {} }
      try { window.PGLanding.mountScroll(lp); } catch (e) {}
    } else if (n < 60) {
      setTimeout(function () { mount(n + 1); }, 100);
    }
  }
  mount(0);
})();
