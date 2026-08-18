import * as THREE from 'three';

/** Dense beads on one filament — tight spacing so the ribbon reads continuous. */
const PARTICLE_COUNT = 110;
const LIFE = 3.2;
/** Rise height over life — keep near the head, not off the top of frame. */
const RISE = 0.105;
const WAVE_AMP = 0.02;
const WAVE_FREQ = 11;

const _worldPos = new THREE.Vector3();

type Emitter = {
  tip: THREE.Object3D;
  points: THREE.Points;
  positions: Float32Array;
  ages: Float32Array;
  /** Per-particle RNG pack: seed, sizeMul, alphaMul, phaseOff */
  rng: Float32Array;
  phase: number;
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

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    ages[i] = (i / PARTICLE_COUNT) * LIFE;
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
      uColor: { value: new THREE.Color(0x5a5a5a) },
    },
    vertexShader: /* glsl */ `
      attribute float aAge;
      attribute vec4 aSeed;
      varying float vFade;
      varying float vSeed;
      varying float vAlphaMul;
      void main() {
        float t = clamp(aAge / ${LIFE.toFixed(2)}, 0.0, 1.0);
        // Each bead dies on its own schedule (aSeed.w = fade start).
        float fadeStart = aSeed.w;
        float fadeEnd = min(1.0, fadeStart + 0.1 + aSeed.x * 0.28);
        vFade = smoothstep(0.0, 0.06, t) * (1.0 - smoothstep(fadeStart, fadeEnd, t));
        vSeed = aSeed.x;
        vAlphaMul = aSeed.z;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = 2.4 * aSeed.y;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vFade;
      varying float vSeed;
      varying float vAlphaMul;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
      }

      void main() {
        vec2 uv = gl_PointCoord;
        vec2 p = abs(uv * 2.0 - 1.0);
        // Irregular silhouette — carve random chunks out of each particle.
        float n = hash(uv * 5.3 + vSeed * 17.0);
        float n2 = hash(uv.yx * 7.1 + vSeed * 31.0);
        float edge = 0.72 + n * 0.35;
        if (max(p.x, p.y) > edge) discard;
        if (n2 > 0.62 + vFade * 0.25) discard;
        float a = vFade * vAlphaMul * 0.45 * (0.55 + n * 0.45);
        if (a < 0.03) discard;
        gl_FragColor = vec4(uColor, a);
      }
    `,
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

  return { tip, points, positions, ages, rng, phase };
}

/**
 * Pixel-art cig smoke: thin rising S-curve (~1px), mohawk height — not a cloud/column.
 */
export class CigSmokeManager {
  private emitters: Emitter[] = [];
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
        const w = em.phase + phaseOff + h * WAVE_FREQ + this.time * 1.35;
        const amp = WAVE_AMP * (0.4 + t * 0.9) * (0.7 + seed * 0.6);
        const xOff = Math.sin(w) * amp + Math.sin(w * 2.3 + seed * 6.0) * amp * 0.25;
        const zOff = Math.sin(w * 0.7 + 1.1) * amp * 0.4;
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
  }

  dispose(): void {
    for (const em of this.emitters) {
      em.points.removeFromParent();
      em.points.geometry.dispose();
      (em.points.material as THREE.Material).dispose();
    }
    this.emitters = [];
  }
}
