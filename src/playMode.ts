import * as THREE from 'three';
import type { GhoulAnimator } from './animations';

export type PlayCameraMode = 'fixed' | 'follow';

export type PlayParams = {
  /** World units per second while holding forward. */
  walkSpeed: number;
  /** Radians per second while holding turn. */
  turnSpeed: number;
};

export const DEFAULT_PLAY_PARAMS: PlayParams = {
  walkSpeed: 1.35,
  turnSpeed: 2.2,
};

type OrbitLike = {
  enabled: boolean;
  target: THREE.Vector3;
  update: () => void;
  domElement: HTMLElement | SVGElement | null;
};

export type FollowCamParams = {
  /** Elevation behind the ghoul, degrees (0 = level). */
  pitch: number;
  /** Orbit around the ghoul, degrees (0 = directly behind). */
  yaw: number;
  /** Distance from the ghoul. */
  distance: number;
};

export const FOLLOW_PITCH_MIN_DEG = -7;
export const FOLLOW_PITCH_MAX_DEG = 69;
export const FOLLOW_DIST_DEFAULT = 4.2;
export const FOLLOW_PITCH_DEFAULT_DEG = 24;

export const DEFAULT_FOLLOW_CAM: FollowCamParams = {
  pitch: FOLLOW_PITCH_DEFAULT_DEG,
  yaw: 0,
  distance: FOLLOW_DIST_DEFAULT,
};

const FOLLOW_PITCH_MIN = (FOLLOW_PITCH_MIN_DEG * Math.PI) / 180;
const FOLLOW_PITCH_MAX = (FOLLOW_PITCH_MAX_DEG * Math.PI) / 180;
const FOLLOW_PITCH_SENS = 0.005;

type PadDir = 'left' | 'right' | 'up' | 'down';

/**
 * Resident Evil–style tank controls on a flat floor (Y fixed).
 * Left/Right rotate in place; Up walks forward along facing.
 *
 * Optional Scene-pane D-pad (`#playMovePad`): hold a button = that key.
 * Canvas mouse keeps orbit / pitch.
 */
export class PlayController {
  private enabled = false;
  private root: THREE.Object3D | null = null;
  private animator: GhoulAnimator | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private orbit: OrbitLike | null = null;
  private params: PlayParams = { ...DEFAULT_PLAY_PARAMS };
  private camMode: PlayCameraMode = 'fixed';
  private floorY = 0;
  /** Half-extent of XZ walk box; null = unlimited. */
  private walkHalf: number | null = null;
  private keyLeft = false;
  private keyRight = false;
  private keyUp = false;
  private touchLeft = false;
  private touchRight = false;
  private touchUp = false;
  private lastLocomotion: 'Idle' | 'Walking' | null = null;
  private savedOrbitEnabled = true;
  /** Elevation behind the ghoul (0 = level, higher = more overhead). */
  private followPitch = (DEFAULT_FOLLOW_CAM.pitch * Math.PI) / 180;
  private followYaw = 0;
  private followDist = DEFAULT_FOLLOW_CAM.distance;
  private pitchDragging = false;
  private pitchBound = false;
  private lastPtrY = 0;
  private padEl: HTMLElement | null = null;
  private padBound = false;
  private readonly padHeld = new Map<number, PadDir>();
  private readonly _desiredCam = new THREE.Vector3();
  private readonly _lookAt = new THREE.Vector3();
  private readonly _behind = new THREE.Vector3();

  private readonly onKeyDown = (e: KeyboardEvent): void => this.handleKey(e, true);
  private readonly onKeyUp = (e: KeyboardEvent): void => this.handleKey(e, false);
  private readonly onPtrDown = (e: PointerEvent): void => this.handlePtrDown(e);
  private readonly onPtrMove = (e: PointerEvent): void => this.handlePtrMove(e);
  private readonly onPtrUp = (e: PointerEvent): void => this.handlePtrUp(e);
  private readonly onPadDown = (e: PointerEvent): void => this.handlePadDown(e);
  private readonly onPadUp = (e: PointerEvent): void => this.handlePadUp(e);

  private get left(): boolean {
    return this.keyLeft || this.touchLeft;
  }

