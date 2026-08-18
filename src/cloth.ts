import * as THREE from 'three';
import { MAGICA_COLLIDERS, magicaGltfName } from './magicaCloakColliders';
import { MAGICA_PAINT, type MagicaPaint } from './magicaCloakPaint';

const CLOAK_MESH_PREFIXES = ['tatteredcloak_webgl', 'innercloak_webgl'];

function isCloakSimMesh(name: string): boolean {
  const n = normalizeName(name);
  return CLOAK_MESH_PREFIXES.some((p) => n === p || n.startsWith(`${p}_`));
}

function cloakFamilyKey(name: string): string {
  const n = normalizeName(name);
  for (const p of CLOAK_MESH_PREFIXES) {
    if (n === p || n.startsWith(`${p}_`)) return p;
  }
  return n;
}

function paintKeyForFamily(familyKey: string): string | null {
  if (familyKey.startsWith('tatteredcloak')) return 'tattered';
  if (familyKey.startsWith('innercloak')) return 'inner';
  return null;
}

function isMagicaClothName(name: string): boolean {
  const n = normalizeName(name);
  return n === 'magica_cloth' || n.startsWith('magica_cloth_');
}

/**
 * Magica selectionData is stored in the Magica Cloth child's local space.
 * InnerCloak's Magica node has scale ~1/34 and an extra X rotation; mesh
 * verts are in the cloak node's tiny local space. Matching without this
 * inverse left every inner particle equally soft (no Fixed roots).
 *
 * GLTFLoader suffixes duplicates: Magica_Cloth, Magica_Cloth_1, Magica_Cloth_2.
 */
function findMagicaClothNode(mesh: THREE.Object3D): THREE.Object3D | null {
  const family = cloakFamilyKey(mesh.name);
  const source = family.replace(/_webgl$/, '');
  let node: THREE.Object3D | null = mesh;
  while (node) {
    const parent = node.parent;
    const pool = parent ? parent.children : [node];
    for (const sib of pool) {
      const n = normalizeName(sib.name);
      if (n.includes('webgl')) continue;
      if (n !== source && !n.startsWith(`${source}_`)) continue;
      let found: THREE.Object3D | null = null;
      sib.traverse((o) => {
        if (found) return;
        if (isMagicaClothName(o.name)) found = o;
      });
      if (found) return found;
    }
    node = parent;
  }
  return null;
}

function magicaPaintSpaceMatrix(mesh: THREE.Object3D): THREE.Matrix4 {
  const magica = findMagicaClothNode(mesh);
  if (!magica) return _ident;
  mesh.updateWorldMatrix(true, false);
  magica.updateWorldMatrix(true, false);
  // mesh-local → world → Magica-local (where selectionData was painted)
  return _paintSpace.copy(magica.matrixWorld).invert().multiply(mesh.matrixWorld);
}

const _v = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _inv = new THREE.Matrix4();
const _local = new THREE.Vector3();
const _paintSpace = new THREE.Matrix4();
const _ident = new THREE.Matrix4();

/** Magica collider resolved against a Magica_* empty already in the GLB. */
type ResolvedCapsule = {
  object: THREE.Object3D;
  center: THREE.Vector3;
  /** Unit axis in collider-local space (ignored for spheres). */
  axis: THREE.Vector3;
  length: number;
  radius: number;
  kind: 'capsule' | 'sphere';
  worldStart: THREE.Vector3;
  worldEnd: THREE.Vector3;
  worldRadius: number;
  prevStart: THREE.Vector3;
  prevEnd: THREE.Vector3;
  primed: boolean;
};

export type ClothParams = {
  gravity: number;
  damping: number;
  iterations: number;
  /** Distance-constraint strength at hood/root (0–1). Magica-like. */
  stiffnessRoot: number;
  /** Distance-constraint strength at hem/tip (0–1). */
  stiffnessTip: number;
  /** Fraction of height from the top that stays fully pinned (0–1). */
  pinTopFraction: number;
  /**
   * Softness ramp in depth (0 = hood pin line, 1 = hem).
   * Below softStartDepth stays hood-stiff; past softEndDepth is fully soft
   * (shoulders ≈ mid of this range).
   */
  softStartDepth: number;
  softEndDepth: number;
  /**
   * Graph-depth fraction from Magica Fixed that stays fully pinned.
   * Covers hood crown, face-rim, and upper shoulders without shape-hold.
   */
  pinDepth: number;
  /** Extra blend toward rest pose at hood (holds the rim). */
  restBlendRoot: number;
  restBlendTip: number;
  maxSubstep: number;
  /** Max world-space drift from rest at hood / hem. */
  maxDriftRoot: number;
  maxDriftTip: number;
  /** World Y floor clamp for hem verts. */
  groundY: number;
  collisionPasses: number;
  /** Extra radius on top of authored capsule size. */
  colliderSkin: number;
  /** How much bone travel this frame inflates the capsule (stops tunneling). */
  colliderMotionExpand: number;
  /** Sleeve verts hitch to each hand/forearm (keeps rest offset). */
  boneBindPerArm: number;
  /** Max world distance from bone to hitch a vert. */
  boneBindMaxDist: number;
};

export const DEFAULT_CLOTH_PARAMS: ClothParams = {
  // From Magica cloakmc2 / TatteredCloak serializeData
  gravity: 5,
  damping: 0.12,
  iterations: 6,
  // Keep upper cloak rigid without shape-hold (angle-restoration stand-in).
  stiffnessRoot: 1,
  stiffnessTip: 0.14,
  pinTopFraction: 0.22, // fallback if no Magica paint
  // Softness only ramps past shoulders → hem
  softStartDepth: 0.32,
  softEndDepth: 0.7,
  // Pin hood + face rim + upper shoulders (graph depth from Fixed)
  pinDepth: 0.3,
  // Default off — structure comes from pins + stiffness, not rest glue
  restBlendRoot: 0,
  restBlendTip: 0,
  maxSubstep: 1 / 30,
  maxDriftRoot: 0.025,
  maxDriftTip: 0.85,
  groundY: 0.02,
  collisionPasses: 2,
  colliderSkin: 0.01,
  colliderMotionExpand: 0.25,
  boneBindPerArm: 6,
  boneBindMaxDist: 0.2,
};

/** @deprecated use DEFAULT_CLOTH_PARAMS */
const DEFAULT_PARAMS = DEFAULT_CLOTH_PARAMS;

