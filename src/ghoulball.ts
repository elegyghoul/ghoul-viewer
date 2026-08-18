import * as THREE from 'three';
import { box3BodyOnly, box3Visible } from './assembleGhoul';

export const GHOULBALL_WRAP_DURATION = 2;
const WRAP_DURATION = GHOULBALL_WRAP_DURATION;
/** Must match the morph-target sphere / visible ball segmentation. */
const SPHERE_WIDTH = 48;
const SPHERE_HEIGHT = 32;
const AUTO_SPIN_Y = -0.45; // rad/s idle planet spin (negative = reverse)
const AXIAL_TILT = THREE.MathUtils.degToRad(18);
const DRAG_SENS = 0.0075;
const _v = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _ndc = new THREE.Vector2();
const _raycaster = new THREE.Raycaster();

/** True only if this object and every ancestor would render. */
function isEffectivelyVisible(obj: THREE.Object3D): boolean {
  let p: THREE.Object3D | null = obj;
  while (p) {
    if (!p.visible) return false;
    p = p.parent;
  }
  return true;
}

function materialCanDraw(mat: THREE.Material): boolean {
  if (!mat.visible) return false;
  if ('opacity' in mat && typeof (mat as THREE.MeshBasicMaterial).opacity === 'number') {
    if ((mat as THREE.MeshBasicMaterial).opacity <= 1e-4) return false;
  }
  return true;
}

function meshCanDraw(mesh: THREE.Mesh): boolean {
  if (!isEffectivelyVisible(mesh)) return false;
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  return mats.some(materialCanDraw);
}

type VertSnap = {
  mesh: THREE.Mesh;
  restWorld: Float32Array;
  targets: Float32Array;
  positions: THREE.BufferAttribute;
  normals: THREE.BufferAttribute | null;
  /** Cloned mats so we can fade without touching the live ghoul. */
  materials: THREE.Material[];
};

export type GhoulballMaterialParams = {
  metalness: number;
  roughness: number;
  clearcoat: number;
  clearcoatRoughness: number;
  envMapIntensity: number;
  reflectivity: number;
  /** -1..1 UV twirl (negative reverses). Intro animates toward this; other mat tweaks never change it. */
  swirl: number;
};

export const DEFAULT_GHOULBALL_MATERIAL: GhoulballMaterialParams = {
  metalness: 0,
  roughness: 0.75,
  clearcoat: 1,
  clearcoatRoughness: 0.1,
  envMapIntensity: 1.2,
  reflectivity: 1,
  swirl: 0,
};

/**
 * Bake posed ghoul meshes (kept separate — never merged), pull every vertex
 * toward an evenly mapped sphere vertex, then reveal the reference sphere.
 * Original skinned meshes are not mutated.
 */
export class GhoulballController {
  private phase: 'idle' | 'wrapping' | 'ball' = 'idle';
  private elapsed = 0;
  private centerWorld = new THREE.Vector3();
  private radius = 0.45;
  private ball: THREE.Mesh | null = null;
  private ballMat: THREE.MeshPhysicalMaterial | null = null;
  private swirlUniforms: { uSwirl: { value: number }; uSpin: { value: number } } | null = null;
  /** Last pushed shader swirl (survives material recompiles). */
  private swirlU = 0;
  private swirlSpinU = 0;
  private ballTex: THREE.Texture | null = null;
  private matParams: GhoulballMaterialParams = { ...DEFAULT_GHOULBALL_MATERIAL };
  private refUrl = '';
  private root: THREE.Object3D | null = null;
  private scene: THREE.Scene | null = null;
  private snaps: VertSnap[] = [];
  private bakeRoot: THREE.Group | null = null;
  private hiddenSources: THREE.Object3D[] = [];
  private extrasHidden: THREE.Object3D[] = [];
  /** Packed xyz of sphere morph-target vertices (world). */
  private sphereVerts = new Float32Array(0);
  private cx = 0;
  private cy = 0;
  private cz = 0;

