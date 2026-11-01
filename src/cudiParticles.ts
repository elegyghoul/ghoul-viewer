import * as THREE from 'three';
import { assetUrl } from './assetUrl';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { CudiChainPhysics } from './cudiChainPhysics';

const CUDI_SETTINGS_URL = assetUrl('/data/cudi-particles.json');

/**
 * Unity Ghoul_Cudi (e.g. #5828): body/head/CudiTeeth/CudiEye/Rag/CudiChain
 * stay in the hierarchy as invisible emitter meshes. Particle systems spawn
 * emoji billboards on those surfaces (Cudi Basketball/Banana/X/Skull mats).
 * startSpeed 0 + short life → particles sit on the mesh and refresh.
 */

type SpriteId = 'basketball' | 'banana' | 'x' | 'skull';

export type CudiEmitterId =
  | 'bodyBasketball'
  | 'headBasketball'
  | 'headX'
  | 'teethBanana'
  | 'eyeBanana'
  | 'ragSkull'
  | 'chainBanana';

export type CudiEmitterParams = {
  id: CudiEmitterId;
  label: string;
  life: number;
  speed: number;
  defaultLife: number;
  defaultSpeed: number;
};

export type CudiSavedSettings = {
  emitters: Partial<Record<CudiEmitterId, { life: number; speed: number }>>;
};

type EmitterSpec = {
  id: CudiEmitterId;
  label: string;
  meshNames: string[];
  sprite: SpriteId;
  count: number;
  size: number;
  life: number;
  /** World units / sec along the surface normal. 0 = stick to mesh. */
  speed: number;
  /**
   * Higher = drawn later. Distinct values stop Three's transparent distance
   * sort from flipping whole emitters on tiny orbit. Real front/back occlusion
   * comes from depth writes; this is only a stable paint order + coplanar bias.
   */
  renderOrder: number;
  /** Keep triangles whose local centroid passes this test (e.g. front of eye). */
  triFilter?: (cx: number, cy: number, cz: number) => boolean;
  /** Added in mesh-local space after surface sample (e.g. raise pupils). */
  localOffset?: readonly [number, number, number];
};

const SPECS: EmitterSpec[] = [
  {
    id: 'bodyBasketball',
    label: 'Body basketball',
    meshNames: ['Based Ghoul Body - Teeth'],
    sprite: 'basketball',
    count: 720,
    size: 0.07,
    life: 0.25,
    speed: 0,
    renderOrder: 8,
  },
  {
    id: 'headBasketball',
    label: 'Head basketball',
    meshNames: ['Head - Teeth'],
    sprite: 'basketball',
    count: 380,
    size: 0.05,
    life: 0.5,
    speed: 0,
    renderOrder: 9,
  },
  {
    id: 'headX',
    label: 'Head X',
    meshNames: ['Head - Teeth'],
    sprite: 'x',
    count: 180,
    size: 0.045,
    life: 0.5,
    speed: 0,
    // Inner-mouth blacks — keep behind banana teeth.
    renderOrder: 10,
  },
  {
    id: 'teethBanana',
    label: 'Banana teeth',
    meshNames: ['CudiTeeth'],
    sprite: 'banana',
    count: 140,
    size: 0.03,
    life: 0.5,
    speed: 0,
    renderOrder: 14,
    // Sit above the authored gum line (~4 cm).
    localOffset: [0, 0.14, -2],
  },
  {
    id: 'eyeBanana',
    label: 'Banana eyes',
    meshNames: ['CudiEye', 'CudiEye (1)'],
    sprite: 'banana',
    count: 90,
    size: 0.03,
    life: 0.5,
    speed: 0,
    renderOrder: 15,
    // Unit-sphere emitters (scale ~0.016): keep front/upper patch as the pupil.
    triFilter: (_cx, cy, cz) => cy > -0.05 && cz > 0.15,
    // Geometry-local (pre-scale): ~1.4cm up + 0.6cm forward in world.
    localOffset: [0, 0.9, 0.4],
  },
  // Unity "Cudi - Skull - Rag" → skull emoji on the rag hat mesh.
  {
    id: 'ragSkull',
    label: 'Skull rag',
    meshNames: ['Rag', 'Rag (1)'],
    sprite: 'skull',
    count: 220,
    size: 0.03,
    life: 1,
    speed: 0,
    renderOrder: 12,
  },
  // Unity "Cudi Banana Chain" → bananas on the necklace mesh.
  {
    id: 'chainBanana',
    label: 'Banana chain',
    meshNames: ['CudiChain'],
    sprite: 'banana',
    count: 160,
    size: 0.03,
    life: 1,
    speed: 0,
    renderOrder: 13,
  },
];

