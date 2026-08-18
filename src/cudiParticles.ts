import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

/**
 * Unity Ghoul_Cudi (e.g. #5828): body/head/CudiTeeth/CudiEye/Rag/CudiChain
 * stay in the hierarchy as invisible emitter meshes. Particle systems spawn
 * emoji billboards on those surfaces (Cudi Basketball/Banana/X/Skull mats).
 * startSpeed 0 + short life → particles sit on the mesh and refresh.
 */

type SpriteId = 'basketball' | 'banana' | 'x' | 'skull';

type EmitterSpec = {
  meshNames: string[];
  sprite: SpriteId;
  count: number;
  size: number;
  life: number;
  /** Keep triangles whose local centroid passes this test (e.g. front of eye). */
  triFilter?: (cx: number, cy: number, cz: number) => boolean;
  /** Added in mesh-local space after surface sample (e.g. raise pupils). */
  localOffset?: readonly [number, number, number];
};

const SPECS: EmitterSpec[] = [
  {
    meshNames: ['Based Ghoul Body - Teeth'],
    sprite: 'basketball',
    count: 720,
    size: 0.07,
    life: 0.25,
  },
  {
    meshNames: ['Head - Teeth'],
    sprite: 'basketball',
    count: 380,
    size: 0.05,
    life: 0.5,
  },
  {
    meshNames: ['Head - Teeth'],
    sprite: 'x',
    count: 180,
    size: 0.045,
    life: 0.5,
  },
  {
    meshNames: ['CudiTeeth'],
    sprite: 'banana',
    count: 140,
    size: 0.03,
    life: 0.5,
  },
  {
    meshNames: ['CudiEye', 'CudiEye (1)'],
    sprite: 'banana',
    count: 90,
    size: 0.03,
    life: 0.5,
    // Unit-sphere emitters (scale ~0.016): keep front/upper patch as the pupil.
    triFilter: (_cx, cy, cz) => cy > -0.05 && cz > 0.15,
    // Geometry-local (pre-scale): ~1.4cm up + 0.6cm forward in world.
    localOffset: [0, 0.9, 0.4],
  },
  // Unity "Cudi - Skull - Rag" → skull emoji on the rag hat mesh.
  {
    meshNames: ['Rag', 'Rag (1)'],
    sprite: 'skull',
    count: 220,
    size: 0.03,
    life: 1,
  },
  // Unity "Cudi Banana Chain" → bananas on the necklace mesh.
  {
    meshNames: ['CudiChain'],
    sprite: 'banana',
    count: 160,
    size: 0.03,
    life: 1,
  },
];

const SPRITE_URL: Record<SpriteId, string> = {
  basketball: '/textures/cudi/emoji-basketball.png',
  banana: '/textures/cudi/emoji-banana.png',
  x: '/textures/cudi/emoji-x.png',
  skull: '/textures/cudi/emoji-skull.png',
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

const CUDI_CHAIN_URL = '/models/cudi/CudiChain.fbx';
const fbxLoader = new FBXLoader();
let chainTemplate: THREE.Group | null = null;
let chainTemplatePromise: Promise<THREE.Group | null> | null = null;

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _p = new THREE.Vector3();

type Tri = { a: number; b: number; c: number; cdf: number };

type Emitter = {
  mesh: THREE.Mesh;
  skinned: THREE.SkinnedMesh | null;
  points: THREE.Points;
  positions: Float32Array;
  ages: Float32Array;
  tris: Uint32Array;
  bary: Float32Array;
  triList: Tri[];
  life: number;
  hidden: THREE.Mesh[];
  localOffset: THREE.Vector3 | null;
};

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
  target.set(0, 0, 0).addScaledVector(_a, w).addScaledVector(_b, u).addScaledVector(_c, v);
  if (localOffset) target.add(localOffset);
  mesh.localToWorld(target);
}

function makePoints(count: number, sprite: SpriteId, size: number): {
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
    },
    vertexShader: /* glsl */ `
      attribute float aAge;
      uniform float uSize;
      uniform float uLife;
      varying float vFade;
      void main() {
        float t = clamp(aAge / max(uLife, 0.0001), 0.0, 1.0);
        vFade = smoothstep(0.0, 0.12, t) * (1.0 - smoothstep(0.82, 1.0, t));
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = uSize * (180.0 / max(0.15, -mv.z));
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      varying float vFade;
      void main() {
        vec4 c = texture2D(uMap, gl_PointCoord);
        if (c.a < 0.5) discard;
        gl_FragColor = vec4(c.rgb, c.a * vFade);
      }
    `,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    toneMapped: false,
    fog: false,
  });

  const points = new THREE.Points(geom, mat);
  points.frustumCulled = false;
  points.renderOrder = 8;
  points.name = `CudiParticles_${sprite}`;
  return { points, positions, ages };
}

