import * as THREE from 'three';
import type { EditableMaterial } from './assembleGhoul';
import { PIXEL_SIZE } from './dither';
import { accentColor } from './materials';

/**
 * Procedural flame. Soft additive sprites, no texture.
 * Particles spawn at an anchor and climb. The torch uses the stick tip;
 * the infernal flame uses the same simulation, tinted purple, at the
 * Infernal Flame socket.
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

type Anchor = {
  tip: THREE.Object3D;
  host: THREE.Object3D;
};

type Emitter = Anchor & {
  points: THREE.Points;
  positions: Float32Array;
  ages: Float32Array;
  /** seed, size, core */
  rng: Float32Array;
};

type FlameSpec = {
  pointsName: string;
  lightName: string;
  /** Candela. Close to the head, so this stays well under the scene key. */
  lightIntensity: number;
  lightDistance: number;
  /** Sprite size and flame volume. 1 matches the torch. */
  size: number;
  volume: number;
  /** 0 = hot core fades at the rim (torch). 1 = rim stays as bright as the body. */
  outer: number;
  /** Multiplier on the sprite color. Torch stays hot; infernal stays under the dither whites. */
  gain: number;
  renderOrder: number;
  pointMax: number;
  hot: THREE.ColorRepresentation;
  mid: THREE.ColorRepresentation;
  edge: THREE.ColorRepresentation;
  lightHot: THREE.ColorRepresentation;
  lightLow: THREE.ColorRepresentation;
  collect: (root: THREE.Object3D) => Anchor[];
  conceal?: (host: THREE.Object3D) => void;
};

function chainVisible(obj: THREE.Object3D): boolean {
  let p: THREE.Object3D | null = obj;
  while (p) {
    if (!p.visible) return false;
    p = p.parent;
  }
  return true;
}

function hideFireQuad(host: THREE.Object3D): void {
  host.traverse((o) => {
    if (o !== host && o.name === 'Fire') o.visible = false;
  });
}

function normNode(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, '_');
}

/** Placeholder quads exported with the infernal flame. The empty "Infernal Flame" node stays. */
export function hideInfernalPlaceholderMeshes(scope: THREE.Object3D): void {
  scope.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const n = normNode(o.name);
    if (n.startsWith('infernal_flame') || n.startsWith('infernalflame')) o.visible = false;
  });
}

function hideInfernalQuads(host: THREE.Object3D): void {
  hideInfernalPlaceholderMeshes(host.parent ?? host);
}

function collectTorches(root: THREE.Object3D): Anchor[] {
  const anchors: Anchor[] = [];
  root.traverse((o) => {
    if (o.name !== 'Torch' || !chainVisible(o)) return;
    hideFireQuad(o);
    let tip = o.getObjectByName('VFX_TorchLight');
    if (!tip) {
      tip = new THREE.Object3D();
      tip.name = 'TorchFlameTip';
      tip.position.set(-0.135, 0.002, -0.005);
      o.add(tip);
    }
    tip.visible = true;
    anchors.push({ tip, host: o });
  });
  return anchors;
}

function collectInfernal(root: THREE.Object3D): Anchor[] {
  const anchors: Anchor[] = [];
  root.traverse((o) => {
    if (normNode(o.name) !== 'infernal_flame') return;
    if ((o as THREE.Mesh).isMesh) return;
    if (!chainVisible(o)) return;
    hideInfernalQuads(o);
    let tip: THREE.Object3D | undefined;
    o.traverse((child) => {
      if (!tip && child !== o && normNode(child.name).startsWith('vfx_fire')) tip = child;
    });
    if (!tip) {
      tip = new THREE.Object3D();
      tip.name = 'InfernalFlameTip';
      o.add(tip);
    }
    tip.visible = true;
    anchors.push({ tip, host: o });
  });
  return anchors;
}