const SPRITE_URL: Record<SpriteId, string> = {
  basketball: assetUrl('/textures/cudi/emoji-basketball.png'),
  banana: assetUrl('/textures/cudi/emoji-banana.png'),
  x: assetUrl('/textures/cudi/emoji-x.png'),
  skull: assetUrl('/textures/cudi/emoji-skull.png'),
};

/** Unity instance transform of CudiChain under Cudi Group.
 * FBX verts are in cm; Unity converts to meters, Three's FBXLoader does not —
 * so bake the extra 0.01 into scale (Unity localScale was ~0.102).
 */
const CUDI_CHAIN_LOCAL = {
  position: new THREE.Vector3(0.004, -0.114, 0.111),
  quaternion: new THREE.Quaternion(0.18189912, 0, 0, 0.98331726),
  scale: 0.10220031 * 0.01,
};

const CUDI_CHAIN_URL = assetUrl('/models/cudi/CudiChain.fbx');
const fbxLoader = new FBXLoader();
let chainTemplate: THREE.Group | null = null;
let chainTemplatePromise: Promise<THREE.Group | null> | null = null;

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _ab = new THREE.Vector3();
const _ac = new THREE.Vector3();

type Tri = { a: number; b: number; c: number; cdf: number };

type Emitter = {
  id: CudiEmitterId;
  mesh: THREE.Mesh;
  skinned: THREE.SkinnedMesh | null;
  points: THREE.Points;
  positions: Float32Array;
  ages: Float32Array;
  spawn: Float32Array;
  velocities: Float32Array;
  tris: Uint32Array;
  bary: Float32Array;
  /** Per-particle radial jitter along the chain rope (chainBanana only). */
  radial: Float32Array | null;
  triList: Tri[];
  life: number;
  speed: number;
  hidden: THREE.Mesh[];
  localOffset: THREE.Vector3 | null;
  /** Follow the dangling Verlet necklace instead of the rigid mesh. */
  useChainRope: boolean;
};

type Override = { life?: number; speed?: number };

const textureCache = new Map<string, THREE.Texture>();

function loadSprite(url: string): THREE.Texture {
  let tex = textureCache.get(url);
  if (tex) return tex;
  tex = new THREE.TextureLoader().load(url);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = true;
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  textureCache.set(url, tex);
  return tex;
}

function normName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().toLowerCase().replace(/ /g, '_');
}

function collectMeshTree(node: THREE.Object3D, out: THREE.Mesh[]): void {
  const mesh = node as THREE.Mesh;
  if (mesh.isMesh && mesh.geometry) out.push(mesh);
  for (const child of node.children) collectMeshTree(child, out);
}

function findMeshes(root: THREE.Object3D, names: string[]): THREE.Mesh[] {
  const want = new Set(names.map(normName));
  const out: THREE.Mesh[] = [];
  const seen = new Set<THREE.Mesh>();
  root.traverse((o) => {
    if (!want.has(normName(o.name))) return;
    const found: THREE.Mesh[] = [];
    collectMeshTree(o, found);
    for (const mesh of found) {
      if (seen.has(mesh)) continue;
      seen.add(mesh);
      out.push(mesh);
    }
  });
  return out;
}

function cudiGroupVisible(root: THREE.Object3D): boolean {
  let visible = false;
  root.traverse((o) => {
    if (visible) return;
    if (normName(o.name) !== 'cudi') return;
    let p: THREE.Object3D | null = o;
    while (p) {
      if (!p.visible) return;
      p = p.parent;
    }
    visible = true;
  });
  return visible;
}

function findNamed(root: THREE.Object3D, name: string): THREE.Object3D | null {
  const want = normName(name);
  let found: THREE.Object3D | null = null;
  root.traverse((o) => {
    if (found) return;
    if (normName(o.name) === want) found = o;
  });
  return found;
}

