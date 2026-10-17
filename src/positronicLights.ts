import * as THREE from 'three';
import { MeshSurfaceSampler } from 'three/examples/jsm/math/MeshSurfaceSampler.js';

/**
 * Pinprick LEDs scattered on the positronic surface.
 * Each one blinks on its own clock, red, green, or cyan.
 * Plain meshes in the main pass, so tone mapping, dither, and the
 * existing palette treat them like the rest of the ghoul.
 */

const COUNT = 75;
/** World-space radius. A speck at the normal camera distance. */
const WORLD_RADIUS = 0.00225;
const LED = [0xff1a1a, 0x39ff4a, 0x2af6ff] as const;

const _pos = new THREE.Vector3();
const _nrm = new THREE.Vector3();
const _worldScale = new THREE.Vector3();
const _matrix = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _color = new THREE.Color();

type Lamp = {
  position: THREE.Vector3;
  scale: THREE.Vector3;
  seed: number;
  rate: number;
  bias: number;
  on: boolean;
};

function fract(n: number): number {
  return n - Math.floor(n);
}

function hash(n: number): number {
  return fract(Math.sin(n) * 43758.5453123);
}

function normName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, '_');
}

function findPositronicMesh(root: THREE.Object3D): THREE.Mesh | null {
  const hit: { node: THREE.Object3D | null } = { node: null };
  root.traverse((o) => {
    if (!hit.node && normName(o.name) === 'positronic') hit.node = o;
  });
  const host = hit.node;
  if (!host) return null;
  const mesh = host as THREE.Mesh;
  if (mesh.isMesh && mesh.geometry) return mesh;
  let found: THREE.Mesh | null = null;
  host.traverse((o) => {
    if (found || o === host) return;
    const m = o as THREE.Mesh;
    if (m.isMesh && m.geometry) found = m;
  });
  return found;
}

function shuffleColors(): number[] {
  const deck: number[] = [];
  for (let i = 0; i < COUNT; i++) deck.push(LED[i % LED.length]!);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const swap = deck[i]!;
    deck[i] = deck[j]!;
    deck[j] = swap;
  }
  return deck;
}

function scatter(mesh: THREE.Mesh): THREE.Vector3[] {
  const sampler = new MeshSurfaceSampler(mesh).build();
  mesh.geometry.computeBoundingBox();
  const box = mesh.geometry.boundingBox;
  if (!box) return [];
  const size = box.getSize(new THREE.Vector3());
  const reach = Math.max(size.x, size.y, size.z, 1e-4);
  const lift = reach * 0.02;
  const placed: THREE.Vector3[] = [];

  const tryPlace = (minDist: number, limit: number): void => {
    const minSq = minDist * minDist;
    for (let n = 0; n < limit && placed.length < COUNT; n++) {
      sampler.sample(_pos, _nrm);
      if (_nrm.lengthSq() < 1e-8) continue;
      _nrm.normalize();
      _pos.addScaledVector(_nrm, lift);
      let clear = true;
      if (minSq > 0) {
        for (const p of placed) {
          if (p.distanceToSquared(_pos) < minSq) {
            clear = false;
            break;
          }
        }
      }
      if (clear) placed.push(_pos.clone());
    }
  };

  tryPlace(reach * 0.055, 900);
  if (placed.length < COUNT) tryPlace(reach * 0.028, 600);
  if (placed.length < COUNT) tryPlace(0, 120);
  return placed;
}

function lit(lamp: Lamp, time: number): boolean {
  const slot = Math.floor(time * lamp.rate + lamp.seed);
  return hash(slot * 1.37 + lamp.seed) < lamp.bias;
}

function writeMatrix(mesh: THREE.InstancedMesh, index: number, lamp: Lamp): void {
  const s = lamp.on ? 1 : 0;
  _scale.copy(lamp.scale).multiplyScalar(s);
  _matrix.compose(lamp.position, _quat, _scale);
  mesh.setMatrixAt(index, _matrix);
}

function makeLamps(host: THREE.Mesh): { mesh: THREE.InstancedMesh; lamps: Lamp[] } | null {
  const spots = scatter(host);
  if (spots.length === 0) return null;

  host.updateWorldMatrix(true, false);
  host.getWorldScale(_worldScale);
  const sx = WORLD_RADIUS / Math.max(Math.abs(_worldScale.x), 1e-6);
  const sy = WORLD_RADIUS / Math.max(Math.abs(_worldScale.y), 1e-6);
  const sz = WORLD_RADIUS / Math.max(Math.abs(_worldScale.z), 1e-6);

  const colors = shuffleColors();
  const time = performance.now() * 0.001;
  const lamps: Lamp[] = [];
  const geom = new THREE.SphereGeometry(1, 6, 4);
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const mesh = new THREE.InstancedMesh(geom, mat, spots.length);
  mesh.name = 'PositronicLights';
  mesh.frustumCulled = false;
  mesh.count = spots.length;

  for (let i = 0; i < spots.length; i++) {
    const lamp: Lamp = {
      position: spots[i]!,
      scale: new THREE.Vector3(sx, sy, sz),
      seed: Math.random() * 80,
      rate: 1.5 + Math.random() * 6.5,
      bias: 0.36 + Math.random() * 0.3,
      on: false,
    };
    lamp.on = lit(lamp, time);
    lamps.push(lamp);
    writeMatrix(mesh, i, lamp);
    _color.setHex(colors[i] ?? LED[0]);
    mesh.setColorAt(i, _color);
  }

  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  return { mesh, lamps };
}

export class PositronicLights {
  private mesh: THREE.InstancedMesh | null = null;
  private host: THREE.Mesh | null = null;
  private lamps: Lamp[] = [];

  sync(root: THREE.Object3D | null): void {
    const mesh = root ? findPositronicMesh(root) : null;
    if (mesh === this.host && this.mesh) return;
    this.clear();
    this.host = mesh;
    if (!mesh) return;
    const built = makeLamps(mesh);
    if (!built) return;
    mesh.add(built.mesh);
    this.mesh = built.mesh;
    this.lamps = built.lamps;
  }

  update(): void {
    const mesh = this.mesh;
    if (!mesh || this.lamps.length === 0) return;
    const time = performance.now() * 0.001;
    let changed = false;
    for (let i = 0; i < this.lamps.length; i++) {
      const lamp = this.lamps[i]!;
      const on = lit(lamp, time);
      if (on === lamp.on) continue;
      lamp.on = on;
      writeMatrix(mesh, i, lamp);
      changed = true;
    }
    if (changed) mesh.instanceMatrix.needsUpdate = true;
  }

  private clear(): void {
    const mesh = this.mesh;
    this.mesh = null;
    this.host = null;
    this.lamps = [];
    if (!mesh) return;
    mesh.removeFromParent();
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
    mesh.dispose();
  }
}
