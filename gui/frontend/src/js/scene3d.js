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