const TORCH_SPEC: FlameSpec = {
  pointsName: 'TorchFlame',
  lightName: 'TorchFlameLight',
  lightIntensity: 0.9,
  lightDistance: 1.8,
  size: 1,
  volume: 1,
  outer: 0,
  gain: 1.1,
  renderOrder: 4,
  pointMax: 32,
  hot: new THREE.Color(1, 0.96, 0.35),
  mid: new THREE.Color(1, 0.78, 0.08),
  edge: new THREE.Color(1, 0.42, 0.02),
  lightHot: 0xffe38a,
  lightLow: 0xff7a18,
  collect: collectTorches,
  conceal: hideFireQuad,
};

const INFERNAL_SPEC: FlameSpec = {
  pointsName: 'InfernalFlame',
  lightName: 'InfernalFlameLight',
  lightIntensity: 0.9,
  lightDistance: 2.4,
  size: 3.1,
  volume: 2.5,
  outer: 0.45,
  gain: 0.82,
  renderOrder: 4,
  pointMax: 96,
  hot: accentColor('InfernalCore'),
  mid: accentColor('InfernalMid'),
  edge: accentColor('InfernalEdge'),
  lightHot: 0xffffff,
  lightLow: 0x411a4a,
  collect: collectInfernal,
  conceal: hideInfernalQuads,
};