  private get right(): boolean {
    return this.keyRight || this.touchRight;
  }

  private get up(): boolean {
    return this.keyUp || this.touchUp;
  }

  get active(): boolean {
    return this.enabled;
  }

  get cameraMode(): PlayCameraMode {
    return this.camMode;
  }

  /** True when play should leave OrbitControls driving the camera. */
  get orbitDrive(): boolean {
    return !this.enabled || this.camMode === 'fixed';
  }

  getParams(): PlayParams {
    return { ...this.params };
  }

  setParams(partial: Partial<PlayParams>): void {
    this.params = { ...this.params, ...partial };
  }

  /**
   * Axis-aligned XZ walk limit (walls at ±half). Pass null to clear.
   * Applied after each step while play is active.
   */
  setWalkBounds(half: number | null): void {
    this.walkHalf = half != null && half > 0 ? half : null;
    this.clampToWalkBounds();
  }

  getFollowCam(): FollowCamParams {
    return {
      pitch: (this.followPitch * 180) / Math.PI,
      yaw: (this.followYaw * 180) / Math.PI,
      distance: this.followDist,
    };
  }

  setFollowCam(partial: Partial<FollowCamParams>): void {
    if (partial.pitch != null) {
      this.followPitch = THREE.MathUtils.clamp(
        (partial.pitch * Math.PI) / 180,
        FOLLOW_PITCH_MIN,
        FOLLOW_PITCH_MAX,
      );
    }
    if (partial.yaw != null) {
      this.followYaw = (partial.yaw * Math.PI) / 180;
    }
    if (partial.distance != null) {
      this.followDist = THREE.MathUtils.clamp(partial.distance, 1, 10);
    }
  }

  resetFollowCam(): void {
    this.setFollowCam(DEFAULT_FOLLOW_CAM);
  }

  setCameraMode(mode: PlayCameraMode): void {
    if (this.camMode === mode) return;
    this.camMode = mode;
    this.applyCameraMode();
  }

  /** Wire the Scene-pane movement pad (hold = key). Safe to call with null. */
  bindMovePad(el: HTMLElement | null): void {
    this.unbindMovePad();
    this.padEl = el;
    if (!el) return;
    for (const btn of el.querySelectorAll<HTMLElement>('[data-dir]')) {
      btn.addEventListener('pointerdown', this.onPadDown);
    }
    window.addEventListener('pointerup', this.onPadUp);
    window.addEventListener('pointercancel', this.onPadUp);
    this.padBound = true;
    this.syncPadVisibility();
  }

