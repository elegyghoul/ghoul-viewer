import * as THREE from 'three';

/**
 * Point light above the halo ring. Color is copied from the halo material,
 * so red / gold / blue / white / pink each cast that color.
 */

const HALO_LIGHT = 0.6;
const HALO_DISTANCE = 6.2;
/** Meters above the ring, along the head, so the wash covers the skull. */
const HALO_LIFT = 0.22;

const _color = new THREE.Color();
const _up = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();

function placeAboveHalo(light: THREE.PointLight, halo: THREE.Object3D): void {
  const parent = halo.parent;
  if (parent) parent.getWorldQuaternion(_quat);
  else _quat.identity();
  _up.set(0, 1, 0).applyQuaternion(_quat);
  halo.getWorldQuaternion(_quat);
  _up.applyQuaternion(_quat.invert());
  halo.getWorldScale(_scale);
  light.position.set(
    (_up.x / (_scale.x || 1)) * HALO_LIFT,
    (_up.y / (_scale.y || 1)) * HALO_LIFT,
    (_up.z / (_scale.z || 1)) * HALO_LIFT,
  );
}

function chainVisible(obj: THREE.Object3D): boolean {
  let p: THREE.Object3D | null = obj;
  while (p) {
    if (!p.visible) return false;
    p = p.parent;
  }
  return true;
}

function readHaloColor(halo: THREE.Object3D): boolean {
  let found = false;
  halo.traverse((o) => {
    if (found) return;
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const src = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    const colored = src as { color?: THREE.Color } | undefined;
    if (colored?.color instanceof THREE.Color) {
      _color.copy(colored.color);
      found = true;
    }
  });
  return found;
}

export class HaloLightManager {
  private light: THREE.PointLight | null = null;

  private ensureLight(): THREE.PointLight {
    if (!this.light) {
      this.light = new THREE.PointLight(0xffffff, 0, HALO_DISTANCE, 2);
      this.light.name = 'HaloPointLight';
      this.light.castShadow = false;
    }
    return this.light;
  }

  sync(root: THREE.Object3D | null): void {
    const light = this.ensureLight();
    light.removeFromParent();
    light.intensity = 0;
    light.visible = false;
    if (!root) return;

    let halo: THREE.Object3D | null = null;
    root.traverse((o) => {
      if (halo || o.name !== 'Halo') return;
      if (!chainVisible(o)) return;
      halo = o;
    });
    if (!halo) return;

    (halo as THREE.Object3D).add(light);
    light.distance = HALO_DISTANCE;
    placeAboveHalo(light, halo);
    light.visible = true;
    light.intensity = HALO_LIGHT;
    if (readHaloColor(halo)) light.color.copy(_color);
  }

  update(): void {
    const light = this.light;
    const halo = light?.parent;
    if (!light || !halo || halo === light || !chainVisible(halo)) {
      if (light) {
        light.intensity = 0;
        light.visible = false;
      }
      return;
    }
    light.visible = true;
    light.intensity = HALO_LIGHT;
    light.distance = HALO_DISTANCE;
    placeAboveHalo(light, halo);
    if (readHaloColor(halo)) light.color.copy(_color);
  }
}
