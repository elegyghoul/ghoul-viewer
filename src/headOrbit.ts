import * as THREE from 'three';

/**
 * Circle the parent origin (the head socket). The sine's crest is the
 * authored height, so the object only dips below where it was placed.
 */
export const HEAD_ORBIT = {
  /** Multiplier on the rest distance from the parent origin, in the horizontal plane. */
  distance: 1.25,
  /** Radians per second around local up. */
  speed: (Math.PI * 2) / 5,
  /** Crest-to-trough travel, in parent-local units. */
  bob: 0.12,
  /** Vertical cycles per second. */
  bobHz: 0.45,
};

export function placeHeadOrbit(obj: THREE.Object3D, rest: THREE.Vector3, time: number): void {
  const radius = Math.hypot(rest.x, rest.z) * HEAD_ORBIT.distance;
  const ang = Math.atan2(rest.z, rest.x) + time * HEAD_ORBIT.speed;
  // sin peaks at 1, which keeps the authored height. The object only moves down.
  const crest = Math.sin(time * HEAD_ORBIT.bobHz * Math.PI * 2);
  obj.position.set(
    Math.cos(ang) * radius,
    rest.y + HEAD_ORBIT.bob * (crest - 1) * 0.5,
    Math.sin(ang) * radius,
  );
}

const SPECIAL_NAMES = new Set(['idol', 'tea']);
/** One turn of the can around its long axis. */
const TEA_SPIN = (Math.PI * 2) / 2.5;
/** Lean of that axis, radians. The lean travels with the spin. */
const TEA_WOBBLE = 0.18;

const _spinAxis = new THREE.Vector3(0, 1, 0);
const _wobbleAxis = new THREE.Vector3();
const _spin = new THREE.Quaternion();
const _wobble = new THREE.Quaternion();

type Rig = {
  obj: THREE.Object3D;
  rest: THREE.Vector3;
  /** Authored orientation, restored when the orbit stops. */
  restQuat: THREE.Quaternion;
  /** Can spins on its long axis. */
  spin: boolean;
  /** Idol keeps the authored face pointing away from the socket. */
  faceOut: boolean;
};

function normNode(name: string): string {
  return name.trim().toLowerCase();
}

/** Idol and vaporwave tea use the same head orbit as the infernal flame. */
export class SpecialOrbitManager {
  private rigs: Rig[] = [];

  sync(root: THREE.Object3D | null): void {
    this.dispose();
    if (!root) return;
    const found: THREE.Object3D[] = [];
    root.traverse((obj) => {
      if (SPECIAL_NAMES.has(normNode(obj.name))) found.push(obj);
    });
    const set = new Set(found);
    for (const obj of found) {
      let nested = false;
      for (let p = obj.parent; p; p = p.parent) {
        if (set.has(p)) {
          nested = true;
          break;
        }
      }
      if (nested) continue;
      const name = normNode(obj.name);
      this.rigs.push({
        obj,
        rest: obj.position.clone(),
        restQuat: obj.quaternion.clone(),
        spin: name === 'tea',
        faceOut: name === 'idol',
      });
    }
  }

  update(): void {
    if (this.rigs.length === 0) return;
    const time = performance.now() * 0.001;
    for (const rig of this.rigs) {
      placeHeadOrbit(rig.obj, rig.rest, time);
      if (rig.faceOut) {
        // The authored pose points the back of the cross outward. Add a half
        // turn so the front stays aimed away from the socket as it orbits.
        const ang = Math.atan2(rig.obj.position.z, rig.obj.position.x);
        const restAng = Math.atan2(rig.rest.z, rig.rest.x);
        _spin.setFromAxisAngle(_spinAxis, ang - restAng + Math.PI);
        rig.obj.quaternion.copy(_spin).multiply(rig.restQuat);
        continue;
      }
      if (!rig.spin) continue;
      const phase = time * TEA_SPIN;
      // Tilt around a horizontal axis that turns with the spin, then spin the can.
      _wobbleAxis.set(Math.cos(phase), 0, Math.sin(phase));
      _wobble.setFromAxisAngle(_wobbleAxis, TEA_WOBBLE);
      _spin.setFromAxisAngle(_spinAxis, phase);
      rig.obj.quaternion.copy(rig.restQuat).multiply(_wobble).multiply(_spin);
    }
  }

  dispose(): void {
    for (const rig of this.rigs) {
      rig.obj.position.copy(rig.rest);
      rig.obj.quaternion.copy(rig.restQuat);
    }
    this.rigs = [];
  }
}