  attach(): void {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  detach(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.unbindPitchDrag();
    this.unbindMovePad();
    this.clearKeys();
  }

  /**
   * Enter/leave play. When entering, locks Y to the current framed floor and
   * takes over Idle/Walking. When leaving, restores orbit and clears keys.
   */
  setEnabled(
    on: boolean,
    root: THREE.Object3D | null,
    animator: GhoulAnimator | null,
    camera: THREE.PerspectiveCamera,
    orbit: OrbitLike,
  ): void {
    if (on === this.enabled && (!on || this.root === root)) return;

    if (!on) {
      this.clearKeys();
      this.clearPadHeld();
      this.lastLocomotion = null;
      this.unbindPitchDrag();
      if (this.orbit) this.orbit.enabled = this.savedOrbitEnabled;
      this.enabled = false;
      this.root = null;
      this.animator = null;
      this.camera = null;
      this.orbit = null;
      this.syncPadVisibility();
      return;
    }

    if (!root || !animator) return;

    this.root = root;
    this.animator = animator;
    this.camera = camera;
    this.orbit = orbit;
    this.floorY = root.position.y;
    this.savedOrbitEnabled = orbit.enabled;
    this.enabled = true;
    this.lastLocomotion = null;
    this.syncPadVisibility();
    this.applyCameraMode();
    this.applyLocomotion(false);
  }

  /** Call after frameCharacter / load so feet stay on the floor plane. */
  syncFloorFromRoot(): void {
    if (!this.enabled || !this.root) return;
    this.floorY = this.root.position.y;
  }

  /** Force Idle/Walking to rebind after a ghoul reload. */
  refreshLocomotion(): void {
    this.lastLocomotion = null;
    this.applyLocomotion(this.left || this.right || this.up);
  }

  update(dt: number, blocked = false): void {
    if (!this.enabled || !this.root || !this.animator) return;
    if (blocked) {
      this.applyLocomotion(false);
      return;
    }

    const step = Math.min(dt, 0.05);
    const turning = this.left !== this.right;
    const walking = this.up;
    const moving = turning || walking;

    if (this.left && !this.right) {
      this.root.rotation.y += this.params.turnSpeed * step;
    } else if (this.right && !this.left) {
      this.root.rotation.y -= this.params.turnSpeed * step;
    }

    if (walking) {
      // Mixamo facing is +Z in this pipeline — walk along local forward.
      this.root.translateZ(this.params.walkSpeed * step);
    }

    this.root.position.y = this.floorY;
    this.clampToWalkBounds();
    this.applyLocomotion(moving);
    if (this.camMode === 'follow') this.updateFollowCamera(step);
  }

  private clampToWalkBounds(): void {
    if (!this.root || this.walkHalf == null) return;
    const h = this.walkHalf;
    this.root.position.x = THREE.MathUtils.clamp(this.root.position.x, -h, h);
    this.root.position.z = THREE.MathUtils.clamp(this.root.position.z, -h, h);
  }

  private applyCameraMode(): void {
    if (!this.enabled || !this.orbit) return;
    // Fixed: stay put, mouse orbit still works. Follow: take over the camera.
    this.orbit.enabled = this.camMode === 'fixed';
    if (this.camMode === 'follow') this.bindPitchDrag();
    else this.unbindPitchDrag();
  }

  private bindPitchDrag(): void {
    if (this.pitchBound || !this.orbit) return;
    const el = this.orbit.domElement;
    if (!el) return;
    el.addEventListener('pointerdown', this.onPtrDown as EventListener);
    window.addEventListener('pointermove', this.onPtrMove);
    window.addEventListener('pointerup', this.onPtrUp);
    window.addEventListener('pointercancel', this.onPtrUp);
    this.pitchBound = true;
  }

  private unbindPitchDrag(): void {
    this.pitchDragging = false;
    if (!this.pitchBound || !this.orbit) {
      this.pitchBound = false;
      return;
    }
    const el = this.orbit.domElement;
    if (el) el.removeEventListener('pointerdown', this.onPtrDown as EventListener);
    window.removeEventListener('pointermove', this.onPtrMove);
    window.removeEventListener('pointerup', this.onPtrUp);
    window.removeEventListener('pointercancel', this.onPtrUp);
    this.pitchBound = false;
  }

  private handlePtrDown(e: PointerEvent): void {
    if (!this.enabled || this.camMode !== 'follow') return;
    if (e.button !== 0) return;
    this.pitchDragging = true;
    this.lastPtrY = e.clientY;
    try {
      this.orbit?.domElement?.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    e.preventDefault();
  }

  private syncPadVisibility(): void {
    if (!this.padEl) return;
    this.padEl.hidden = !this.enabled;
    if (!this.enabled) this.clearPadHeld();
  }

  private unbindMovePad(): void {
    this.clearPadHeld();
    if (this.padBound && this.padEl) {
      for (const btn of this.padEl.querySelectorAll<HTMLElement>('[data-dir]')) {
        btn.removeEventListener('pointerdown', this.onPadDown);
      }
    }
    window.removeEventListener('pointerup', this.onPadUp);
    window.removeEventListener('pointercancel', this.onPadUp);
    this.padBound = false;
    this.padEl = null;
  }

  private handlePadDown(e: PointerEvent): void {
    if (!this.enabled) return;
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const btn = e.currentTarget as HTMLElement;
    const dir = btn.dataset.dir as PadDir | undefined;
    if (!dir) return;

    e.preventDefault();
    e.stopPropagation();
    try {
      btn.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }

    this.padHeld.set(e.pointerId, dir);
    btn.setAttribute('aria-pressed', 'true');
    this.syncPadFlags();
  }

  private handlePadUp(e: PointerEvent): void {
    if (!this.padHeld.has(e.pointerId)) return;
    const dir = this.padHeld.get(e.pointerId);
    this.padHeld.delete(e.pointerId);
    const btn = this.padEl?.querySelector<HTMLElement>(`[data-dir="${dir}"]`);
    if (btn) {
      // Keep pressed if another pointer still holds this direction.
      let still = false;
      for (const d of this.padHeld.values()) {
        if (d === dir) {
          still = true;
          break;
        }
      }
      if (!still) btn.setAttribute('aria-pressed', 'false');
      try {
        if (btn.hasPointerCapture(e.pointerId)) btn.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }
    this.syncPadFlags();
  }

  private clearPadHeld(): void {
    this.padHeld.clear();
    this.touchLeft = false;
    this.touchRight = false;
    this.touchUp = false;
    if (!this.padEl) return;
    for (const btn of this.padEl.querySelectorAll<HTMLElement>('[data-dir]')) {
      btn.setAttribute('aria-pressed', 'false');
    }
  }

  private syncPadFlags(): void {
    let left = false;
    let right = false;
    let up = false;
    for (const dir of this.padHeld.values()) {
      if (dir === 'left') left = true;
      else if (dir === 'right') right = true;
      else if (dir === 'up') up = true;
      // 'down' is unused for tank controls (Ghoulball Play uses its own pad binding).
    }
    this.touchLeft = left;
    this.touchRight = right;
    this.touchUp = up;
  }

  private handlePtrMove(e: PointerEvent): void {
    if (!this.pitchDragging || this.camMode !== 'follow') return;
    const dy = e.clientY - this.lastPtrY;
    this.lastPtrY = e.clientY;
    // Drag down → more overhead; drag up → flatter / look up.
    this.followPitch = THREE.MathUtils.clamp(
      this.followPitch + dy * FOLLOW_PITCH_SENS,
      FOLLOW_PITCH_MIN,
      FOLLOW_PITCH_MAX,
    );
  }

  private handlePtrUp(e: PointerEvent): void {
    if (!this.pitchDragging) return;
    this.pitchDragging = false;
    try {
      this.orbit?.domElement?.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  private applyLocomotion(moving: boolean): void {
    if (!this.animator) return;
    const next: 'Idle' | 'Walking' = moving ? 'Walking' : 'Idle';
    if (next === this.lastLocomotion) return;
    this.lastLocomotion = next;
    this.animator.play(next, 0.2);
  }

  private updateFollowCamera(dt: number): void {
    if (!this.root || !this.camera || !this.orbit) return;
    // Spherical perch behind the ghoul; mouse Y adjusts elevation.
    const pitch = this.followPitch;
    const yaw = this.followYaw;
    const dist = this.followDist;
    this._behind.set(
      Math.sin(yaw) * Math.cos(pitch) * dist,
      Math.sin(pitch) * dist,
      -Math.cos(yaw) * Math.cos(pitch) * dist,
    );
    this._behind.applyQuaternion(this.root.quaternion);
    this._desiredCam.copy(this.root.position).add(this._behind);
    this._desiredCam.y = Math.max(this._desiredCam.y, this.floorY + 0.12);
    this._lookAt.set(this.root.position.x, this.root.position.y + 1.15, this.root.position.z);
    const t = 1 - Math.exp(-5 * dt);
    this.camera.position.lerp(this._desiredCam, t);
    this.orbit.target.lerp(this._lookAt, t);
    this.camera.lookAt(this.orbit.target);
  }

  private handleKey(e: KeyboardEvent, down: boolean): void {
    if (!this.enabled) return;
    if (isTypingTarget(e.target)) return;

    switch (e.code) {
      case 'ArrowLeft':
      case 'KeyA':
        this.keyLeft = down;
        e.preventDefault();
        break;
      case 'ArrowRight':
      case 'KeyD':
        this.keyRight = down;
        e.preventDefault();
        break;
      case 'ArrowUp':
      case 'KeyW':
        this.keyUp = down;
        e.preventDefault();
        break;
      default:
        break;
    }
  }

  private clearKeys(): void {
    this.keyLeft = false;
    this.keyRight = false;
    this.keyUp = false;
    this.touchLeft = false;
    this.touchRight = false;
    this.touchUp = false;
  }
}

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return el.isContentEditable;
}