async function loadChainTemplate(): Promise<THREE.Group | null> {
  if (chainTemplate) return chainTemplate;
  if (chainTemplatePromise) return chainTemplatePromise;
  chainTemplatePromise = fbxLoader
    .loadAsync(CUDI_CHAIN_URL)
    .then((fbx) => {
      fbx.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.name = mesh.name?.trim() ? mesh.name : 'CudiChain';
        mesh.visible = false;
        mesh.frustumCulled = false;
      });
      if (!findNamed(fbx, 'CudiChain')) fbx.name = 'CudiChain';
      chainTemplate = fbx;
      return fbx;
    })
    .catch((err) => {
      console.warn('[cudi] failed to load CudiChain', err);
      chainTemplatePromise = null;
      return null;
    });
  return chainTemplatePromise;
}

/** CudiChain was stripped from the avatar GLB — instance it under Cudi Group. */
async function ensureCudiChain(root: THREE.Object3D): Promise<THREE.Object3D | null> {
  const existing = findNamed(root, 'CudiChain');
  if (existing) return existing;

  const parent =
    findNamed(root, 'Cudi Group') ?? findNamed(root, 'Cudi') ?? findNamed(root, 'GameObject');
  if (!parent) return null;

  const template = await loadChainTemplate();
  if (!template) return null;

  const instance = template.clone(true);
  instance.name = 'CudiChain';
  instance.position.copy(CUDI_CHAIN_LOCAL.position);
  instance.quaternion.copy(CUDI_CHAIN_LOCAL.quaternion);
  instance.scale.setScalar(CUDI_CHAIN_LOCAL.scale);
  instance.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.name = 'CudiChain';
      mesh.visible = false;
    }
  });
  parent.add(instance);
  return instance;
}

function buildTriList(
  geom: THREE.BufferGeometry,
  triFilter?: (cx: number, cy: number, cz: number) => boolean,
): Tri[] {
  const pos = geom.getAttribute('position') as THREE.BufferAttribute;
  const idx = geom.index;
  const tris: Tri[] = [];
  let areaSum = 0;
  const push = (ia: number, ib: number, ic: number) => {
    _a.fromBufferAttribute(pos, ia);
    _b.fromBufferAttribute(pos, ib);
    _c.fromBufferAttribute(pos, ic);
    if (triFilter) {
      const cx = (_a.x + _b.x + _c.x) / 3;
      const cy = (_a.y + _b.y + _c.y) / 3;
      const cz = (_a.z + _b.z + _c.z) / 3;
      if (!triFilter(cx, cy, cz)) return;
    }
    const area = _b.clone().sub(_a).cross(_c.clone().sub(_a)).length() * 0.5;
    if (!(area > 1e-12)) return;
    areaSum += area;
    tris.push({ a: ia, b: ib, c: ic, cdf: areaSum });
  };
  if (idx) {
    for (let i = 0; i < idx.count; i += 3) {
      push(idx.getX(i), idx.getX(i + 1), idx.getX(i + 2));
    }
  } else {
    for (let i = 0; i < pos.count; i += 3) push(i, i + 1, i + 2);
  }
  return tris;
}