  private camera: THREE.Camera | null = null;
  private dom: HTMLElement | null = null;
  private orbit: { enabled: boolean } | null = null;
  private dragging = false;
  private lastPtrX = 0;
  private lastPtrY = 0;
  /** Euler degrees (order XYZ). Kept when the mesh is missing so API calls stick. */
  private rotX = 0;
  private rotY = 0;
  private rotZ = THREE.MathUtils.radToDeg(AXIAL_TILT);
  /** Steady spin around local axes (rad/s). */
  private spinX = 0;
  private spinY = AUTO_SPIN_Y;
  private spinZ = 0;
  /** Pause applying spin while Rot sliders are being dragged (speeds kept). */
  private spinPaused = false;
  private boundDown = (e: PointerEvent): void => this.onPointerDown(e);
  private boundMove = (e: PointerEvent): void => this.onPointerMove(e);
  private boundUp = (e: PointerEvent): void => this.onPointerUp(e);

  /** Ball Euler rotation in degrees (order XYZ). */
  getRotation(): { x: number; y: number; z: number } {
    if (this.ball) {
      this.ball.rotation.reorder('XYZ');
      this.rotX = THREE.MathUtils.radToDeg(this.ball.rotation.x);
      this.rotY = THREE.MathUtils.radToDeg(this.ball.rotation.y);
      this.rotZ = THREE.MathUtils.radToDeg(this.ball.rotation.z);
    }
    return { x: this.rotX, y: this.rotY, z: this.rotZ };
  }

  setRotation(partial: Partial<{ x: number; y: number; z: number }>): void {
    if (partial.x != null) this.rotX = partial.x;
    if (partial.y != null) this.rotY = partial.y;
    if (partial.z != null) this.rotZ = partial.z;
    if (!this.ball) return;
    this.ball.rotation.reorder('XYZ');
    this.ball.rotation.x = THREE.MathUtils.degToRad(this.rotX);
    this.ball.rotation.y = THREE.MathUtils.degToRad(this.rotY);
    this.ball.rotation.z = THREE.MathUtils.degToRad(this.rotZ);
  }

  /** Spin speeds in rad/s on local X / Y / Z. */
  getSpin(): { x: number; y: number; z: number } {
    return { x: this.spinX, y: this.spinY, z: this.spinZ };
  }

  setSpin(partial: Partial<{ x: number; y: number; z: number }>): void {
    if (partial.x != null) this.spinX = THREE.MathUtils.clamp(partial.x, -4.5, 4.5);
    if (partial.y != null) this.spinY = THREE.MathUtils.clamp(partial.y, -4.5, 4.5);
    if (partial.z != null) this.spinZ = THREE.MathUtils.clamp(partial.z, -4.5, 4.5);
  }

  setSpinPaused(paused: boolean): void {
    this.spinPaused = paused;
  }

  resetRotation(): void {
    this.spinPaused = false;
    this.spinX = 0;
    this.spinY = AUTO_SPIN_Y;
    this.spinZ = 0;
    this.rotX = 0;
    this.rotY = 0;
    this.rotZ = THREE.MathUtils.radToDeg(AXIAL_TILT);
    if (this.ball) {
      this.ball.rotation.reorder('XYZ');
      this.ball.rotation.set(0, 0, AXIAL_TILT);
    }
  }

  getMaterialParams(): GhoulballMaterialParams {
    return { ...this.matParams };
  }

  setMaterialParams(partial: Partial<GhoulballMaterialParams>): void {
    const next = { ...partial };
    if (next.swirl !== undefined) {
      next.swirl = THREE.MathUtils.clamp(next.swirl, -1, 1);
    }
    const swirlChanged = next.swirl !== undefined && next.swirl !== this.matParams.swirl;
    this.matParams = { ...this.matParams, ...next };
    this.applyMaterialParams();
    // Only touch swirl when the swirl control itself moved — never on other mat tweaks.
    if (swirlChanged) this.applyUserSwirl();
  }

  private applyMaterialParams(): void {
    const mat = this.ballMat;
    if (!mat) return;
    const p = this.matParams;
    mat.metalness = p.metalness;
    mat.roughness = p.roughness;
    mat.clearcoat = p.clearcoat;
    mat.clearcoatRoughness = p.clearcoatRoughness;
    mat.envMapIntensity = p.envMapIntensity;
    mat.reflectivity = p.reflectivity;
    // Do not set needsUpdate — that recompiles the program and used to reset swirl.
  }

