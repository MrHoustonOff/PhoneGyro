'use strict';

  // ── Zelda 3D Shrine Platform Mini-Game (Apparatus Simulator) ───────────────
  const PlatformGame = {
    initialized: false,
    renderer: null,
    scene: null,
    camera: null,
    platformGroup: null,
    slabMesh: null,
    slabMat: null,
    pedMid: null,
    pedLow: null,
    gimbalHub: null,
    hubRing: null,
    edgeLine: null,
    runeGroup: null,
    rimGroup: null,
    ballMesh: null,
    holeMesh: null,
    beaconMesh: null,
    score: 0,
    record: parseInt(localStorage.getItem('gb_platform_record') || '0', 10),
    isFullscreen: false,
    isOffline: false,
    pitch: 0, // rad (tilt around X)
    roll: 0,  // rad (tilt around Z)
    yaw: 0,   // rad (turn around Y)
    pitchOffset: 0,
    rollOffset: 0,
    yawOffset: 0,
    lastRawPitch: 0,
    lastRawRoll: 0,
    lastRawYaw: 0,
    ballPos: { x: 0, z: 0 },
    ballVel: { x: 0, z: 0 },
    ballPosY: 0,
    ballVelY: 0,
    isFalling: false,
    holePos: { x: 0.9, z: -0.3 },
    ballRadius: 0.14,
    platformSizeX: 3.4,
    platformSizeZ: 2.1,
    platformThickness: 0.16,
    confettiParticles: [],
    confettiColors: [0xff3b30, 0xff9500, 0xffcc00, 0x34c759, 0x00c7be, 0x32ade6, 0xaf52de, 0xff2d55, 0x00e5ff],
    lastTickTs: 0,
    cachedW: 0,
    cachedH: 0,
    hudElements: null,
    lastHudScore: -1,
    lastHudRecord: -1,
    lastHudTs: 0,
    _placeholder: null,

    syncDimensions(force = false) {
      const canvas = document.getElementById('bench-platform-canvas');
      const vp = document.getElementById('bench-platform-viewport');
      if (!canvas || !this.renderer || !this.camera) return;

      const rect = vp ? vp.getBoundingClientRect() : canvas.getBoundingClientRect();
      const w = Math.floor(rect.width || canvas.clientWidth || (this.isFullscreen ? window.innerWidth : 340));
      const h = Math.floor(rect.height || canvas.clientHeight || (this.isFullscreen ? window.innerHeight : 210));
      if (w <= 0 || h <= 0) return;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (this.renderer.getPixelRatio() !== dpr) {
        this.renderer.setPixelRatio(dpr);
      }

      if (force || w !== this.cachedW || h !== this.cachedH) {
        this.cachedW = w;
        this.cachedH = h;
        this.renderer.setSize(w, h, false);
        const aspect = w / h;
        this.camera.aspect = aspect;

        const fovRad = (this.camera.fov * Math.PI) / 180;
        let dist;
        if (this.isFullscreen) {
          const targetHalfW = this.platformSizeX * 0.62;
          const targetHalfH = this.platformSizeZ * 0.68;
          const distW = targetHalfW / (Math.tan(fovRad / 2) * aspect);
          const distH = targetHalfH / Math.tan(fovRad / 2);
          dist = Math.max(distW, distH, 4.4);
          this.camera.position.set(0, dist * 0.66, dist * 0.86);
        } else {
          // Mini-screen mode: close-up dynamic camera to make platform prominent, detailed & beautiful
          const targetHalfW = this.platformSizeX * 0.50;
          const targetHalfH = this.platformSizeZ * 0.54;
          const distW = targetHalfW / (Math.tan(fovRad / 2) * aspect);
          const distH = targetHalfH / Math.tan(fovRad / 2);
          dist = Math.max(distW, distH, 3.2);
          this.camera.position.set(0, dist * 0.62, dist * 0.80);
        }
        this.camera.lookAt(0, -0.04, 0);
        this.camera.updateProjectionMatrix();
      }
    },

    init() {
      if (this.initialized) return;
      const canvas = document.getElementById('bench-platform-canvas');
      const vp = document.getElementById('bench-platform-viewport');
      if (!canvas || !window.THREE) return;
      this.initialized = true;

      const THREE = window.THREE;
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.renderer = renderer;

      if (typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(() => {
          this.syncDimensions(true);
        });
        ro.observe(canvas);
        if (vp) ro.observe(vp);
      }

      const scene = new THREE.Scene();
      this.scene = scene;

      const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 50);
      camera.position.set(0, 3.6, 4.4);
      camera.lookAt(0, -0.05, 0);
      this.camera = camera;

      // Studio Lighting: Sheikah Shrine ancient illumination
      const ambientLight = new THREE.AmbientLight(0xffffff, 0.95);
      scene.add(ambientLight);

      const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
      dirLight.position.set(3.5, 8.0, 5.0);
      scene.add(dirLight);

      const cyanPoint = new THREE.PointLight(0x00e5ff, 1.4, 10);
      cyanPoint.position.set(0, 2.0, 0);
      scene.add(cyanPoint);

      // Platform Root Group (rotates on central gimbal pivot)
      const platformGroup = new THREE.Group();
      scene.add(platformGroup);
      this.platformGroup = platformGroup;

      const isLight = (document.documentElement.getAttribute('data-theme') === 'light' || document.body.getAttribute('data-theme') === 'light');

      // 1. Main Ancient Sheikah Slate Top Slab
      const slabGeo = new THREE.BoxGeometry(this.platformSizeX, this.platformThickness, this.platformSizeZ);
      const slateMat = new THREE.MeshStandardMaterial({
        color: isLight ? 0x2e3644 : 0x151821,
        roughness: 0.65,
        metalness: 0.35
      });
      const slabMesh = new THREE.Mesh(slabGeo, slateMat);
      platformGroup.add(slabMesh);
      this.slabMesh = slabMesh;
      this.slabMat = slateMat;

      // 2. Zelda Underside Tapered Stone Pedestal & Gimbal Hub
      const pedMat = new THREE.MeshStandardMaterial({
        color: isLight ? 0x242a36 : 0x0e1017,
        roughness: 0.72,
        metalness: 0.28
      });
      this.pedMat = pedMat;

      const pedMidGeo = new THREE.BoxGeometry(this.platformSizeX * 0.88, 0.08, this.platformSizeZ * 0.88);
      const pedMid = new THREE.Mesh(pedMidGeo, pedMat);
      pedMid.position.y = -this.platformThickness / 2 - 0.04;
      platformGroup.add(pedMid);
      this.pedMid = pedMid;

      const pedLowGeo = new THREE.BoxGeometry(this.platformSizeX * 0.68, 0.10, this.platformSizeZ * 0.68);
      const pedLow = new THREE.Mesh(pedLowGeo, pedMat);
      pedLow.position.y = -this.platformThickness / 2 - 0.13;
      platformGroup.add(pedLow);
      this.pedLow = pedLow;

      // Gimbal Hub & Cyan Energy Ring
      const hubGeo = new THREE.CylinderGeometry(0.30, 0.36, 0.18, 24);
      const hubMat = new THREE.MeshStandardMaterial({
        color: 0x9b752c,
        metalness: 0.88,
        roughness: 0.25
      });
      const gimbalHub = new THREE.Mesh(hubGeo, hubMat);
      gimbalHub.position.y = -this.platformThickness / 2 - 0.24;
      platformGroup.add(gimbalHub);
      this.gimbalHub = gimbalHub;

      const hubRingGeo = new THREE.TorusGeometry(0.32, 0.015, 12, 32);
      const hubRingMat = new THREE.MeshBasicMaterial({ color: 0x00e5ff });
      const hubRing = new THREE.Mesh(hubRingGeo, hubRingMat);
      hubRing.rotation.x = Math.PI / 2;
      hubRing.position.y = -this.platformThickness / 2 - 0.24;
      platformGroup.add(hubRing);
      this.hubRing = hubRing;

      // 3. Surface Sheikah Runic Circuitry & Border Line
      this.createEdgeLine();
      this.createRunes();

      // 4. Sheikah Ancient Goal Socket (Receptacle)
      const holeGroup = new THREE.Group();

      // Deep void pit
      const holePitGeo = new THREE.CircleGeometry(0.18, 32);
      const holePitMat = new THREE.MeshBasicMaterial({
        color: 0x030508,
        side: THREE.DoubleSide
      });
      const holePit = new THREE.Mesh(holePitGeo, holePitMat);
      holePit.rotation.x = -Math.PI / 2;
      holePit.position.y = this.platformThickness / 2 + 0.002;
      holeGroup.add(holePit);

      // Outer metallic bronze collar
      const collarGeo = new THREE.TorusGeometry(0.19, 0.016, 12, 32);
      const collarMat = new THREE.MeshStandardMaterial({
        color: 0x9b752c,
        metalness: 0.88,
        roughness: 0.28
      });
      const collar = new THREE.Mesh(collarGeo, collarMat);
      collar.rotation.x = Math.PI / 2;
      collar.position.y = this.platformThickness / 2 + 0.003;
      holeGroup.add(collar);

      // Glowing Sheikah energetic pulse ring
      const holeRimGeo = new THREE.RingGeometry(0.15, 0.19, 32);
      const holeRimMat = new THREE.MeshBasicMaterial({
        color: 0x00e5ff,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.92
      });
      const holeRim = new THREE.Mesh(holeRimGeo, holeRimMat);
      holeRim.rotation.x = -Math.PI / 2;
      holeRim.position.y = this.platformThickness / 2 + 0.004;
      holeGroup.add(holeRim);

      // Ethereal vertical energy beacon beam rising from the socket
      const beaconGeo = new THREE.CylinderGeometry(0.08, 0.16, 0.9, 16, 1, true);
      const beaconMat = new THREE.MeshBasicMaterial({
        color: 0x00e5ff,
        transparent: true,
        opacity: 0.32,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      const beaconMesh = new THREE.Mesh(beaconGeo, beaconMat);
      beaconMesh.position.y = this.platformThickness / 2 + 0.45;
      holeGroup.add(beaconMesh);
      this.beaconMesh = beaconMesh;

      platformGroup.add(holeGroup);
      this.holeMesh = holeGroup;
      // In normal mode: hole is hidden (interactive test with borders only)
      holeGroup.visible = false;

      // 5. Ancient Sheikah Protective Borders (Bortiki)
      this.createBorders();

      // 6. Ancient Sheikah Orb (Ball)
      const ballGroup = new THREE.Group();
      const ballGeo = new THREE.SphereGeometry(this.ballRadius, 32, 32);
      const ballMat = new THREE.MeshStandardMaterial({
        color: 0xd4af37,
        roughness: 0.22,
        metalness: 0.90
      });
      const ballCore = new THREE.Mesh(ballGeo, ballMat);
      ballGroup.add(ballCore);

      // Equator & meridian cyan energy rings
      const eqRingGeo = new THREE.TorusGeometry(this.ballRadius + 0.002, 0.007, 12, 32);
      const ringMat = new THREE.MeshBasicMaterial({ color: 0x00e5ff });
      const eqRing = new THREE.Mesh(eqRingGeo, ringMat);
      ballGroup.add(eqRing);

      const merRingGeo = new THREE.TorusGeometry(this.ballRadius + 0.002, 0.007, 12, 32);
      const merRing = new THREE.Mesh(merRingGeo, ringMat);
      merRing.rotation.y = Math.PI / 2;
      ballGroup.add(merRing);

      // Local light attached to ball
      const ballLight = new THREE.PointLight(0x00e5ff, 0.70, 1.2);
      ballGroup.add(ballLight);

      this.ballPosY = this.platformThickness / 2 + this.ballRadius;
      ballGroup.position.set(0, this.ballPosY, 0);
      platformGroup.add(ballGroup);
      this.ballMesh = ballGroup;

      // Fullscreen Toggle and Escape Key
      document.getElementById('btn-bench-platform-fullscreen')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleFullscreen();
      });

      canvas.addEventListener('dblclick', () => {
        this.toggleFullscreen();
      });

      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this.isFullscreen) {
          this.setFullscreen(false);
        }
      });

      this.recenter();
    },

    createEdgeLine() {
      if (!this.platformGroup || !window.THREE) return;
      if (this.edgeLine) {
        this.platformGroup.remove(this.edgeLine);
        if (this.edgeLine.geometry) this.edgeLine.geometry.dispose();
      }
      const THREE = window.THREE;
      const hx = this.platformSizeX / 2 - 0.04;
      const hz = this.platformSizeZ / 2 - 0.04;
      const y = this.platformThickness / 2 + 0.003;
      const points = [
        new THREE.Vector3(-hx, y, -hz),
        new THREE.Vector3(hx, y, -hz),
        new THREE.Vector3(hx, y, hz),
        new THREE.Vector3(-hx, y, hz),
        new THREE.Vector3(-hx, y, -hz)
      ];
      const edgeGeo = new THREE.BufferGeometry().setFromPoints(points);
      const edgeMat = new THREE.LineBasicMaterial({
        color: 0x00e5ff,
        transparent: true,
        opacity: 0.85
      });
      this.edgeLine = new THREE.Line(edgeGeo, edgeMat);
      this.platformGroup.add(this.edgeLine);
    },

    createRunes() {
      if (!this.platformGroup || !window.THREE) return;
      if (this.runeGroup) {
        this.platformGroup.remove(this.runeGroup);
      }
      const THREE = window.THREE;
      const runeGroup = new THREE.Group();
      const y = this.platformThickness / 2 + 0.003;

      // Outer concentric ring
      const ring1Geo = new THREE.RingGeometry(0.32, 0.36, 32);
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0x00e5ff,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.60
      });
      const ring1 = new THREE.Mesh(ring1Geo, ringMat);
      ring1.rotation.x = -Math.PI / 2;
      ring1.position.y = y;
      runeGroup.add(ring1);

      // Inner concentric ring
      const ring2Geo = new THREE.RingGeometry(0.18, 0.21, 32);
      const ring2 = new THREE.Mesh(ring2Geo, ringMat);
      ring2.rotation.x = -Math.PI / 2;
      ring2.position.y = y + 0.001;
      runeGroup.add(ring2);

      // Center Sheikah eye dot
      const dotGeo = new THREE.CircleGeometry(0.07, 24);
      const dot = new THREE.Mesh(dotGeo, ringMat);
      dot.rotation.x = -Math.PI / 2;
      dot.position.y = y + 0.002;
      runeGroup.add(dot);

      // 4 Radiating Sheikah circuit lines to corners
      const hx = this.platformSizeX / 2 - 0.25;
      const hz = this.platformSizeZ / 2 - 0.25;
      const circuitMat = new THREE.LineBasicMaterial({
        color: 0x00e5ff,
        transparent: true,
        opacity: 0.50
      });
      const rays = [
        [new THREE.Vector3(0.36, y, 0), new THREE.Vector3(hx, y, 0)],
        [new THREE.Vector3(-0.36, y, 0), new THREE.Vector3(-hx, y, 0)],
        [new THREE.Vector3(0.25, y, 0.25), new THREE.Vector3(hx, y, hz)],
        [new THREE.Vector3(-0.25, y, 0.25), new THREE.Vector3(-hx, y, hz)],
        [new THREE.Vector3(0.25, y, -0.25), new THREE.Vector3(hx, y, -hz)],
        [new THREE.Vector3(-0.25, y, -0.25), new THREE.Vector3(-hx, y, -hz)]
      ];
      for (const pts of rays) {
        const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
        runeGroup.add(new THREE.Line(lineGeo, circuitMat));
      }

      this.platformGroup.add(runeGroup);
      this.runeGroup = runeGroup;
    },

    createBorders() {
      if (!this.platformGroup || !window.THREE) return;
      if (this.rimGroup) {
        this.platformGroup.remove(this.rimGroup);
        this.rimGroup.traverse((child) => {
          if (child.geometry) child.geometry.dispose();
          if (child.material) {
            if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
            else child.material.dispose();
          }
        });
      }
      const THREE = window.THREE;
      const rimGroup = new THREE.Group();
      this.rimGroup = rimGroup;

      const borderH = 0.08;
      const borderThick = 0.07;
      const y = this.platformThickness / 2 + borderH / 2;

      const isLight = (document.documentElement.getAttribute('data-theme') === 'light' || document.body.getAttribute('data-theme') === 'light');
      const borderMat = new THREE.MeshStandardMaterial({
        color: isLight ? 0x2e3644 : 0x181c26,
        roughness: 0.60,
        metalness: 0.40
      });
      const neonMat = new THREE.MeshBasicMaterial({ color: 0x00e5ff });

      const hx = this.platformSizeX / 2;
      const hz = this.platformSizeZ / 2;

      // North (top border along X)
      const nGeo = new THREE.BoxGeometry(this.platformSizeX, borderH, borderThick);
      const nMesh = new THREE.Mesh(nGeo, borderMat);
      nMesh.position.set(0, y, -hz + borderThick / 2);
      rimGroup.add(nMesh);

      // South (bottom border along X)
      const sMesh = new THREE.Mesh(nGeo, borderMat);
      sMesh.position.set(0, y, hz - borderThick / 2);
      rimGroup.add(sMesh);

      // West (left border along Z)
      const sideLength = Math.max(0.1, this.platformSizeZ - borderThick * 2);
      const wGeo = new THREE.BoxGeometry(borderThick, borderH, sideLength);
      const wMesh = new THREE.Mesh(wGeo, borderMat);
      wMesh.position.set(-hx + borderThick / 2, y, 0);
      rimGroup.add(wMesh);

      // East (right border along Z)
      const eMesh = new THREE.Mesh(wGeo, borderMat);
      eMesh.position.set(hx - borderThick / 2, y, 0);
      rimGroup.add(eMesh);

      // Top glowing cyan trim strips on the borders
      const stripY = y + borderH / 2 + 0.001;
      const nStripGeo = new THREE.PlaneGeometry(this.platformSizeX, 0.015);
      const nStrip = new THREE.Mesh(nStripGeo, neonMat);
      nStrip.rotation.x = -Math.PI / 2;
      nStrip.position.set(0, stripY, -hz + borderThick / 2);
      rimGroup.add(nStrip);

      const sStrip = new THREE.Mesh(nStripGeo, neonMat);
      sStrip.rotation.x = -Math.PI / 2;
      sStrip.position.set(0, stripY, hz - borderThick / 2);
      rimGroup.add(sStrip);

      const sideStripGeo = new THREE.PlaneGeometry(0.015, sideLength);
      const wStrip = new THREE.Mesh(sideStripGeo, neonMat);
      wStrip.rotation.x = -Math.PI / 2;
      wStrip.position.set(-hx + borderThick / 2, stripY, 0);
      rimGroup.add(wStrip);

      const eStrip = new THREE.Mesh(sideStripGeo, neonMat);
      eStrip.rotation.x = -Math.PI / 2;
      eStrip.position.set(hx - borderThick / 2, stripY, 0);
      rimGroup.add(eStrip);

      this.platformGroup.add(rimGroup);
      rimGroup.visible = !this.isFullscreen;
    },

    toggleFullscreen() {
      this.setFullscreen(!this.isFullscreen);
    },

    setFullscreen(enable) {
      this.isFullscreen = !!enable;
      const vp = document.getElementById('bench-platform-viewport');
      const btn = document.getElementById('btn-bench-platform-fullscreen');
      if (!vp) return;

      if (this.isFullscreen) {
        if (!this._placeholder) {
          this._placeholder = document.createElement('div');
          this._placeholder.id = 'bench-platform-placeholder';
          this._placeholder.style.display = 'none';
        }
        if (vp.parentNode && vp.parentNode !== document.body) {
          vp.parentNode.insertBefore(this._placeholder, vp);
          document.body.appendChild(vp);
        }
        vp.classList.add('fullscreen');
      } else {
        vp.classList.remove('fullscreen');
        if (this._placeholder && this._placeholder.parentNode) {
          this._placeholder.parentNode.insertBefore(vp, this._placeholder);
          this._placeholder.parentNode.removeChild(this._placeholder);
          this._placeholder = null;
        }
      }

      if (btn) {
        const iconExpand = btn.querySelector('.icon-expand');
        const iconCollapse = btn.querySelector('.icon-collapse');
        if (iconExpand) iconExpand.style.display = this.isFullscreen ? 'none' : 'block';
        if (iconCollapse) iconCollapse.style.display = this.isFullscreen ? 'block' : 'none';
        btn.title = this.isFullscreen ? (I18n.t('settings_modal.bench_exit_fullscreen') || 'Свернуть') : (I18n.t('settings_modal.bench_fullscreen') || 'На весь экран');
      }

      if (this.isFullscreen) {
        this.platformSizeX = 4.4;
        this.platformSizeZ = 2.6;
        this.platformThickness = 0.18;
        this.score = 0;
        if (this.holeMesh) this.holeMesh.visible = true;
        if (this.rimGroup) this.rimGroup.visible = false;
        this.spawnHole();
      } else {
        this.platformSizeX = 3.4;
        this.platformSizeZ = 2.1;
        this.platformThickness = 0.16;
        if (this.holeMesh) this.holeMesh.visible = false;
        if (this.rimGroup) this.rimGroup.visible = true;
      }

      this.rebuildPlatformGeometry();
      this.respawnBall();
      this.syncDimensions(true);
      requestAnimationFrame(() => {
        this.syncDimensions(true);
      });
      setTimeout(() => {
        this.syncDimensions(true);
      }, 60);
      this.updateHud(true);
    },

    rebuildPlatformGeometry() {
      if (!this.slabMesh || !window.THREE) return;
      const THREE = window.THREE;

      if (this.slabMesh.geometry) this.slabMesh.geometry.dispose();
      this.slabMesh.geometry = new THREE.BoxGeometry(this.platformSizeX, this.platformThickness, this.platformSizeZ);

      if (this.pedMid && this.pedMid.geometry) {
        this.pedMid.geometry.dispose();
        this.pedMid.geometry = new THREE.BoxGeometry(this.platformSizeX * 0.88, 0.08, this.platformSizeZ * 0.88);
        this.pedMid.position.y = -this.platformThickness / 2 - 0.04;
      }
      if (this.pedLow && this.pedLow.geometry) {
        this.pedLow.geometry.dispose();
        this.pedLow.geometry = new THREE.BoxGeometry(this.platformSizeX * 0.68, 0.10, this.platformSizeZ * 0.68);
        this.pedLow.position.y = -this.platformThickness / 2 - 0.13;
      }
      if (this.gimbalHub) {
        this.gimbalHub.position.y = -this.platformThickness / 2 - 0.24;
      }
      if (this.hubRing) {
        this.hubRing.position.y = -this.platformThickness / 2 - 0.24;
      }

      this.createEdgeLine();
      this.createRunes();
      this.createBorders();
    },

    updateTheme(theme) {
      const isLight = (theme === 'light');
      if (this.slabMat) {
        this.slabMat.color.setHex(isLight ? 0x2e3644 : 0x151821);
      }
      if (this.pedMat) {
        this.pedMat.color.setHex(isLight ? 0x242a36 : 0x0e1017);
      }
    },

    spawnHole() {
      const marginX = 0.40;
      const marginZ = 0.35;
      const maxSpawnX = (this.platformSizeX / 2) - this.ballRadius - marginX;
      const maxSpawnZ = (this.platformSizeZ / 2) - this.ballRadius - marginZ;

      let randX = 0;
      let randZ = 0;
      let attempts = 0;
      do {
        randX = (Math.random() * 2 - 1) * maxSpawnX;
        randZ = (Math.random() * 2 - 1) * maxSpawnZ;
        attempts++;
      } while (Math.hypot(randX, randZ) < 0.65 && attempts < 25);

      this.holePos = { x: randX, z: randZ };
      if (this.holeMesh) {
        this.holeMesh.position.set(randX, 0, randZ);
      }
    },

    triggerConfetti(posX, posZ) {
      if (!this.platformGroup || !window.THREE) return;
      const THREE = window.THREE;
      const count = 48;
      const geom = new THREE.PlaneGeometry(0.09, 0.05);

      for (let i = 0; i < count; i++) {
        const color = this.confettiColors[Math.floor(Math.random() * this.confettiColors.length)];
        const mat = new THREE.MeshBasicMaterial({
          color: color,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 1.0
        });
        const mesh = new THREE.Mesh(geom, mat);
        const yPos = this.platformThickness / 2 + 0.08;
        mesh.position.set(posX, yPos, posZ);

        const angle = Math.random() * Math.PI * 2;
        const speedH = 0.9 + Math.random() * 2.2;
        const speedY = 2.4 + Math.random() * 3.0;

        this.platformGroup.add(mesh);
        this.confettiParticles.push({
          mesh: mesh,
          vx: Math.cos(angle) * speedH,
          vy: speedY,
          vz: Math.sin(angle) * speedH,
          rotSpeedX: (Math.random() - 0.5) * 16,
          rotSpeedY: (Math.random() - 0.5) * 16,
          rotSpeedZ: (Math.random() - 0.5) * 16,
          age: 0,
          life: 1.2 + Math.random() * 0.7
        });
      }
    },

    updateConfetti(dt) {
      if (!this.confettiParticles.length) return;
      const gravity = 8.0;
      for (let i = this.confettiParticles.length - 1; i >= 0; i--) {
        const p = this.confettiParticles[i];
        p.age += dt;
        if (p.age >= p.life) {
          if (p.mesh.parent) p.mesh.parent.remove(p.mesh);
          if (p.mesh.geometry) p.mesh.geometry.dispose();
          if (p.mesh.material) p.mesh.material.dispose();
          this.confettiParticles.splice(i, 1);
          continue;
        }

        p.vy -= gravity * dt;
        p.mesh.position.x += p.vx * dt;
        p.mesh.position.y += p.vy * dt;
        p.mesh.position.z += p.vz * dt;

        p.mesh.rotation.x += p.rotSpeedX * dt;
        p.mesh.rotation.y += p.rotSpeedY * dt;
        p.mesh.rotation.z += p.rotSpeedZ * dt;

        const remaining = p.life - p.age;
        if (remaining < 0.35) {
          p.mesh.material.opacity = Math.max(0, remaining / 0.35);
        }
      }
    },

    respawnBall() {
      this.isFalling = false;
      this.ballPos.x = 0;
      this.ballPos.z = 0;
      this.ballPosY = this.platformThickness / 2 + this.ballRadius;
      this.ballVel.x = 0;
      this.ballVel.z = 0;
      this.ballVelY = 0;
      if (this.ballMesh) {
        this.ballMesh.scale.set(1, 1, 1);
        this.ballMesh.position.set(0, this.ballPosY, 0);
        this.ballMesh.rotation.set(0, 0, 0);
      }
    },

    onDisconnect() {
      this.isOffline = true;
      this.isFalling = false;
      this.ballVel.x = 0;
      this.ballVel.z = 0;
      this.ballVelY = 0;
    },

    recenter() {
      this.pitchOffset = this.lastRawPitch || 0;
      this.rollOffset = this.lastRawRoll || 0;
      this.yawOffset = this.lastRawYaw || 0;
      this.pitch = 0;
      this.roll = 0;
      this.yaw = 0;
      this.respawnBall();
      if (this.platformGroup) {
        this.platformGroup.rotation.set(0, 0, 0);
      }
      for (const p of this.confettiParticles) {
        if (p.mesh.parent) p.mesh.parent.remove(p.mesh);
        if (p.mesh.geometry) p.mesh.geometry.dispose();
        if (p.mesh.material) p.mesh.material.dispose();
      }
      this.confettiParticles = [];
      this.spawnHole();
      this.updateHud();
      if (window.go?.main?.App?.ResetAHRS) {
        window.go.app.App.ResetAHRS().catch(() => {});
      }
    },

    animateScore(type) {
      const els = [
        document.getElementById('bench-hud-score'),
        document.getElementById('bench-fs-score')
      ];
      const cls = (type === 'up') ? 'bench-score-up' : 'bench-score-lost';
      els.forEach(el => {
        if (!el) return;
        el.classList.remove('bench-score-up', 'bench-score-lost');
        void el.offsetWidth;
        el.classList.add(cls);
        setTimeout(() => el.classList.remove(cls), 500);
      });
    },

    onFrame(frame) {
      if (!this.initialized || !this.platformGroup) return;
      this.isOffline = false;

      // Absolute AHRS controller attitude (100% drift-free and immune to fast-spin integration drift)
      if (frame && typeof frame.pitch === 'number') {
        const rawP = Number(frame.pitch || 0);
        const rawR = Number(frame.roll || 0);
        const rawY = Number(frame.yaw || 0);

        this.lastRawPitch = rawP;
        this.lastRawRoll = rawR;
        this.lastRawYaw = rawY;

        const deg2rad = Math.PI / 180;
        const targetP = -(rawP - this.pitchOffset) * deg2rad;
        const targetR = -(rawR - this.rollOffset) * deg2rad;
        const targetY = -(rawY - this.yawOffset) * deg2rad;

        // Smooth lerp tracking (snappy 1:1 responsive feel)
        const factor = 0.35;
        this.pitch += (targetP - this.pitch) * factor;
        this.roll += (targetR - this.roll) * factor;
        this.yaw += (targetY - this.yaw) * factor;

        this.platformGroup.rotation.x = this.pitch;
        this.platformGroup.rotation.z = this.roll;
        this.platformGroup.rotation.y = this.yaw;
      }
    },

    onMotion(vx, vy, vz, dt) {
      // Retained for backward compatibility
      if (!this.initialized || !this.platformGroup) return;
      this.isOffline = false;
    },

    updatePhysics(dt) {
      if (!this.platformGroup || !this.ballMesh) return;

      // When disconnected / offline: smoothly return platform to level and ball to center
      if (this.isOffline) {
        const levelSpeed = Math.min(1.0, dt * 6.0);
        this.pitch += (0 - this.pitch) * levelSpeed;
        this.roll += (0 - this.roll) * levelSpeed;
        this.yaw += (0 - this.yaw) * levelSpeed;
        this.platformGroup.rotation.set(this.pitch, this.yaw, this.roll);

        this.ballPos.x += (0 - this.ballPos.x) * levelSpeed;
        this.ballPos.z += (0 - this.ballPos.z) * levelSpeed;
        this.ballVel.x = 0;
        this.ballVel.z = 0;
        this.ballVelY = 0;
        this.isFalling = false;
        this.ballPosY = this.platformThickness / 2 + this.ballRadius;
        this.ballMesh.scale.set(1, 1, 1);
        this.ballMesh.position.set(this.ballPos.x, this.ballPosY, this.ballPos.z);
        this.updateHud();
        return;
      }

      if (this.isFalling) {
        this.ballVelY -= 32.0 * dt;
        this.ballPosY += this.ballVelY * dt;
        this.ballPos.x += this.ballVel.x * dt;
        this.ballPos.z += this.ballVel.z * dt;

        this.ballMesh.rotation.x += 10.0 * dt;
        this.ballMesh.rotation.z += 10.0 * dt;

        this.ballMesh.position.x = this.ballPos.x;
        this.ballMesh.position.y = this.ballPosY;
        this.ballMesh.position.z = this.ballPos.z;

        const progress = Math.min(1.0, Math.max(0.0, -this.ballPosY / 5.0));
        const s = Math.max(0.08, 1.0 - progress * 0.9);
        this.ballMesh.scale.set(s, s, s);

        if (this.ballPosY < -5.0) {
          this.respawnBall();
        }
        return;
      }

      // Gravity acceleration along inclined plane
      const gravity = 25.0;
      const ax = -Math.sin(this.roll) * gravity;
      const az = Math.sin(this.pitch) * gravity;

      this.ballVel.x += ax * dt;
      this.ballVel.z += az * dt;

      if (!this.isFullscreen) {
        // NON-FULLSCREEN MODE: Simple test sphere with protective borders!
        // No hole suction, no scoring, no falling off edges!
        const borderInset = 0.07 + this.ballRadius;
        const limitX = this.platformSizeX / 2 - borderInset;
        const limitZ = this.platformSizeZ / 2 - borderInset;

        if (this.ballPos.x > limitX) {
          this.ballPos.x = limitX;
          this.ballVel.x = -Math.abs(this.ballVel.x) * 0.45;
        } else if (this.ballPos.x < -limitX) {
          this.ballPos.x = -limitX;
          this.ballVel.x = Math.abs(this.ballVel.x) * 0.45;
        }

        if (this.ballPos.z > limitZ) {
          this.ballPos.z = limitZ;
          this.ballVel.z = -Math.abs(this.ballVel.z) * 0.45;
        } else if (this.ballPos.z < -limitZ) {
          this.ballPos.z = -limitZ;
          this.ballVel.z = Math.abs(this.ballVel.z) * 0.45;
        }

        // Rolling surface friction
        const damping = Math.pow(0.95, dt * 60);
        this.ballVel.x *= damping;
        this.ballVel.z *= damping;

        this.ballPos.x += this.ballVel.x * dt;
        this.ballPos.z += this.ballVel.z * dt;

        // Position ball on top of slab
        this.ballPosY = this.platformThickness / 2 + this.ballRadius;
        this.ballMesh.position.x = this.ballPos.x;
        this.ballMesh.position.y = this.ballPosY;
        this.ballMesh.position.z = this.ballPos.z;

        // Non-slip rolling rotation
        this.ballMesh.rotation.z -= (this.ballVel.x * dt) / this.ballRadius;
        this.ballMesh.rotation.x -= (this.ballVel.z * dt) / this.ballRadius;
        return;
      }

      // Suction pull near goal hole
      const distToHole = Math.hypot(this.ballPos.x - this.holePos.x, this.ballPos.z - this.holePos.z);
      if (distToHole < 0.32) {
        const pull = (0.32 - distToHole) * 30.0;
        const angle = Math.atan2(this.holePos.z - this.ballPos.z, this.holePos.x - this.ballPos.x);
        this.ballVel.x += Math.cos(angle) * pull * dt;
        this.ballVel.z += Math.sin(angle) * pull * dt;
      }

      // Goal detection: ball enters hole
      if (distToHole < 0.15) {
        this.score++;
        if (this.score > this.record) {
          this.record = this.score;
          localStorage.setItem('gb_platform_record', this.record.toString());
        }
        this.triggerConfetti(this.holePos.x, this.holePos.z);
        if (typeof SoundManager !== 'undefined' && SoundManager.play) {
          SoundManager.play('goal');
        }
        this.animateScore('up');
        this.spawnHole();
        this.respawnBall();
        this.updateHud();
        return;
      }

      // Rolling surface friction
      const damping = Math.pow(0.95, dt * 60);
      this.ballVel.x *= damping;
      this.ballVel.z *= damping;

      this.ballPos.x += this.ballVel.x * dt;
      this.ballPos.z += this.ballVel.z * dt;

      // Check if ball rolls over the open edge of the platform
      const halfX = this.platformSizeX / 2;
      const halfZ = this.platformSizeZ / 2;
      const contactRadius = this.ballRadius * 0.70;
      const overEdge = (Math.abs(this.ballPos.x) > halfX + contactRadius || Math.abs(this.ballPos.z) > halfZ + contactRadius);

      if (overEdge) {
        if (this.isOffline) {
          this.respawnBall();
          return;
        }
        this.isFalling = true;
        this.ballVelY = -0.8;
        this.ballPosY = this.platformThickness / 2 + this.ballRadius;

        if (typeof SoundManager !== 'undefined' && SoundManager.play) {
          SoundManager.play('defeat');
        }
        if (this.score > 0) {
          this.animateScore('lost');
        }
        this.score = 0;
        this.updateHud();
        return;
      }

      // Position ball on top of slab
      this.ballPosY = this.platformThickness / 2 + this.ballRadius;
      this.ballMesh.position.x = this.ballPos.x;
      this.ballMesh.position.y = this.ballPosY;
      this.ballMesh.position.z = this.ballPos.z;

      // Non-slip rolling rotation
      this.ballMesh.rotation.z -= (this.ballVel.x * dt) / this.ballRadius;
      this.ballMesh.rotation.x -= (this.ballVel.z * dt) / this.ballRadius;
    },

    cacheHudElements() {
      if (this.hudElements) return this.hudElements;
      this.hudElements = {
        score: document.getElementById('bench-hud-score'),
        record: document.getElementById('bench-hud-record'),
        pitch: document.getElementById('bench-hud-pitch'),
        roll: document.getElementById('bench-hud-roll'),
        fsScore: document.getElementById('bench-fs-score'),
        fsRecord: document.getElementById('bench-fs-record')
      };
      return this.hudElements;
    },

    updateHud(force = false) {
      const now = performance.now();
      const els = this.cacheHudElements();

      if (force || this.score !== this.lastHudScore) {
        this.lastHudScore = this.score;
        const scoreLabel = (typeof I18n !== 'undefined' ? I18n.t('settings_modal.bench_score') : '') || 'Счёт';
        if (els.score) els.score.textContent = `${scoreLabel}: ${this.score}`;
        if (els.fsScore) els.fsScore.textContent = this.score.toString();
      }

      if (force || this.record !== this.lastHudRecord) {
        this.lastHudRecord = this.record;
        const recordLabel = (typeof I18n !== 'undefined' ? I18n.t('settings_modal.bench_record') : '') || 'Рекорд';
        if (els.record) els.record.textContent = `${recordLabel}: ${this.record}`;
        if (els.fsRecord) els.fsRecord.textContent = this.record.toString();
      }

      if (force || (now - this.lastHudTs >= 100)) {
        this.lastHudTs = now;
        if (els.pitch) {
          const deg = this.pitch * (180 / Math.PI);
          els.pitch.textContent = `P: ${(deg >= 0 ? '+' : '')}${deg.toFixed(1)}°`;
        }
        if (els.roll) {
          const deg = -this.roll * (180 / Math.PI);
          els.roll.textContent = `R: ${(deg >= 0 ? '+' : '')}${deg.toFixed(1)}°`;
        }
      }
    },

    updateAndRender() {
      if (!this.initialized || !this.renderer || !this.scene || !this.camera) return;

      const now = performance.now();
      const dt = this.lastTickTs ? Math.min(0.05, Math.max(0.001, (now - this.lastTickTs) / 1000)) : 0.016;
      this.lastTickTs = now;

      this.updatePhysics(dt);
      this.updateConfetti(dt);

      if (this.beaconMesh && this.beaconMesh.material) {
        this.beaconMesh.material.opacity = 0.26 + Math.sin(now * 0.005) * 0.12;
      }

      if (this.cachedW <= 0) {
        this.syncDimensions(true);
      }

      this.renderer.render(this.scene, this.camera);
    }
  };