function pickTri(tris: Tri[]): number {
  if (tris.length === 0) return 0;
  const target = Math.random() * tris[tris.length - 1]!.cdf;
  let lo = 0;
  let hi = tris.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (tris[mid]!.cdf < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function randomBary(out: Float32Array, i: number): void {
  let u = Math.random();
  let v = Math.random();
  if (u + v > 1) {
    u = 1 - u;
    v = 1 - v;
  }
  out[i] = u;
  out[i + 1] = v;
}

function readTriVerts(
  mesh: THREE.Mesh,
  skinned: THREE.SkinnedMesh | null,
  tri: Tri,
): void {
  if (skinned) {
    // three@0.185+: boneTransform was removed; use getVertexPosition (bind + skin).
    skinned.getVertexPosition(tri.a, _a);
    skinned.getVertexPosition(tri.b, _b);
    skinned.getVertexPosition(tri.c, _c);
  } else {
    const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    _a.fromBufferAttribute(pos, tri.a);
    _b.fromBufferAttribute(pos, tri.b);
    _c.fromBufferAttribute(pos, tri.c);
  }
}

function sampleWorld(
  mesh: THREE.Mesh,
  skinned: THREE.SkinnedMesh | null,
  tri: Tri,
  u: number,
  v: number,
  target: THREE.Vector3,
  localOffset: THREE.Vector3 | null,
): void {
  const w = 1 - u - v;
  readTriVerts(mesh, skinned, tri);
  target.set(0, 0, 0).addScaledVector(_a, w).addScaledVector(_b, u).addScaledVector(_c, v);
  if (localOffset) target.add(localOffset);
  mesh.localToWorld(target);
}

function sampleWorldNormal(
  mesh: THREE.Mesh,
  skinned: THREE.SkinnedMesh | null,
  tri: Tri,
  target: THREE.Vector3,
): void {
  readTriVerts(mesh, skinned, tri);
  mesh.localToWorld(_a);
  mesh.localToWorld(_b);
  mesh.localToWorld(_c);
  _ab.subVectors(_b, _a);
  _ac.subVectors(_c, _a);
  target.crossVectors(_ab, _ac);
  if (target.lengthSq() < 1e-12) target.set(0, 1, 0);
  else target.normalize();
}

/** View-space pull toward camera so stacked face layers win when coplanar,
 * without being large enough to draw the face through the back of the head. */
function layerDepthBias(renderOrder: number): number {
  return Math.max(0, renderOrder - 8) * 0.0012;
}

function makePoints(
  count: number,
  sprite: SpriteId,
  size: number,
  renderOrder: number,
): {
  points: THREE.Points;
  positions: Float32Array;
  ages: Float32Array;
} {
  const positions = new Float32Array(count * 3);
  const ages = new Float32Array(count);
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('aAge', new THREE.BufferAttribute(ages, 1));

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: loadSprite(SPRITE_URL[sprite]) },
      uSize: { value: size },
      uLife: { value: 1 },
      uDepthBias: { value: layerDepthBias(renderOrder) },
    },
    vertexShader: /* glsl */ `
      attribute float aAge;
      uniform float uSize;
      uniform float uLife;
      uniform float uDepthBias;
      varying float vFade;
      void main() {
        float t = clamp(aAge / max(uLife, 0.0001), 0.0, 1.0);
        vFade = smoothstep(0.0, 0.12, t) * (1.0 - smoothstep(0.82, 1.0, t));
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        // Camera looks down -Z; positive bias moves the sprite toward the camera.
        mv.z += uDepthBias;
        gl_PointSize = uSize * (180.0 / max(0.15, -mv.z));
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      varying float vFade;
      void main() {
        vec4 c = texture2D(uMap, gl_PointCoord);
        float a = c.a * vFade;
        // Discard soft/fade pixels so they don't write invisible depth.
        if (a < 0.5) discard;
        gl_FragColor = vec4(c.rgb, a);
      }
    `,
    transparent: true,
    depthTest: true,
    // Needed so the body can occlude the face when orbiting behind.
    // Stay transparent (unlike the earlier opaque attempt) so dense overlaps
    // don't turn into solid depth punch-cards.
    depthWrite: true,
    toneMapped: false,
    fog: false,
  });

  const points = new THREE.Points(geom, mat);
  points.frustumCulled = false;
  points.renderOrder = renderOrder;
  points.name = `CudiParticles_${sprite}`;
  return { points, positions, ages };
}

function clampLife(life: number): number {
  return Math.min(5, Math.max(0.05, life));
}

function clampSpeed(speed: number): number {
  return Math.min(1, Math.max(0, speed));
}

function resolveParams(spec: EmitterSpec, over: Override | undefined): { life: number; speed: number } {
  return {
    life: clampLife(over?.life ?? spec.life),
    speed: clampSpeed(over?.speed ?? spec.speed),
  };
}

