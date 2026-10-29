import * as THREE from 'three';
import { UNITY_EYE_GROUPS } from './unityNames';

/** Shared glance. Held, then a new look. */
const AMP = (7.5 * Math.PI) / 180;

export type EyeMoveMode = 'none' | 'natural' | 'follow';

const GLANCES: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [AMP, 0],
  [-AMP, 0],
  [0, AMP],
  [0, -AMP],
];

const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _offset = new THREE.Quaternion();
const _raycaster = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
const _camForward = new THREE.Vector3();
const _eyeWorld = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _localDir = new THREE.Vector3();
const _restWorld = new THREE.Quaternion();
const _invRest = new THREE.Quaternion();
const _parentQuat = new THREE.Quaternion();
const _cursor = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _restForward = new THREE.Vector3();
const _wantDir = new THREE.Vector3();
const _blend = new THREE.Vector3();
const _point = new THREE.Vector3();
const _gaze = new THREE.Vector3();

/** Swing `a` toward `b` by `t`, both unit vectors. */
function slerpDir(a: THREE.Vector3, b: THREE.Vector3, t: number, out: THREE.Vector3): THREE.Vector3 {
  const dot = THREE.MathUtils.clamp(a.dot(b), -1, 1);
  const theta = Math.acos(dot);
  if (theta < 1e-4) return out.copy(a);
  const s = Math.sin(theta);
  const w0 = Math.sin((1 - t) * theta) / s;
  const w1 = Math.sin(t * theta) / s;
  return out.copy(a).multiplyScalar(w0).addScaledVector(b, w1).normalize();
}

/**
 * Solid eyes (Red, Blue, Full, …) are uniform spheres. Rotating one does not
 * move any feature, so a full glance slides the eye by two fifths of its radius.
 * Position is in the parent, so the radius is the mesh radius (0.5) times scale.
 * Follow uses that same slide per radian, and stops at half a radius.
 */
const SOLID_GLANCE = 0.4;
const SOLID_SHIFT_MAX = 0.5;

/** Follow stays inside this cone around the rest pose. */
const FOLLOW_LIMIT = (35 * Math.PI) / 180;
/** Seconds to close most of the gap to the cursor. */
const FOLLOW_RESPONSE = 0.045;
/**
 * Cursor ray is sampled this fraction of the way from the camera to the eyes.
 * With the 35° camera, the edge of the view then asks for about a 35° look.
 */
const FOLLOW_PLANE = 0.82;

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

const EYE_HOSTS = new Set(UNITY_EYE_GROUPS.map((name) => baseName(name)));