/**
 * Verlet cloth over a static Mesh parented to an animated hierarchy (head cloak).
 * Pinned verts track the mesh rest pose in world space; free verts integrate in world space.
 */
export class MeshClothSim {
  readonly mesh: THREE.Mesh;
  private readonly originalGeometry: THREE.BufferGeometry;
  private readonly restLocal: Float32Array;
  private readonly pos: Float32Array;
  private readonly prev: Float32Array;
  private readonly pinned: Uint8Array;
  /** 0 = hood/root (rigid), 1 = hem/tip (soft). Magica depth. */
  private readonly soft: Float32Array;
  private readonly springs: Int32Array;
  private readonly restLengths: Float32Array;
  private readonly springCount: number;
  private readonly count: number;
  private params: ClothParams;
  private normTick = 0;
  /** -1 = follow cloak mesh; else index into followBones. */
  private readonly boneBind: Int16Array;
  private readonly boneLocal: Float32Array;
  private followBones: THREE.Object3D[] = [];

  constructor(
    mesh: THREE.Mesh,
    params: Partial<ClothParams> = {},
    /** Extra geometries whose edges join the spring graph (e.g. trim submesh). */
    extraSpringGeoms: THREE.BufferGeometry[] = [],
    /** Magica Manual selectionData (Fixed/Move) for this cloak family. */
    paint: MagicaPaint | null = null,
  ) {
    this.params = { ...DEFAULT_PARAMS, ...params };
    this.mesh = mesh;
    this.originalGeometry = mesh.geometry;
    const geom = mesh.geometry.clone();
    mesh.geometry = geom;

    const posAttr = geom.getAttribute('position') as THREE.BufferAttribute;
    this.count = posAttr.count;
    this.restLocal = new Float32Array(posAttr.array as Float32Array);
    this.pos = new Float32Array(this.count * 3);
    this.prev = new Float32Array(this.count * 3);
    this.pinned = new Uint8Array(this.count);
    this.soft = new Float32Array(this.count);
    this.boneBind = new Int16Array(this.count);
    this.boneBind.fill(-1);
    this.boneLocal = new Float32Array(this.count * 3);

    const { springs, restLengths } = buildSprings(geom, this.restLocal, extraSpringGeoms);
    // Unity multi-material splits duplicate rim verts (same rest pos, different indices).
    // Weld those together so the trim cannot peel off the cloak.
    const welded = addCoincidentWelds(springs, restLengths, this.restLocal);
    this.springs = welded.springs;
    this.restLengths = welded.restLengths;
    this.springCount = welded.restLengths.length;

    if (paint && paint.points.length > 0) {
      this.applyMagicaPaint(paint);
    } else {
      this.applyFallbackYPinning();
    }

    mesh.updateWorldMatrix(true, false);
    for (let i = 0; i < this.count; i++) {
      _local.set(this.restLocal[i * 3]!, this.restLocal[i * 3 + 1]!, this.restLocal[i * 3 + 2]!);
      _v.copy(_local).applyMatrix4(mesh.matrixWorld);
      const o = i * 3;
      this.pos[o] = this.prev[o] = _v.x;
      this.pos[o + 1] = this.prev[o + 1] = _v.y;
      this.pos[o + 2] = this.prev[o + 2] = _v.z;
    }

    // Rest lengths must match world-space distances (parent scale ≠ 1).
    for (let i = 0; i < this.springCount; i++) {
      const ia = this.springs[i * 2]! * 3;
      const ib = this.springs[i * 2 + 1]! * 3;
      const dx = this.pos[ib]! - this.pos[ia]!;
      const dy = this.pos[ib + 1]! - this.pos[ia + 1]!;
      const dz = this.pos[ib + 2]! - this.pos[ia + 2]!;
      this.restLengths[i] = Math.hypot(dx, dy, dz);
    }
  }

  /**
   * Magica Manual paint: Fixed=pin, Move=sim.
   * Verts farther than maxConnectionDistance are still simulated as Move —
   * Magica "Invalid" would follow skinning, which we don't have on the
   * static webgl cloak (pinning them froze tattered hem tips).
   */
  private applyMagicaPaint(paint: MagicaPaint): void {
    const maxD = paint.maxConnectionDistance;
    const maxD2 = maxD * maxD;
    const isFixedRoot = new Uint8Array(this.count);
    const toPaint = magicaPaintSpaceMatrix(this.mesh);

    for (let i = 0; i < this.count; i++) {
      _local.set(this.restLocal[i * 3]!, this.restLocal[i * 3 + 1]!, this.restLocal[i * 3 + 2]!);
      _local.applyMatrix4(toPaint);
      const ox = _local.x;
      const oy = _local.y;
      const oz = _local.z;
      let bestD2 = Infinity;
      let bestA = 2; // default Move
      for (let p = 0; p < paint.points.length; p++) {
        const pt = paint.points[p]!;
        const dx = ox - pt.p[0];
        const dy = oy - pt.p[1];
        const dz = oz - pt.p[2];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < bestD2) {
          bestD2 = d2;
          bestA = pt.a;
        }
      }
      // Only pin Magica Fixed samples that are actually nearby.
      // Distant verts keep nearest attr if Move; never pin as Invalid.
      const near = bestD2 <= maxD2;
      if (near && bestA === 1) {
        this.pinned[i] = 1;
        this.soft[i] = 0;
        isFixedRoot[i] = 1;
      } else {
        this.pinned[i] = 0;
        this.soft[i] = 1; // filled by BFS below
      }
    }

