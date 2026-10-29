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
  // "Magica Cloth" plus a Blender/Unity duplicate suffix. GLTFLoader strips
  // the dot, so "Magica Cloth.001" arrives as "Magica_Cloth001".
  return n === 'magica_cloth' || /^magica_cloth(?:_|\d)/.test(n);
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
    const parent: THREE.Object3D | null = node.parent;
    const pool = parent ? parent.children : [node];
    for (const sib of pool) {
      const n = normalizeName(sib.name);
      if (n.includes('webgl')) continue;
      if (n !== source && !n.startsWith(`${source}_`)) continue;
      let found: THREE.Object3D | null = null;
      sib.traverse((o: THREE.Object3D) => {
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
  /** Cloak points hitched to each hand (keeps rest offset). */
  boneBindPerArm: number;
  /** Max world distance from bone to hitch a vert. */
  boneBindMaxDist: number;
};

/**
 * Hold weight painted on each particle.
 * 0 = red, pinned to the mesh, no collider push.
 * 0.5 = yellow, stiff, full collision.
 * 1 = blue-green, loose hem, full collision.
 * Between red and yellow the collider push fades in.
 */
const HOLD_PIN_MAX = 0.02;

/** Debug-dot color for a hold weight. `lift` brightens a picked particle. */
export function holdWeightRgb(weight: number, lift = 0): [number, number, number] {
  const t = Math.min(1, Math.max(0, weight));
  let r: number;
  let g: number;
  let b: number;
  if (t <= 0.5) {
    const u = t / 0.5;
    r = 1;
    g = 0.156863 + u * (0.839216 - 0.156863);
    b = 0.141176 + u * (0.078431 - 0.141176);
  } else {
    const u = (t - 0.5) / 0.5;
    r = 1 + u * (0.180392 - 1);
    g = 0.839216 + u * (0.721569 - 0.839216);
    b = 0.078431 + u * (0.580392 - 0.078431);
  }
  if (lift > 0) {
    r += (1 - r) * lift;
    g += (1 - g) * lift;
    b += (1 - b) * lift;
  }
  return [r, g, b];
}

/** Collider push. Full from yellow up; fades to nothing at red. */
function holdCollisionScale(weight: number): number {
  if (weight >= 0.5) return 1;
  if (weight <= HOLD_PIN_MAX) return 0;
  return (weight - HOLD_PIN_MAX) / (0.5 - HOLD_PIN_MAX);
}

function holdFromWeight(weight: number): { pinned: number; soft: number } {
  if (weight <= HOLD_PIN_MAX) return { pinned: 1, soft: 0 };
  const soft = (weight - 0.5) / 0.5;
  return { pinned: 0, soft: Math.min(1, Math.max(0, soft)) };
}

export type ClothParticleWeights = Record<string, Record<string, number>>;

/** Manual arm hitches. `null` means this point stays off the arm even if the automatic hitch would grab it. */
export type ClothHitchOverrides = Record<string, Record<string, string | null>>;

/** Metres from the arm joint along the hitch, when it differs from the rest offset. */
export type ClothHitchDistances = Record<string, Record<string, number>>;

/** 0–1 blend from the simulated position to the hitch pose. Omitted means fully hitched. */
export type ClothHitchFollow = Record<string, Record<string, number>>;

export type ClothLibrary = ClothParticleWeights & {
  hitches?: ClothHitchOverrides;
  hitchDist?: ClothHitchDistances;
  hitchFollow?: ClothHitchFollow;
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
  /** 0 turns the arm hitch off. Any other value pins the strip; it is not a point count. */
  boneBindPerArm: 1,
  /** Cloak farther than this from every arm bone stays free. */
  boneBindMaxDist: 0.22,
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
  /** 0 = red/held, 0.5 = yellow/stiff, 1 = blue-green/free. */
  private readonly weight: Float32Array;
  /** Weight from paint, before a panel edit or a hand hitch. */
  private readonly authoredWeight: Float32Array;
  private readonly springs: Int32Array;
  private readonly restLengths: Float32Array;
  private readonly springCount: number;
  private readonly count: number;
  /** Primary mesh vertex count. Extra particles are rim-only and drawn by the trim. */
  private readonly drawCount: number;
  /** Trim vertex → particle index. One map per trim submesh, in constructor order. */
  private readonly trimMaps: Int32Array[];
  private params: ClothParams;
  private normTick = 0;
  /** -1 = follow cloak mesh; else index into followBones. */
  private readonly boneBind: Int16Array;
  /** boneBind as the hitch left it, so Reset can put a sleeve particle back. */
  private readonly boneBindSaved: Int16Array;
  private readonly boneLocal: Float32Array;
  /** Metres from the joint along boneLocal. Negative means the rest offset. */
  private readonly hitchDist: Float32Array;
  /** 0 = ordinary cloth, same as no hitch. 1 = locked to the hitch pose. */
  private readonly hitchFollow: Float32Array;
  /** Unhitched pose of a fully locked point. Distance never moves this. */
  private readonly free: Float32Array;
  private readonly freePrev: Float32Array;
  /** 1 when this particle is in the screen-space highlight. */
  private readonly debugSelected: Uint8Array;
  private followBones: THREE.Object3D[] = [];
  private followBoneNames: string[] = [];

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
    this.drawCount = posAttr.count;
    // Newer glb exports give the rim its own vertex buffer. The August file
    // kept those verts on the end of the cloak buffer, which is what the
    // springs were indexed with. Fold the rim back into that same particle list.
    const absorbed = absorbTrimVertices(new Float32Array(posAttr.array as Float32Array), extraSpringGeoms);
    this.trimMaps = absorbed.maps;
    this.count = absorbed.rest.length / 3;
    this.restLocal = absorbed.rest;
    this.pos = new Float32Array(this.count * 3);
    this.prev = new Float32Array(this.count * 3);
    this.pinned = new Uint8Array(this.count);
    this.soft = new Float32Array(this.count);
    this.weight = new Float32Array(this.count);
    this.authoredWeight = new Float32Array(this.count);
    this.boneBind = new Int16Array(this.count);
    this.boneBind.fill(-1);
    this.boneBindSaved = new Int16Array(this.count);
    this.boneBindSaved.fill(-1);
    this.boneLocal = new Float32Array(this.count * 3);
    this.hitchDist = new Float32Array(this.count);
    this.hitchDist.fill(-1);
    this.hitchFollow = new Float32Array(this.count);
    this.hitchFollow.fill(1);
    this.free = new Float32Array(this.count * 3);
    this.freePrev = new Float32Array(this.count * 3);
    this.debugSelected = new Uint8Array(this.count);

    const { springs, restLengths } = buildSprings(geom, this.restLocal, extraSpringGeoms, this.trimMaps);
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
    this.captureAuthoredHold();

    mesh.updateWorldMatrix(true, false);
    for (let i = 0; i < this.count; i++) {
      _local.set(this.restLocal[i * 3]!, this.restLocal[i * 3 + 1]!, this.restLocal[i * 3 + 2]!);
      _v.copy(_local).applyMatrix4(mesh.matrixWorld);
      const o = i * 3;
      this.pos[o] = this.prev[o] = _v.x;
      this.pos[o + 1] = this.prev[o + 1] = _v.y;
      this.pos[o + 2] = this.prev[o + 2] = _v.z;
      this.free[o] = this.freePrev[o] = _v.x;
      this.free[o + 1] = this.freePrev[o + 1] = _v.y;
      this.free[o + 2] = this.freePrev[o + 2] = _v.z;
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

  /** Paint + fallback pinning, stored so a panel edit can be reset. */
  private captureAuthoredHold(): void {
    for (let i = 0; i < this.count; i++) {
      const w = this.pinned[i] ? 0 : 0.5 + this.soft[i]! * 0.5;
      this.weight[i] = w;
      this.authoredWeight[i] = w;
    }
  }

  private applyHold(i: number): void {
    const next = holdFromWeight(this.weight[i]!);
    this.pinned[i] = next.pinned;
    this.soft[i] = next.soft;
  }

  /** Panel edit. Clears a hand hitch so the weight is what the sim uses. */
  setHoldWeight(i: number, weight: number): void {
    if (i < 0 || i >= this.count) return;
    this.weight[i] = Math.min(1, Math.max(0, weight));
    this.boneBind[i] = -1;
    this.hitchDist[i] = -1;
    this.hitchFollow[i] = 1;
    this.applyHold(i);
  }

  resetHoldWeight(i: number): void {
    if (i < 0 || i >= this.count) return;
    this.weight[i] = this.authoredWeight[i]!;
    this.hitchDist[i] = -1;
    this.hitchFollow[i] = 1;
    const saved = this.boneBindSaved[i]!;
    this.boneBind[i] = saved;
    if (saved >= 0) {
      this.pinned[i] = 1;
      this.soft[i] = 0;
    } else {
      this.applyHold(i);
    }
  }

  applyHoldOverrides(weights: ReadonlyMap<number, number>): void {
    for (const [id, w] of weights) this.setHoldWeight(id, w);
  }

  authoredHoldWeight(i: number): number {
    return this.authoredWeight[i] ?? 0;
  }

  /** 0 when an arm hitch is holding the particle. */
  holdWeight(i: number): number {
    if (i < 0 || i >= this.count) return 0;
    if (this.boneBind[i]! >= 0) return 0;
    return this.weight[i]!;
  }

  /** Arm bone this point rides, or null when the sim is free to move it. */
  hitchBoneName(i: number): string | null {
    if (i < 0 || i >= this.count) return null;
    const bi = this.boneBind[i]!;
    if (bi < 0) return null;
    return this.followBoneNames[bi] ?? null;
  }

  clearDebugSelected(): void {
    this.debugSelected.fill(0);
  }

  markDebugSelected(i: number): void {
    if (i >= 0 && i < this.count) this.debugSelected[i] = 1;
  }

  copyParticleWorld(i: number, target: THREE.Vector3): boolean {
    if (i < 0 || i >= this.count) return false;
    this.readDisplayed(i, target);
    return true;
  }

  /** World position of the joint this point is hitched to. */
  hitchBoneWorld(i: number, target: THREE.Vector3): boolean {
    if (i < 0 || i >= this.count) return false;
    const bi = this.boneBind[i]!;
    if (bi < 0) return false;
    const bone = this.followBones[bi];
    if (!bone) return false;
    bone.updateWorldMatrix(true, false);
    bone.getWorldPosition(target);
    return true;
  }

  savedHitchBoneName(i: number): string | null {
    if (i < 0 || i >= this.count) return null;
    const bi = this.boneBindSaved[i]!;
    if (bi < 0) return null;
    return this.followBoneNames[bi] ?? null;
  }

  /** Ride this arm bone, keeping the cloak's rest offset. Does not change the authored hitch. */
  hitchToBoneIndex(i: number, boneIndex: number): void {
    if (i < 0 || i >= this.count) return;
    const bone = this.followBones[boneIndex];
    if (!bone) return;
    this.mesh.updateWorldMatrix(true, false);
    bone.updateWorldMatrix(true, false);
    _inv.copy(bone.matrixWorld).invert();
    const o = i * 3;
    _local.set(this.restLocal[o]!, this.restLocal[o + 1]!, this.restLocal[o + 2]!);
    _v.copy(_local).applyMatrix4(this.mesh.matrixWorld).applyMatrix4(_inv);
    this.boneLocal[o] = _v.x;
    this.boneLocal[o + 1] = _v.y;
    this.boneLocal[o + 2] = _v.z;
    this.boneBind[i] = boneIndex;
    this.hitchDist[i] = -1;
    if (this.hitchFollow[i]! >= 0.999) {
      this.pinned[i] = 1;
      this.soft[i] = 0;
    } else {
      this.applyHold(i);
    }
  }

  /** Length of the rest offset, in metres. 0 when this point is not hitched. */
  restHitchDistance(i: number): number {
    if (i < 0 || i >= this.count || this.boneBind[i]! < 0) return 0;
    const o = i * 3;
    return Math.hypot(this.boneLocal[o]!, this.boneLocal[o + 1]!, this.boneLocal[o + 2]!);
  }

  /** Metres from the joint along the green line, or null when this point is not hitched. */
  hitchDistance(i: number): number | null {
    if (i < 0 || i >= this.count || this.boneBind[i]! < 0) return null;
    const custom = this.hitchDist[i]!;
    return custom >= 0 ? custom : this.restHitchDistance(i);
  }

  /** How strongly the hitch pose replaces the simulated position. Null when not hitched. */
  hitchFollowAmount(i: number): number | null {
    if (i < 0 || i >= this.count || this.boneBind[i]! < 0) return null;
    return this.hitchFollow[i]!;
  }

  /**
   * 1 locks this point to the hitch pose, including distance.
   * 0 is the ordinary cloth pose. Distance is not part of it.
   */
  setHitchFollow(i: number, amount: number): void {
    if (i < 0 || i >= this.count || this.boneBind[i]! < 0) return;
    const follow = Math.min(1, Math.max(0, amount));
    const wasLocked = this.hitchFollow[i]! >= 0.999;
    const nowLocked = follow >= 0.999;
    this.hitchFollow[i] = follow;
    if (nowLocked) {
      if (!wasLocked) this.copyPoseToFree(i);
      this.pinned[i] = 1;
      this.soft[i] = 0;
      this.mesh.updateWorldMatrix(true, false);
      this.followBones[this.boneBind[i]!]?.updateWorldMatrix(true, false);
      this.snapKinematic(i, this.mesh.matrixWorld, true);
      return;
    }
    if (wasLocked) this.copyFreeToPose(i);
    this.applyHold(i);
  }

  private fullyHitched(i: number): boolean {
    return this.boneBind[i]! >= 0 && this.hitchFollow[i]! >= 0.999;
  }

  /** Full hitch, or a weight pin. A follow below the lock does not count as a hitch. */
  private clothLocked(i: number): boolean {
    if (this.boneBind[i]! >= 0 && this.hitchFollow[i]! >= 0.999) return true;
    return this.pinned[i] !== 0;
  }

  /** Bone pose of a hitch, including the distance slider. */
  private hitchWorld(i: number, target: THREE.Vector3): boolean {
    const bi = this.boneBind[i]!;
    if (bi < 0) return false;
    const bone = this.followBones[bi];
    if (!bone) return false;
    const o = i * 3;
    _local.set(this.boneLocal[o]!, this.boneLocal[o + 1]!, this.boneLocal[o + 2]!);
    const dist = this.hitchDist[i]!;
    if (dist >= 0) {
      const rest = _local.length();
      if (rest > 1e-6) _local.multiplyScalar(dist / rest);
    }
    target.copy(_local).applyMatrix4(bone.matrixWorld);
    return true;
  }

  /**
   * Position written to the mesh. 0 is the cloth sim. 1 is the hitch pose.
   * Values in between sit on the line between those two.
   */
  private readDisplayed(i: number, target: THREE.Vector3): void {
    const o = i * 3;
    const x = this.pos[o]!;
    const y = this.pos[o + 1]!;
    const z = this.pos[o + 2]!;
    const follow = this.hitchFollow[i]!;
    if (this.boneBind[i]! < 0 || follow >= 0.999 || follow <= 0 || !this.hitchWorld(i, _b)) {
      target.set(x, y, z);
      return;
    }
    target.set(x + (_b.x - x) * follow, y + (_b.y - y) * follow, z + (_b.z - z) * follow);
  }

  private copyPoseToFree(i: number): void {
    const o = i * 3;
    this.free[o] = this.pos[o]!;
    this.free[o + 1] = this.pos[o + 1]!;
    this.free[o + 2] = this.pos[o + 2]!;
    this.freePrev[o] = this.prev[o]!;
    this.freePrev[o + 1] = this.prev[o + 1]!;
    this.freePrev[o + 2] = this.prev[o + 2]!;
  }

  private copyFreeToPose(i: number): void {
    const o = i * 3;
    this.pos[o] = this.free[o]!;
    this.pos[o + 1] = this.free[o + 1]!;
    this.pos[o + 2] = this.free[o + 2]!;
    this.prev[o] = this.freePrev[o]!;
    this.prev[o + 1] = this.freePrev[o + 1]!;
    this.prev[o + 2] = this.freePrev[o + 2]!;
  }

  /** Slide this point along its hitch. `meters` is the distance from the joint. */
  setHitchDistance(i: number, meters: number): void {
    if (i < 0 || i >= this.count || this.boneBind[i]! < 0) return;
    this.hitchDist[i] = Math.max(0, meters);
    if (this.hitchFollow[i]! < 0.999) return;
    this.mesh.updateWorldMatrix(true, false);
    const bi = this.boneBind[i]!;
    this.followBones[bi]?.updateWorldMatrix(true, false);
    this.snapKinematic(i, this.mesh.matrixWorld, true);
  }

  /** Drop the arm hitch and go back to this point's weight. */
  clearArmHitch(i: number): void {
    if (i < 0 || i >= this.count) return;
    this.boneBind[i] = -1;
    this.hitchDist[i] = -1;
    this.hitchFollow[i] = 1;
    this.applyHold(i);
  }

  wasHitched(i: number): boolean {
    return i >= 0 && i < this.count && this.boneBindSaved[i]! >= 0;
  }

  /** Particles currently riding an arm bone. */
  armPinnedCount(): number {
    let n = 0;
    for (let i = 0; i < this.drawCount; i++) if (this.boneBind[i]! >= 0) n++;
    return n;
  }

  private faceRidesArm(a: number, b: number, c: number): boolean {
    if (a >= this.drawCount || b >= this.drawCount || c >= this.drawCount) return false;
    return this.boneBind[a]! >= 0 || this.boneBind[b]! >= 0 || this.boneBind[c]! >= 0;
  }

  /** Triangles that include a point pinned to an arm. */
  countPinnedFaces(): number {
    const index = this.mesh.geometry.getIndex();
    if (!index) return 0;
    let n = 0;
    for (let t = 0; t < index.count; t += 3) {
      if (this.faceRidesArm(index.getX(t), index.getX(t + 1), index.getX(t + 2))) n++;
    }
    return n;
  }

  /** Append world-space triangles for cloth pinned to an arm. Returns the new float offset. */
  writePinnedFaces(out: Float32Array, offset: number): number {
    const index = this.mesh.geometry.getIndex();
    if (!index) return offset;
    for (let t = 0; t < index.count; t += 3) {
      const a = index.getX(t);
      const b = index.getX(t + 1);
      const c = index.getX(t + 2);
      if (!this.faceRidesArm(a, b, c)) continue;
      for (const i of [a, b, c]) {
        this.readDisplayed(i, _a);
        out[offset] = _a.x;
        out[offset + 1] = _a.y;
        out[offset + 2] = _a.z;
        offset += 3;
      }
    }
    return offset;
  }

  get vertexCount(): number {
    return this.count;
  }

  setParams(partial: Partial<ClothParams>): void {
    Object.assign(this.params, partial);
  }

  /**
   * Hitch the cloak points that sit against each arm bone, from shoulder
   * to hand. Each point keeps its authored offset in that bone's space,
   * so the strip rides with the arm instead of collapsing onto it.
   * The band is a few centimeters past the closest cloth, so a bone that
   * only brushes the cloak still gets a strip and one that sits in the
   * cloth does not grab the whole sheet.
   */
  bindFollowBones(segments: { bone: THREE.Object3D; end: THREE.Object3D; name: string }[]): void {
    this.followBones = segments.map((s) => s.bone);
    this.followBoneNames = segments.map((s) => s.name);
    this.boneBind.fill(-1);
    this.hitchDist.fill(-1);
    this.hitchFollow.fill(1);
    if (segments.length === 0 || this.params.boneBindPerArm <= 0) {
      this.finishBind();
      return;
    }

    this.mesh.updateWorldMatrix(true, false);
    const mw = this.mesh.matrixWorld;
    const ceiling = this.params.boneBindMaxDist;
    /** Extra reach past the closest cloak on that bone. */
    const band = 0.05;

    const bestBi = new Int16Array(this.count);
    const bestD2 = new Float32Array(this.count);
    const bestT = new Float32Array(this.count);
    bestBi.fill(-1);
    bestD2.fill(Infinity);
    const minD = new Float32Array(segments.length);
    minD.fill(Infinity);
    // Inner Circle is a round cape. A single closest vertex sits on the
    // shoulder, and a wide band around it paints the chest. Walk each arm
    // and keep only the cloth nearest that step, same on both sides.
    const innerCape = normalizeName(this.mesh.name).includes('innercloak');

    for (let s = 0; s < segments.length; s++) {
      const seg = segments[s]!;
      seg.bone.updateWorldMatrix(true, false);
      seg.end.updateWorldMatrix(true, false);
      seg.bone.getWorldPosition(_a);
      seg.end.getWorldPosition(_b);
      _b.sub(_a);
      const len2 = _b.lengthSq();
      for (let i = 0; i < this.count; i++) {
        if (this.pinned[i]) continue;
        const o = i * 3;
        _local.set(this.restLocal[o]!, this.restLocal[o + 1]!, this.restLocal[o + 2]!).applyMatrix4(mw);
        let t = 0;
        if (len2 >= 1e-10) {
          t =
            ((_local.x - _a.x) * _b.x +
              (_local.y - _a.y) * _b.y +
              (_local.z - _a.z) * _b.z) /
            len2;
          t = Math.min(1, Math.max(0, t));
        }
        _v.set(_a.x + _b.x * t, _a.y + _b.y * t, _a.z + _b.z * t);
        const d2 = _local.distanceToSquared(_v);
        if (d2 < minD[s]!) minD[s] = d2;
        if (d2 < bestD2[i]!) {
          bestD2[i] = d2;
          bestBi[i] = s;
          bestT[i] = t;
        }
      }
    }

    const hitch = (s: number, i: number) => {
      const bone = segments[s]!.bone;
      _inv.copy(bone.matrixWorld).invert();
      const o = i * 3;
      _local.set(this.restLocal[o]!, this.restLocal[o + 1]!, this.restLocal[o + 2]!);
      _v.copy(_local).applyMatrix4(mw).applyMatrix4(_inv);
      this.boneLocal[o] = _v.x;
      this.boneLocal[o + 1] = _v.y;
      this.boneLocal[o + 2] = _v.z;
      this.boneBind[i] = s;
      this.pinned[i] = 1;
    };

    if (!innerCape) {
      for (let s = 0; s < segments.length; s++) {
        const nearest = Math.sqrt(minD[s]!);
        if (nearest > ceiling) continue;
        const limit2 = Math.min(ceiling, nearest + band) ** 2;
        for (let i = 0; i < this.count; i++) {
          if (bestBi[i] !== s || bestD2[i]! > limit2) continue;
          hitch(s, i);
        }
      }
      this.finishBind();
      return;
    }

    const slices = 6;
    const perSlice = 14;
    const maxD2 = 0.3 ** 2;
    const groups: { i: number; d2: number }[][][] = segments.map(() =>
      Array.from({ length: slices }, () => []),
    );
    for (let i = 0; i < this.count; i++) {
      const bi = bestBi[i]!;
      if (bi < 0 || this.pinned[i] || bestD2[i]! > maxD2) continue;
      const slice = Math.min(slices - 1, Math.floor(bestT[i]! * slices));
      groups[bi]![slice]!.push({ i, d2: bestD2[i]! });
    }
    for (let s = 0; s < segments.length; s++) {
      for (const group of groups[s]!) {
        group.sort((a, b) => a.d2 - b.d2);
        const take = Math.min(perSlice, group.length);
        for (let k = 0; k < take; k++) hitch(s, group[k]!.i);
      }
    }
    this.finishBind();
  }

  private snapKinematic(i: number, mw: THREE.Matrix4, zeroVel: boolean): void {
    const o = i * 3;
    const bi = this.boneBind[i]!;
    if (bi >= 0 && this.hitchFollow[i]! >= 0.999) {
      const bone = this.followBones[bi];
      if (bone) {
        _local.set(this.boneLocal[o]!, this.boneLocal[o + 1]!, this.boneLocal[o + 2]!);
        const dist = this.hitchDist[i]!;
        if (dist >= 0) {
          const rest = _local.length();
          if (rest > 1e-6) _local.multiplyScalar(dist / rest);
        }
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

  particleInfo(i: number): { pinned: boolean; soft: number; weight: number } {
    return { pinned: !!this.pinned[i], soft: this.soft[i]!, weight: this.holdWeight(i) };
  }

  /**
   * Nearest particle to this one mirrored across local X.
   * Rest positions are the authored mesh, so the match stays put while the sim moves.
   */
  mirrorOf(i: number): number {
    const o = i * 3;
    const x = this.restLocal[o]!;
    const y = this.restLocal[o + 1]!;
    const z = this.restLocal[o + 2]!;
    const sign = Math.sign(x);
    const tx = -x;
    let best = -1;
    let bestD = Infinity;
    for (let j = 0; j < this.count; j++) {
      if (j === i) continue;
      const jo = j * 3;
      const jx = this.restLocal[jo]!;
      if (sign !== 0 && Math.abs(jx) > 1e-4 && Math.sign(jx) === sign) continue;
      const dx = jx - tx;
      const dy = this.restLocal[jo + 1]! - y;
      const dz = this.restLocal[jo + 2]! - z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    }
    return best;
  }

  trimMap(index: number): Int32Array {
    return this.trimMaps[index] ?? new Int32Array();
  }

  /** Write simulated rim particles back into that submesh's own vertex buffer. */
  writeTrimPositions(geom: THREE.BufferGeometry, map: Int32Array, target: THREE.Object3D): void {
    const attr = geom.getAttribute('position') as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    target.updateWorldMatrix(true, false);
    _inv.copy(target.matrixWorld).invert();
    for (let i = 0; i < map.length; i++) {
      const o = i * 3;
      this.readDisplayed(map[i]!, _v);
      _v.applyMatrix4(_inv);
      arr[o] = _v.x;
      arr[o + 1] = _v.y;
      arr[o + 2] = _v.z;
    }
    attr.needsUpdate = true;
  }

  /**
   * Write world-space particle positions + RGB colors into flat buffers.
   * Hold weight: red (held) → yellow (stiff) → blue-green (free).
   * Mirror stays purple. A hand hitch stays green until its weight is edited.
   */
  writeParticleDebug(
    outPos: Float32Array,
    outColor: Float32Array,
    offset = 0,
    highlightId = -1,
    mirrorId = -1,
  ): number {
    for (let i = 0; i < this.count; i++) {
      const d = (offset + i) * 3;
      this.readDisplayed(i, _a);
      outPos[d] = _a.x;
      outPos[d + 1] = _a.y;
      outPos[d + 2] = _a.z;
      if (this.debugSelected[i]) {
        outColor[d] = 125 / 255;
        outColor[d + 1] = 1;
        outColor[d + 2] = 74 / 255;
      } else if (i === mirrorId && i !== highlightId) {
        outColor[d] = 0.72;
        outColor[d + 1] = 0.18;
        outColor[d + 2] = 1;
      } else if (this.boneBind[i]! >= 0) {
        outColor[d] = 0.25;
        outColor[d + 1] = 0.85;
        outColor[d + 2] = 0.3;
      } else {
        const [r, g, b] = holdWeightRgb(this.weight[i]!, i === highlightId ? 0.28 : 0);
        outColor[d] = r;
        outColor[d + 1] = g;
        outColor[d + 2] = b;
      }
    }
    return this.count;
  }

  reset(): void {
    this.mesh.updateWorldMatrix(true, false);
    for (const bone of this.followBones) bone.updateWorldMatrix(true, false);
    const mw = this.mesh.matrixWorld;
    for (let i = 0; i < this.count; i++) this.snapKinematic(i, mw, true);
    this.seedFreeFromRest(mw);
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
      if (this.clothLocked(i)) {
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
        if (!this.clothLocked(i)) continue;
        this.snapKinematic(i, mw, false);
      }
    }
    // Final passes: project out, then zero contact velocity once (not every iter).
    for (let p = 0; p < this.params.collisionPasses; p++) {
      const last = p === this.params.collisionPasses - 1;
      this.collideCapsules(capsules, last);
      this.collideGround();
    }

    this.stepFreeHitched(clamped, capsules);
    this.writeToGeometry();
  }

  private finishBind(): void {
    this.boneBindSaved.set(this.boneBind);
  }

  /** Cloth pose with the hitch and its distance removed. */
  private seedFreeFromRest(mw: THREE.Matrix4): void {
    for (let i = 0; i < this.count; i++) {
      const o = i * 3;
      _local.set(this.restLocal[o]!, this.restLocal[o + 1]!, this.restLocal[o + 2]!);
      _v.copy(_local).applyMatrix4(mw);
      this.free[o] = this.freePrev[o] = _v.x;
      this.free[o + 1] = this.freePrev[o + 1] = _v.y;
      this.free[o + 2] = this.freePrev[o + 2] = _v.z;
    }
  }

  /**
   * Keep a real cloth pose for fully locked points. Follow 0 copies it,
   * so the distance the hitch is using never becomes the cloth position.
   */
  private stepFreeHitched(dt: number, capsules: ResolvedCapsule[]): void {
    let any = false;
    for (let i = 0; i < this.count; i++) {
      if (this.fullyHitched(i)) {
        any = true;
        break;
      }
    }
    if (!any) return;
    const g = this.params.gravity * dt * dt;
    const damp = Math.max(0, 1 - this.params.damping);
    const mw = this.mesh.matrixWorld;
    for (let i = 0; i < this.count; i++) {
      if (!this.fullyHitched(i)) continue;
      const hold = holdFromWeight(this.weight[i]!);
      const o = i * 3;
      if (hold.pinned) {
        _local.set(this.restLocal[o]!, this.restLocal[o + 1]!, this.restLocal[o + 2]!);
        _v.copy(_local).applyMatrix4(mw);
        this.free[o] = this.freePrev[o] = _v.x;
        this.free[o + 1] = this.freePrev[o + 1] = _v.y;
        this.free[o + 2] = this.freePrev[o + 2] = _v.z;
        continue;
      }
      const x = this.free[o]!;
      const y = this.free[o + 1]!;
      const z = this.free[o + 2]!;
      const vx = (x - this.freePrev[o]!) * damp;
      const vy = (y - this.freePrev[o + 1]!) * damp;
      const vz = (z - this.freePrev[o + 2]!) * damp;
      this.freePrev[o] = x;
      this.freePrev[o + 1] = y;
      this.freePrev[o + 2] = z;
      this.free[o] = x + vx;
      this.free[o + 1] = y + vy - g;
      this.free[o + 2] = z + vz;
      const blend = this.params.restBlendRoot * (1 - hold.soft) + this.params.restBlendTip * hold.soft;
      if (blend > 1e-4) {
        _local.set(this.restLocal[o]!, this.restLocal[o + 1]!, this.restLocal[o + 2]!);
        _a.copy(_local).applyMatrix4(mw);
        this.free[o] = this.free[o]! + (_a.x - this.free[o]!) * blend;
        this.free[o + 1] = this.free[o + 1]! + (_a.y - this.free[o + 1]!) * blend;
        this.free[o + 2] = this.free[o + 2]! + (_a.z - this.free[o + 2]!) * blend;
      }
    }
    const iters = Math.min(4, this.params.iterations);
    for (let it = 0; it < iters; it++) {
      this.satisfyFreeSprings();
      this.limitFreeFromRest();
      this.collideFreeGround();
      if ((it & 1) === 1) this.collideCapsules(capsules, false, true);
    }
  }

  private satisfyFreeSprings(): void {
    const s = this.springs;
    const rest = this.restLengths;
    const kRoot = this.params.stiffnessRoot;
    const kTip = this.params.stiffnessTip;
    for (let i = 0; i < this.springCount; i++) {
      const ia = s[i * 2]!;
      const ib = s[i * 2 + 1]!;
      const la = this.fullyHitched(ia);
      const lb = this.fullyHitched(ib);
      if (!la && !lb) continue;
      const oa = ia * 3;
      const ob = ib * 3;
      const ax = la ? this.free[oa]! : this.pos[oa]!;
      const ay = la ? this.free[oa + 1]! : this.pos[oa + 1]!;
      const az = la ? this.free[oa + 2]! : this.pos[oa + 2]!;
      const bx = lb ? this.free[ob]! : this.pos[ob]!;
      const by = lb ? this.free[ob + 1]! : this.pos[ob + 1]!;
      const bz = lb ? this.free[ob + 2]! : this.pos[ob + 2]!;
      let dx = bx - ax;
      let dy = by - ay;
      let dz = bz - az;
      const dist = Math.hypot(dx, dy, dz) || 1e-6;
      const target = rest[i]!;
      const softA = holdFromWeight(this.weight[ia]!).soft;
      const softB = holdFromWeight(this.weight[ib]!).soft;
      const k = target <= 1e-8 ? 1 : kRoot * (1 - (softA + softB) * 0.5) + kTip * (softA + softB) * 0.5;
      const corr = ((dist - target) / dist) * k * 0.5;
      dx *= corr;
      dy *= corr;
      dz *= corr;
      const moveA = la && holdFromWeight(this.weight[ia]!).pinned === 0;
      const moveB = lb && holdFromWeight(this.weight[ib]!).pinned === 0;
      if (moveA && moveB) {
        this.free[oa]! += dx;
        this.free[oa + 1]! += dy;
        this.free[oa + 2]! += dz;
        this.free[ob]! -= dx;
        this.free[ob + 1]! -= dy;
        this.free[ob + 2]! -= dz;
      } else if (moveA) {
        this.free[oa]! += dx * 2;
        this.free[oa + 1]! += dy * 2;
        this.free[oa + 2]! += dz * 2;
      } else if (moveB) {
        this.free[ob]! -= dx * 2;
        this.free[ob + 1]! -= dy * 2;
        this.free[ob + 2]! -= dz * 2;
      }
    }
  }

  private limitFreeFromRest(): void {
    const dRoot = this.params.maxDriftRoot;
    const dTip = this.params.maxDriftTip;
    const mw = this.mesh.matrixWorld;
    for (let i = 0; i < this.count; i++) {
      if (!this.fullyHitched(i) || holdFromWeight(this.weight[i]!).pinned) continue;
      const o = i * 3;
      const soft = holdFromWeight(this.weight[i]!).soft;
      const maxDist = dRoot * (1 - soft) + dTip * soft;
      _local.set(this.restLocal[o]!, this.restLocal[o + 1]!, this.restLocal[o + 2]!);
      _a.copy(_local).applyMatrix4(mw);
      _v.set(this.free[o]!, this.free[o + 1]!, this.free[o + 2]!);
      _b.subVectors(_v, _a);
      const d = _b.length();
      if (d <= maxDist || d < 1e-8) continue;
      _b.multiplyScalar(maxDist / d);
      this.free[o] = _a.x + _b.x;
      this.free[o + 1] = _a.y + _b.y;
      this.free[o + 2] = _a.z + _b.z;
    }
  }

  private collideFreeGround(): void {
    const y0 = this.params.groundY;
    for (let i = 0; i < this.count; i++) {
      if (!this.fullyHitched(i) || holdFromWeight(this.weight[i]!).pinned) continue;
      const o = i * 3;
      if (this.free[o + 1]! < y0) {
        this.free[o + 1] = y0;
        if (this.freePrev[o + 1]! < y0) this.freePrev[o + 1] = y0;
      }
    }
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
      const pa = this.clothLocked(ia);
      const pb = this.clothLocked(ib);
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
      if (this.clothLocked(i)) continue;
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
      if (this.clothLocked(i)) continue;
      const o = i * 3;
      if (this.pos[o + 1]! < y0) {
        this.pos[o + 1] = y0;
        // Kill downward velocity so it doesn't keep tunneling.
        if (this.prev[o + 1]! < y0) this.prev[o + 1] = y0;
      }
    }
  }

  private collideCapsules(capsules: ResolvedCapsule[], killVelocity: boolean, intoFree = false): void {
    // Soft positional projection. Never add the push into prev mid-frame —
    // that preserved inward speed and blew up when capsules overlapped.
    const pos = intoFree ? this.free : this.pos;
    const prev = intoFree ? this.freePrev : this.prev;
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
        if (intoFree) {
          if (!this.fullyHitched(i) || holdFromWeight(this.weight[i]!).pinned) continue;
        } else if (this.clothLocked(i)) continue;
        const o = i * 3;
        let px = pos[o]!;
        let py = pos[o + 1]!;
        let pz = pos[o + 2]!;

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
        // Yellow and above push fully. Toward red the body collision fades out.
        push *= holdCollisionScale(this.weight[i]!);
        px += nx * push;
        py += ny * push;
        pz += nz * push;
        pos[o] = px;
        pos[o + 1] = py;
        pos[o + 2] = pz;

        if (killVelocity) {
          // Zero contact velocity (stick) — only on the last resolve pass.
          prev[o] = px;
          prev[o + 1] = py;
          prev[o + 2] = pz;
        }
      }
    }
  }

  private writeToGeometry(): void {
    const geom = this.mesh.geometry;
    const attr = geom.getAttribute('position') as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    _inv.copy(this.mesh.matrixWorld).invert();

    for (let i = 0; i < this.drawCount; i++) {
      const o = i * 3;
      this.readDisplayed(i, _a);
      _v.copy(_a).applyMatrix4(_inv);
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
 * Hood rim. Keeps its own vertices and UVs from the glb.
 * Each vert follows the cloak particle it was matched to, so a split
 * export still hangs off the same sim as the August shared buffer.
 */
class WeldedTrimMesh {
  readonly mesh: THREE.Mesh;
  private readonly originalGeometry: THREE.BufferGeometry;
  private readonly weldedGeometry: THREE.BufferGeometry;
  private readonly touchedMaterials: THREE.Material[] = [];
  private readonly primary: MeshClothSim;
  private readonly map: Int32Array;

  constructor(mesh: THREE.Mesh, primary: MeshClothSim, trimIndex: number) {
    this.mesh = mesh;
    this.primary = primary;
    this.map = primary.trimMap(trimIndex);
    this.originalGeometry = mesh.geometry;

    const welded = mesh.geometry.clone();
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

    this.sync();
  }

  sync(): void {
    this.primary.writeTrimPositions(this.weldedGeometry, this.map, this.mesh);
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
    this.weldedGeometry.dispose();
  }
}

const TRIM_MATCH_CELL = 1e-4;

/**
 * Rim submeshes used to live in the cloak's vertex buffer (August export).
 * Later exports split them into their own buffer, reindexed from 0.
 * Match each rim vert onto a cloak particle, and append the ones that are
 * actually new so their edges still constrain the right points.
 */
function absorbTrimVertices(
  baseRest: Float32Array,
  extraGeoms: THREE.BufferGeometry[],
): { rest: Float32Array; maps: Int32Array[] } {
  const baseCount = baseRest.length / 3;
  const buckets = new Map<string, number[]>();
  const keyOf = (x: number, y: number, z: number) =>
    `${Math.round(x / TRIM_MATCH_CELL)},${Math.round(y / TRIM_MATCH_CELL)},${Math.round(z / TRIM_MATCH_CELL)}`;

  for (let i = 0; i < baseCount; i++) {
    const o = i * 3;
    const key = keyOf(baseRest[o]!, baseRest[o + 1]!, baseRest[o + 2]!);
    let list = buckets.get(key);
    if (!list) {
      list = [];
      buckets.set(key, list);
    }
    list.push(i);
  }

  const extra: number[] = [];
  const maps: Int32Array[] = [];
  for (const geom of extraGeoms) {
    const attr = geom.getAttribute('position') as THREE.BufferAttribute;
    const map = new Int32Array(attr.count);
    for (let i = 0; i < attr.count; i++) {
      const x = attr.getX(i);
      const y = attr.getY(i);
      const z = attr.getZ(i);
      const hits = buckets.get(keyOf(x, y, z));
      if (hits && hits.length > 0) {
        map[i] = hits[0]!;
        continue;
      }
      const ni = baseCount + extra.length / 3;
      map[i] = ni;
      extra.push(x, y, z);
      buckets.set(keyOf(x, y, z), [ni]);
    }
    maps.push(map);
  }

  if (extra.length === 0) return { rest: baseRest, maps };
  const rest = new Float32Array(baseRest.length + extra.length);
  rest.set(baseRest);
  rest.set(extra, baseRest.length);
  return { rest, maps };
}

function buildSprings(
  geom: THREE.BufferGeometry,
  restLocal: Float32Array,
  extraGeoms: THREE.BufferGeometry[] = [],
  trimMaps: Int32Array[] = [],
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

  const addTriangles = (index: THREE.BufferAttribute | null, count: number, map: Int32Array | null) => {
    const at = (i: number) => (map ? map[i]! : i);
    if (index) {
      for (let i = 0; i < index.count; i += 3) {
        const a = at(index.getX(i));
        const b = at(index.getX(i + 1));
        const c = at(index.getX(i + 2));
        addEdge(a, b);
        addEdge(b, c);
        addEdge(c, a);
      }
    } else {
      for (let i = 0; i + 2 < count; i += 3) {
        addEdge(at(i), at(i + 1));
        addEdge(at(i + 1), at(i + 2));
        addEdge(at(i + 2), at(i));
      }
    }
  };

  const pos = geom.getAttribute('position') as THREE.BufferAttribute;
  addTriangles(geom.getIndex(), pos.count, null);
  for (let i = 0; i < extraGeoms.length; i++) {
    const extra = extraGeoms[i]!;
    const extraPos = extra.getAttribute('position') as THREE.BufferAttribute;
    addTriangles(extra.getIndex(), extraPos.count, trimMaps[i] ?? null);
  }

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
  /** 0 red/held, 0.5 yellow/stiff, 1 blue-green/free. */
  weight: number;
  /** Particle across local X, or -1 when this one has no counterpart. */
  mirrorId: number;
};

/** Shoulder to elbow, elbow to wrist, wrist through the palm. Both arms. */
const ARM_PIN_SEGMENTS: readonly (readonly [string, string])[] = [
  ['mixamorigLeftArm', 'mixamorigLeftForeArm'],
  ['mixamorigLeftForeArm', 'mixamorigLeftHand'],
  ['mixamorigLeftHand', 'mixamorigLeftHandMiddle1'],
  ['mixamorigRightArm', 'mixamorigRightForeArm'],
  ['mixamorigRightForeArm', 'mixamorigRightHand'],
  ['mixamorigRightHand', 'mixamorigRightHandMiddle1'],
];

export const ARM_HITCH_BONES: readonly { name: string; label: string }[] = [
  { name: 'mixamorigLeftArm', label: 'Left upper arm' },
  { name: 'mixamorigLeftForeArm', label: 'Left forearm' },
  { name: 'mixamorigLeftHand', label: 'Left hand' },
  { name: 'mixamorigRightArm', label: 'Right upper arm' },
  { name: 'mixamorigRightForeArm', label: 'Right forearm' },
  { name: 'mixamorigRightHand', label: 'Right hand' },
];

function oppositeArmBone(name: string): string {
  if (name.includes('Left')) return name.replace('Left', 'Right');
  if (name.includes('Right')) return name.replace('Right', 'Left');
  return name;
}

/** Manages cloak cloth sims on the Unity-exported avatar. */
export class CloakClothManager {
  private root: THREE.Object3D | null = null;
  private families = new Map<string, CloakFamily>();
  private capsules: ResolvedCapsule[] = [];
  private armSegments: { bone: THREE.Object3D; end: THREE.Object3D; name: string }[] = [];
  private params: Partial<ClothParams>;
  /** Panel edits, keyed by cloak family then particle id. Survives reloads of the sim. */
  private weightOverrides = new Map<string, Map<number, number>>();
  /** Manual arm hitch per particle. null clears an automatic hitch. */
  private hitchOverrides = new Map<string, Map<number, string | null>>();
  /** Metres from the joint when the user has moved a hitch off its rest distance. */
  private hitchDistOverrides = new Map<string, Map<number, number>>();
  /** Follow blend when it is not a full lock. */
  private hitchFollowOverrides = new Map<string, Map<number, number>>();
  private debugGroup: THREE.Group | null = null;
  private debugMeshes: THREE.Mesh[] = [];
  private debugVisible = false;
  private debugParent: THREE.Object3D | null = null;
  private particleVisible = false;
  /** When set, dots behind the cloak stay hidden and cannot be picked. */
  private particleCull = false;
  private readonly _raycaster = new THREE.Raycaster();
  private readonly _occludeDir = new THREE.Vector3();
  private readonly occluders: THREE.Mesh[] = [];
  private cullBias: { value: number } | null = null;
  private particleParent: THREE.Object3D | null = null;
  private particlePoints: THREE.Points | null = null;
  private particleMirrorLine: THREE.LineSegments | null = null;
  private selection: { family: string; id: number; mirrorId: number }[] = [];
  private pinVisible = false;
  private pinParent: THREE.Object3D | null = null;
  private pinMesh: THREE.Mesh | null = null;
  private pinScratch = new Float32Array(0);
  private picked: { family: string; id: number; mirrorId: number } | null = null;
  private readonly _yAxis = new THREE.Vector3(0, 1, 0);
  private readonly _capDir = new THREE.Vector3();
  private readonly _capMid = new THREE.Vector3();
  private readonly _capA = new THREE.Vector3();
  private readonly _capB = new THREE.Vector3();
  private readonly _mirrorA = new THREE.Vector3();
  private readonly _mirrorB = new THREE.Vector3();
  private readonly _projA = new THREE.Vector3();
  private readonly _projB = new THREE.Vector3();
  /** Clicked particle and its mirror were written this frame (height readout). */
  private mirrorLineLive = false;
  /** Green hitch line is on screen. */
  private hitchLineLive = false;

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
    const keepPins = this.pinVisible;
    const pinParent = this.pinParent;
    this.disposeAll();
    this.root = root;
    this.capsules = [];
    this.armSegments = [];
    for (const [boneName, endName] of ARM_PIN_SEGMENTS) {
      const bone = findNamedObject(root, boneName);
      const end = findNamedObject(root, endName);
      if (bone && end) this.armSegments.push({ bone, end, name: boneName });
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
    if (keepPins && pinParent) this.setShowPins(true, pinParent);
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

  /**
   * Hide particle dots, the hitch line, and the pin highlight for a single draw.
   * The toggles are left as the user set them.
   */
  suppressParticleOverlay(hide: boolean): void {
    if (this.particlePoints) this.particlePoints.visible = !hide;
    if (this.particleMirrorLine) this.particleMirrorLine.visible = hide ? false : this.hitchLineLive;
    if (this.pinMesh) this.pinMesh.visible = !hide;
  }

  /** Toggle world-space particle dots (red held, yellow stiff, blue-green free). */
  setShowParticles(show: boolean, scene: THREE.Object3D): void {
    this.particleVisible = show;
    this.particleParent = scene;
    if (!show) {
      this.picked = null;
      this.selection = [];
      for (const fam of this.families.values()) fam.primary.clearDebugSelected();
    }
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
    this.prepareOccluders();
    const maxD2 = maxNdc * maxNdc;
    let best = -1;
    let bestD2 = maxD2;
    for (let i = 0; i < posAttr.count; i++) {
      _v.fromBufferAttribute(posAttr, i);
      const wx = _v.x;
      const wy = _v.y;
      const wz = _v.z;
      _v.project(camera);
      if (_v.z < -1 || _v.z > 1) continue;
      const dx = _v.x - ndcX;
      const dy = _v.y - ndcY;
      const d2 = dx * dx + dy * dy;
      if (d2 >= bestD2) continue;
      if (this.particleCull) {
        _v.set(wx, wy, wz);
        if (this.particleOccluded(_v, camera)) continue;
      }
      bestD2 = d2;
      best = i;
    }
    if (best < 0) return null;

    let offset = 0;
    for (const [family, fam] of this.families) {
      const n = fam.primary.vertexCount;
      if (best < offset + n) {
        const id = best - offset;
        const mirrorId = fam.primary.mirrorOf(id);
        const info = fam.primary.particleInfo(id);
        return { family, id, pinned: info.pinned, soft: info.soft, weight: info.weight, mirrorId };
      }
      offset += n;
    }
    return null;
  }

  /**
   * Particles whose screen position falls inside the client-pixel box.
   * `x0,y0` and `x1,y1` are viewport coordinates, any corner order.
   */
  pickParticlesInRect(
    camera: THREE.Camera,
    canvasRect: DOMRect,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
  ): ClothParticleHit[] {
    if (!this.particleVisible || !this.particlePoints || canvasRect.width < 1 || canvasRect.height < 1) {
      return [];
    }
    const posAttr = this.particlePoints.geometry.getAttribute('position') as THREE.BufferAttribute;
    if (!posAttr || posAttr.count === 0) return [];

    const toNdcX = (x: number) => ((x - canvasRect.left) / canvasRect.width) * 2 - 1;
    const toNdcY = (y: number) => -((y - canvasRect.top) / canvasRect.height) * 2 + 1;
    let minX = toNdcX(x0);
    let maxX = toNdcX(x1);
    let minY = toNdcY(y0);
    let maxY = toNdcY(y1);
    if (minX > maxX) {
      const s = minX;
      minX = maxX;
      maxX = s;
    }
    if (minY > maxY) {
      const s = minY;
      minY = maxY;
      maxY = s;
    }

    camera.updateMatrixWorld();
    this.prepareOccluders();
    const inside: number[] = [];
    for (let i = 0; i < posAttr.count; i++) {
      _v.fromBufferAttribute(posAttr, i);
      const wx = _v.x;
      const wy = _v.y;
      const wz = _v.z;
      _v.project(camera);
      if (_v.z < -1 || _v.z > 1) continue;
      if (_v.x < minX || _v.x > maxX || _v.y < minY || _v.y > maxY) continue;
      if (this.particleCull) {
        _v.set(wx, wy, wz);
        if (this.particleOccluded(_v, camera)) continue;
      }
      inside.push(i);
    }

    const hits: ClothParticleHit[] = [];
    let offset = 0;
    let cursor = 0;
    for (const [family, fam] of this.families) {
      const n = fam.primary.vertexCount;
      const end = offset + n;
      while (cursor < inside.length && inside[cursor]! < end) {
        const index = inside[cursor]!;
        cursor++;
        if (index < offset) continue;
        const id = index - offset;
        const mirrorId = fam.primary.mirrorOf(id);
        const info = fam.primary.particleInfo(id);
        hits.push({ family, id, pinned: info.pinned, soft: info.soft, weight: info.weight, mirrorId });
      }
      offset = end;
    }
    return hits;
  }

  /** Highlight these particles and draw a hitch line for each one that is hitched. */
  setSelection(hits: readonly ClothParticleHit[]): void {
    this.selection = hits.map((h) => ({ family: h.family, id: h.id, mirrorId: h.mirrorId }));
    this.picked = this.selection[0] ?? null;
    for (const fam of this.families.values()) fam.primary.clearDebugSelected();
    for (const sel of this.selection) {
      this.families.get(sel.family)?.primary.markDebugSelected(sel.id);
    }
    if (this.particleVisible) this.syncParticleHelpers();
  }

  get selectionCount(): number {
    return this.selection.length;
  }

  /** Highlighted particles, one entry per selected point. */
  selectedParticles(): { family: string; id: number }[] {
    return this.selection.map((sel) => ({ family: sel.family, id: sel.id }));
  }

  /**
   * Resolve stored group members to live particles. Families that are not
   * on the loaded ghoul are skipped.
   */
  hitsForMembers(members: Readonly<Record<string, readonly number[]>>): ClothParticleHit[] {
    const hits: ClothParticleHit[] = [];
    for (const [family, ids] of Object.entries(members)) {
      const fam = this.families.get(family);
      if (!fam) continue;
      const n = fam.primary.vertexCount;
      for (const id of ids) {
        if (!Number.isInteger(id) || id < 0 || id >= n) continue;
        const mirrorId = fam.primary.mirrorOf(id);
        const info = fam.primary.particleInfo(id);
        hits.push({ family, id, pinned: info.pinned, soft: info.soft, weight: info.weight, mirrorId });
      }
    }
    return hits;
  }

  /** How many stored members belong to a cloak that is not on this ghoul. */
  absentMemberCount(members: Readonly<Record<string, readonly number[]>>): number {
    let n = 0;
    for (const [family, ids] of Object.entries(members)) {
      if (!this.families.has(family)) n += ids.length;
    }
    return n;
  }

  /** Hitch distances, in metres, for highlighted particles that are hitched. */
  selectionHitchDistances(): number[] {
    const out: number[] = [];
    for (const sel of this.selection) {
      const dist = this.particleHitchDistance(sel.family, sel.id);
      if (dist != null) out.push(dist);
    }
    return out;
  }

  get showingParticles(): boolean {
    return this.particleVisible;
  }

  get particleCount(): number {
    let n = 0;
    for (const family of this.families.values()) n += family.primary.vertexCount;
    return n;
  }

  /** Paint the cloak faces that are pinned to an arm. */
  setShowPins(show: boolean, scene: THREE.Object3D): void {
    this.pinVisible = show;
    this.pinParent = scene;
    this.clearPinOverlay();
    if (!show) return;
    if (this.pinScratch.length < 9) this.pinScratch = new Float32Array(9);
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(this.pinScratch, 3));
    const mat = new THREE.MeshBasicMaterial({
      color: 0xe5a7c5,
      transparent: true,
      opacity: 1,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.pinMesh = new THREE.Mesh(geom, mat);
    this.pinMesh.name = 'ClothPinDebug';
    this.pinMesh.frustumCulled = false;
    this.pinMesh.renderOrder = 999;
    scene.add(this.pinMesh);
    this.syncPinOverlay();
  }

  get showingPins(): boolean {
    return this.pinVisible;
  }

  get pinnedCount(): number {
    let n = 0;
    for (const family of this.families.values()) n += family.primary.armPinnedCount();
    return n;
  }

  private clearPinOverlay(): void {
    if (!this.pinMesh) return;
    this.pinMesh.parent?.remove(this.pinMesh);
    this.pinMesh.geometry.dispose();
    (this.pinMesh.material as THREE.Material).dispose();
    this.pinMesh = null;
  }

  private syncPinOverlay(): void {
    if (!this.pinMesh) return;
    let floats = 0;
    for (const family of this.families.values()) {
      if (!family.primary.mesh.visible) continue;
      floats += family.primary.countPinnedFaces() * 9;
    }
    if (this.pinScratch.length < floats) this.pinScratch = new Float32Array(Math.max(floats, 9));
    let offset = 0;
    for (const family of this.families.values()) {
      if (!family.primary.mesh.visible) continue;
      offset = family.primary.writePinnedFaces(this.pinScratch, offset);
    }
    const geom = this.pinMesh.geometry;
    const prev = geom.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (!prev || prev.array !== this.pinScratch) {
      if (prev) geom.deleteAttribute('position');
      geom.setAttribute('position', new THREE.BufferAttribute(this.pinScratch, 3));
    } else {
      prev.needsUpdate = true;
    }
    geom.setDrawRange(0, offset / 3);
    if (offset > 0) geom.computeBoundingSphere();
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
    if (this.particleMirrorLine) {
      if (this.particleMirrorLine.parent) this.particleMirrorLine.parent.remove(this.particleMirrorLine);
      this.particleMirrorLine.geometry.dispose();
      (this.particleMirrorLine.material as THREE.Material).dispose();
      this.particleMirrorLine = null;
      this.hitchLineLive = false;
    }
    if (!this.particlePoints) return;
    if (this.particlePoints.parent) this.particlePoints.parent.remove(this.particlePoints);
    this.particlePoints.geometry.dispose();
    (this.particlePoints.material as THREE.Material).dispose();
    this.particlePoints = null;
    this.cullBias = null;
  }

  /** Hide dots that sit behind the cloak. Off draws every particle, including through the cloth. */
  setParticleCull(on: boolean): void {
    this.particleCull = on;
    const mat = this.particlePoints?.material;
    if (mat instanceof THREE.PointsMaterial) mat.depthTest = on;
    if (this.cullBias) this.cullBias.value = on ? 1 : 0;
  }

  get cullingParticles(): boolean {
    return this.particleCull;
  }

  private meshWritesDepth(mesh: THREE.Mesh): boolean {
    if (!mesh.visible) return false;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    return mats.some((m) => !!m && m.depthWrite && m.visible && m.opacity > 0.2);
  }

  /** Cloak and body meshes that write depth, so picking matches the culled dots. */
  private prepareOccluders(): void {
    this.occluders.length = 0;
    if (!this.particleCull) return;
    const seen = new Set<THREE.Object3D>();
    for (const fam of this.families.values()) {
      let top: THREE.Object3D = fam.primary.mesh;
      while (top.parent && top.parent.type !== 'Scene') top = top.parent;
      if (seen.has(top)) continue;
      seen.add(top);
      top.traverse((obj) => {
        if (obj instanceof THREE.Mesh && this.meshWritesDepth(obj)) this.occluders.push(obj);
      });
    }
  }

  /** True when cloth or the body is between the camera and this point. */
  private particleOccluded(world: THREE.Vector3, camera: THREE.Camera): boolean {
    if (!this.particleCull || this.occluders.length === 0) return false;
    this._occludeDir.copy(world).sub(camera.position);
    const dist = this._occludeDir.length();
    if (dist <= 0.02) return false;
    this._occludeDir.multiplyScalar(1 / dist);
    this._raycaster.set(camera.position, this._occludeDir);
    this._raycaster.near = 0;
    this._raycaster.far = dist - 0.02;
    return this._raycaster.intersectObjects(this.occluders, false).length > 0;
  }

  private rebuildParticleHelpers(scene: THREE.Object3D): void {
    const count = this.particleCount;
    if (count === 0) return;

    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    let offset = 0;
    let lineA = -1;
    let lineB = -1;
    for (const [key, family] of this.families) {
      const hi = this.picked?.family === key ? this.picked.id : -1;
      const mirror = this.picked?.family === key ? this.picked.mirrorId : -1;
      if (hi >= 0 && mirror >= 0) {
        lineA = offset + hi;
        lineB = offset + mirror;
      }
      offset += family.primary.writeParticleDebug(positions, colors, offset, hi, mirror);
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.PointsMaterial({
      size: 0.028,
      sizeAttenuation: true,
      vertexColors: true,
      depthTest: this.particleCull,
      depthWrite: false,
      transparent: true,
      opacity: 0.95,
    });
    const bias = { value: this.particleCull ? 1 : 0 };
    this.cullBias = bias;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uCullBias = bias;
      shader.vertexShader =
        'uniform float uCullBias;\n' +
        shader.vertexShader.replace(
          '#include <project_vertex>',
          `#include <project_vertex>
         gl_Position.z -= uCullBias * 0.0006 * gl_Position.w;`,
        );
    };
    const previousCacheKey = mat.customProgramCacheKey.bind(mat);
    mat.customProgramCacheKey = () => `${previousCacheKey()}|clothParticleCull`;
    this.particlePoints = new THREE.Points(geom, mat);
    this.particlePoints.name = 'ClothParticleDebug';
    this.particlePoints.frustumCulled = false;
    this.particlePoints.renderOrder = 999;
    scene.add(this.particlePoints);

    const lineGeom = new THREE.BufferGeometry();
    lineGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const lineMat = new THREE.LineBasicMaterial({
      color: 0x7dff4a,
      depthTest: false,
      transparent: true,
    });
    this.particleMirrorLine = new THREE.LineSegments(lineGeom, lineMat);
    this.particleMirrorLine.name = 'ClothHitchLine';
    this.particleMirrorLine.frustumCulled = false;
    this.particleMirrorLine.renderOrder = 1000;
    this.particleMirrorLine.visible = false;
    scene.add(this.particleMirrorLine);
    this.recordMirrorEnds(positions, lineA, lineB);
    this.placeHitchLines();
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
    let lineA = -1;
    let lineB = -1;
    for (const [key, family] of this.families) {
      const hi = this.picked?.family === key ? this.picked.id : -1;
      const mirror = this.picked?.family === key ? this.picked.mirrorId : -1;
      if (hi >= 0 && mirror >= 0) {
        lineA = offset + hi;
        lineB = offset + mirror;
      }
      offset += family.primary.writeParticleDebug(positions, colors, offset, hi, mirror);
    }
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    this.recordMirrorEnds(positions, lineA, lineB);
    this.placeHitchLines();
  }

  /** Clicked particle and its mirror, for the height readout. Nothing is drawn. */
  private recordMirrorEnds(positions: Float32Array, a: number, b: number): void {
    if (a < 0 || b < 0) {
      this.mirrorLineLive = false;
      return;
    }
    const ao = a * 3;
    const bo = b * 3;
    this._mirrorA.set(positions[ao]!, positions[ao + 1]!, positions[ao + 2]!);
    this._mirrorB.set(positions[bo]!, positions[bo + 1]!, positions[bo + 2]!);
    this.mirrorLineLive = true;
  }

  /** Thin green segments from each highlighted particle to the joint it is hitched to. */
  private placeHitchLines(): void {
    const line = this.particleMirrorLine;
    if (!line) return;
    const geom = line.geometry as THREE.BufferGeometry;
    const needed = this.selection.length * 2;
    let attr = geom.getAttribute('position') as THREE.BufferAttribute;
    if (!attr || attr.count < needed) {
      attr = new THREE.BufferAttribute(new Float32Array(Math.max(needed, 2) * 3), 3);
      geom.setAttribute('position', attr);
    }
    const arr = attr.array as Float32Array;
    let w = 0;
    for (const sel of this.selection) {
      const sim = this.families.get(sel.family)?.primary;
      if (!sim || !sim.copyParticleWorld(sel.id, this._capA) || !sim.hitchBoneWorld(sel.id, this._capB)) continue;
      this._capDir.subVectors(this._capB, this._capA);
      if (this._capDir.lengthSq() < 1e-12) continue;
      arr[w++] = this._capA.x;
      arr[w++] = this._capA.y;
      arr[w++] = this._capA.z;
      arr[w++] = this._capB.x;
      arr[w++] = this._capB.y;
      arr[w++] = this._capB.z;
    }
    const verts = w / 3;
    attr.needsUpdate = true;
    geom.setDrawRange(0, verts);
    if (verts < 2) {
      line.visible = false;
      this.hitchLineLive = false;
      return;
    }
    line.visible = true;
    this.hitchLineLive = true;
  }

  /**
   * Tilt of the mirror line on screen. 0° is level, ±90° is vertical.
   * Positive means the right-hand end sits higher. Within 8° of level or
   * vertical counts as a straight line.
   */
  mirrorScreenTilt(camera: THREE.Camera): { deg: number; straight: boolean } | null {
    if (!this.mirrorLineLive) return null;
    camera.updateMatrixWorld();
    this._projA.copy(this._mirrorA).project(camera);
    this._projB.copy(this._mirrorB).project(camera);
    let ax = this._projA.x;
    let ay = this._projA.y;
    let bx = this._projB.x;
    let by = this._projB.y;
    if (bx < ax) {
      const sx = ax;
      ax = bx;
      bx = sx;
      const sy = ay;
      ay = by;
      by = sy;
    }
    const dx = bx - ax;
    const dy = by - ay;
    if (dx * dx + dy * dy < 1e-10) return { deg: 0, straight: true };
    const deg = Math.atan2(dy, dx) * (180 / Math.PI);
    const abs = Math.abs(deg);
    return { deg, straight: abs <= 8 || abs >= 82 };
  }

  /** World height of the clicked particle and its mirror. Y is up, in metres. */
  mirrorHeights(): { id: number; y: number; mirrorId: number; mirrorY: number } | null {
    if (!this.mirrorLineLive || !this.picked) return null;
    return {
      id: this.picked.id,
      y: this._mirrorA.y,
      mirrorId: this.picked.mirrorId,
      mirrorY: this._mirrorB.y,
    };
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
      primary.bindFollowBones(this.armSegments);
      const stored = this.weightOverrides.get(key);
      if (stored && stored.size > 0) primary.applyHoldOverrides(stored);
      this.applyHitchOverridesTo(primary, this.hitchOverrides.get(key));
      this.applyHitchDistOverridesTo(primary, this.hitchDistOverrides.get(key));
      this.applyHitchFollowOverridesTo(primary, this.hitchFollowOverrides.get(key));
      const trims = trimMeshes.map((m, i) => new WeldedTrimMesh(m, primary, i));
      this.families.set(key, { primary, trims });
    }

    if (this.particleVisible && this.particleParent) {
      this.clearParticleHelpers();
      this.rebuildParticleHelpers(this.particleParent);
    }
  }

  reset(): void {
    for (const family of this.families.values()) {
      family.primary.reset();
      for (const trim of family.trims) trim.sync();
    }
  }

  update(dt: number): void {
    if (this.capsules.length > 0 && (this.families.size > 0 || this.debugVisible)) {
      this.resolveWorldCapsules();
    }
    if (this.families.size > 0) {
      for (const family of this.families.values()) {
        if (!family.primary.mesh.visible) continue;
        family.primary.update(dt, this.capsules);
        for (const trim of family.trims) trim.sync();
      }
      this.commitCapsuleMotion();
    }
    if (this.debugVisible) this.syncDebugHelpers();
    if (this.particleVisible) this.syncParticleHelpers();
    if (this.pinVisible) this.syncPinOverlay();
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

  /** Saved weights from `public/data/cloth-particle-weights.json`. */
  async loadWeightOverrides(): Promise<void> {
    try {
      const res = await fetch('/data/cloth-particle-weights.json', { cache: 'no-store' });
      if (!res.ok) return;
      const data = (await res.json()) as ClothLibrary;
      this.ingestWeightOverrides(data);
    } catch {
      // No file yet: authored paint weights stand.
    }
  }

  ingestWeightOverrides(data: ClothLibrary): void {
    for (const [family, weights] of this.weightOverrides) {
      const fam = this.families.get(family);
      if (!fam) continue;
      for (const id of weights.keys()) fam.primary.resetHoldWeight(id);
    }
    this.weightOverrides.clear();
    for (const [family, entries] of Object.entries(data)) {
      if (family === 'hitches' || family === 'hitchDist' || family === 'hitchFollow') continue;
      if (!entries || typeof entries !== 'object') continue;
      const bucket = new Map<number, number>();
      for (const [id, raw] of Object.entries(entries)) {
        const n = Number(id);
        const weight = Number(raw);
        if (!Number.isInteger(n) || n < 0 || !Number.isFinite(weight)) continue;
        bucket.set(n, Math.min(1, Math.max(0, weight)));
      }
      if (bucket.size > 0) this.weightOverrides.set(family, bucket);
    }
    this.applyStoredWeights();
    if (data.hitches) this.ingestHitchOverrides(data.hitches);
    if (data.hitchDist) this.ingestHitchDistances(data.hitchDist);
    if (data.hitchFollow) this.ingestHitchFollow(data.hitchFollow);
  }

  exportWeightOverrides(): ClothLibrary {
    const out: ClothLibrary = {};
    for (const [family, bucket] of this.weightOverrides) {
      if (bucket.size === 0) continue;
      const entries: Record<string, number> = {};
      for (const [id, w] of bucket) entries[String(id)] = Math.round(w * 100) / 100;
      out[family] = entries;
    }
    const hitches: ClothHitchOverrides = {};
    for (const [family, bucket] of this.hitchOverrides) {
      if (bucket.size === 0) continue;
      const entries: Record<string, string | null> = {};
      for (const [id, bone] of bucket) entries[String(id)] = bone;
      hitches[family] = entries;
    }
    if (Object.keys(hitches).length > 0) out.hitches = hitches;
    const hitchDist: ClothHitchDistances = {};
    for (const [family, bucket] of this.hitchDistOverrides) {
      if (bucket.size === 0) continue;
      const entries: Record<string, number> = {};
      for (const [id, meters] of bucket) entries[String(id)] = Math.round(meters * 1000) / 1000;
      hitchDist[family] = entries;
    }
    if (Object.keys(hitchDist).length > 0) out.hitchDist = hitchDist;
    const hitchFollow: ClothHitchFollow = {};
    for (const [family, bucket] of this.hitchFollowOverrides) {
      if (bucket.size === 0) continue;
      const entries: Record<string, number> = {};
      for (const [id, amount] of bucket) entries[String(id)] = Math.round(amount * 100) / 100;
      hitchFollow[family] = entries;
    }
    if (Object.keys(hitchFollow).length > 0) out.hitchFollow = hitchFollow;
    return out;
  }

  particleHitchName(family: string, id: number): string | null {
    const fam = this.families.get(family);
    if (!fam) return null;
    return fam.primary.hitchBoneName(id);
  }

  /** Hitch-follow blend, or null when this point is not hitched. */
  particleHitchFollow(family: string, id: number): number | null {
    const fam = this.families.get(family);
    if (!fam) return null;
    return fam.primary.hitchFollowAmount(id);
  }

  /** Follow blends for highlighted particles that are hitched. */
  selectionHitchFollows(): number[] {
    const out: number[] = [];
    for (const sel of this.selection) {
      const amount = this.particleHitchFollow(sel.family, sel.id);
      if (amount != null) out.push(amount);
    }
    return out;
  }

  /** Set how hard the hitch pulls every highlighted particle that is hitched. */
  setSelectionHitchFollow(amount: number, alsoMirror: boolean): void {
    const seen = new Set<string>();
    for (const sel of this.selection) {
      const key = `${sel.family}:${sel.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (this.particleHitchFollow(sel.family, sel.id) == null) continue;
      this.writeHitchFollow(sel.family, sel.id, amount);
      if (!alsoMirror || sel.mirrorId < 0) continue;
      const mirrorKey = `${sel.family}:${sel.mirrorId}`;
      if (seen.has(mirrorKey)) continue;
      seen.add(mirrorKey);
      this.writeHitchFollow(sel.family, sel.mirrorId, amount);
    }
    if (this.particleVisible) this.syncParticleHelpers();
    if (this.pinVisible) this.syncPinOverlay();
  }

  /** Metres from the joint, or null when this point is not hitched. */
  particleHitchDistance(family: string, id: number): number | null {
    const fam = this.families.get(family);
    if (!fam) return null;
    return fam.primary.hitchDistance(id);
  }

  /**
   * Move one hitched point along the green line. `alsoMirror` uses the same
   * distance on the point across local X.
   */
  setParticleHitchDistance(family: string, id: number, meters: number, alsoMirror: boolean): void {
    this.writeHitchDistance(family, id, meters);
    if (alsoMirror) {
      const mirror = this.families.get(family)?.primary.mirrorOf(id) ?? -1;
      if (mirror >= 0) this.writeHitchDistance(family, mirror, meters);
    }
    if (this.particleVisible) this.syncParticleHelpers();
    if (this.pinVisible) this.syncPinOverlay();
  }

  /**
   * Hitch every highlighted particle to this arm bone.
   * `alsoMirror` hitches a point outside the highlight to the opposite arm.
   */
  setSelectionHitch(boneName: string | null, alsoMirror: boolean): void {
    const selected = new Set(this.selection.map((sel) => `${sel.family}:${sel.id}`));
    for (const sel of this.selection) this.writeHitch(sel.family, sel.id, boneName);
    if (alsoMirror) {
      for (const sel of this.selection) {
        if (sel.mirrorId < 0) continue;
        const key = `${sel.family}:${sel.mirrorId}`;
        if (selected.has(key)) continue;
        this.writeHitch(sel.family, sel.mirrorId, boneName ? oppositeArmBone(boneName) : null);
      }
    }
    if (this.particleVisible) this.syncParticleHelpers();
    if (this.pinVisible) this.syncPinOverlay();
  }

  /** Set the hitch distance on every highlighted particle that is hitched. */
  setSelectionHitchDistance(meters: number, alsoMirror: boolean): void {
    const seen = new Set<string>();
    for (const sel of this.selection) {
      const key = `${sel.family}:${sel.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (this.particleHitchDistance(sel.family, sel.id) == null) continue;
      this.writeHitchDistance(sel.family, sel.id, meters);
      if (!alsoMirror || sel.mirrorId < 0) continue;
      const mirrorKey = `${sel.family}:${sel.mirrorId}`;
      if (seen.has(mirrorKey)) continue;
      seen.add(mirrorKey);
      this.writeHitchDistance(sel.family, sel.mirrorId, meters);
    }
    if (this.particleVisible) this.syncParticleHelpers();
    if (this.pinVisible) this.syncPinOverlay();
  }

  /**
   * Hitch one cloak point to an arm bone, or pass null to take it off the arm.
   * `alsoMirror` hitches the point across local X to the opposite arm.
   */
  setParticleHitch(family: string, id: number, boneName: string | null, alsoMirror: boolean): void {
    this.writeHitch(family, id, boneName);
    if (alsoMirror) {
      const mirror = this.families.get(family)?.primary.mirrorOf(id) ?? -1;
      if (mirror >= 0) this.writeHitch(family, mirror, boneName ? oppositeArmBone(boneName) : null);
    }
    if (this.particleVisible) this.syncParticleHelpers();
    if (this.pinVisible) this.syncPinOverlay();
  }

  /**
   * Set one particle's hold weight. `alsoMirror` writes the same value on the
   * particle across local X.
   */
  setParticleWeight(family: string, id: number, weight: number, alsoMirror: boolean): void {
    const w = Math.min(1, Math.max(0, weight));
    this.writeHold(family, id, w);
    if (alsoMirror) {
      const mirror = this.families.get(family)?.primary.mirrorOf(id) ?? -1;
      if (mirror >= 0) this.writeHold(family, mirror, w);
    }
    if (this.particleVisible) this.syncParticleHelpers();
    if (this.pinVisible) this.syncPinOverlay();
  }

  resetParticleWeight(family: string, id: number, alsoMirror: boolean): void {
    this.clearHold(family, id);
    if (alsoMirror) {
      const mirror = this.families.get(family)?.primary.mirrorOf(id) ?? -1;
      if (mirror >= 0) this.clearHold(family, mirror);
    }
    if (this.particleVisible) this.syncParticleHelpers();
    if (this.pinVisible) this.syncPinOverlay();
  }

  particleHold(family: string, id: number): number | null {
    const fam = this.families.get(family);
    if (!fam || id < 0 || id >= fam.primary.vertexCount) return null;
    return fam.primary.holdWeight(id);
  }

  private writeHold(family: string, id: number, weight: number): void {
    const fam = this.families.get(family);
    if (fam) fam.primary.setHoldWeight(id, weight);
    this.hitchOverrides.get(family)?.delete(id);
    this.hitchDistOverrides.get(family)?.delete(id);
    this.hitchFollowOverrides.get(family)?.delete(id);
    const authored = fam?.primary.authoredHoldWeight(id);
    const hitch = fam?.primary.wasHitched(id) ?? false;
    if (fam && !hitch && authored != null && Math.abs(weight - authored) <= 0.005) {
      this.weightOverrides.get(family)?.delete(id);
      return;
    }
    let bucket = this.weightOverrides.get(family);
    if (!bucket) {
      bucket = new Map();
      this.weightOverrides.set(family, bucket);
    }
    bucket.set(id, weight);
  }

  private clearHold(family: string, id: number): void {
    this.weightOverrides.get(family)?.delete(id);
    this.hitchOverrides.get(family)?.delete(id);
    this.hitchDistOverrides.get(family)?.delete(id);
    this.hitchFollowOverrides.get(family)?.delete(id);
    this.families.get(family)?.primary.resetHoldWeight(id);
  }

  private writeHitch(family: string, id: number, boneName: string | null): void {
    const fam = this.families.get(family);
    if (fam) {
      if (boneName) {
        const index = this.armSegments.findIndex((s) => s.name === boneName);
        if (index >= 0) fam.primary.hitchToBoneIndex(id, index);
      } else {
        fam.primary.clearArmHitch(id);
      }
    }
    if (!boneName) this.hitchFollowOverrides.get(family)?.delete(id);
    this.hitchDistOverrides.get(family)?.delete(id);
    const authored = fam?.primary.savedHitchBoneName(id) ?? null;
    if (boneName === authored) {
      this.hitchOverrides.get(family)?.delete(id);
      return;
    }
    let bucket = this.hitchOverrides.get(family);
    if (!bucket) {
      bucket = new Map();
      this.hitchOverrides.set(family, bucket);
    }
    bucket.set(id, boneName);
  }

  private ingestHitchOverrides(data: ClothHitchOverrides): void {
    this.hitchOverrides.clear();
    const allowed = new Set(ARM_HITCH_BONES.map((b) => b.name));
    for (const [family, entries] of Object.entries(data)) {
      if (!entries || typeof entries !== 'object') continue;
      const bucket = new Map<number, string | null>();
      for (const [id, raw] of Object.entries(entries)) {
        const n = Number(id);
        if (!Number.isInteger(n) || n < 0) continue;
        if (raw == null || raw === '') {
          bucket.set(n, null);
          continue;
        }
        if (typeof raw === 'string' && allowed.has(raw)) bucket.set(n, raw);
      }
      if (bucket.size > 0) this.hitchOverrides.set(family, bucket);
    }
    for (const [family, bucket] of this.hitchOverrides) {
      const fam = this.families.get(family);
      if (fam) this.applyHitchOverridesTo(fam.primary, bucket);
    }
  }

  private writeHitchDistance(family: string, id: number, meters: number): void {
    const fam = this.families.get(family);
    const dist = Math.max(0, meters);
    if (fam) fam.primary.setHitchDistance(id, dist);
    const rest = fam?.primary.restHitchDistance(id) ?? 0;
    if (!fam || fam.primary.hitchDistance(id) == null || Math.abs(dist - rest) <= 0.001) {
      this.hitchDistOverrides.get(family)?.delete(id);
      return;
    }
    let bucket = this.hitchDistOverrides.get(family);
    if (!bucket) {
      bucket = new Map();
      this.hitchDistOverrides.set(family, bucket);
    }
    bucket.set(id, dist);
  }

  private ingestHitchDistances(data: ClothHitchDistances): void {
    this.hitchDistOverrides.clear();
    for (const [family, entries] of Object.entries(data)) {
      if (!entries || typeof entries !== 'object') continue;
      const bucket = new Map<number, number>();
      for (const [id, raw] of Object.entries(entries)) {
        const n = Number(id);
        const meters = Number(raw);
        if (!Number.isInteger(n) || n < 0 || !Number.isFinite(meters)) continue;
        bucket.set(n, Math.min(1, Math.max(0, meters)));
      }
      if (bucket.size > 0) this.hitchDistOverrides.set(family, bucket);
    }
    for (const [family, bucket] of this.hitchDistOverrides) {
      const fam = this.families.get(family);
      if (fam) this.applyHitchDistOverridesTo(fam.primary, bucket);
    }
  }

  private applyHitchDistOverridesTo(
    sim: MeshClothSim,
    bucket: Map<number, number> | undefined,
  ): void {
    if (!bucket) return;
    for (const [id, meters] of bucket) sim.setHitchDistance(id, meters);
  }

  private writeHitchFollow(family: string, id: number, amount: number): void {
    const fam = this.families.get(family);
    const follow = Math.min(1, Math.max(0, amount));
    if (fam) fam.primary.setHitchFollow(id, follow);
    if (!fam || fam.primary.hitchFollowAmount(id) == null || follow >= 0.995) {
      this.hitchFollowOverrides.get(family)?.delete(id);
      return;
    }
    let bucket = this.hitchFollowOverrides.get(family);
    if (!bucket) {
      bucket = new Map();
      this.hitchFollowOverrides.set(family, bucket);
    }
    bucket.set(id, follow);
  }

  private ingestHitchFollow(data: ClothHitchFollow): void {
    this.hitchFollowOverrides.clear();
    for (const [family, entries] of Object.entries(data)) {
      if (!entries || typeof entries !== 'object') continue;
      const bucket = new Map<number, number>();
      for (const [id, raw] of Object.entries(entries)) {
        const n = Number(id);
        const amount = Number(raw);
        if (!Number.isInteger(n) || n < 0 || !Number.isFinite(amount)) continue;
        bucket.set(n, Math.min(1, Math.max(0, amount)));
      }
      if (bucket.size > 0) this.hitchFollowOverrides.set(family, bucket);
    }
    for (const [family, bucket] of this.hitchFollowOverrides) {
      const fam = this.families.get(family);
      if (fam) this.applyHitchFollowOverridesTo(fam.primary, bucket);
    }
  }

  private applyHitchFollowOverridesTo(
    sim: MeshClothSim,
    bucket: Map<number, number> | undefined,
  ): void {
    if (!bucket) return;
    for (const [id, amount] of bucket) sim.setHitchFollow(id, amount);
  }

  private applyHitchOverridesTo(
    sim: MeshClothSim,
    bucket: Map<number, string | null> | undefined,
  ): void {
    if (!bucket) return;
    for (const [id, boneName] of bucket) {
      if (boneName) {
        const index = this.armSegments.findIndex((s) => s.name === boneName);
        if (index >= 0) sim.hitchToBoneIndex(id, index);
      } else {
        sim.clearArmHitch(id);
      }
    }
  }

  private applyStoredWeights(): void {
    for (const [family, weights] of this.weightOverrides) {
      const fam = this.families.get(family);
      if (!fam || weights.size === 0) continue;
      fam.primary.applyHoldOverrides(weights);
    }
    if (this.particleVisible) this.syncParticleHelpers();
  }

  disposeAll(): void {
    this.clearDebugHelpers();
    this.clearParticleHelpers();
    this.clearPinOverlay();
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