function respawnParticle(em: Emitter, i: number, chain: CudiChainPhysics | null): void {
  const o = i * 3;
  if (em.useChainRope && chain?.active) {
    const pick = chain.pick();
    em.tris[i] = pick.seg;
    em.bary[i * 2] = pick.t;
    em.bary[i * 2 + 1] = 0;
    if (em.radial) em.radial[i] = pick.radial;
    chain.pointAt(pick.seg, pick.t, pick.radial, _p);
    em.spawn[o] = _p.x;
    em.spawn[o + 1] = _p.y;
    em.spawn[o + 2] = _p.z;
    em.velocities[o] = 0;
    em.velocities[o + 1] = em.speed > 1e-6 ? -em.speed : 0;
    em.velocities[o + 2] = 0;
    return;
  }

  em.tris[i] = pickTri(em.triList);
  randomBary(em.bary, i * 2);
  const tri = em.triList[em.tris[i]!]!;
  const u = em.bary[i * 2]!;
  const v = em.bary[i * 2 + 1]!;
  sampleWorld(em.mesh, em.skinned, tri, u, v, _p, em.localOffset);
  em.spawn[o] = _p.x;
  em.spawn[o + 1] = _p.y;
  em.spawn[o + 2] = _p.z;
  if (em.speed > 1e-6) {
    sampleWorldNormal(em.mesh, em.skinned, tri, _n);
    em.velocities[o] = _n.x * em.speed;
    em.velocities[o + 1] = _n.y * em.speed;
    em.velocities[o + 2] = _n.z * em.speed;
  } else {
    em.velocities[o] = 0;
    em.velocities[o + 1] = 0;
    em.velocities[o + 2] = 0;
  }
}

export class CudiParticleManager {
  private emitters: Emitter[] = [];
  private hidden = new Set<THREE.Mesh>();
  private failed = false;
  private attachedChain: THREE.Object3D | null = null;
  private chainPhysics = new CudiChainPhysics();
  private syncGen = 0;
  private eyeYNudge = new Map<THREE.Object3D, number>();
  /** UI tweaks survive ghoul reloads / re-sync. */
  private overrides = new Map<CudiEmitterId, Override>();
  private active = false;
  private loadPromise: Promise<void> | null = null;

  isActive(): boolean {
    return this.active && this.emitters.length > 0;
  }

  listEmitters(): CudiEmitterParams[] {
    return SPECS.map((spec) => {
      const { life, speed } = resolveParams(spec, this.overrides.get(spec.id));
      return {
        id: spec.id,
        label: spec.label,
        life,
        speed,
        defaultLife: spec.life,
        defaultSpeed: spec.speed,
      };
    });
  }

  setEmitterLife(id: CudiEmitterId, life: number): void {
    const clamped = clampLife(life);
    const prev = this.overrides.get(id) ?? {};
    this.overrides.set(id, { ...prev, life: clamped });
    for (const em of this.emitters) {
      if (em.id !== id) continue;
      em.life = clamped;
      (em.points.material as THREE.ShaderMaterial).uniforms.uLife!.value = clamped;
      for (let i = 0; i < em.ages.length; i++) {
        if (em.ages[i]! >= clamped) em.ages[i] = Math.random() * clamped;
      }
    }
  }

  setEmitterSpeed(id: CudiEmitterId, speed: number): void {
    const clamped = clampSpeed(speed);
    const prev = this.overrides.get(id) ?? {};
    this.overrides.set(id, { ...prev, speed: clamped });
    for (const em of this.emitters) {
      if (em.id !== id) continue;
      em.speed = clamped;
      // Re-seed so the new speed applies immediately instead of waiting for life wrap.
      for (let i = 0; i < em.ages.length; i++) respawnParticle(em, i, this.chainPhysics);
    }
  }

  resetEmitter(id: CudiEmitterId): void {
    this.overrides.delete(id);
    const spec = SPECS.find((s) => s.id === id);
    if (!spec) return;
    const life = clampLife(spec.life);
    const speed = clampSpeed(spec.speed);
    for (const em of this.emitters) {
      if (em.id !== id) continue;
      em.life = life;
      em.speed = speed;
      (em.points.material as THREE.ShaderMaterial).uniforms.uLife!.value = life;
      for (let i = 0; i < em.ages.length; i++) {
        em.ages[i] = Math.random() * life;
        respawnParticle(em, i, this.chainPhysics);
      }
    }
  }

