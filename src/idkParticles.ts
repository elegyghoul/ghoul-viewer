import * as THREE from 'three';
import { assetUrl } from './assetUrl';

const IDK_SETTINGS_URL = assetUrl('/data/idk-particles.json');

/**
 * Unity UniqueValues.IDK (e.g. #1480): body/head/glasses/candle/gunk stay in
 * the hierarchy as emitter meshes. Particle systems spawn emoji billboards
 * (Heart / Gear / Clover / Projector) on those surfaces — same startSpeed≈0
 * + short life pattern as Ghoul_Cudi.
 *
 * Accessories are cloned from the already-scaled ghoul-avatar.glb meshes
 * (Candle / Glasses_-_RiffRaff / Discharge_Tears) — not raw FBX — so Unity
 * attachment-map transforms apply without an extra cm→m bake.
 */

type SpriteId = 'heart' | 'gear' | 'cloud' | 'clover' | 'projector';

export type IdkEmitterId =
  | 'bodyGear'
  | 'headGear'
  | 'headProjector'
  | 'glassesProjector'
  | 'glassesHeart'
  | 'candleCloud'
  | 'candleClover'
  | 'gunkClover';

export type IdkEmitterParams = {
  id: IdkEmitterId;
  label: string;
  life: number;
  speed: number;
  defaultLife: number;
  defaultSpeed: number;
};

export type IdkSavedSettings = {
  emitters: Partial<Record<IdkEmitterId, { life: number; speed: number }>>;
};

type EmitterSpec = {
  id: IdkEmitterId;
  label: string;
  meshNames: string[];
  sprite: SpriteId;
  count: number;
  size: number;
  life: number;
  /** World units / sec. Direction depends on velocityMode. */
  speed: number;
  renderOrder: number;
  /** World-space push along the surface normal after sampling. */
  normalOffset?: number;
  /** Default: along mesh normal. `worldUp` = rising flame. */
  velocityMode?: 'normal' | 'worldUp';
  /** When false, keep the emitter mesh visible (candle wax). Default true. */
  hideMesh?: boolean;
  /**
   * `waxTip` = spawn in a tight disk on the candle wax top (flame).
   * Default samples the whole mesh surface.
   */
  spawnMode?: 'mesh' | 'waxTip';
  /** World-unit radius of the wax-tip spawn disk. */
  tipRadius?: number;
  /**
   * Unity multi-material glasses → glTF exports two child meshes (one per
   * material slot). `frame` = projector mat / temple arms; `lenses` = heart mat.
   */
  glassesPart?: 'frame' | 'lenses';
};

const SPECS: EmitterSpec[] = [
  // Unity "IDK - Gears - Body"
  {
    id: 'bodyGear',
    label: 'Body gear',
    meshNames: ['Based Ghoul Body - Teeth'],
    sprite: 'gear',
    count: 900,
    size: 0.05,
    life: 0.25,
    speed: 0,
    renderOrder: 8,
  },
  // Unity "IDK - Gears - Head"
  {
    id: 'headGear',
    label: 'Head gear',
    meshNames: ['Head - Teeth'],
    sprite: 'gear',
    count: 400,
    size: 0.05,
    life: 1,
    speed: 0.002,
    renderOrder: 9,
  },
  // Unity "IDK - Projector - Head"
  {
    id: 'headProjector',
    label: 'Head projector',
    meshNames: ['Head - Teeth'],
    sprite: 'projector',
    count: 300,
    size: 0.03,
    life: 1,
    speed: 0.01,
    renderOrder: 10,
    normalOffset: 0.012,
  },
  // Unity "IDK - Projector - Glasses" → frame / temple arms (black projector)
  {
    id: 'glassesProjector',
    label: 'Glasses frame projector',
    meshNames: ['IDK Glasses'],
    sprite: 'projector',
    count: 280,
    size: 0.03,
    life: 1,
    speed: 0.01,
    renderOrder: 14,
    normalOffset: -0.008,
    glassesPart: 'frame',
  },
  // Unity "IDK - Heart - Glasses" → front lenses only
  {
    id: 'glassesHeart',
    label: 'Glasses lens heart',
    meshNames: ['IDK Glasses'],
    sprite: 'heart',
    count: 220,
    size: 0.035,
    life: 1,
    speed: 0.01,
    renderOrder: 15,
    normalOffset: -0.015,
    glassesPart: 'lenses',
  },
  // Unity "IDK - Cloud - Candle" — clouds sit on the wax; wax mesh stays visible.
  {
    id: 'candleCloud',
    label: 'Candle wax cloud',
    meshNames: ['IDK Candle'],
    sprite: 'cloud',
    count: 500,
    size: 0.05,
    life: 0.25,
    speed: 0,
    renderOrder: 12,
    hideMesh: false,
  },
  // Green clovers rising as a narrow flame from the wax tip centre.
  {
    id: 'candleClover',
    label: 'Candle clover flame',
    meshNames: ['IDK Candle'],
    sprite: 'clover',
    count: 70,
    size: 0.04,
    life: 0.55,
    speed: 0.32,
    renderOrder: 16,
    velocityMode: 'worldUp',
    hideMesh: false,
    spawnMode: 'waxTip',
    tipRadius: 0.004,
  },
  // Unity "IDK - Clover - Gunk" (instance life 0.5)
  {
    id: 'gunkClover',
    label: 'Gunk clover',
    meshNames: ['IDK Gunk'],
    sprite: 'clover',
    count: 80,
    size: 0.05,
    life: 0.5,
    speed: 0,
    renderOrder: 13,
  },
];