  get active(): boolean {
    return this.phase !== 'idle';
  }

  get frozen(): boolean {
    return this.phase === 'wrapping' || this.phase === 'ball';
  }

  /** True while pointer-dragging the ball (not camera orbit). */
  get isDragging(): boolean {
    return this.dragging;
  }

  /** World-space center the ball sits on. */
  get center(): THREE.Vector3 {
    return this.centerWorld;
  }

  /** Wire camera + canvas once (orbit disabled while dragging the ball). */
  attachInput(camera: THREE.Camera, dom: HTMLElement, orbit: { enabled: boolean }): void {
    this.detachInput();
    this.camera = camera;
    this.dom = dom;
    this.orbit = orbit;
    dom.addEventListener('pointerdown', this.boundDown, true);
    window.addEventListener('pointermove', this.boundMove);
    window.addEventListener('pointerup', this.boundUp);
    window.addEventListener('pointercancel', this.boundUp);
  }

  detachInput(): void {
    this.endDrag();
    if (this.dom) {
      this.dom.removeEventListener('pointerdown', this.boundDown, true);
    }
    window.removeEventListener('pointermove', this.boundMove);
    window.removeEventListener('pointerup', this.boundUp);
    window.removeEventListener('pointercancel', this.boundUp);
    this.dom = null;
    this.camera = null;
    this.orbit = null;
  }

  start(
    root: THREE.Object3D,
    scene: THREE.Scene,
    refImageUrl: string,
    extras: THREE.Object3D[] = [],
  ): void {
    this.stop(root, true);
    this.root = root;
    this.scene = scene;
    this.refUrl = refImageUrl;
    this.elapsed = 0;

    root.visible = true;
    root.updateWorldMatrix(true, true);

    let box = box3BodyOnly(root);
    if (box.isEmpty()) box = box3Visible(root);
    const sizeY = box.isEmpty() ? 1.6 : box.max.y - box.min.y;
    this.radius = Math.max(0.35, Math.min(sizeY * 0.28, 0.7));

    const hips =
      root.getObjectByName('mixamorig:Hips') ??
      root.getObjectByName('mixamorigHips') ??
      root.getObjectByName('Hips');
    if (hips) {
      hips.getWorldPosition(this.centerWorld);
    } else if (!box.isEmpty()) {
      box.getCenter(this.centerWorld);
    } else {
      this.centerWorld.set(0, 0.9, 0);
    }
    this.cx = this.centerWorld.x;
    this.cy = this.centerWorld.y;
    this.cz = this.centerWorld.z;

    this.extrasHidden = [];
    for (const o of extras) {
      if (!o.visible) continue;
      o.visible = false;
      this.extrasHidden.push(o);
    }

    this.buildSphereTargets();
    this.phase = 'wrapping';
    this.createBall(scene, this.refUrl);
    this.setSwirlFromEase(0);
    this.bakeAndBind(root, scene);

    if (this.ball) {
      this.ball.scale.setScalar(0.001);
      this.ball.visible = true;
    }
  }

  private applyIdleSpin(step: number): void {
    if (!this.ball || this.dragging || this.spinPaused) return;
    if (this.spinX) this.ball.rotateX(this.spinX * step);
    if (this.spinY) this.ball.rotateY(this.spinY * step);
    if (this.spinZ) this.ball.rotateZ(this.spinZ * step);
  }

  update(dt: number): void {
    const step = Math.min(dt, 0.05);

    if (this.phase === 'wrapping') {
      this.elapsed += step;
      const t = Math.min(1, this.elapsed / WRAP_DURATION);
      const ease = t * t * (3 - 2 * t);
      this.applyWrap(ease);
      if (this.ball) {
        this.ball.scale.setScalar(Math.max(0.001, ease));
        this.ball.position.copy(this.centerWorld);
        this.applyIdleSpin(step);
      }
      this.setSwirlFromEase(ease);
      if (t >= 1) this.finishToBall();
      return;
    }

    if (this.phase === 'ball' && this.ball) {
      this.ball.position.copy(this.centerWorld);
      this.applyIdleSpin(step);
    }
  }