function createEmitter(anchor: Anchor, scene: THREE.Object3D, spec: FlameSpec): Emitter {
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
      uSize: { value: spec.size },
      uPointMax: { value: spec.pointMax },
      uOuter: { value: spec.outer },
      uGain: { value: spec.gain },
      uHot: { value: new THREE.Color(spec.hot) },
      uMid: { value: new THREE.Color(spec.mid) },
      uEdge: { value: new THREE.Color(spec.edge) },
    },
    vertexShader: /* glsl */ `
      attribute float aAge;
      attribute vec3 aSeed;
      uniform float uViewport;
      uniform float uSize;
      uniform float uPointMax;
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
        float world = 0.085 * uSize * aSeed.y * lifeScale;
        gl_PointSize = world * projectionMatrix[1][1] * uViewport * 0.5 / max(0.05, -mv.z);
        gl_PointSize = clamp(gl_PointSize, 2.0, uPointMax);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uHot;
      uniform vec3 uMid;
      uniform vec3 uEdge;
      uniform float uOuter;
      uniform float uGain;
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

        float heat = clamp(core * 0.9 + (vCore > 0.5 ? 0.4 : 0.15) - vT * 0.28, 0.0, 1.0);
        vec3 color = mix(uEdge, uMid, smoothstep(0.0, 0.45, heat));
        color = mix(color, uHot, smoothstep(0.45, 1.0, heat));

        float fade = smoothstep(0.0, 0.05, vT) * (1.0 - smoothstep(0.55, 1.0, vT));
        float bodyW = mix(0.55, 0.92, uOuter);
        float coreW = mix(0.45, 0.2, uOuter);
        float alpha = body * fade * (bodyW + core * coreW) * (vCore > 0.5 ? 1.0 : 0.8);
        gl_FragColor = vec4(color * uGain * (1.0 + vSeed * 0.14), alpha);
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
  points.renderOrder = spec.renderOrder;
  points.name = spec.pointsName;
  scene.add(points);
  return { ...anchor, points, positions, ages, rng };
}

class ProceduralFlame {
  private emitters: Emitter[] = [];
  private scene: THREE.Object3D | null = null;
  private light: THREE.PointLight | null = null;
  /** Current brightness multiplier, chased toward a new random target. */
  private flicker = 1;
  private flickerTarget = 1;
  private flickerHold = 0;
  private liveCore: THREE.Color | null = null;
  private liveMid: THREE.Color | null = null;
  private liveEdge: THREE.Color | null = null;
  private readonly spec: FlameSpec;
  private readonly lightHot = new THREE.Color();
  private readonly lightLow = new THREE.Color();

  constructor(spec: FlameSpec) {
    this.spec = spec;
    this.lightHot.set(spec.lightHot);
    this.lightLow.set(spec.lightLow);
  }

  /** Core, middle, and rim. Each is used as picked — nothing is mixed toward white. */
  setColors(core: THREE.Color, mid: THREE.Color, edge: THREE.Color): void {
    this.liveCore = core;
    this.liveMid = mid;
    this.liveEdge = edge;
  }

  private ensureLight(scene: THREE.Object3D): THREE.PointLight {
    if (!this.light) {
      this.light = new THREE.PointLight(this.lightHot, 0, this.spec.lightDistance, 2);
      this.light.name = this.spec.lightName;
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

    for (const anchor of this.spec.collect(root)) {
      this.emitters.push(createEmitter(anchor, scene, this.spec));
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
    if (this.liveCore && this.liveMid && this.liveEdge) {
      this.lightLow.copy(this.liveCore);
      this.lightHot.copy(this.liveEdge);
      for (const em of this.emitters) {
        const mat = em.points.material as THREE.ShaderMaterial;
        (mat.uniforms.uHot.value as THREE.Color).copy(this.liveCore);
        (mat.uniforms.uMid.value as THREE.Color).copy(this.liveMid);
        (mat.uniforms.uEdge.value as THREE.Color).copy(this.liveEdge);
      }
    }

    for (const em of this.emitters) {
      this.spec.conceal?.(em.host);
      if (!chainVisible(em.host)) {
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
        const volume = this.spec.volume;
        const h = RISE * volume * climb * (0.55 + seed * 0.7);
        const lean = LEAN * volume * (core ? 0.3 : t);
        const spread = (seed - 0.5) * (core ? 0.018 : 0.055) * volume * (0.35 + t);
        const flick =
          Math.sin(time * (core ? 18.0 : 11.0) + seed * 40.0) * (core ? 0.01 : 0.026) * volume * t +
          Math.sin(time * 27.0 + seed * 13.0) * 0.016 * volume * t;
        const hop = Math.sin(time * 21.0 + seed * 19.0) * 0.018 * volume * t;
        const o = i * 3;
        pos[o] = _origin.x + _up.x * (h + hop) + _out.x * lean + _side.x * (spread + flick);
        pos[o + 1] = _origin.y + _up.y * (h + hop) + _out.y * lean + _side.y * (spread + flick);
        pos[o + 2] = _origin.z + _up.z * (h + hop) + _out.z * lean + _side.z * (spread + flick);
      }

      const g = em.points.geometry;
      (g.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      (g.getAttribute('aAge') as THREE.BufferAttribute).needsUpdate = true;
      (g.getAttribute('aSeed') as THREE.BufferAttribute).needsUpdate = true;

      if (!lit && this.scene && this.spec.lightIntensity > 0) {
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
        light.intensity = this.spec.lightIntensity * level;
        light.color.copy(this.lightLow).lerp(this.lightHot, Math.min(1, level));
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

export class TorchFlameManager extends ProceduralFlame {
  constructor() {
    super(TORCH_SPEC);
  }
}

export class InfernalFlameManager extends ProceduralFlame {
  private readonly coreMat = new THREE.MeshBasicMaterial({ color: accentColor('InfernalCore') });
  private readonly midMat = new THREE.MeshBasicMaterial({ color: accentColor('InfernalMid') });
  private readonly edgeMat = new THREE.MeshBasicMaterial({ color: accentColor('InfernalEdge') });

  constructor() {
    super(INFERNAL_SPEC);
    this.setColors(this.coreMat.color, this.midMat.color, this.edgeMat.color);
  }

  materials(): EditableMaterial[] {
    return [
      {
        label: 'InfernalCore',
        material: this.coreMat,
        lit: false,
        saveTarget: { kind: 'accent', key: 'InfernalCore' },
      },
      {
        label: 'InfernalMid',
        material: this.midMat,
        lit: false,
        saveTarget: { kind: 'accent', key: 'InfernalMid' },
      },
      {
        label: 'InfernalEdge',
        material: this.edgeMat,
        lit: false,
        saveTarget: { kind: 'accent', key: 'InfernalEdge' },
      },
    ];
  }
}