const SPRITE_URL: Record<SpriteId, string> = {
  heart: assetUrl('/textures/idk/emoji-heart.png'),
  gear: assetUrl('/textures/idk/emoji-gear.png'),
  cloud: assetUrl('/textures/idk/emoji-cloud.png'),
  clover: assetUrl('/textures/idk/emoji-clover.png'),
  projector: assetUrl('/textures/idk/emoji-projector.png'),
};

/** Unity instance transforms under mixamorig:Head/IDK (attachment-map-raw.json). */
type AccelLocal = {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
};

const IDK_GLASSES_LOCAL: AccelLocal = {
  position: new THREE.Vector3(0, 0.12950036, 0.11550004),
  quaternion: new THREE.Quaternion(-0.0811636, 1.3442667e-12, -6.4170544e-13, 0.9967008),
  scale: new THREE.Vector3(0.076973096, 0.084803544, 0.08480351),
};

const IDK_CANDLE_LOCAL: AccelLocal = {
  position: new THREE.Vector3(-0.009013701, 0.14360864, 0.03507071),
  quaternion: new THREE.Quaternion(-0.7318409, -0.2014699, -0.15368928, 0.6326124),
  scale: new THREE.Vector3(44.66089, 44.75649, 37.252365),
};

const IDK_GUNK_LOCAL: AccelLocal = {
  position: new THREE.Vector3(0.00649, 0.08678, 0.17095),
  quaternion: new THREE.Quaternion(0.9999395, 0.010854691, -0.001779642, 1.7881389e-07),
  scale: new THREE.Vector3(21.141752, 31.307976, 13.642359),
};

type AccelDef = {
  name: string;
  /** Already-correct meshes inside ghoul-avatar.glb */
  sourceNames: string[];
  local: AccelLocal;
  /** Candle wax stays rendered; glasses/gunk are particle-only shells. */
  keepVisible?: boolean;
};

const ACCELS: AccelDef[] = [
  {
    name: 'IDK Glasses',
    sourceNames: ['Glasses_-_RiffRaff', 'Glasses - RiffRaff'],
    local: IDK_GLASSES_LOCAL,
  },
  {
    name: 'IDK Candle',
    sourceNames: ['Candle'],
    local: IDK_CANDLE_LOCAL,
    keepVisible: true,
  },
  {
    name: 'IDK Gunk',
    sourceNames: ['Discharge_Tears', 'DischargeGunk'],
    local: IDK_GUNK_LOCAL,
  },
];

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _ab = new THREE.Vector3();
const _ac = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _axis = new THREE.Vector3();

type Tri = { a: number; b: number; c: number; cdf: number };

