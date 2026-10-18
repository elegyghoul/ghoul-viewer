import * as THREE from 'three';

/**
 * A thin haze leaving ToxicHead. Specks use that mesh's own slime material
 * and drift out along the surface, with a little lift, so the whole blob
 * gives off mist rather than only the cap.
 */

const COUNT = 20;
const LIFE = 2.6;

const _world = new THREE.Vector3();
const _normal = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _matrix = new THREE.Matrix4();

type Mote = {
  age: number;
  life: number;
  radius: number;
  phase: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
};

type SurfacePoint = {
  pos: THREE.Vector3;
  normal: THREE.Vector3;
};

type Cloud = {
  mesh: THREE.Mesh;
  points: SurfacePoint[];
  instances: THREE.InstancedMesh;
  motes: Mote[];
};

let cloud: Cloud | null = null;

function isToxicHead(name: string): boolean {
  return name.replace(/[\s_]+/g, '').toLowerCase() === 'toxichead';
}

function anchorLive(obj: THREE.Object3D): boolean {
  let p: THREE.Object3D | null = obj;
  while (p) {
    if (!p.visible) return false;
    p = p.parent;
  }
  return true;
}

/** Same slime finish as the trait, without the drip vertex hook. */
function mistMaterial(mesh: THREE.Mesh): THREE.Material {
  const src = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.Material;
  if (src instanceof THREE.MeshStandardMaterial) {
    const mat = src.clone();
    // The drip hook is not copied, but its cache key is. Keep a clean program.
    mat.onBeforeCompile = () => {};
    mat.customProgramCacheKey = () => 'toxic-mist';
    // A little see-through, still the slime green. Glass transmission on a
    // speck shows the sky through it, and the dither snaps that pixel off green.
    mat.transparent = true;
    mat.opacity = 0.68;
    mat.depthWrite = false;
    if ('transmission' in mat) (mat as THREE.MeshPhysicalMaterial).transmission = 0;
    mat.needsUpdate = true;
    return mat;
  }
  return new THREE.MeshStandardMaterial({ color: 0x07a300, roughness: 1, metalness: 0 });
}

/** A point and outward normal for every vertex on the slime. */
function surfacePoints(mesh: THREE.Mesh): SurfacePoint[] {
  const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
  const nrm = mesh.geometry.getAttribute('normal') as THREE.BufferAttribute | undefined;
  const pts: SurfacePoint[] = [];
  if (!pos) return [{ pos: new THREE.Vector3(), normal: new THREE.Vector3(0, 1, 0) }];
  for (let i = 0; i < pos.count; i++) {
    const p = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
    const n = nrm
      ? new THREE.Vector3(nrm.getX(i), nrm.getY(i), nrm.getZ(i))
      : p.clone();
    if (n.lengthSq() < 1e-8) n.set(0, 1, 0);
    n.normalize();
    // Normals that face the skull would spray into the head. Flip those outward.
    const away = p.clone().sub(new THREE.Vector3(0.00018, -0.00358, 0.00116));
    if (n.dot(away) < 0) n.negate();
    pts.push({ pos: p, normal: n });
  }
  return pts;
}

function spawn(mote: Mote, host: THREE.Mesh, points: SurfacePoint[], age: number): void {
  const src = points[Math.floor(Math.random() * points.length)]!;
  host.localToWorld(_world.copy(src.pos));
  _normal.copy(src.normal).transformDirection(host.matrixWorld);
  mote.pos.copy(_world).addScaledVector(_normal, 0.008);
  const outward = 0.028 + Math.random() * 0.032;
  mote.vel.copy(_normal).multiplyScalar(outward);
  mote.vel.y += 0.012 + Math.random() * 0.018;
  mote.radius = 0.006 + Math.random() * 0.006;
  mote.life = LIFE * (0.75 + Math.random() * 0.5);
  mote.age = age;
  mote.phase = Math.random() * Math.PI * 2;
  // Mid-life motes are already out in the haze so it is there immediately.
  mote.pos.addScaledVector(mote.vel, age);
}

function writeMote(mote: Mote, instances: THREE.InstancedMesh, index: number): void {
  const t = mote.age / mote.life;
  const fadeIn = Math.min(1, t / 0.15);
  const fadeOut = 1 - Math.max(0, (t - 0.62) / 0.38);
  const s = mote.radius * fadeIn * Math.max(0, fadeOut);
  const curl = Math.sin(mote.age * 1.6 + mote.phase) * 0.012 * t;
  _world.set(mote.pos.x + curl, mote.pos.y, mote.pos.z + Math.cos(mote.age * 1.3 + mote.phase) * 0.01 * t);
  _scale.set(s, s, s);
  _matrix.compose(_world, _quat, _scale);
  instances.setMatrixAt(index, _matrix);
}

export function bindToxicMist(root: THREE.Object3D, scene: THREE.Object3D): void {
  disposeToxicMist();
  const found: { mesh: THREE.Mesh | null } = { mesh: null };
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (found.mesh || !mesh.isMesh || !isToxicHead(mesh.name)) return;
    found.mesh = mesh;
  });
  const host = found.mesh;
  if (!host || !anchorLive(host)) return;

  const motes: Mote[] = [];
  const points = surfacePoints(host);
  host.updateWorldMatrix(true, false);
  for (let i = 0; i < COUNT; i++) {
    const mote: Mote = {
      age: 0,
      life: LIFE,
      radius: 0.006,
      phase: 0,
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
    };
    spawn(mote, host, points, Math.random() * LIFE);
    motes.push(mote);
  }

  const geom = new THREE.SphereGeometry(1, 6, 4);
  const mat = mistMaterial(host);
  const instances = new THREE.InstancedMesh(geom, mat, COUNT);
  instances.name = 'ToxicMist';
  instances.frustumCulled = false;
  instances.renderOrder = 2;
  for (let i = 0; i < COUNT; i++) writeMote(motes[i]!, instances, i);
  instances.instanceMatrix.needsUpdate = true;
  scene.add(instances);
  cloud = { mesh: host, points, instances, motes };
}

export function updateToxicMist(dt: number): void {
  const current = cloud;
  if (!current) return;
  const step = Math.min(Math.max(dt, 0), 0.05);
  if (!anchorLive(current.mesh)) {
    current.instances.visible = false;
    return;
  }
  current.instances.visible = true;
  current.mesh.updateWorldMatrix(true, false);
  for (let i = 0; i < current.motes.length; i++) {
    const mote = current.motes[i]!;
    mote.age += step;
    if (mote.age >= mote.life) spawn(mote, current.mesh, current.points, 0);
    else mote.pos.addScaledVector(mote.vel, step);
    writeMote(mote, current.instances, i);
  }
  current.instances.instanceMatrix.needsUpdate = true;
}

export function disposeToxicMist(): void {
  if (!cloud) return;
  cloud.instances.removeFromParent();
  cloud.instances.geometry.dispose();
  (cloud.instances.material as THREE.Material).dispose();
  cloud = null;
}
