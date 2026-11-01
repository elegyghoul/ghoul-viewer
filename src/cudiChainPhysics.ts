import * as THREE from 'three';

/**
 * Lightweight Verlet necklace for Ghoul Cudi's banana chain.
 * Builds a closed rope from the CudiChain mesh, pins the upper clasp
 * verts to the mesh attachment, and lets the rest hang under gravity.
 */

const SEGMENTS = 28;
const PIN_Y_FRAC = 0.72; // pin verts in the top ~28% of the ring
const GRAVITY = -7.5;
const DAMPING = 0.97;
const ITERATIONS = 6;
/** Cudi-only torso sphere — keeps the banana chain off the chest. */
const TORSO_RADIUS = 0.32;
/** Bone-local nudge toward mid-chest (Spine1 origin sits a bit high/back). */
const TORSO_LOCAL_OFFSET = new THREE.Vector3(0, 0.02, 0.04);
const SAMPLE_RADIUS = 0.012;

const TORSO_BONE_NAMES = [
  'mixamorig:Spine1',
  'mixamorigSpine1',
  'mixamorig:Spine',
  'mixamorigSpine',
  'mixamorig:Hips',
  'mixamorigHips',
];

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _n = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _inv = new THREE.Matrix4();

type Rope = {
  mesh: THREE.Mesh;
  /** World-space particle positions. */
  pos: Float32Array;
  prev: Float32Array;
  /** Mesh-local rest positions used to re-anchor pinned verts each frame. */
  pinLocal: Float32Array;
  pinned: Uint8Array;
  restLen: Float32Array;
  count: number;
  /** Torso sphere center (world). Driven by Spine1 each frame. */
  collideCenter: THREE.Vector3;
  collideRadius: number;
  torsoBone: THREE.Object3D | null;
};

function normBoneName(name: string): string {
  return name.replace(/\s+/g, '').replace(/:/g, '').toLowerCase();
}

function findTorsoBone(root: THREE.Object3D): THREE.Object3D | null {
  const want = new Set(TORSO_BONE_NAMES.map(normBoneName));
  let found: THREE.Object3D | null = null;
  root.traverse((o) => {
    if (found) return;
    if (want.has(normBoneName(o.name))) found = o;
  });
  return found;
}

function worldVerts(mesh: THREE.Mesh, out: THREE.Vector3[]): void {
  const attr = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
  mesh.updateWorldMatrix(true, false);
  out.length = 0;
  for (let i = 0; i < attr.count; i++) {
    _tmp.fromBufferAttribute(attr, i);
    mesh.localToWorld(_tmp);
    out.push(_tmp.clone());
  }
}

/** Angular bins around world +Y through the mesh centroid → closed ring. */
function buildRing(mesh: THREE.Mesh, segments: number): {
  world: THREE.Vector3[];
  local: THREE.Vector3[];
} {
  const verts: THREE.Vector3[] = [];
  worldVerts(mesh, verts);
  if (verts.length === 0) return { world: [], local: [] };

  const center = new THREE.Vector3();
  for (const v of verts) center.add(v);
  center.multiplyScalar(1 / verts.length);

  type Bin = { sum: THREE.Vector3; n: number };
  const bins: Bin[] = Array.from({ length: segments }, () => ({
    sum: new THREE.Vector3(),
    n: 0,
  }));

  for (const v of verts) {
    const dx = v.x - center.x;
    const dz = v.z - center.z;
    let ang = Math.atan2(dz, dx);
    if (ang < 0) ang += Math.PI * 2;
    const bi = Math.min(segments - 1, Math.floor((ang / (Math.PI * 2)) * segments));
    bins[bi]!.sum.add(v);
    bins[bi]!.n++;
  }

  const averaged = bins.map((b) => (b.n > 0 ? b.sum.clone().multiplyScalar(1 / b.n) : null));

  // Fill empty bins from neighbours so the ring stays continuous.
  const world: THREE.Vector3[] = new Array(segments);
  for (let i = 0; i < segments; i++) {
    if (averaged[i]) {
      world[i] = averaged[i]!;
      continue;
    }
    let found: THREE.Vector3 | null = null;
    for (let k = 1; k < segments && !found; k++) {
      const a = averaged[(i - k + segments) % segments];
      const b = averaged[(i + k) % segments];
      if (a && b) found = a.clone().lerp(b, 0.5);
      else if (a) found = a.clone();
      else if (b) found = b.clone();
    }
    world[i] = found ?? center.clone();
  }

  mesh.updateWorldMatrix(true, false);
  _inv.copy(mesh.matrixWorld).invert();
  const local = world.map((w) => w.clone().applyMatrix4(_inv));
  return { world, local };
}