  stop(root?: THREE.Object3D | null, _restore = true): void {
    this.endDrag();
    const r = root ?? this.root;
    this.clearBake();
    for (const o of this.hiddenSources) o.visible = true;
    this.hiddenSources = [];
    for (const o of this.extrasHidden) o.visible = true;
    this.extrasHidden = [];
    if (r) r.visible = true;
    this.removeBall();
    this.snaps = [];
    this.sphereVerts = new Float32Array(0);
    this.phase = 'idle';
    this.elapsed = 0;
    this.rotX = 0;
    this.rotY = 0;
    this.rotZ = THREE.MathUtils.radToDeg(AXIAL_TILT);
    this.spinX = 0;
    this.spinY = AUTO_SPIN_Y;
    this.spinZ = 0;
    this.spinPaused = false;
    this.root = null;
    this.scene = null;
  }

  dispose(): void {
    this.stop(this.root, true);
  }

  private buildSphereTargets(): void {
    const geo = new THREE.SphereGeometry(this.radius, SPHERE_WIDTH, SPHERE_HEIGHT);
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const out = new Float32Array(pos.count * 3);
    const cx = this.cx;
    const cy = this.cy;
    const cz = this.cz;
    for (let i = 0; i < pos.count; i++) {
      const o = i * 3;
      out[o] = cx + pos.getX(i);
      out[o + 1] = cy + pos.getY(i);
      out[o + 2] = cz + pos.getZ(i);
    }
    geo.dispose();
    this.sphereVerts = out;
  }

  /**
   * O(1) map from direction → SphereGeometry vertex index
   * (same layout as three's UV sphere: iy major, ix minor).
   */
  private sphereIndexFromDir(dx: number, dy: number, dz: number): number {
    const len = Math.hypot(dx, dy, dz) || 1;
    const nx = dx / len;
    const ny = dy / len;
    const nz = dz / len;
    const phi = Math.acos(ny < -1 ? -1 : ny > 1 ? 1 : ny);
    let u = Math.atan2(nx, nz) / (Math.PI * 2);
    if (u < 0) u += 1;
    const v = phi / Math.PI;
    const iy = Math.round(v * SPHERE_HEIGHT);
    let ix = Math.round(u * SPHERE_WIDTH);
    if (ix === SPHERE_WIDTH) ix = 0;
    return iy * (SPHERE_WIDTH + 1) + ix;
  }

  /** Pull each vert toward a sphere vertex (even angular coverage, O(n)). */
  private assignTargets(restWorld: Float32Array): Float32Array {
    const targets = new Float32Array(restWorld.length);
    const sphere = this.sphereVerts;
    const nSphere = sphere.length / 3;
    const cx = this.cx;
    const cy = this.cy;
    const cz = this.cz;
    const nVert = restWorld.length / 3;

    for (let i = 0; i < nVert; i++) {
      const o = i * 3;
      let si = this.sphereIndexFromDir(
        restWorld[o]! - cx,
        restWorld[o + 1]! - cy,
        restWorld[o + 2]! - cz,
      );
      if (si < 0) si = 0;
      if (si >= nSphere) si = nSphere - 1;
      const so = si * 3;
      targets[o] = sphere[so]!;
      targets[o + 1] = sphere[so + 1]!;
      targets[o + 2] = sphere[so + 2]!;
    }
    return targets;
  }