    // Depth = normalized graph distance from Fixed roots (Magica-style).
    const adj: number[][] = Array.from({ length: this.count }, () => []);
    for (let i = 0; i < this.springCount; i++) {
      const a = this.springs[i * 2]!;
      const b = this.springs[i * 2 + 1]!;
      adj[a]!.push(b);
      adj[b]!.push(a);
    }
    const dist = new Float32Array(this.count);
    dist.fill(-1);
    const queue: number[] = [];
    for (let i = 0; i < this.count; i++) {
      if (!isFixedRoot[i]) continue;
      dist[i] = 0;
      queue.push(i);
    }
    // If paint Fixed didn't land on any vert, use pinned verts as roots.
    if (queue.length === 0) {
      for (let i = 0; i < this.count; i++) {
        if (!this.pinned[i]) continue;
        dist[i] = 0;
        queue.push(i);
      }
    }
    let qi = 0;
    let maxDist = 0;
    while (qi < queue.length) {
      const u = queue[qi++]!;
      const du = dist[u]!;
      for (const v of adj[u]!) {
        if (dist[v]! >= 0) continue;
        dist[v] = du + 1;
        if (du + 1 > maxDist) maxDist = du + 1;
        queue.push(v);
      }
    }
    const inv = maxDist > 0 ? 1 / maxDist : 1;
    const pinDepth = this.params.pinDepth;
    const soft0 = this.params.softStartDepth;
    const soft1 = Math.max(soft0 + 1e-4, this.params.softEndDepth);
    for (let i = 0; i < this.count; i++) {
      const d = dist[i]!;
      const raw = d < 0 ? 1 : d * inv;
      // Expand Magica Fixed into a rigid hood shell (rim + shoulders).
      if (this.pinned[i] || raw <= pinDepth) {
        this.pinned[i] = 1;
        this.soft[i] = 0;
        continue;
      }
      const t = Math.min(1, Math.max(0, (raw - soft0) / (soft1 - soft0)));
      this.soft[i] = t * t * (3 - 2 * t);
    }
  }

  /** Fallback when Magica paint is missing: pin top band by local Y. */
  private applyFallbackYPinning(): void {
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < this.count; i++) {
      const y = this.restLocal[i * 3 + 1]!;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const pinY = maxY - (maxY - minY) * this.params.pinTopFraction;
    const depthSpan = Math.max(1e-6, pinY - minY);
    const soft0 = this.params.softStartDepth;
    const soft1 = Math.max(soft0 + 1e-4, this.params.softEndDepth);
    for (let i = 0; i < this.count; i++) {
      const y = this.restLocal[i * 3 + 1]!;
      this.pinned[i] = y >= pinY ? 1 : 0;
      const depth = this.pinned[i] ? 0 : Math.min(1, Math.max(0, (pinY - y) / depthSpan));
      const t = Math.min(1, Math.max(0, (depth - soft0) / (soft1 - soft0)));
      this.soft[i] = t * t * (3 - 2 * t);
    }
  }

  get vertexCount(): number {
    return this.count;
  }

  setParams(partial: Partial<ClothParams>): void {
    Object.assign(this.params, partial);
  }

  /**
   * Hitch nearby sleeve verts to hands/forearms, keeping their authored
   * offset in bone space. They ride with the arms so the drape can't
   * drift through the hands, without collapsing onto the skeleton.
   */
  bindFollowBones(bones: THREE.Object3D[]): void {
    this.followBones = bones;
    this.boneBind.fill(-1);
    if (bones.length === 0) return;

    const per = Math.max(0, this.params.boneBindPerArm);
    const maxD2 = this.params.boneBindMaxDist ** 2;
    if (per <= 0) return;

    this.mesh.updateWorldMatrix(true, false);
    const mw = this.mesh.matrixWorld;
    for (const bone of bones) bone.updateWorldMatrix(true, false);

    const bestBi = new Int16Array(this.count);
    const bestD2 = new Float32Array(this.count);
    bestBi.fill(-1);
    bestD2.fill(Infinity);

    for (let i = 0; i < this.count; i++) {
      if (this.pinned[i]) continue;
      const o = i * 3;
      _local.set(this.restLocal[o]!, this.restLocal[o + 1]!, this.restLocal[o + 2]!);
      _v.copy(_local).applyMatrix4(mw);
      for (let bi = 0; bi < bones.length; bi++) {
        bones[bi]!.getWorldPosition(_a);
        const d2 = _v.distanceToSquared(_a);
        if (d2 < bestD2[i]!) {
          bestD2[i] = d2;
          bestBi[i] = bi;
        }
      }
    }

    for (let bi = 0; bi < bones.length; bi++) {
      const bone = bones[bi]!;
      const scored: { i: number; d2: number }[] = [];
      for (let i = 0; i < this.count; i++) {
        if (bestBi[i] !== bi) continue;
        if (bestD2[i]! <= maxD2) scored.push({ i, d2: bestD2[i]! });
      }
      scored.sort((x, y) => x.d2 - y.d2);
      const take = Math.min(per, scored.length);
      _inv.copy(bone.matrixWorld).invert();
      for (let k = 0; k < take; k++) {
        const i = scored[k]!.i;
        const o = i * 3;
        _local.set(this.restLocal[o]!, this.restLocal[o + 1]!, this.restLocal[o + 2]!);
        _v.copy(_local).applyMatrix4(mw).applyMatrix4(_inv);
        this.boneLocal[o] = _v.x;
        this.boneLocal[o + 1] = _v.y;
        this.boneLocal[o + 2] = _v.z;
        this.boneBind[i] = bi;
        this.pinned[i] = 1;
      }
    }
  }

  private snapKinematic(i: number, mw: THREE.Matrix4, zeroVel: boolean): void {
    const o = i * 3;
    const bi = this.boneBind[i]!;
    if (bi >= 0) {
      const bone = this.followBones[bi];
      if (bone) {
        _local.set(this.boneLocal[o]!, this.boneLocal[o + 1]!, this.boneLocal[o + 2]!);
        _v.copy(_local).applyMatrix4(bone.matrixWorld);
      } else {
        _local.set(this.restLocal[o]!, this.restLocal[o + 1]!, this.restLocal[o + 2]!);
        _v.copy(_local).applyMatrix4(mw);
      }
    } else {
      _local.set(this.restLocal[o]!, this.restLocal[o + 1]!, this.restLocal[o + 2]!);
      _v.copy(_local).applyMatrix4(mw);
    }
    this.pos[o] = _v.x;
    this.pos[o + 1] = _v.y;
    this.pos[o + 2] = _v.z;
    if (zeroVel) {
      this.prev[o] = _v.x;
      this.prev[o + 1] = _v.y;
      this.prev[o + 2] = _v.z;
    }
  }

  particleInfo(i: number): { pinned: boolean; soft: number } {
    return { pinned: !!this.pinned[i], soft: this.soft[i]! };
  }

  /**
   * Write world-space particle positions + RGB colors into flat buffers.
   * Colors: picked = bright green, hand-hitch = green, pinned = red,
   * stiff free = amber, soft hem = cyan.
   */
  writeParticleDebug(
    outPos: Float32Array,
    outColor: Float32Array,
    offset = 0,
    highlightId = -1,
  ): number {
    for (let i = 0; i < this.count; i++) {
      const o = i * 3;
      const d = (offset + i) * 3;
      outPos[d] = this.pos[o]!;
      outPos[d + 1] = this.pos[o + 1]!;
      outPos[d + 2] = this.pos[o + 2]!;
      if (i === highlightId) {
        outColor[d] = 0.15;
        outColor[d + 1] = 1;
        outColor[d + 2] = 0.25;
      } else if (this.boneBind[i]! >= 0) {
        outColor[d] = 0.25;
        outColor[d + 1] = 0.85;
        outColor[d + 2] = 0.3;
      } else if (this.pinned[i]) {
        outColor[d] = 1;
        outColor[d + 1] = 0.25;
        outColor[d + 2] = 0.35;
      } else {
        const s = this.soft[i]!;
        outColor[d] = 1 - s * 0.75;
        outColor[d + 1] = 0.75 - s * 0.15;
        outColor[d + 2] = 0.2 + s * 0.8;
      }
    }
    return this.count;
  }

  reset(): void {
    this.mesh.updateWorldMatrix(true, false);
    for (const bone of this.followBones) bone.updateWorldMatrix(true, false);
    const mw = this.mesh.matrixWorld;
    for (let i = 0; i < this.count; i++) this.snapKinematic(i, mw, true);
    this.writeToGeometry();
  }

  dispose(): void {
    const live = this.mesh.geometry;
    this.mesh.geometry = this.originalGeometry;
    live.dispose();
  }

  update(dt: number, capsules: ResolvedCapsule[]): void {
    const clamped = Math.min(Math.max(dt, 0), this.params.maxSubstep);
    if (clamped <= 0) return;

    this.mesh.updateWorldMatrix(true, false);
    for (const bone of this.followBones) bone.updateWorldMatrix(true, false);
    const mw = this.mesh.matrixWorld;
    const g = this.params.gravity * clamped * clamped;
    const damp = Math.max(0, 1 - this.params.damping);

    for (let i = 0; i < this.count; i++) {
      const o = i * 3;
      if (this.pinned[i]) {
        this.snapKinematic(i, mw, true);
        continue;
      }
      const x = this.pos[o]!;
      const y = this.pos[o + 1]!;
      const z = this.pos[o + 2]!;
      const vx = (x - this.prev[o]!) * damp;
      const vy = (y - this.prev[o + 1]!) * damp;
      const vz = (z - this.prev[o + 2]!) * damp;
      this.prev[o] = x;
      this.prev[o + 1] = y;
      this.prev[o + 2] = z;
      this.pos[o] = x + vx;
      this.pos[o + 1] = y + vy - g;
      this.pos[o + 2] = z + vz;

      // Hood holds near rest pose (Magica root stiffness); hem is free.
      const soft = this.soft[i]!;
      const blend =
        this.params.restBlendRoot * (1 - soft) + this.params.restBlendTip * soft;
      if (blend > 1e-4) {
        _local.set(this.restLocal[o]!, this.restLocal[o + 1]!, this.restLocal[o + 2]!);
        _a.copy(_local).applyMatrix4(mw);
        this.pos[o] = this.pos[o]! + (_a.x - this.pos[o]!) * blend;
        this.pos[o + 1] = this.pos[o + 1]! + (_a.y - this.pos[o + 1]!) * blend;
        this.pos[o + 2] = this.pos[o + 2]! + (_a.z - this.pos[o + 2]!) * blend;
      }
    }

    for (let it = 0; it < this.params.iterations; it++) {
      this.satisfySprings();
      this.limitFromRest(mw);
      this.collideGround();
      // Alternate with springs so pushes don't fight every constraint step.
      if ((it & 1) === 1) this.collideCapsules(capsules, false);
      for (let i = 0; i < this.count; i++) {
        if (!this.pinned[i]) continue;
        this.snapKinematic(i, mw, false);
      }
    }
    // Final passes: project out, then zero contact velocity once (not every iter).
    for (let p = 0; p < this.params.collisionPasses; p++) {
      const last = p === this.params.collisionPasses - 1;
      this.collideCapsules(capsules, last);
      this.collideGround();
    }

    this.writeToGeometry();
  }

  private satisfySprings(): void {
    const s = this.springs;
    const rest = this.restLengths;
    const kRoot = this.params.stiffnessRoot;
    const kTip = this.params.stiffnessTip;
    for (let i = 0; i < this.springCount; i++) {
      const ia = s[i * 2]!;
      const ib = s[i * 2 + 1]!;
      const oa = ia * 3;
      const ob = ib * 3;
      const ax = this.pos[oa]!;
      const ay = this.pos[oa + 1]!;
      const az = this.pos[oa + 2]!;
      const bx = this.pos[ob]!;
      const by = this.pos[ob + 1]!;
      const bz = this.pos[ob + 2]!;
      let dx = bx - ax;
      let dy = by - ay;
      let dz = bz - az;
      const dist = Math.hypot(dx, dy, dz) || 1e-6;
      const target = rest[i]!;
      // Weld springs (rest 0) stay fully stiff so the rim can't peel off.
      const softAvg = (this.soft[ia]! + this.soft[ib]!) * 0.5;
      const k = target <= 1e-8 ? 1 : kRoot * (1 - softAvg) + kTip * softAvg;
      const corr = ((dist - target) / dist) * k * 0.5;
      dx *= corr;
      dy *= corr;
      dz *= corr;
      const pa = this.pinned[ia];
      const pb = this.pinned[ib];
      if (!pa && !pb) {
        this.pos[oa]! += dx;
        this.pos[oa + 1]! += dy;
        this.pos[oa + 2]! += dz;
        this.pos[ob]! -= dx;
        this.pos[ob + 1]! -= dy;
        this.pos[ob + 2]! -= dz;
      } else if (!pa && pb) {
        this.pos[oa]! += dx * 2;
        this.pos[oa + 1]! += dy * 2;
        this.pos[oa + 2]! += dz * 2;
      } else if (pa && !pb) {
        this.pos[ob]! -= dx * 2;
        this.pos[ob + 1]! -= dy * 2;
        this.pos[ob + 2]! -= dz * 2;
      }
    }
  }

  /** Soft tether toward animated rest pose — tighter at hood, looser at hem. */
  private limitFromRest(mw: THREE.Matrix4): void {
    const dRoot = this.params.maxDriftRoot;
    const dTip = this.params.maxDriftTip;
    for (let i = 0; i < this.count; i++) {
      if (this.pinned[i]) continue;
      const o = i * 3;
      const soft = this.soft[i]!;
      const maxDist = dRoot * (1 - soft) + dTip * soft;
      _local.set(this.restLocal[o]!, this.restLocal[o + 1]!, this.restLocal[o + 2]!);
      _a.copy(_local).applyMatrix4(mw);
      _v.set(this.pos[o]!, this.pos[o + 1]!, this.pos[o + 2]!);
      _b.subVectors(_v, _a);
      const d = _b.length();
      if (d <= maxDist || d < 1e-8) continue;
      _b.multiplyScalar(maxDist / d);
      this.pos[o] = _a.x + _b.x;
      this.pos[o + 1] = _a.y + _b.y;
      this.pos[o + 2] = _a.z + _b.z;
    }
  }

  private collideGround(): void {
    const y0 = this.params.groundY;
    for (let i = 0; i < this.count; i++) {
      if (this.pinned[i]) continue;
      const o = i * 3;
      if (this.pos[o + 1]! < y0) {
        this.pos[o + 1] = y0;
        // Kill downward velocity so it doesn't keep tunneling.
        if (this.prev[o + 1]! < y0) this.prev[o + 1] = y0;
      }
    }
  }

  private collideCapsules(capsules: ResolvedCapsule[], killVelocity: boolean): void {
    // Soft positional projection. Never add the push into prev mid-frame —
    // that preserved inward speed and blew up when capsules overlapped.
    const maxPush = 0.08;

    for (let c = 0; c < capsules.length; c++) {
      const cap = capsules[c]!;
      const sx = cap.worldStart.x;
      const sy = cap.worldStart.y;
      const sz = cap.worldStart.z;
      const abx = cap.worldEnd.x - sx;
      const aby = cap.worldEnd.y - sy;
      const abz = cap.worldEnd.z - sz;
      const abLenSq = abx * abx + aby * aby + abz * abz;
      const r = cap.worldRadius;
      const r2 = r * r;
      const isSphere = abLenSq < 1e-10;

      for (let i = 0; i < this.count; i++) {
        if (this.pinned[i]) continue;
        const o = i * 3;
        let px = this.pos[o]!;
        let py = this.pos[o + 1]!;
        let pz = this.pos[o + 2]!;

        let cx: number;
        let cy: number;
        let cz: number;
        if (isSphere) {
          cx = sx;
          cy = sy;
          cz = sz;
        } else {
          const ax = px - sx;
          const ay = py - sy;
          const az = pz - sz;
          let t = (ax * abx + ay * aby + az * abz) / abLenSq;
          if (t < 0) t = 0;
          else if (t > 1) t = 1;
          cx = sx + abx * t;
          cy = sy + aby * t;
          cz = sz + abz * t;
        }

        let dx = px - cx;
        let dy = py - cy;
        let dz = pz - cz;
        let d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= r2) continue;

        let nx: number;
        let ny: number;
        let nz: number;
        let d: number;
        if (d2 < 1e-10) {
          // Deep/center hit: place on surface along a stable normal (not r/eps).
          nx = 0;
          ny = 1;
          nz = 0;
          d = 0;
        } else {
          d = Math.sqrt(d2);
          nx = dx / d;
          ny = dy / d;
          nz = dz / d;
        }
        let push = r - d;
        if (push > maxPush) push = maxPush;
        px += nx * push;
        py += ny * push;
        pz += nz * push;
        this.pos[o] = px;
        this.pos[o + 1] = py;
        this.pos[o + 2] = pz;

        if (killVelocity) {
          // Zero contact velocity (stick) — only on the last resolve pass.
          this.prev[o] = px;
          this.prev[o + 1] = py;
          this.prev[o + 2] = pz;
        }
      }
    }
  }

  private writeToGeometry(): void {
    const geom = this.mesh.geometry;
    const attr = geom.getAttribute('position') as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    _inv.copy(this.mesh.matrixWorld).invert();

    for (let i = 0; i < this.count; i++) {
      const o = i * 3;
      _v.set(this.pos[o]!, this.pos[o + 1]!, this.pos[o + 2]!).applyMatrix4(_inv);
      arr[o] = _v.x;
      arr[o + 1] = _v.y;
      arr[o + 2] = _v.z;
    }
    attr.needsUpdate = true;
    this.normTick = (this.normTick + 1) % 4;
    if (this.normTick === 0) geom.computeVertexNormals();
  }
}

