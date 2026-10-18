import * as THREE from 'three';

/** Dense beads on one filament — tight spacing so the ribbon reads continuous. */
const PARTICLE_COUNT = 110;
const LIFE = 3.2;
/** Rise height over life — keep near the head, not off the top of frame. */
const RISE = 0.105;
const WAVE_AMP = 0.02;
const WAVE_FREQ = 11;
/** Cloud wisps at full opacity. Cig wisps grow toward half of this as they rise. */
const CLOUD_POINT_MIN = 15;
const CLOUD_POINT_MAX = 39;

const SMOKE_WISP_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uOpacity;
  varying float vFade;
  varying float vSeed;
  varying float vStretch;
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float ang = vSeed * 6.28318;
    float cs = cos(ang);
    float sn = sin(ang);
    uv = mat2(cs, -sn, sn, cs) * uv;
    uv.x *= mix(0.42, 1.35, vStretch);
    uv.y *= mix(1.25, 0.7, vStretch);
    vec2 q = uv * 6.5 + vSeed * 17.0;
    q += vec2(uTime * 0.055, -uTime * 0.0325);
    float n = noise(q);
    float n2 = noise(q * 2.4 + 5.1);
    float wisp = n * 0.62 + n2 * 0.38;
    if (wisp < 0.48) discard;
    if (dot(uv, uv) > 0.2) discard;
    if (noise(q * 1.8 + 9.0) > 0.82) discard;
    float a = vFade * uOpacity * (0.0525 + n2 * 0.05);
    if (a < 0.012 * uOpacity) discard;
    vec3 col = mix(vec3(0.22, 0.22, 0.22), vec3(0.52, 0.52, 0.52), n);
    gl_FragColor = vec4(col, a);
  }