  /** Payload for `public/data/cudi-particles.json`. */
  exportSettings(): CudiSavedSettings {
    const emitters: CudiSavedSettings['emitters'] = {};
    for (const spec of SPECS) {
      const { life, speed } = resolveParams(spec, this.overrides.get(spec.id));
      emitters[spec.id] = { life, speed };
    }
    return { emitters };
  }

  applySavedSettings(data: unknown): void {
    if (!data || typeof data !== 'object') return;
    const root = data as { emitters?: unknown };
    const bucket = root.emitters;
    if (!bucket || typeof bucket !== 'object') return;
    this.overrides.clear();
    for (const spec of SPECS) {
      const entry = (bucket as Record<string, unknown>)[spec.id];
      if (!entry || typeof entry !== 'object') continue;
      const lifeRaw = (entry as { life?: unknown }).life;
      const speedRaw = (entry as { speed?: unknown }).speed;
      const over: Override = {};
      if (typeof lifeRaw === 'number' && Number.isFinite(lifeRaw)) over.life = clampLife(lifeRaw);
      if (typeof speedRaw === 'number' && Number.isFinite(speedRaw)) over.speed = clampSpeed(speedRaw);
      if (over.life === undefined && over.speed === undefined) continue;
      this.overrides.set(spec.id, over);
      const { life, speed } = resolveParams(spec, over);
      for (const em of this.emitters) {
        if (em.id !== spec.id) continue;
        em.life = life;
        em.speed = speed;
        (em.points.material as THREE.ShaderMaterial).uniforms.uLife!.value = life;
        for (let i = 0; i < em.ages.length; i++) {
          if (em.ages[i]! >= life) em.ages[i] = Math.random() * life;
          respawnParticle(em, i, this.chainPhysics);
        }
      }
    }
  }

  /** Saved emitter params from `public/data/cudi-particles.json`. */
  loadSavedSettings(): Promise<void> {
    if (!this.loadPromise) {
      this.loadPromise = (async () => {
        try {
          const res = await fetch(CUDI_SETTINGS_URL, { cache: 'no-store' });
          if (!res.ok) return;
          this.applySavedSettings(await res.json());
        } catch {
          // No file yet — authored SPECS defaults stand.
        }
      })();
    }
    return this.loadPromise;
  }

  async sync(root: THREE.Object3D, scene: THREE.Object3D): Promise<void> {
    await this.loadSavedSettings();
    const gen = ++this.syncGen;
    this.disposeEmitters();
    this.failed = false;
    this.active = false;
    if (!cudiGroupVisible(root)) return;

    // Necklace mesh isn't in ghoul-avatar.glb — spawn the Unity FBX emitter.
    const chain = await ensureCudiChain(root);
    if (gen !== this.syncGen) {
      chain?.removeFromParent();
      return;
    }
    this.attachedChain = chain;

    // Dangling Verlet necklace — banana particles ride this rope.
    const chainMeshes = findMeshes(root, ['CudiChain']);
    if (chainMeshes[0]) this.chainPhysics.attach(chainMeshes[0]!, root);

    const hideSet = new Set<THREE.Mesh>();
    for (const spec of SPECS) {
      const { life, speed } = resolveParams(spec, this.overrides.get(spec.id));
      const meshes = findMeshes(root, spec.meshNames);
      for (const mesh of meshes) {
        hideSet.add(mesh);
        if (/^cudieye/i.test(normName(mesh.name)) && !this.eyeYNudge.has(mesh)) {
          // Authored spheres sit a bit low in the teeth-head sockets.
          const before = mesh.position.y;
          mesh.position.y = before + 0.018;
          this.eyeYNudge.set(mesh, before);
        }
        const geom = mesh.geometry;
        if (!geom.getAttribute('position')) continue;
        const useChainRope = spec.id === 'chainBanana' && this.chainPhysics.active;
        const triList = useChainRope ? [] : buildTriList(geom, spec.triFilter);
        if (!useChainRope && triList.length === 0) continue;

        const { points, positions, ages } = makePoints(
          spec.count,
          spec.sprite,
          spec.size,
          spec.renderOrder,
        );
        (points.material as THREE.ShaderMaterial).uniforms.uLife!.value = life;
        const tris = new Uint32Array(spec.count);
        const bary = new Float32Array(spec.count * 2);
        const spawn = new Float32Array(spec.count * 3);
        const velocities = new Float32Array(spec.count * 3);
        const radial = useChainRope ? new Float32Array(spec.count) : null;
        const skinned = (mesh as THREE.SkinnedMesh).isSkinnedMesh
          ? (mesh as THREE.SkinnedMesh)
          : null;
        const localOffset = spec.localOffset
          ? new THREE.Vector3(spec.localOffset[0], spec.localOffset[1], spec.localOffset[2])
          : null;

        const em: Emitter = {
          id: spec.id,
          mesh,
          skinned,
          points,
          positions,
          ages,
          spawn,
          velocities,
          tris,
          bary,
          radial,
          triList,
          life,
          speed,
          hidden: [mesh],
          localOffset,
          useChainRope,
        };

        for (let i = 0; i < spec.count; i++) {
          ages[i] = Math.random() * life;
          respawnParticle(em, i, this.chainPhysics);
        }

        scene.add(points);
        this.emitters.push(em);
      }
    }

    for (const mesh of hideSet) {
      mesh.visible = false;
      this.hidden.add(mesh);
    }
    this.active = this.emitters.length > 0;
  }

