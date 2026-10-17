import * as THREE from 'three';
import { PIXEL_SIZE } from './dither';

/**
 * Procedural torch flame. Soft additive sprites, no texture.
 * They spawn at the end of the stick and climb.
 */

const PARTICLE_COUNT = 36;
const LIFE = 0.55;
const RISE = 0.24;
const LEAN = 0.03;

const _origin = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _up = new THREE.Vector3();
const _out = new THREE.Vector3();
const _side = new THREE.Vector3();

/** Candela. Close to the head, so this stays well under the scene key. */
const TORCH_LIGHT = 0.9;

type Emitter = {
  tip: THREE.Object3D;
  torch: THREE.Object3D;
  points: THREE.Points;
  positions: Float32Array;
  ages: Float32Array;
  /** seed, size, core */
  rng: Float32Array;
};

function chainVisible(obj: THREE.Object3D): boolean {
  let p: THREE.Object3D | null = obj;
  while (p) {
    if (!p.visible) return false;
    p = p.parent;
  }
  return true;
}

function hideFireQuad(torch: THREE.Object3D): void {
  torch.traverse((o) => {
    if (o !== torch && o.name === 'Fire') o.visible = false;
  });
}

function createEmitter(tip: THREE.Object3D, torch: THREE.Object3D, scene: THREE.Object3D): Emitter {
  const positions = new Float32Array(PARTICLE_COUNT * 3);
  const ages = new Float32Array(PARTICLE_COUNT);
  const rng = new Float32Array(PARTICLE_COUNT * 3);

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    ages[i] = (i / PARTICLE_COUNT) * LIFE;
    const r = i * 3;
    const core = i < 8 ? 1 : 0;
    rng[r] = Math.random();
    rng[r + 1] = core ? 1.05 + Math.random() * 0.35 : 0.65 + Math.random() * 0.55;
    rng[r + 2] = core;
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('aAge', new THREE.BufferAttribute(ages, 1));
  geom.setAttribute('aSeed', new THREE.BufferAttribute(rng, 3));

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uViewport: { value: PIXEL_SIZE },
    },
    vertexShader: /* glsl */ `
      attribute float aAge;
      attribute vec3 aSeed;
      uniform float uViewport;
      varying float vT;
      varying float vSeed;
      varying float vCore;
      void main() {
        float t = clamp(aAge / ${LIFE.toFixed(2)}, 0.0, 1.0);
        vT = t;
        vSeed = aSeed.x;
        vCore = aSeed.z;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        float lifeScale = vCore > 0.5
          ? mix(1.2, 0.7, t)
          : mix(0.85, 0.2, smoothstep(0.15, 1.0, t));
        float world = 0.085 * aSeed.y * lifeScale;
        gl_PointSize = world * projectionMatrix[1][1] * uViewport * 0.5 / max(0.05, -mv.z);
        gl_PointSize = clamp(gl_PointSize, 2.0, 32.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vT;
      varying float vSeed;
      varying float vCore;
      void main() {
        vec2 p = gl_PointCoord * 2.0 - 1.0;
        // Tongue: wide at the base, pinched at the top.
        float pinch = mix(1.0, 0.35, clamp(p.y * 0.5 + 0.5, 0.0, 1.0));
        p.x /= pinch;
        float d = length(p);
        float body = smoothstep(1.0, 0.15, d);
        float core = smoothstep(0.55, 0.0, d);
        if (body < 0.04) discard;

        vec3 hot = vec3(1.0, 0.96, 0.35);
        vec3 mid = vec3(1.0, 0.78, 0.08);
        vec3 edge = vec3(1.0, 0.42, 0.02);
        float heat = clamp(core * 0.9 + (vCore > 0.5 ? 0.4 : 0.15) - vT * 0.28, 0.0, 1.0);
        vec3 color = mix(edge, mid, smoothstep(0.0, 0.45, heat));
        color = mix(color, hot, smoothstep(0.45, 1.0, heat));

        float fade = smoothstep(0.0, 0.05, vT) * (1.0 - smoothstep(0.55, 1.0, vT));
        float alpha = body * fade * (0.55 + core * 0.45) * (vCore > 0.5 ? 1.0 : 0.8);
        gl_FragColor = vec4(color * (1.1 + vSeed * 0.15), alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    fog: false,
  });

  const points = new THREE.Points(geom, mat);
  points.frustumCulled = false;
  points.renderOrder = 4;
  points.name = 'TorchFlame';
  scene.add(points);
  return { tip, torch, points, positions, ages, rng };
}

const _hot = new THREE.Color(0xffe38a);
const _low = new THREE.Color(0xff7a18);

export class TorchFlameManager {
  private emitters: Emitter[] = [];
  private scene: THREE.Object3D | null = null;
  private light: THREE.PointLight | null = null;
  /** Current brightness multiplier, chased toward a new random target. */
  private flicker = 1;
  private flickerTarget = 1;
  private flickerHold = 0;

  private ensureLight(scene: THREE.Object3D): THREE.PointLight {
    if (!this.light) {
      this.light = new THREE.PointLight(0xffc84a, 0, 1.8, 2);
      this.light.name = 'TorchFlameLight';
      this.light.castShadow = false;
    }
    if (this.light.parent !== scene) scene.add(this.light);
    return this.light;
  }

  private setLightOff(): void {
    if (!this.light) return;
    this.light.intensity = 0;
    this.light.visible = false;
  }

  sync(root: THREE.Object3D | null, scene: THREE.Object3D): void {
    this.dispose();
    this.scene = scene;
    if (!root) {
      this.setLightOff();
      return;
    }

    const torches: THREE.Object3D[] = [];
    root.traverse((o) => {
      if (o.name !== 'Torch' || !chainVisible(o)) return;
      torches.push(o);
    });

    for (const torch of torches) {
      hideFireQuad(torch);
      let tip = torch.getObjectByName('VFX_TorchLight');
      if (!tip) {
        tip = new THREE.Object3D();
        tip.name = 'TorchFlameTip';
        tip.position.set(-0.135, 0.002, -0.005);
        torch.add(tip);
      }
      tip.visible = true;
      this.emitters.push(createEmitter(tip, torch, scene));
    }
  }

  update(dt: number): void {
    const clamped = Math.min(Math.max(dt, 0), 0.05);
    if (clamped <= 0) return;
    if (this.emitters.length === 0) {
      this.setLightOff();
      return;
    }
    const time = performance.now() * 0.001;
    let lit = false;

    for (const em of this.emitters) {
      hideFireQuad(em.torch);
      if (!chainVisible(em.torch)) {
        em.points.visible = false;
        continue;
      }
      em.points.visible = true;
      em.tip.updateWorldMatrix(true, false);
      em.tip.getWorldPosition(_origin);
      em.tip.getWorldQuaternion(_quat);
      _up.set(0, 1, 0);
      _out.set(-1, 0, 0).applyQuaternion(_quat);
      if (_out.lengthSq() < 1e-6) _out.set(0, 0, 1);
      _out.normalize();
      _side.crossVectors(_up, _out);
      if (_side.lengthSq() < 1e-4) _side.set(1, 0, 0);
      _side.normalize();

      const pos = em.positions;
      const ages = em.ages;
      const rng = em.rng;

      for (let i = 0; i < PARTICLE_COUNT; i++) {
        ages[i]! += clamped;
        if (ages[i]! >= LIFE) {
          ages[i]! -= LIFE;
          const r = i * 3;
          rng[r] = Math.random();
          rng[r + 1] = rng[r + 2]! > 0.5 ? 1.05 + Math.random() * 0.35 : 0.65 + Math.random() * 0.55;
        }

        const t = ages[i]! / LIFE;
        const r = i * 3;
        const seed = rng[r]!;
        const core = rng[r + 2]! > 0.5;
        const climb = core ? t * 0.45 : t;
        const h = RISE * climb * (0.55 + seed * 0.7);
        const lean = LEAN * (core ? 0.3 : t);
        const spread = (seed - 0.5) * (core ? 0.018 : 0.055) * (0.35 + t);
        const flick =
          Math.sin(time * (core ? 18.0 : 11.0) + seed * 40.0) * (core ? 0.01 : 0.026) * t +
          Math.sin(time * 27.0 + seed * 13.0) * 0.016 * t;
        const hop = Math.sin(time * 21.0 + seed * 19.0) * 0.018 * t;
        const o = i * 3;
        pos[o] = _origin.x + _up.x * (h + hop) + _out.x * lean + _side.x * (spread + flick);
        pos[o + 1] = _origin.y + _up.y * (h + hop) + _out.y * lean + _side.y * (spread + flick);
        pos[o + 2] = _origin.z + _up.z * (h + hop) + _out.z * lean + _side.z * (spread + flick);
      }

      const g = em.points.geometry;
      (g.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      (g.getAttribute('aAge') as THREE.BufferAttribute).needsUpdate = true;
      (g.getAttribute('aSeed') as THREE.BufferAttribute).needsUpdate = true;

      if (!lit && this.scene) {
        const light = this.ensureLight(this.scene);
        light.visible = true;
        light.position.copy(_origin).addScaledVector(_up, 0.05);
        this.flickerHold -= clamped;
        if (this.flickerHold <= 0) {
          this.flickerHold = 0.03 + Math.random() * 0.08;
          const roll = Math.random();
          this.flickerTarget =
            roll < 0.22 ? 0.32 + Math.random() * 0.28 : 0.72 + Math.random() * 0.7;
        }
        this.flicker += (this.flickerTarget - this.flicker) * Math.min(1, clamped * 16);
        const buzz = 0.94 + 0.06 * Math.sin(time * 53);
        const level = Math.max(0.2, this.flicker * buzz);
        light.intensity = TORCH_LIGHT * level;
        light.color.copy(_low).lerp(_hot, Math.min(1, level));
        lit = true;
      }
    }

    if (!lit) this.setLightOff();
  }

  dispose(): void {
    for (const em of this.emitters) {
      em.points.removeFromParent();
      em.points.geometry.dispose();
      (em.points.material as THREE.Material).dispose();
    }
    this.emitters = [];
    this.setLightOff();
  }
}