/**
 * Trim draw-call welded to the primary sim: same position buffer,
 * own index buffer + normals (rim faces only). Cannot separate from the main cloak.
 */
class WeldedTrimMesh {
  readonly mesh: THREE.Mesh;
  private readonly originalGeometry: THREE.BufferGeometry;
  private readonly weldedGeometry: THREE.BufferGeometry;
  private readonly touchedMaterials: THREE.Material[] = [];

  constructor(mesh: THREE.Mesh, primary: MeshClothSim) {
    this.mesh = mesh;
    this.originalGeometry = mesh.geometry;

    const welded = mesh.geometry.clone();
    const live = primary.mesh.geometry;
    // Share positions only. Normals must come from trim faces — primary
    // computeVertexNormals leaves rim-only verts at (0,0,0) which kills lighting.
    welded.setAttribute('position', live.getAttribute('position')!);
    mesh.geometry = welded;
    this.weldedGeometry = welded;

    mesh.renderOrder = (primary.mesh.renderOrder || 0) + 1;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      if (!mat) continue;
      // Thin rim strip: DoubleSide draws as two parallel outlines in profile.
      mat.side = THREE.FrontSide;
      mat.polygonOffset = true;
      mat.polygonOffsetFactor = -2;
      mat.polygonOffsetUnits = -2;
      mat.depthWrite = false;
      mat.needsUpdate = true;
      this.touchedMaterials.push(mat);
    }