function smoothstep(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

type EyeRig = {
  obj: THREE.Object3D;
  rest: THREE.Quaternion;
  restPos: THREE.Vector3;
  /** No pupil mesh. Shift the eye; rotating a solid sphere does not read. */
  shift: boolean;
  followYaw: number;
  followPitch: number;
};

/** Shortest-path clamp so yaw and pitch together stay inside the follow cone. */
function limitGlance(yaw: number, pitch: number): readonly [number, number] {
  let y = yaw;
  let p = pitch;
  for (let i = 0; i < 2; i++) {
    _euler.set(p, y, 0);
    _offset.setFromEuler(_euler);
    const ang = 2 * Math.acos(Math.min(1, Math.abs(_offset.w)));
    if (!(ang > FOLLOW_LIMIT) || ang < 1e-5) break;
    const s = FOLLOW_LIMIT / ang;
    y *= s;
    p *= s;
  }
  return [y, p];
}

function hasPupil(eye: THREE.Object3D): boolean {
  let found = false;
  eye.traverse((o) => {
    if (o !== eye && baseName(o.name) === 'pupil') found = true;
  });
  return found;
}

/**
 * Every eye group shares one glance. Pupils are children, so they follow.
 * Solid eyes slide in the socket by the same amount. Only visible eyes are posed.
 * `follow` fixates both eyes on one point at the cursor. That point eases back
 * toward rest gaze if either eye would have to turn more than 35°.
 */
export class EyeLookManager {
  private eyes: EyeRig[] = [];
  private mode: EyeMoveMode = 'none';
  private view: HTMLElement | null = null;
  private tracking = false;
  private ndcX = 0;
  private ndcY = 0;
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

  setMode(mode: EyeMoveMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.moving = false;
    this.glance = 0;
    this.yaw = this.pitch = this.fromYaw = this.fromPitch = this.toYaw = this.toPitch = 0;
    this.hold = 0.35 + Math.random() * 0.4;
    for (const eye of this.eyes) {
      eye.followYaw = 0;
      eye.followPitch = 0;
    }
    this.poseRest();
  }

  /** Pointer position is measured against this element, including outside it. */
  attach(view: HTMLElement): void {
    if (this.view === view) return;
    this.detach();
    this.view = view;
    window.addEventListener('pointermove', this.onPointerMove);
    document.addEventListener('pointerout', this.onPointerOut);
  }

  private detach(): void {
    if (!this.view) return;
    window.removeEventListener('pointermove', this.onPointerMove);
    document.removeEventListener('pointerout', this.onPointerOut);
    this.view = null;
    this.tracking = false;
  }

  private onPointerMove = (e: PointerEvent): void => {
    const view = this.view;
    if (!view) return;
    const rect = view.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    this.ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.ndcY = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.tracking = true;
  };

  private onPointerOut = (e: PointerEvent): void => {
    if (e.relatedTarget) return;
    this.tracking = false;
  };

  getMode(): EyeMoveMode {
    return this.mode;
  }

  sync(root: THREE.Object3D | null): void {
    this.poseRest();
    this.eyes = [];
    this.yaw = this.pitch = this.fromYaw = this.fromPitch = this.toYaw = this.toPitch = 0;
    this.moving = false;
    this.hold = 0.35 + Math.random() * 0.4;
    if (!root) return;

    root.traverse((o) => {
      if (!EYE_HOSTS.has(baseName(o.name))) return;
      for (const child of o.children) {
        const n = baseName(child.name);
        if (n !== 'lefteye' && n !== 'righteye') continue;
        this.eyes.push({
          obj: child,
          rest: child.quaternion.clone(),
          restPos: child.position.clone(),
          shift: !hasPupil(child),
          followYaw: 0,
          followPitch: 0,
        });
      }
    });
  }

  update(dt: number, camera?: THREE.Camera): void {
    if (this.eyes.length === 0) return;
    if (this.mode === 'none') {
      this.poseRest();
      return;
    }
    if (this.mode === 'follow') {
      this.updateFollow(dt, camera);
      return;
    }
    const active = this.eyes.filter((eye) => chainVisible(eye.obj));
    if (active.length === 0) {
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

    for (const eye of active) this.applyGlance(eye, this.yaw, this.pitch);
  }

  private updateFollow(dt: number, camera?: THREE.Camera): void {
    const step = Math.min(Math.max(dt, 0), 0.05);
    const k = 1 - Math.exp(-step / FOLLOW_RESPONSE);
    const active = this.eyes.filter((eye) => chainVisible(eye.obj));
    for (const eye of this.eyes) {
      if (active.includes(eye)) continue;
      eye.followYaw = 0;
      eye.followPitch = 0;
      eye.obj.quaternion.copy(eye.rest);
      eye.obj.position.copy(eye.restPos);
    }
    if (active.length === 0) return;

    const cursor = this.tracking && camera ? this.cursorAim(camera, active) : null;
    const aim = cursor ? this.limitedAim(active, cursor) : null;
    for (const eye of active) {
      const [yaw, pitch] = aim ? this.lookAt(eye, aim) : [0, 0];
      eye.followYaw += (yaw - eye.followYaw) * k;
      eye.followPitch += (pitch - eye.followPitch) * k;
      this.applyGlance(eye, eye.followYaw, eye.followPitch);
    }
  }

  /**
   * One fixation for the whole set. If the cursor is outside the cone, the
   * point slides back along the arc toward straight ahead until every eye
   * can reach it.
   */
  private limitedAim(active: EyeRig[], cursor: THREE.Vector3): THREE.Vector3 {
    _cursor.copy(cursor);
    this.gazeFrame(active);
    _wantDir.copy(_cursor).sub(_mid);
    const dist = _wantDir.length();
    if (dist < 1e-4 || _restForward.lengthSq() < 1e-6) return _cursor;
    _wantDir.multiplyScalar(1 / dist);
    if (this.maxGlance(active, _cursor) <= FOLLOW_LIMIT) return _cursor;

    const at = (t: number): THREE.Vector3 => {
      slerpDir(_restForward, _wantDir, t, _blend);
      return _point.copy(_mid).addScaledVector(_blend, dist);
    };
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 12; i++) {
      const midT = (lo + hi) * 0.5;
      if (this.maxGlance(active, at(midT)) <= FOLLOW_LIMIT) lo = midT;
      else hi = midT;
    }
    return at(lo);
  }

  /** Average socket position and rest gaze of the visible eyes. */
  private gazeFrame(active: EyeRig[]): void {
    _mid.set(0, 0, 0);
    _restForward.set(0, 0, 0);
    let n = 0;
    for (const eye of active) {
      if (!this.poseEye(eye)) continue;
      _mid.add(_eyeWorld);
      _gaze.set(0, 0, 1).applyQuaternion(_restWorld);
      _restForward.add(_gaze);
      n++;
    }
    if (n === 0) {
      _restForward.set(0, 0, 1);
      return;
    }
    _mid.multiplyScalar(1 / n);
    if (_restForward.lengthSq() < 1e-6) _restForward.set(0, 0, 1);
    else _restForward.normalize();
  }

  private maxGlance(active: EyeRig[], aim: THREE.Vector3): number {
    let max = 0;
    for (const eye of active) max = Math.max(max, this.glanceAngle(eye, aim));
    return max;
  }

  private glanceAngle(eye: EyeRig, aim: THREE.Vector3): number {
    if (!this.poseEye(eye)) return 0;
    _localDir.copy(aim).sub(_eyeWorld);
    if (_localDir.lengthSq() < 1e-8) return 0;
    _localDir.normalize();
    _gaze.set(0, 0, 1).applyQuaternion(_restWorld);
    return Math.acos(THREE.MathUtils.clamp(_gaze.dot(_localDir), -1, 1));
  }

  private poseEye(eye: EyeRig): boolean {
    const parent = eye.obj.parent;
    if (!parent) return false;
    _eyeWorld.copy(eye.restPos);
    parent.localToWorld(_eyeWorld);
    parent.getWorldQuaternion(_parentQuat);
    _restWorld.multiplyQuaternions(_parentQuat, eye.rest);
    return true;
  }

  /** World point on the cursor ray, in front of the eyes. */
  private cursorAim(camera: THREE.Camera, active: EyeRig[]): THREE.Vector3 | null {
    camera.getWorldDirection(_camForward);
    const camPos = camera.position;
    let depth = 0;
    let counted = 0;
    for (const eye of active) {
      const parent = eye.obj.parent;
      if (!parent) continue;
      _eyeWorld.copy(eye.restPos);
      parent.localToWorld(_eyeWorld);
      depth += _eyeWorld.sub(camPos).dot(_camForward);
      counted++;
    }
    if (counted === 0) return null;
    depth /= counted;
    if (depth < 0.12) return null;
    const lead = Math.max(0.08, depth * (1 - FOLLOW_PLANE));
    const planeDist = depth - lead;
    if (planeDist < 0.05) return null;

    _ndc.set(this.ndcX, this.ndcY);
    _raycaster.setFromCamera(_ndc, camera);
    const denom = _raycaster.ray.direction.dot(_camForward);
    if (denom < 0.2) return null;
    return _raycaster.ray.at(planeDist / denom, _aim);
  }

  /** Yaw and pitch that aim the eye's rest +Z at `aim`, clamped to the cone. */
  private lookAt(eye: EyeRig, aim: THREE.Vector3): readonly [number, number] {
    if (!this.poseEye(eye)) return [0, 0];
    _localDir.copy(aim).sub(_eyeWorld);
    if (_localDir.lengthSq() < 1e-8) return [0, 0];
    _localDir.normalize().applyQuaternion(_invRest.copy(_restWorld).invert());
    const pitch = Math.atan2(-_localDir.y, Math.hypot(_localDir.x, _localDir.z));
    const yaw = Math.atan2(_localDir.x, _localDir.z);
    return limitGlance(yaw, pitch);
  }

  private applyGlance(eye: EyeRig, yaw: number, pitch: number): void {
    _euler.set(pitch, yaw, 0);
    _offset.setFromEuler(_euler);
    eye.obj.quaternion.copy(eye.rest).multiply(_offset);
    if (!eye.shift) return;
    const along = SOLID_GLANCE / AMP;
    const rx = Math.abs(eye.obj.scale.x) * 0.5;
    const ry = Math.abs(eye.obj.scale.y) * 0.5;
    let dx = yaw * along;
    let dy = -pitch * along;
    const len = Math.hypot(dx, dy);
    if (len > SOLID_SHIFT_MAX) {
      const s = SOLID_SHIFT_MAX / len;
      dx *= s;
      dy *= s;
    }
    eye.obj.position.copy(eye.restPos);
    eye.obj.position.x += dx * rx;
    eye.obj.position.y += dy * ry;
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
    for (const eye of this.eyes) {
      eye.obj.quaternion.copy(eye.rest);
      eye.obj.position.copy(eye.restPos);
    }
  }
}