export class CudiChainPhysics {
  private rope: Rope | null = null;
  private readonly _collide = new THREE.Vector3();

  get active(): boolean {
    return !!this.rope;
  }

  /** Radius of the Cudi torso sphere used to push the chain out. */
  get torsoRadius(): number {
    return this.rope?.collideRadius ?? TORSO_RADIUS;
  }

  attach(mesh: THREE.Mesh, root?: THREE.Object3D | null): void {
    this.dispose();
    const { world, local } = buildRing(mesh, SEGMENTS);
    if (world.length < 4) return;
    const torsoBone = root ? findTorsoBone(root) : null;

    const count = world.length;
    const pos = new Float32Array(count * 3);
    const prev = new Float32Array(count * 3);
    const pinLocal = new Float32Array(count * 3);
    const pinned = new Uint8Array(count);
    const restLen = new Float32Array(count);

    let minY = Infinity;
    let maxY = -Infinity;
    for (const w of world) {
      minY = Math.min(minY, w.y);
      maxY = Math.max(maxY, w.y);
    }
    const pinCut = minY + (maxY - minY) * PIN_Y_FRAC;

    for (let i = 0; i < count; i++) {
      const w = world[i]!;
      const l = local[i]!;
      const o = i * 3;
      pos[o] = w.x;
      pos[o + 1] = w.y;
      pos[o + 2] = w.z;
      prev[o] = w.x;
      prev[o + 1] = w.y;
      prev[o + 2] = w.z;
      pinLocal[o] = l.x;
      pinLocal[o + 1] = l.y;
      pinLocal[o + 2] = l.z;
      pinned[i] = w.y >= pinCut ? 1 : 0;
    }

    // Always keep at least two pins so the necklace can't fall off.
    if (pinned.every((p) => p === 0)) {
      let best = 0;
      let bestY = -Infinity;
      for (let i = 0; i < count; i++) {
        const y = world[i]!.y;
        if (y > bestY) {
          bestY = y;
          best = i;
        }
      }
      pinned[best] = 1;
      pinned[(best + 1) % count] = 1;
      pinned[(best - 1 + count) % count] = 1;
    }

    // Seed torso center, then shove any rest-pose links that start inside the
    // sphere out along character forward so the first frame doesn't eject behind.
    const collideCenter = new THREE.Vector3();
    const forward = new THREE.Vector3(0, 0, 1);
    if (torsoBone) {
      torsoBone.updateWorldMatrix(true, false);
      collideCenter.copy(TORSO_LOCAL_OFFSET);
      torsoBone.localToWorld(collideCenter);
      forward.set(0, 0, 1).transformDirection(torsoBone.matrixWorld).normalize();
    } else {
      let pinN = 0;
      for (let i = 0; i < count; i++) {
        if (!pinned[i]) continue;
        const o = i * 3;
        collideCenter.x += pos[o]!;
        collideCenter.y += pos[o + 1]!;
        collideCenter.z += pos[o + 2]!;
        pinN++;
      }
      if (pinN > 0) collideCenter.multiplyScalar(1 / pinN);
    }

    const cr = TORSO_RADIUS;
    const cr2 = cr * cr;
    for (let i = 0; i < count; i++) {
      if (pinned[i]) continue;
      const o = i * 3;
      let dx = pos[o]! - collideCenter.x;
      let dy = pos[o + 1]! - collideCenter.y;
      let dz = pos[o + 2]! - collideCenter.z;
      let d2 = dx * dx + dy * dy + dz * dz;
      // Prefer the front hemisphere even when already outside the sphere.
      const toward = dx * forward.x + dy * forward.y + dz * forward.z;
      if (toward < 0) {
        dx -= 2 * toward * forward.x;
        dy -= 2 * toward * forward.y;
        dz -= 2 * toward * forward.z;
        d2 = dx * dx + dy * dy + dz * dz;
      }
      if (d2 < cr2) {
        if (d2 < 1e-10) {
          dx = forward.x;
          dy = forward.y;
          dz = forward.z;
          d2 = 1;
        }
        const s = cr / Math.sqrt(d2);
        pos[o] = collideCenter.x + dx * s;
        pos[o + 1] = collideCenter.y + dy * s;
        pos[o + 2] = collideCenter.z + dz * s;
        prev[o] = pos[o]!;
        prev[o + 1] = pos[o + 1]!;
        prev[o + 2] = pos[o + 2]!;
      } else if (toward < 0) {
        pos[o] = collideCenter.x + dx;
        pos[o + 1] = collideCenter.y + dy;
        pos[o + 2] = collideCenter.z + dz;
        prev[o] = pos[o]!;
        prev[o + 1] = pos[o + 1]!;
        prev[o + 2] = pos[o + 2]!;
      }
    }

    for (let i = 0; i < count; i++) {
      const j = (i + 1) % count;
      const o = i * 3;
      const p = j * 3;
      const dx = pos[o]! - pos[p]!;
      const dy = pos[o + 1]! - pos[p + 1]!;
      const dz = pos[o + 2]! - pos[p + 2]!;
      restLen[i] = Math.hypot(dx, dy, dz);
    }

    this.rope = {
      mesh,
      pos,
      prev,
      pinLocal,
      pinned,
      restLen,
      count,
      collideCenter,
      collideRadius: TORSO_RADIUS,
      torsoBone,
    };
  }