  private bakeAndBind(root: THREE.Object3D, scene: THREE.Scene): void {
    this.clearBake();
    this.bakeRoot = new THREE.Group();
    this.bakeRoot.name = 'GhoulballBake';
    scene.add(this.bakeRoot);
    this.snaps = [];
    this.hiddenSources = [];

    root.updateWorldMatrix(true, true);
    // Parented Head/Halo inherit bone scale; crush any leftover Unity bind scale
    // so localToWorld bake matches the skinned body.
    root.traverse((o) => {
      const n = o.name;
      if (n !== 'mixamorig:Hips' && n !== 'mixamorigHips' && n !== 'Hips') return;
      o.scale.set(1, 1, 1);
    });
    root.updateWorldMatrix(true, true);

    root.traverse((o) => {
      if ((o as THREE.Points).isPoints) return;
      const src = o as THREE.Mesh;
      if (!src.isMesh || !src.geometry) return;
      if (src.name.startsWith('Magica ')) return;
      // Only parts that are actually on screen for this ghoul's traits.
      if (!meshCanDraw(src)) return;

      const geom = src.geometry;
      const posAttr = geom.getAttribute('position') as THREE.BufferAttribute | undefined;
      if (!posAttr || posAttr.count < 1) return;

      const skinned = (src as THREE.SkinnedMesh).isSkinnedMesh
        ? (src as THREE.SkinnedMesh)
        : null;
      if (skinned) skinned.skeleton?.update();

      const count = posAttr.count;
      const restWorld = new Float32Array(count * 3);
      const bakedPos = new Float32Array(count * 3);
      const bakedNrm = new Float32Array(count * 3);
      const cx = this.cx;
      const cy = this.cy;
      const cz = this.cz;

      for (let i = 0; i < count; i++) {
        if (skinned) {
          skinned.getVertexPosition(i, _v);
          skinned.localToWorld(_v);
        } else {
          _v.fromBufferAttribute(posAttr, i);
          src.localToWorld(_v);
        }
        const o = i * 3;
        restWorld[o] = bakedPos[o] = _v.x;
        restWorld[o + 1] = bakedPos[o + 1] = _v.y;
        restWorld[o + 2] = bakedPos[o + 2] = _v.z;
        // Cheap radial normals (no computeVertexNormals).
        let nx = _v.x - cx;
        let ny = _v.y - cy;
        let nz = _v.z - cz;
        const nl = Math.hypot(nx, ny, nz) || 1;
        bakedNrm[o] = nx / nl;
        bakedNrm[o + 1] = ny / nl;
        bakedNrm[o + 2] = nz / nl;
      }

      const bakeGeom = new THREE.BufferGeometry();
      const posBuf = new THREE.BufferAttribute(bakedPos, 3);
      posBuf.setUsage(THREE.DynamicDrawUsage);
      const nrmBuf = new THREE.BufferAttribute(bakedNrm, 3);
      nrmBuf.setUsage(THREE.DynamicDrawUsage);
      bakeGeom.setAttribute('position', posBuf);
      bakeGeom.setAttribute('normal', nrmBuf);
      if (geom.index) bakeGeom.setIndex(geom.index.clone());
      const uv = geom.getAttribute('uv');
      if (uv) bakeGeom.setAttribute('uv', uv.clone());

      // Clone mats so opacity fade doesn't leak onto the live ghoul.
      const srcMats = Array.isArray(src.material) ? src.material : [src.material];
      const materials = srcMats.map((m) => {
        const c = m.clone();
        c.transparent = true;
        c.depthWrite = true;
        c.opacity = 1;
        c.needsUpdate = true;
        return c;
      });
      const bakeMesh = new THREE.Mesh(
        bakeGeom,
        materials.length === 1 ? materials[0]! : materials,
      );
      bakeMesh.name = `Bake_${src.name}`;
      bakeMesh.frustumCulled = false;
      this.bakeRoot!.add(bakeMesh);

      this.snaps.push({
        mesh: bakeMesh,
        restWorld,
        targets: this.assignTargets(restWorld),
        positions: posBuf,
        normals: nrmBuf,
        materials,
      });

      src.visible = false;
      this.hiddenSources.push(src);
    });

    root.visible = false;
  }

  private applyWrap(ease: number): void {
    const cx = this.cx;
    const cy = this.cy;
    const cz = this.cz;
    const inv = 1 - ease;
    // Fade the ghoul out as it collapses into the ball.
    const opacity = Math.max(0, 1 - ease);

    for (const snap of this.snaps) {
      const arr = snap.positions.array as Float32Array;
      const nrm = snap.normals?.array as Float32Array | undefined;
      const rest = snap.restWorld;
      const tgt = snap.targets;
      const n = rest.length;

      for (let i = 0; i < n; i += 3) {
        const x = rest[i]! * inv + tgt[i]! * ease;
        const y = rest[i + 1]! * inv + tgt[i + 1]! * ease;
        const z = rest[i + 2]! * inv + tgt[i + 2]! * ease;
        arr[i] = x;
        arr[i + 1] = y;
        arr[i + 2] = z;
        if (nrm) {
          let nx = x - cx;
          let ny = y - cy;
          let nz = z - cz;
          const nl = Math.hypot(nx, ny, nz) || 1;
          nrm[i] = nx / nl;
          nrm[i + 1] = ny / nl;
          nrm[i + 2] = nz / nl;
        }
      }
      snap.positions.needsUpdate = true;
      if (snap.normals) snap.normals.needsUpdate = true;

      for (const mat of snap.materials) {
        mat.opacity = opacity;
        mat.transparent = true;
        mat.depthWrite = opacity > 0.2;
      }
    }
  }

