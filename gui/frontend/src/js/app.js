'use strict';

  // ── Three.js 3D Viewport (Apple Keynote Studio Showcase - Nintendo Gamepad) ──
  const Scene3D = {
    activeScenes: {},
    cachedModel: null,
    loadPromise: null,

    // Preloads and returns the cached centered gamepad model template
    loadGamepadModel() {
      if (this.cachedModel) return Promise.resolve(this.cachedModel);
      if (this.loadPromise) return this.loadPromise;

      this.loadPromise = new Promise((resolve, reject) => {
        if (!window.THREE || !window.THREE.GLTFLoader) {
          const err = new Error('GLTFLoader is not loaded');
          console.error(err);
          reject(err);
          return;
        }

        const loader = new THREE.GLTFLoader();
        loader.load(
          'assets/models/gamepad.glb',
          (gltf) => {
            const raw = gltf.scene;

            // 1. Orient model FIRST: rotate -90 degrees around Y so grips point toward camera (+Z)
            raw.rotation.y = -Math.PI * 0.5;
            raw.updateMatrixWorld(true);

            // 2. Scale to fit viewport heroically (~2.05 units wide)
            const box = new THREE.Box3().setFromObject(raw);
            const size = box.getSize(new THREE.Vector3());
            const maxDim = Math.max(size.x, size.y, size.z) || 1;
            const targetScale = 2.05 / maxDim;
            raw.scale.set(targetScale, targetScale, targetScale);
            raw.updateMatrixWorld(true);

            // 3. Center geometry precisely at origin (0, 0, 0) in world space
            const finalBox = new THREE.Box3().setFromObject(raw);
            const center = finalBox.getCenter(new THREE.Vector3());
            raw.position.sub(center);

            const wrapper = new THREE.Group();
            wrapper.add(raw);
            this.cachedModel = wrapper;
            resolve(wrapper);
          },
          undefined,
          (err) => {
            console.error('Failed to load assets/models/gamepad.glb:', err);
            reject(err);
          }
        );
      });

      return this.loadPromise;
    },

    updateTheme(theme) {
      Object.values(this.activeScenes).forEach(s => {
        if (s && s.applyTheme) s.applyTheme(theme);
      });
    },

    mount(canvasId, options = {}) {
      if (!window.THREE) {
        console.error('Three.js is not loaded');
        return null;
      }
      const canvas = document.getElementById(canvasId);
      if (!canvas) return null;

      if (this.activeScenes[canvasId]) {
        this.activeScenes[canvasId].destroy();
        delete this.activeScenes[canvasId];
      }

      const THREE = window.THREE;
      const isDark = () => document.documentElement.getAttribute('data-theme') !== 'light';

      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

      const scene = new THREE.Scene();

      // Apple Studio Keynote Lighting Themes
      // Controller color is classic Nintendo dark charcoal gray (0x282a30) across both themes
      const THEME_LIGHTING = {
        dark: {
          ambientIntensity: 0.85,
          keyIntensity: 1.25,
          fillColor: 0x8eb6ff,
          fillIntensity: 0.45,
          rimColor: 0x007aff,   // Vibrant Apple electric-blue rim accent on dark background
          rimIntensity: 0.85,
          bounceIntensity: 0.25,
        },
        light: {
          ambientIntensity: 0.95,
          keyIntensity: 1.15,
          fillColor: 0xc8ddff,
          fillIntensity: 0.40,
          rimColor: 0x409cff,   // Subtle sky-blue rim accent on light studio background
          rimIntensity: 0.50,
          bounceIntensity: 0.20,
        }
      };

      const curPreset = isDark() ? THEME_LIGHTING.dark : THEME_LIGHTING.light;

      // Camera: centered on gamepad (0, 0, 0), slightly elevated looking down (~22° angle)
      // Low FOV (27°) and zoomed out ~2x (orbitHRadius = 7.6, orbitY = 3.2)
      const camera = new THREE.PerspectiveCamera(27, 1, 0.2, 50);
      const camTarget = new THREE.Vector3(0, 0, 0);
      const orbitHRadius = 7.6;
      const orbitY = 3.2;
      let currentCamAngle = 0;

      camera.position.set(camTarget.x, orbitY, camTarget.z + orbitHRadius);
      camera.lookAt(camTarget);

      // Studio Lighting
      const ambLight = new THREE.AmbientLight(0xffffff, curPreset.ambientIntensity);
      scene.add(ambLight);

      // Key light: main top-front-right highlight
      const mainLight = new THREE.DirectionalLight(0xffffff, curPreset.keyIntensity);
      mainLight.position.set(3, 7, 4);
      scene.add(mainLight);

      // Fill light: soft cool fill
      const fillLight = new THREE.DirectionalLight(curPreset.fillColor, curPreset.fillIntensity);
      fillLight.position.set(-3, 5, 3);
      scene.add(fillLight);

      // Bounce light: underside definition
      const bounceLight = new THREE.DirectionalLight(0x3a455a, curPreset.bounceIntensity);
      bounceLight.position.set(0, -4, 2);
      scene.add(bounceLight);

      // Rim light: edge silhouette sculpting
      const rimLight = new THREE.DirectionalLight(curPreset.rimColor, curPreset.rimIntensity);
      rimLight.position.set(-2.5, 4.5, -4);
      scene.add(rimLight);

      // High-precision symmetrical grid floor with visible circular radial fading (затухание по кругу)
      function createRadialGridTexture(isDarkMode) {
        const size = 1024;
        const center = size / 2; // 512
        const step = 64; // 8 divisions each side, exactly divides 512!
        const cvs = document.createElement('canvas');
        cvs.width = size;
        cvs.height = size;
        const ctx = cvs.getContext('2d');

        // 1. Draw regular grid lines strictly symmetrically from center
        ctx.strokeStyle = isDarkMode ? 'rgba(148, 163, 184, 0.38)' : 'rgba(100, 116, 139, 0.42)';
        ctx.lineWidth = 1.8;

        ctx.beginPath();
        for (let offset = step; offset < center; offset += step) {
          ctx.moveTo(center + offset, 0); ctx.lineTo(center + offset, size);
          ctx.moveTo(center - offset, 0); ctx.lineTo(center - offset, size);
          ctx.moveTo(0, center + offset); ctx.lineTo(size, center + offset);
          ctx.moveTo(0, center - offset); ctx.lineTo(size, center - offset);
        }
        ctx.stroke();

        // 2. Draw the exact center axes passing directly through origin (0, 0)
        ctx.strokeStyle = isDarkMode ? 'rgba(56, 189, 248, 0.65)' : 'rgba(2, 132, 199, 0.65)';
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.moveTo(center, 0); ctx.lineTo(center, size);
        ctx.moveTo(0, center); ctx.lineTo(size, center);
        ctx.stroke();

        // 3. Apply pronounced circular radial fade mask (clearly visible in camera viewport)
        ctx.globalCompositeOperation = 'destination-in';
        const grad = ctx.createRadialGradient(center, center, 0, center, center, center * 0.72);
        grad.addColorStop(0.0, 'rgba(0,0,0,1)');
        grad.addColorStop(0.20, 'rgba(0,0,0,0.95)');
        grad.addColorStop(0.48, 'rgba(0,0,0,0.55)');
        grad.addColorStop(0.72, 'rgba(0,0,0,0.18)');
        grad.addColorStop(0.90, 'rgba(0,0,0,0.02)');
        grad.addColorStop(1.0, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, size, size);

        const tex = new THREE.CanvasTexture(cvs);
        tex.anisotropy = 4;
        return tex;
      }

      let gridTex = createRadialGridTexture(isDark());
      const gridMat = new THREE.MeshBasicMaterial({
        map: gridTex,
        transparent: true,
        depthWrite: false,
        opacity: isDark() ? 0.85 : 0.75
      });
      // 6.4 x 6.4 plane: circular fade boundary (radius ~2.3 units) is 100% visible inside viewport without clipping
      const gridFloor = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 6.4), gridMat);
      gridFloor.rotation.x = -Math.PI / 2;
      gridFloor.position.y = -0.65;
      scene.add(gridFloor);

      // Gamepad Group: the single interactive hero object in the scene
      const gamepadGroup = new THREE.Group();
      scene.add(gamepadGroup);

      // Apple soft-touch frosted ultra-matte material: iconic dark gray Nintendo Switch controller
      const appleGamepadMaterial = new THREE.MeshStandardMaterial({
        color: 0x282a30,        // Classic Nintendo dark charcoal slate
        roughness: 0.92,        // Ultra-matte soft-touch finish
        metalness: 0.0,         // Pure dielectric matte polycarbonate
      });

      // Load or instantiate the 3D gamepad model
      let isModelLoaded = false;
      Scene3D.loadGamepadModel().then((template) => {
        if (!renderer) return; // Scene already destroyed
        const clone = template.clone(true);
        clone.traverse((child) => {
          if (child.isMesh) {
            child.material = appleGamepadMaterial;
            child.castShadow = false;
            child.receiveShadow = false;
          }
        });
        gamepadGroup.add(clone);
        isModelLoaded = true;
      }).catch((err) => {
        console.warn('Fallback: Gamepad model load error, creating fallback mesh:', err);
        const fallbackMesh = new THREE.Mesh(
          new THREE.BoxGeometry(1.6, 0.4, 1.0),
          appleGamepadMaterial
        );
        gamepadGroup.add(fallbackMesh);
        isModelLoaded = true;
      });

      // Runtime State
      let mode = options.mode || 'demo'; // 'demo' | 'live'
      let demoStep = options.demoStep || 0; // 0=rest, 1=pitch, 2=roll
      let animId = null;
      let animTime = 0;
      let liveQuat = new THREE.Quaternion();
      let currentQuat = new THREE.Quaternion();
      let lastQuatStreamTs = 0;
      let activeMatrix = null;

      let curW = 0;
      let curH = 0;
      function resize() {
        if (!canvas.parentElement) return;
        const w = Math.floor(canvas.parentElement.clientWidth);
        const h = Math.floor(canvas.parentElement.clientHeight);
        if (w <= 0 || h <= 0) return;
        if (Math.abs(w - curW) < 2 && Math.abs(h - curH) < 2) return;
        curW = w;
        curH = h;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      }

      const resizeObs = new ResizeObserver(resize);
      resizeObs.observe(canvas.parentElement);
      resize();

      function animate() {
        animId = requestAnimationFrame(animate);
        animTime += 0.024;

        if (mode === 'demo') {
          if (demoStep === 0) {
            // Step 0: Rest / Stillness (Покой на столе) — camera completely stationary
            currentCamAngle = 0;
            gamepadGroup.quaternion.set(0, 0, 0, 1);
          } else {
            // Camera slowed down by 1.5x (0.35 / 1.5 = 0.2333)
            const targetCamAngle = Math.sin(animTime * 0.2333) * (Math.PI * 0.25);
            currentCamAngle += (targetCamAngle - currentCamAngle) * 0.04;

            // Demo gesture animation
            const cycle = (Math.sin(animTime * 2.2) + 1) / 2; // 0..1
            const ease = cycle * cycle * (3 - 2 * cycle);

            if (demoStep === 1) {
              // Step 1: Tilt forward (Pitch / "Кивни")
              gamepadGroup.quaternion.setFromEuler(new THREE.Euler(-0.45 * ease, 0, 0, 'XYZ'));
            } else if (demoStep === 2) {
              // Step 2: Bank sideways (Roll / "Самолётик")
              gamepadGroup.quaternion.setFromEuler(new THREE.Euler(0, 0, -0.45 * ease, 'XYZ'));
            } else if (demoStep === 3) {
              // Step 3: Axis alignment — smooth hold-to-hold tumble through combined
              // pitch+yaw+roll, pausing briefly at each hold, looping forever.
              //
              // Pure nod/bank (pitch+roll only, no yaw/twist) was tried first and is a
              // real dead end, not just a style choice: tilting about axes confined to
              // a single plane leaves the accelerometer's third axis mathematically
              // undetermined — d(gravity)/dt = h·(ω×g) can't observe it, so the
              // physics in sensoralign.go ties forever between two candidate mappings
              // and never locks (reproduced in gui/sensoralign_test.go-style
              // simulation: pure pitch/roll motion never converges; the same motion
              // with a twist mixed in locks almost immediately). So every hold below
              // combines pitch, yaw AND roll — never a pure single-axis tilt — and the
              // model interpolates directly hold→hold (no snap back through a common
              // "flat" pose) so the transition itself stays a single smooth motion.
              const holds = [
                [ 0.00,  0.00,  0.00],
                [-0.35,  0.24,  0.14],
                [ 0.18, -0.30, -0.28],
                [ 0.30,  0.16,  0.26],
                [-0.20, -0.26,  0.11],
                [ 0.12,  0.32, -0.22]
              ];
              const holdTime = 0.9, moveTime = 1.1, legTime = holdTime + moveTime;
              const cycle = holds.length * legTime;
              const t = animTime % cycle;
              const leg = Math.floor(t / legTime);
              const legT = (t % legTime) / legTime;
              const moveFrac = moveTime / legTime;
              const u = Math.min(1, legT / moveFrac); // 0..1 during the move phase, pinned at 1 during hold
              const ease = u * u * (3 - 2 * u);
              const from = holds[leg];
              const to = holds[(leg + 1) % holds.length];
              const px = from[0] + (to[0] - from[0]) * ease;
              const py = from[1] + (to[1] - from[1]) * ease;
              const rz = from[2] + (to[2] - from[2]) * ease;
              gamepadGroup.quaternion.setFromEuler(new THREE.Euler(px, py, rz, 'XYZ'));
            }
          }
        } else {
          // Smoothly glide camera back to neutral center in live mode
          currentCamAngle += (0 - currentCamAngle) * 0.04;

          // Live motion tracking: 1:1, без сглаживания (как в "теме" и PadTest)
          currentQuat.copy(liveQuat);
          gamepadGroup.quaternion.copy(currentQuat);
        }

        // Apply orbit camera position
        const camX = camTarget.x + Math.sin(currentCamAngle) * orbitHRadius;
        const camZ = camTarget.z + Math.cos(currentCamAngle) * orbitHRadius;
        camera.position.set(camX, orbitY, camZ);
        camera.lookAt(camTarget);

        renderer.render(scene, camera);
      }
      animate();

      function applyThemeMaterials(theme) {
        const p = (theme === 'light') ? THEME_LIGHTING.light : THEME_LIGHTING.dark;
        ambLight.intensity = p.ambientIntensity;
        mainLight.intensity = p.keyIntensity;
        fillLight.color.setHex(p.fillColor);
        fillLight.intensity = p.fillIntensity;
        rimLight.color.setHex(p.rimColor);
        rimLight.intensity = p.rimIntensity;
        bounceLight.intensity = p.bounceIntensity;
        if (gridTex) gridTex.dispose();
        gridTex = createRadialGridTexture(theme === 'dark');
        gridMat.map = gridTex;
        gridMat.opacity = (theme === 'dark') ? 0.75 : 0.65;
        gridMat.needsUpdate = true;
      }

      const instance = {
        applyTheme(theme) {
          applyThemeMaterials(theme);
        },
        setMode(newMode, step = 0) {
          mode = newMode;
          demoStep = step;
          animTime = 0;
        },
        setMatrix(mat) {
          activeMatrix = mat;
        },
        resetQuat() {
          liveQuat.set(0, 0, 0, 1);
          currentQuat.set(0, 0, 0, 1);
          gamepadGroup.quaternion.set(0, 0, 0, 1);
        },
        // 60 Hz orientation stream ("ahrs:quat"): the full app state only
        // arrives at 15 Hz, which made live previews visibly step.
        updateQuat(q0, q1, q2, q3) {
          if (mode !== 'live') return;
          if ([q0, q1, q2, q3].some(v => typeof v !== 'number' || isNaN(v))) return;
          if (q0 === 0 && q1 === 0 && q2 === 0 && q3 === 0) return;
          lastQuatStreamTs = performance.now();
          liveQuat.set(q1, q2, q3, q0);
          liveQuat.normalize();
        },
        updateFromState(state) {
          if (mode !== 'live' || !state) return;
          // The 60 Hz stream is newer than any 15 Hz state snapshot; only fall
          // back to the snapshot when the stream is not arriving.
          if (performance.now() - lastQuatStreamTs < 250) return;

          const q0 = Number(state.ahrsQ0);
          const q1 = Number(state.ahrsQ1);
          const q2 = Number(state.ahrsQ2);
          const q3 = Number(state.ahrsQ3);

          if (!isNaN(q0) && !isNaN(q1) && !isNaN(q2) && !isNaN(q3) &&
              (q0 !== 0 || q1 !== 0 || q2 !== 0 || q3 !== 0)) {
            // Кадр AHRS = кадр three.js (X вправо, Y вверх, Z на зрителя) -- кладём
            // как есть, без ремапа, ровно как в песочнице "тема" (см. gui/ahrs.go).
            liveQuat.set(q1, q2, q3, q0);
            liveQuat.normalize();
          }
        },
        destroy() {
          if (animId) {
            cancelAnimationFrame(animId);
            animId = null;
          }
          if (gridTex) gridTex.dispose();
          if (gridMat) gridMat.dispose();
          resizeObs.disconnect();
          renderer.dispose();
        }
      };

      this.activeScenes[canvasId] = instance;
      return instance;
    },

    get(canvasId) {
      return this.activeScenes[canvasId] || null;
    },

    destroy(canvasId) {
      if (this.activeScenes[canvasId]) {
        this.activeScenes[canvasId].destroy();
        delete this.activeScenes[canvasId];
      }
    }
  };

  // ── Calibration Wizard Controller ───────────────────────────────────────────
  const CalibrationWizard = {
    targetSlot: 0,
    isOpen: false,
    initialized: false,
    isTransitioning: false,
    currentScreen: 'slots', // 'slots' | 'capture' | 'confirm' | 'manual' | 'save'
    captureStep: 0,         // 0=rest, 1=pitch, 2=roll
    capturedVectors: [],    // [[ux, uy, uz], [rx, ry, rz], [fx, fy, fz]]
    lockedAxes: {},         // { [axisIdx]: { role: 'up'|'pitch'|'roll', name: '+Y', confidence: 0.98 } }
    builtMatrix: null,
    isCapturing: false,
    timerInterval: null,
    selectedIcon: 'default',
    isSaveDropdownOpen: false,

    STEPS_CONFIG: [
      {
        titleKey: 'calibration.step0_title',
        descKey: 'calibration.step0_desc',
        captionKey: 'calibration.step0_caption',
        btnKey: 'calibration.step0_btn',
        durationMs: 1600,
        isRest: true
      },
      {
        titleKey: 'calibration.step1_title',
        descKey: 'calibration.step1_desc',
        captionKey: 'calibration.step1_caption',
        btnKey: 'calibration.step1_btn',
        durationMs: 2400,
        isRest: false
      },
      {
        titleKey: 'calibration.step2_title',
        descKey: 'calibration.step2_desc',
        captionKey: 'calibration.step2_caption',
        btnKey: 'calibration.step2_btn',
        durationMs: 2400,
        isRest: false
      },
      {
        titleKey: 'calibration.step3_title',
        descKey: 'calibration.step3_desc',
        captionKey: 'calibration.step3_caption',
        btnKey: 'calibration.step3_btn',
        isAxisAlign: true
      }
    ],

    // Polling handle for the axis-alignment step (GetAxisAlignStatus)
    axisAlignInterval: null,
    axisAlignKnown: false,

    getConnectedDevice() {
      const st = (typeof AppState !== 'undefined' && AppState.lastState) ? AppState.lastState : null;
      if (st && st.deviceName && st.deviceName !== 'Controller' && st.deviceName !== 'Unknown') {
        return st.deviceName;
      }
      // No real name reported (a USB device's TYPE=0x02 frame is optional):
      // "iPhone" is a reasonable phone-mode fallback, but would be actively
      // wrong for an unnamed USB device -- let SaveProfile's own "Unknown"
      // default stand for that case instead of guessing a device it isn't.
      if (typeof AppState !== 'undefined' && AppState.inputMode === 'usb') {
        return (st && st.deviceName) || '';
      }
      return (st && st.deviceName) || 'iPhone';
    },

    updateSubtitleWithDevice() {
      const connectedDev = this.getConnectedDevice();
      const subEl = document.getElementById('cal-modal-subtitle');
      if (subEl) {
        if (connectedDev && connectedDev !== 'Unknown') {
          subEl.textContent = (I18n.t('calibration.subtitle_device') || 'Настройка соответствия осей • {device}').replace('{device}', connectedDev);
        } else {
          subEl.textContent = I18n.t('calibration.subtitle');
        }
      }
    },

    isDisconnectAlertActive: false,
    wasInterruptedByDisconnect: false,

    showDisconnectAlert() {
      if (!this.isOpen || this.isDisconnectAlertActive) return;
      if (SettingsManager.currentSettings && SettingsManager.currentSettings.disconnectAlert === false) return;
      this.isDisconnectAlertActive = true;

      // Add subtle Apple red outline to the modal card only
      const modalEl = document.querySelector('.cal-modal');
      if (modalEl) {
        modalEl.classList.add('cal-modal-disconnected');
        modalEl.scrollTop = 0;
      }

      // If active capture was running, abort countdown/recording safely
      if (this.isCapturing) {
        this.wasInterruptedByDisconnect = true;
        this.isCapturing = false;
        this._resetCaptureTimer();
        this._resetCaptureUI();
        if (window.go?.main?.App) {
          window.go.main.App.StopCapture(this.captureStep).catch(() => {});
        }
      }

      const alertOverlay = document.getElementById('cal-disconnect-overlay');
      if (alertOverlay) {
        alertOverlay.style.display = 'flex';
      }

      if (typeof SoundManager !== 'undefined') {
        SoundManager.play('disconnect');
      }
    },

    hideDisconnectAlert() {
      if (!this.isDisconnectAlertActive) return;
      this.isDisconnectAlertActive = false;

      const modalEl = document.querySelector('.cal-modal');
      if (modalEl) {
        modalEl.classList.remove('cal-modal-disconnected');
      }
      document.body.classList.remove('cal-disconnect-window-alert');

      const alertOverlay = document.getElementById('cal-disconnect-overlay');
      if (alertOverlay) {
        alertOverlay.style.display = 'none';
      }

      if (typeof SoundManager !== 'undefined') {
        SoundManager.play('connect');
      }

      if (this.wasInterruptedByDisconnect) {
        this.wasInterruptedByDisconnect = false;
        const toastMsg = I18n.t('calibration.disconnect_reconnected_toast') || 'Телефон подключен. Нажмите «Запись», чтобы повторить шаг.';
        if (typeof showToast === 'function') {
          showToast(toastMsg);
        }
        this._resetCaptureUI();
      }
    },

    open() {
      if (typeof AppState !== 'undefined') {
        if (AppState.dismissFirstTimeDeviceAlert) AppState.dismissFirstTimeDeviceAlert();
        if (AppState.hideRecalHint) AppState.hideRecalHint(true);
      }
      this.isOpen = true;
      this.hideDisconnectAlert();
      const overlay = document.getElementById('cal-overlay');
      if (overlay) overlay.style.display = 'flex';
      this.updateSubtitleWithDevice();
      this.showScreen('slots');
      this.renderSlotList();
      if (AppState?.lastState?.status === 'offline') {
        this.showDisconnectAlert();
      }
    },

    openToSlot(slot) {
      if (typeof AppState !== 'undefined') {
        if (AppState.dismissFirstTimeDeviceAlert) AppState.dismissFirstTimeDeviceAlert();
        if (AppState.hideRecalHint) AppState.hideRecalHint(true);
      }
      this.isOpen = true;
      this.hideDisconnectAlert();
      this.targetSlot = slot;
      const overlay = document.getElementById('cal-overlay');
      if (overlay) overlay.style.display = 'flex';
      this.updateSubtitleWithDevice();
      this.startCaptureFlow(slot);
      if (AppState?.lastState?.status === 'offline') {
        this.showDisconnectAlert();
      }
    },

    close() {
      this.isOpen = false;
      this.hideDisconnectAlert();
      const overlay = document.getElementById('cal-overlay');
      if (overlay) overlay.style.display = 'none';
      this._resetCaptureTimer();
      this._stopAxisAlignPoll();
      ['cal-3d-canvas', 'cal-3d-canvas-confirm', 'cal-3d-canvas-manual'].forEach(id => Scene3D.destroy(id));
      this.currentScreen = 'slots';
      if (window.go?.main?.App) {
        window.go.main.App.ClearPreview().catch(() => {});
      }
    },

    showScreen(screen) {
      this.currentScreen = screen;
      const screens = ['cal-screen-slots', 'cal-screen-capture', 'cal-screen-confirm', 'cal-screen-manual', 'cal-screen-save'];
      screens.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = (id === `cal-screen-${screen}`) ? 'block' : 'none';
      });

      if (screen === 'capture') {
        this._updateStepUI();
        Scene3D.mount('cal-3d-canvas', { mode: 'demo', demoStep: this.captureStep });
      } else if (screen === 'confirm') {
        for (let i = 0; i < 5; i++) {
          const pill = document.getElementById(`step-pill-${i}`);
          if (pill) {
            pill.classList.remove('active', 'completed');
            if (i < 4) pill.classList.add('completed');
            else if (i === 4) pill.classList.add('active');
          }
        }
        this._renderConfirmDetails();
        const s = Scene3D.mount('cal-3d-canvas-confirm', { mode: 'live' });
        if (s) {
          if (this.builtMatrix) s.setMatrix(this.builtMatrix);
          s.resetQuat();
        }
        if (window.go?.main?.App) {
          if (this.builtMatrix) {
            window.go.main.App.PreviewMatrix(this.builtMatrix)
              .then(() => this._renderMountCard())
              .catch(() => {});
          } else {
            this._renderMountCard();
          }
          window.go.main.App.ResetAHRS().catch(() => {});
        }
      } else if (screen === 'manual') {
        const s = Scene3D.mount('cal-3d-canvas-manual', { mode: 'live' });
        if (s) s.resetQuat();
        if (window.go?.main?.App) {
          window.go.main.App.ResetAHRS().catch(() => {});
        }
        this._buildManualMatrix();
      } else if (screen === 'save') {
        this._renderSaveScreen();
      }
    },


    renderSlotList() {
      const list = document.getElementById('cal-slot-list');
      if (!list) return;
      list.innerHTML = '';

      for (let i = 0; i < 6; i++) {
        const p = ProfileManager.profiles[i];
        const card = document.createElement('div');
        card.className = 'cal-slot-card' + (p && p.active ? ' active' : '');

        const info = document.createElement('div');
        info.className = 'cal-slot-card-info';

        const numEl = document.createElement('span');
        numEl.className = 'cal-slot-card-num';
        numEl.textContent = formatSlotName(i);

        const nameEl = document.createElement('span');
        nameEl.className = 'cal-slot-card-name';
        nameEl.textContent = (p && p.name) ? p.name : (I18n.t('calibration.slot_empty') || 'Пустой слот');

        info.appendChild(numEl);
        info.appendChild(nameEl);

        const connectedDev = this.getConnectedDevice();
        const pDev = (p && p.device && p.device !== 'Unknown') ? p.device : (p && p.name ? '' : connectedDev);
        if (pDev) {
          const devEl = document.createElement('span');
          devEl.className = 'cal-slot-card-dev';
          devEl.style.fontSize = '11px';
          devEl.style.opacity = '0.6';
          devEl.textContent = (I18n.t('calibration.device_label') || 'Устройство: {device}').replace('{device}', pDev);
          info.appendChild(devEl);
        }
        card.appendChild(info);

        const actions = document.createElement('div');
        actions.className = 'cal-slot-card-actions';

        const btnCal = document.createElement('button');
        btnCal.type = 'button';
        btnCal.className = 'btn-apple-primary cal-btn-sm';
        btnCal.textContent = (p && p.name) ? (I18n.t('calibration.btn_recalibrate') || 'Перекалибровать') : (I18n.t('calibration.btn_calibrate_short') || I18n.t('calibration.btn_calibrate') || 'Калибровать');
        btnCal.addEventListener('click', () => this.startCaptureFlow(i));
        actions.appendChild(btnCal);

        card.appendChild(actions);
        list.appendChild(card);
      }
    },

    startCaptureFlow(slot) {
      this.targetSlot = slot;
      this.captureStep = 0;
      this.capturedVectors = [];
      this.lockedAxes = {};
      this.axisAlignKnown = false;
      this._stopAxisAlignPoll();
      // Calibrating means recalibrating: never trust a mapping learned in a previous
      // session for this slot. Forget it immediately so step 4 always re-earns it from
      // scratch instead of silently reusing (possibly stale/wrong) old data.
      if (window.go?.main?.App) {
        window.go.main.App.StartAxisAlign(true).catch(() => {});
      }
      this.showScreen('capture');
      this.updateTelemetry(AppState.lastState);
    },

    _updateStepUI() {
      const cfg = this.STEPS_CONFIG[this.captureStep];
      if (!cfg) return;
      this._stopAxisAlignPoll();

      // 1. Progress Pills (5 total: Rest, Pitch, Roll, Align, Confirm)
      for (let i = 0; i < 5; i++) {
        const pill = document.getElementById(`step-pill-${i}`);
        if (pill) {
          pill.classList.remove('active', 'completed');
          if (i < this.captureStep) pill.classList.add('completed');
          else if (i === this.captureStep) pill.classList.add('active');
        }
      }

      // 2. Titles and instructions
      const titleEl = document.getElementById('cal-step-title');
      const descEl = document.getElementById('cal-step-desc');
      const captionEl = document.getElementById('cal-3d-caption');

      if (titleEl) titleEl.innerHTML = renderMarkdown(I18n.t(cfg.titleKey));
      if (descEl) descEl.innerHTML = renderMarkdown(I18n.t(cfg.descKey));
      if (captionEl) captionEl.textContent = I18n.t(cfg.captionKey) || '';

      // 3. Reset capture UI
      this._resetCaptureUI();
      this.updateTelemetry(AppState.lastState);

      // 4. Update global forward button in footer: always visible, disabled if step not passed yet
      const btnForward = document.getElementById('cal-capture-forward');
      if (btnForward) {
        btnForward.style.display = 'inline-flex';
        if (this.captureStep === 0) {
          btnForward.textContent = I18n.t('calibration.btn_next') || 'Далее →';
          btnForward.disabled = !this.capturedVectors[0];
        } else if (this.captureStep === 1) {
          btnForward.textContent = I18n.t('calibration.btn_next') || 'Далее →';
          btnForward.disabled = !this.capturedVectors[1];
        } else if (this.captureStep === 2) {
          btnForward.textContent = I18n.t('calibration.btn_next') || 'Далее →';
          btnForward.disabled = !(this.builtMatrix || this.capturedVectors[2]);
        } else if (this.captureStep === 3) {
          btnForward.textContent = I18n.t('calibration.btn_to_confirm') || 'Перейти к проверке →';
          btnForward.disabled = !this.axisAlignKnown;
        }
      }

      // 5. Update 3D scene demo
      const s = Scene3D.get('cal-3d-canvas');
      if (s) s.setMode('demo', this.captureStep);

      // 6. The axis-alignment step has its own live-polling flow instead of a
      // fixed-duration capture (see startAxisAlignSequence / _pollAxisAlign).
      if (cfg.isAxisAlign) {
        this._enterAxisAlignStep();
      }
    },

    _showPhase(phase) {
      const pCapture = document.getElementById('cal-phase-capture');
      const pResult = document.getElementById('cal-phase-result');
      if (phase === 'capture') {
        if (pCapture) {
          pCapture.style.display = 'flex';
          pCapture.classList.remove('fade-in');
          void pCapture.offsetWidth;
          pCapture.classList.add('fade-in');
        }
        if (pResult) pResult.style.display = 'none';
      } else {
        if (pCapture) pCapture.style.display = 'none';
        if (pResult) {
          pResult.style.display = 'flex';
          pResult.classList.remove('fade-in');
          void pResult.offsetWidth;
          pResult.classList.add('fade-in');
        }
      }
    },

    updateTelemetry(state) {
      if (!state) return;
      const vals = [state.rawRotX || 0, state.rawRotY || 0, state.rawRotZ || 0];

      for (let i = 0; i < 3; i++) {
        const capsule = document.getElementById(`axis-capsule-${i}`);
        const tag = document.getElementById(`axis-tag-${i}`);
        const valEl = document.getElementById(`axis-val-${i}`);
        const fillEl = document.getElementById(`axis-fill-${i}`);
        if (!capsule || !tag || !valEl || !fillEl) continue;

        const locked = this.lockedAxes[i];
        if (locked && locked.status === 'predicted') {
          capsule.classList.remove('locked');
          capsule.classList.add('predicted');
          const roleName = I18n.t(`calibration.axis_${locked.role}`) || locked.role;
          const pct = Math.round((locked.confidence || 0.5) * 100);
          const predLabel = (I18n.t('calibration.axis_predicted') || '{n}% • Прогноз').replace('{n}', pct);
          tag.textContent = `~ ${roleName}: ${locked.name}`;
          valEl.textContent = predLabel;
          fillEl.style.width = `${pct}%`;
        } else if (locked) {
          capsule.classList.remove('predicted');
          capsule.classList.add('locked');
          const roleName = I18n.t(`calibration.axis_${locked.role}`) || locked.role;
          tag.textContent = `+ ${roleName}: ${locked.name}`;
          valEl.textContent = `${Math.round((locked.confidence || 0.95) * 100)}%`;
          fillEl.style.width = '100%';
        } else {
          capsule.classList.remove('locked', 'predicted');
          tag.textContent = '—';
          const v = vals[i];
          valEl.textContent = `${v >= 0 ? '+' : ''}${Math.round(v)}°/с`;
          const fillPct = Math.min(100, Math.round((Math.abs(v) / 120) * 100));
          fillEl.style.width = `${fillPct}%`;
        }
      }
    },

    _resetCaptureUI() {
      this.isCapturing = false;
      this._resetCaptureTimer();
      this._showPhase('capture');

      const btnStart = document.getElementById('btn-start-capture');
      const btnText = document.getElementById('btn-capture-text');
      const timerContainer = document.getElementById('cal-timer-container');
      const statusText = document.getElementById('cal-status-text');
      const statusDot = document.getElementById('cal-status-dot');
      const speedBadge = document.getElementById('cal-speed-badge');

      if (timerContainer) timerContainer.style.display = 'none';
      if (speedBadge) speedBadge.style.display = 'none';

      if (statusText) statusText.textContent = I18n.t('calibration.ready') || 'Готов к записи';
      if (statusDot) statusDot.className = 'status-pulse-dot';

      if (btnStart) {
        btnStart.classList.remove('counting-down', 'recording', 'listening');
        btnStart.disabled = false;
      }
      const cfg = this.STEPS_CONFIG[this.captureStep];
      if (btnText && cfg) {
        btnText.textContent = I18n.t(cfg.btnKey);
      }
    },

    _resetCaptureTimer() {
      if (this.timerInterval) {
        clearInterval(this.timerInterval);
        this.timerInterval = null;
      }
    },

    async startCaptureSequence() {
      if (this.isCapturing) return;
      this.isCapturing = true;

      const cfg = this.STEPS_CONFIG[this.captureStep];
      const btnStart = document.getElementById('btn-start-capture');
      const btnText = document.getElementById('btn-capture-text');
      const timerContainer = document.getElementById('cal-timer-container');
      const progressBar = document.getElementById('cal-progress-bar');
      const timerCountdown = document.getElementById('cal-timer-countdown');
      const statusText = document.getElementById('cal-status-text');
      const statusDot = document.getElementById('cal-status-dot');
      const speedBadge = document.getElementById('cal-speed-badge');

      if (btnStart) {
        btnStart.classList.add('counting-down');
        btnStart.disabled = true;
      }

      // 1. Prominent countdown directly on the button: 2.. 1..
      if (statusDot) statusDot.className = 'status-pulse-dot countdown';
      if (statusText) statusText.textContent = I18n.t('calibration.preparing') || 'Приготовьтесь...';

      for (let c = 2; c >= 1; c--) {
        const txt = `${c}...`;
        if (btnText) btnText.textContent = txt;
        await new Promise(r => setTimeout(r, 650));
        if (!this.isCapturing) return;
      }

      // 2. Start recording in Go backend
      if (btnStart) {
        btnStart.classList.remove('counting-down');
        btnStart.classList.add('recording');
        const recText = cfg.isRest
          ? (I18n.t('calibration.btn_recording_rest') || 'ИЗМЕРЕНИЕ ГРАВИТАЦИИ...')
          : (I18n.t('calibration.btn_recording') || 'ИДЁТ ЗАПИСЬ ЖЕСТА...');
        if (btnText) btnText.textContent = recText;
      }

      if (statusText) {
        statusText.textContent = cfg.isRest
          ? (I18n.t('calibration.status_recording_rest') || 'Телефон должен лежать неподвижно...')
          : (I18n.t('calibration.status_recording') || 'Наклоняйте телефон сейчас!');
      }
      if (statusDot) statusDot.className = 'status-pulse-dot active';
      if (timerContainer) timerContainer.style.display = 'block';
      if (speedBadge) speedBadge.style.display = 'inline-block';

      if (window.go?.main?.App) {
        await window.go.main.App.StartCapture();
      }

      const totalDurationMs = cfg.durationMs || 2400;
      const startTime = Date.now();

      this.timerInterval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(100, (elapsed / totalDurationMs) * 100);
        const remaining = Math.max(0, (totalDurationMs - elapsed) / 1000).toFixed(1);

        if (progressBar) progressBar.style.width = `${progress}%`;
        if (timerCountdown) timerCountdown.textContent = `${remaining}с`;

        if (AppState.lastState) {
          const rx = AppState.lastState.rawRotX || 0;
          const ry = AppState.lastState.rawRotY || 0;
          const rz = AppState.lastState.rawRotZ || 0;
          const speed = Math.sqrt(rx*rx + ry*ry + rz*rz);
          if (speedBadge) speedBadge.textContent = `${Math.round(speed)}°/с`;
        }

        if (elapsed >= totalDurationMs) {
          this._resetCaptureTimer();
          this._finishCapture();
        }
      }, 35);
    },

    async _finishCapture() {
      this.isCapturing = false;

      let result = { success: false, errorMsg: I18n.t('calibration.no_signal') || 'Нет соединения' };
      if (window.go?.main?.App) {
        result = await window.go.main.App.StopCapture(this.captureStep);
      }

      const resultIcon = document.getElementById('result-icon');
      const resultTitle = document.getElementById('result-title');
      const resultSubtext = document.getElementById('result-subtext');
      const btnNext = document.getElementById('btn-next-step');
      const btnRetry = document.getElementById('btn-retry-step');
      const btnForward = document.getElementById('cal-capture-forward');

      if (result.success) {
        if (this.captureStep === 0) {
          this.capturedVectors[0] = [0, 0, 0];
          if (resultIcon) {
            resultIcon.textContent = '✓';
            resultIcon.className = 'result-badge-icon success';
          }
          if (resultTitle) {
            resultTitle.textContent = I18n.t('calibration.capture_success_title') || 'Покой зафиксирован!';
          }
          if (resultSubtext) {
            resultSubtext.innerHTML = '';
          }
          if (btnNext) {
            btnNext.style.display = 'inline-flex';
            btnNext.textContent = I18n.t('calibration.btn_next_step') || 'Следующий шаг →';
          }
          if (btnForward) {
            btnForward.style.display = 'inline-flex';
            btnForward.textContent = I18n.t('calibration.btn_next') || 'Далее →';
            btnForward.disabled = false;
          }
          if (btnRetry) {
            btnRetry.textContent = I18n.t('calibration.btn_retry') || 'Повторить';
          }
          this._showPhase('result');
          return;
        }

        if (this.captureStep === 1) {
          this.capturedVectors[1] = result.vector;
          this.lockedAxes[result.axisIdx] = {
            role: 'pitch',
            name: result.axisName,
            confidence: result.confidence,
            status: 'locked'
          };
          this.updateTelemetry(AppState.lastState);

          if (resultIcon) {
            resultIcon.textContent = '✓';
            resultIcon.className = 'result-badge-icon success';
          }
          if (resultTitle) {
            resultTitle.textContent = I18n.t('calibration.capture_success_title') || 'Жест успешно распознан!';
          }
          if (resultSubtext) {
            const pct = Math.round((result.confidence || 0.95) * 100);
            const spd = Math.round(result.peakSpeed || 80);
            const tmpl = I18n.t('calibration.res_gesture') || 'Ось: **{axis}** • Точность: **{pct}%** • Скорость: **{spd}°/с**';
            resultSubtext.innerHTML = renderMarkdown(tmpl.replace('{axis}', result.axisName).replace('{pct}', pct).replace('{spd}', spd));
          }
          if (btnNext) {
            btnNext.style.display = 'inline-flex';
            btnNext.textContent = I18n.t('calibration.btn_next_step') || 'Следующий шаг →';
          }
          if (btnForward) {
            btnForward.style.display = 'inline-flex';
            btnForward.textContent = I18n.t('calibration.btn_next') || 'Далее →';
            btnForward.disabled = false;
          }
          if (btnRetry) {
            btnRetry.textContent = I18n.t('calibration.btn_retry') || 'Повторить';
          }
          this._showPhase('result');
          return;
        }

        // Step 2 (Roll) completed: we have both Pitch and Roll, run validation!
        if (this.captureStep === 2) {
          this.capturedVectors[2] = result.vector;
          this.lockedAxes[result.axisIdx] = {
            role: 'roll',
            name: result.axisName,
            confidence: result.confidence,
            status: 'locked'
          };
          this.updateTelemetry(AppState.lastState);

          let valRes = { success: true };
          if (window.go?.main?.App) {
            valRes = await window.go.main.App.ValidateCalibration(
              this.capturedVectors[1], // Pitch
              this.capturedVectors[2]  // Roll
            );
          }

          if (valRes.success) {
            this.builtMatrix = valRes.matrix;

            // Lock calculated Yaw axis in telemetry strip
            const axes = ['X', 'Y', 'Z'];
            for (let ax = 0; ax < 3; ax++) {
              if (!this.lockedAxes[ax]) {
                const yawName = valRes.yawAxis || `+${axes[ax]}`;
                this.lockedAxes[ax] = {
                  role: 'yaw',
                  name: yawName,
                  confidence: 1.0,
                  status: 'locked'
                };
              }
            }
            this.updateTelemetry(AppState.lastState);

            if (resultIcon) {
              resultIcon.textContent = '✓';
              resultIcon.className = 'result-badge-icon success';
            }
            if (resultTitle) {
              resultTitle.textContent = I18n.t('calibration.capture_success_title') || 'Калибровка завершена!';
            }
            if (resultSubtext) {
              const tmpl = I18n.t('calibration.res_all_done') || 'Калибровка завершена: P: **{p}** • Y: **{y}** • R: **{r}**';
              resultSubtext.innerHTML = renderMarkdown(
                tmpl.replace('{p}', valRes.pitchAxis)
                    .replace('{y}', valRes.yawAxis)
                    .replace('{r}', valRes.rollAxis)
              );
            }
            if (btnNext) {
              btnNext.style.display = 'inline-flex';
              btnNext.textContent = I18n.t('calibration.btn_to_confirm') || 'Перейти к проверке →';
            }
            if (btnForward) {
              btnForward.style.display = 'inline-flex';
              btnForward.textContent = I18n.t('calibration.btn_to_confirm') || 'Перейти к проверке →';
              btnForward.disabled = false;
            }
            if (btnRetry) {
              btnRetry.textContent = I18n.t('calibration.btn_retry') || 'Повторить';
            }
            this._showPhase('result');
            return;
          } else {
            if (resultIcon) {
              resultIcon.textContent = '!';
              resultIcon.className = 'result-badge-icon error';
            }
            if (resultTitle) {
              resultTitle.textContent = I18n.t('calibration.capture_fail_title') || 'Ошибка калибровки';
            }
            if (resultSubtext) {
              const errKey = valRes.errorCode ? ('calibration.' + valRes.errorCode) : '';
              const locErr = errKey ? I18n.t(errKey) : '';
              resultSubtext.innerHTML = renderMarkdown((locErr && locErr !== errKey) ? locErr : (valRes.errorMsg || I18n.t('calibration.err_axes_inconsistent') || 'Оси не согласуются друг с другом.'));
            }
            if (btnNext) btnNext.style.display = 'none';
            if (btnRetry) btnRetry.textContent = I18n.t('calibration.btn_retry') || 'Повторить';
            this._showPhase('result');
            return;
          }
        }
      } else {
        if (resultIcon) {
          resultIcon.textContent = '!';
          resultIcon.className = 'result-badge-icon error';
        }
        if (resultTitle) {
          resultTitle.textContent = I18n.t('calibration.capture_fail_title') || 'Движение не распознано';
        }
        if (resultSubtext) {
          const errKey = result.errorCode ? ('calibration.' + result.errorCode) : '';
          const locErr = errKey ? I18n.t(errKey) : '';
          resultSubtext.innerHTML = renderMarkdown((locErr && locErr !== errKey) ? locErr : (result.errorMsg || I18n.t('calibration.err_motion_record') || 'Ошибка записи движения'));
        }
        if (btnNext) btnNext.style.display = 'none';
        if (btnRetry) btnRetry.textContent = I18n.t('calibration.btn_retry') || 'Повторить';
        this._showPhase('result');
      }
    },

    // ── Step 3: Explicit accelerometer↔gyro axis alignment ─────────────────────
    // Unlike steps 0-2 (fixed-duration buffered capture), this step polls the live
    // physics-based aligner (gui/sensoralign.go) while the user keeps tilting the
    // phone, and reports success the moment it locks a confident mapping.

    async _enterAxisAlignStep() {
      this._stopAxisAlignPoll();
      // Deliberately NOT asking the backend for status here: its scratch aligner
      // (wizardAlign) is fed every incoming frame from the moment the wizard opens
      // (startCaptureFlow), so by the time the user reaches this step it can already
      // look "known" purely from Pitch/Roll's own big tilts in steps 1-2 -- before
      // the user has actually done this step once. Always require the real capture;
      // this.axisAlignKnown only turns true from a genuinely completed run of
      // startAxisAlignSequence (or stays false after Retry resets it).
      const btnForward = document.getElementById('cal-capture-forward');
      if (btnForward && this.captureStep === 3) btnForward.disabled = !this.axisAlignKnown;

      if (this.axisAlignKnown) {
        let status = { known: false, pairs: 0, minPairs: 6, mapping: [] };
        if (window.go?.main?.App) {
          try { status = await window.go.main.App.GetAxisAlignStatus(); } catch (e) {}
        }
        this._showAxisAlignResult(true, status, /*alreadyKnown=*/true);
      }
    },

    async startAxisAlignSequence() {
      if (this.isCapturing) return;
      this.isCapturing = true;

      const btnStart = document.getElementById('btn-start-capture');
      const btnText = document.getElementById('btn-capture-text');
      const timerContainer = document.getElementById('cal-timer-container');
      const statusText = document.getElementById('cal-status-text');
      const statusDot = document.getElementById('cal-status-dot');
      const speedBadge = document.getElementById('cal-speed-badge');
      const progressBar = document.getElementById('cal-progress-bar');
      const timerCountdown = document.getElementById('cal-timer-countdown');

      if (btnStart) {
        // A status, not an action: the step listens to your motion by itself.
        btnStart.classList.add('listening');
        btnStart.disabled = true;
      }
      if (btnText) btnText.textContent = I18n.t('calibration.align_recording_btn') || 'СЛУШАЕМ ДВИЖЕНИЯ…';
      if (statusText) statusText.textContent = I18n.t('calibration.align_status_recording') || 'Наклоняйте телефон в разные стороны и замирайте между наклонами';
      if (statusDot) statusDot.className = 'status-pulse-dot active';
      if (timerContainer) timerContainer.style.display = 'block';
      if (speedBadge) speedBadge.style.display = 'inline-block';
      if (progressBar) progressBar.style.width = '0%';

      // Forget any prior, possibly-wrong mapping only on an explicit redo (Retry);
      // a fresh profile has nothing to forget, so this is always safe here.
      if (window.go?.main?.App) {
        await window.go.main.App.StartAxisAlign(true);
      }

      const startTime = Date.now();
      const timeoutMs = 20000;

      this.axisAlignInterval = setInterval(async () => {
        if (!window.go?.main?.App) return;
        let status;
        try { status = await window.go.main.App.GetAxisAlignStatus(); } catch (e) { return; }
        if (!this.isCapturing) return;

        const pct = Math.min(100, Math.round((status.pairs / Math.max(1, status.minPairs)) * 100));
        if (progressBar) progressBar.style.width = `${pct}%`;
        // minPairs is only the minimum: past it the backend keeps collecting until
        // one axis mapping clearly wins. Say so instead of showing "12/6".
        const refining = status.pairs >= status.minPairs;
        if (timerCountdown) {
          timerCountdown.textContent = refining
            ? (I18n.t('calibration.align_counter_refining') || 'уточняем…')
            : `${status.pairs}/${status.minPairs}`;
        }
        if (statusText) {
          statusText.textContent = refining
            ? (I18n.t('calibration.align_status_refining') || 'Данных хватает — уточняем. Сделайте ещё пару движений в других направлениях')
            : (I18n.t('calibration.align_status_recording') || 'Наклоняйте телефон в разные стороны и замирайте между наклонами');
        }

        if (AppState.lastState) {
          const rx = AppState.lastState.rawRotX || 0;
          const ry = AppState.lastState.rawRotY || 0;
          const rz = AppState.lastState.rawRotZ || 0;
          const speed = Math.sqrt(rx*rx + ry*ry + rz*rz);
          if (speedBadge) speedBadge.textContent = `${Math.round(speed)}°/с`;
        }

        if (status.known) {
          this._stopAxisAlignPoll();
          this.isCapturing = false;
          this.axisAlignKnown = true;
          this._showAxisAlignResult(true, status, false);
          return;
        }

        if (Date.now() - startTime >= timeoutMs) {
          this._stopAxisAlignPoll();
          this.isCapturing = false;
          this._showAxisAlignResult(false, status, false);
        }
      }, 200);
    },

    _stopAxisAlignPoll() {
      if (this.axisAlignInterval) {
        clearInterval(this.axisAlignInterval);
        this.axisAlignInterval = null;
      }
    },

    _showAxisAlignResult(success, status, alreadyKnown) {
      const resultIcon = document.getElementById('result-icon');
      const resultTitle = document.getElementById('result-title');
      const resultSubtext = document.getElementById('result-subtext');
      const btnNext = document.getElementById('btn-next-step');
      const btnRetry = document.getElementById('btn-retry-step');
      const btnForward = document.getElementById('cal-capture-forward');

      if (success) {
        if (resultIcon) {
          resultIcon.textContent = '✓';
          resultIcon.className = 'result-badge-icon success';
        }
        if (resultTitle) {
          resultTitle.textContent = alreadyKnown
            ? (I18n.t('calibration.align_already_title') || 'Оси уже определены')
            : (I18n.t('calibration.align_success_title') || 'Оси определены!');
        }
        if (resultSubtext) {
          const mapping = (status.mapping || []).join(', ');
          const tmpl = alreadyKnown
            ? (I18n.t('calibration.align_already_desc') || 'Сохранено ранее: **{mapping}**')
            : (I18n.t('calibration.align_success_desc') || 'Акселерометр совмещён с гироскопом: **{mapping}**');
          resultSubtext.innerHTML = renderMarkdown(tmpl.replace('{mapping}', mapping));
        }
        if (btnNext) {
          btnNext.style.display = 'inline-flex';
          btnNext.textContent = I18n.t('calibration.btn_to_confirm') || 'Перейти к проверке →';
        }
        if (btnForward) {
          btnForward.style.display = 'inline-flex';
          btnForward.textContent = I18n.t('calibration.btn_to_confirm') || 'Перейти к проверке →';
          btnForward.disabled = false;
        }
        if (btnRetry) {
          btnRetry.textContent = I18n.t('calibration.btn_recalibrate_align') || 'Определить заново';
        }
      } else {
        if (resultIcon) {
          resultIcon.textContent = '!';
          resultIcon.className = 'result-badge-icon error';
        }
        if (resultTitle) {
          resultTitle.textContent = I18n.t('calibration.align_fail_title') || 'Не удалось определить оси';
        }
        if (resultSubtext) {
          resultSubtext.innerHTML = renderMarkdown(I18n.t('calibration.align_fail_desc') ||
            'Слишком мало уверенных наклонов. Наклоняйте телефон более резко в разные стороны (вперёд, вбок, по диагонали) и на секунду замирайте между наклонами.');
        }
        if (btnNext) btnNext.style.display = 'none';
        if (btnRetry) btnRetry.textContent = I18n.t('calibration.btn_retry') || 'Повторить';
      }
      this._showPhase('result');
    },

    nextStep() {
      if (this.isTransitioning) return;
      this.isTransitioning = true;
      setTimeout(() => { this.isTransitioning = false; }, 300);

      if (this.captureStep < 3) {
        this.captureStep++;
        this._updateStepUI();
      } else {
        this.showScreen('confirm');
      }
    },

    _det3(m) {
      return m[0][0]*(m[1][1]*m[2][2]-m[1][2]*m[2][1])
           - m[0][1]*(m[1][0]*m[2][2]-m[1][2]*m[2][0])
           + m[0][2]*(m[1][0]*m[2][1]-m[1][1]*m[2][0]);
    },

    _renderConfirmDetails() {
      const axes = ['X', 'Y', 'Z'];
      const m = this.builtMatrix || [[1,0,0],[0,1,0],[0,0,-1]];
      const axisStr = (row) => {
        for (let c = 0; c < 3; c++) {
          if (m[row][c] > 0.5) return `+${axes[c]}`;
          if (m[row][c] < -0.5) return `-${axes[c]}`;
        }
        return '?';
      };

      const chipP = document.getElementById('chip-pitch');
      const chipY = document.getElementById('chip-yaw');
      const chipR = document.getElementById('chip-roll');
      if (chipP) chipP.textContent = `Pitch: ${axisStr(0)}`;
      if (chipY) chipY.textContent = `Yaw: ${axisStr(1)}`;
      if (chipR) chipR.textContent = `Roll: ${axisStr(2)}`;

      const det = this._det3(m);
      const detStatus = document.getElementById('confirm-det-status');
      if (detStatus) {
        detStatus.textContent = (Math.abs(det + 1.0) < 0.05)
          ? I18n.t('calibration.matrix_det_ok')
          : I18n.t('calibration.matrix_det_err');
      }
    },

    _buildManualMatrix() {
      const pitchAxis = parseInt(document.getElementById('man-pitch-axis')?.value || '0', 10);
      const yawAxis   = parseInt(document.getElementById('man-yaw-axis')?.value   || '1', 10);
      const rollAxis  = parseInt(document.getElementById('man-roll-axis')?.value  || '2', 10);
      const pitchInv  = document.getElementById('man-pitch-inv')?.checked ? -1 : 1;
      const yawInv    = document.getElementById('man-yaw-inv')?.checked   ? -1 : 1;
      const rollInv   = document.getElementById('man-roll-inv')?.checked  ? -1 : 1;

      const mat = [[0,0,0],[0,0,0],[0,0,0]];
      mat[0][pitchAxis] = pitchInv; // Row 0 = Pitch (RotX)
      mat[1][yawAxis]   = yawInv;   // Row 1 = Yaw (RotY)
      mat[2][rollAxis]  = rollInv;  // Row 2 = Roll (RotZ)

      const det = this._det3(mat);
      const isValid = (Math.abs(det + 1.0) < 0.05);

      const statusEl = document.getElementById('cal-manual-status-text');
      const dotEl = document.getElementById('cal-manual-dot');
      const nextBtn = document.getElementById('cal-manual-next');

      if (statusEl) {
        statusEl.textContent = isValid
          ? I18n.t('calibration.matrix_det_ok')
          : I18n.t('calibration.manual_invalid');
      }
      if (dotEl) dotEl.className = 'status-dot-sm' + (isValid ? ' ok' : ' error');
      if (nextBtn) nextBtn.disabled = !isValid;

      if (isValid) {
        this.builtMatrix = mat;
        const s = Scene3D.get('cal-3d-canvas-manual');
        if (s) s.setMatrix(mat);
        if (window.go?.main?.App) {
          window.go.main.App.PreviewMatrix(mat).catch(() => {});
        }
      }
    },

    _renderSaveScreen() {
      const slot = this.targetSlot;
      const targetProf = ProfileManager.profiles[slot] || {
        name: formatSlotName(slot),
        device: 'Unknown',
        icon: 'default'
      };

      const connectedDevice = this.getConnectedDevice();
      const finalDevice = (connectedDevice && connectedDevice !== 'Unknown')
        ? connectedDevice
        : (targetProf.device && targetProf.device !== 'Unknown' ? targetProf.device : 'iPhone');

      // 1. Icon Selection: preserve or default to target profile's icon
      if (!this.selectedIcon) {
        this.selectedIcon = targetProf.icon || 'default';
      }
      this._updateIconCards(this.selectedIcon);

      // 2. Trigger Info
      const triggerIcon = document.getElementById('cal-save-trigger-icon');
      const triggerTitle = document.getElementById('cal-save-trigger-title');
      const triggerDevice = document.getElementById('cal-save-trigger-device');
      const triggerBadge = document.getElementById('cal-save-trigger-badge');
      const deviceText = document.getElementById('cal-save-device-text');

      if (triggerIcon) {
        triggerIcon.innerHTML = getProfileIconSVG(targetProf.icon || this.selectedIcon || 'default', 22);
      }
      const slotIsEmpty = !targetProf.name;
      if (triggerTitle) {
        // An empty slot must never read like an existing profile's name (§3: no
        // magic) — it's a slot number plus a clear "new" marker, not a name yet.
        triggerTitle.textContent = slotIsEmpty
          ? `${formatSlotName(slot)} — ${I18n.t('calibration.new_profile_marker') || 'новый профиль'}`
          : targetProf.name;
      }
      const devLabelKey = slotIsEmpty ? 'calibration.device_label_preview' : 'calibration.device_label';
      const devLabelFallback = slotIsEmpty ? 'Устройство при сохранении: {device}' : 'Устройство: {device}';
      const devLabel = (I18n.t(devLabelKey) || devLabelFallback).replace('{device}', finalDevice);
      if (triggerDevice) {
        triggerDevice.textContent = devLabel;
      }
      if (triggerBadge) {
        triggerBadge.textContent = formatSlotName(slot);
      }
      if (deviceText) {
        deviceText.textContent = devLabel;
      }

      // 3. Name Input
      const nameInput = document.getElementById('cal-name-input');
      if (nameInput) {
        const defaultName = (targetProf && targetProf.name && !targetProf.name.startsWith('Слот') && !targetProf.name.startsWith('Slot'))
          ? targetProf.name
          : `${finalDevice} ${slot + 1}`;
        nameInput.value = defaultName;
        setTimeout(() => nameInput.select(), 50);
      }

      // 4. Overwrite Warning Block (Always visible inline warning notice)
      const warnEl = document.getElementById('cal-save-warning');
      const warnText = document.getElementById('cal-save-warning-text');
      if (warnEl) warnEl.style.display = 'flex';
      if (warnText) {
        warnText.textContent = I18n.t('calibration.save_overwrite_note') || 'Внимание: если выбранный слот уже содержит профиль, он будет перезаписан.';
      }

      // 5. Populate Save Dropdown Menu
      const menu = document.getElementById('cal-save-dropdown-menu');
      if (menu) {
        menu.innerHTML = '';
        for (let i = 0; i < 6; i++) {
          const p = ProfileManager.profiles[i] || { name: formatSlotName(i), device: 'Unknown', icon: 'default' };
          const item = document.createElement('button');
          item.type = 'button';
          item.className = 'profile-dropdown-item' + (i === slot ? ' active' : '') + (p.outdated ? ' profile-outdated' : '');
          item.setAttribute('data-slot', String(i));

          const pDev = p.device || I18n.t('calibration.device_unknown') || 'Неизвестно';
          const pDevText = (I18n.t('calibration.device_label') || 'Устройство: {device}').replace('{device}', pDev);
          const pOutdatedBadge = p.outdated
            ? `<span class="profile-outdated-badge">${I18n.t('calibration.outdated_badge') || 'Устарел'}</span>`
            : '';

          item.innerHTML = `
            <div class="profile-item-left">
              <div class="profile-item-icon">
                ${getProfileIconSVG(p.icon || 'default', 20)}
              </div>
              <div class="profile-item-meta">
                <span class="profile-item-title">${p.name || formatSlotName(i)}${pOutdatedBadge}</span>
                <span class="profile-item-sub">${formatSlotName(i)} • ${pDevText}</span>
              </div>
            </div>
            ${i === slot ? '<span class="profile-item-check">✓</span>' : ''}
          `;

          item.addEventListener('click', (e) => {
            e.stopPropagation();
            this.targetSlot = i;
            this.selectedIcon = p.icon || 'default';
            this.closeSaveDropdown();
            this._renderSaveScreen();
          });

          menu.appendChild(item);
        }
      }
    },

    _updateIconCards(iconType) {
      this.selectedIcon = iconType;
      const cards = document.querySelectorAll('.cal-icon-card');
      cards.forEach(card => {
        if (card.getAttribute('data-icon') === iconType) {
          card.classList.add('selected');
        } else {
          card.classList.remove('selected');
        }
      });
      const triggerIcon = document.getElementById('cal-save-trigger-icon');
      if (triggerIcon) {
        triggerIcon.innerHTML = getProfileIconSVG(iconType, 22);
      }
    },

    toggleSaveDropdown() {
      if (this.isSaveDropdownOpen) {
        this.closeSaveDropdown();
      } else {
        this.openSaveDropdown();
      }
    },

    openSaveDropdown() {
      this.isSaveDropdownOpen = true;
      const trigger = document.getElementById('cal-save-dropdown-trigger');
      const menu = document.getElementById('cal-save-dropdown-menu');
      const wrap = document.getElementById('cal-save-dropdown-wrap');
      if (trigger) trigger.classList.add('open');
      if (wrap) wrap.classList.add('open');
      if (menu) {
        menu.classList.add('show');
        setTimeout(() => {
          menu.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }, 50);
      }
    },

    closeSaveDropdown() {
      this.isSaveDropdownOpen = false;
      const trigger = document.getElementById('cal-save-dropdown-trigger');
      const menu = document.getElementById('cal-save-dropdown-menu');
      const wrap = document.getElementById('cal-save-dropdown-wrap');
      if (trigger) trigger.classList.remove('open');
      if (wrap) wrap.classList.remove('open');
      if (menu) menu.classList.remove('show');
    },

    retryCurrentStep() {
      // 1. Clear recorded vector for current step
      this.capturedVectors[this.captureStep] = null;

      // 2. Clear locked axis corresponding to this step
      if (this.captureStep === 0) {
        // Rest: no axis locked
      } else if (this.captureStep === 1) {
        // Pitch: remove pitch locked axis
        for (const k in this.lockedAxes) {
          if (this.lockedAxes[k].role === 'pitch') {
            delete this.lockedAxes[k];
          }
        }
      } else if (this.captureStep === 2) {
        // Roll: remove roll and computed yaw
        for (const k in this.lockedAxes) {
          if (this.lockedAxes[k].role === 'roll' || this.lockedAxes[k].role === 'yaw') {
            delete this.lockedAxes[k];
          }
        }
        this.builtMatrix = null;
      } else if (this.captureStep === 3) {
        // Axis alignment: forget the wrong guess and start a fresh determination
        this.axisAlignKnown = false;
        this._stopAxisAlignPoll();
        if (window.go?.main?.App) {
          window.go.main.App.StartAxisAlign(true).catch(() => {});
        }
      }

      // 3. Reset step pill: active, remove completed
      const pill = document.getElementById(`step-pill-${this.captureStep}`);
      if (pill) {
        pill.classList.remove('completed');
        pill.classList.add('active');
      }

      // 4. Disable forward button in footer
      const btnForward = document.getElementById('cal-capture-forward');
      if (btnForward) {
        btnForward.disabled = true;
      }

      // 5. Reset capture controls and update telemetry
      this._resetCaptureUI();
      this.updateTelemetry(AppState.lastState);
    },

    // Поправка на наклон установки датчика (только USB): бэкенд считает её в
    // PreviewMatrix по покою + жесту «вперёд»; здесь только показать и дать выключить.
    async _renderMountCard() {
      const card = document.getElementById('cal-mount-card');
      if (!card) return;
      let m = null;
      try { m = await window.go?.main?.App?.GetWizardMount(); } catch (e) {}
      if (!m) {
        card.style.display = 'none';
        return;
      }
      const signed = (v) => (v >= 0 ? '+' : '') + v.toFixed(1) + '°';
      const text = I18n.t('calibration.mount_' + m.status)
        .replace('{tilt}', m.tiltDeg.toFixed(1))
        .replace('{fwd}', signed(m.forwardDeg))
        .replace('{right}', signed(m.rightDeg))
        .replace('{check}', m.checkDeg.toFixed(1));
      document.getElementById('cal-mount-text').textContent = text;
      const row = document.getElementById('cal-mount-toggle-row');
      if (row) row.style.display = (m.status === 'ok') ? '' : 'none';
      const toggle = document.getElementById('cal-mount-toggle');
      if (toggle) toggle.checked = !!m.enabled;
      card.style.display = '';
    },

    async save() {
      const slot = this.targetSlot;
      const name = document.getElementById('cal-name-input')?.value.trim()
        || formatSlotName(slot);
      const mat = this.builtMatrix;
      if (!mat || slot < 0) return;

      const device = this.getConnectedDevice();
      const icon = this.selectedIcon || 'default';

      if (window.go?.main?.App) {
        const result = await window.go.main.App.SaveProfile(slot, name, device, icon, mat);
        if (result === 'ok') {
          await window.go.main.App.SetActiveProfile(slot);
          this.close();
          const savedMsg = (I18n.t('calibration.profile_saved') || 'Профиль «{name}» успешно сохранён').replace('{name}', name);
          showToast(savedMsg);
        } else {
          showToast(result);
        }
      }
    },

    init() {
      if (this.initialized) return;
      this.initialized = true;

      // Close button
      document.getElementById('cal-close-btn')?.addEventListener('click', () => this.close());
      document.getElementById('btn-cancel-cal-disconnect')?.addEventListener('click', () => this.close());

      // Start Capture button
      document.getElementById('btn-start-capture')?.addEventListener('click', () => {
        if (this.STEPS_CONFIG[this.captureStep]?.isAxisAlign) {
          this.startAxisAlignSequence();
        } else {
          this.startCaptureSequence();
        }
      });

      // Mount tilt correction toggle (confirm screen)
      document.getElementById('cal-mount-toggle')?.addEventListener('change', (e) => {
        window.go?.main?.App?.SetWizardMountEnabled(e.target.checked).catch(() => {});
      });

      // Retry step
      document.getElementById('btn-retry-step')?.addEventListener('click', () => {
        this.retryCurrentStep();
      });

      // Next step
      document.getElementById('btn-next-step')?.addEventListener('click', () => {
        this.nextStep();
      });

      // Capture back: returns to previous step or closes wizard if at step 0
      document.getElementById('cal-capture-back')?.addEventListener('click', () => {
        if (this.isTransitioning) return;
        this._resetCaptureTimer();
        this._stopAxisAlignPoll();
        if (this.captureStep > 0) {
          this.captureStep--;
          this._updateStepUI();
        } else {
          this.close();
        }
      });

      // Capture forward: navigates to next step or confirm screen
      document.getElementById('cal-capture-forward')?.addEventListener('click', () => {
        if (this.isTransitioning) return;
        if (this.captureStep === 2 && !this.builtMatrix && this.capturedVectors[1] && this.capturedVectors[2]) {
          if (window.go?.main?.App) {
            window.go.main.App.ValidateCalibration(this.capturedVectors[1], this.capturedVectors[2]).then(valRes => {
              if (valRes.success) this.builtMatrix = valRes.matrix;
              this.nextStep();
            });
            return;
          }
        }
        if (this.captureStep < 3) {
          this.nextStep();
        } else {
          this.showScreen('confirm');
        }
      });

      // Step pills click navigation
      for (let i = 0; i < 5; i++) {
        const pill = document.getElementById(`step-pill-${i}`);
        if (!pill) continue;
        pill.addEventListener('click', () => {
          if (i === 0) {
            this.captureStep = 0;
            this.showScreen('capture');
          } else if (i === 1) {
            if (this.capturedVectors[0]) {
              this.captureStep = 1;
              this.showScreen('capture');
            }
          } else if (i === 2) {
            if (this.capturedVectors[1]) {
              this.captureStep = 2;
              this.showScreen('capture');
            }
          } else if (i === 3) {
            if (this.builtMatrix || (this.capturedVectors[1] && this.capturedVectors[2])) {
              this.captureStep = 3;
              this.showScreen('capture');
            }
          } else if (i === 4) {
            if (this.builtMatrix || (this.capturedVectors[1] && this.capturedVectors[2])) {
              this.showScreen('confirm');
            }
          }
        });
      }

      // Jump to manual setup
      document.getElementById('cal-jump-manual')?.addEventListener('click', () => {
        this.showScreen('manual');
      });

      // Confirm yes -> save
      document.getElementById('btn-confirm-yes')?.addEventListener('click', () => {
        this.showScreen('save');
      });

      // Confirm no -> manual
      document.getElementById('btn-confirm-no')?.addEventListener('click', () => {
        this.showScreen('manual');
      });

      // Confirm restart
      document.getElementById('btn-confirm-restart')?.addEventListener('click', () => {
        this.startCaptureFlow(this.targetSlot);
      });

      // Confirm back: returns to step 2 (Roll) in capture screen
      document.getElementById('cal-confirm-back')?.addEventListener('click', () => {
        this.captureStep = 2;
        this.showScreen('capture');
      });

      // Recenter 3D orientation (Button, Canvas click, or Space key)
      const doRecenterConfirm = () => {
        if (window.go?.main?.App?.ResetAHRS) {
          window.go.main.App.ResetAHRS().catch(() => {});
        }
        const scConfirm = Scene3D.get('cal-3d-canvas-confirm');
        if (scConfirm && scConfirm.resetQuat) scConfirm.resetQuat();
        const scManual = Scene3D.get('cal-3d-canvas-manual');
        if (scManual && scManual.resetQuat) scManual.resetQuat();
      };

      document.getElementById('btn-confirm-recenter')?.addEventListener('click', doRecenterConfirm);
      document.getElementById('btn-manual-recenter')?.addEventListener('click', doRecenterConfirm);

      window.addEventListener('keydown', (e) => {
        if (e.code === 'Space' && CalibrationWizard.isOpen &&
            (CalibrationWizard.currentScreen === 'confirm' || CalibrationWizard.currentScreen === 'manual')) {
          const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
          if (activeTag !== 'input' && activeTag !== 'textarea') {
            e.preventDefault();
            doRecenterConfirm();
          }
        }
      });

      // Copy Calibration Full Report helper
      const copyCalReportHandler = async (btn) => {
        try {
          let report = '';
          if (window.go?.main?.App?.CopyCalibrationReport) {
            report = await window.go.main.App.CopyCalibrationReport();
          } else if (window['go']?.['main']?.['App']?.['CopyCalibrationReport']) {
            report = await window['go']['main']['App']['CopyCalibrationReport']();
          }
          if (!report) report = 'No calibration report data available';
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(report);
          } else {
            const ta = document.createElement('textarea');
            ta.value = report;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
          }
          if (btn) {
            const orig = btn.textContent;
            btn.textContent = I18n.t('calibration.report_copied') || 'Отчет скопирован!';
            setTimeout(() => { btn.textContent = orig; }, 1800);
          }
          showToast(I18n.t('calibration.report_copied_toast') || 'Полный отчет теста скопирован в буфер обмена!');
        } catch (err) {
          console.error('Copy report failed:', err);
          showToast((I18n.t('calibration.report_copy_err') || 'Ошибка копирования: ') + err);
        }
      };


      // Manual controls changes
      ['man-pitch-axis','man-roll-axis','man-yaw-axis','man-pitch-inv','man-roll-inv','man-yaw-inv'].forEach(id => {
        document.getElementById(id)?.addEventListener('change', () => this._buildManualMatrix());
      });
      document.getElementById('cal-manual-back')?.addEventListener('click', () => {
        this.showScreen('confirm');
      });
      document.getElementById('cal-manual-next')?.addEventListener('click', () => {
        if (this.builtMatrix) this.showScreen('save');
      });

      // Save form
      document.getElementById('cal-save-back')?.addEventListener('click', () => {
        this.showScreen('confirm');
      });
      document.getElementById('btn-do-save')?.addEventListener('click', () => {
        this.save();
      });

      // Save slot dropdown toggle
      document.getElementById('cal-save-dropdown-trigger')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleSaveDropdown();
      });

      // Close save dropdown on outside click
      document.addEventListener('click', (e) => {
        if (!e.target.closest('#cal-save-dropdown-wrap')) {
          this.closeSaveDropdown();
        }
      });

      // Icon selector cards
      document.querySelectorAll('.cal-icon-card').forEach(card => {
        card.addEventListener('click', () => {
          const icon = card.getAttribute('data-icon') || 'default';
          this._updateIconCards(icon);
        });
      });

      // Spacebar to trigger capture when in capture screen
      window.addEventListener('keydown', (e) => {
        if (e.code === 'Space' && this.currentScreen === 'capture' && !this.isCapturing) {
          const activeEl = document.activeElement;
          if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) return;
          e.preventDefault();
          this.startCaptureSequence();
        }
      });
    }
  };

  // ── App State & UI Manager ──────────────────────────────────────────────────
  // ── First connection: centre before playing ────────────────────────────────
  // The first time a device (phone, USB controller) streams in this app session,
  // the centering sheet opens in forced mode: pick the profile and centre, no
  // other way out. Once per input mode per launch — a Wi-Fi blip or a replugged
  // cable does not ask again. Any centering (button, hotkey) counts.
  const FirstCenterGate = {
    done: {},

    mode() {
      return (AppState.lastState && AppState.lastState.inputMode) || AppState.inputMode || 'phone';
    },

    markDone() {
      this.done[this.mode()] = true;
    },

    onState(state) {
      const mode = state.inputMode || 'phone';
      const online = state.status && state.status !== 'offline';
      if (!online) {
        if (RecenterManager.forced) RecenterManager.close(true); // device gone: ask again when it returns
        return;
      }
      if (RecenterManager.forced) {
        RecenterManager.renderPicker(); // profiles may change while it is open
        return;
      }
      if (this.done[mode] || RecenterManager.isOpen) return;
      if (!(state.hz > 0)) return; // wait for real sensor data (e.g. iOS permission)
      if (CalibrationWizard?.isOpen || SetupWizard?.isOpen || HelpManager?.isOpen ||
          SettingsManager?.isOpen || WelcomeManager?.isOpen) return;
      RecenterManager.open({ forced: true });
    }
  };

  const AppState = {
    initialized: false,
    _lastStatus: '',
    _lastIsOffline: null,
    _lastQrCode: '',
    _lastBadgeKey: '',
    _lastPauseState: null,
    lastState: null,
    currentUrl: '',
    _calCaptureCb: null,
    _alertTriggeredForDevice: null,
    _alertTimeout: null,
    _alertActive: false,
    _stillnessStart: 0,
    _lastStillP: 0,
    _lastStillR: 0,
    _recalHintShown: false,
    _recalHintDismissedTs: 0,
    _reconnectCooldownTs: 0,
    _recalHintTimer: null,
    targetPitch: 0,
    targetRoll: 0,
    targetYaw: 0,
    currentPitch: 0,
    currentRoll: 0,
    currentYaw: 0,
    _inclinometerLoopRunning: false,

    startInclinometerLoop() {
      if (this._inclinometerLoopRunning) return;
      this._inclinometerLoopRunning = true;

      const bubble = document.getElementById('gyro-bubble');
      const yawGroup = document.getElementById('gyro-yaw-group');
      const hudStatus = document.getElementById('hud-level-status');
      const maxR = 40.0;

      const step = () => {
        // Pause SVG DOM updates when Settings is open or when device is offline (inclinometer hidden)
        if ((typeof SettingsManager !== 'undefined' && SettingsManager.isOpen) || (this.lastState && this.lastState.status === 'offline')) {
          requestAnimationFrame(step);
          return;
        }

        // Exponential lerp smoothing for 60/120/144Hz buttery smooth fluid movement
        const factor = 0.22;
        this.currentPitch += (this.targetPitch - this.currentPitch) * factor;
        this.currentRoll += (this.targetRoll - this.currentRoll) * factor;

        // Wrap-around shortest angle distance for yaw needle
        let diffYaw = (this.targetYaw - this.currentYaw) % 360;
        if (diffYaw > 180) diffYaw -= 360;
        if (diffYaw < -180) diffYaw += 360;
        this.currentYaw += diffYaw * factor;

        if (bubble && yawGroup) {
          // Pitch: tilt forward (p > 0) -> bubble forward (up, -Y in SVG); tilt backward (p < 0) -> bubble backward (down, +Y)
          const offsetY = Math.max(-maxR, Math.min(maxR, -this.currentPitch * 0.9));
          // Roll: tilt right (r > 0) -> bubble right (+X in SVG); tilt left (r < 0) -> bubble left (-X)
          const offsetX = Math.max(-maxR, Math.min(maxR, this.currentRoll * 0.9));

          bubble.setAttribute('cx', (60 + offsetX).toFixed(2));
          bubble.setAttribute('cy', (60 + offsetY).toFixed(2));

          // Snap to glowing green level state if within 3.0 degrees
          const isLevel = Math.abs(this.currentPitch) <= 3.0 && Math.abs(this.currentRoll) <= 3.0;
          bubble.classList.toggle('level', isLevel);
          if (hudStatus) {
            hudStatus.classList.toggle('level', isLevel);
          }

          // Rotate compass pointer around center (60, 60) with Yaw
          yawGroup.setAttribute('transform', `rotate(${this.currentYaw.toFixed(2)} 60 60)`);
        }

        requestAnimationFrame(step);
      };

      requestAnimationFrame(step);
    },

    findEmptyOrActiveSlot() {
      const profiles = (this.lastState && this.lastState.profiles) || ProfileManager.profiles || [];
      for (let i = 0; i < 6; i++) {
        const p = profiles[i];
        if (!p || !p.name || p.name.startsWith('Слот') || p.name.startsWith('Slot')) {
          return i;
        }
      }
      return (this.lastState && this.lastState.activeSlot >= 0) ? this.lastState.activeSlot : 0;
    },

    checkFirstTimeDeviceAlert(state) {
      const dev = (state.deviceName || '').trim();
      if (!dev || dev === 'Controller' || dev === 'Unknown') {
        return;
      }

      if (this._alertTriggeredForDevice === dev) {
        return;
      }
      this._alertTriggeredForDevice = dev;

      // Check if ANY profile is calibrated for this device
      const profiles = state.profiles || ProfileManager.profiles || [];
      const hasProfile = profiles.some(p => {
        if (!p || !p.name) return false;
        const pDev = (p.device || '').trim().toLowerCase();
        return pDev === dev.toLowerCase() && pDev !== 'unknown';
      });

      if (!hasProfile) {
        this.triggerFirstTimeDeviceAlert(dev);
      }
    },

    triggerFirstTimeDeviceAlert(device) {
      this.clearFirstTimeDeviceAlert(false);
      this._alertActive = true;

      const card = document.querySelector('.apple-card');
      const banner = document.getElementById('first-connect-banner');
      const calBtn = document.getElementById('btn-open-calibration');
      const progressBar = document.getElementById('first-connect-progress-bar');

      if (card) card.classList.add('first-device-alert-active');
      if (calBtn) calBtn.classList.add('highlight-pulse');

      if (banner) {
        banner.classList.remove('fade-out');
        // Force reflow so smooth CSS transition begins from initial state
        void banner.offsetHeight;
        banner.classList.add('show');
        if (progressBar) {
          progressBar.style.transition = 'none';
          progressBar.style.width = '100%';
          void progressBar.offsetWidth;
          // Increased lifetime 2x: 20 seconds
          progressBar.style.transition = 'width 20s linear';
          progressBar.style.width = '0%';
        }
      }

      this._alertTimeout = setTimeout(() => {
        this.dismissFirstTimeDeviceAlert();
      }, 20000); // 20 seconds lifetime (2x previous 10s)
    },

    dismissFirstTimeDeviceAlert() {
      if (!this._alertActive) return;
      this._alertActive = false;
      if (this._alertTimeout) {
        clearTimeout(this._alertTimeout);
        this._alertTimeout = null;
      }

      const card = document.querySelector('.apple-card');
      const banner = document.getElementById('first-connect-banner');
      const calBtn = document.getElementById('btn-open-calibration');

      if (card) card.classList.remove('first-device-alert-active');
      if (calBtn) calBtn.classList.remove('highlight-pulse');
      if (banner) {
        banner.classList.remove('show');
        banner.classList.add('fade-out');
        setTimeout(() => {
          if (!this._alertActive) {
            banner.classList.remove('fade-out');
          }
        }, 700);
      }
    },

    clearFirstTimeDeviceAlert(resetTriggered = true) {
      if (resetTriggered) this._alertTriggeredForDevice = null;
      this.dismissFirstTimeDeviceAlert();
    },

    checkStillnessRecalHint(p, r, state) {
      if (!state || state.status === 'offline' || state.isPaused) {
        this.hideRecalHint(true);
        return;
      }
      if (CalibrationWizard?.isOpen || SetupWizard?.isOpen || HelpManager?.isOpen || SettingsManager?.isOpen || WelcomeManager?.isOpen) {
        this.hideRecalHint(true);
        return;
      }

      // Check if cooldown is active (45 seconds after user dismiss or timeout)
      const now = Date.now();
      if (this._recalHintDismissedTs && (now - this._recalHintDismissedTs < 45000)) {
        return;
      }
      // Check if settling cooldown is active after reconnect or waking from sleep (3.5 seconds)
      if (this._reconnectCooldownTs && (now - this._reconnectCooldownTs < 3500)) {
        return;
      }

      // Calculate angular delta from last frame
      const deltaP = Math.abs(p - this._lastStillP);
      const deltaR = Math.abs(r - this._lastStillR);
      this._lastStillP = p;
      this._lastStillR = r;

      // Stillness threshold: phone resting on desk produces tiny sensor noise (< 0.12 deg)
      const isMotionless = deltaP < 0.12 && deltaR < 0.12;

      if (isMotionless) {
        if (!this._stillnessStart) {
          this._stillnessStart = now;
        } else if (now - this._stillnessStart >= 2200) {
          // Resting motionless for > 2.2s. Check if tilted significantly (> 10 deg)
          const isOffCenter = Math.abs(p) > 10.0 || Math.abs(r) > 10.0;
          if (isOffCenter && !this._recalHintShown) {
            this.showRecalHint();
          }
        }
      } else {
        // Device is being moved
        this._stillnessStart = 0;
        if (this._recalHintShown) {
          this.hideRecalHint(false);
        }
      }
    },

    showRecalHint() {
      if (this._recalHintShown) return;
      if (SettingsManager.currentSettings && SettingsManager.currentSettings.stillnessHint === false) return;
      this._recalHintShown = true;
      const el = document.getElementById('level-recal-hint');
      const calBtn = document.getElementById('btn-open-calibration');
      if (el) {
        el.style.display = 'block';
        void el.offsetHeight;
        el.classList.add('visible');
      }
      if (calBtn) {
        calBtn.classList.add('highlight-pulse');
      }
      if (this._recalHintTimer) clearTimeout(this._recalHintTimer);
      this._recalHintTimer = setTimeout(() => {
        this.hideRecalHint(false);
      }, 10000);
    },

    hideRecalHint(immediate = false) {
      if (!this._recalHintShown && !immediate) return;
      this._recalHintShown = false;
      this._recalHintDismissedTs = Date.now();
      if (this._recalHintTimer) {
        clearTimeout(this._recalHintTimer);
        this._recalHintTimer = null;
      }
      const el = document.getElementById('level-recal-hint');
      const calBtn = document.getElementById('btn-open-calibration');
      if (calBtn && !this._alertActive) {
        calBtn.classList.remove('highlight-pulse');
      }
      if (el) {
        el.classList.remove('visible');
        if (immediate) {
          el.style.display = 'none';
        } else {
          setTimeout(() => {
            if (!this._recalHintShown) {
              el.style.display = 'none';
            }
          }, 350);
        }
      }
    },

    _lastDsuCount: null,
    _lastDsuClientsJson: '',

    updateDSU(count, clients) {
      count = typeof count === 'number' ? count : (Array.isArray(clients) ? clients.length : 0);
      clients = Array.isArray(clients) ? clients : [];
      const clientsJson = JSON.stringify(clients);

      if (this._lastDsuCount === count && this._lastDsuClientsJson === clientsJson) {
        return;
      }
      const prevDsuCount = this._lastDsuCount;
      this._lastDsuCount = count;
      this._lastDsuClientsJson = clientsJson;

      if (prevDsuCount !== null && count > prevDsuCount) {
        if (typeof SoundManager !== 'undefined' && SoundManager.play) {
          SoundManager.play('dsu');
        }
      }

      const isOnline = count > 0;
      const clientWord = isOnline 
        ? (count === 1 ? (I18n.t('status.dsu_connected') || 'Эмулятор подключен') : (I18n.t('status.dsu_connected_plural') || 'Подключено эмуляторов: %d').replace('%d', count))
        : (I18n.t('status.dsu_waiting') || 'Ожидание эмуляторов');

      const updateBanner = (prefix) => {
        const banner = document.getElementById(`${prefix}-dsu-banner`);
        const dot = document.getElementById(`${prefix}-dsu-dot`);
        const chip = document.getElementById(`${prefix}-dsu-chip`);
        const idleRow = document.getElementById(`${prefix}-dsu-idle-row`);
        const clientsList = document.getElementById(`${prefix}-dsu-clients-list`);

        if (!banner || !chip) return;

        banner.className = `dsu-home-banner ${isOnline ? 'active' : 'warning'}`;
        chip.className = `dsu-home-chip ${isOnline ? 'green' : 'amber'}`;
        chip.textContent = clientWord;

        if (dot) {
          dot.style.backgroundColor = isOnline ? '#34C759' : '#FF9F0A';
          dot.className = `status-dot ${isOnline ? 'online' : ''}`;
        }

        if (isOnline) {
          if (idleRow) idleRow.style.display = 'none';
          if (clientsList) {
            clientsList.style.display = 'flex';
            clientsList.innerHTML = clients.map(c => {
              const addr = c.address || (c.ip + ':' + c.port);
              const isAct = c.active !== false;
              return `<div class="dsu-home-client-tag">
                <div class="dsu-home-client-left">
                  <span class="dsu-client-pulse ${isAct ? 'green' : 'amber'}"></span>
                  <span class="dsu-client-addr">${addr}</span>
                </div>
                <span class="dsu-client-status-badge ${isAct ? 'green' : 'amber'}">${isAct ? 'ACTIVE' : 'IDLE'}</span>
              </div>`;
            }).join('');
          }
        } else {
          if (idleRow) idleRow.style.display = 'flex';
          if (clientsList) {
            clientsList.style.display = 'none';
            clientsList.innerHTML = '';
          }
        }
      };

      updateBanner('offline');
      updateBanner('online');
      updateBanner('usb');
    },

    _lastUsbConnected: null,
    _lastUsbPort: null,

    updateUsbStatus(connected, port) {
      connected = !!connected;
      port = port || '';
      if (this._lastUsbConnected === connected && this._lastUsbPort === port) {
        return;
      }
      this._lastUsbConnected = connected;
      this._lastUsbPort = port;

      const pill = document.getElementById('usb-status-pill');
      const text = document.getElementById('usb-status-pill-text');
      if (!pill || !text) return;

      pill.classList.toggle('waiting', !connected);
      pill.classList.toggle('connected', connected);
      text.textContent = connected
        ? (I18n.t('usb_mode.status_connected') || 'IMU-устройство подключено ({port})').replace('{port}', port)
        : (I18n.t('usb_mode.status_scanning') || 'Поиск USB IMU-устройства...');
    },

    inputMode: 'phone',

    setInputMode(mode, fromBackend = false) {
      if (mode !== 'usb') mode = 'phone';
      const prevMode = this.inputMode;
      this.inputMode = mode;

      const btnPhone = document.getElementById('btn-mode-phone');
      const btnUsb = document.getElementById('btn-mode-usb');
      if (btnPhone) {
        btnPhone.classList.toggle('active', mode === 'phone');
        btnPhone.setAttribute('aria-selected', mode === 'phone' ? 'true' : 'false');
      }
      if (btnUsb) {
        btnUsb.classList.toggle('active', mode === 'usb');
        btnUsb.setAttribute('aria-selected', mode === 'usb' ? 'true' : 'false');
      }

      this.updateModeGlider();

      this._lastStatus = null;
      this._lastIsOffline = null;

      if (!fromBackend && window.go?.main?.App?.SetInputMode) {
        window.go.main.App.SetInputMode(mode).catch(console.error);
      }

      const card = document.querySelector('.apple-card');
      const isSwitching = prevMode && prevMode !== mode;

      if (isSwitching && card) {
        // Measure start height to smoothly morph card size without jarring jumps
        const startHeight = card.offsetHeight;
        card.style.height = `${startHeight}px`;
        card.classList.add('morphing');

        if (this.lastState) {
          this.render(this.lastState);
        }

        const targetHeight = card.scrollHeight;
        if (startHeight !== targetHeight) {
          void card.offsetHeight; // force reflow
          card.style.transition = 'height 0.32s cubic-bezier(0.16, 1, 0.3, 1)';
          card.style.height = `${targetHeight}px`;

          let cleaned = false;
          const cleanHeight = () => {
            if (cleaned) return;
            cleaned = true;
            card.removeEventListener('transitionend', onEnd);
            card.style.height = '';
            card.style.transition = '';
            card.classList.remove('morphing');
          };
          const onEnd = (e) => {
            if (e.target === card && e.propertyName === 'height') {
              cleanHeight();
            }
          };
          card.addEventListener('transitionend', onEnd);
          setTimeout(cleanHeight, 350);
        } else {
          card.style.height = '';
          card.classList.remove('morphing');
        }
      } else {
        if (this.lastState) {
          this.render(this.lastState);
        }
      }
    },

    // morphToView animates the card's height across a view swap instead of an
    // abrupt display:none/flex snap -- same recipe setInputMode already uses
    // for the phone/USB tab switch, reused here for the offline<->online (and
    // USB waiting<->connected) transition so connecting always feels smooth.
    morphToView(applyFn) {
      const card = document.querySelector('.apple-card');
      if (!card) {
        applyFn();
        return;
      }
      const startHeight = card.offsetHeight;
      card.style.height = `${startHeight}px`;
      card.classList.add('morphing');
      applyFn();
      const targetHeight = card.scrollHeight;
      if (startHeight === targetHeight) {
        card.style.height = '';
        card.classList.remove('morphing');
        return;
      }
      void card.offsetHeight; // force reflow
      card.style.transition = 'height 0.32s cubic-bezier(0.16, 1, 0.3, 1)';
      card.style.height = `${targetHeight}px`;
      let cleaned = false;
      const cleanHeight = () => {
        if (cleaned) return;
        cleaned = true;
        card.removeEventListener('transitionend', onEnd);
        card.style.height = '';
        card.style.transition = '';
        card.classList.remove('morphing');
      };
      const onEnd = (e) => {
        if (e.target === card && e.propertyName === 'height') cleanHeight();
      };
      card.addEventListener('transitionend', onEnd);
      setTimeout(cleanHeight, 350);
    },

    updateModeGlider() {
      const pill = document.getElementById('card-mode-pill') || document.querySelector('.main-mode-pill');
      if (pill) {
        pill.setAttribute('data-mode', this.inputMode);
      }
    },

    render(state) {
      this.lastState = state;
      if (!state) return;

      if (state.inputMode && state.inputMode !== this.inputMode) {
        this.setInputMode(state.inputMode, true);
      }

      if (typeof state.dsuClients !== 'undefined' || typeof state.dsuClientList !== 'undefined') {
        this.updateDSU(state.dsuClients, state.dsuClientList);
      }

      if (typeof state.usbConnected !== 'undefined') {
        this.updateUsbStatus(state.usbConnected, state.usbPort);
      }

      if (window._liveDebugWin && !window._liveDebugWin.closed && window._liveDebugWin.updateFromState) {
        try {
          window._liveDebugWin.updateFromState(state);
        } catch (e) {}
      }

      const viewOffline = document.getElementById('view-offline');
      const viewOnline = document.getElementById('view-online');
      const viewUsb = document.getElementById('view-usb-mode');
      const cardModeHeader = document.getElementById('card-mode-header');
      const badgeStatus = document.getElementById('badge-status');
      const statusText = document.getElementById('status-text');
      const btnPause = document.getElementById('btn-pause-resume');
      const linkLiveDebug = document.getElementById('link-live-debug');

      // Populate QR codes and URLs for Android and iOS Setup screens
      const imgQrAndroid = document.getElementById('img-qr-android');
      if (state.qrCode && imgQrAndroid && imgQrAndroid.src !== state.qrCode) {
        imgQrAndroid.src = state.qrCode;
      }
      const linkUrlAndroidText = document.getElementById('link-url-android-text');
      if (linkUrlAndroidText && state.gamepadUrl) {
        linkUrlAndroidText.textContent = state.gamepadUrl;
      }

      const imgQrSetup = document.getElementById('img-qr-setup');
      if (state.setupQrCode && imgQrSetup && imgQrSetup.src !== state.setupQrCode) {
        imgQrSetup.src = state.setupQrCode;
      }
      const linkUrlSetupText = document.getElementById('link-url-setup-text');
      if (linkUrlSetupText && state.setupUrl) {
        linkUrlSetupText.textContent = state.setupUrl;
      }

      const isWizardOpen = !!(SetupWizard?.isOpen || HelpManager?.isOpen || SettingsManager?.isOpen || WelcomeManager?.isOpen || CalibrationWizard?.isOpen);
      if (cardModeHeader) {
        cardModeHeader.style.display = isWizardOpen ? 'none' : 'flex';
      }

      // Mode Branch: Stationary USB Controller Mode, before a device is found.
      // Once state.usbConnected flips true we deliberately fall through to the
      // exact same "connected" rendering phone mode uses below (view-online,
      // the LEVEL HUD, profiles module, DSU banner) instead of a bespoke USB
      // view -- GetState()/GetProfiles()/etc. already resolve to the USB bank
      // on their own, so reusing that view is both correct and free.
      if (this.inputMode === 'usb' && !state.usbConnected) {
        const enteringWaiting = this._lastStatus !== 'waiting_usb';
        if (viewOffline) viewOffline.style.display = 'none';
        if (!isWizardOpen) {
          if (enteringWaiting) {
            this.morphToView(() => {
              if (viewOnline) viewOnline.style.display = 'none';
              if (viewUsb) viewUsb.style.display = 'flex';
            });
            if (viewUsb) {
              viewUsb.classList.remove('view-fade-in');
              void viewUsb.offsetWidth;
              viewUsb.classList.add('view-fade-in');
            }
          } else {
            if (viewOnline) viewOnline.style.display = 'none';
            if (viewUsb) viewUsb.style.display = 'flex';
          }
        }
        if (linkLiveDebug) linkLiveDebug.style.display = 'none';
        this.hideRecalHint(true);

        if (enteringWaiting) {
          this._lastStatus = 'waiting_usb';
          if (badgeStatus) badgeStatus.className = 'status-capsule waiting-usb';
          if (statusText) {
            statusText.setAttribute('data-i18n', 'status.waiting_usb');
            statusText.innerHTML = renderMarkdown(I18n.t('status.waiting_usb'));
          }
        }

        // Author signature visibility
        const authorSig = document.getElementById('author-signature');
        const helpAuthorSig = document.getElementById('help-author-sig');
        const setupAuthorSig = document.getElementById('setup-author-sig');
        if (state.hideAuthor) {
          if (authorSig) authorSig.style.display = 'none';
          if (helpAuthorSig) helpAuthorSig.style.display = 'none';
          if (setupAuthorSig) setupAuthorSig.style.display = 'none';
        } else {
          if (authorSig) authorSig.style.display = '';
          if (helpAuthorSig) helpAuthorSig.style.display = '';
          if (setupAuthorSig) setupAuthorSig.style.display = '';
        }
        return;
      }

      // There's a brief gap between the USB transport connecting
      // (state.usbConnected) and the pipeline processing its first frame
      // (state.status flips to "online"). Keep showing the USB waiting view
      // through that gap instead of ever flashing the phone QR screen below.
      if (this.inputMode === 'usb' && state.status === 'offline') {
        if (viewOnline) viewOnline.style.display = 'none';
        if (viewOffline) viewOffline.style.display = 'none';
        if (viewUsb && !isWizardOpen) viewUsb.style.display = 'flex';
        return;
      }
      if (viewUsb) viewUsb.style.display = 'none';

      // Status capsule: only mutate DOM when status actually changes
      if (this._lastStatus !== state.status) {
        this._lastStatus = state.status;
        badgeStatus.className = `status-capsule ${state.status}`;
        statusText.setAttribute('data-i18n', `status.${state.status}`);
        statusText.innerHTML = renderMarkdown(I18n.t(`status.${state.status}`));
      }

      // If controller just connected while setup was open, auto-close setup to show controller!
      if (state.status !== 'offline' && SetupWizard.isOpen) {
        SetupWizard.close();
      }

      const isOffline = (state.status === 'offline');
      if (this._lastIsOffline !== isOffline) {
        const prevOffline = this._lastIsOffline;
        this._lastIsOffline = isOffline;
        if (prevOffline !== null && typeof SoundManager !== 'undefined') {
          if (!isOffline) {
            SoundManager.play('connect');
          } else {
            SoundManager.play('disconnect');
          }
        }
        if (!isOffline) {
          this._reconnectCooldownTs = Date.now();
          this._stillnessStart = 0;
        }
        const wizardBlocksView = SetupWizard?.isOpen || HelpManager?.isOpen || SettingsManager?.isOpen || WelcomeManager?.isOpen;
        if (isOffline) {
          if (!wizardBlocksView) {
            this.morphToView(() => {
              viewOffline.style.display = 'flex';
              viewOnline.style.display = 'none';
            });
            viewOffline.classList.remove('view-fade-in');
            void viewOffline.offsetWidth;
            viewOffline.classList.add('view-fade-in');
          }
          if (linkLiveDebug) linkLiveDebug.style.display = 'none';
        } else {
          if (!wizardBlocksView) {
            this.morphToView(() => {
              viewOffline.style.display = 'none';
              viewOnline.style.display = 'flex';
            });
            viewOnline.classList.remove('view-fade-in');
            void viewOnline.offsetWidth;
            viewOnline.classList.add('view-fade-in');
          }
          if (linkLiveDebug) linkLiveDebug.style.display = 'inline-flex';
        }
      }

      if (!isOffline && state.deviceName) {
        this.checkFirstTimeDeviceAlert(state);
      } else if (isOffline) {
        this.clearFirstTimeDeviceAlert(true);
      }

      if (CalibrationWizard?.isOpen) {
        if (isOffline) {
          CalibrationWizard.showDisconnectAlert();
        } else if (CalibrationWizard.isDisconnectAlertActive) {
          CalibrationWizard.hideDisconnectAlert();
        }
      }

      if (isOffline) {
        this.hideRecalHint(true);
        this.targetPitch = 0;
        this.targetRoll = 0;
        this.targetYaw = 0;
        const imgQr = document.getElementById('img-qr');
        if (state.qrCode && this._lastQrCode !== state.qrCode) {
          this._lastQrCode = state.qrCode;
          if (imgQr) imgQr.src = state.qrCode;
        }

        if (this.currentUrl !== (state.gamepadUrl || '')) {
          this.currentUrl = state.gamepadUrl || '';
          const linkUrlText = document.getElementById('link-url-text');
          if (linkUrlText) linkUrlText.textContent = this.currentUrl || '...';
        }
      } else {
        // State 2 & 3: Online or Paused
        if (!SetupWizard?.isOpen && !HelpManager?.isOpen && !SettingsManager?.isOpen && !WelcomeManager?.isOpen) {
          viewOffline.style.display = 'none';
          viewOnline.style.display = 'flex';
        }
        if (linkLiveDebug) linkLiveDebug.style.display = 'inline-flex';

        const deviceIconWrap = document.getElementById('device-icon-wrap');
        const deviceStatusBadge = document.getElementById('device-status-badge');
        const isUsbSource = this.inputMode === 'usb';
        deviceIconWrap?.classList.toggle('usb-source', isUsbSource);

        const deviceNameEl = document.getElementById('device-name');
        if (isUsbSource) {
          // Device self-identifies via the protocol's optional TYPE=0x02
          // frame (see PhoneGyro_hardware_protocol docs/PROTOCOL.md); the
          // backend defaults deviceName to the generic "Controller" when a
          // device never sends one, so fall back to a friendlier label here.
          const portLabel = state.usbPort ? ` (${state.usbPort})` : '';
          const knownName = (state.deviceName && state.deviceName !== 'Controller')
            ? state.deviceName
            : (I18n.t('usb_mode.connected_name') || 'USB-контроллер');
          deviceNameEl.textContent = knownName + portLabel;
        } else {
          deviceNameEl.textContent = state.deviceName || 'Controller';
        }
        document.getElementById('device-hz').textContent = `${Math.round(state.hz || 60)} Hz`;

        // Ping/network-quality pills are meaningless over a wired USB link --
        // repurpose them to show the port and a plain "direct connection"
        // label instead of a fabricated latency number.
        const pingTxt = document.getElementById('device-ping-txt');
        const netSpark = document.getElementById('main-net-spark-canvas');
        const networkHealthEl = document.getElementById('network-health');
        if (isUsbSource) {
          if (pingTxt) pingTxt.textContent = state.usbPort || 'USB';
          else {
            const devPing = document.getElementById('device-ping');
            if (devPing) devPing.textContent = state.usbPort || 'USB';
          }
          if (netSpark) netSpark.style.display = 'none';
          if (networkHealthEl) {
            networkHealthEl.removeAttribute('data-i18n');
            networkHealthEl.textContent = I18n.t('usb_mode.direct_connection') || 'Прямое USB-подключение';
          }
        } else {
          // Real round-trip time of the phone link (server PING/PONG, 1/s);
          // -1 until the first answer arrives.
          const pingVal = (typeof state.pingMs === 'number') ? state.pingMs : -1;
          const pingLabel = pingVal >= 0 ? `${pingVal} ms` : '—';
          if (pingTxt) {
            pingTxt.textContent = pingLabel;
          } else {
            const devPing = document.getElementById('device-ping');
            if (devPing) devPing.textContent = pingLabel;
          }
          if (netSpark) netSpark.style.display = '';
          const qualityKey = pingVal < 0 ? 'calibration.network_quality_measuring'
            : pingVal < 40 ? 'calibration.network_quality_optimal'
            : pingVal < 100 ? 'calibration.network_quality_fair'
            : 'calibration.network_quality_poor';
          if (networkHealthEl && networkHealthEl.getAttribute('data-i18n') !== qualityKey) {
            networkHealthEl.setAttribute('data-i18n', qualityKey);
            networkHealthEl.innerHTML = renderMarkdown(I18n.t(qualityKey));
          }
          const benchPing = document.getElementById('bench-net-ping');
          if (benchPing) {
            benchPing.textContent = pingLabel;
          }
          if (typeof NetSparkline !== 'undefined') {
            NetSparkline.push(pingVal);
          }
        }
        document.getElementById('device-time').textContent = state.connectedTime || '00:00:00';

        // Update target Euler angles (P, R, Y) for continuous RAF lerp smoothing loop
        if (state.isPaused) {
          this.targetPitch = 0;
          this.targetRoll = 0;
          this.targetYaw = 0;
        } else {
          this.targetPitch = Number(state.pitch) || 0;
          this.targetRoll = Number(state.roll) || 0;
          this.targetYaw = Number(state.yaw) || 0;
        }

        const p = this.targetPitch;
        const r = this.targetRoll;
        const y = this.targetYaw;

        const isWaiting = (state.hz === 0 && Math.abs(p) < 0.001 && Math.abs(r) < 0.001 && Math.abs(y) < 0.001);
        const badgeKey = state.isPaused ? 'paused' : (isWaiting ? 'waiting' : 'online');

        if (state.isPaused) {
          this.hideRecalHint(true);
        } else {
          this.checkStillnessRecalHint(p, r, state);
        }

        if (this._lastBadgeKey !== badgeKey) {
          this._lastBadgeKey = badgeKey;
          if (deviceIconWrap) deviceIconWrap.className = `device-icon-wrap ${state.isPaused ? 'paused' : 'online'}`;
          if (deviceStatusBadge) {
            if (badgeKey === 'paused') {
              deviceStatusBadge.className = 'device-status-badge paused';
              deviceStatusBadge.setAttribute('data-i18n', 'status.paused');
              deviceStatusBadge.innerHTML = renderMarkdown(I18n.t('status.paused'));
            } else if (badgeKey === 'waiting') {
              deviceStatusBadge.className = 'device-status-badge waiting';
              deviceStatusBadge.setAttribute('data-i18n', 'status.waiting_sensors');
              deviceStatusBadge.innerHTML = renderMarkdown(I18n.t('status.waiting_sensors') || 'ожидание датчиков...');
            } else {
              deviceStatusBadge.className = 'device-status-badge online';
              deviceStatusBadge.setAttribute('data-i18n', 'status.online');
              deviceStatusBadge.innerHTML = renderMarkdown(I18n.t('status.online'));
            }
          }
        }

        if (this._lastPauseState !== state.isPaused) {
          this._lastPauseState = state.isPaused;
          if (state.isPaused) {
            btnPause.setAttribute('data-i18n', 'controls.resume');
            btnPause.innerHTML = renderMarkdown(I18n.t('controls.resume'));
            btnPause.classList.add('paused');
          } else {
            btnPause.setAttribute('data-i18n', 'controls.pause');
            btnPause.innerHTML = renderMarkdown(I18n.t('controls.pause'));
            btnPause.classList.remove('paused');
          }
        }
      }

      // Sync profile slots display
      ProfileManager.sync(state);

      // First connection of this device in this session: centre first.
      FirstCenterGate.onState(state);

      // Feed calibration wizard if actively capturing
      if (this._calCaptureCb) {
        this._calCaptureCb(state);
      }

      // Feed 3-axis telemetry strip in calibration wizard
      if (CalibrationWizard.isOpen && CalibrationWizard.currentScreen === 'capture') {
        CalibrationWizard.updateTelemetry(state);
      }

      // Feed Three.js confirm/manual scenes with live orientation
      const confirmScene = Scene3D.get('cal-3d-canvas-confirm');
      if (confirmScene) confirmScene.updateFromState(state);
      const manualScene = Scene3D.get('cal-3d-canvas-manual');
      if (manualScene) manualScene.updateFromState(state);

      // Author signature visibility
      const authorSig = document.getElementById('author-signature');
      const helpAuthorSig = document.getElementById('help-author-sig');
      const setupAuthorSig = document.getElementById('setup-author-sig');
      if (state.hideAuthor) {
        if (authorSig) authorSig.style.display = 'none';
        if (helpAuthorSig) helpAuthorSig.style.display = 'none';
        if (setupAuthorSig) setupAuthorSig.style.display = 'none';
      } else {
        if (authorSig) authorSig.style.display = '';
        if (helpAuthorSig) helpAuthorSig.style.display = '';
        if (setupAuthorSig) setupAuthorSig.style.display = '';
      }
    },

    async init() {
      if (this.initialized) return;
      this.initialized = true;
      this.startInclinometerLoop();

      // Pause button action with debounce guard
      let pauseBusy = false;
      document.getElementById('btn-pause-resume')?.addEventListener('click', async () => {
        if (pauseBusy) return;
        pauseBusy = true;
        try {
          if (window.go && window.go.main && window.go.main.App) {
            const newState = await window.go.main.App.TogglePause();
            this.render(newState);
          }
        } catch (err) {
          console.error('TogglePause error:', err);
        } finally {
          setTimeout(() => { pauseBusy = false; }, 250);
        }
      });

      // Mode segmented control buttons (Smartphone vs USB Controller)
      document.getElementById('btn-mode-phone')?.addEventListener('click', () => {
        if (this.inputMode !== 'phone') {
          if (typeof SoundManager !== 'undefined' && SoundManager.play) {
            SoundManager.play('click');
          }
          this.setInputMode('phone');
        }
      });
      document.getElementById('btn-mode-usb')?.addEventListener('click', () => {
        if (this.inputMode !== 'usb') {
          if (typeof SoundManager !== 'undefined' && SoundManager.play) {
            SoundManager.play('click');
          }
          this.setInputMode('usb');
        }
      });

      window.addEventListener('resize', () => this.updateModeGlider());
      setTimeout(() => this.updateModeGlider(), 60);

      // Master setup button
      document.getElementById('btn-master-setup')?.addEventListener('click', () => {
        SetupWizard.open();
      });

      // Default offline QR copy chip
      setupCopyChip('chip-url', 'url-copy-badge', () => this.currentUrl);

      // First-connect banner click: open calibration directly to recommended slot
      document.getElementById('first-connect-banner')?.addEventListener('click', (e) => {
        if (e.target.closest('#btn-dismiss-first-connect')) {
          this.dismissFirstTimeDeviceAlert();
          return;
        }
        const targetSlot = this.findEmptyOrActiveSlot();
        CalibrationWizard.openToSlot(targetSlot);
      });

      document.getElementById('btn-dismiss-first-connect')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.dismissFirstTimeDeviceAlert();
      });

      // Recalibration hint banner dismiss
      document.getElementById('btn-recal-hint-close')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.hideRecalHint(false);
      });

      // Recalibration hint banner click: opens calibration wizard directly
      document.getElementById('level-recal-hint')?.addEventListener('click', (e) => {
        if (e.target.closest('#btn-recal-hint-close')) return;
        this.hideRecalHint(true);
        const slot = (this.lastState && this.lastState.activeSlot >= 0) ? this.lastState.activeSlot : 0;
        CalibrationWizard.openToSlot(slot);
      });

      // Open separate 3D LiveDebug window from stats header button
      const onOpenStats = (e) => {
        if (e) e.preventDefault();
        if (window.go?.main?.App?.OpenLiveDebugWindow) {
          window.go.main.App.OpenLiveDebugWindow();
        } else {
          window.open('http://127.0.0.1:8080/livedebug', '_blank');
        }
      };
      document.getElementById('btn-header-stats')?.addEventListener('click', onOpenStats);
      document.getElementById('link-live-debug')?.addEventListener('click', onOpenStats);

      // Listen for real-time state changes from Wails backend
      if (window.runtime && window.runtime.EventsOn) {
        window.runtime.EventsOn('state:change', (state) => {
          if (typeof RecenterManager !== 'undefined' && state) {
            RecenterManager.onFrame({ RawX: state.rawRotX, RawY: state.rawRotY, RawZ: state.rawRotZ });
          }
          this.render(state);
        });
        window.runtime.EventsOn('device:connection-lost', () => {
          if (typeof CalibrationWizard !== 'undefined' && CalibrationWizard.isOpen) {
            CalibrationWizard.showDisconnectAlert();
          }
        });
        window.runtime.EventsOn('device:connected', () => {
          AppState._reconnectCooldownTs = Date.now();
          AppState._stillnessStart = 0;
          if (typeof CalibrationWizard !== 'undefined' && CalibrationWizard.isOpen) {
            CalibrationWizard.hideDisconnectAlert();
          }
        });
        window.runtime.EventsOn('device:disconnected', () => {
          if (typeof PlatformGame !== 'undefined' && PlatformGame.onDisconnect) {
            PlatformGame.onDisconnect();
          }
        });
        window.runtime.EventsOn('device:visibility', (visible) => {
          if (visible) {
            AppState._reconnectCooldownTs = Date.now();
            AppState._stillnessStart = 0;
          }
          if (typeof CalibrationWizard !== 'undefined' && CalibrationWizard.isOpen) {
            if (!visible) {
              CalibrationWizard.showDisconnectAlert();
            } else {
              CalibrationWizard.hideDisconnectAlert();
            }
          }
        });
        window.runtime.EventsOn('dsu:status', (payload) => {
          try {
            const data = (typeof payload === 'string') ? JSON.parse(payload) : payload;
            if (data) {
              AppState.updateDSU(data.count, data.clients);
            }
          } catch (e) {}
        });
        window.runtime.EventsOn('input-mode-changed', (mode) => {
          if (mode && mode !== AppState.inputMode) {
            AppState.setInputMode(mode, true);
          }
        });
      }

      // Initial state load
      if (window.go && window.go.main && window.go.main.App) {
        const state = await window.go.main.App.GetState();
        this.render(state);
        if (window.go.main.App.GetInputMode) {
          window.go.main.App.GetInputMode().then((m) => {
            if (m && m !== AppState.inputMode) {
              AppState.setInputMode(m, true);
            }
          }).catch(() => {});
        }
        if (window.go.main.App.GetDSUStatus) {
          window.go.main.App.GetDSUStatus().then((dsu) => {
            if (dsu) {
              AppState.updateDSU(dsu.count, dsu.clients);
            }
          }).catch(() => {});
        }
      }
    }
  };

  // ── Process Resource Monitor (RAM) ─────────────────────────────────────────
  const ResourceMonitor = {
    lastStats: null,

    init() {
      // Listen for periodic updates from Go backend (resmon)
      if (window.runtime && window.runtime.EventsOn) {
        window.runtime.EventsOn('resource-stats', (stats) => {
          this.update(stats);
        });
      }

      // Initial query if available
      if (window.go?.main?.App?.GetResourceStats) {
        window.go.main.App.GetResourceStats().then((stats) => {
          if (stats && stats.ramMb > 0) {
            this.update(stats);
          }
        }).catch(() => {});
      }
    },

    update(stats) {
      if (!stats) return;
      this.lastStats = stats;

      const ramMb = typeof stats.ramMb === 'number' ? stats.ramMb : 0;
      const totalRamMb = typeof stats.totalRamMb === 'number' ? stats.totalRamMb : 0;
      const ramPct = typeof stats.ramPercent === 'number' ? stats.ramPercent : 0;

      // Update RAM text with integer MB
      const ramValEl = document.getElementById('footer-ram-val');
      const ramPctEl = document.getElementById('footer-ram-pct');
      const itemRam = document.getElementById('footer-metric-ram');

      const ramWholeMb = Math.round(ramMb);
      if (ramValEl) {
        ramValEl.textContent = `${ramWholeMb} MB`;
      }
      if (ramPctEl) {
        ramPctEl.textContent = '';
      }

      if (itemRam && totalRamMb > 0) {
        itemRam.title = `${ramWholeMb} MB / ${Math.round(totalRamMb)} MB`;
      }
    }
  };

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
      if (window.go && window.go.main && window.go.main.App) {
        startApp();
      }
    }, 40);

    fallbackTimer = setTimeout(startApp, 1500);
  });