export class CudiParticleManager {
  private emitters: Emitter[] = [];
  private hidden = new Set<THREE.Mesh>();
  private failed = false;
  private attachedChain: THREE.Object3D | null = null;
  private syncGen = 0;
  private eyeYNudge = new Map<THREE.Object3D, number>();

  async sync(root: THREE.Object3D, scene: THREE.Object3D): Promise<void> {
    const gen = ++this.syncGen;
    this.dispose();
    this.failed = false;
    if (!cudiGroupVisible(root)) return;

    // Necklace mesh isn't in ghoul-avatar.glb — spawn the Unity FBX emitter.
    const chain = await ensureCudiChain(root);
    if (gen !== this.syncGen) {
      chain?.removeFromParent();
      return;
    }
    this.attachedChain = chain;

    const hideSet = new Set<THREE.Mesh>();
    for (const spec of SPECS) {
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
        const triList = buildTriList(geom, spec.triFilter);
        if (triList.length === 0) continue;

        const { points, positions, ages } = makePoints(spec.count, spec.sprite, spec.size);
        (points.material as THREE.ShaderMaterial).uniforms.uLife!.value = spec.life;
        const tris = new Uint32Array(spec.count);
        const bary = new Float32Array(spec.count * 2);
        const skinned = (mesh as THREE.SkinnedMesh).isSkinnedMesh
          ? (mesh as THREE.SkinnedMesh)
          : null;
        const localOffset = spec.localOffset
          ? new THREE.Vector3(spec.localOffset[0], spec.localOffset[1], spec.localOffset[2])
          : null;

        for (let i = 0; i < spec.count; i++) {
          ages[i] = Math.random() * spec.life;
          tris[i] = pickTri(triList);
          randomBary(bary, i * 2);
        }

        scene.add(points);
        this.emitters.push({
          mesh,
          skinned,
          points,
          positions,
          ages,
          tris,
          bary,
          triList,
          life: spec.life,
          hidden: [mesh],
          localOffset,
        });
      }
    }

    for (const mesh of hideSet) {
      mesh.visible = false;
      this.hidden.add(mesh);
    }
  }

  update(dt: number): void {
    if (this.failed || this.emitters.length === 0) return;
    const clamped = Math.min(Math.max(dt, 0), 0.05);
    if (clamped <= 0) return;

    try {
      for (const em of this.emitters) {
        if (!em.mesh.parent) {
          em.points.visible = false;
          continue;
        }
        em.points.visible = true;
        const pos = em.positions;
        const ages = em.ages;
        for (let i = 0; i < ages.length; i++) {
          ages[i]! += clamped;
          if (ages[i]! >= em.life) {
            ages[i]! -= em.life;
            em.tris[i] = pickTri(em.triList);
            randomBary(em.bary, i * 2);
          }
          const tri = em.triList[em.tris[i]!]!;
          const u = em.bary[i * 2]!;
          const v = em.bary[i * 2 + 1]!;
          sampleWorld(em.mesh, em.skinned, tri, u, v, _p, em.localOffset);
          const o = i * 3;
          pos[o] = _p.x;
          pos[o + 1] = _p.y;
          pos[o + 2] = _p.z;
        }
        const g = em.points.geometry;
        (g.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
        (g.getAttribute('aAge') as THREE.BufferAttribute).needsUpdate = true;
      }
    } catch (err) {
      this.failed = true;
      console.warn('[cudi] particle update failed; disabling emitters', err);
      this.dispose();
    }
  }

  dispose(): void {
    for (const [mesh, y] of this.eyeYNudge) mesh.position.y = y;
    this.eyeYNudge.clear();
    for (const mesh of this.hidden) mesh.visible = true;
    this.hidden.clear();
    for (const em of this.emitters) {
      em.points.removeFromParent();
      em.points.geometry.dispose();
      (em.points.material as THREE.Material).dispose();
    }
    this.emitters = [];
    if (this.attachedChain) {
      this.attachedChain.removeFromParent();
      this.attachedChain = null;
    }
  }
}
