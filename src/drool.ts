import * as THREE from 'three';

/**
 * Occasional globs falling off a mouth piece. One DroolManager can run several
 * sources at once (sludge and blood now; spit uses the same path later).
 * Globs are lit meshes in the main pass, so dither and the palette treat them
 * like the rest of the ghoul.
 */

export type DroolStyle = {
  color: number;
  roughness: number;
  metalness: number;
  /** Seconds between drops. */
  gap: readonly [number, number];
  /** Lead glob radius, metres. */
  radius: readonly [number, number];
  /** Extra beads strung behind the lead glob. */
  tail: readonly [number, number];
  /** How far a glob falls before it breaks off, metres. */
  fall: readonly [number, number];
};

export type DroolSource = {
  /** Any of these object names can host the drip. The visible one is used. */
  anchorNames: string[];
  style: DroolStyle;
};

export const DROOL_PRESETS = {
  sludge: {
    color: 0x054403,
    roughness: 0.39,
    metalness: 0.75,
    gap: [1.15, 2.7],
    radius: [0.008, 0.013],
    tail: [1, 2],
    fall: [0.16, 0.28],
  },
  blood: {
    color: 0x6e1208,
    roughness: 0.45,
    metalness: 0.35,
    gap: [0.9, 2.2],
    radius: [0.006, 0.01],
    tail: [0, 2],
    fall: [0.18, 0.32],
  },
  drool: {
    color: 0xc5d4c2,
    roughness: 0.22,
    metalness: 0.08,
    gap: [1.4, 3.2],
    radius: [0.005, 0.009],
    tail: [1, 2],
    fall: [0.14, 0.24],
  },
} as const satisfies Record<string, DroolStyle>;

const POOL = 18;
const GRAVITY = 0.62;

const _lip = new THREE.Vector3();
const _vert = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _pos = new THREE.Vector3();
const _scale = new THREE.Vector3();
const _matrix = new THREE.Matrix4();
const _lowest: THREE.Vector3[] = Array.from({ length: 5 }, () => new THREE.Vector3());

type Bead = {
  alive: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  originY: number;
  radius: number;
  age: number;
  fall: number;
  phase: number;
};

type Emitter = {
  anchor: THREE.Object3D;
  mesh: THREE.Mesh;
  style: DroolStyle;
  instances: THREE.InstancedMesh;
  beads: Bead[];
  wait: number;
};

function norm(name: string): string {
  return name.trim().toLowerCase().replace(/[\s_]+/g, '');
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function randInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function anchorLive(obj: THREE.Object3D): boolean {
  let p: THREE.Object3D | null = obj;
  while (p) {
    if (!p.visible) return false;
    p = p.parent;
  }
  return true;
}

function findAnchor(root: THREE.Object3D, names: readonly string[]): THREE.Mesh | null {
  const want = new Set(names.map(norm));
  let found: THREE.Mesh | null = null;
  root.traverse((o) => {
    if (found || !want.has(norm(o.name))) return;
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && mesh.geometry) {
      found = mesh;
      return;
    }
    o.traverse((child) => {
      if (found || child === o) return;
      const m = child as THREE.Mesh;
      if (m.isMesh && m.geometry) found = m;
    });
  });
  return found;
}

/** Average of the lowest verts, just under the lip. */
function lipPoint(mesh: THREE.Mesh, out: THREE.Vector3): THREE.Vector3 {
  const attr = mesh.geometry.getAttribute('position');
  mesh.updateWorldMatrix(true, false);
  let n = 0;
  for (let i = 0; i < attr.count; i++) {
    _vert.fromBufferAttribute(attr as THREE.BufferAttribute, i);
    mesh.localToWorld(_vert);
    if (n < _lowest.length) {
      _lowest[n]!.copy(_vert);
      n++;
      continue;
    }
    let high = 0;
    for (let k = 1; k < _lowest.length; k++) {
      if (_lowest[k]!.y > _lowest[high]!.y) high = k;
    }
    if (_vert.y < _lowest[high]!.y) _lowest[high]!.copy(_vert);
  }
  out.set(0, 0, 0);
  const used = Math.max(n, 1);
  for (let i = 0; i < n; i++) out.add(_lowest[i]!);
  out.multiplyScalar(1 / used);
  out.y -= 0.006;
  return out;
}

function styleFromMesh(mesh: THREE.Mesh, fallback: DroolStyle): DroolStyle {
  const src = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.Material;
  if (!(src instanceof THREE.MeshStandardMaterial)) return fallback;
  return {
    ...fallback,
    color: src.color.getHex(),
    roughness: src.roughness,
    metalness: src.metalness,
  };
}

function makeBead(): Bead {
  return {
    alive: false,
    pos: new THREE.Vector3(),
    vel: new THREE.Vector3(),
    originY: 0,
    radius: 0.01,
    age: 0,
    fall: 0.2,
    phase: 0,
  };
}