`;

const _worldPos = new THREE.Vector3();

type Emitter = {
  tip: THREE.Object3D;
  points: THREE.Points;
  positions: Float32Array;
  ages: Float32Array;
  /** Per-particle RNG pack: seed, sizeMul, alphaMul, phaseOff */
  rng: Float32Array;
  phase: number;
  /** Own sway rate so two cigs do not rock together. */
  swayRate: number;
  freq: number;
  swaySign: number;
};

function isSmokeTipName(name: string): boolean {
  const n = name.replace(/_/g, ' ').toLowerCase();
  return n.includes('thick smoke') || (n.includes('vfx') && n.includes('blacksmoke'));
}

function tipIsLive(tip: THREE.Object3D): boolean {
  let p: THREE.Object3D | null = tip;
  while (p) {
    if (!p.visible) return false;
    p = p.parent;
  }
  return true;
}

function createEmitter(tip: THREE.Object3D, scene: THREE.Object3D): Emitter {
  tip.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) mesh.visible = false;
  });

  const positions = new Float32Array(PARTICLE_COUNT * 3);
  const ages = new Float32Array(PARTICLE_COUNT);
  const rng = new Float32Array(PARTICLE_COUNT * 4);
  const phase = Math.random() * Math.PI * 2;
  const swayRate = 0.7 + Math.random() * 1.4;
  const freq = WAVE_FREQ * (0.62 + Math.random() * 0.85);
  const swaySign = Math.random() < 0.5 ? -1 : 1;
  const ageBias = Math.random() * LIFE;

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    ages[i] = ((i / PARTICLE_COUNT) * LIFE + ageBias) % LIFE;
    const r = i * 4;
    rng[r] = Math.random(); // seed
    rng[r + 1] = 0.65 + Math.random() * 0.9; // size
    rng[r + 2] = 0.35 + Math.random() * 0.85; // alpha
    // Dissipate start (0.45–0.85 of life) packed in .w
    rng[r + 3] = 0.45 + Math.random() * 0.4;
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('aAge', new THREE.BufferAttribute(ages, 1));
  geom.setAttribute('aSeed', new THREE.BufferAttribute(rng, 4));

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uOpacity: { value: 1 },
    },
    vertexShader: /* glsl */ `
      attribute float aAge;
      attribute vec4 aSeed;
      varying float vFade;
      varying float vSeed;
      varying float vStretch;
      void main() {
        float t = clamp(aAge / ${LIFE.toFixed(2)}, 0.0, 1.0);
        float fadeStart = aSeed.w;
        float fadeEnd = min(1.0, fadeStart + 0.1 + aSeed.x * 0.28);
        vFade = smoothstep(0.0, 0.06, t) * (1.0 - smoothstep(fadeStart, fadeEnd, t));
        vSeed = aSeed.x;
        vStretch = fract(aSeed.y);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        float grown = mix(${(CLOUD_POINT_MIN * 0.5).toFixed(1)}, ${(CLOUD_POINT_MAX * 0.5).toFixed(1)}, aSeed.x);
        gl_PointSize = mix(grown * 0.35, grown, t);
      }
    `,
    fragmentShader: SMOKE_WISP_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.NormalBlending,
    toneMapped: false,
    fog: false,
  });

  const points = new THREE.Points(geom, mat);
  points.frustumCulled = false;
  points.renderOrder = 3;
  points.name = 'CigSmoke';
  scene.add(points);

  return { tip, points, positions, ages, rng, phase, swayRate, freq, swaySign };
}

/**
 * Cig smoke uses the same wisps as the head cloud. They start smaller and
 * grow with height until they are half the cloud's starting size.
 * The two-cig trait also gathers a separate cloud just above the halo.
 */
export class CigSmokeManager {
  private emitters: Emitter[] = [];
  private cloud: CigCloud | null = null;
  private time = 0;

  sync(root: THREE.Object3D | null, scene: THREE.Object3D): void {
    this.dispose();
    if (!root) return;

    const tips: THREE.Object3D[] = [];
    root.traverse((o) => {
      if (!isSmokeTipName(o.name)) return;
      let cigAncestor: THREE.Object3D | null = o.parent;
      let cigLive = false;
      while (cigAncestor) {
        const n = cigAncestor.name;
        if (n === 'Cig1' || n === 'Cig2' || n === 'Stogie') {
          cigLive = tipIsLive(cigAncestor);
          break;
        }
        cigAncestor = cigAncestor.parent;
      }
      if (!cigLive) return;
      o.visible = true;
      tips.push(o);
    });

    if (tips.length === 0) {
      for (const name of ['Cig1', 'Cig2', 'Stogie']) {
        const cig = root.getObjectByName(name);
        if (!cig || !tipIsLive(cig)) continue;
        const tip = new THREE.Object3D();
        tip.name = 'CigSmokeTip';
        tip.position.set(0, 0, 0.55);
        cig.add(tip);
        tips.push(tip);
      }
    }

    for (const tip of tips) this.emitters.push(createEmitter(tip, scene));

    const cig1 = root.getObjectByName('Cig1');
    const cig2 = root.getObjectByName('Cig2');
    if (cig1 && cig2 && tipIsLive(cig1) && tipIsLive(cig2)) {
      const head = findHead(root);
      if (head) this.cloud = new CigCloud(head, scene);
    }
  }

  update(dt: number): void {
    const clamped = Math.min(Math.max(dt, 0), 0.05);
    if (clamped <= 0) return;
    this.time += clamped;

    for (const em of this.emitters) {
      if (!tipIsLive(em.tip)) {
        em.points.visible = false;
        continue;
      }
      em.points.visible = true;
      (em.points.material as THREE.ShaderMaterial).uniforms.uTime!.value = this.time;
      em.tip.getWorldPosition(_worldPos);

      const pos = em.positions;
      const ages = em.ages;
      const rng = em.rng;

      for (let i = 0; i < PARTICLE_COUNT; i++) {
        ages[i]! += clamped;
        if (ages[i]! >= LIFE) {
          ages[i]! -= LIFE;
          const r = i * 4;
          rng[r] = Math.random();
          rng[r + 1] = 0.65 + Math.random() * 0.9;
          rng[r + 2] = 0.35 + Math.random() * 0.85;
          rng[r + 3] = 0.45 + Math.random() * 0.4;
        }

        const t = ages[i]! / LIFE;
        const h = ages[i]! * RISE;
        const r = i * 4;
        const seed = rng[r]!;
        const phaseOff = (seed - 0.5) * 2.5;
        const w = em.phase + phaseOff + h * em.freq + this.time * em.swayRate;
        const amp = WAVE_AMP * (0.4 + t * 0.9) * (0.7 + seed * 0.6);
        const xOff = em.swaySign * (Math.sin(w) * amp + Math.sin(w * 2.3 + seed * 6.0) * amp * 0.25);
        const zOff = Math.sin(w * 0.7 + em.phase) * amp * 0.4;
        // Live micro-jitter so beads aren't locked to a perfect curve.
        const jx = (Math.sin(this.time * 7.0 + seed * 40.0) * 0.5 + (seed - 0.5)) * 0.004;
        const jz = (Math.cos(this.time * 5.5 + seed * 23.0) * 0.5 + (seed - 0.5)) * 0.003;

        const o = i * 3;
        pos[o] = _worldPos.x + xOff + jx;
        pos[o + 1] = _worldPos.y + h;
        pos[o + 2] = _worldPos.z + zOff + jz;
      }

      const g = em.points.geometry;
      (g.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      (g.getAttribute('aAge') as THREE.BufferAttribute).needsUpdate = true;
      (g.getAttribute('aSeed') as THREE.BufferAttribute).needsUpdate = true;
    }

    this.cloud?.update(clamped, this.time);
  }

  dispose(): void {
    for (const em of this.emitters) {
      em.points.removeFromParent();
      em.points.geometry.dispose();
      (em.points.material as THREE.Material).dispose();
    }
    this.emitters = [];
    this.cloud?.dispose();
    this.cloud = null;
  }
}

/** Head-local centre. The halo ring sits near y 0.27, so the cloud hangs just above it. */
const CLOUD_CENTER = new THREE.Vector3(0, 0.32, 0);
const CLOUD_SPREAD = new THREE.Vector3(0.45, 0.06, 0.36);
const CLOUD_COUNT = 210;
const CLOUD_LIFE = 51.2;

const _center = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _drift = new THREE.Vector3();
const _puff = new THREE.Vector3();

function findHead(root: THREE.Object3D): THREE.Object3D | null {
  let head: THREE.Object3D | null = null;
  root.traverse((o) => {
    if (!head && (o.name === 'mixamorig:Head' || o.name === 'mixamorigHead')) head = o;
  });
  return head;
}

const PUFF_COUNT = 7;

function hash11(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return x - Math.floor(x);
}

/** A fixed clump centre, in head-local metres. Motion is per particle, not per clump. */
function puffCenter(index: number, target: THREE.Vector3): void {
  const h1 = hash11(index * 1.37 + 0.2);
  const h2 = hash11(index * 2.91 + 4.2);
  const h3 = hash11(index * 5.17 + 8.8);
  target.set(
    (h1 - 0.5) * CLOUD_SPREAD.x * 0.7,
    (h3 - 0.5) * 0.045,
    (h2 - 0.5) * CLOUD_SPREAD.z * 0.7,
  );
}

/** A pool of smoke that sits above the head. It does not replace the cig filaments. */
class CigCloud {
  private readonly head: THREE.Object3D;
  private readonly points: THREE.Points;
  private readonly positions: Float32Array;
  private readonly ages: Float32Array;
  private readonly seeds: Float32Array;
  private readonly heightFade: Float32Array;

  constructor(head: THREE.Object3D, scene: THREE.Object3D) {
    this.head = head;
    this.positions = new Float32Array(CLOUD_COUNT * 3);
    this.ages = new Float32Array(CLOUD_COUNT);
    this.seeds = new Float32Array(CLOUD_COUNT * 3);
    this.heightFade = new Float32Array(CLOUD_COUNT);
    for (let i = 0; i < CLOUD_COUNT; i++) {
      this.ages[i] = Math.random() * CLOUD_LIFE;
      const r = i * 3;
      this.seeds[r] = Math.random();
      this.seeds[r + 1] = Math.random();
      this.seeds[r + 2] = Math.random();
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geom.setAttribute('aAge', new THREE.BufferAttribute(this.ages, 1));
    geom.setAttribute('aSeed', new THREE.BufferAttribute(this.seeds, 3));
    geom.setAttribute('aFade', new THREE.BufferAttribute(this.heightFade, 1));

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uOpacity: { value: 0.5 },
      },
      vertexShader: /* glsl */ `
        attribute float aFade;
        attribute vec3 aSeed;
        varying float vFade;
        varying float vSeed;
        varying float vStretch;
        void main() {
          vFade = aFade;
          vSeed = aSeed.x;
          vStretch = aSeed.y;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = mix(${CLOUD_POINT_MIN.toFixed(1)}, ${CLOUD_POINT_MAX.toFixed(1)}, aSeed.z) * mix(0.35, 1.0, aFade);
        }
      `,
      fragmentShader: SMOKE_WISP_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.NormalBlending,
      toneMapped: false,
      fog: false,
    });

    this.points = new THREE.Points(geom, mat);
    this.points.name = 'CigCloud';
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    this.points.castShadow = false;
    this.points.receiveShadow = false;
    scene.add(this.points);
  }

  update(dt: number, time: number): void {
    if (!tipIsLive(this.head)) {
      this.points.visible = false;
      return;
    }
    this.points.visible = true;
    (this.points.material as THREE.ShaderMaterial).uniforms.uTime!.value = time;
    this.head.updateWorldMatrix(true, false);
    _center.copy(CLOUD_CENTER);
    this.head.localToWorld(_center);
    this.head.getWorldQuaternion(_quat);

    const pos = this.positions;
    for (let i = 0; i < CLOUD_COUNT; i++) {
      this.ages[i]! += dt;
      if (this.ages[i]! >= CLOUD_LIFE) {
        this.ages[i] = Math.random() * 0.4;
        const r = i * 3;
        this.seeds[r] = Math.random();
        this.seeds[r + 1] = Math.random();
        this.seeds[r + 2] = Math.random();
      }
      const r = i * 3;
      const sx = this.seeds[r]!;
      const sy = this.seeds[r + 1]!;
      const puff = i % PUFF_COUNT;
      puffCenter(puff, _puff);
      const reach = 0.05 + hash11(puff * 4.4 + 1.1) * 0.16;
      const stretch = 0.4 + hash11(puff * 2.2 + 0.6) * 1.7;
      const rot = hash11(puff * 8.1) * Math.PI;
      const ang = sx * Math.PI * 2 + hash11(sy * 17.0 + puff) * 1.4;
      const rad = Math.pow(sy, 0.35 + hash11(puff * 6.6) * 1.35) * reach;
      let lx = Math.cos(ang) * rad * stretch;
      let lz = Math.sin(ang) * rad;
      const cs = Math.cos(rot);
      const sn = Math.sin(rot);
      const x = lx * cs - lz * sn;
      const z = lx * sn + lz * cs;
      let ox = x;
      let oz = z;
      let oy = (hash11(sx * 19.0 + sy * 7.0 + puff) - 0.5) * (0.02 + hash11(puff + 2.2) * 0.07);
      const stray = hash11(sx * 73.0 + sy * 19.0 + puff * 3.0);
      if (stray > 0.74) {
        const strayAng = hash11(sy * 41.0 + puff * 5.0) * Math.PI * 2;
        const len = (stray - 0.74) * 0.75;
        ox += Math.cos(strayAng) * len;
        oz += Math.sin(strayAng) * len;
        oy += (hash11(sx * 15.0) - 0.5) * 0.035;
      }
      const riseT = this.ages[i]! / CLOUD_LIFE;
      const lift = riseT * riseT * (0.55 + hash11(sx * 31.0 + i * 0.17) * 0.4);
      const phase = sx * 17.0 + sy * 9.0 + i * 0.13;
      const wander = 0.4 + riseT * 1.7;
      const nx =
        (Math.sin(time * (0.2125 + sy * 0.65) + phase) * 0.1 +
          Math.sin(time * (0.475 + sx * 0.55) + phase * 1.7) * 0.05) *
        wander;
      const ny =
        (Math.sin(time * (0.175 + sx * 0.575) + phase * 1.3) * 0.08 +
          Math.cos(time * (0.4 + sy * 0.45) + i * 0.2) * 0.04) *
        wander;
      const nz =
        (Math.cos(time * (0.2375 + hash11(i * 1.7) * 0.6) + phase * 0.7) * 0.1 +
          Math.sin(time * (0.525 + sx * 0.375) + phase) * 0.05) *
        wander;
      const localY = CLOUD_CENTER.y + _puff.y + oy + lift + ny;
      const elev = Math.min(1, Math.max(0, (localY - 0.32) / 0.62));
      this.heightFade[i] = Math.pow(1 - elev, 2.6);
      const swirl = riseT * (3.2 + sx * 2.8) + phase;
      const c2 = Math.cos(swirl);
      const s2 = Math.sin(swirl);
      const expand = 1 + riseT * riseT * 3.4;
      _drift.set(
        _puff.x + (ox * c2 - oz * s2) * expand + nx,
        _puff.y + oy + lift + ny,
        _puff.z + (ox * s2 + oz * c2) * expand + nz,
      );
      _drift.applyQuaternion(_quat).add(_center);
      const o = i * 3;
      pos[o] = _drift.x;
      pos[o + 1] = _drift.y;
      pos[o + 2] = _drift.z;
    }

    const g = this.points.geometry;
    (g.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute('aAge') as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute('aSeed') as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute('aFade') as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.points.removeFromParent();
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}