    welded.computeVertexNormals();
  }

  refreshNormals(): void {
    this.weldedGeometry.computeVertexNormals();
  }

  dispose(): void {
    this.mesh.geometry = this.originalGeometry;
    this.mesh.renderOrder = 0;
    for (const mat of this.touchedMaterials) {
      mat.side = THREE.DoubleSide;
      mat.polygonOffset = false;
      mat.polygonOffsetFactor = 0;
      mat.polygonOffsetUnits = 0;
      mat.depthWrite = true;
      mat.needsUpdate = true;
    }
    this.weldedGeometry.deleteAttribute('position');
    this.weldedGeometry.dispose();
  }
}

function buildSprings(
  geom: THREE.BufferGeometry,
  restLocal: Float32Array,
  extraGeoms: THREE.BufferGeometry[] = [],
): { springs: Int32Array; restLengths: Float32Array } {
  const edgeSet = new Set<string>();
  const pairs: number[] = [];

  const addEdge = (a: number, b: number) => {
    if (a === b) return;
    const lo = a < b ? a : b;
    const hi = a < b ? b : a;
    const key = `${lo},${hi}`;
    if (edgeSet.has(key)) return;
    edgeSet.add(key);
    pairs.push(lo, hi);
  };

  const addFromGeom = (g: THREE.BufferGeometry) => {
    const index = g.getIndex();
    if (index) {
      for (let i = 0; i < index.count; i += 3) {
        const a = index.getX(i);
        const b = index.getX(i + 1);
        const c = index.getX(i + 2);
        addEdge(a, b);
        addEdge(b, c);
        addEdge(c, a);
      }
    } else {
      const n = (g.getAttribute('position') as THREE.BufferAttribute).count;
      for (let i = 0; i + 2 < n; i += 3) {
        addEdge(i, i + 1);
        addEdge(i + 1, i + 2);
        addEdge(i + 2, i);
      }
    }
  };

  addFromGeom(geom);
  for (const extra of extraGeoms) addFromGeom(extra);

  const springCount = pairs.length / 2;
  const springs = new Int32Array(pairs);
  const restLengths = new Float32Array(springCount);
  for (let i = 0; i < springCount; i++) {
    const a = pairs[i * 2]! * 3;
    const b = pairs[i * 2 + 1]! * 3;
    const dx = restLocal[b]! - restLocal[a]!;
    const dy = restLocal[b + 1]! - restLocal[a + 1]!;
    const dz = restLocal[b + 2]! - restLocal[a + 2]!;
    restLengths[i] = Math.hypot(dx, dy, dz);
  }
  return { springs, restLengths };
}