function createEmitter(mesh: THREE.Mesh, style: DroolStyle, scene: THREE.Object3D): Emitter {
  const geom = new THREE.SphereGeometry(1, 10, 8);
  const mat = new THREE.MeshStandardMaterial({
    color: style.color,
    roughness: style.roughness,
    metalness: style.metalness,
  });
  const instances = new THREE.InstancedMesh(geom, mat, POOL);
  instances.name = 'Drool';
  instances.frustumCulled = false;
  instances.castShadow = false;
  instances.receiveShadow = false;
  _scale.set(0, 0, 0);
  for (let i = 0; i < POOL; i++) {
    _matrix.compose(_pos.set(0, 0, 0), _quat, _scale);
    instances.setMatrixAt(i, _matrix);
  }
  instances.instanceMatrix.needsUpdate = true;
  scene.add(instances);
  return {
    anchor: mesh,
    mesh,
    style,
    instances,
    beads: Array.from({ length: POOL }, makeBead),
    wait: 0.45 + Math.random() * 0.55,
  };
}

function wake(bead: Bead, at: THREE.Vector3, radius: number, fall: number, speed: number): void {
  bead.alive = true;
  bead.pos.copy(at);
  bead.originY = at.y;
  bead.vel.set((Math.random() - 0.5) * 0.012, -speed, (Math.random() - 0.5) * 0.012);
  bead.radius = radius;
  bead.age = 0;
  bead.fall = fall;
  bead.phase = Math.random() * Math.PI * 2;
}

function spawnDrop(em: Emitter): void {
  const { style } = em;
  lipPoint(em.mesh, _lip);
  _lip.x += (Math.random() - 0.5) * 0.008;
  _lip.z += (Math.random() - 0.5) * 0.008;
  const leadR = lerp(style.radius[0], style.radius[1], Math.random());
  const tailN = randInt(style.tail[0], style.tail[1]);
  const fall = lerp(style.fall[0], style.fall[1], Math.random());
  const free = em.beads.filter((b) => !b.alive);
  if (free.length < 1 + tailN) return;
  wake(free[0]!, _lip, leadR, fall, 0.025 + Math.random() * 0.03);
  for (let i = 0; i < tailN; i++) {
    _pos.copy(_lip);
    _pos.y += 0.007 * (i + 1);
    wake(free[i + 1]!, _pos, leadR * (0.62 - i * 0.12), fall * 0.9, 0.012 + Math.random() * 0.02);
  }
}

function writeBead(bead: Bead, instances: THREE.InstancedMesh, index: number): void {
  if (!bead.alive) {
    _scale.set(0, 0, 0);
    _matrix.compose(_pos.set(0, 0, 0), _quat, _scale);
    instances.setMatrixAt(index, _matrix);
    return;
  }
  const stretch = 1 + Math.min(bead.age * 2.4, 1.7);
  const life = bead.fall / (0.02 + GRAVITY * 0.45);
  const fadeStart = life * 0.72;
  const fade = bead.age < fadeStart ? 1 : Math.max(0, 1 - (bead.age - fadeStart) / (life * 0.28));
  const r = bead.radius * fade;
  const wob = Math.sin(bead.age * 7 + bead.phase) * 0.004 * Math.min(bead.age, 0.8);
  const extra = r * (stretch - 1);
  _pos.set(bead.pos.x + wob, bead.pos.y - extra * 0.65, bead.pos.z);
  _scale.set(r, r * stretch, r);
  _matrix.compose(_pos, _quat, _scale);
  instances.setMatrixAt(index, _matrix);
}

export class DroolManager {
  private emitters: Emitter[] = [];

  sync(root: THREE.Object3D | null, scene: THREE.Object3D, sources: readonly DroolSource[]): void {
    this.dispose();
    if (!root) return;
    for (const source of sources) {
      const mesh = findAnchor(root, source.anchorNames);
      if (!mesh || !anchorLive(mesh)) continue;
      this.emitters.push(createEmitter(mesh, styleFromMesh(mesh, source.style), scene));
    }
  }

  update(dt: number): void {
    const step = Math.min(Math.max(dt, 0), 0.05);
    if (step <= 0) return;
    for (const em of this.emitters) {
      const live = anchorLive(em.anchor);
      if (live) {
        em.wait -= step;
        if (em.wait <= 0) {
          spawnDrop(em);
          const gap = lerp(em.style.gap[0], em.style.gap[1], Math.random());
          em.wait = Math.random() < 0.3 ? 0.16 + Math.random() * 0.16 : gap;
        }
      }
      for (let i = 0; i < em.beads.length; i++) {
        const bead = em.beads[i]!;
        if (bead.alive) {
          bead.vel.y -= GRAVITY * step;
          bead.pos.addScaledVector(bead.vel, step);
          bead.age += step;
          const fallen = bead.originY - bead.pos.y;
          if (bead.age > 2.4 || fallen >= bead.fall) bead.alive = false;
        }
        writeBead(bead, em.instances, i);
      }
      em.instances.instanceMatrix.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const em of this.emitters) {
      em.instances.removeFromParent();
      em.instances.geometry.dispose();
      (em.instances.material as THREE.Material).dispose();
    }
    this.emitters = [];
  }
}