  private finishToBall(): void {
    // Unhide source meshes before dropping the bake; root stays hidden for the ball.
    for (const o of this.hiddenSources) o.visible = true;
    this.hiddenSources = [];
    this.clearBake();
    if (this.ball) {
      this.ball.scale.setScalar(1);
      this.ball.position.copy(this.centerWorld);
      this.ball.visible = true;
    } else if (this.scene) {
      this.createBall(this.scene, this.refUrl);
    }
    this.applyUserSwirl();
    if (this.root) this.root.visible = false;
    this.phase = 'ball';
  }

  private onPointerDown(e: PointerEvent): void {
    if (this.phase !== 'ball' || !this.ball || !this.camera || !this.dom) return;
    if (e.button !== 0) return;
    const rect = this.dom.getBoundingClientRect();
    _ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    _ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    _raycaster.setFromCamera(_ndc, this.camera);
    const hits = _raycaster.intersectObject(this.ball, false);
    if (!hits.length) return;
    this.dragging = true;
    this.lastPtrX = e.clientX;
    this.lastPtrY = e.clientY;
    if (this.orbit) this.orbit.enabled = false;
    this.dom.setPointerCapture?.(e.pointerId);
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  private onPointerMove(e: PointerEvent): void {
    if (!this.dragging || !this.ball) return;
    const dx = e.clientX - this.lastPtrX;
    const dy = e.clientY - this.lastPtrY;
    this.lastPtrX = e.clientX;
    this.lastPtrY = e.clientY;

    this.ball.rotateY(dx * DRAG_SENS);
    if (this.camera) {
      this.camera.getWorldDirection(_v);
      _right.crossVectors(_up, _v).normalize();
      if (_right.lengthSq() > 1e-6) {
        this.ball.rotateOnWorldAxis(_right, dy * DRAG_SENS);
      }
    }
    e.preventDefault();
  }

  private onPointerUp(e: PointerEvent): void {
    if (!this.dragging) return;
    this.endDrag();
    try {
      this.dom?.releasePointerCapture?.(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  private endDrag(): void {
    if (!this.dragging) return;
    this.dragging = false;
    if (this.orbit) this.orbit.enabled = true;
  }

  private writeSwirlUniforms(): void {
    if (!this.swirlUniforms) return;
    this.swirlUniforms.uSwirl.value = this.swirlU;
    this.swirlUniforms.uSpin.value = this.swirlSpinU;
  }

  /** Intro: ease 0 = full swirl → ease 1 = matParams.swirl (usually 0). */
  private setSwirlFromEase(ease: number): void {
    const remain = 1 - ease;
    const target = THREE.MathUtils.clamp(this.matParams.swirl, -1, 1);
    const amount = target + (1 - target) * remain;
    if (Math.abs(amount) <= 1e-4) {
      this.swirlU = 0;
      this.swirlSpinU = 0;
    } else {
      const twist = Math.sign(amount) * amount * amount * Math.PI * 6;
      const spin = this.elapsed * 5.5 * remain;
      this.swirlU = twist + spin;
      this.swirlSpinU = spin * 0.35;
    }
    this.writeSwirlUniforms();
  }

  /** Static swirl from the Twirl slider (no time-based spin). */
  private applyUserSwirl(): void {
    const amount = THREE.MathUtils.clamp(this.matParams.swirl, -1, 1);
    if (Math.abs(amount) <= 1e-4) {
      this.swirlU = 0;
      this.swirlSpinU = 0;
    } else {
      this.swirlU = Math.sign(amount) * amount * amount * Math.PI * 6;
      this.swirlSpinU = 0;
    }
    this.writeSwirlUniforms();
  }

  private clearBake(): void {
    if (!this.bakeRoot) return;
    this.bakeRoot.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
    });
    for (const snap of this.snaps) {
      for (const mat of snap.materials) mat.dispose();
    }
    this.bakeRoot.removeFromParent();
    this.bakeRoot = null;
    this.snaps = [];
  }

  private createBall(scene: THREE.Scene, url: string): void {
    this.removeBall();

    const mat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      metalness: this.matParams.metalness,
      roughness: this.matParams.roughness,
      clearcoat: this.matParams.clearcoat,
      clearcoatRoughness: this.matParams.clearcoatRoughness,
      reflectivity: this.matParams.reflectivity,
      envMapIntensity: this.matParams.envMapIntensity,
      fog: false,
      toneMapped: true,
    });

    // Keep UV swirl during wrap, but light the ball with the scene lights.
    mat.onBeforeCompile = (shader) => {
      // Seed from last known swirl so map/needsUpdate recompiles don't snap to full swirl.
      shader.uniforms.uSwirl = { value: this.swirlU };
      shader.uniforms.uSpin = { value: this.swirlSpinU };
      this.swirlUniforms = {
        uSwirl: shader.uniforms.uSwirl as { value: number },
        uSpin: shader.uniforms.uSpin as { value: number },
      };
      shader.fragmentShader = shader.fragmentShader
        .replace(
          'void main() {',
          /* glsl */ `
          uniform float uSwirl;
          uniform float uSpin;
          vec2 ghoulballSwirlUv(vec2 uv, float amount, float spin) {
            vec2 p = uv - 0.5;
            float r = length(p);
            float falloff = smoothstep(0.72, 0.0, r);
            float delta = amount * falloff + spin;
            if (abs(delta) < 1e-6) return uv;
            float c = cos(delta);
            float s = sin(delta);
            p = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
            return p + 0.5;
          }
          void main() {
          `,
        )
        .replace(
          '#include <map_fragment>',
          /* glsl */ `
          #ifdef USE_MAP
            vec4 sampledDiffuseColor = texture2D( map, ghoulballSwirlUv( vMapUv, uSwirl, uSpin ) );
            diffuseColor *= sampledDiffuseColor;
          #endif
          `,
        );
    };
    mat.customProgramCacheKey = () => 'ghoulball-physical-swirl-v1';
    this.ballMat = mat;

    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(this.radius, SPHERE_WIDTH, SPHERE_HEIGHT),
      mat,
    );
    mesh.name = 'Ghoulball';
    mesh.position.copy(this.centerWorld);
    mesh.rotation.reorder('XYZ');
    mesh.rotation.set(
      THREE.MathUtils.degToRad(this.rotX),
      THREE.MathUtils.degToRad(this.rotY),
      THREE.MathUtils.degToRad(this.rotZ),
    );
    mesh.frustumCulled = false;
    mesh.renderOrder = 20;
    scene.add(mesh);
    this.ball = mesh;
    // First compile may not have run yet; intro will drive swirl each frame.
    if (this.phase === 'wrapping') this.setSwirlFromEase(Math.min(1, this.elapsed / WRAP_DURATION));
    else this.applyUserSwirl();

    if (!url) {
      mat.color.setHex(0xff44aa);
      return;
    }

    new THREE.TextureLoader().load(
      url,
      (tex) => {
        if (this.ball !== mesh) {
          tex.dispose();
          return;
        }
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = THREE.ClampToEdgeWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.flipY = true;
        tex.needsUpdate = true;
        this.ballTex = tex;
        mat.map = tex;
        mat.needsUpdate = true;
      },
      undefined,
      () => {
        mat.color.setHex(0xff44aa);
        console.warn('[ghoulball] failed to load reference texture', url);
      },
    );
  }

  private removeBall(): void {
    if (this.ball) {
      this.ball.removeFromParent();
      this.ball.geometry.dispose();
      (this.ball.material as THREE.Material).dispose();
      this.ball = null;
    }
    this.ballMat = null;
    this.swirlUniforms = null;
    if (this.ballTex) {
      this.ballTex.dispose();
      this.ballTex = null;
    }
  }
}