/** Stiff zero-length springs between verts that share the same rest position. */
function addCoincidentWelds(
  springs: Int32Array,
  restLengths: Float32Array,
  restLocal: Float32Array,
): { springs: Int32Array; restLengths: Float32Array } {
  const count = restLocal.length / 3;
  const cell = 1e-4;
  const buckets = new Map<string, number[]>();

  for (let i = 0; i < count; i++) {
    const o = i * 3;
    const key = `${Math.round(restLocal[o]! / cell)},${Math.round(restLocal[o + 1]! / cell)},${Math.round(restLocal[o + 2]! / cell)}`;
    let list = buckets.get(key);
    if (!list) {
      list = [];
      buckets.set(key, list);
    }
    list.push(i);
  }

  const pairs: number[] = [];
  const lengths: number[] = [];
  for (let i = 0; i < restLengths.length; i++) {
    pairs.push(springs[i * 2]!, springs[i * 2 + 1]!);
    lengths.push(restLengths[i]!);
  }

  const edgeSet = new Set<string>();
  for (let i = 0; i < restLengths.length; i++) {
    const a = springs[i * 2]!;
    const b = springs[i * 2 + 1]!;
    edgeSet.add(a < b ? `${a},${b}` : `${b},${a}`);
  }

  let weldCount = 0;
  for (const list of buckets.values()) {
    if (list.length < 2) continue;
    const root = list[0]!;
    for (let i = 1; i < list.length; i++) {
      const other = list[i]!;
      const lo = root < other ? root : other;
      const hi = root < other ? other : root;
      const key = `${lo},${hi}`;
      if (edgeSet.has(key)) continue;
      edgeSet.add(key);
      pairs.push(lo, hi);
      lengths.push(0);
      weldCount++;
    }
  }

  if (weldCount === 0) return { springs, restLengths };
  return { springs: new Int32Array(pairs), restLengths: new Float32Array(lengths) };
}

function normalizeName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().toLowerCase().replace(/ /g, '_');
}

function findNamedObject(root: THREE.Object3D, name: string): THREE.Object3D | null {
  let found: THREE.Object3D | null = null;
  const want = normalizeName(name);
  const wantNoColon = want.replace(/:/g, '');
  root.traverse((o) => {
    if (found) return;
    const n = normalizeName(o.name);
    const n2 = normalizeName(o.name.replace(/:/g, ''));
    if (n === want || n === wantNoColon || n2 === wantNoColon || o.name === name) {
      found = o;
    }
  });
  return found;
}

type CloakFamily = {
  primary: MeshClothSim;
  trims: WeldedTrimMesh[];
};

export type ClothParticleHit = {
  family: string;
  id: number;
  pinned: boolean;
  soft: number;
};

const HAND_FOLLOW_BONES = [
  'mixamorigLeftHand',
  'mixamorigRightHand',
  'mixamorigLeftForeArm',
  'mixamorigRightForeArm',
];

/** Manages cloak cloth sims on the Unity-exported avatar. */
export class CloakClothManager {
  private root: THREE.Object3D | null = null;
  private families = new Map<string, CloakFamily>();
  private capsules: ResolvedCapsule[] = [];
  private followBones: THREE.Object3D[] = [];
  private params: Partial<ClothParams>;
  private debugGroup: THREE.Group | null = null;
  private debugMeshes: THREE.Mesh[] = [];
  private debugVisible = false;
  private debugParent: THREE.Object3D | null = null;
  private particleVisible = false;
  private particleParent: THREE.Object3D | null = null;
  private particlePoints: THREE.Points | null = null;
  private picked: { family: string; id: number } | null = null;
  private readonly _yAxis = new THREE.Vector3(0, 1, 0);
  private readonly _capDir = new THREE.Vector3();
  private readonly _capMid = new THREE.Vector3();
  private readonly _capA = new THREE.Vector3();
  private readonly _capB = new THREE.Vector3();

  constructor(params: Partial<ClothParams> = {}) {
    this.params = params;
  }

  /** Live-tweak sim params (tension, gravity, …) on all active cloaks. */
  setParams(partial: Partial<ClothParams>): void {
    this.params = { ...this.params, ...partial };
    for (const family of this.families.values()) {
      family.primary.setParams(partial);
    }
  }

  getParams(): ClothParams {
    return { ...DEFAULT_CLOTH_PARAMS, ...this.params };
  }