  update(dt: number): void {
    if (this.failed || this.emitters.length === 0) return;
    const clamped = Math.min(Math.max(dt, 0), 0.05);
    if (clamped <= 0) return;

    try {
      this.chainPhysics.update(clamped);
      for (const em of this.emitters) {
        if (!em.mesh.parent) {
          em.points.visible = false;
          continue;
        }
        em.points.visible = true;
        const pos = em.positions;
        const ages = em.ages;
        const moving = em.speed > 1e-6 && !em.useChainRope;
        for (let i = 0; i < ages.length; i++) {
          ages[i]! += clamped;
          if (ages[i]! >= em.life) {
            ages[i]! -= em.life;
            if (ages[i]! >= em.life) ages[i] = 0;
            respawnParticle(em, i, this.chainPhysics);
          }
          const o = i * 3;
          if (em.useChainRope && this.chainPhysics.active) {
            const radial = em.radial ? em.radial[i]! : 0;
            this.chainPhysics.pointAt(em.tris[i]!, em.bary[i * 2]!, radial, _p);
            if (em.speed > 1e-6) {
              // Mild drip along gravity while still tied to the swinging rope.
              _p.y -= em.speed * ages[i]!;
            }
            pos[o] = _p.x;
            pos[o + 1] = _p.y;
            pos[o + 2] = _p.z;
          } else if (moving) {
            const t = ages[i]!;
            pos[o] = em.spawn[o]! + em.velocities[o]! * t;
            pos[o + 1] = em.spawn[o + 1]! + em.velocities[o + 1]! * t;
            pos[o + 2] = em.spawn[o + 2]! + em.velocities[o + 2]! * t;
          } else {
            const tri = em.triList[em.tris[i]!]!;
            const u = em.bary[i * 2]!;
            const v = em.bary[i * 2 + 1]!;
            sampleWorld(em.mesh, em.skinned, tri, u, v, _p, em.localOffset);
            pos[o] = _p.x;
            pos[o + 1] = _p.y;
            pos[o + 2] = _p.z;
          }
        }
        const g = em.points.geometry;
        (g.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
        (g.getAttribute('aAge') as THREE.BufferAttribute).needsUpdate = true;
      }
    } catch (err) {
      this.failed = true;
      console.warn('[cudi] particle update failed; disabling emitters', err);
      this.disposeEmitters();
    }
  }

  dispose(): void {
    this.disposeEmitters();
    this.overrides.clear();
  }

  private disposeEmitters(): void {
    for (const [mesh, y] of this.eyeYNudge) mesh.position.y = y;
    this.eyeYNudge.clear();
    // Visibility belongs to trait assembly. Forcing these back on after a
    // ghoul swap resurrects Head - Teeth, Rag, and the Cudi meshes.
    this.hidden.clear();
    for (const em of this.emitters) {
      em.points.removeFromParent();
      em.points.geometry.dispose();
      (em.points.material as THREE.Material).dispose();
    }
    this.emitters = [];
    this.active = false;
    this.chainPhysics.dispose();
    if (this.attachedChain) {
      this.attachedChain.removeFromParent();
      this.attachedChain = null;
    }
  }
}
