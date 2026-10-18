import * as THREE from 'three';

/** Test glance for Dialated eyes only. Held, then a new look. */
const AMP = (15 * Math.PI) / 180;

const GLANCES: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [AMP, 0],
  [-AMP, 0],
  [0, AMP],
  [0, -AMP],
];

const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _offset = new THREE.Quaternion();

function baseName(name: string): string {
  return name
    .replace(/(\.\d+)+$/g, '')
    .replace(/\d+$/g, '')
    .replace(/[\s_]/g, '')
    .toLowerCase();
}

function chainVisible(obj: THREE.Object3D): boolean {
  let p: THREE.Object3D | null = obj;
  while (p) {
    if (!p.visible) return false;
    p = p.parent;
  }
  return true;
}

function smoothstep(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

type EyeRig = {
  obj: THREE.Object3D;
  rest: THREE.Quaternion;
};

/**
 * Both Dialated eyeballs share one glance. Pupils are children, so they follow.
 */
export class EyeLookManager {
  private eyes: EyeRig[] = [];
  private host: THREE.Object3D | null = null;
  private yaw = 0;
  private pitch = 0;
  private fromYaw = 0;
  private fromPitch = 0;
  private toYaw = 0;
  private toPitch = 0;
  private glance = 0;
  private moving = false;
  private moveT = 0;
  private moveDur = 0.16;
  private hold = 0.4;

  sync(root: THREE.Object3D | null): void {
    this.poseRest();
    this.eyes = [];
    this.host = null;
    this.yaw = this.pitch = this.fromYaw = this.fromPitch = this.toYaw = this.toPitch = 0;
    this.moving = false;
    this.hold = 0.35 + Math.random() * 0.4;
    if (!root) return;

    let host: THREE.Object3D | null = null;
    root.traverse((o) => {
      if (!host && baseName(o.name) === 'dialatedeyes') host = o;
    });
    if (!host) return;
    this.host = host;

    for (const child of host.children) {
      const n = baseName(child.name);
      if (n !== 'lefteye' && n !== 'righteye') continue;
      this.eyes.push({ obj: child, rest: child.quaternion.clone() });
    }
  }

  update(dt: number): void {
    if (this.eyes.length === 0) return;
    if (!this.host || !chainVisible(this.host)) {
      this.poseRest();
      return;
    }

    const step = Math.min(Math.max(dt, 0), 0.05);
    if (this.moving) {
      this.moveT += step;
      const u = smoothstep(this.moveT / this.moveDur);
      this.yaw = this.fromYaw + (this.toYaw - this.fromYaw) * u;
      this.pitch = this.fromPitch + (this.toPitch - this.fromPitch) * u;
      if (this.moveT >= this.moveDur) {
        this.yaw = this.toYaw;
        this.pitch = this.toPitch;
        this.moving = false;
        this.hold = 0.55 + Math.random() * 1.6;
      }
    } else {
      this.hold -= step;
      if (this.hold <= 0) this.beginGlance();
    }

    _euler.set(this.pitch, this.yaw, 0);
    _offset.setFromEuler(_euler);
    for (const eye of this.eyes) {
      eye.obj.quaternion.copy(eye.rest).multiply(_offset);
    }
  }

  private beginGlance(): void {
    let next = this.glance;
    if (GLANCES.length > 1) {
      while (next === this.glance) next = Math.floor(Math.random() * GLANCES.length);
    }
    this.glance = next;
    const dir = GLANCES[next]!;
    this.fromYaw = this.yaw;
    this.fromPitch = this.pitch;
    this.toYaw = dir[0];
    this.toPitch = dir[1];
    this.moveT = 0;
    this.moveDur = 0.1 + Math.random() * 0.08;
    this.moving = true;
  }

  private poseRest(): void {
    for (const eye of this.eyes) eye.obj.quaternion.copy(eye.rest);
  }
}