type Emitter = {
  id: IdkEmitterId;
  mesh: THREE.Mesh;
  skinned: THREE.SkinnedMesh | null;
  points: THREE.Points;
  positions: Float32Array;
  ages: Float32Array;
  spawn: Float32Array;
  velocities: Float32Array;
  tris: Uint32Array;
  bary: Float32Array;
  triList: Tri[];
  life: number;
  speed: number;
  normalOffset: number;
  velocityMode: 'normal' | 'worldUp';
  spawnMode: 'mesh' | 'waxTip';
  /** Mesh-local centre of the wax top (waxTip mode). */
  tipLocal: THREE.Vector3 | null;
  tipRadius: number;
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

/** Mean world-Z of mesh verts — lenses sit forward, frame/arms reach back. */
function meshMeanWorldZ(mesh: THREE.Mesh): number {
  const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
  if (!pos || pos.count === 0) return 0;
  mesh.updateWorldMatrix(true, false);
  let sum = 0;
  for (let i = 0; i < pos.count; i++) {
    _a.fromBufferAttribute(pos, i);
    mesh.localToWorld(_a);
    sum += _a.z;
  }
  return sum / pos.count;
}

/**
 * RiffRaff glasses export as two sibling meshes with nearly identical AABBs.
 * Pick by mean world Z: higher Z = lenses (front), lower Z = frame/arms.
 */
function meshesForSpec(root: THREE.Object3D, spec: EmitterSpec): THREE.Mesh[] {
  const all = findMeshes(root, spec.meshNames);
  if (!spec.glassesPart || all.length <= 1) return all;
  let best = all[0]!;
  let bestZ = meshMeanWorldZ(best);
  for (let i = 1; i < all.length; i++) {
    const mesh = all[i]!;
    const z = meshMeanWorldZ(mesh);
    if (spec.glassesPart === 'lenses' ? z > bestZ : z < bestZ) {
      best = mesh;
      bestZ = z;
    }
  }
  return [best];
}

function idkGroupVisible(root: THREE.Object3D): boolean {
  let visible = false;
  root.traverse((o) => {
    if (visible) return;
    const n = normName(o.name);
    if (n !== 'idk' && n !== 'idk_group') return;
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

function findIdkParent(root: THREE.Object3D): THREE.Object3D | null {
  return (
    findNamed(root, 'IDK') ?? findNamed(root, 'IDK_Group') ?? findNamed(root, 'IDK Group')
  );
}

function isUnderIdkAccessory(obj: THREE.Object3D): boolean {
  let p: THREE.Object3D | null = obj;
  while (p) {
    const n = normName(p.name);
    if (n === 'idk_glasses' || n === 'idk_candle' || n === 'idk_gunk') return true;
    p = p.parent;
  }
  return false;
}

/** Prefer the authored GLB mesh (correct units) over a raw FBX re-import. */
function findSourceMeshRoot(root: THREE.Object3D, sourceNames: string[]): THREE.Object3D | null {
  const want = new Set(sourceNames.map(normName));
  let best: THREE.Object3D | null = null;
  let bestMeshes = 0;
  root.traverse((o) => {
    if (!want.has(normName(o.name))) return;
    if (isUnderIdkAccessory(o)) return;
    const meshes: THREE.Mesh[] = [];
    collectMeshTree(o, meshes);
    if (meshes.length > bestMeshes) {
      best = o;
      bestMeshes = meshes.length;
    }
  });
  return best;
}

/**
 * IDK Glasses / Candle / Gunk aren't separate nodes in ghoul-avatar.glb.
 * Clone the matching trait meshes (RiffRaff glasses, Candle, Discharge_Tears)
 * under the IDK socket with Unity attachment transforms.
 */
function ensureIdkAccessories(root: THREE.Object3D): THREE.Object3D[] {
  const parent = findIdkParent(root);
  if (!parent) return [];

  const attached: THREE.Object3D[] = [];
  for (const def of ACCELS) {
    if (findNamed(root, def.name)) continue;

    const source = findSourceMeshRoot(root, def.sourceNames);
    if (!source) {
      console.warn(`[idk] missing GLB source for ${def.name} (tried ${def.sourceNames.join(', ')})`);
      continue;
    }

    const instance = source.clone(true);
    instance.name = def.name;
    instance.position.copy(def.local.position);
    instance.quaternion.copy(def.local.quaternion);
    instance.scale.copy(def.local.scale);
    // Rigid props under Head/IDK — replace any SkinnedMesh with a plain Mesh so
    // we sample bind-pose verts instead of a skeleton that still points at the
    // original trait hierarchy.
    const skinned: THREE.SkinnedMesh[] = [];
    instance.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned.push(o as THREE.SkinnedMesh);
    });
    const show = !!def.keepVisible;
    for (const sk of skinned) {
      const plain = new THREE.Mesh(sk.geometry, sk.material);
      // Keep sibling names (…_1 / …_2) so meshSlot order stays stable.
      plain.name = sk.name || def.name;
      plain.visible = show;
      plain.frustumCulled = false;
      plain.position.copy(sk.position);
      plain.quaternion.copy(sk.quaternion);
      plain.scale.copy(sk.scale);
      sk.parent?.add(plain);
      sk.removeFromParent();
    }
    instance.visible = true;
    instance.traverse((o) => {
      if (o === instance) return;
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.visible = show;
      mesh.frustumCulled = false;
    });
    parent.add(instance);
    attached.push(instance);
  }
  return attached;
}

function buildTriList(
  mesh: THREE.Mesh,
  /**
   * Extra clip in world space after the glasses child mesh is chosen.
   * Lenses: only the forward half. Frame: prefer the back/arms.
   */
  worldZClip?: 'front' | 'back',
): Tri[] {
  const geom = mesh.geometry;
  const pos = geom.getAttribute('position') as THREE.BufferAttribute;
  const idx = geom.index;
  type Cand = { a: number; b: number; c: number; area: number; wz: number };
  const cands: Cand[] = [];
  mesh.updateWorldMatrix(true, false);

  const push = (ia: number, ib: number, ic: number) => {
    _a.fromBufferAttribute(pos, ia);
    _b.fromBufferAttribute(pos, ib);
    _c.fromBufferAttribute(pos, ic);
    const area = _b.clone().sub(_a).cross(_c.clone().sub(_a)).length() * 0.5;
    if (!(area > 1e-12)) return;
    // World-space centroid Z (head faces +Z).
    _p.set(
      (_a.x + _b.x + _c.x) / 3,
      (_a.y + _b.y + _c.y) / 3,
      (_a.z + _b.z + _c.z) / 3,
    );
    mesh.localToWorld(_p);
    cands.push({ a: ia, b: ib, c: ic, area, wz: _p.z });
  };
  if (idx) {
    for (let i = 0; i < idx.count; i += 3) {
      push(idx.getX(i), idx.getX(i + 1), idx.getX(i + 2));
    }
  } else {
    for (let i = 0; i < pos.count; i += 3) push(i, i + 1, i + 2);
  }

  let keep = cands;
  if (worldZClip && cands.length > 0) {
    const zs = cands.map((c) => c.wz).sort((a, b) => a - b);
    const mid = zs[Math.floor(zs.length * 0.5)]!;
    // Lenses: forward 55%. Frame: rearward 60% (arms + rim).
    keep =
      worldZClip === 'front'
        ? cands.filter((c) => c.wz >= mid - 0.01)
        : cands.filter((c) => c.wz <= mid + 0.02);
    if (keep.length === 0) keep = cands;
  }

  const tris: Tri[] = [];
  let areaSum = 0;
  for (const c of keep) {
    areaSum += c.area;
    tris.push({ a: c.a, b: c.b, c: c.c, cdf: areaSum });
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
): void {
  const w = 1 - u - v;
  readTriVerts(mesh, skinned, tri);
  target.set(0, 0, 0).addScaledVector(_a, w).addScaledVector(_b, u).addScaledVector(_c, v);
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
        if (a < 0.5) discard;
        gl_FragColor = vec4(c.rgb, a);
      }
    `,
    transparent: true,
    depthTest: true,
    depthWrite: true,
    toneMapped: false,
    fog: false,
  });

  const points = new THREE.Points(geom, mat);
  points.frustumCulled = false;
  points.renderOrder = renderOrder;
  points.name = `IdkParticles_${sprite}`;
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

/**
 * Mesh-local centre of the wax top — same band average as torchFlame.placeOnWaxTop.
 */
function computeWaxTipLocal(mesh: THREE.Mesh, out: THREE.Vector3): void {
  const attr = mesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
  if (!attr || attr.count === 0) {
    out.set(0, 0, 0);
    return;
  }
  mesh.updateWorldMatrix(true, false);
  mesh.getWorldQuaternion(_quat);
  let axis = 1;
  let sign = 1;
  let best = -1;
  for (let i = 0; i < 3; i++) {
    _axis.set(i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0).applyQuaternion(_quat);
    const align = Math.abs(_axis.y);
    if (align > best) {
      best = align;
      axis = i;
      sign = _axis.y >= 0 ? 1 : -1;
    }
  }
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < attr.count; i++) {
    const v = attr.getComponent(i, axis);
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const top = sign > 0 ? max : min;
  const band = Math.max(max - min, 1e-6) * 0.08;
  out.set(0, 0, 0);
  let n = 0;
  for (let i = 0; i < attr.count; i++) {
    if (Math.abs(attr.getComponent(i, axis) - top) > band) continue;
    out.x += attr.getX(i);
    out.y += attr.getY(i);
    out.z += attr.getZ(i);
    n++;
  }
  if (n === 0) {
    out.set(0, 0, 0);
    return;
  }
  out.multiplyScalar(1 / n);
}

function respawnParticle(em: Emitter, i: number): void {
  const o = i * 3;

  if (em.spawnMode === 'waxTip' && em.tipLocal) {
    // Tight world-horizontal disk just above the wax top centre.
    _p.copy(em.tipLocal);
    em.mesh.localToWorld(_p);
    const ang = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * em.tipRadius;
    _p.x += Math.cos(ang) * r;
    _p.y += 0.012; // sit on the wick, above wax/cloud cover
    _p.z += Math.sin(ang) * r;
    em.spawn[o] = _p.x;
    em.spawn[o + 1] = _p.y;
    em.spawn[o + 2] = _p.z;
    em.tris[i] = 0;
    em.bary[i * 2] = 0;
    em.bary[i * 2 + 1] = 0;
  } else {
    em.tris[i] = pickTri(em.triList);
    randomBary(em.bary, i * 2);
    const tri = em.triList[em.tris[i]!]!;
    const u = em.bary[i * 2]!;
    const v = em.bary[i * 2 + 1]!;
    sampleWorld(em.mesh, em.skinned, tri, u, v, _p);
    if (em.normalOffset !== 0) {
      sampleWorldNormal(em.mesh, em.skinned, tri, _n);
      _p.addScaledVector(_n, em.normalOffset);
    }
    em.spawn[o] = _p.x;
    em.spawn[o + 1] = _p.y;
    em.spawn[o + 2] = _p.z;
  }

  if (em.speed <= 1e-6) {
    em.velocities[o] = 0;
    em.velocities[o + 1] = 0;
    em.velocities[o + 2] = 0;
  } else if (em.velocityMode === 'worldUp') {
    // Rising flame — minimal lateral drift; oscillation handles the wiggle.
    em.velocities[o] = (Math.random() - 0.5) * em.speed * 0.04;
    em.velocities[o + 1] = em.speed * (0.85 + Math.random() * 0.3);
    em.velocities[o + 2] = (Math.random() - 0.5) * em.speed * 0.04;
  } else {
    const tri = em.triList[em.tris[i]!]!;
    sampleWorldNormal(em.mesh, em.skinned, tri, _n);
    em.velocities[o] = _n.x * em.speed;
    em.velocities[o + 1] = _n.y * em.speed;
    em.velocities[o + 2] = _n.z * em.speed;
  }
}

export class IdkParticleManager {
  private emitters: Emitter[] = [];
  private hidden = new Set<THREE.Mesh>();
  private failed = false;
  private attached: THREE.Object3D[] = [];
  private syncGen = 0;
  private overrides = new Map<IdkEmitterId, Override>();
  private active = false;
  private loadPromise: Promise<void> | null = null;
  /** Accumulated time for clover-flame sway. */
  private time = 0;

  isActive(): boolean {
    return this.active && this.emitters.length > 0;
  }

  listEmitters(): IdkEmitterParams[] {
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

  setEmitterLife(id: IdkEmitterId, life: number): void {
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

  setEmitterSpeed(id: IdkEmitterId, speed: number): void {
    const clamped = clampSpeed(speed);
    const prev = this.overrides.get(id) ?? {};
    this.overrides.set(id, { ...prev, speed: clamped });
    for (const em of this.emitters) {
      if (em.id !== id) continue;
      em.speed = clamped;
      for (let i = 0; i < em.ages.length; i++) respawnParticle(em, i);
    }
  }

  resetEmitter(id: IdkEmitterId): void {
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
        respawnParticle(em, i);
      }
    }
  }

  exportSettings(): IdkSavedSettings {
    const emitters: IdkSavedSettings['emitters'] = {};
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
          respawnParticle(em, i);
        }
      }
    }
  }

  loadSavedSettings(): Promise<void> {
    if (!this.loadPromise) {
      this.loadPromise = (async () => {
        try {
          const res = await fetch(IDK_SETTINGS_URL, { cache: 'no-store' });
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
    if (!idkGroupVisible(root)) return;

    const attached = ensureIdkAccessories(root);
    if (gen !== this.syncGen) {
      for (const node of attached) node.removeFromParent();
      return;
    }
    this.attached = attached;

    const hideSet = new Set<THREE.Mesh>();
    for (const spec of SPECS) {
      const { life, speed } = resolveParams(spec, this.overrides.get(spec.id));
      const meshes = meshesForSpec(root, spec);
      for (const mesh of meshes) {
        if (spec.hideMesh !== false) hideSet.add(mesh);
        else mesh.visible = true;
        const geom = mesh.geometry;
        if (!geom.getAttribute('position')) continue;
        const spawnMode = spec.spawnMode ?? 'mesh';
        const zClip =
          spec.glassesPart === 'lenses'
            ? 'front'
            : spec.glassesPart === 'frame'
              ? 'back'
              : undefined;
        const triList = spawnMode === 'waxTip' ? [] : buildTriList(mesh, zClip);
        if (spawnMode !== 'waxTip' && triList.length === 0) continue;

        const tipLocal = spawnMode === 'waxTip' ? new THREE.Vector3() : null;
        if (tipLocal) computeWaxTipLocal(mesh, tipLocal);

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
        // Accessories are rigid clones; body/head stay skinned.
        const skinned =
          (mesh as THREE.SkinnedMesh).isSkinnedMesh && (mesh as THREE.SkinnedMesh).skeleton
            ? (mesh as THREE.SkinnedMesh)
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
          triList,
          life,
          speed,
          normalOffset: spec.normalOffset ?? 0,
          velocityMode: spec.velocityMode ?? 'normal',
          spawnMode,
          tipLocal,
          tipRadius: spec.tipRadius ?? 0.01,
        };

        for (let i = 0; i < spec.count; i++) {
          ages[i] = Math.random() * life;
          respawnParticle(em, i);
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
    this.time += clamped;

    try {
      for (const em of this.emitters) {
        if (!em.mesh.parent) {
          em.points.visible = false;
          continue;
        }
        em.points.visible = true;
        const pos = em.positions;
        const ages = em.ages;
        const moving = em.speed > 1e-6;
        const flameWave = em.spawnMode === 'waxTip' && em.velocityMode === 'worldUp';
        for (let i = 0; i < ages.length; i++) {
          ages[i]! += clamped;
          if (ages[i]! >= em.life) {
            ages[i]! -= em.life;
            if (ages[i]! >= em.life) ages[i] = 0;
            respawnParticle(em, i);
          }
          const o = i * 3;
          if (moving) {
            const t = ages[i]!;
            let x = em.spawn[o]! + em.velocities[o]! * t;
            let y = em.spawn[o + 1]! + em.velocities[o + 1]! * t;
            let z = em.spawn[o + 2]! + em.velocities[o + 2]! * t;
            if (flameWave) {
              // Strong left/right oscillation; grows with height so the base stays tight.
              const rise = Math.min(1, t / Math.max(em.life * 0.28, 0.05));
              const phase = i * 0.71;
              // Keep the column thin — wiggle is mostly in X, small Z drift.
              const amp = 0.022 * rise;
              x += Math.sin(this.time * 7.5 + phase) * amp;
              x += Math.sin(this.time * 3.2 + phase * 1.7) * amp * 0.4;
              z += Math.cos(this.time * 5.8 + phase * 1.3) * amp * 0.2;
              y += Math.sin(this.time * 8.0 + phase * 0.5) * 0.004 * rise;
            }
            pos[o] = x;
            pos[o + 1] = y;
            pos[o + 2] = z;
          } else {
            const tri = em.triList[em.tris[i]!]!;
            const u = em.bary[i * 2]!;
            const v = em.bary[i * 2 + 1]!;
            sampleWorld(em.mesh, em.skinned, tri, u, v, _p);
            if (em.normalOffset !== 0) {
              sampleWorldNormal(em.mesh, em.skinned, tri, _n);
              _p.addScaledVector(_n, em.normalOffset);
            }
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
      console.warn('[idk] particle update failed; disabling emitters', err);
      this.disposeEmitters();
    }
  }

  dispose(): void {
    this.disposeEmitters();
    this.overrides.clear();
  }

  private disposeEmitters(): void {
    this.hidden.clear();
    for (const em of this.emitters) {
      em.points.removeFromParent();
      em.points.geometry.dispose();
      (em.points.material as THREE.Material).dispose();
    }
    this.emitters = [];
    this.active = false;
    for (const node of this.attached) node.removeFromParent();
    this.attached = [];
  }
}
