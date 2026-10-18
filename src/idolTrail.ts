import * as THREE from 'three';
import { enableBloomLayer } from './materials';

/**
 * The special Idol blooms, and copies of its mesh stay behind it as it
 * orbits. Each copy is where the idol just was, and it fades out.
 */

const COPIES = 10;
/** World metres the idol travels before the next afterimage is left. */
const STEP = 0.016;
const LIFE = 0.85;
/** Newest copy. It fades from here to nothing. */
const START_OPACITY = 0.38;
/** A jump this large is a load or a time hitch, not motion to trail. */
const JUMP = 0.3;

const _pos = new THREE.Vector3();
const _color = new THREE.Color();

type Ghost = {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
};

type Slot = {
  age: number;
  live: boolean;
  ghosts: Ghost[];
};

function chainVisible(obj: THREE.Object3D): boolean {
  let p: THREE.Object3D | null = obj;
  while (p) {
    if (!p.visible) return false;
    p = p.parent;
  }
  return true;
}

function isIdol(name: string): boolean {
  return name.trim().toLowerCase() === 'idol';
}

function meshesOf(root: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) out.push(mesh);
  });
  return out;
}

/** How far the afterimage sits under the idol's own red. */
const TRAIL_SHADE = 0.42;

function readColor(mesh: THREE.Mesh, out: THREE.Color): THREE.Color {
  const src = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  const colored = src as { color?: THREE.Color } | undefined;
  if (colored?.color instanceof THREE.Color) return out.copy(colored.color);
  return out.set(0xff0000);
}

function trailColor(mesh: THREE.Mesh, out: THREE.Color): THREE.Color {
  return readColor(mesh, out).multiplyScalar(TRAIL_SHADE);
}

/** Emissive copy of the idol colour so the bloom pass has something to spread. */
function boostForBloom(mesh: THREE.Mesh): void {
  const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const owned = list.map((src) => {
    const mat = src.clone();
    if (mat instanceof THREE.MeshStandardMaterial) {
      mat.emissive.copy(mat.color);
      mat.emissiveIntensity = 0.9;
      mat.toneMapped = false;
    }
    return mat;
  });
  mesh.material = Array.isArray(mesh.material) ? owned : owned[0]!;
}

export class IdolTrailManager {
  private idol: THREE.Object3D | null = null;
  private sources: THREE.Mesh[] = [];
  private slots: Slot[] = [];
  private cursor = 0;
  private lastPos = new THREE.Vector3();
  private lastMatrices: THREE.Matrix4[] = [];
  private hasLast = false;

  sync(root: THREE.Object3D | null, scene: THREE.Object3D): void {
    this.dispose();
    if (!root) return;

    let idol: THREE.Object3D | null = null;
    root.traverse((o) => {
      if (idol || !isIdol(o.name)) return;
      if (!chainVisible(o)) return;
      idol = o;
    });
    if (!idol) return;

    const host = idol as THREE.Object3D;
    const sources = meshesOf(host);
    if (sources.length === 0) return;
    enableBloomLayer(host);
    for (const mesh of sources) boostForBloom(mesh);

    const slots: Slot[] = [];
    for (let i = 0; i < COPIES; i++) {
      const ghosts: Ghost[] = [];
      for (const src of sources) {
        trailColor(src, _color);
        const mat = new THREE.MeshBasicMaterial({
          color: _color,
          transparent: true,
          opacity: START_OPACITY,
          depthWrite: false,
          toneMapped: false,
          fog: false,
        });
        const mesh = new THREE.Mesh(src.geometry, mat);
        mesh.name = 'IdolAfterimage';
        mesh.matrixAutoUpdate = false;
        mesh.frustumCulled = false;
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        mesh.visible = false;
        mesh.renderOrder = 1;
        scene.add(mesh);
        ghosts.push({ mesh, mat });
      }
      slots.push({ age: 0, live: false, ghosts });
    }

    this.idol = host;
    this.sources = sources;
    this.slots = slots;
    this.lastMatrices = sources.map(() => new THREE.Matrix4());
  }

  update(dt: number): void {
    const idol = this.idol;
    const step = Math.min(Math.max(dt, 0), 0.05);
    if (!idol || !chainVisible(idol)) {
      this.hideAll();
      this.hasLast = false;
      return;
    }

    for (const slot of this.slots) {
      if (!slot.live) continue;
      slot.age += step;
      if (slot.age >= LIFE) {
        slot.live = false;
        for (const ghost of slot.ghosts) ghost.mesh.visible = false;
        continue;
      }
      const fade = 1 - slot.age / LIFE;
      for (let i = 0; i < slot.ghosts.length; i++) {
        const ghost = slot.ghosts[i]!;
        const src = this.sources[i];
        if (!src) continue;
        ghost.mat.color.copy(trailColor(src, _color));
        ghost.mat.opacity = START_OPACITY * fade;
      }
    }

    for (const mesh of this.sources) {
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of list) {
        if (mat instanceof THREE.MeshStandardMaterial) mat.emissive.copy(mat.color);
      }
    }

    idol.updateWorldMatrix(true, true);
    idol.getWorldPosition(_pos);
    if (!this.hasLast) {
      this.capture();
      this.lastPos.copy(_pos);
      this.hasLast = true;
      return;
    }

    const moved = _pos.distanceTo(this.lastPos);
    if (moved > JUMP) {
      this.capture();
      this.lastPos.copy(_pos);
      return;
    }
    if (moved < STEP) return;

    const slot = this.slots[this.cursor]!;
    this.cursor = (this.cursor + 1) % this.slots.length;
    slot.live = true;
    slot.age = 0;
    for (let i = 0; i < slot.ghosts.length; i++) {
      const ghost = slot.ghosts[i]!;
      const src = this.sources[i];
      ghost.mesh.matrix.copy(this.lastMatrices[i]!);
      ghost.mesh.matrixWorldNeedsUpdate = true;
      ghost.mesh.visible = true;
      if (src) ghost.mat.color.copy(trailColor(src, _color));
      ghost.mat.opacity = START_OPACITY;
    }
    this.capture();
    this.lastPos.copy(_pos);
  }

  dispose(): void {
    for (const slot of this.slots) {
      for (const ghost of slot.ghosts) {
        ghost.mesh.removeFromParent();
        ghost.mat.dispose();
      }
    }
    this.slots = [];
    this.sources = [];
    this.lastMatrices = [];
    this.idol = null;
    this.cursor = 0;
    this.hasLast = false;
  }

  private hideAll(): void {
    for (const slot of this.slots) {
      slot.live = false;
      for (const ghost of slot.ghosts) ghost.mesh.visible = false;
    }
  }

  private capture(): void {
    for (let i = 0; i < this.sources.length; i++) {
      const src = this.sources[i]!;
      src.updateWorldMatrix(true, false);
      this.lastMatrices[i]!.copy(src.matrixWorld);
    }
  }
}