  bind(root: THREE.Object3D): void {
    const keepDebug = this.debugVisible;
    const debugParent = this.debugParent;
    const keepParticles = this.particleVisible;
    const particleParent = this.particleParent;
    this.disposeAll();
    this.root = root;
    this.capsules = [];
    this.followBones = [];
    for (const name of HAND_FOLLOW_BONES) {
      const bone = findNamedObject(root, name);
      if (bone) this.followBones.push(bone);
    }
    for (const def of MAGICA_COLLIDERS) {
      const obj =
        findNamedObject(root, magicaGltfName(def.name)) ?? findNamedObject(root, def.name);
      if (!obj) continue;
      const axis = new THREE.Vector3(
        def.direction === 0 ? 1 : 0,
        def.direction === 1 ? 1 : 0,
        def.direction === 2 ? 1 : 0,
      );
      let length = def.length;
      let center = new THREE.Vector3(def.center[0], def.center[1], def.center[2]);
      if (def.fitToChild) {
        const child = obj.children.find((c) => {
          const n = c.name.toLowerCase();
          return n.length > 0 && !n.includes('magica') && !n.includes('collider');
        });
        if (child) {
          const len = Math.max(Math.abs(child.position.y), 0.012);
          length = len;
          center.set(0, len * 0.5, 0);
        }
      }
      this.capsules.push({
        object: obj,
        center,
        axis,
        length,
        radius: def.radius,
        kind: def.kind,
        worldStart: new THREE.Vector3(),
        worldEnd: new THREE.Vector3(),
        worldRadius: def.radius,
        prevStart: new THREE.Vector3(),
        prevEnd: new THREE.Vector3(),
        primed: false,
      });
    }
    if (keepDebug && debugParent) this.setShowColliders(true, debugParent);
    if (keepParticles && particleParent) this.setShowParticles(true, particleParent);
  }

