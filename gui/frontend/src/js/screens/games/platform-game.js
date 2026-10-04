// ── Zelda 3D Shrine Platform Mini-Game (Apparatus Simulator) ───────────────

import { t } from '../../core/i18n.js';
import { call } from '../../core/bridge.js';
import { playSound } from '../../core/sound.js';

async function ensureThree() {
  if (typeof window !== 'undefined' && window.THREE) return window.THREE;
  const threeUrl = new URL('../../vendor/three.min.js', import.meta.url).href;
  await new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${threeUrl}"]`);
    if (existing) {
      if (window.THREE) return resolve(window.THREE);
      existing.addEventListener('load', () => resolve(window.THREE), { once: true });
      existing.addEventListener('error', reject, { once: true });
      return;
    }
    const s = document.createElement('script');
    s.src = threeUrl;
    s.onload = () => resolve(window.THREE);
    s.onerror = reject;
    document.head.appendChild(s);
  });
  return window.THREE;
}

export const PlatformGame = {
  initializing: false,
  initialized: false,
  renderer: null,
  scene: null,
  camera: null,
  platformGroup: null,
  slabMesh: null,
  slabMat: null,
  pedMat: null,
  pedMid: null,
  pedLow: null,
  gimbalHub: null,
  hubRing: null,
  edgeLine: null,
  runeGroup: null,
  rimGroup: null,
  wallsGroup: null,
  wallMat: null,
  wallCapMat: null,
  walls: [],
  ballMesh: null,
  holeMesh: null,
  score: 0,
  record: parseInt(localStorage.getItem('gb_platform_record') || '0', 10),
  isOffline: false,
  pitch: 0, // rad (tilt around X)
  roll: 0,  // rad (tilt around Z)
  yaw: 0,   // rad (turn around Y)
  pitchVel: 0, // rad/s (heavy apparatus angular velocity)
  rollVel: 0,
  yawVel: 0,
  targetPitch: 0, // rad (controller target attitude)
  targetRoll: 0,
  targetYaw: 0,
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
  isPaused: false,
  isFalling: false,
  holePos: { x: 0.9, z: -0.3 },
  ballRadius: 0.14,
  platformSizeX: 4.4,
  platformSizeZ: 2.6,
  platformThickness: 0.18,
  confettiParticles: [],
  confettiColors: [0xd4af37, 0xc8822c, 0xdfc272, 0xa67c2e, 0x8a6e38, 0xf4ebd9],
  lastTickTs: 0,
  cachedW: 0,
  cachedH: 0,
  hudElements: null,
  lastHudTrial: -1,
  lastHudScore: -1,
  lastHudRecord: -1,
  lastHudTs: 0,
  fpsFrames: 0,
  fpsLastTs: 0,
  lastHudFps: -1,
  fpsValEl: null,
  holdProgress: 0,
  gaugeMesh: null,
  gaugeGeo: null,
  gaugeTrack: null,
  _holdOsc: null,
  _holdGain: null,
  isReadyPrompt: true,
  _placeholder: null,
  _audioCtx: null,
  ro: null,

  syncDimensions(force = false) {
    const canvas = document.getElementById('bench-platform-canvas');
    const vp = document.getElementById('bench-platform-viewport');
    if (!canvas || !this.renderer || !this.camera) return;

    const rect = vp ? vp.getBoundingClientRect() : canvas.getBoundingClientRect();
    const w = Math.floor(rect.width || canvas.clientWidth || (window.innerWidth || 800));
    const h = Math.floor(rect.height || canvas.clientHeight || (window.innerHeight || 500));
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
      const targetHalfW = this.platformSizeX * 0.62;
      const targetHalfH = this.platformSizeZ * 0.68;
      const distW = targetHalfW / (Math.tan(fovRad / 2) * aspect);
      const distH = targetHalfH / Math.tan(fovRad / 2);
      const dist = Math.max(distW, distH, 4.4);
      this.camera.position.set(0, dist * 0.66, dist * 0.86);
      this.camera.lookAt(0, -0.04, 0);
      this.camera.updateProjectionMatrix();
    }
  },

  async init() {
    if (this.initialized || this.initializing) return;
    this.initializing = true;

    try {
      let canvas = document.getElementById('bench-platform-canvas');
      const vp = document.getElementById('bench-platform-viewport');
      if (!canvas) return;

      await ensureThree();
      if (!window.THREE) return;

      const THREE = window.THREE;

      // Ensure canvas has no stale lost context
      if (canvas.dataset.contextLost === 'true') {
        const freshCanvas = canvas.cloneNode(false);
        delete freshCanvas.dataset.contextLost;
        canvas.parentNode.replaceChild(freshCanvas, canvas);
        canvas = freshCanvas;
      }

      let renderer = null;
      try {
        renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
      } catch (err) {
        console.warn('WebGL init fallback with fresh canvas:', err);
        const freshCanvas = canvas.cloneNode(false);
        delete freshCanvas.dataset.contextLost;
        canvas.parentNode.replaceChild(freshCanvas, canvas);
        canvas = freshCanvas;
        renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
      }

      canvas.addEventListener('webglcontextlost', (e) => {
        e.preventDefault();
        canvas.dataset.contextLost = 'true';
      }, false);

      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.renderer = renderer;

      if (this.ro) {
        try { this.ro.disconnect(); } catch (_) {}
        this.ro = null;
      }
      if (typeof ResizeObserver !== 'undefined' && vp) {
        this.ro = new ResizeObserver(() => {
          this.syncDimensions(false);
        });
        this.ro.observe(vp);
      }

      const scene = new THREE.Scene();
      this.scene = scene;

      const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 50);
      camera.position.set(0, 3.6, 4.4);
      camera.lookAt(0, -0.05, 0);
      this.camera = camera;

      // Natural Outdoor Hyrule Lighting (BotW Golden Hour Atmosphere)
      const hemiLight = new THREE.HemisphereLight(0xe8e6d9, 0x6e6854, 0.85);
      scene.add(hemiLight);

      const sunLight = new THREE.DirectionalLight(0xffdfb0, 1.35);
      sunLight.position.set(4.5, 7.0, 3.8);
      scene.add(sunLight);

      const fillLight = new THREE.DirectionalLight(0xa5b8a6, 0.45);
      fillLight.position.set(-3.5, 4.0, -3.0);
      scene.add(fillLight);

      // Platform Root Group (rotates on central gimbal pivot)
      const platformGroup = new THREE.Group();
      scene.add(platformGroup);
      this.platformGroup = platformGroup;

      const isLight = (document.documentElement.getAttribute('data-theme') === 'light' || document.body.getAttribute('data-theme') === 'light');

      // 1. Main Ancient Shrine Weathered Stone Top Slab
      const slabGeo = new THREE.BoxGeometry(this.platformSizeX, this.platformThickness, this.platformSizeZ);
      const slateMat = new THREE.MeshStandardMaterial({
        color: isLight ? 0x646053 : 0x38362f,
        roughness: 0.80,
        metalness: 0.12
      });
      const slabMesh = new THREE.Mesh(slabGeo, slateMat);
      platformGroup.add(slabMesh);
      this.slabMesh = slabMesh;
      this.slabMat = slateMat;

      // 2. Zelda Underside Tapered Stone Pedestal & Gimbal Hub
      const pedMat = new THREE.MeshStandardMaterial({
        color: isLight ? 0x4a473d : 0x24231e,
        roughness: 0.85,
        metalness: 0.08
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

      // Gimbal Hub & Antique Hammered Brass Collar
      const hubGeo = new THREE.CylinderGeometry(0.30, 0.36, 0.18, 24);
      const hubMat = new THREE.MeshStandardMaterial({
        color: 0x5e4b30,
        metalness: 0.65,
        roughness: 0.52
      });
      const gimbalHub = new THREE.Mesh(hubGeo, hubMat);
      gimbalHub.position.y = -this.platformThickness / 2 - 0.24;
      platformGroup.add(gimbalHub);
      this.gimbalHub = gimbalHub;

      const hubRingGeo = new THREE.TorusGeometry(0.32, 0.015, 12, 32);
      const hubRingMat = new THREE.MeshStandardMaterial({
        color: 0x8a6e38,
        metalness: 0.70,
        roughness: 0.45
      });
      const hubRing = new THREE.Mesh(hubRingGeo, hubRingMat);
      hubRing.rotation.x = Math.PI / 2;
      hubRing.position.y = -this.platformThickness / 2 - 0.24;
      platformGroup.add(hubRing);
      this.hubRing = hubRing;

      // 3. Surface Carved Stone Relief & Border Groove
      this.createEdgeLine();
      this.createRunes();

      // 4. Shrine Ancient Goal Socket (Carved Stone Receptacle)
      const holeGroup = new THREE.Group();

      // Deep dark stone pit
      const holePitGeo = new THREE.CircleGeometry(0.18, 32);
      const holePitMat = new THREE.MeshBasicMaterial({
        color: 0x12110f,
        side: THREE.DoubleSide
      });
      const holePit = new THREE.Mesh(holePitGeo, holePitMat);
      holePit.rotation.x = -Math.PI / 2;
      holePit.position.y = this.platformThickness / 2 + 0.002;
      holeGroup.add(holePit);

      // Outer patinated bronze collar
      const collarGeo = new THREE.TorusGeometry(0.19, 0.016, 12, 32);
      const collarMat = new THREE.MeshStandardMaterial({
        color: 0x8a6e38,
        metalness: 0.75,
        roughness: 0.42
      });
      const collar = new THREE.Mesh(collarGeo, collarMat);
      collar.rotation.x = Math.PI / 2;
      collar.position.y = this.platformThickness / 2 + 0.003;
      holeGroup.add(collar);

      // Antique hammered brass funnel rim
      const holeRimGeo = new THREE.RingGeometry(0.15, 0.19, 32);
      const holeRimMat = new THREE.MeshStandardMaterial({
        color: 0x9e8042,
        side: THREE.DoubleSide,
        metalness: 0.78,
        roughness: 0.38
      });
      const holeRim = new THREE.Mesh(holeRimGeo, holeRimMat);
      holeRim.rotation.x = -Math.PI / 2;
      holeRim.position.y = this.platformThickness / 2 + 0.004;
      holeGroup.add(holeRim);

      // Outer circular gauge track (chiseled stone relief channel)
      const isLightTheme = (document.documentElement.getAttribute('data-theme') === 'light' || document.body.getAttribute('data-theme') === 'light');
      const trackGeo = new THREE.RingGeometry(0.225, 0.285, 64);
      const trackMat = new THREE.MeshBasicMaterial({
        color: isLightTheme ? 0x3d3a32 : 0x181714,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.45
      });
      const trackMesh = new THREE.Mesh(trackGeo, trackMat);
      trackMesh.rotation.x = -Math.PI / 2;
      trackMesh.position.y = this.platformThickness / 2 + 0.003;
      holeGroup.add(trackMesh);
      this.gaugeTrack = trackMesh;

      // Active circular progress ring (ancient Sheikah amber-gold energy filling clockwise)
      const gaugeGeo = new THREE.RingGeometry(0.225, 0.285, 64, 1, Math.PI / 2, Math.PI * 2);
      const gaugeMat = new THREE.MeshBasicMaterial({
        color: 0xd4af37,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.95
      });
      const gaugeMesh = new THREE.Mesh(gaugeGeo, gaugeMat);
      gaugeMesh.rotation.x = -Math.PI / 2;
      gaugeMesh.scale.x = -1; // Sweeps clockwise from top (12 o'clock)
      gaugeMesh.position.y = this.platformThickness / 2 + 0.005;
      gaugeGeo.setDrawRange(0, 0);
      gaugeMesh.visible = false;
      holeGroup.add(gaugeMesh);
      this.gaugeMesh = gaugeMesh;
      this.gaugeGeo = gaugeGeo;

      platformGroup.add(holeGroup);
      this.holeMesh = holeGroup;
      holeGroup.visible = true;

      // 5. Ancient Shrine Protective Borders (Bortiki)
      this.createBorders();

      // 6. Dynamic Obstacle Walls Group
      const wallsGroup = new THREE.Group();
      platformGroup.add(wallsGroup);
      this.wallsGroup = wallsGroup;

      // 7. Ancient Shrine Relic Orb (Burnished BotW Bronze Sphere)
      const ballGroup = new THREE.Group();
      const ballGeo = new THREE.SphereGeometry(this.ballRadius, 32, 32);
      const ballMat = new THREE.MeshStandardMaterial({
        color: 0x9c7a3c,
        roughness: 0.30,
        metalness: 0.82
      });
      const ballCore = new THREE.Mesh(ballGeo, ballMat);
      ballGroup.add(ballCore);

      // Dark carved equator & meridian inlays (incised metal relief)
      const eqRingGeo = new THREE.TorusGeometry(this.ballRadius + 0.001, 0.005, 12, 32);
      const grooveMat = new THREE.MeshStandardMaterial({
        color: 0x2f2616,
        roughness: 0.75,
        metalness: 0.50
      });
      const eqRing = new THREE.Mesh(eqRingGeo, grooveMat);
      ballGroup.add(eqRing);

      const merRingGeo = new THREE.TorusGeometry(this.ballRadius + 0.001, 0.005, 12, 32);
      const merRing = new THREE.Mesh(merRingGeo, grooveMat);
      merRing.rotation.y = Math.PI / 2;
      ballGroup.add(merRing);

      this.ballPosY = this.platformThickness / 2 + this.ballRadius;
      ballGroup.position.set(0, this.ballPosY, 0);
      platformGroup.add(ballGroup);
      this.ballMesh = ballGroup;

      const btnStart = document.getElementById('btn-platform-start');
      if (btnStart) {
        btnStart.onclick = () => {
          this.startGame();
        };
      }

      this.initialized = true;
      this.recenter();
      this.syncDimensions(true);
    } finally {
      this.initializing = false;
    }
  },

  startGame() {
    this.isReadyPrompt = false;
    const readyEl = document.getElementById('bench-platform-ready');
    if (readyEl) readyEl.classList.add('is-hidden');
    this.recenter();
  },

  resetFull() {
    this.score = 0;
    this.holdProgress = 0;
    this.stopHoldAudio();
    if (this.gaugeGeo) this.gaugeGeo.setDrawRange(0, 0);
    if (this.gaugeMesh) this.gaugeMesh.visible = false;
    this.pitch = 0;
    this.roll = 0;
    this.yaw = 0;
    this.pitchVel = 0;
    this.rollVel = 0;
    this.yawVel = 0;
    this.targetPitch = 0;
    this.targetRoll = 0;
    this.targetYaw = 0;
    this.respawnBall();
    if (this.platformGroup) {
      this.platformGroup.rotation.set(0, 0, 0);
    }
    for (const p of this.confettiParticles) {
      if (p.mesh && p.mesh.parent) p.mesh.parent.remove(p.mesh);
      if (p.mesh && p.mesh.geometry) p.mesh.geometry.dispose();
      if (p.mesh && p.mesh.material) p.mesh.material.dispose();
    }
    this.confettiParticles = [];
    this.spawnHole();
    this.spawnWalls();
    this.updateHud(true);

    // Re-enable and show the preparation modal with blur
    this.isReadyPrompt = true;
    const readyEl = document.getElementById('bench-platform-ready');
    if (readyEl) readyEl.classList.remove('is-hidden');
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
    const isLight = (document.documentElement.getAttribute('data-theme') === 'light' || document.body.getAttribute('data-theme') === 'light');
    const edgeGeo = new THREE.BufferGeometry().setFromPoints(points);
    const edgeMat = new THREE.LineBasicMaterial({
      color: isLight ? 0x3d3a32 : 0x1f1e1a,
      transparent: true,
      opacity: 0.55
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

    const isLight = (document.documentElement.getAttribute('data-theme') === 'light' || document.body.getAttribute('data-theme') === 'light');
    const carvedMat = new THREE.MeshBasicMaterial({
      color: isLight ? 0x3d3a32 : 0x1f1e1a,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.35
    });

    // Outer concentric carved relief ring
    const ring1Geo = new THREE.RingGeometry(0.32, 0.35, 32);
    const ring1 = new THREE.Mesh(ring1Geo, carvedMat);
    ring1.rotation.x = -Math.PI / 2;
    ring1.position.y = y;
    runeGroup.add(ring1);

    // Inner concentric carved relief ring
    const ring2Geo = new THREE.RingGeometry(0.18, 0.20, 32);
    const ring2 = new THREE.Mesh(ring2Geo, carvedMat);
    ring2.rotation.x = -Math.PI / 2;
    ring2.position.y = y + 0.001;
    runeGroup.add(ring2);

    // Center circular relief dot
    const dotGeo = new THREE.CircleGeometry(0.06, 24);
    const dot = new THREE.Mesh(dotGeo, carvedMat);
    dot.rotation.x = -Math.PI / 2;
    dot.position.y = y + 0.002;
    runeGroup.add(dot);

    // Radiating stone relief channels
    const hx = this.platformSizeX / 2 - 0.25;
    const hz = this.platformSizeZ / 2 - 0.25;
    const lineMat = new THREE.LineBasicMaterial({
      color: isLight ? 0x3d3a32 : 0x1f1e1a,
      transparent: true,
      opacity: 0.28
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
      runeGroup.add(new THREE.Line(lineGeo, lineMat));
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
      color: isLight ? 0x4a473d : 0x282622,
      roughness: 0.75,
      metalness: 0.20
    });

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

    this.platformGroup.add(rimGroup);
    // Open borders for arcade pit physics
    rimGroup.visible = false;
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
    this.spawnWalls();
  },

  updateTheme(theme) {
    const isLight = (theme === 'light');
    if (this.slabMat) {
      this.slabMat.color.setHex(isLight ? 0x646053 : 0x38362f);
    }
    if (this.pedMat) {
      this.pedMat.color.setHex(isLight ? 0x4a473d : 0x24231e);
    }
    if (this.wallMat) {
      this.wallMat.color.setHex(isLight ? 0x646053 : 0x38362f);
    }
    if (this.wallCapMat) {
      this.wallCapMat.color.setHex(isLight ? 0x4a473d : 0x262420);
    }
    if (this.gaugeTrack && this.gaugeTrack.material) {
      this.gaugeTrack.material.color.setHex(isLight ? 0x3d3a32 : 0x181714);
    }
    this.createEdgeLine();
    this.createRunes();
  },

  playStoneHit(intensity = 0.5) {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      if (!this._audioCtx) {
        this._audioCtx = new AudioCtx();
      }
      if (this._audioCtx.state === 'suspended') {
        this._audioCtx.resume().catch(() => {});
      }
      const ctx = this._audioCtx;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      const freq = 120 + Math.random() * 40;
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now);
      osc.frequency.exponentialRampToValueAtTime(40, now + 0.045);

      const vol = Math.min(0.25, Math.max(0.04, intensity * 0.20));
      gain.gain.setValueAtTime(vol, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.045);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.05);
    } catch (_) {}
  },

  updateHoldAudio(progress) {
    try {
      if (progress <= 0.01 || progress >= 1.0) {
        this.stopHoldAudio();
        return;
      }
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      if (!this._audioCtx) {
        this._audioCtx = new AudioCtx();
      }
      if (this._audioCtx.state === 'suspended') {
        this._audioCtx.resume().catch(() => {});
      }
      const ctx = this._audioCtx;
      const now = ctx.currentTime;

      if (!this._holdOsc) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(220, now);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.06, now + 0.05);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);

        this._holdOsc = osc;
        this._holdGain = gain;
      }

      // Smoothly pitch up from 220 Hz to 520 Hz as ring completes
      const targetFreq = 220 + Math.pow(progress, 1.3) * 300;
      this._holdOsc.frequency.setTargetAtTime(targetFreq, now, 0.03);
    } catch (_) {}
  },

  stopHoldAudio() {
    try {
      if (this._holdOsc && this._audioCtx) {
        const ctx = this._audioCtx;
        const now = ctx.currentTime;
        if (this._holdGain) {
          this._holdGain.gain.cancelScheduledValues(now);
          this._holdGain.gain.setValueAtTime(this._holdGain.gain.value, now);
          this._holdGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.03);
        }
        const osc = this._holdOsc;
        setTimeout(() => {
          try {
            osc.stop();
            osc.disconnect();
          } catch (_) {}
        }, 35);
        this._holdOsc = null;
        this._holdGain = null;
      }
    } catch (_) {}
  },

  spawnHole() {
    this.holdProgress = 0;
    this.stopHoldAudio();
    if (this.gaugeGeo) this.gaugeGeo.setDrawRange(0, 0);
    if (this.gaugeMesh) this.gaugeMesh.visible = false;

    const marginX = 0.50;
    const marginZ = 0.40;
    const maxSpawnX = (this.platformSizeX / 2) - this.ballRadius - marginX;
    const maxSpawnZ = (this.platformSizeZ / 2) - this.ballRadius - marginZ;

    const bX = (this.ballPos && typeof this.ballPos.x === 'number') ? this.ballPos.x : 0;
    const bZ = (this.ballPos && typeof this.ballPos.z === 'number') ? this.ballPos.z : 0;

    let randX = 0;
    let randZ = 0;
    let attempts = 0;
    do {
      const targetSideX = (bX >= 0) ? -1 : 1;
      const minX = targetSideX > 0 ? 0.6 : -maxSpawnX;
      const maxX = targetSideX > 0 ? maxSpawnX : -0.6;
      randX = minX + Math.random() * (maxX - minX);
      randZ = (Math.random() * 2 - 1) * maxSpawnZ;
      attempts++;
    } while (Math.hypot(randX - bX, randZ - bZ) < 1.35 && attempts < 35);

    this.holePos = { x: randX, z: randZ };
    if (this.holeMesh) {
      this.holeMesh.position.set(randX, 0, randZ);
    }
  },

  clearWalls() {
    if (this.wallsGroup) {
      for (const w of this.walls) {
        if (w.mesh) {
          this.wallsGroup.remove(w.mesh);
          w.mesh.traverse((child) => {
            if (child.geometry) child.geometry.dispose();
          });
        }
      }
    }
    this.walls = [];
  },

  spawnWalls() {
    if (!this.platformGroup || !this.wallsGroup || !window.THREE) return;
    this.clearWalls();

    const THREE = window.THREE;
    const isLight = (document.documentElement.getAttribute('data-theme') === 'light' || document.body.getAttribute('data-theme') === 'light');
    if (!this.wallMat) {
      this.wallMat = new THREE.MeshStandardMaterial({
        color: isLight ? 0x646053 : 0x38362f,
        roughness: 0.82,
        metalness: 0.10
      });
    }
    if (!this.wallCapMat) {
      this.wallCapMat = new THREE.MeshStandardMaterial({
        color: isLight ? 0x4a473d : 0x262420,
        roughness: 0.85,
        metalness: 0.08
      });
    }

    const bX = (this.ballPos && typeof this.ballPos.x === 'number') ? this.ballPos.x : 0;
    const bZ = (this.ballPos && typeof this.ballPos.z === 'number') ? this.ballPos.z : 0;
    const hX = (this.holePos && typeof this.holePos.x === 'number') ? this.holePos.x : 0.9;
    const hZ = (this.holePos && typeof this.holePos.z === 'number') ? this.holePos.z : -0.3;

    const dx = hX - bX;
    const dz = hZ - bZ;
    const dist = Math.hypot(dx, dz);
    const dirX = dist > 0.001 ? dx / dist : 1;
    const dirZ = dist > 0.001 ? dz / dist : 0;
    const normX = -dirZ;
    const normZ = dirX;

    const wallH = 0.18;
    const wallThick = 0.12;
    const yPos = this.platformThickness / 2 + wallH / 2;

    const currentTrial = this.score + 1;
    const wallDefs = [];

    if (currentTrial === 1) {
      // Trial 1: "The Intercept" - 1 strategic barrier across direct trajectory
      const midX = (bX + hX) / 2;
      const midZ = (bZ + hZ) / 2;
      const isHoriz = Math.abs(normX) > Math.abs(normZ);
      const len = 0.85;
      const offsetSign = (midZ >= 0) ? -1 : 1;
      const posX = midX + normX * 0.12 * offsetSign;
      const posZ = midZ + normZ * 0.12 * offsetSign;
      wallDefs.push({
        x: posX,
        z: posZ,
        halfW: isHoriz ? len / 2 : wallThick / 2,
        halfD: isHoriz ? wallThick / 2 : len / 2
      });
    } else if (currentTrial === 2) {
      // Trial 2: "The Chicane" - 2 staggered walls creating an S-turn slalom
      const p1X = bX + dirX * dist * 0.35 + normX * 0.42;
      const p1Z = bZ + dirZ * dist * 0.35 + normZ * 0.42;
      const p2X = bX + dirX * dist * 0.68 - normX * 0.42;
      const p2Z = bZ + dirZ * dist * 0.68 - normZ * 0.42;

      const isH1 = Math.abs(normX) > Math.abs(normZ);
      wallDefs.push({
        x: p1X,
        z: p1Z,
        halfW: isH1 ? 0.45 : wallThick / 2,
        halfD: isH1 ? wallThick / 2 : 0.45
      });
      wallDefs.push({
        x: p2X,
        z: p2Z,
        halfW: isH1 ? 0.45 : wallThick / 2,
        halfD: isH1 ? wallThick / 2 : 0.45
      });
    } else if (currentTrial === 3) {
      // Trial 3: "The Gatekeeper" - Goal shield wall + approach baffle
      const guardDist = 0.48;
      const gX = hX - dirX * guardDist;
      const gZ = hZ - dirZ * guardDist;
      const isHGuard = Math.abs(normX) > Math.abs(normZ);
      wallDefs.push({
        x: gX,
        z: gZ,
        halfW: isHGuard ? 0.42 : wallThick / 2,
        halfD: isHGuard ? wallThick / 2 : 0.42
      });

      const bMidX = bX + dirX * dist * 0.40 + normX * 0.35;
      const bMidZ = bZ + dirZ * dist * 0.40 + normZ * 0.35;
      wallDefs.push({
        x: bMidX,
        z: bMidZ,
        halfW: isHGuard ? wallThick / 2 : 0.40,
        halfD: isHGuard ? 0.40 : wallThick / 2
      });
    } else if (currentTrial === 4) {
      // Trial 4: "The Triple Labyrinth" - 3 coordinated obstacles
      const isH = Math.abs(normX) > Math.abs(normZ);
      wallDefs.push({
        x: (bX + hX) / 2 + normX * 0.20,
        z: (bZ + hZ) / 2 + normZ * 0.20,
        halfW: isH ? 0.42 : wallThick / 2,
        halfD: isH ? wallThick / 2 : 0.42
      });
      wallDefs.push({
        x: bX + dirX * dist * 0.30 - normX * 0.45,
        z: bZ + dirZ * dist * 0.30 - normZ * 0.45,
        halfW: isH ? 0.38 : wallThick / 2,
        halfD: isH ? wallThick / 2 : 0.38
      });
      wallDefs.push({
        x: hX - dirX * 0.45 + normX * 0.35,
        z: hZ - dirZ * 0.45 + normZ * 0.35,
        halfW: isH ? wallThick / 2 : 0.38,
        halfD: isH ? 0.38 : wallThick / 2
      });
    } else {
      // Trial 5+: "Master Shrine Apparatus"
      const variant = currentTrial % 3;
      const isH = Math.abs(normX) > Math.abs(normZ);
      if (variant === 0) {
        wallDefs.push({
          x: bX + dirX * dist * 0.25 + normX * 0.40,
          z: bZ + dirZ * dist * 0.25 + normZ * 0.40,
          halfW: isH ? 0.40 : wallThick / 2,
          halfD: isH ? wallThick / 2 : 0.40
        });
        wallDefs.push({
          x: bX + dirX * dist * 0.50 - normX * 0.40,
          z: bZ + dirZ * dist * 0.50 - normZ * 0.40,
          halfW: isH ? 0.40 : wallThick / 2,
          halfD: isH ? wallThick / 2 : 0.40
        });
        wallDefs.push({
          x: bX + dirX * dist * 0.75 + normX * 0.38,
          z: bZ + dirZ * dist * 0.75 + normZ * 0.38,
          halfW: isH ? 0.38 : wallThick / 2,
          halfD: isH ? wallThick / 2 : 0.38
        });
      } else if (variant === 1) {
        wallDefs.push({
          x: (bX + hX) / 2,
          z: (bZ + hZ) / 2,
          halfW: isH ? 0.55 : wallThick / 2,
          halfD: isH ? wallThick / 2 : 0.55
        });
        wallDefs.push({
          x: hX - dirX * 0.42 - normX * 0.36,
          z: hZ - dirZ * 0.42 - normZ * 0.36,
          halfW: isH ? wallThick / 2 : 0.35,
          halfD: isH ? 0.35 : wallThick / 2
        });
        wallDefs.push({
          x: hX - dirX * 0.42 + normX * 0.36,
          z: hZ - dirZ * 0.42 + normZ * 0.36,
          halfW: isH ? wallThick / 2 : 0.35,
          halfD: isH ? 0.35 : wallThick / 2
        });
      } else {
        wallDefs.push({
          x: bX + dirX * dist * 0.35,
          z: bZ + dirZ * dist * 0.35 - 0.25,
          halfW: 0.45,
          halfD: wallThick / 2
        });
        wallDefs.push({
          x: bX + dirX * dist * 0.65,
          z: bZ + dirZ * dist * 0.65 + 0.25,
          halfW: 0.45,
          halfD: wallThick / 2
        });
        wallDefs.push({
          x: hX - dirX * 0.48,
          z: hZ - dirZ * 0.48,
          halfW: wallThick / 2,
          halfD: 0.38
        });
      }
    }

    const maxClampX = (this.platformSizeX / 2) - 0.28;
    const maxClampZ = (this.platformSizeZ / 2) - 0.24;

    for (const def of wallDefs) {
      const clampedX = Math.max(-maxClampX + def.halfW, Math.min(maxClampX - def.halfW, def.x));
      const clampedZ = Math.max(-maxClampZ + def.halfD, Math.min(maxClampZ - def.halfD, def.z));

      // Never cover ball
      const cBx = Math.max(clampedX - def.halfW, Math.min(bX, clampedX + def.halfW));
      const cBz = Math.max(clampedZ - def.halfD, Math.min(bZ, clampedZ + def.halfD));
      if (Math.hypot(bX - cBx, bZ - cBz) < 0.35) continue;

      // Never cover hole
      const cHx = Math.max(clampedX - def.halfW, Math.min(hX, clampedX + def.halfW));
      const cHz = Math.max(clampedZ - def.halfD, Math.min(hZ, clampedZ + def.halfD));
      if (Math.hypot(hX - cHx, hZ - cHz) < 0.40) continue;

      const sizeX = def.halfW * 2;
      const sizeZ = def.halfD * 2;
      const wallGroup = new THREE.Group();
      wallGroup.position.set(clampedX, yPos, clampedZ);

      // Base monolithic stone block
      const boxGeo = new THREE.BoxGeometry(sizeX, wallH, sizeZ);
      const boxMesh = new THREE.Mesh(boxGeo, this.wallMat);
      wallGroup.add(boxMesh);

      // Chiseled darker stone cap/crown on top (matte natural stone relief)
      const capGeo = new THREE.BoxGeometry(sizeX * 0.96, 0.016, sizeZ * 0.96);
      const capMesh = new THREE.Mesh(capGeo, this.wallCapMat);
      capMesh.position.y = wallH / 2 + 0.008;
      wallGroup.add(capMesh);

      this.wallsGroup.add(wallGroup);
      this.walls.push({
        x: clampedX,
        z: clampedZ,
        halfW: def.halfW,
        halfD: def.halfD,
        mesh: wallGroup
      });
    }
  },

  triggerConfetti(posX, posZ) {
    if (!this.platformGroup || !window.THREE) return;
    const THREE = window.THREE;
    const count = 16;
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
    this.holdProgress = 0;
    this.stopHoldAudio();
    if (this.gaugeGeo) this.gaugeGeo.setDrawRange(0, 0);
    if (this.gaugeMesh) this.gaugeMesh.visible = false;
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
    this.holdProgress = 0;
    this.stopHoldAudio();
    if (this.gaugeGeo) this.gaugeGeo.setDrawRange(0, 0);
    if (this.gaugeMesh) this.gaugeMesh.visible = false;
    this.ballVel.x = 0;
    this.ballVel.z = 0;
    this.ballVelY = 0;
  },

  recenter() {
    this.holdProgress = 0;
    this.stopHoldAudio();
    if (this.gaugeGeo) this.gaugeGeo.setDrawRange(0, 0);
    if (this.gaugeMesh) this.gaugeMesh.visible = false;
    this.pitchOffset = this.lastRawPitch || 0;
    this.rollOffset = this.lastRawRoll || 0;
    this.yawOffset = this.lastRawYaw || 0;
    this.pitch = 0;
    this.roll = 0;
    this.yaw = 0;
    this.pitchVel = 0;
    this.rollVel = 0;
    this.yawVel = 0;
    this.targetPitch = 0;
    this.targetRoll = 0;
    this.targetYaw = 0;
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
    this.spawnWalls();
    this.updateHud(true);
    call('ResetAHRS').catch(() => {});
  },

  animateScore(type) {
    const els = [
      document.getElementById('bench-platform-score-pill'),
      document.getElementById('bench-hud-score')
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
    if (!this.initialized || !this.platformGroup || this.isPaused) return;
    this.isOffline = false;

    // Absolute AHRS controller attitude
    const pVal = (frame.pitch !== undefined) ? frame.pitch : (frame.Pitch !== undefined ? frame.Pitch : null);
    if (pVal !== null) {
      const rawP = Number(pVal || 0);
      const rawR = Number(frame.roll !== undefined ? frame.roll : (frame.Roll || 0));
      const rawY = Number(frame.yaw !== undefined ? frame.yaw : (frame.Yaw || 0));

      this.lastRawPitch = rawP;
      this.lastRawRoll = rawR;
      this.lastRawYaw = rawY;

      const deg2rad = Math.PI / 180;
      this.targetPitch = -(rawP - this.pitchOffset) * deg2rad;
      this.targetRoll = -(rawR - this.rollOffset) * deg2rad;
      this.targetYaw = -(rawY - this.yawOffset) * deg2rad;
    }
  },

  updatePhysics(dt) {
    if (!this.platformGroup || !this.ballMesh) return;

    // Before game start: wait for user to click Start in the blur overlay
    if (this.isReadyPrompt) {
      this.platformGroup.rotation.set(0, 0, 0);
      this.pitch = 0;
      this.roll = 0;
      this.yaw = 0;
      this.pitchVel = 0;
      this.rollVel = 0;
      this.yawVel = 0;
      this.ballPos.x = 0;
      this.ballPos.z = 0;
      this.ballVel.x = 0;
      this.ballVel.z = 0;
      this.ballPosY = this.platformThickness / 2 + this.ballRadius;
      if (this.ballMesh) {
        this.ballMesh.position.set(0, this.ballPosY, 0);
        this.ballMesh.rotation.set(0, 0, 0);
      }
      return;
    }

    // When disconnected / offline: smoothly return platform to level and ball to center
    if (this.isOffline) {
      this.holdProgress = 0;
      this.stopHoldAudio();
      if (this.gaugeGeo) this.gaugeGeo.setDrawRange(0, 0);
      if (this.gaugeMesh) this.gaugeMesh.visible = false;
      this.targetPitch = 0;
      this.targetRoll = 0;
      this.targetYaw = 0;
      this.pitchVel = 0;
      this.rollVel = 0;
      this.yawVel = 0;

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

    // Heavy ancient stone apparatus rotational inertia (BotW Shrine Apparatus)
    // 2nd-order spring-damper tracking with physical inertia & torque
    const omega = 4.2; // Natural frequency (rad/s) — gives deliberate mechanical weight and noticeable input lag
    const zeta = 0.94; // Damping ratio — near-critical with subtle mechanical settling
    const maxAngVel = 2.2; // Max angular velocity (rad/s) — prevents instant unnatural whip

    const stepAngle = (cur, target, vel) => {
      const diff = target - cur;
      const accel = diff * (omega * omega) - 2.0 * zeta * omega * vel;
      let nextVel = vel + accel * dt;
      nextVel = Math.max(-maxAngVel, Math.min(maxAngVel, nextVel));
      const nextPos = cur + nextVel * dt;
      return [nextPos, nextVel];
    };

    [this.pitch, this.pitchVel] = stepAngle(this.pitch, this.targetPitch, this.pitchVel);
    [this.roll, this.rollVel] = stepAngle(this.roll, this.targetRoll, this.rollVel);
    [this.yaw, this.yawVel] = stepAngle(this.yaw, this.targetYaw, this.yawVel);

    this.platformGroup.rotation.x = this.pitch;
    this.platformGroup.rotation.z = this.roll;
    this.platformGroup.rotation.y = this.yaw;

    if (this.isFalling) {
      this.holdProgress = 0;
      this.stopHoldAudio();
      if (this.gaugeGeo) this.gaugeGeo.setDrawRange(0, 0);
      if (this.gaugeMesh) this.gaugeMesh.visible = false;

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

    // Heavy bronze ball physics calibration (slowed down ~4x for stately mass & precision control)
    // Natural gravity along inclined plane (solid sphere rolling a = (5/7) * g * sin(theta))
    const gravity = 2.15;
    const sinR = Math.sin(this.roll);
    const sinP = Math.sin(this.pitch);
    const ax = -sinR * gravity;
    const az = sinP * gravity;

    this.ballVel.x += ax * dt;
    this.ballVel.z += az * dt;

    // Constant kinetic rolling resistance (requires deliberate slope or active counter-tilt)
    const curSpeed = Math.hypot(this.ballVel.x, this.ballVel.z);
    if (curSpeed > 0.0001) {
      const rollingDecel = Math.min(curSpeed, 0.09 * dt);
      const ratio = (curSpeed - rollingDecel) / curSpeed;
      this.ballVel.x *= ratio;
      this.ballVel.z *= ratio;
    }

    // High mass momentum: low viscous drag (ball carries momentum, hard to stop quickly without counter-tilting)
    const damping = Math.pow(0.995, dt * 60);
    this.ballVel.x *= damping;
    this.ballVel.z *= damping;

    // Terminal velocity cap (comfortably paced for maze navigation)
    const cappedSpeed = Math.hypot(this.ballVel.x, this.ballVel.z);
    const maxSpeed = 0.75;
    if (cappedSpeed > maxSpeed) {
      const scale = maxSpeed / cappedSpeed;
      this.ballVel.x *= scale;
      this.ballVel.z *= scale;
    }

    // Socket interaction & 1-second holding challenge (NO magnetic suction / programmatic holding)
    const distToHole = Math.hypot(this.ballPos.x - this.holePos.x, this.ballPos.z - this.holePos.z);
    const inSocket = (distToHole < 0.22);

    if (inSocket) {
      // Ball is purely within target zone: player must maintain zero platform tilt to stay inside
      this.holdProgress = Math.min(1.0, this.holdProgress + dt / 1.0);
    } else {
      // Ball slipped out: hold is immediately compromised and smoothly drains
      if (this.holdProgress > 0) {
        this.holdProgress = Math.max(0.0, this.holdProgress - dt * 2.0);
      }
    }

    // Audio & circular gauge ring update
    this.updateHoldAudio(this.holdProgress);

    if (this.gaugeGeo && this.gaugeMesh) {
      if (this.holdProgress <= 0.001) {
        this.gaugeMesh.visible = false;
        this.gaugeGeo.setDrawRange(0, 0);
      } else {
        this.gaugeMesh.visible = true;
        const count = Math.min(64, Math.round(this.holdProgress * 64)) * 6;
        this.gaugeGeo.setDrawRange(0, count);
      }
    }

    // Check 1-second hold completion (Goal!)
    if (this.holdProgress >= 1.0) {
      this.holdProgress = 0;
      this.stopHoldAudio();
      if (this.gaugeGeo) this.gaugeGeo.setDrawRange(0, 0);
      if (this.gaugeMesh) this.gaugeMesh.visible = false;

      this.score++;
      if (this.score > this.record) {
        this.record = this.score;
        try {
          localStorage.setItem('gb_platform_record', this.record.toString());
        } catch (_) {}
      }
      this.triggerConfetti(this.holePos.x, this.holePos.z);
      playSound('goal');
      this.animateScore('up');
      this.spawnHole();
      this.spawnWalls();
      this.ballVel.x *= 0.20;
      this.ballVel.z *= 0.20;
      this.updateHud();
      return;
    }

    this.ballPos.x += this.ballVel.x * dt;
    this.ballPos.z += this.ballVel.z * dt;

    // Obstacle walls Circle-to-AABB collision resolution
    for (let i = 0; i < this.walls.length; i++) {
      const w = this.walls[i];
      const minX = w.x - w.halfW;
      const maxX = w.x + w.halfW;
      const minZ = w.z - w.halfD;
      const maxZ = w.z + w.halfD;

      const closestX = Math.max(minX, Math.min(this.ballPos.x, maxX));
      const closestZ = Math.max(minZ, Math.min(this.ballPos.z, maxZ));

      const dx = this.ballPos.x - closestX;
      const dz = this.ballPos.z - closestZ;
      const distSq = dx * dx + dz * dz;
      const r = this.ballRadius;

      if (distSq < r * r) {
        const dist = Math.sqrt(distSq);
        let nx = 0;
        let nz = 0;
        let penetration = 0;

        if (dist > 0.0001) {
          nx = dx / dist;
          nz = dz / dist;
          penetration = r - dist;
        } else {
          const left = Math.abs(this.ballPos.x - minX);
          const right = Math.abs(maxX - this.ballPos.x);
          const top = Math.abs(this.ballPos.z - minZ);
          const bottom = Math.abs(maxZ - this.ballPos.z);
          const minOverlap = Math.min(left, right, top, bottom);

          if (minOverlap === left) { nx = -1; penetration = r + left; }
          else if (minOverlap === right) { nx = 1; penetration = r + right; }
          else if (minOverlap === top) { nz = -1; penetration = r + top; }
          else { nz = 1; penetration = r + bottom; }
        }

        this.ballPos.x += nx * penetration;
        this.ballPos.z += nz * penetration;

        // Bounce velocity with restitution (heavy bronze on stone: dense thud, low rebound)
        const restitution = 0.22;
        const vn = this.ballVel.x * nx + this.ballVel.z * nz;
        if (vn < 0) {
          this.ballVel.x -= (1 + restitution) * vn * nx;
          this.ballVel.z -= (1 + restitution) * vn * nz;

          const impactSpeed = -vn;
          if (impactSpeed > 0.04) {
            this.playStoneHit(Math.min(1.0, impactSpeed * 3.5));
          }
        }
      }
    }

    // Check if ball rolls over the open edge of the platform
    const halfX = this.platformSizeX / 2;
    const halfZ = this.platformSizeZ / 2;
    const contactRadius = this.ballRadius * 0.70;
    const overEdge = (Math.abs(this.ballPos.x) > halfX + contactRadius || Math.abs(this.ballPos.z) > halfZ + contactRadius);

    if (overEdge) {
      this.holdProgress = 0;
      this.stopHoldAudio();
      if (this.gaugeGeo) this.gaugeGeo.setDrawRange(0, 0);
      if (this.gaugeMesh) this.gaugeMesh.visible = false;

      if (this.isOffline) {
        this.respawnBall();
        return;
      }
      this.isFalling = true;
      this.ballVelY = -0.8;
      this.ballPosY = this.platformThickness / 2 + this.ballRadius;

      playSound('defeat');
      if (this.score > 0) {
        this.animateScore('lost');
      }
      this.score = 0;
      this.updateHud();
      return;
    }

    // Position ball on top of slab (with subtle sink when resting inside socket cup)
    this.ballPosY = this.platformThickness / 2 + this.ballRadius;
    const curDistToHole = Math.hypot(this.ballPos.x - this.holePos.x, this.ballPos.z - this.holePos.z);
    if (curDistToHole < 0.22) {
      this.ballPosY -= (1 - curDistToHole / 0.22) * 0.022;
    }
    this.ballMesh.position.x = this.ballPos.x;
    this.ballMesh.position.y = this.ballPosY;
    this.ballMesh.position.z = this.ballPos.z;

    // Non-slip rolling rotation
    this.ballMesh.rotation.z -= (this.ballVel.x * dt) / this.ballRadius;
    this.ballMesh.rotation.x -= (this.ballVel.z * dt) / this.ballRadius;
  },

  cacheHudElements() {
    if (this.hudElements && this.hudElements.score?.isConnected) return this.hudElements;
    this.hudElements = {
      trial: document.getElementById('bench-platform-trial'),
      trialPill: document.getElementById('bench-platform-trial-pill'),
      score: document.getElementById('bench-hud-score'),
      record: document.getElementById('bench-hud-record'),
      pitch: document.getElementById('bench-hud-pitch'),
      roll: document.getElementById('bench-hud-roll'),
      topScore: document.getElementById('bench-platform-score'),
      topRecord: document.getElementById('bench-platform-record')
    };
    return this.hudElements;
  },

  updateHud(force = false) {
    const now = performance.now();
    const els = this.cacheHudElements();

    const trialNum = this.score + 1;
    if (force || trialNum !== this.lastHudTrial) {
      this.lastHudTrial = trialNum;
      if (els.trial) els.trial.textContent = trialNum.toString();
    }

    if (force || this.score !== this.lastHudScore) {
      this.lastHudScore = this.score;
      const scoreLabel = t('settings_modal.bench_score');
      if (els.score) els.score.textContent = `${scoreLabel}: ${this.score}`;
      if (els.topScore) els.topScore.textContent = this.score.toString();
    }

    if (force || this.record !== this.lastHudRecord) {
      this.lastHudRecord = this.record;
      const recordLabel = t('settings_modal.bench_record');
      if (els.record) els.record.textContent = `${recordLabel}: ${this.record}`;
      if (els.topRecord) els.topRecord.textContent = this.record.toString();
    }

    if (force || (now - this.lastHudTs >= 100)) {
      this.lastHudTs = now;
      const degP = this.pitch * (180 / Math.PI);
      const degR = -this.roll * (180 / Math.PI);
      if (els.pitch) {
        els.pitch.textContent = `P: ${(degP >= 0 ? '+' : '')}${degP.toFixed(1)}°`;
      }
      if (els.roll) {
        els.roll.textContent = `R: ${(degR >= 0 ? '+' : '')}${degR.toFixed(1)}°`;
      }
    }
  },

  updateAndRender() {
    if (!this.initialized || !this.renderer || !this.scene || !this.camera || this.isPaused) return;

    const now = performance.now();
    const dt = this.lastTickTs ? Math.min(0.05, Math.max(0.001, (now - this.lastTickTs) / 1000)) : 0.016;
    this.lastTickTs = now;

    this.updatePhysics(dt);
    this.updateConfetti(dt);

    // Highly optimized FPS counter (DOM throttled to 4 Hz / 250ms)
    this.fpsFrames++;
    if (now - this.fpsLastTs >= 250) {
      const fps = Math.round((this.fpsFrames * 1000) / (now - this.fpsLastTs));
      this.fpsFrames = 0;
      this.fpsLastTs = now;
      if (fps !== this.lastHudFps) {
        this.lastHudFps = fps;
        if (!this.fpsValEl) {
          this.fpsValEl = document.getElementById('bench-fps-val');
        }
        if (this.fpsValEl) {
          this.fpsValEl.textContent = fps.toString();
        }
      }
    }

    if (this.cachedW <= 0) {
      this.syncDimensions(true);
    }

    this.renderer.render(this.scene, this.camera);
  },

  pause() {
    this.isPaused = true;
    this.isFalling = false;
    this.holdProgress = 0;
    this.stopHoldAudio();
    if (this.gaugeGeo) this.gaugeGeo.setDrawRange(0, 0);
    if (this.gaugeMesh) this.gaugeMesh.visible = false;
    this.pitchVel = 0;
    this.rollVel = 0;
    this.yawVel = 0;
    this.ballVel = { x: 0, z: 0 };
    this.ballVelY = 0;
    this.fpsFrames = 0;
    this.fpsLastTs = 0;
    for (const p of this.confettiParticles) {
      if (p.mesh && p.mesh.parent) p.mesh.parent.remove(p.mesh);
      if (p.mesh && p.mesh.geometry) p.mesh.geometry.dispose();
      if (p.mesh && p.mesh.material) p.mesh.material.dispose();
    }
    this.confettiParticles = [];
  },

  resume() {
    this.isPaused = false;
    this.lastTickTs = performance.now();
    this.fpsFrames = 0;
    this.fpsLastTs = performance.now();
    this.pitchVel = 0;
    this.rollVel = 0;
    this.yawVel = 0;
  },

  dispose() {
    if (this.ro) {
      try { this.ro.disconnect(); } catch (_) {}
      this.ro = null;
    }

    this.stopHoldAudio();
    if (this.gaugeGeo) {
      try { this.gaugeGeo.dispose(); } catch (_) {}
      this.gaugeGeo = null;
    }
    if (this.gaugeMesh) {
      if (this.gaugeMesh.material) {
        try { this.gaugeMesh.material.dispose(); } catch (_) {}
      }
      this.gaugeMesh = null;
    }
    if (this.gaugeTrack) {
      if (this.gaugeTrack.geometry) {
        try { this.gaugeTrack.geometry.dispose(); } catch (_) {}
      }
      if (this.gaugeTrack.material) {
        try { this.gaugeTrack.material.dispose(); } catch (_) {}
      }
      this.gaugeTrack = null;
    }
    this.holdProgress = 0;
    this.pitchVel = 0;
    this.rollVel = 0;
    this.yawVel = 0;
    this.targetPitch = 0;
    this.targetRoll = 0;
    this.targetYaw = 0;

    if (this.scene) {
      this.scene.traverse((obj) => {
        if (obj.geometry) {
          try { obj.geometry.dispose(); } catch (_) {}
        }
        if (obj.material) {
          if (Array.isArray(obj.material)) {
            obj.material.forEach((m) => { try { m.dispose(); } catch (_) {} });
          } else {
            try { obj.material.dispose(); } catch (_) {}
          }
        }
      });
    }

    for (const p of this.confettiParticles) {
      try {
        if (p.mesh && p.mesh.geometry) p.mesh.geometry.dispose();
        if (p.mesh && p.mesh.material) p.mesh.material.dispose();
      } catch (_) {}
    }
    this.confettiParticles = [];

    if (this.renderer) {
      try { this.renderer.dispose(); } catch (_) {}
      this.renderer = null;
    }

    this.clearWalls();
    if (this.wallMat) {
      try { this.wallMat.dispose(); } catch (_) {}
      this.wallMat = null;
    }
    if (this.wallCapMat) {
      try { this.wallCapMat.dispose(); } catch (_) {}
      this.wallCapMat = null;
    }
    this.wallsGroup = null;

    if (this._audioCtx) {
      try { this._audioCtx.close(); } catch (_) {}
      this._audioCtx = null;
    }

    this.scene = null;
    this.camera = null;
    this.platformGroup = null;
    this.slabMesh = null;
    this.slabMat = null;
    this.pedMat = null;
    this.pedMid = null;
    this.pedLow = null;
    this.gimbalHub = null;
    this.hubRing = null;
    this.edgeLine = null;
    this.runeGroup = null;
    this.rimGroup = null;
    this.ballMesh = null;
    this.holeMesh = null;
    this.cachedW = 0;
    this.cachedH = 0;
    this.fpsValEl = null;
    this.initialized = false;
    this.initializing = false;
  }
};
