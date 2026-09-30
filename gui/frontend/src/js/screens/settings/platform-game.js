// Zelda 3D Shrine Platform Mini-Game (Apparatus Simulator)
// Tilting ancient stone pedestal, ball rolling physics, goal receptacle, confetti celebration.

import { $, setText } from '../../core/dom.js';

export class PlatformGame {
  constructor(options = {}) {
    this.options = options;
    this.isActive = false;
    this.canvas = null;
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.platformGroup = null;
    this.ballMesh = null;
    this.holePos = { x: 0.9, z: -0.4 };

    this.score = 0;
    this.record = parseInt(localStorage.getItem('pg_game_platform_record') || '0', 10);
    this.pitch = 0;
    this.roll = 0;
    this.pitchOffset = 0;
    this.rollOffset = 0;

    this.ballPos = { x: 0, z: 0 };
    this.ballVel = { x: 0, z: 0 };
    this.ballPosY = 0.18;
    this.ballVelY = 0;
    this.isFalling = false;
    this.isWon = false;

    this.platformSizeX = 3.2;
    this.platformSizeZ = 2.2;
    this.platformThickness = 0.16;

    this.sensitivity = 1.0;
    this.invertX = false;
    this.invertY = false;
    this.source = 'dsu';

    this.confettiParticles = [];
    this.rafId = null;
    this.lastTickTs = 0;

    this.onScoreUpdate = options.onScoreUpdate || (() => {});
    this.onTiltUpdate = options.onTiltUpdate || (() => {});
  }

  async init(canvas) {
    this.canvas = canvas || $('game-platform-canvas');
    if (!this.canvas) return;

    if (!window.THREE) {
      const { createGyroScene } = await import('../../ui/scene.js');
      // trigger Three.js load if not already loaded
      const dummy = document.createElement('div');
      try {
        const sc = await createGyroScene(dummy, { still: true });
        sc.dispose();
      } catch (_) {}
    }

    const THREE = window.THREE;
    if (!THREE) return;

    const renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'low-power',
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer = renderer;

    const scene = new THREE.Scene();
    this.scene = scene;

    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 50);
    camera.position.set(0, 3.4, 4.2);
    camera.lookAt(0, -0.05, 0);
    this.camera = camera;