  /** Toggle wireframe capsule helpers parented to `scene`. */
  setShowColliders(show: boolean, scene: THREE.Object3D): void {
    this.debugVisible = show;
    this.debugParent = scene;
    this.clearDebugHelpers();
    if (!show || this.capsules.length === 0) return;

    this.debugGroup = new THREE.Group();
    this.debugGroup.name = 'ClothColliderDebug';
    const mat = new THREE.MeshBasicMaterial({
      color: 0x33ff99,
      wireframe: true,
      depthTest: false,
      transparent: true,
      opacity: 0.85,
    });
    for (const _ of this.capsules) {
      // Unit capsule along Y; scaled/oriented each frame.
      const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(1, 1, 4, 8), mat);
      mesh.frustumCulled = false;
      this.debugGroup.add(mesh);
      this.debugMeshes.push(mesh);
    }
    scene.add(this.debugGroup);
    this.syncDebugHelpers();
  }

  get showingColliders(): boolean {
    return this.debugVisible;
  }

  get colliderCount(): number {
    return this.capsules.length;
  }

  /** Toggle world-space particle dots (pinned red, soft amber→cyan). */
  setShowParticles(show: boolean, scene: THREE.Object3D): void {
    this.particleVisible = show;
    this.particleParent = scene;
    if (!show) this.picked = null;
    this.clearParticleHelpers();
    if (!show) return;
    this.rebuildParticleHelpers(scene);
  }

  /**
   * Click-pick the nearest debug particle in screen space.
   * `ndcX/Y` are in [-1, 1]; `maxNdc` is the hit radius in NDC (≈ pixels / halfWidth).
   */
  pickParticle(
    camera: THREE.Camera,
    ndcX: number,
    ndcY: number,
    maxNdc = 0.12,
  ): ClothParticleHit | null {
    if (!this.particleVisible || !this.particlePoints) return null;
    const posAttr = this.particlePoints.geometry.getAttribute('position') as THREE.BufferAttribute;
    if (!posAttr || posAttr.count === 0) return null;

    camera.updateMatrixWorld();
    const maxD2 = maxNdc * maxNdc;
    let best = -1;
    let bestD2 = maxD2;
    for (let i = 0; i < posAttr.count; i++) {
      _v.fromBufferAttribute(posAttr, i);
      _v.project(camera);
      if (_v.z < -1 || _v.z > 1) continue;
      const dx = _v.x - ndcX;
      const dy = _v.y - ndcY;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = i;
      }
    }
    if (best < 0) return null;

    let offset = 0;
    for (const [family, fam] of this.families) {
      const n = fam.primary.vertexCount;
      if (best < offset + n) {
        const id = best - offset;
        this.picked = { family, id };
        const info = fam.primary.particleInfo(id);
        return { family, id, pinned: info.pinned, soft: info.soft };
      }
      offset += n;
    }
    return null;
  }

  get showingParticles(): boolean {
    return this.particleVisible;
  }

  get particleCount(): number {
    let n = 0;
    for (const family of this.families.values()) n += family.primary.vertexCount;
    return n;
  }

  private clearDebugHelpers(): void {
    if (this.debugGroup?.parent) this.debugGroup.parent.remove(this.debugGroup);
    for (const mesh of this.debugMeshes) {
      mesh.geometry.dispose();
    }
    if (this.debugMeshes[0]) {
      (this.debugMeshes[0].material as THREE.Material).dispose();
    }
    this.debugMeshes = [];
    this.debugGroup = null;
  }

  private clearParticleHelpers(): void {
    if (!this.particlePoints) return;
    if (this.particlePoints.parent) this.particlePoints.parent.remove(this.particlePoints);
    this.particlePoints.geometry.dispose();
    (this.particlePoints.material as THREE.Material).dispose();
    this.particlePoints = null;
  }

  private rebuildParticleHelpers(scene: THREE.Object3D): void {
    const count = this.particleCount;
    if (count === 0) return;

    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    let offset = 0;
    for (const [key, family] of this.families) {
      const hi = this.picked?.family === key ? this.picked.id : -1;
      offset += family.primary.writeParticleDebug(positions, colors, offset, hi);
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.PointsMaterial({
      size: 0.028,
      sizeAttenuation: true,
      vertexColors: true,
      depthTest: false,
      transparent: true,
      opacity: 0.95,
    });
    this.particlePoints = new THREE.Points(geom, mat);
    this.particlePoints.name = 'ClothParticleDebug';
    this.particlePoints.frustumCulled = false;
    this.particlePoints.renderOrder = 999;
    scene.add(this.particlePoints);
  }

  private syncParticleHelpers(): void {
    if (!this.particlePoints) return;
    const posAttr = this.particlePoints.geometry.getAttribute('position') as THREE.BufferAttribute;
    const colAttr = this.particlePoints.geometry.getAttribute('color') as THREE.BufferAttribute;
    const positions = posAttr.array as Float32Array;
    const colors = colAttr.array as Float32Array;
    const expected = this.particleCount;
    if (expected === 0 || positions.length !== expected * 3) {
      this.clearParticleHelpers();
      if (this.particleParent && expected > 0) this.rebuildParticleHelpers(this.particleParent);
      return;
    }
    let offset = 0;
    for (const [key, family] of this.families) {
      const hi = this.picked?.family === key ? this.picked.id : -1;
      offset += family.primary.writeParticleDebug(positions, colors, offset, hi);
    }
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
  }

  private syncDebugHelpers(): void {
    if (!this.debugGroup || this.debugMeshes.length === 0) return;
    for (let i = 0; i < this.capsules.length; i++) {
      const cap = this.capsules[i]!;
      const mesh = this.debugMeshes[i];
      if (!mesh) continue;
      this._capA.copy(cap.worldStart);
      this._capB.copy(cap.worldEnd);
      this._capDir.subVectors(this._capB, this._capA);
      const dist = this._capDir.length();
      this._capMid.copy(this._capA).add(this._capB).multiplyScalar(0.5);
      mesh.position.copy(this._capMid);
      if (dist > 1e-6) {
        this._capDir.multiplyScalar(1 / dist);
        mesh.quaternion.setFromUnitVectors(this._yAxis, this._capDir);
      }
      const r = cap.worldRadius;
      const cyl = Math.max(0.001, dist);
      const totalUnit = 1 + 2;
      const sy = (cyl + 2 * r) / totalUnit;
      mesh.scale.set(r, sy, r);
    }
  }

  /** Call after assemble / trait visibility changes. */
  sync(): void {
    if (!this.root) return;

    const visibleByFamily = new Map<string, THREE.Mesh[]>();
    this.root.traverse((o) => {
      if (!(o as THREE.Mesh).isMesh) return;
      if (!o.visible) return;
      if (!isCloakSimMesh(o.name)) return;
      let p: THREE.Object3D | null = o.parent;
      while (p) {
        if (!p.visible) return;
        p = p.parent;
      }
      const key = cloakFamilyKey(o.name);
      let list = visibleByFamily.get(key);
      if (!list) {
        list = [];
        visibleByFamily.set(key, list);
      }
      list.push(o as THREE.Mesh);
    });

    for (const [key, family] of this.families) {
      if (!visibleByFamily.has(key)) {
        disposeFamily(family);
        this.families.delete(key);
      }
    }

    for (const [key, meshes] of visibleByFamily) {
      if (this.families.has(key)) continue;

      // Largest index buffer = main cloak; smaller = trim faces (material names are remapped).
      const primaryMesh = meshes.slice().sort(
        (a, b) =>
          (b.geometry.getIndex()?.count ?? 0) - (a.geometry.getIndex()?.count ?? 0),
      )[0]!;
      const trimMeshes = meshes.filter((m) => m !== primaryMesh);

      const paintKey = paintKeyForFamily(key);
      const paint = paintKey ? MAGICA_PAINT[paintKey] ?? null : null;
      const primary = new MeshClothSim(
        primaryMesh,
        this.params,
        trimMeshes.map((m) => m.geometry),
        paint,
      );
      primary.bindFollowBones(this.followBones);
      const trims = trimMeshes.map((m) => new WeldedTrimMesh(m, primary));
      this.families.set(key, { primary, trims });
    }

    if (this.particleVisible && this.particleParent) {
      this.clearParticleHelpers();
      this.rebuildParticleHelpers(this.particleParent);
    }
  }

  reset(): void {
    for (const family of this.families.values()) family.primary.reset();
  }

  update(dt: number): void {
    if (this.capsules.length > 0 && (this.families.size > 0 || this.debugVisible)) {
      this.resolveWorldCapsules();
    }
    if (this.families.size > 0) {
      for (const family of this.families.values()) {
        if (!family.primary.mesh.visible) continue;
        family.primary.update(dt, this.capsules);
        for (const trim of family.trims) trim.refreshNormals();
      }
      this.commitCapsuleMotion();
    }
    if (this.debugVisible) this.syncDebugHelpers();
    if (this.particleVisible) this.syncParticleHelpers();
  }

  /** Cache Magica collider world capsules once per frame. */
  private resolveWorldCapsules(): void {
    const skin = this.params.colliderSkin ?? DEFAULT_PARAMS.colliderSkin;
    const expand = this.params.colliderMotionExpand ?? DEFAULT_PARAMS.colliderMotionExpand;
    for (const cap of this.capsules) {
      cap.object.updateWorldMatrix(true, false);
      const mw = cap.object.matrixWorld;
      // Magica multiplies radius by lossyScale.x
      cap.object.getWorldScale(_v);
      const scale = Math.max(Math.abs(_v.x), 1e-6);

      if (cap.kind === 'sphere' || cap.length < 1e-8) {
        _local.copy(cap.center).applyMatrix4(mw);
        cap.worldStart.copy(_local);
        cap.worldEnd.copy(_local);
      } else {
        const half = cap.length * 0.5;
        _a.copy(cap.center).addScaledVector(cap.axis, -half).applyMatrix4(mw);
        _b.copy(cap.center).addScaledVector(cap.axis, half).applyMatrix4(mw);
        cap.worldStart.copy(_a);
        cap.worldEnd.copy(_b);
      }

      let motion = 0;
      if (cap.primed) {
        motion = Math.max(
          cap.worldStart.distanceToSquared(cap.prevStart),
          cap.worldEnd.distanceToSquared(cap.prevEnd),
        );
        motion = Math.sqrt(motion);
      }
      cap.worldRadius = cap.radius * scale + skin + Math.min(motion, 0.12) * expand;
    }
  }

  /** Remember this frame's bone poses for next-frame motion inflate. */
  private commitCapsuleMotion(): void {
    for (const cap of this.capsules) {
      cap.prevStart.copy(cap.worldStart);
      cap.prevEnd.copy(cap.worldEnd);
      cap.primed = true;
    }
  }

  disposeAll(): void {
    this.clearDebugHelpers();
    this.clearParticleHelpers();
    for (const family of this.families.values()) disposeFamily(family);
    this.families.clear();
    this.capsules = [];
    this.root = null;
  }

  get activeCount(): number {
    let n = 0;
    for (const f of this.families.values()) n += 1 + f.trims.length;
    return n;
  }
}

function disposeFamily(family: CloakFamily): void {
  // Restore trims first (they reference primary attrs).
  for (const trim of family.trims) trim.dispose();
  family.primary.dispose();
}
