'use strict';

  // ── Bootstrap ───────────────────────────────────────────────────────────────
  window.addEventListener('DOMContentLoaded', () => {
    ThemeManager.init();
    FontScaleManager.init();
    HeaderManager.init();
    if (typeof AppleSelect !== 'undefined') {
      AppleSelect.init();
    }

    let ready = false;
    let pollWails = null;
    let fallbackTimer = null;

    const startApp = async () => {
      if (ready) return;
      ready = true;
      if (pollWails) clearInterval(pollWails);
      if (fallbackTimer) clearTimeout(fallbackTimer);
      HeaderManager.update();
      await I18n.init();
      initFooterVersion();
      ProfileManager.init();
      RecenterManager.init();
      SetupWizard.init();
      HelpManager.init();
      SettingsManager.init();
      AppleCloseDialog.init();
      if (typeof AppleSelect !== 'undefined') {
        AppleSelect.init();
      }
      WelcomeManager.init();
      CalibrationWizard.init();
      AppState.init();
      HeaderManager.update();
      if (typeof NetSparkline !== 'undefined') NetSparkline.render();
      ResourceMonitor.init();
      await WelcomeManager.checkFirstLaunch();
    };

    pollWails = setInterval(() => {
      if (window.go && window.go.app && window.go.app.App) {
        startApp();
      }
    }, 40);

    fallbackTimer = setTimeout(startApp, 1500);
  });