    // Lights
    scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.1);
    dirLight.position.set(3, 7, 4);
    scene.add(dirLight);

    const cyanPoint = new THREE.PointLight(0x00e5ff, 1.2, 8);
    cyanPoint.position.set(0, 1.8, 0);
    scene.add(cyanPoint);

    // Platform Group
    const platformGroup = new THREE.Group();
    scene.add(platformGroup);
    this.platformGroup = platformGroup;

    // 1. Stone Slab
    const slabGeo = new THREE.BoxGeometry(this.platformSizeX, this.platformThickness, this.platformSizeZ);
    const slateMat = new THREE.MeshStandardMaterial({
      color: 0x242a36,
      roughness: 0.65,
      metalness: 0.25,
    });
    const slabMesh = new THREE.Mesh(slabGeo, slateMat);
    platformGroup.add(slabMesh);

    // 2. Pedestal Underbody & Gimbal
    const pedMidGeo = new THREE.BoxGeometry(this.platformSizeX * 0.86, 0.08, this.platformSizeZ * 0.86);
    const pedMat = new THREE.MeshStandardMaterial({ color: 0x151821, roughness: 0.7 });
    const pedMid = new THREE.Mesh(pedMidGeo, pedMat);
    pedMid.position.y = -this.platformThickness / 2 - 0.04;
    platformGroup.add(pedMid);

    const hubGeo = new THREE.CylinderGeometry(0.28, 0.34, 0.18, 24);
    const hubMat = new THREE.MeshStandardMaterial({ color: 0x9b752c, metalness: 0.85, roughness: 0.3 });
    const gimbalHub = new THREE.Mesh(hubGeo, hubMat);
    gimbalHub.position.y = -this.platformThickness / 2 - 0.18;
    platformGroup.add(gimbalHub);

    // Cyan energy ring
    const hubRingGeo = new THREE.TorusGeometry(0.3, 0.015, 12, 32);
    const hubRingMat = new THREE.MeshBasicMaterial({ color: 0x00e5ff });
    const hubRing = new THREE.Mesh(hubRingGeo, hubRingMat);
    hubRing.rotation.x = Math.PI / 2;
    hubRing.position.y = -this.platformThickness / 2 - 0.18;
    platformGroup.add(hubRing);

    // 3. Sheikah Ancient Goal Socket
    const holeGroup = new THREE.Group();
    const holePitGeo = new THREE.CircleGeometry(0.18, 32);
    const holePitMat = new THREE.MeshBasicMaterial({ color: 0x05070a, side: THREE.DoubleSide });
    const holePit = new THREE.Mesh(holePitGeo, holePitMat);
    holePit.rotation.x = -Math.PI / 2;
    holePit.position.y = this.platformThickness / 2 + 0.002;
    holeGroup.add(holePit);

    const collarGeo = new THREE.TorusGeometry(0.19, 0.016, 12, 32);
    const collarMat = new THREE.MeshStandardMaterial({ color: 0xc89b3c, metalness: 0.85, roughness: 0.25 });
    const collar = new THREE.Mesh(collarGeo, collarMat);
    collar.rotation.x = Math.PI / 2;
    collar.position.y = this.platformThickness / 2 + 0.004;
    holeGroup.add(collar);

    holeGroup.position.set(this.holePos.x, 0, this.holePos.z);
    platformGroup.add(holeGroup);

    // 4. Marble Ball
    const ballGeo = new THREE.SphereGeometry(0.14, 32, 24);
    const ballMat = new THREE.MeshStandardMaterial({
      color: 0xffaa22,
      roughness: 0.25,
      metalness: 0.2,
    });
    const ballMesh = new THREE.Mesh(ballGeo, ballMat);
    ballMesh.position.set(0, this.platformThickness / 2 + 0.14, 0);
    platformGroup.add(ballMesh);
    this.ballMesh = ballMesh;

    this.resetBall();
    this.resize();
  }

  resize() {
    if (!this.renderer || !this.camera || !this.canvas) return;
    const w = this.canvas.clientWidth || 600;
    const h = this.canvas.clientHeight || 400;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  resetBall() {
    this.ballPos = { x: 0, z: 0 };
    this.ballVel = { x: 0, z: 0 };
    this.ballPosY = this.platformThickness / 2 + 0.14;
    this.ballVelY = 0;
    this.isFalling = false;
    this.isWon = false;
    if (this.ballMesh) {
      this.ballMesh.position.set(0, this.ballPosY, 0);
      this.ballMesh.scale.set(1, 1, 1);
    }
  }

  recenter() {
    this.pitchOffset = this.lastRawPitch || 0;
    this.rollOffset = this.lastRawRoll || 0;
  }

  updateOrientation(pitchDeg, rollDeg) {
    this.lastRawPitch = (pitchDeg * Math.PI) / 180;
    this.lastRawRoll = (rollDeg * Math.PI) / 180;

    let p = this.lastRawPitch - this.pitchOffset;
    let r = this.lastRawRoll - this.rollOffset;

    if (this.invertX) p = -p;
    if (this.invertY) r = -r;

    p *= this.sensitivity;
    r *= this.sensitivity;

    // Limit maximum platform tilt to ±32 degrees
    const maxTilt = (32 * Math.PI) / 180;
    this.pitch = Math.max(-maxTilt, Math.min(maxTilt, p));
    this.roll = Math.max(-maxTilt, Math.min(maxTilt, r));

    this.onTiltUpdate(`P: ${(p * 180 / Math.PI).toFixed(1)}° R: ${(r * 180 / Math.PI).toFixed(1)}°`);
  }

  start() {
    this.score = 0;
    this.resetBall();
    this.updateHUD();
    this.startLoop();
  }

  stop() {
    this.stopLoop();
  }

  startLoop() {
    if (this.rafId) return;
    this.lastTickTs = performance.now();
    const loop = (now) => {
      if (!this.isActive) {
        this.rafId = null;
        return;
      }
      this.tick((now - this.lastTickTs) / 1000);
      this.lastTickTs = now;
      this.render();
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stopLoop() {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  tick(dt) {
    if (!this.platformGroup || !this.ballMesh) return;
    dt = Math.min(0.05, Math.max(0.005, dt));

    // Smooth platform tilt
    this.platformGroup.rotation.x = this.pitch;
    this.platformGroup.rotation.z = -this.roll;

    if (this.isWon) {
      // Confetti animation
      this.tickConfetti(dt);
      return;
    }

    if (this.isFalling) {
      this.ballVelY -= 9.8 * dt;
      this.ballPosY += this.ballVelY * dt;
      this.ballMesh.position.y = this.ballPosY;
      if (this.ballPosY < -2.5) {
        // TODO: sound - sound_bench_defeat
        this.resetBall();
      }
      return;
    }

    // Ball physics on tilted plane
    const gravity = 8.5;
    const ax = -Math.sin(-this.roll) * gravity;
    const az = Math.sin(this.pitch) * gravity;

    this.ballVel.x += ax * dt;
    this.ballVel.z += az * dt;

    // Rolling friction
    this.ballVel.x *= 0.985;
    this.ballVel.z *= 0.985;

    this.ballPos.x += this.ballVel.x * dt;
    this.ballPos.z += this.ballVel.z * dt;

    // Hole detection
    const distToHole = Math.hypot(this.ballPos.x - this.holePos.x, this.ballPos.z - this.holePos.z);
    if (distToHole < 0.16) {
      this.onWin();
      return;
    }

    // Edge check
    const halfX = this.platformSizeX / 2;
    const halfZ = this.platformSizeZ / 2;
    if (Math.abs(this.ballPos.x) > halfX || Math.abs(this.ballPos.z) > halfZ) {
      this.isFalling = true;
      this.ballVelY = -0.5;
    }

    this.ballMesh.position.x = this.ballPos.x;
    this.ballMesh.position.z = this.ballPos.z;
    this.ballMesh.position.y = this.ballPosY;
  }

  onWin() {
    this.isWon = true;
    this.score++;
    if (this.score > this.record) {
      this.record = this.score;
      try {
        localStorage.setItem('pg_game_platform_record', String(this.record));
      } catch (_) {}
    }
    this.updateHUD();

    // TODO: sound - sound_bench_goal

    this.spawnConfetti();

    setTimeout(() => {
      if (this.isActive) this.resetBall();
    }, 1800);
  }

  spawnConfetti() {
    if (!this.scene) return;
    const THREE = window.THREE;
    const colors = [0xff3b30, 0xff9500, 0xffcc00, 0x34c759, 0x00e5ff, 0xaf52de];
    for (let i = 0; i < 40; i++) {
      const geo = new THREE.PlaneGeometry(0.06, 0.06);
      const col = colors[Math.floor(Math.random() * colors.length)];
      const mat = new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide });
      const p = new THREE.Mesh(geo, mat);
      p.position.set(this.holePos.x, 0.2, this.holePos.z);
      const angle = Math.random() * Math.PI * 2;
      const spd = 1.5 + Math.random() * 2.5;
      p.userData = {
        vx: Math.cos(angle) * spd,
        vy: 2.5 + Math.random() * 2.0,
        vz: Math.sin(angle) * spd,
        rotSpeed: (Math.random() - 0.5) * 8,
      };
      this.scene.add(p);
      this.confettiParticles.push(p);
    }
  }

  tickConfetti(dt) {
    for (let i = this.confettiParticles.length - 1; i >= 0; i--) {
      const p = this.confettiParticles[i];
      p.userData.vy -= 9.8 * dt;
      p.position.x += p.userData.vx * dt;
      p.position.y += p.userData.vy * dt;
      p.position.z += p.userData.vz * dt;
      p.rotation.x += p.userData.rotSpeed * dt;
      p.rotation.y += p.userData.rotSpeed * dt;
      if (p.position.y < -2) {
        this.scene.remove(p);
        p.geometry.dispose();
        p.material.dispose();
        this.confettiParticles.splice(i, 1);
      }
    }
  }

  updateHUD() {
    setText($('game-score'), this.score);
    setText($('game-record'), this.record);
    this.onScoreUpdate(this.score, this.record);
  }

  render() {
    if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  }

  async activate() {
    this.isActive = true;
    await this.init();
    this.start();
  }

  deactivate() {
    this.isActive = false;
    this.stopLoop();
    // Clean up confetti
    this.confettiParticles.forEach((p) => {
      if (this.scene) this.scene.remove(p);
      p.geometry?.dispose();
      p.material?.dispose();
    });
    this.confettiParticles = [];
  }
}