  update(dt: number): void {
    const rope = this.rope;
    if (!rope || !rope.mesh.parent) return;
    const clamped = Math.min(Math.max(dt, 0), 0.05);
    if (clamped <= 0) return;

    const mesh = rope.mesh;
    mesh.updateWorldMatrix(true, false);
    if (rope.torsoBone) rope.torsoBone.updateWorldMatrix(true, false);

    const { pos, prev, pinLocal, pinned, restLen, count } = rope;
    const gdt = GRAVITY * clamped * clamped;

    // Re-anchor clasp to the attachment (follows head/neck animation).
    for (let i = 0; i < count; i++) {
      if (!pinned[i]) continue;
      const o = i * 3;
      _tmp.set(pinLocal[o]!, pinLocal[o + 1]!, pinLocal[o + 2]!);
      mesh.localToWorld(_tmp);
      pos[o] = _tmp.x;
      pos[o + 1] = _tmp.y;
      pos[o + 2] = _tmp.z;
      prev[o] = _tmp.x;
      prev[o + 1] = _tmp.y;
      prev[o + 2] = _tmp.z;
    }

    // Cudi torso sphere — centered on Spine1 (mid-chest), Cudi-only.
    if (rope.torsoBone) {
      this._collide.copy(TORSO_LOCAL_OFFSET);
      rope.torsoBone.localToWorld(this._collide);
    } else {
      // Fallback: below the clasp if the skeleton isn't available.
      this._collide.set(0, 0, 0);
      let pinN = 0;
      for (let i = 0; i < count; i++) {
        if (!pinned[i]) continue;
        const o = i * 3;
        this._collide.x += pos[o]!;
        this._collide.y += pos[o + 1]!;
        this._collide.z += pos[o + 2]!;
        pinN++;
      }
      if (pinN > 0) {
        this._collide.multiplyScalar(1 / pinN);
        this._collide.y -= 0.08;
        this._collide.z += 0.02;
      }
    }
    rope.collideCenter.copy(this._collide);

    for (let i = 0; i < count; i++) {
      if (pinned[i]) continue;
      const o = i * 3;
      const x = pos[o]!;
      const y = pos[o + 1]!;
      const z = pos[o + 2]!;
      const vx = (x - prev[o]!) * DAMPING;
      const vy = (y - prev[o + 1]!) * DAMPING;
      const vz = (z - prev[o + 2]!) * DAMPING;
      prev[o] = x;
      prev[o + 1] = y;
      prev[o + 2] = z;
      pos[o] = x + vx;
      pos[o + 1] = y + vy + gdt;
      pos[o + 2] = z + vz;
    }

    for (let iter = 0; iter < ITERATIONS; iter++) {
      for (let i = 0; i < count; i++) {
        const j = (i + 1) % count;
        const oa = i * 3;
        const ob = j * 3;
        const ax = pos[oa]!;
        const ay = pos[oa + 1]!;
        const az = pos[oa + 2]!;
        const bx = pos[ob]!;
        const by = pos[ob + 1]!;
        const bz = pos[ob + 2]!;
        const dx = bx - ax;
        const dy = by - ay;
        const dz = bz - az;
        const dist = Math.hypot(dx, dy, dz) || 1e-6;
        const rest = restLen[i]!;
        const diff = (dist - rest) / dist;
        const pa = pinned[i] ? 0 : pinned[j] ? 1 : 0.5;
        const pb = 1 - pa;
        const cx = dx * diff;
        const cy = dy * diff;
        const cz = dz * diff;
        if (!pinned[i]) {
          pos[oa] = ax + cx * pa;
          pos[oa + 1] = ay + cy * pa;
          pos[oa + 2] = az + cz * pa;
        }
        if (!pinned[j]) {
          pos[ob] = bx - cx * pb;
          pos[ob + 1] = by - cy * pb;
          pos[ob + 2] = bz - cz * pb;
        }
      }

      // Push free links out of the Cudi torso sphere (front hemisphere).
      const cr = rope.collideRadius;
      const cr2 = cr * cr;
      const cx = this._collide.x;
      const cy = this._collide.y;
      const cz = this._collide.z;
      _n.set(0, 0, 1);
      if (rope.torsoBone) {
        _n.transformDirection(rope.torsoBone.matrixWorld).normalize();
      }
      for (let i = 0; i < count; i++) {
        if (pinned[i]) continue;
        const o = i * 3;
        let dx = pos[o]! - cx;
        let dy = pos[o + 1]! - cy;
        let dz = pos[o + 2]! - cz;
        const behind = dx * _n.x + dy * _n.y + dz * _n.z;
        if (behind < 0) {
          dx -= 2 * behind * _n.x;
          dy -= 2 * behind * _n.y;
          dz -= 2 * behind * _n.z;
        }
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < cr2) {
          if (d2 < 1e-10) {
            dx = _n.x;
            dy = _n.y;
            dz = _n.z;
          }
          const s = cr / Math.sqrt(dx * dx + dy * dy + dz * dz);
          pos[o] = cx + dx * s;
          pos[o + 1] = cy + dy * s;
          pos[o + 2] = cz + dz * s;
        } else if (behind < 0) {
          pos[o] = cx + dx;
          pos[o + 1] = cy + dy;
          pos[o + 2] = cz + dz;
        }
      }
    }
  }

  get segmentCount(): number {
    return this.rope?.count ?? 0;
  }

  /** World position along segment `i` at parameter `t` ∈ [0,1], with radial jitter. */
  pointAt(i: number, t: number, radial: number, target: THREE.Vector3): void {
    const rope = this.rope;
    if (!rope) {
      target.set(0, 0, 0);
      return;
    }
    const { pos, count } = rope;
    const a = ((i % count) + count) % count;
    const b = (a + 1) % count;
    const oa = a * 3;
    const ob = b * 3;
    _a.set(pos[oa]!, pos[oa + 1]!, pos[oa + 2]!);
    _b.set(pos[ob]!, pos[ob + 1]!, pos[ob + 2]!);
    target.lerpVectors(_a, _b, t);

    if (Math.abs(radial) < 1e-8) return;
    _n.subVectors(_b, _a);
    if (_n.lengthSq() <= 1e-10) return;
    _n.normalize();
    // Stable-ish side vector from segment + world up.
    _c.set(0, 1, 0).cross(_n);
    if (_c.lengthSq() < 1e-8) _c.set(1, 0, 0).cross(_n);
    _c.normalize();
    target.addScaledVector(_c, radial * SAMPLE_RADIUS);
  }

  pick(): { seg: number; t: number; radial: number } {
    const count = Math.max(1, this.segmentCount);
    return {
      seg: (Math.random() * count) | 0,
      t: Math.random(),
      radial: (Math.random() - 0.5) * 2,
    };
  }

  dispose(): void {
    this.rope = null;
  }
}
