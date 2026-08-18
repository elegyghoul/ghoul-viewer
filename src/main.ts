import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createAssembler, loadGhoul, loadTraitData } from './loadGhoul';
import { GhoulAnimator, type AnimName } from './animations';
import type { GhoulAssembler, EditableMaterial, MaterialSaveTarget } from './assembleGhoul';
import type { GhoulTraits } from './types';
import {
  DISPLAY_SIZE,
  DitherComposer,
  PIXEL_SIZE,
  loadCalmPalette,
  type BloomMode,
} from './dither';
import { CloakClothManager, DEFAULT_CLOTH_PARAMS } from './cloth';
import { CigSmokeManager } from './cigSmoke';
import { CudiParticleManager } from './cudiParticles';
import { GhoulballController, DEFAULT_GHOULBALL_MATERIAL, GHOULBALL_WRAP_DURATION, type GhoulballMaterialParams } from './ghoulball';
import { PlayController, DEFAULT_PLAY_PARAMS, type PlayCameraMode, type FollowCamParams } from './playMode';
import { BackgroundSceneManager, SKYBOX_CLIP_FAR } from './backgroundScene';
import {
  backgroundCloudColor,
  backgroundDirLight,
  backgroundFog,
  backgroundGradient,
  backgroundHasClouds,
  backgroundOceanMat,
  backgroundRipple,
  cssToHex,
  enableBloomLayer,
  hexToCss,
  DEFAULT_DIR_LIGHT,
  DEFAULT_GRADIENT_DISTANCE,
  DEFAULT_OCEAN_MAT,
  type BackgroundDirLight,
  type BackgroundFog,
  type BackgroundGradient,
  type BackgroundOceanMat,
  type BackgroundRipple,
} from './materials';

/** Studio controls, or a detached dummy so embed pages need no chrome. */
function q<T extends HTMLElement>(sel: string): T {
  return (document.querySelector(sel) as T | null) ?? (document.createElement('div') as unknown as T);
}

export type { FollowCamParams } from './playMode';
export type BgMode = 'grid' | 'trait' | 'ghoulball';
export type AppMode = 'view' | 'play';

export type LightLevels = {
  master: number;
  ambient: number;
  hemi: number;
  key: number;
  fill: number;
  /** Directional sun intensity (not scaled by Master). */
  sun: number;
  /** Degrees around Y; 0 = from +Z, 90 = from +X. */
  sunAzimuth: number;
  /** Degrees above horizon; 90 = overhead. */
  sunElevation: number;
};

export type Vec3 = { x: number; y: number; z: number };

/** Orbit camera. Rotation is degrees, Euler order YXZ (pitch / yaw / roll). */
export type ViewLevels = {
  zoom: number;
  position: Vec3;
  rotation: Vec3;
};

export type ViewPatch = {
  zoom?: number;
  position?: Partial<Vec3>;
  rotation?: Partial<Vec3>;
};

export type BloomLevels = {
  mode: BloomMode;
  strength: number;
  radius: number;
  threshold: number;
};

export type GhoulViewerOptions = {
  id?: number;
  /** Write `?id=` into the page URL. Studio default true; embed default false. */
  updateUrl?: boolean;
  mode?: AppMode;
  camera?: PlayCameraMode;
  background?: BgMode;
  lights?: Partial<LightLevels>;
  view?: ViewPatch;
  bloom?: Partial<BloomLevels>;
  anim?: AnimName;
  onLoad?: (id: number) => void;
};

export type GhoulViewer = {
  ready: Promise<void>;
  load(id: number): void;
  getId(): number;
  setLights(levels: Partial<LightLevels>): void;
  getLights(): LightLevels;
  resetLights(): void;
  setView(levels: ViewPatch): void;
  getView(): ViewLevels;
  resetView(): void;
  setBloom(levels: Partial<BloomLevels>): void;
  getBloom(): BloomLevels;
  resetBloom(): void;
  setMode(mode: AppMode): void;
  getMode(): AppMode;
  setCamera(mode: PlayCameraMode): void;
  getCamera(): PlayCameraMode;
  setFollow(levels: Partial<FollowCamParams>): void;
  getFollow(): FollowCamParams;
  resetFollow(): void;
  setBackground(mode: BgMode): void;
  getBackground(): BgMode;
  setAnim(name: AnimName): void;
  getAnim(): AnimName;
  reset(): void;
};

const canvas =
  document.querySelector<HTMLCanvasElement>('#c') ?? document.createElement('canvas');

let renderer: THREE.WebGLRenderer | null = null;
let controls: OrbitControls | null = null;

function attachEngine(): void {
  if (renderer) return;
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false });
  renderer.setPixelRatio(1);
  renderer.setSize(PIXEL_SIZE, PIXEL_SIZE, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.BasicShadowMap;
  renderer.shadowMap.autoUpdate = false;
  controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 1.0, 0);
  controls.enableDamping = true;
  controls.minDistance = 1;
  controls.maxDistance = 10;
  controls.maxPolarAngle = Math.PI / 2;
  controls.addEventListener('change', syncCamUiFromCamera);
  controls.update();
  animate();
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);

const camera = new THREE.PerspectiveCamera(35, 1, 0.05, SKYBOX_CLIP_FAR);
camera.position.set(0, 1.1, 2.8);
const _camOff = new THREE.Vector3();
const _camSph = new THREE.Spherical();
const _camFwd = new THREE.Vector3();

/** World floor plane. Camera stays this far above it (also > near clip). */
const FLOOR_Y = 0;
const CAMERA_FLOOR_CLEARANCE = 0.12;

function cameraFloorMinY(): number {
  return FLOOR_Y + CAMERA_FLOOR_CLEARANCE;
}

/** Limit orbit so the spherical perch cannot swing under the floor. */
function constrainOrbitToFloor(): void {
  if (!controls) return;
  const minY = cameraFloorMinY();
  if (controls.target.y < FLOOR_Y) controls.target.y = FLOOR_Y;
  const r = Math.max(controls.getDistance(), 0.001);
  const cosPhi = THREE.MathUtils.clamp((minY - controls.target.y) / r, -1, 1);
  controls.maxPolarAngle = Math.acos(cosPhi);
}

function clampCameraToFloor(): void {
  const minY = cameraFloorMinY();
  if (camera.position.y < minY) camera.position.y = minY;
}

const DEFAULT_LIGHT_MASTER = 1;

const ambient = new THREE.AmbientLight(0xffffff, 1.0);
const hemi = new THREE.HemisphereLight(0xffffff, 0x556677, 0.8);
const key = new THREE.PointLight(0xffffff, 1.4, 12, 2);
const fill = new THREE.PointLight(0xfff0e0, 0.7, 12, 2);
/** Local offsets from the ghoul root — lights track the character as it walks. */
const KEY_LIGHT_OFFSET = new THREE.Vector3(1.2, 2.0, 2.4);
const FILL_LIGHT_OFFSET = new THREE.Vector3(-1.6, 1.6, -1.4);
const HEMI_LIGHT_OFFSET = new THREE.Vector3(0, 2.0, 0);
key.position.copy(KEY_LIGHT_OFFSET);
fill.position.copy(FILL_LIGHT_OFFSET);
hemi.position.copy(HEMI_LIGHT_OFFSET);
const dirLight = new THREE.DirectionalLight(0xfff2d0, 0);
dirLight.name = 'TraitSun';
dirLight.position.set(4, 8, 6);
dirLight.target.position.set(0, 1, 0);
dirLight.castShadow = true;
dirLight.shadow.mapSize.set(512, 512);
dirLight.shadow.bias = -0.003;
dirLight.shadow.normalBias = 0.04;
dirLight.shadow.camera.near = 0.5;
dirLight.shadow.camera.far = 28;
dirLight.shadow.camera.left = -6;
dirLight.shadow.camera.right = 6;
dirLight.shadow.camera.top = 6;
dirLight.shadow.camera.bottom = -6;
dirLight.shadow.camera.updateProjectionMatrix();
scene.add(ambient, hemi, key, fill, dirLight, dirLight.target);

const dirLightHelper = new THREE.DirectionalLightHelper(dirLight, 1.2, 0xffe08a);
const lightHelpers: THREE.Object3D[] = [
  new THREE.HemisphereLightHelper(hemi, 0.6, 0x88aacc),
  new THREE.PointLightHelper(key, 0.2, 0xffffff),
  new THREE.PointLightHelper(fill, 0.2, 0xffe0b0),
  dirLightHelper,
];
let lightDebugVisible = false;

function setLightDebugVisible(show: boolean): void {
  lightDebugVisible = show;
  for (const helper of lightHelpers) {
    if (show) {
      if (!helper.parent) scene.add(helper);
      helper.visible = true;
    } else {
      helper.visible = false;
      helper.removeFromParent();
    }
  }
}

function updateLightHelpers(): void {
  if (!lightDebugVisible) return;
  for (const helper of lightHelpers) {
    const h = helper as THREE.DirectionalLightHelper & { update?: () => void };
    h.update?.();
  }
}

function syncLightsToGhoul(): void {
  if (!assembler) return;
  const p = assembler.root.position;
  key.position.copy(p).add(KEY_LIGHT_OFFSET);
  fill.position.copy(p).add(FILL_LIGHT_OFFSET);
  hemi.position.copy(p).add(HEMI_LIGHT_OFFSET);
  applyTraitDirLight();
}

/** Per-light base intensities (before Master scale). */
const LIGHT_BASE = {
  ambient: 0,
  hemi: 0.74,
  key: 10.4,
  fill: 3.82,
};

const DEFAULT_SUN = {
  sun: 1.35,
  sunAzimuth: 35,
  sunElevation: 48,
};

const GHOULBALL_LIGHTS: LightLevels = {
  master: 5,
  ambient: 0,
  hemi: 1.5,
  key: 0,
  fill: 0,
  ...DEFAULT_SUN,
};

type LightMix = LightLevels;

let lightMix: LightLevels = {
  master: DEFAULT_LIGHT_MASTER,
  ambient: LIGHT_BASE.ambient,
  hemi: LIGHT_BASE.hemi,
  key: LIGHT_BASE.key,
  fill: LIGHT_BASE.fill,
  ...DEFAULT_SUN,
};
/** Lights to restore when leaving Ghoulball. */
let lightsBeforeGhoulball: LightLevels | null = null;

type LightTween = {
  from: LightLevels;
  to: LightLevels;
  elapsed: number;
  duration: number;
};
let lightTween: LightTween | null = null;

function lerpLights(a: LightLevels, b: LightLevels, t: number): LightLevels {
  const u = Math.min(1, Math.max(0, t));
  return {
    master: a.master + (b.master - a.master) * u,
    ambient: a.ambient + (b.ambient - a.ambient) * u,
    hemi: a.hemi + (b.hemi - a.hemi) * u,
    key: a.key + (b.key - a.key) * u,
    fill: a.fill + (b.fill - a.fill) * u,
    sun: a.sun + (b.sun - a.sun) * u,
    sunAzimuth: a.sunAzimuth + (b.sunAzimuth - a.sunAzimuth) * u,
    sunElevation: a.sunElevation + (b.sunElevation - a.sunElevation) * u,
  };
}

/** Same smoothstep ease as the Ghoulball wrap morph. */
function lightTweenEase(t: number): number {
  const u = Math.min(1, Math.max(0, t));
  return u * u * (3 - 2 * u);
}

function startLightTween(to: LightLevels, duration = GHOULBALL_WRAP_DURATION): void {
  lightTween = {
    from: { ...lightMix },
    to: { ...to },
    elapsed: 0,
    duration,
  };
}

function cancelLightTween(): void {
  lightTween = null;
}

function updateLightTween(dt: number): void {
  if (!lightTween) return;
  lightTween.elapsed += dt;
  const t = lightTween.elapsed / lightTween.duration;
  const eased = lightTweenEase(t);
  const next = lerpLights(lightTween.from, lightTween.to, eased);
  lightMix = next;
  if (lightMasterInput instanceof HTMLInputElement) {
    lightMasterInput.value = String(next.master);
    lightAmbientInput.value = String(next.ambient);
    lightHemiInput.value = String(next.hemi);
    lightKeyInput.value = String(next.key);
    lightFillInput.value = String(next.fill);
    lightSunInput.value = String(next.sun);
    lightSunAzimuthInput.value = String(next.sunAzimuth);
    lightSunElevationInput.value = String(next.sunElevation);
  }
  applyLights(next);
  if (lightMasterVal.isConnected) lightMasterVal.textContent = next.master.toFixed(2);
  if (lightAmbientVal.isConnected) lightAmbientVal.textContent = next.ambient.toFixed(2);
  if (lightHemiVal.isConnected) lightHemiVal.textContent = next.hemi.toFixed(2);
  if (lightKeyVal.isConnected) lightKeyVal.textContent = next.key.toFixed(2);
  if (lightFillVal.isConnected) lightFillVal.textContent = next.fill.toFixed(2);
  if (lightSunVal.isConnected) lightSunVal.textContent = next.sun.toFixed(2);
  if (lightSunAzimuthVal.isConnected) lightSunAzimuthVal.textContent = String(Math.round(next.sunAzimuth));
  if (lightSunElevationVal.isConnected) lightSunElevationVal.textContent = String(Math.round(next.sunElevation));
  if (t >= 1) lightTween = null;
}

const MANAGED_LIGHTS = new Set<THREE.Light>([ambient, hemi, key, fill, dirLight]);

/** Remember unlit / emissive bases so we can dim them when lights are off. */
const unlitColorBase = new WeakMap<THREE.MeshBasicMaterial, THREE.Color>();
const emissiveIntensityBase = new WeakMap<THREE.MeshStandardMaterial, number>();
const gridOpacityBase = 0.5;

/**
 * Apply Master × each light’s own level.
 * Also dims MeshBasic (eyes/halos/grid) + emissives — those ignore Three lights,
 * which is why the ghoul stayed visible at “all lights 0”.
 */
function applyLights(mix: LightMix): void {
  const m = Math.max(0, mix.master);
  const a = Math.max(0, mix.ambient) * m;
  const h = Math.max(0, mix.hemi) * m;
  const k = Math.max(0, mix.key) * m;
  const f = Math.max(0, mix.fill) * m;
  ambient.intensity = a;
  hemi.intensity = h;
  key.intensity = k;
  fill.intensity = f;
  if (renderer) renderer.toneMappingExposure = 1;

  // Kill any lights that came in with the GLB / extras.
  scene.traverse((o) => {
    const light = o as THREE.Light;
    if (!light.isLight || MANAGED_LIGHTS.has(light)) return;
    light.intensity = 0;
    light.visible = false;
  });

  // 0 when all contributions are off; ramps up so unlit matches lit brightness roughly.
  const total = a + h + k + f;
  const unlitScale = total <= 1e-5 ? 0 : Math.min(1, total / 0.85);

  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh || (o as THREE.Line).isLine) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of mats) {
        if (!mat) continue;
        if (mat instanceof THREE.MeshBasicMaterial) {
          let base = unlitColorBase.get(mat);
          if (!base) {
            base = mat.color.clone();
            unlitColorBase.set(mat, base);
          }
          mat.color.copy(base).multiplyScalar(unlitScale);
        } else if (
          mat instanceof THREE.MeshStandardMaterial ||
          mat instanceof THREE.MeshPhysicalMaterial
        ) {
          let baseE = emissiveIntensityBase.get(mat);
          if (baseE === undefined) {
            baseE = mat.emissiveIntensity;
            emissiveIntensityBase.set(mat, baseE);
          }
          mat.emissiveIntensity = baseE * unlitScale;
        }
      }
    }
  });

  lastUnlitScale = unlitScale;
  syncGridAndBackground();
}

const grid = new THREE.GridHelper(4, 16, 0xbd8825, 0xbd8825);
const gridMat = grid.material as THREE.Material;
gridMat.transparent = true;
gridMat.opacity = 0.5;
enableBloomLayer(grid);
scene.add(grid);

/** Room cube grid (floor + ceiling + walls) shown while orbiting the camera in Ghoulball. */
const CUBE_GRID_SIZE = 4;
const CUBE_GRID_DIVS = 16;
const CUBE_GRID_COLOR = 0xbd8825;
const CUBE_GRID_OPACITY = 0.5;
const CUBE_GRID_FADE_SEC = 0.5;
const cubeGrid = new THREE.Group();
cubeGrid.name = 'GhoulballCubeGrid';
cubeGrid.visible = false;
let cubeGridWant = 0;
let cubeGridFade = 0;

function styleCubeGridFace(face: THREE.GridHelper): void {
  const mats = Array.isArray(face.material) ? face.material : [face.material];
  for (const m of mats) {
    m.transparent = true;
    m.opacity = 0;
    m.depthWrite = false;
  }
  enableBloomLayer(face);
}

{
  const half = CUBE_GRID_SIZE * 0.5;
  const faces: Array<{ rot: THREE.Euler; pos: THREE.Vector3 }> = [
    { rot: new THREE.Euler(0, 0, 0), pos: new THREE.Vector3(0, -half, 0) },
    { rot: new THREE.Euler(Math.PI, 0, 0), pos: new THREE.Vector3(0, half, 0) },
    { rot: new THREE.Euler(Math.PI / 2, 0, 0), pos: new THREE.Vector3(0, 0, half) },
    { rot: new THREE.Euler(-Math.PI / 2, 0, 0), pos: new THREE.Vector3(0, 0, -half) },
    { rot: new THREE.Euler(0, 0, -Math.PI / 2), pos: new THREE.Vector3(half, 0, 0) },
    { rot: new THREE.Euler(0, 0, Math.PI / 2), pos: new THREE.Vector3(-half, 0, 0) },
  ];
  for (const f of faces) {
    const face = new THREE.GridHelper(CUBE_GRID_SIZE, CUBE_GRID_DIVS, CUBE_GRID_COLOR, CUBE_GRID_COLOR);
    styleCubeGridFace(face);
    face.rotation.copy(f.rot);
    face.position.copy(f.pos);
    cubeGrid.add(face);
  }
  scene.add(cubeGrid);
}

function setCubeGridOpacity(t: number): void {
  const op = CUBE_GRID_OPACITY * THREE.MathUtils.clamp(t, 0, 1);
  cubeGrid.traverse((o) => {
    if (!(o instanceof THREE.GridHelper)) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) m.opacity = op;
  });
  cubeGrid.visible = op > 1e-3;
}

function updateCubeGrid(dt: number): void {
  const want = bgMode === 'ghoulball' ? cubeGridWant : 0;
  if (want === 0 && cubeGridFade <= 1e-3) {
    if (cubeGrid.visible) {
      cubeGridFade = 0;
      setCubeGridOpacity(0);
    }
    return;
  }
  const step = dt / CUBE_GRID_FADE_SEC;
  if (cubeGridFade < want) cubeGridFade = Math.min(want, cubeGridFade + step);
  else if (cubeGridFade > want) cubeGridFade = Math.max(want, cubeGridFade - step);
  if (bgMode === 'ghoulball' && ghoulball.active) {
    const center = ghoulball.center;
    cubeGrid.position.copy(center);
    // Keep every wall outside the camera: half-extent > distance so the near face stays behind.
    const dist = camera.position.distanceTo(center);
    const baseHalf = CUBE_GRID_SIZE * 0.5;
    const half = Math.max(dist * 1.12, baseHalf);
    cubeGrid.scale.setScalar(half / baseHalf);
  }
  setCubeGridOpacity(cubeGridFade);
}

function isOrbitRotating(ctrl: OrbitControls): boolean {
  const st = (ctrl as OrbitControls & { state: number }).state;
  // ROTATE / TOUCH_ROTATE / TOUCH_DOLLY_ROTATE
  return st === 0 || st === 3 || st === 6;
}

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(8, 8),
  new THREE.ShadowMaterial({ opacity: 0.45 }),
);
ground.name = 'ShadowGround';
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.02;
ground.receiveShadow = true;
ground.castShadow = false;
scene.add(ground);

let bgMode: BgMode = 'trait';
let lastSceneBg: 'grid' | 'trait' = 'trait';
let lastUnlitScale = 1;
const GRID_CLEAR = 0x000000;

function liveBackgroundKey(): string | null {
  const name = currentTraits?.background;
  return name && name !== 'None' ? name : null;
}

/** Fog is per Trait BG, or `None` when the ghoul has no background. */
function fogBackgroundKey(): string | null {
  if (!currentTraits) return null;
  return liveBackgroundKey() ?? 'None';
}

/** Session overrides for Trait BG clear gradient (until save / reload). */
const bgGradLive = new Map<string, BackgroundGradient>();
const bgCloudLive = new Map<string, number>();

function gradientFromEditor(key: string): Pick<BackgroundGradient, 'top' | 'bottom'> | null {
  if (selectedTraitKey !== 'background') return null;
  if (currentTraits?.background !== key) return null;
  let top: number | null = null;
  let bottom: number | null = null;
  for (const e of editorEntries) {
    const t = e.saveTarget;
    if (!t || t.kind !== 'background' || t.key !== key) continue;
    if (t.slot === 'clouds') continue;
    const withColor = e.material as THREE.Material & { color?: THREE.Color };
    if (!withColor.color?.isColor) continue;
    const hex = withColor.color.getHex() & 0xffffff;
    if (t.slot === 'top') top = hex;
    else if (t.slot === 'bottom') bottom = hex;
  }
  if (top == null || bottom == null) return null;
  return { top, bottom };
}

function cloudColorFromEditor(key: string): number | null {
  if (selectedTraitKey !== 'background') return null;
  if (currentTraits?.background !== key) return null;
  for (const e of editorEntries) {
    const t = e.saveTarget;
    if (!t || t.kind !== 'background' || t.key !== key || t.slot !== 'clouds') continue;
    const withColor = e.material as THREE.Material & { color?: THREE.Color };
    if (!withColor.color?.isColor) continue;
    return withColor.color.getHex() & 0xffffff;
  }
  return null;
}

function gradientForKey(key: string): BackgroundGradient {
  const saved = backgroundGradient(key);
  const live = bgGradLive.get(key);
  const editor = gradientFromEditor(key);
  return {
    top: editor?.top ?? live?.top ?? saved.top,
    bottom: editor?.bottom ?? live?.bottom ?? saved.bottom,
    distance: live?.distance ?? saved.distance ?? DEFAULT_GRADIENT_DISTANCE,
  };
}

function cloudColorForKey(key: string): number {
  return cloudColorFromEditor(key) ?? bgCloudLive.get(key) ?? backgroundCloudColor(key);
}

const bgScenes = new BackgroundSceneManager(scene);
/** Live fog edits per Background trait key (session overrides until save). */
const fogLive = new Map<string, BackgroundFog>();
let fogUiKey: string | null = null;
let fogUiSyncing = false;
const dirLightLive = new Map<string, BackgroundDirLight>();
let sunUiKey: string | null = null;
let sunUiSyncing = false;
/** Live ocean-ripple edits per Background trait key. */
const rippleLive = new Map<string, BackgroundRipple>();
const oceanMatLive = new Map<string, BackgroundOceanMat>();
let oceanUiKey: string | null = null;
let oceanUiSyncing = false;

function fogForKey(key: string): BackgroundFog {
  const live = fogLive.get(key);
  if (live) {
    return {
      enabled: live.enabled,
      color: live.color,
      near: live.near,
      far: Math.max(live.far, live.near + 0.01),
    };
  }
  return backgroundFog(key);
}

function dirLightForKey(key: string): BackgroundDirLight {
  const live = dirLightLive.get(key);
  if (live) return { ...live };
  return backgroundDirLight(key);
}

/** Live Lights-panel sun; Reset / BG change load trait-saved sun when enabled. */
function sunFromTraitBg(): Pick<LightLevels, 'sun' | 'sunAzimuth' | 'sunElevation'> {
  const key = liveBackgroundKey();
  if (!key) return { ...DEFAULT_SUN };
  const cfg = dirLightForKey(key);
  if (!cfg.enabled) return { ...DEFAULT_SUN };
  return {
    sun: cfg.intensity,
    sunAzimuth: cfg.azimuth,
    sunElevation: cfg.elevation,
  };
}

/** BG key whose trait sun was last copied into lightMix (skip re-seed on same BG). */
let appliedSunBgKey: string | null | undefined;

const DIR_LIGHT_DISTANCE = 10;
const _dirOffset = new THREE.Vector3();

function applyTraitDirLight(): void {
  const trait = bgMode === 'trait';
  const ball = bgMode === 'ghoulball';
  const key = liveBackgroundKey();
  const cfg = key ? dirLightForKey(key) : DEFAULT_DIR_LIGHT;
  const traitSun = trait && !!key && cfg.enabled;
  const on = !ball;
  dirLight.visible = on;
  // Intensity / direction always follow the Lights panel (lightMix) so edits work;
  // trait-saved sun is only a Reset / BG-change seed. Color still comes from the trait when enabled.
  dirLight.intensity = !on ? 0 : lightMix.sun;
  dirLight.color.setHex(traitSun ? cfg.color : DEFAULT_DIR_LIGHT.color);
  const el = THREE.MathUtils.degToRad(lightMix.sunElevation);
  const az = THREE.MathUtils.degToRad(lightMix.sunAzimuth);
  const cosEl = Math.cos(el);
  _dirOffset.set(
    DIR_LIGHT_DISTANCE * cosEl * Math.sin(az),
    DIR_LIGHT_DISTANCE * Math.sin(el),
    DIR_LIGHT_DISTANCE * cosEl * Math.cos(az),
  );
  const origin = assembler?.root.position;
  if (origin) {
    dirLight.position.copy(origin).add(_dirOffset);
    dirLight.target.position.set(origin.x, origin.y + 1, origin.z);
  } else {
    dirLight.position.copy(_dirOffset);
    dirLight.target.position.set(0, 1, 0);
  }
  dirLight.target.updateMatrixWorld();
  dirLightHelper.update();
}

function applyObjectShadows(root: THREE.Object3D, cast: boolean, receive: boolean): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (o.userData.skyBloom || mesh.name.startsWith('Skybox')) {
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      return;
    }
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
  });
}

function rippleForKey(key: string): BackgroundRipple {
  const live = rippleLive.get(key);
  if (live) return { ...live };
  return backgroundRipple(key);
}

function oceanMatForKey(key: string): BackgroundOceanMat {
  const live = oceanMatLive.get(key);
  if (live) return { ...live };
  return backgroundOceanMat(key) ?? bgScenes.readOceanMaterial(key) ?? { ...DEFAULT_OCEAN_MAT };
}

function applyOceanMatIfSet(key: string): void {
  const mat = oceanMatLive.get(key) ?? backgroundOceanMat(key);
  if (mat) bgScenes.setOceanMaterial(key, mat);
}

function applySceneFog(): void {
  const trait = bgMode === 'trait';
  const key = fogBackgroundKey();
  if (!trait || !key) {
    scene.fog = null;
    return;
  }
  const fog = fogForKey(key);
  if (!fog.enabled) {
    scene.fog = null;
    return;
  }
  const near = fog.near;
  const far = Math.max(fog.far, near + 0.01);
  if (scene.fog instanceof THREE.Fog) {
    scene.fog.color.setHex(fog.color);
    scene.fog.near = near;
    scene.fog.far = far;
  } else {
    scene.fog = new THREE.Fog(fog.color, near, far);
  }
}

function syncGridAndBackground(): void {
  const trait = bgMode === 'trait';
  const ghoulball = bgMode === 'ghoulball';
  const key = liveBackgroundKey();
  grid.visible = !trait && !ghoulball && lastUnlitScale > 1e-5;
  ground.visible = !trait && !ghoulball;
  const gm = grid.material;
  if (Array.isArray(gm)) {
    for (const mat of gm) {
      mat.opacity = gridOpacityBase * lastUnlitScale;
      mat.transparent = true;
    }
  } else {
    gm.opacity = gridOpacityBase * lastUnlitScale;
    gm.transparent = true;
  }
  if (trait) {
    const g = key ? gradientForKey(key) : { top: GRID_CLEAR, bottom: GRID_CLEAR, distance: DEFAULT_GRADIENT_DISTANCE };
    // Flat clear matches horizon; the sphere skybox carries the vertical gradient.
    scene.background = new THREE.Color(g.bottom);
    bgScenes.setClearGradient(g.top, g.bottom, g.distance ?? DEFAULT_GRADIENT_DISTANCE);
    if (key) bgScenes.setCloudColor(cloudColorForKey(key));
  } else {
    scene.background = new THREE.Color(GRID_CLEAR);
  }
  applySceneFog();
  applyTraitDirLight();
  const ripple = key ? rippleForKey(key) : { enabled: false, amplitude: 0, frequency: 1, speed: 1 };
  bgScenes.setRipple(ripple);
  if (key) applyOceanMatIfSet(key);
  void bgScenes.setActive(key, trait).then(() => {
    if (key) {
      const g = gradientForKey(key);
      bgScenes.setClearGradient(g.top, g.bottom, g.distance ?? DEFAULT_GRADIENT_DISTANCE);
      bgScenes.setCloudColor(cloudColorForKey(key));
      applyOceanMatIfSet(key);
    }
    syncOceanControls();
  });
  syncFogControls();
  syncSunControls();
  syncOceanControls();
}

const clock = new THREE.Clock();
const animator = new GhoulAnimator();
const cloakCloth = new CloakClothManager();
const cigSmoke = new CigSmokeManager();
const cudiParticles = new CudiParticleManager();
const ghoulball = new GhoulballController();
const playMode = new PlayController();
let assembler: GhoulAssembler | null = null;
let dither: DitherComposer | null = null;
let currentId = 0;
let updateUrlFlag = !!document.getElementById('workspace');
let bootPromise: Promise<void> | null = null;

const bloomStrengthInput = q<HTMLInputElement>('#bloomStrength');
const bloomRadiusInput = q<HTMLInputElement>('#bloomRadius');
const bloomThresholdInput = q<HTMLInputElement>('#bloomThreshold');
const bloomStrengthVal = q<HTMLSpanElement>('#bloomStrengthVal');
const bloomRadiusVal = q<HTMLSpanElement>('#bloomRadiusVal');
const bloomThresholdVal = q<HTMLSpanElement>('#bloomThresholdVal');
const bloomModeObjectsBtn = q<HTMLButtonElement>('#bloomModeObjectsBtn');
const bloomModeScreenBtn = q<HTMLButtonElement>('#bloomModeScreenBtn');
const lightMasterInput = q<HTMLInputElement>('#lightMaster');
const lightAmbientInput = q<HTMLInputElement>('#lightAmbient');
const lightHemiInput = q<HTMLInputElement>('#lightHemi');
const lightKeyInput = q<HTMLInputElement>('#lightKey');
const lightFillInput = q<HTMLInputElement>('#lightFill');
const lightMasterVal = q<HTMLSpanElement>('#lightMasterVal');
const lightAmbientVal = q<HTMLSpanElement>('#lightAmbientVal');
const lightHemiVal = q<HTMLSpanElement>('#lightHemiVal');
const lightKeyVal = q<HTMLSpanElement>('#lightKeyVal');
const lightFillVal = q<HTMLSpanElement>('#lightFillVal');
const lightSunInput = q<HTMLInputElement>('#lightSun');
const lightSunAzimuthInput = q<HTMLInputElement>('#lightSunAzimuth');
const lightSunElevationInput = q<HTMLInputElement>('#lightSunElevation');
const lightSunVal = q<HTMLSpanElement>('#lightSunVal');
const lightSunAzimuthVal = q<HTMLSpanElement>('#lightSunAzimuthVal');
const lightSunElevationVal = q<HTMLSpanElement>('#lightSunElevationVal');

function applySunLevelsToLights(
  sun: Pick<LightLevels, 'sun' | 'sunAzimuth' | 'sunElevation'>,
  bgKey: string | null | undefined = liveBackgroundKey(),
): void {
  lightMix = { ...lightMix, ...sun };
  appliedSunBgKey = bgKey;
  if (lightSunInput instanceof HTMLInputElement) {
    lightSunInput.value = String(sun.sun);
    lightSunAzimuthInput.value = String(sun.sunAzimuth);
    lightSunElevationInput.value = String(sun.sunElevation);
  }
  if (lightSunVal.isConnected) lightSunVal.textContent = sun.sun.toFixed(2);
  if (lightSunAzimuthVal.isConnected) lightSunAzimuthVal.textContent = String(Math.round(sun.sunAzimuth));
  if (lightSunElevationVal.isConnected) lightSunElevationVal.textContent = String(Math.round(sun.sunElevation));
}

/** Copy trait-BG sun into the Lights panel when the background trait changes (or force). */
function syncLightSunFromTraitBg(force = false): void {
  const key = liveBackgroundKey();
  if (!force && key === appliedSunBgKey) return;
  applySunLevelsToLights(sunFromTraitBg(), key);
}

const clothStiffnessRootInput = q<HTMLInputElement>('#clothStiffnessRoot');
const clothStiffnessTipInput = q<HTMLInputElement>('#clothStiffnessTip');
const clothRestBlendInput = q<HTMLInputElement>('#clothRestBlend');
const clothGravityInput = q<HTMLInputElement>('#clothGravity');
const clothDampingInput = q<HTMLInputElement>('#clothDamping');
const clothStiffnessRootVal = q<HTMLSpanElement>('#clothStiffnessRootVal');
const clothStiffnessTipVal = q<HTMLSpanElement>('#clothStiffnessTipVal');
const clothRestBlendVal = q<HTMLSpanElement>('#clothRestBlendVal');
const clothGravityVal = q<HTMLSpanElement>('#clothGravityVal');
const clothDampingVal = q<HTMLSpanElement>('#clothDampingVal');
const refImage = q<HTMLImageElement>('#refImage');
const refLabel = q<HTMLSpanElement>('#refLabel');
const ghoulIdInput = q<HTMLInputElement>('#ghoulId');
const ghoulPrevBtn = q<HTMLButtonElement>('#ghoulPrev');
const ghoulNextBtn = q<HTMLButtonElement>('#ghoulNext');
const ghoulLoadBtn = q<HTMLButtonElement>('#ghoulLoad');
const traitCoverIdInput = q<HTMLInputElement>('#traitCoverId');
const traitCoverPrevBtn = q<HTMLButtonElement>('#traitCoverPrev');
const traitCoverNextBtn = q<HTMLButtonElement>('#traitCoverNext');
const traitCoverLoadBtn = q<HTMLButtonElement>('#traitCoverLoad');
const traitCoverMeta = q<HTMLSpanElement>('#traitCoverMeta');
const resetPoseBtn = q<HTMLButtonElement>('#resetPoseBtn');

/** Shortest ghoul list that together covers every trait value (incl. all 1/1 uniques). */
const TRAIT_COVER_IDS: readonly number[] = [
  41, 72, 207, 298, 817, 899, 1194, 1480, 1644, 2048, 2065, 2181, 2262, 2379, 2401, 2418, 2446,
  2482, 2957, 3058, 3274, 3308, 3428, 3505, 3679, 3849, 4689, 4791, 4867, 4980, 5113, 5226, 5705,
  5797, 5828, 5874, 5977, 5997, 6080, 6210, 6508, 6536, 6600,
];
let traitCoverIndex = 0;
const animSelect = q<HTMLSelectElement>('#animSelect');
const colliderDebugBtn = q<HTMLButtonElement>('#colliderDebugBtn');
const particleDebugBtn = q<HTMLButtonElement>('#particleDebugBtn');
const particlePickHud = q<HTMLSpanElement>('#particlePickHud');
const lightDebugBtn = q<HTMLButtonElement>('#lightDebugBtn');
const bgModeGridBtn = q<HTMLButtonElement>('#bgModeGridBtn');
const bgModeTraitBtn = q<HTMLButtonElement>('#bgModeTraitBtn');
const bgModeGhoulballBtn = q<HTMLButtonElement>('#bgModeGhoulballBtn');
const appModeViewBtn = q<HTMLButtonElement>('#appModeViewBtn');
const appModePlayBtn = q<HTMLButtonElement>('#appModePlayBtn');
const playHintBanner = q<HTMLElement>('#playHintBanner');
const camModeFixedBtn = q<HTMLButtonElement>('#camModeFixedBtn');
const camModeFollowBtn = q<HTMLButtonElement>('#camModeFollowBtn');
const camZoomInput = q<HTMLInputElement>('#camZoom');
const camPosXInput = q<HTMLInputElement>('#camPosX');
const camPosYInput = q<HTMLInputElement>('#camPosY');
const camPosZInput = q<HTMLInputElement>('#camPosZ');
const camRotXInput = q<HTMLInputElement>('#camRotX');
const camRotYInput = q<HTMLInputElement>('#camRotY');
const camRotZInput = q<HTMLInputElement>('#camRotZ');
const camZoomVal = q<HTMLSpanElement>('#camZoomVal');
const camPosXVal = q<HTMLSpanElement>('#camPosXVal');
const camPosYVal = q<HTMLSpanElement>('#camPosYVal');
const camPosZVal = q<HTMLSpanElement>('#camPosZVal');
const camRotXVal = q<HTMLSpanElement>('#camRotXVal');
const camRotYVal = q<HTMLSpanElement>('#camRotYVal');
const camRotZVal = q<HTMLSpanElement>('#camRotZVal');
const camResetBtn = q<HTMLButtonElement>('#camResetBtn');
const camFollowPitchInput = q<HTMLInputElement>('#camFollowPitch');
const camFollowYawInput = q<HTMLInputElement>('#camFollowYaw');
const camFollowDistInput = q<HTMLInputElement>('#camFollowDist');
const camFollowPitchVal = q<HTMLSpanElement>('#camFollowPitchVal');
const camFollowYawVal = q<HTMLSpanElement>('#camFollowYawVal');
const camFollowDistVal = q<HTMLSpanElement>('#camFollowDistVal');
const camFollowResetBtn = q<HTMLButtonElement>('#camFollowResetBtn');
const ballRotXInput = q<HTMLInputElement>('#ballRotX');
const ballRotYInput = q<HTMLInputElement>('#ballRotY');
const ballRotZInput = q<HTMLInputElement>('#ballRotZ');
const ballRotXVal = q<HTMLSpanElement>('#ballRotXVal');
const ballRotYVal = q<HTMLSpanElement>('#ballRotYVal');
const ballRotZVal = q<HTMLSpanElement>('#ballRotZVal');
const ballSpinXInput = q<HTMLInputElement>('#ballSpinX');
const ballSpinYInput = q<HTMLInputElement>('#ballSpinY');
const ballSpinZInput = q<HTMLInputElement>('#ballSpinZ');
const ballSpinXVal = q<HTMLSpanElement>('#ballSpinXVal');
const ballSpinYVal = q<HTMLSpanElement>('#ballSpinYVal');
const ballSpinZVal = q<HTMLSpanElement>('#ballSpinZVal');
const ballRotResetBtn = q<HTMLButtonElement>('#ballRotResetBtn');
const lightResetBtn = q<HTMLButtonElement>('#lightResetBtn');
const bloomResetBtn = q<HTMLButtonElement>('#bloomResetBtn');
const playWalkSpeedInput = q<HTMLInputElement>('#playWalkSpeed');
const playTurnSpeedInput = q<HTMLInputElement>('#playTurnSpeed');
const playWalkSpeedVal = q<HTMLSpanElement>('#playWalkSpeedVal');
const playTurnSpeedVal = q<HTMLSpanElement>('#playTurnSpeedVal');
const fogEnabledInput = q<HTMLInputElement>('#fogEnabled');
const fogColorInput = q<HTMLInputElement>('#fogColor');
const fogNearInput = q<HTMLInputElement>('#fogNear');
const fogFarInput = q<HTMLInputElement>('#fogFar');
const fogColorVal = q<HTMLSpanElement>('#fogColorVal');
const fogNearVal = q<HTMLSpanElement>('#fogNearVal');
const fogFarVal = q<HTMLSpanElement>('#fogFarVal');
const fogTraitHint = q<HTMLElement>('#fogTraitHint');
const fogSaveBtn = q<HTMLButtonElement>('#fogSaveBtn');
const fogSaveStatus = q<HTMLElement>('#fogSaveStatus');
const sunEnabledInput = q<HTMLInputElement>('#sunEnabled');
const sunColorInput = q<HTMLInputElement>('#sunColor');
const sunIntensityInput = q<HTMLInputElement>('#sunIntensity');
const sunAzimuthInput = q<HTMLInputElement>('#sunAzimuth');
const sunElevationInput = q<HTMLInputElement>('#sunElevation');
const sunColorVal = q<HTMLSpanElement>('#sunColorVal');
const sunIntensityVal = q<HTMLSpanElement>('#sunIntensityVal');
const sunAzimuthVal = q<HTMLSpanElement>('#sunAzimuthVal');
const sunElevationVal = q<HTMLSpanElement>('#sunElevationVal');
const sunTraitHint = q<HTMLElement>('#sunTraitHint');
const sunSaveBtn = q<HTMLButtonElement>('#sunSaveBtn');
const sunSaveStatus = q<HTMLElement>('#sunSaveStatus');
const oceanEnabledInput = q<HTMLInputElement>('#oceanEnabled');
const oceanAmplitudeInput = q<HTMLInputElement>('#oceanAmplitude');
const oceanFrequencyInput = q<HTMLInputElement>('#oceanFrequency');
const oceanSpeedInput = q<HTMLInputElement>('#oceanSpeed');
const oceanColorInput = q<HTMLInputElement>('#oceanColor');
const oceanMetalnessInput = q<HTMLInputElement>('#oceanMetalness');
const oceanRoughnessInput = q<HTMLInputElement>('#oceanRoughness');
const oceanOpacityInput = q<HTMLInputElement>('#oceanOpacity');
const oceanEnvInput = q<HTMLInputElement>('#oceanEnv');
const oceanAmplitudeVal = q<HTMLSpanElement>('#oceanAmplitudeVal');
const oceanFrequencyVal = q<HTMLSpanElement>('#oceanFrequencyVal');
const oceanSpeedVal = q<HTMLSpanElement>('#oceanSpeedVal');
const oceanColorVal = q<HTMLSpanElement>('#oceanColorVal');
const oceanMetalnessVal = q<HTMLSpanElement>('#oceanMetalnessVal');
const oceanRoughnessVal = q<HTMLSpanElement>('#oceanRoughnessVal');
const oceanOpacityVal = q<HTMLSpanElement>('#oceanOpacityVal');
const oceanEnvVal = q<HTMLSpanElement>('#oceanEnvVal');
const oceanTraitHint = q<HTMLElement>('#oceanTraitHint');
const oceanSaveBtn = q<HTMLButtonElement>('#oceanSaveBtn');
const oceanSaveStatus = q<HTMLElement>('#oceanSaveStatus');
const ballMetalnessInput = q<HTMLInputElement>('#ballMetalness');
const ballRoughnessInput = q<HTMLInputElement>('#ballRoughness');
const ballClearcoatInput = q<HTMLInputElement>('#ballClearcoat');
const ballClearcoatRoughnessInput = q<HTMLInputElement>('#ballClearcoatRoughness');
const ballEnvInput = q<HTMLInputElement>('#ballEnv');
const ballReflectivityInput = q<HTMLInputElement>('#ballReflectivity');
const ballSwirlInput = q<HTMLInputElement>('#ballSwirl');
const ballMetalnessVal = q<HTMLSpanElement>('#ballMetalnessVal');
const ballRoughnessVal = q<HTMLSpanElement>('#ballRoughnessVal');
const ballClearcoatVal = q<HTMLSpanElement>('#ballClearcoatVal');
const ballClearcoatRoughnessVal = q<HTMLSpanElement>('#ballClearcoatRoughnessVal');
const ballEnvVal = q<HTMLSpanElement>('#ballEnvVal');
const ballReflectivityVal = q<HTMLSpanElement>('#ballReflectivityVal');
const ballSwirlVal = q<HTMLSpanElement>('#ballSwirlVal');
const traitsListEl = q<HTMLDListElement>('#traitsList');
const materialHint = q<HTMLElement>('#materialHint');
const materialList = q<HTMLElement>('#materialList');
const materialSaveBtn = q<HTMLButtonElement>('#materialSave');
const materialSaveStatus = q<HTMLElement>('#materialSaveStatus');

let currentTraits: GhoulTraits | null = null;
let selectedTraitKey: keyof GhoulTraits | null = null;
let editorEntries: EditableMaterial[] = [];
/** saveTarget keys the user has edited in this panel session */
const dirtySaveKeys = new Set<string>();

function saveTargetKey(t: MaterialSaveTarget): string {
  if (t.kind === 'skin') return `skin:${t.key}:${t.slot}`;
  if (t.kind === 'accent') return `accent:${t.key}`;
  if (t.kind === 'background') return `background:${t.key}:${t.slot}`;
  return `eye:${t.key}`;
}

function sameSaveTarget(a?: MaterialSaveTarget, b?: MaterialSaveTarget): boolean {
  if (!a || !b) return false;
  return saveTargetKey(a) === saveTargetKey(b);
}

function colorFromMaterial(mat: THREE.Material): string {
  const withColor = mat as THREE.Material & { color?: THREE.Color };
  if (withColor.color && withColor.color.isColor) return hexToCss(withColor.color.getHex());
  return '#000000';
}

function setMaterialColor(mat: THREE.Material, css: string, label?: string): void {
  const hex = cssToHex(css);
  const withColor = mat as THREE.Material & { color?: THREE.Color };
  if (withColor.color && withColor.color.isColor) {
    withColor.color.setHex(hex);
    mat.needsUpdate = true;
  }
  if (assembler && selectedTraitKey === 'ghoul' && label) {
    if (label.includes('· Light')) assembler.skinLightHex = hex;
    if (label.includes('· Dark')) assembler.skinDarkHex = hex;
  }
  syncGridAndBackground();
}

/** Keep Body/Head (and any other) slots with the same save target in sync. */
function applyColorToGroup(entry: EditableMaterial, css: string): void {
  if (entry.saveTarget) {
    dirtySaveKeys.add(saveTargetKey(entry.saveTarget));
    for (const e of editorEntries) {
      if (sameSaveTarget(e.saveTarget, entry.saveTarget)) {
        setMaterialColor(e.material, css, e.label);
      }
    }
    return;
  }
  setMaterialColor(entry.material, css, entry.label);
}

function applyFinishToGroup(
  entry: EditableMaterial,
  kind: 'roughness' | 'metalness',
  value: number,
): void {
  if (entry.saveTarget) dirtySaveKeys.add(saveTargetKey(entry.saveTarget));
  const targets = entry.saveTarget
    ? editorEntries.filter((e) => sameSaveTarget(e.saveTarget, entry.saveTarget))
    : [entry];
  for (const e of targets) {
    if (!e.lit) continue;
    const std = e.material as THREE.MeshStandardMaterial;
    if (kind === 'roughness') std.roughness = value;
    else std.metalness = value;
    std.needsUpdate = true;
  }
}

function setSaveStatus(text: string, kind: '' | 'ok' | 'err' = ''): void {
  materialSaveStatus.textContent = text;
  materialSaveStatus.classList.toggle('is-ok', kind === 'ok');
  materialSaveStatus.classList.toggle('is-err', kind === 'err');
}

function syncSaveButton(): void {
  const canSave = editorEntries.some((e) => e.saveTarget);
  materialSaveBtn.disabled = !canSave;
}

function buildSavePayload(): {
  skin?: Record<string, { light?: number; dark?: number; roughness?: number; metalness?: number }>;
  accent?: Record<
    string,
    {
      color: number;
      roughness?: number;
      metalness?: number;
      emissive?: number;
      emissiveIntensity?: number;
    }
  >;
  eye?: Record<string, { color: number }>;
  background?: Record<string, { color?: number; top?: number; bottom?: number; clouds?: number }>;
} {
  const skin: Record<
    string,
    { light?: number; dark?: number; roughness?: number; metalness?: number }
  > = {};
  const accent: Record<
    string,
    {
      color: number;
      roughness?: number;
      metalness?: number;
      emissive?: number;
      emissiveIntensity?: number;
    }
  > = {};
  const eye: Record<string, { color: number }> = {};
  const background: Record<
    string,
    { color?: number; top?: number; bottom?: number; clouds?: number; distance?: number }
  > = {};
  const seen = new Set<string>();

  for (const entry of editorEntries) {
    const target = entry.saveTarget;
    if (!target) continue;
    const key = saveTargetKey(target);
    // One write per palette key (Body/Head Light share a target and stay synced).
    if (seen.has(key)) continue;
    seen.add(key);

    const withColor = entry.material as THREE.Material & { color?: THREE.Color };
    if (!withColor.color?.isColor) continue;
    const color = withColor.color.getHex() & 0xffffff;

    if (target.kind === 'skin') {
      const row = (skin[target.key] ??= {});
      if (target.slot === 'light') {
        row.light = color;
        if (entry.lit) {
          const std = entry.material as THREE.MeshStandardMaterial;
          row.roughness = std.roughness;
          row.metalness = std.metalness;
        }
      } else {
        row.dark = color;
      }
    } else if (target.kind === 'accent') {
      const row: {
        color: number;
        roughness?: number;
        metalness?: number;
        emissive?: number;
        emissiveIntensity?: number;
      } = { color };
      if (entry.lit) {
        const std = entry.material as THREE.MeshStandardMaterial;
        row.roughness = std.roughness;
        row.metalness = std.metalness;
        const em = std.emissive?.getHex() ?? 0;
        if (em !== 0 || std.emissiveIntensity > 0) {
          row.emissive = em;
          row.emissiveIntensity = std.emissiveIntensity;
        }
      }
      accent[target.key] = row;
    } else if (target.kind === 'eye') {
      eye[target.key] = { color };
    } else if (target.kind === 'background') {
      const row = (background[target.key] ??= {});
      if (target.slot === 'top') row.top = color;
      else if (target.slot === 'bottom') {
        row.bottom = color;
        row.color = color;
      } else if (target.slot === 'clouds') {
        row.clouds = color;
      }
      const g = gradientForKey(target.key);
      row.distance = g.distance ?? DEFAULT_GRADIENT_DISTANCE;
    }
  }

  return {
    ...(Object.keys(skin).length ? { skin } : {}),
    ...(Object.keys(accent).length ? { accent } : {}),
    ...(Object.keys(eye).length ? { eye } : {}),
    ...(Object.keys(background).length ? { background } : {}),
  };
}

function summarizePayload(payload: ReturnType<typeof buildSavePayload>): string {
  const bits: string[] = [];
  for (const [k, v] of Object.entries(payload.skin ?? {})) {
    if (v.light != null) bits.push(`${k} light ${hexToCss(v.light)}`);
    if (v.dark != null) bits.push(`${k} dark ${hexToCss(v.dark)}`);
  }
  for (const [k, v] of Object.entries(payload.accent ?? {})) {
    bits.push(`${k} ${hexToCss(v.color)}`);
  }
  for (const [k, v] of Object.entries(payload.eye ?? {})) {
    bits.push(`${k} ${hexToCss(v.color)}`);
  }
  for (const [k, v] of Object.entries(payload.background ?? {})) {
    if (v.top != null && v.bottom != null) {
      bits.push(`${k} ${hexToCss(v.top)}→${hexToCss(v.bottom)}`);
    } else if (v.color != null) {
      bits.push(`${k} ${hexToCss(v.color)}`);
    }
    if (v.clouds != null) bits.push(`${k} clouds ${hexToCss(v.clouds)}`);
  }
  return bits.join(', ') || 'materials.ts';
}

async function saveMaterialsToDisk(): Promise<void> {
  const payload = buildSavePayload();
  if (!payload.skin && !payload.accent && !payload.eye && !payload.background) {
    setSaveStatus('Nothing to save for this trait', 'err');
    return;
  }

  materialSaveBtn.disabled = true;
  setSaveStatus('Saving…');
  try {
    const res = await fetch('/__dev/save-materials', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    let data: { ok: boolean; error?: string; file?: string; wrote?: string };
    try {
      data = JSON.parse(text) as typeof data;
    } catch {
      throw new Error(`Bad response (${res.status}): ${text.slice(0, 120)}`);
    }
    if (!res.ok || !data.ok) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    dirtySaveKeys.clear();
    setSaveStatus(`Saved · ${summarizePayload(payload)}`, 'ok');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    setSaveStatus(
      msg.includes('Failed to fetch')
        ? 'Save only works with npm run dev'
        : msg,
      'err',
    );
  } finally {
    syncSaveButton();
  }
}

materialSaveBtn.addEventListener('click', () => {
  void saveMaterialsToDisk();
});

function clearMaterialEditor(): void {
  editorEntries = [];
  dirtySaveKeys.clear();
  materialList.replaceChildren();
  materialHint.textContent = 'Select a trait';
  setSaveStatus('');
  syncSaveButton();
}

function showMaterialEditor(category: keyof GhoulTraits, value: string): void {
  if (!assembler) return;
  materialList.replaceChildren();
  dirtySaveKeys.clear();
  setSaveStatus('');

  if (category === 'background') {
    const key = value || 'None';
    const grad = bgGradLive.get(key) ?? backgroundGradient(key);
    const matTop = new THREE.MeshBasicMaterial({ color: grad.top });
    const matBottom = new THREE.MeshBasicMaterial({ color: grad.bottom });
    editorEntries = [
      {
        label: `${key} · Top`,
        material: matTop,
        lit: false,
        saveTarget: { kind: 'background', key, slot: 'top' },
      },
      {
        label: `${key} · Bottom`,
        material: matBottom,
        lit: false,
        saveTarget: { kind: 'background', key, slot: 'bottom' },
      },
    ];
    const showClouds = backgroundHasClouds(key) || bgScenes.hasCloudField(key);
    if (showClouds) {
      const cloudHex = bgCloudLive.get(key) ?? backgroundCloudColor(key);
      editorEntries.push({
        label: `${key} · Clouds`,
        material: new THREE.MeshBasicMaterial({ color: cloudHex }),
        lit: false,
        saveTarget: { kind: 'background', key, slot: 'clouds' },
      });
    }
    materialHint.textContent = `${formatTraitValue(key)} · skybox gradient${showClouds ? ' + clouds' : ''} · savable`;
    const card = document.createElement('div');
    card.className = 'mat-card';
    const title = document.createElement('div');
    title.className = 'mat-card-title';
    title.textContent = key;
    const meta = document.createElement('div');
    meta.className = 'mat-card-meta';
    meta.textContent = showClouds
      ? 'Skybox gradient + clouds · savable'
      : 'Skybox gradient · top → bottom · savable';
    card.append(title, meta);

    for (const entry of editorEntries) {
      const slot = entry.saveTarget?.kind === 'background' ? entry.saveTarget.slot : 'top';
      if (slot === 'clouds') continue;
      const row = document.createElement('label');
      row.className = 'mat-color-row';
      row.append(slot === 'top' ? 'Top' : 'Bottom');
      const colorInput = document.createElement('input');
      colorInput.type = 'color';
      colorInput.value = colorFromMaterial(entry.material);
      const val = document.createElement('span');
      val.className = 'mat-val';
      val.textContent = colorInput.value;
      colorInput.addEventListener('input', () => {
        applyColorToGroup(entry, colorInput.value);
        val.textContent = hexToCss(cssToHex(colorInput.value));
        const g = gradientFromEditor(key);
        if (g) {
          const prev = bgGradLive.get(key) ?? backgroundGradient(key);
          bgGradLive.set(key, { ...prev, ...g });
        }
      });
      row.append(colorInput, val);
      card.append(row);
    }

    const distRow = document.createElement('label');
    distRow.title = 'Dither crossover width. 1 = full frame (pixel-art). Lower = tighter band. Higher = softer, less solid at the edges.';
    distRow.append('Distance');
    const distInput = document.createElement('input');
    distInput.type = 'range';
    distInput.min = '0.05';
    distInput.max = '2';
    distInput.step = '0.01';
    distInput.value = String(grad.distance ?? DEFAULT_GRADIENT_DISTANCE);
    const distVal = document.createElement('span');
    distVal.className = 'mat-val';
    distVal.textContent = Number(distInput.value).toFixed(2);
    const writeDistance = (): void => {
      const distance = Number(distInput.value);
      distVal.textContent = distance.toFixed(2);
      const prev = gradientForKey(key);
      bgGradLive.set(key, { ...prev, distance });
      dirtySaveKeys.add(`background:${key}:top`);
      bgScenes.setClearGradient(prev.top, prev.bottom, distance);
    };
    distInput.addEventListener('input', writeDistance);
    distRow.append(distInput, distVal);
    card.append(distRow);

    for (const entry of editorEntries) {
      const slot = entry.saveTarget?.kind === 'background' ? entry.saveTarget.slot : 'top';
      if (slot !== 'clouds') continue;
      const row = document.createElement('label');
      row.className = 'mat-color-row';
      row.append('Clouds');
      const colorInput = document.createElement('input');
      colorInput.type = 'color';
      colorInput.value = colorFromMaterial(entry.material);
      const val = document.createElement('span');
      val.className = 'mat-val';
      val.textContent = colorInput.value;
      colorInput.addEventListener('input', () => {
        applyColorToGroup(entry, colorInput.value);
        val.textContent = hexToCss(cssToHex(colorInput.value));
        const cloud = cloudColorFromEditor(key);
        if (cloud != null) {
          bgCloudLive.set(key, cloud);
          bgScenes.setCloudColor(cloud);
        }
      });
      row.append(colorInput, val);
      card.append(row);
    }
    materialList.append(card);
    syncSaveButton();
    syncGridAndBackground();
    return;
  }

  const entries = assembler.getMaterialsForTrait(category, value);
  editorEntries = entries;
  if (entries.length === 0) {
    materialHint.textContent = 'No materials found for this trait';
    syncSaveButton();
    return;
  }

  const savable = entries.filter((e) => e.saveTarget).length;
  materialHint.textContent = `${formatTraitValue(value)} · ${entries.length} material${entries.length === 1 ? '' : 's'}${savable ? ` · ${savable} savable` : ''}`;

  const renderedSaveKeys = new Set<string>();

  for (const entry of entries) {
    // One UI card per palette key (Body+Head Light share a save target).
    if (entry.saveTarget) {
      const sk = saveTargetKey(entry.saveTarget);
      if (renderedSaveKeys.has(sk)) continue;
      renderedSaveKeys.add(sk);
    }

    const card = document.createElement('div');
    card.className = 'mat-card';

    const title = document.createElement('div');
    title.className = 'mat-card-title';
    if (entry.saveTarget?.kind === 'skin') {
      title.textContent =
        entry.saveTarget.slot === 'light' ? `${entry.saveTarget.key} · Light` : `${entry.saveTarget.key} · Dark`;
    } else if (entry.saveTarget?.kind === 'accent') {
      title.textContent = entry.saveTarget.key;
    } else if (entry.saveTarget?.kind === 'eye') {
      title.textContent = entry.saveTarget.key;
    } else if (entry.saveTarget?.kind === 'background') {
      const slot =
        entry.saveTarget.slot === 'top'
          ? 'Top'
          : entry.saveTarget.slot === 'bottom'
            ? 'Bottom'
            : 'Clouds';
      title.textContent = `${entry.saveTarget.key} · ${slot}`;
    } else {
      title.textContent = entry.label;
    }

    const meta = document.createElement('div');
    meta.className = 'mat-card-meta';
    meta.textContent = entry.lit
      ? entry.saveTarget
        ? 'Lit · savable'
        : 'Lit · not mapped'
      : entry.saveTarget
        ? 'Unlit · savable'
        : 'Unlit · not mapped';

    card.append(title, meta);

    const withColor = entry.material as THREE.Material & { color?: THREE.Color };
    if (withColor.color && withColor.color.isColor) {
      const row = document.createElement('label');
      row.className = 'mat-color-row';
      row.append('Colour');
      const colorInput = document.createElement('input');
      colorInput.type = 'color';
      colorInput.value = colorFromMaterial(entry.material);
      const val = document.createElement('span');
      val.className = 'mat-val';
      val.textContent = colorInput.value;
      colorInput.addEventListener('input', () => {
        applyColorToGroup(entry, colorInput.value);
        val.textContent = hexToCss(cssToHex(colorInput.value));
      });
      row.append(colorInput, val);
      card.append(row);
    }

    if (entry.lit) {
      const std = entry.material as THREE.MeshStandardMaterial;

      const roughRow = document.createElement('label');
      roughRow.append('Roughness');
      const roughInput = document.createElement('input');
      roughInput.type = 'range';
      roughInput.min = '0';
      roughInput.max = '1';
      roughInput.step = '0.01';
      roughInput.value = String(std.roughness);
      const roughVal = document.createElement('span');
      roughVal.className = 'mat-val';
      roughVal.textContent = std.roughness.toFixed(2);
      roughInput.addEventListener('input', () => {
        const v = Number(roughInput.value);
        applyFinishToGroup(entry, 'roughness', v);
        roughVal.textContent = v.toFixed(2);
      });
      roughRow.append(roughInput, roughVal);

      const metalRow = document.createElement('label');
      metalRow.append('Metallic');
      const metalInput = document.createElement('input');
      metalInput.type = 'range';
      metalInput.min = '0';
      metalInput.max = '1';
      metalInput.step = '0.01';
      metalInput.value = String(std.metalness);
      const metalVal = document.createElement('span');
      metalVal.className = 'mat-val';
      metalVal.textContent = std.metalness.toFixed(2);
      metalInput.addEventListener('input', () => {
        const v = Number(metalInput.value);
        applyFinishToGroup(entry, 'metalness', v);
        metalVal.textContent = v.toFixed(2);
      });
      metalRow.append(metalInput, metalVal);

      card.append(roughRow, metalRow);
    }

    materialList.append(card);
  }

  syncSaveButton();
}

function selectTrait(category: keyof GhoulTraits): void {
  if (!currentTraits) return;
  const value = currentTraits[category];
  if (typeof value !== 'string' || !value) return;
  if (value === 'None' && category !== 'background') return;

  selectedTraitKey = category;
  for (const row of traitsListEl.querySelectorAll('.trait-row')) {
    const selected = (row as HTMLElement).dataset.key === category;
    row.classList.toggle('is-selected', selected);
    row.setAttribute('aria-pressed', selected ? 'true' : 'false');
  }
  showMaterialEditor(category, value);
}

function syncLightControls(): void {
  cancelLightTween();
  if (lightMasterInput instanceof HTMLInputElement) {
    lightMix = {
      master: Number(lightMasterInput.value),
      ambient: Number(lightAmbientInput.value),
      hemi: Number(lightHemiInput.value),
      key: Number(lightKeyInput.value),
      fill: Number(lightFillInput.value),
      sun: Number(lightSunInput.value),
      sunAzimuth: Number(lightSunAzimuthInput.value),
      sunElevation: Number(lightSunElevationInput.value),
    };
  }
  applyLights(lightMix);
  if (lightMasterVal.isConnected) lightMasterVal.textContent = lightMix.master.toFixed(2);
  if (lightAmbientVal.isConnected) lightAmbientVal.textContent = lightMix.ambient.toFixed(2);
  if (lightHemiVal.isConnected) lightHemiVal.textContent = lightMix.hemi.toFixed(2);
  if (lightKeyVal.isConnected) lightKeyVal.textContent = lightMix.key.toFixed(2);
  if (lightFillVal.isConnected) lightFillVal.textContent = lightMix.fill.toFixed(2);
  if (lightSunVal.isConnected) lightSunVal.textContent = lightMix.sun.toFixed(2);
  if (lightSunAzimuthVal.isConnected) lightSunAzimuthVal.textContent = String(Math.round(lightMix.sunAzimuth));
  if (lightSunElevationVal.isConnected) lightSunElevationVal.textContent = String(Math.round(lightMix.sunElevation));
}

function setLights(levels: Partial<LightLevels>): void {
  cancelLightTween();
  lightMix = { ...lightMix, ...levels };
  if (lightMasterInput) lightMasterInput.value = String(lightMix.master);
  if (lightAmbientInput) lightAmbientInput.value = String(lightMix.ambient);
  if (lightHemiInput) lightHemiInput.value = String(lightMix.hemi);
  if (lightKeyInput) lightKeyInput.value = String(lightMix.key);
  if (lightFillInput) lightFillInput.value = String(lightMix.fill);
  if (lightSunInput) lightSunInput.value = String(lightMix.sun);
  if (lightSunAzimuthInput) lightSunAzimuthInput.value = String(lightMix.sunAzimuth);
  if (lightSunElevationInput) lightSunElevationInput.value = String(lightMix.sunElevation);
  syncLightControls();
}

const DEFAULT_BLOOM: BloomLevels = {
  mode: 'objects',
  strength: 0.1,
  radius: 0.11,
  threshold: 0.08,
};

function initLightControls(): void {
  setLights({
    master: DEFAULT_LIGHT_MASTER,
    ambient: LIGHT_BASE.ambient,
    hemi: LIGHT_BASE.hemi,
    key: LIGHT_BASE.key,
    fill: LIGHT_BASE.fill,
    ...sunFromTraitBg(),
  });
  appliedSunBgKey = liveBackgroundKey();
}

function resetLights(): void {
  if (bgMode === 'ghoulball') {
    setLights({
      ...GHOULBALL_LIGHTS,
      ...sunFromTraitBg(),
    });
    appliedSunBgKey = liveBackgroundKey();
  } else initLightControls();
}

for (const input of [
  lightMasterInput,
  lightAmbientInput,
  lightHemiInput,
  lightKeyInput,
  lightFillInput,
  lightSunInput,
  lightSunAzimuthInput,
  lightSunElevationInput,
]) {
  input?.addEventListener('input', syncLightControls);
}
initLightControls();
lightResetBtn.addEventListener('click', resetLights);

const TRAIT_LABELS: { key: keyof GhoulTraits; label: string }[] = [
  { key: 'ghoul', label: 'Ghoul' },
  { key: 'background', label: 'Background' },
  { key: 'eyes', label: 'Eyes' },
  { key: 'cranium', label: 'Cranium' },
  { key: 'eyeDischarge', label: 'Eye Discharge' },
  { key: 'lowerEyeAcc', label: 'Lower Eye Acc' },
  { key: 'midEyeAcc', label: 'Mid Eye Acc' },
  { key: 'topEyeAcc', label: 'Top Eye Acc' },
  { key: 'lowerHeadAcc', label: 'Lower Head Acc' },
  { key: 'midHeadAcc', label: 'Mid Head Acc' },
  { key: 'topHeadAcc', label: 'Top Head Acc' },
  { key: 'mouthAcc', label: 'Mouth Acc' },
  { key: 'special', label: 'Special' },
  { key: 'powerful', label: 'Powerful' },
  { key: 'unique', label: 'Unique' },
];

function formatTraitValue(value: string): string {
  return value.replace(/_/g, ' ');
}

function showTraits(traits: GhoulTraits): void {
  currentTraits = traits;
  traitsListEl.replaceChildren();
  clearMaterialEditor();

  let firstKey: keyof GhoulTraits | null = null;
  for (const { key, label } of TRAIT_LABELS) {
    const value = traits[key];
    if (typeof value !== 'string') continue;
    if (!value || value === 'None') continue;
    if (!firstKey) firstKey = key;
    const row = document.createElement('div');
    row.className = 'trait-row';
    row.dataset.key = key;
    row.tabIndex = 0;
    row.setAttribute('role', 'button');
    row.setAttribute('aria-pressed', 'false');
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = formatTraitValue(value);
    row.append(dt, dd);
    row.addEventListener('click', () => selectTrait(key));
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        selectTrait(key);
      }
    });
    traitsListEl.append(row);
  }

  // Default to Ghoul (skin materials) when present, else first trait.
  const prefer = traits.ghoul && traits.ghoul !== 'None' ? 'ghoul' : firstKey;
  if (prefer) selectTrait(prefer);
}

function showReferencePng(id: number): void {
  const padded = String(clampGhoulId(id)).padStart(4, '0');
  refLabel.textContent = `#${padded}`;
  refImage.classList.remove('is-missing');
  refImage.onload = () => refImage.classList.remove('is-missing');
  refImage.onerror = () => refImage.classList.add('is-missing');
  refImage.src = `/Ghouls/${padded}.png`;
  refImage.alt = `Ghoul #${padded} reference`;
}

function syncBloomControls(): void {
  if (!dither || !(bloomStrengthInput instanceof HTMLInputElement)) return;
  dither.bloomPass.strength = Number(bloomStrengthInput.value);
  dither.bloomPass.radius = Number(bloomRadiusInput.value);
  dither.bloomPass.threshold = Number(bloomThresholdInput.value);
  dither.bloomMode = bloomMode;
  bloomStrengthVal.textContent = dither.bloomPass.strength.toFixed(2);
  bloomRadiusVal.textContent = dither.bloomPass.radius.toFixed(2);
  bloomThresholdVal.textContent = dither.bloomPass.threshold.toFixed(2);
}

let bloomMode: BloomMode = 'objects';

function setBloomMode(next: BloomMode): void {
  bloomMode = next;
  if (dither) dither.bloomMode = next;
  bloomModeObjectsBtn.setAttribute('aria-selected', next === 'objects' ? 'true' : 'false');
  bloomModeScreenBtn.setAttribute('aria-selected', next === 'screen' ? 'true' : 'false');
}

bloomModeObjectsBtn.addEventListener('click', () => setBloomMode('objects'));
bloomModeScreenBtn.addEventListener('click', () => setBloomMode('screen'));
bloomResetBtn.addEventListener('click', resetBloom);

for (const input of [bloomStrengthInput, bloomRadiusInput, bloomThresholdInput]) {
  input.addEventListener('input', syncBloomControls);
}

function syncClothControls(): void {
  if (!(clothStiffnessRootInput instanceof HTMLInputElement)) return;
  const stiffnessRoot = Number(clothStiffnessRootInput.value);
  const stiffnessTip = Number(clothStiffnessTipInput.value);
  const restBlendRoot = Number(clothRestBlendInput.value);
  const gravity = Number(clothGravityInput.value);
  const damping = Number(clothDampingInput.value);
  // Keep tip hold softer than root, same ratio as Magica defaults.
  const restBlendTip = restBlendRoot > 0 ? Math.min(restBlendRoot * 0.25, 0.05) : 0;
  cloakCloth.setParams({
    stiffnessRoot,
    stiffnessTip,
    restBlendRoot,
    restBlendTip,
    gravity,
    damping,
  });
  clothStiffnessRootVal.textContent = stiffnessRoot.toFixed(2);
  clothStiffnessTipVal.textContent = stiffnessTip.toFixed(2);
  clothRestBlendVal.textContent = restBlendRoot.toFixed(2);
  clothGravityVal.textContent = gravity.toFixed(1);
  clothDampingVal.textContent = damping.toFixed(2);
}

function initClothControls(): void {
  const p = DEFAULT_CLOTH_PARAMS;
  clothStiffnessRootInput.value = String(p.stiffnessRoot);
  clothStiffnessTipInput.value = String(p.stiffnessTip);
  clothRestBlendInput.value = String(p.restBlendRoot);
  clothGravityInput.value = String(p.gravity);
  clothDampingInput.value = String(p.damping);
  syncClothControls();
}

for (const input of [
  clothStiffnessRootInput,
  clothStiffnessTipInput,
  clothRestBlendInput,
  clothGravityInput,
  clothDampingInput,
]) {
  input.addEventListener('input', syncClothControls);
}
initClothControls();

function clampGhoulId(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(6665, Math.max(0, Math.floor(n)));
}

/** Read ghoul id from `?id=123` (also accepts bare `?123`). */
function ghoulIdFromUrl(): number {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('id') ?? [...params.keys()][0];
  if (raw == null || raw === '') return 0;
  return clampGhoulId(Number(raw));
}

function setUrlGhoulId(id: number): void {
  if (!updateUrlFlag) return;
  const url = new URL(window.location.href);
  url.search = `?id=${id}`;
  history.replaceState(null, '', url);
}

function normalizeName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().toLowerCase().replace(/ /g, '_');
}

function nameKey(name: string): string {
  return normalizeName(name.replace(/\s*-\s*/g, '_-_').replace(/\s+/g, '_'));
}

function findNamed(root: THREE.Object3D, name: string): THREE.Object3D | null {
  const target = nameKey(name);
  const targetAlt = normalizeName(name);
  let found: THREE.Object3D | null = null;
  root.traverse((o) => {
    if (found) return;
    const n = normalizeName(o.name);
    if (n === target || n === targetAlt || nameKey(o.name) === target) found = o;
  });
  return found;
}

function characterHeight(asm: GhoulAssembler): { body: THREE.Object3D | null; height: number } {
  const body =
    findNamed(asm.root, 'Based Ghoul Body - Teeth') ??
    findNamed(asm.root, 'Based Ghoul Body - Fangs') ??
    findNamed(asm.root, 'Based Ghoul Body - Flesh');
  let height = 2;
  if (body) {
    const box = new THREE.Box3().setFromObject(body);
    if (!box.isEmpty()) height = Math.max(box.getSize(new THREE.Vector3()).y, 1.2);
  }
  return { body, height };
}

/** Default orbit camera around the ghoul's current world pose. Does not move the ghoul. */
function frameCamera(asm: GhoulAssembler): void {
  if (!controls) return;
  const { body, height } = characterHeight(asm);
  const dist = Math.max(height * 2.1, 2.5);
  const target = new THREE.Vector3(0, height * 0.55, 0);
  if (body) {
    const box = new THREE.Box3().setFromObject(body);
    if (!box.isEmpty()) {
      const center = box.getCenter(new THREE.Vector3());
      target.set(center.x, box.min.y + height * 0.55, center.z);
    }
  } else {
    target.copy(asm.root.position);
    target.y += height * 0.55;
  }
  controls.target.copy(target);
  camera.position.set(target.x + dist * 0.2, target.y + height * 0.05, target.z + dist);
  camera.near = 0.05;
  camera.far = Math.max(SKYBOX_CLIP_FAR, dist * 20);
  camera.updateProjectionMatrix();
  controls.update();
  applyCamRoll();
  syncCamUiFromCamera();
}

function frameCharacter(asm: GhoulAssembler): void {
  asm.root.position.set(0, 0, 0);
  asm.root.rotation.set(0, 0, 0);
  asm.root.scale.set(1, 1, 1);
  asm.root.updateWorldMatrix(true, true);

  const body =
    findNamed(asm.root, 'Based Ghoul Body - Teeth') ??
    findNamed(asm.root, 'Based Ghoul Body - Fangs') ??
    findNamed(asm.root, 'Based Ghoul Body - Flesh');

  const hips = findNamed(asm.root, 'mixamorig:Hips') ?? findNamed(asm.root, 'mixamorigHips');

  let center = new THREE.Vector3(0, 1, 0);

  if (body) {
    body.visible = true;
    const box = new THREE.Box3().setFromObject(body);
    if (!box.isEmpty()) {
      center = box.getCenter(new THREE.Vector3());
      asm.root.position.set(-center.x, -box.min.y, -center.z);
    }
  } else if (hips) {
    hips.getWorldPosition(center);
    asm.root.position.set(-center.x, 0, -center.z);
  }

  asm.root.updateWorldMatrix(true, true);
  frameCamera(asm);
}

/** Same pose+camera snap the Reset button uses. */
function resetGhoulPoseAndCamera(): void {
  if (!assembler) return;
  assembler.root.visible = true;
  if (assembler.bodyRoot) assembler.bodyRoot.position.set(0, 0, 0);
  frameCharacter(assembler);
  animator.snapTo(playMode.active ? 'Idle' : selectedAnim());
  cloakCloth.reset();
  cloakCloth.sync();
  if (playMode.active) {
    playMode.syncFloorFromRoot();
    playMode.refreshLocomotion();
  }
  syncLightsToGhoul();
}

function resetGhoulAndCamera(): void {
  if (!assembler) return;
  if (ghoulball.active) {
    ghoulball.stop(assembler.root, true);
    if (bgMode === 'ghoulball') {
      const restore = lightsBeforeGhoulball;
      lightsBeforeGhoulball = null;
      lastSceneBg = 'grid';
      bgMode = 'grid';
      bgModeGridBtn.setAttribute('aria-pressed', 'true');
      bgModeGridBtn.setAttribute('aria-selected', 'true');
      bgModeTraitBtn.setAttribute('aria-pressed', 'false');
      bgModeTraitBtn.setAttribute('aria-selected', 'false');
      bgModeGhoulballBtn.setAttribute('aria-pressed', 'false');
      const ballRotPane = document.getElementById('ghoulballRotControls');
      if (ballRotPane) ballRotPane.hidden = true;
      if (restore) setLights(restore);
      syncCameraChromeForBg();
      syncGridAndBackground();
    }
  }
  resetGhoulPoseAndCamera();
}

function syncGhoulIdInput(id: number): void {
  ghoulIdInput.value = String(clampGhoulId(id));
}

function syncTraitCoverPicker(id?: number): void {
  const target = id ?? TRAIT_COVER_IDS[traitCoverIndex] ?? TRAIT_COVER_IDS[0];
  const exact = TRAIT_COVER_IDS.indexOf(target);
  if (exact >= 0) {
    traitCoverIndex = exact;
  }
  traitCoverIdInput.value = String(TRAIT_COVER_IDS[traitCoverIndex]);
  traitCoverMeta.textContent = `${traitCoverIndex + 1} / ${TRAIT_COVER_IDS.length}`;
}

/** Snap a typed id to the nearest trait-cover ghoul (ties → lower id). */
function nearestTraitCoverId(n: number): number {
  const id = clampGhoulId(n);
  let best = TRAIT_COVER_IDS[0];
  let bestDist = Math.abs(best - id);
  for (let i = 1; i < TRAIT_COVER_IDS.length; i++) {
    const cand = TRAIT_COVER_IDS[i];
    const d = Math.abs(cand - id);
    if (d < bestDist || (d === bestDist && cand < best)) {
      best = cand;
      bestDist = d;
    }
  }
  return best;
}

function selectedAnim(): AnimName {
  return (animSelect.value || 'Idle') as AnimName;
}

function playSelectedAnim(): void {
  if (playMode.active) return;
  animator.play(selectedAnim());
}

let appMode: AppMode = 'view';

function syncPlayBanner(): void {
  if (!playHintBanner.isConnected) return;
  playHintBanner.textContent = appMode === 'play' ? 'ARROWS / WASD TO MOVE' : '';
}

function setAppMode(next: AppMode): void {
  const fromGhoulball = next === 'play' && bgMode === 'ghoulball';
  if (fromGhoulball) {
    setBgMode('trait');
  }
  appMode = next;
  appModeViewBtn.setAttribute('aria-selected', next === 'view' ? 'true' : 'false');
  appModePlayBtn.setAttribute('aria-selected', next === 'play' ? 'true' : 'false');
  animSelect.disabled = next === 'play';
  syncPlayBanner();

  if (next === 'play') {
    if (assembler) {
      // Leaving Ghoulball: put ghoul + camera back at the framed start pose.
      if (fromGhoulball) frameCharacter(assembler);
      playMode.setEnabled(true, assembler.root, animator, camera, controls!);
      playMode.syncFloorFromRoot();
    }
    setCamMode('follow');
  } else {
    playMode.setEnabled(false, null, null, camera, controls!);
    if (assembler) {
      frameCharacter(assembler);
      // Hard snap — crossfading from Walking leaves unkeyed head/neck bones stranded.
      animator.snapTo(selectedAnim());
    }
    setCamMode('fixed');
  }
}

appModeViewBtn.addEventListener('click', () => setAppMode('view'));
appModePlayBtn.addEventListener('click', () => setAppMode('play'));

function setCamMode(next: PlayCameraMode): void {
  if (bgMode === 'ghoulball') next = 'fixed';
  const fromFollow = playMode.cameraMode === 'follow';
  playMode.setCameraMode(next);
  camModeFixedBtn.setAttribute('aria-selected', next === 'fixed' ? 'true' : 'false');
  camModeFollowBtn.setAttribute('aria-selected', next === 'follow' ? 'true' : 'false');
  const fixedPane = document.getElementById('camFixedControls');
  const followPane = document.getElementById('camFollowControls');
  if (fixedPane) fixedPane.hidden = next === 'follow';
  if (followPane) followPane.hidden = next !== 'follow';
  if (next === 'follow') syncFollowCamUi();
  if (next === 'fixed' && fromFollow) resetView();
  syncCameraChromeForBg();
}

function syncCameraChromeForBg(): void {
  const ball = bgMode === 'ghoulball';
  const modeTabs = document.getElementById('camModeTabs');
  const rotPane = document.getElementById('camRotControls');
  const followPane = document.getElementById('camFollowControls');
  // Fixed/Follow tabs only in Play (and never during Ghoulball).
  if (modeTabs) modeTabs.hidden = ball || appMode !== 'play';
  if (rotPane) rotPane.hidden = ball;
  if (ball) {
    if (followPane) followPane.hidden = true;
    const fixedPane = document.getElementById('camFixedControls');
    if (fixedPane) fixedPane.hidden = false;
  } else if (appMode === 'view') {
    // View is always the Fixed control set; Follow pane stays tucked away.
    if (followPane) followPane.hidden = true;
    const fixedPane = document.getElementById('camFixedControls');
    if (fixedPane) fixedPane.hidden = false;
  }
  if (controls) {
    controls.enableRotate = true;
    // Keep dolly (zoom) and pan so Pos/Zoom still work via mouse if desired;
    // Pos sliders remain available either way.
  }
}

camModeFixedBtn.addEventListener('click', () => setCamMode('fixed'));
camModeFollowBtn.addEventListener('click', () => setCamMode('follow'));

function hasFollowCamUi(): boolean {
  return camFollowPitchInput instanceof HTMLInputElement;
}

let followCamUiWriting = false;

function syncFollowCamUi(): void {
  if (followCamUiWriting || !hasFollowCamUi()) return;
  const f = playMode.getFollowCam();
  camFollowPitchInput.value = String(f.pitch);
  camFollowYawInput.value = String(f.yaw);
  camFollowDistInput.value = String(f.distance);
  camFollowPitchVal.textContent = f.pitch.toFixed(0);
  camFollowYawVal.textContent = f.yaw.toFixed(0);
  camFollowDistVal.textContent = f.distance.toFixed(2);
}

function applyFollowCamFromUi(): void {
  if (!hasFollowCamUi()) return;
  followCamUiWriting = true;
  playMode.setFollowCam({
    pitch: Number(camFollowPitchInput.value),
    yaw: Number(camFollowYawInput.value),
    distance: Number(camFollowDistInput.value),
  });
  followCamUiWriting = false;
  syncFollowCamUi();
}

function setFollow(levels: Partial<FollowCamParams>): void {
  playMode.setFollowCam(levels);
  syncFollowCamUi();
}

function getFollow(): FollowCamParams {
  return playMode.getFollowCam();
}

function resetFollow(): void {
  playMode.resetFollowCam();
  syncFollowCamUi();
}

if (hasFollowCamUi()) {
  for (const input of [camFollowPitchInput, camFollowYawInput, camFollowDistInput]) {
    input.addEventListener('input', applyFollowCamFromUi);
  }
  camFollowResetBtn.addEventListener('click', resetFollow);
}

function hasCamUi(): boolean {
  return camZoomInput instanceof HTMLInputElement;
}

function deg(rad: number): number {
  return (rad * 180) / Math.PI;
}

function rad(degVal: number): number {
  return (degVal * Math.PI) / 180;
}

let camUiWriting = false;
/** OrbitControls lookAt wipes Euler Z; keep roll and apply it after each lookAt. */
let camRoll = 0;

function applyCamRoll(): void {
  if (!controls) return;
  camera.up.set(0, 1, 0);
  camera.lookAt(controls.target);
  if (camRoll !== 0) camera.rotateZ(camRoll);
}

function syncCamUiFromCamera(): void {
  if (camUiWriting || !hasCamUi() || !controls) return;
  const zoom = controls.getDistance();
  camZoomInput.value = String(zoom);
  camZoomVal.textContent = zoom.toFixed(2);
  camPosXInput.value = String(camera.position.x);
  camPosYInput.value = String(camera.position.y);
  camPosZInput.value = String(camera.position.z);
  camPosXVal.textContent = camera.position.x.toFixed(2);
  camPosYVal.textContent = camera.position.y.toFixed(2);
  camPosZVal.textContent = camera.position.z.toFixed(2);
  camera.up.set(0, 1, 0);
  camera.lookAt(controls.target);
  camera.rotation.reorder('YXZ');
  const rx = deg(camera.rotation.x);
  const ry = deg(camera.rotation.y);
  if (camRoll !== 0) camera.rotateZ(camRoll);
  camRotXInput.value = String(rx);
  camRotYInput.value = String(ry);
  camRotXVal.textContent = rx.toFixed(0);
  camRotYVal.textContent = ry.toFixed(0);
  camRotZInput.value = String(deg(camRoll));
  camRotZVal.textContent = deg(camRoll).toFixed(0);
}

function applyCamZoom(zoom: number): void {
  if (!controls) return;
  camUiWriting = true;
  _camOff.copy(camera.position).sub(controls.target);
  _camSph.setFromVector3(_camOff);
  _camSph.radius = Math.min(10, Math.max(1, zoom));
  camera.position.copy(controls.target).add(_camOff.setFromSpherical(_camSph));
  constrainOrbitToFloor();
  controls.update();
  clampCameraToFloor();
  applyCamRoll();
  camUiWriting = false;
  syncCamUiFromCamera();
}

function applyCamPos(x: number, y: number, z: number): void {
  if (!controls) return;
  camUiWriting = true;
  controls.target.x += x - camera.position.x;
  controls.target.y += y - camera.position.y;
  controls.target.z += z - camera.position.z;
  camera.position.set(x, Math.max(y, cameraFloorMinY()), z);
  controls.update();
  applyCamRoll();
  camUiWriting = false;
  syncCamUiFromCamera();
}

function applyCamRot(rx: number, ry: number, rz: number): void {
  if (!controls) return;
  camUiWriting = true;
  camRoll = rad(rz);
  const dist = Math.max(0.2, controls.getDistance());
  camera.rotation.order = 'YXZ';
  camera.rotation.set(rad(rx), rad(ry), 0);
  _camFwd.set(0, 0, -1).applyQuaternion(camera.quaternion).multiplyScalar(dist);
  controls.target.copy(camera.position).add(_camFwd);
  constrainOrbitToFloor();
  controls.update();
  clampCameraToFloor();
  applyCamRoll();
  camUiWriting = false;
  syncCamUiFromCamera();
}

function getView(): ViewLevels {
  camera.rotation.reorder('YXZ');
  return {
    zoom: controls?.getDistance() ?? 2.8,
    position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
    rotation: {
      x: deg(camera.rotation.x),
      y: deg(camera.rotation.y),
      z: deg(camRoll),
    },
  };
}

function setView(levels: ViewPatch): void {
  if (levels.position) {
    applyCamPos(
      levels.position.x ?? camera.position.x,
      levels.position.y ?? camera.position.y,
      levels.position.z ?? camera.position.z,
    );
  }
  if (levels.rotation) {
    if (controls) {
      camera.up.set(0, 1, 0);
      camera.lookAt(controls.target);
    }
    camera.rotation.reorder('YXZ');
    applyCamRot(
      levels.rotation.x ?? deg(camera.rotation.x),
      levels.rotation.y ?? deg(camera.rotation.y),
      levels.rotation.z ?? deg(camRoll),
    );
  }
  if (levels.zoom != null) applyCamZoom(levels.zoom);
}

function resetView(): void {
  camRoll = 0;
  camera.fov = 35;
  camera.up.set(0, 1, 0);
  camera.updateProjectionMatrix();
  if (assembler) frameCamera(assembler);
  else if (controls) {
    camera.position.set(0, 1.1, 2.8);
    controls.target.set(0, 1.0, 0);
    controls.update();
    syncCamUiFromCamera();
  }
}

function getBloom(): BloomLevels {
  return {
    mode: dither?.bloomMode ?? bloomMode,
    strength: dither?.bloomPass.strength ?? (Number(bloomStrengthInput.value) || 0.1),
    radius: dither?.bloomPass.radius ?? (Number(bloomRadiusInput.value) || 0.11),
    threshold: dither?.bloomPass.threshold ?? (Number(bloomThresholdInput.value) || 0.08),
  };
}

function setBloom(levels: Partial<BloomLevels>): void {
  if (levels.mode) setBloomMode(levels.mode);
  if (bloomStrengthInput instanceof HTMLInputElement) {
    if (levels.strength != null) bloomStrengthInput.value = String(levels.strength);
    if (levels.radius != null) bloomRadiusInput.value = String(levels.radius);
    if (levels.threshold != null) bloomThresholdInput.value = String(levels.threshold);
  }
  if (dither) {
    if (levels.strength != null) dither.bloomPass.strength = levels.strength;
    if (levels.radius != null) dither.bloomPass.radius = levels.radius;
    if (levels.threshold != null) dither.bloomPass.threshold = levels.threshold;
  }
  syncBloomControls();
}

function resetBloom(): void {
  setBloom(DEFAULT_BLOOM);
}

if (hasCamUi()) {
  camZoomInput.addEventListener('input', () => applyCamZoom(Number(camZoomInput.value)));
  for (const input of [camPosXInput, camPosYInput, camPosZInput]) {
    input.addEventListener('input', () =>
      applyCamPos(Number(camPosXInput.value), Number(camPosYInput.value), Number(camPosZInput.value)),
    );
  }
  for (const input of [camRotXInput, camRotYInput, camRotZInput]) {
    input.addEventListener('input', () =>
      applyCamRot(Number(camRotXInput.value), Number(camRotYInput.value), Number(camRotZInput.value)),
    );
  }
  camResetBtn.addEventListener('click', resetView);
}

function doLoad(id?: number): void {
  if (!assembler) return;
  const n = clampGhoulId(id ?? currentId);
  currentId = n;
  onGhoulLoad?.(n);
  setUrlGhoulId(n);
  syncGhoulIdInput(n);
  syncTraitCoverPicker(n);
  showReferencePng(n);
  try {
    // Leave any in-progress ball so the new ghoul loads clean.
    if (ghoulball.active) ghoulball.stop(assembler.root, true);
    const traits = loadGhoul(assembler, n);
    showTraits(traits);
    frameCharacter(assembler);
    if (playMode.active) {
      playMode.syncFloorFromRoot();
      playMode.refreshLocomotion();
    }
    cloakCloth.sync();
    cigSmoke.sync(assembler.root, scene);
    void cudiParticles.sync(assembler.root, scene);
    playSelectedAnim();
    // New materials (eyes/emissive) need the current light scale applied.
    // Seed Lights sun from the Background trait when it changes.
    syncLightSunFromTraitBg();
    syncLightControls();
    syncGridAndBackground();
    applyObjectShadows(assembler.root, true, true);
    if (bgMode === 'ghoulball') {
      resetGhoulPoseAndCamera();
      const extras: THREE.Object3D[] = [];
      scene.traverse((o) => {
        const pts = o as THREE.Points;
        if (!pts.isPoints) return;
        if (pts.name.startsWith('CudiParticles') || pts.name.startsWith('Cig')) extras.push(pts);
      });
      const refUrl =
        refImage.src || `/Ghouls/${String(n).padStart(4, '0')}.png`;
      ghoulball.start(assembler.root, scene, refUrl, extras);
    }
  } catch (e) {
    console.error(e);
  }
}

function loadFromPicker(): void {
  doLoad(Number(ghoulIdInput.value));
}

function loadFromTraitCover(): void {
  const snapped = nearestTraitCoverId(Number(traitCoverIdInput.value));
  traitCoverIndex = TRAIT_COVER_IDS.indexOf(snapped);
  syncTraitCoverPicker();
  doLoad(snapped);
}

ghoulLoadBtn.addEventListener('click', loadFromPicker);
resetPoseBtn.addEventListener('click', () => resetGhoulAndCamera());
ghoulIdInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    loadFromPicker();
  }
});
ghoulPrevBtn.addEventListener('click', () => {
  doLoad(clampGhoulId(Number(ghoulIdInput.value) - 1));
});
ghoulNextBtn.addEventListener('click', () => {
  doLoad(clampGhoulId(Number(ghoulIdInput.value) + 1));
});

traitCoverLoadBtn.addEventListener('click', loadFromTraitCover);
traitCoverIdInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    loadFromTraitCover();
  }
});
traitCoverPrevBtn.addEventListener('click', () => {
  traitCoverIndex = (traitCoverIndex - 1 + TRAIT_COVER_IDS.length) % TRAIT_COVER_IDS.length;
  syncTraitCoverPicker();
  doLoad(TRAIT_COVER_IDS[traitCoverIndex]);
});
traitCoverNextBtn.addEventListener('click', () => {
  traitCoverIndex = (traitCoverIndex + 1) % TRAIT_COVER_IDS.length;
  syncTraitCoverPicker();
  doLoad(TRAIT_COVER_IDS[traitCoverIndex]);
});
syncTraitCoverPicker();

animSelect.addEventListener('change', () => {
  playSelectedAnim();
});

colliderDebugBtn.addEventListener('click', () => {
  const next = !cloakCloth.showingColliders;
  cloakCloth.setShowColliders(next, scene);
  colliderDebugBtn.setAttribute('aria-pressed', next ? 'true' : 'false');
  colliderDebugBtn.textContent = next
    ? `Colliders (${cloakCloth.colliderCount})`
    : 'Colliders';
});

particleDebugBtn.addEventListener('click', () => {
  const next = !cloakCloth.showingParticles;
  cloakCloth.setShowParticles(next, scene);
  particleDebugBtn.setAttribute('aria-pressed', next ? 'true' : 'false');
  particleDebugBtn.textContent = next
    ? `Particles (${cloakCloth.particleCount})`
    : 'Particles';
  particlePickHud.hidden = !next;
  if (!next) particlePickHud.textContent = '';
});

let particlePointer: { x: number; y: number } | null = null;
canvas.addEventListener('pointerdown', (e) => {
  if (!cloakCloth.showingParticles) return;
  particlePointer = { x: e.clientX, y: e.clientY };
});
window.addEventListener(
  'pointerup',
  (e) => {
    if (!cloakCloth.showingParticles || !particlePointer) return;
    const dx = e.clientX - particlePointer.x;
    const dy = e.clientY - particlePointer.y;
    particlePointer = null;
    if (dx * dx + dy * dy > 64) return;
    const rect = canvas.getBoundingClientRect();
    if (
      e.clientX < rect.left ||
      e.clientX > rect.right ||
      e.clientY < rect.top ||
      e.clientY > rect.bottom
    ) {
      return;
    }
    const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    const maxNdc = 24 / (rect.width * 0.5);
    const hit = cloakCloth.pickParticle(camera, ndcX, ndcY, maxNdc);
    particlePickHud.hidden = false;
    if (!hit) {
      particlePickHud.textContent = 'no particle';
      return;
    }
    const label = `${hit.family} #${hit.id}${hit.pinned ? ' pinned' : ''}`;
    particlePickHud.textContent = label;
    void navigator.clipboard?.writeText(`${hit.family} ${hit.id}`).catch(() => {});
    console.log('[cloth particle]', hit);
  },
  true,
);

lightDebugBtn.addEventListener('click', () => {
  const next = !lightDebugVisible;
  setLightDebugVisible(next);
  lightDebugBtn.setAttribute('aria-pressed', next ? 'true' : 'false');
});

let ghoulballStartTimer = 0;

function setBgMode(next: BgMode): void {
  const prev = bgMode;
  bgMode = next;
  if (next === 'grid' || next === 'trait') lastSceneBg = next;

  const gridOn = next === 'grid';
  const traitOn = next === 'trait';
  bgModeGridBtn.setAttribute('aria-pressed', gridOn ? 'true' : 'false');
  bgModeGridBtn.setAttribute('aria-selected', gridOn ? 'true' : 'false');
  bgModeTraitBtn.setAttribute('aria-pressed', traitOn ? 'true' : 'false');
  bgModeTraitBtn.setAttribute('aria-selected', traitOn ? 'true' : 'false');
  bgModeGhoulballBtn.setAttribute('aria-pressed', next === 'ghoulball' ? 'true' : 'false');
  const ballRotPane = document.getElementById('ghoulballRotControls');
  if (ballRotPane) ballRotPane.hidden = next !== 'ghoulball';
  if (next === 'ghoulball') syncBallRotUi();
  if (next === 'ghoulball' && playMode.cameraMode === 'follow') setCamMode('fixed');
  else syncCameraChromeForBg();
  syncGridAndBackground();
  if (next !== 'ghoulball') cubeGridWant = 0;

  if (ghoulballStartTimer) {
    window.clearTimeout(ghoulballStartTimer);
    ghoulballStartTimer = 0;
  }

  if (next === 'ghoulball' && assembler) {
    if (prev !== 'ghoulball') {
      lightsBeforeGhoulball = { ...lightMix };
      startLightTween({
        ...GHOULBALL_LIGHTS,
        sun: lightMix.sun,
        sunAzimuth: lightMix.sunAzimuth,
        sunElevation: lightMix.sunElevation,
      });
    }
    // Same Reset as the toolbar button, while Play is still on so Idle snaps the
    // same way. Wait a beat so Idle actually settles, then leave Play and wrap.
    resetGhoulPoseAndCamera();
    const asm = assembler;
    ghoulballStartTimer = window.setTimeout(() => {
      ghoulballStartTimer = 0;
      if (bgMode !== 'ghoulball' || assembler !== asm) return;
      if (appMode === 'play') {
        appMode = 'view';
        appModeViewBtn.setAttribute('aria-selected', 'true');
        appModePlayBtn.setAttribute('aria-selected', 'false');
        animSelect.disabled = false;
        playMode.setEnabled(false, null, null, camera, controls!);
        animator.snapTo('Idle');
        syncPlayBanner();
      }

      const extras: THREE.Object3D[] = [];
      scene.traverse((o) => {
        const pts = o as THREE.Points;
        if (!pts.isPoints) return;
        if (pts.name.startsWith('CudiParticles') || pts.name.startsWith('Cig')) extras.push(pts);
      });
      const refUrl = refImage.src || `/Ghouls/${String(clampGhoulId(Number(ghoulIdInput.value))).padStart(4, '0')}.png`;
      ghoulball.start(asm.root, scene, refUrl, extras);
    }, 50);
  } else if (prev === 'ghoulball' && assembler) {
    ghoulball.stop(assembler.root, true);
    playSelectedAnim();
    if (lightsBeforeGhoulball) {
      setLights(lightsBeforeGhoulball);
      lightsBeforeGhoulball = null;
    } else {
      syncLightControls();
    }
  } else if (
    assembler &&
    (next === 'grid' || next === 'trait') &&
    (prev === 'grid' || prev === 'trait') &&
    prev !== next
  ) {
    resetGhoulPoseAndCamera();
    if (playMode.active) playMode.syncFloorFromRoot();
  }
}

bgModeGridBtn.addEventListener('click', () => setBgMode('grid'));
bgModeTraitBtn.addEventListener('click', () => setBgMode('trait'));
bgModeGhoulballBtn.addEventListener('click', () => {
  setBgMode(bgMode === 'ghoulball' ? lastSceneBg : 'ghoulball');
});

function hasBallRotUi(): boolean {
  return ballRotXInput instanceof HTMLInputElement;
}

let ballRotUiWriting = false;

function syncBallRotUi(): void {
  if (ballRotUiWriting || !hasBallRotUi()) return;
  const r = ghoulball.getRotation();
  ballRotXInput.value = String(r.x);
  ballRotYInput.value = String(r.y);
  ballRotZInput.value = String(r.z);
  ballRotXVal.textContent = r.x.toFixed(0);
  ballRotYVal.textContent = r.y.toFixed(0);
  ballRotZVal.textContent = r.z.toFixed(0);
  const s = ghoulball.getSpin();
  if (ballSpinXInput instanceof HTMLInputElement) {
    ballSpinXInput.value = String(s.x);
    ballSpinYInput.value = String(s.y);
    ballSpinZInput.value = String(s.z);
    ballSpinXVal.textContent = s.x.toFixed(2);
    ballSpinYVal.textContent = s.y.toFixed(2);
    ballSpinZVal.textContent = s.z.toFixed(2);
  }
}

function applyBallRotFromUi(): void {
  if (!hasBallRotUi()) return;
  ballRotUiWriting = true;
  ghoulball.setRotation({
    x: Number(ballRotXInput.value),
    y: Number(ballRotYInput.value),
    z: Number(ballRotZInput.value),
  });
  ballRotUiWriting = false;
  syncBallRotUi();
}

function applyBallSpinFromUi(): void {
  if (!(ballSpinXInput instanceof HTMLInputElement)) return;
  ballRotUiWriting = true;
  ghoulball.setSpin({
    x: Number(ballSpinXInput.value),
    y: Number(ballSpinYInput.value),
    z: Number(ballSpinZInput.value),
  });
  ballRotUiWriting = false;
  syncBallRotUi();
}

if (hasBallRotUi()) {
  for (const input of [ballRotXInput, ballRotYInput, ballRotZInput]) {
    input.addEventListener('pointerdown', () => ghoulball.setSpinPaused(true));
    input.addEventListener('pointerup', () => ghoulball.setSpinPaused(false));
    input.addEventListener('pointercancel', () => ghoulball.setSpinPaused(false));
    input.addEventListener('input', applyBallRotFromUi);
  }
  for (const input of [ballSpinXInput, ballSpinYInput, ballSpinZInput]) {
    input.addEventListener('input', applyBallSpinFromUi);
  }
  ballRotResetBtn.addEventListener('click', () => {
    ghoulball.resetRotation();
    syncBallRotUi();
  });
}

const fxTabs = [
  {
    btn: q<HTMLButtonElement>('#fxTabLights'),
    pane: q<HTMLElement>('#brightnessControls'),
  },
  {
    btn: q<HTMLButtonElement>('#fxTabBloom'),
    pane: q<HTMLElement>('#bloomControls'),
  },
  {
    btn: q<HTMLButtonElement>('#fxTabCloth'),
    pane: q<HTMLElement>('#clothControls'),
  },
  {
    btn: q<HTMLButtonElement>('#fxTabFog'),
    pane: q<HTMLElement>('#fogControls'),
  },
  {
    btn: q<HTMLButtonElement>('#fxTabSun'),
    pane: q<HTMLElement>('#sunControls'),
  },
  {
    btn: q<HTMLButtonElement>('#fxTabOcean'),
    pane: q<HTMLElement>('#oceanControls'),
  },
  {
    btn: q<HTMLButtonElement>('#fxTabBall'),
    pane: q<HTMLElement>('#ballControls'),
  },
  {
    btn: q<HTMLButtonElement>('#fxTabPlay'),
    pane: q<HTMLElement>('#playControls'),
  },
];

function setFxTab(activeBtn: HTMLButtonElement): void {
  for (const tab of fxTabs) {
    const on = tab.btn === activeBtn;
    tab.btn.setAttribute('aria-selected', on ? 'true' : 'false');
    tab.pane.hidden = !on;
  }
}

for (const tab of fxTabs) {
  tab.btn.addEventListener('click', () => setFxTab(tab.btn));
}

function setFogSaveStatus(text: string, kind: '' | 'ok' | 'err' = ''): void {
  fogSaveStatus.textContent = text;
  fogSaveStatus.classList.toggle('is-ok', kind === 'ok');
  fogSaveStatus.classList.toggle('is-err', kind === 'err');
}

function syncFogControls(): void {
  const key = fogBackgroundKey();
  fogUiSyncing = true;
  fogUiKey = key;
  if (!key) {
    if (fogTraitHint instanceof HTMLElement) fogTraitHint.textContent = 'Load a ghoul';
    if (fogEnabledInput instanceof HTMLInputElement) fogEnabledInput.disabled = true;
    if (fogColorInput instanceof HTMLInputElement) fogColorInput.disabled = true;
    if (fogNearInput instanceof HTMLInputElement) fogNearInput.disabled = true;
    if (fogFarInput instanceof HTMLInputElement) fogFarInput.disabled = true;
    if (fogSaveBtn instanceof HTMLButtonElement) fogSaveBtn.disabled = true;
    fogUiSyncing = false;
    return;
  }

  if (fogTraitHint instanceof HTMLElement) {
    fogTraitHint.textContent =
      key === 'None' ? 'No Background trait — scene fog' : `Editing fog for ${key.replace(/_/g, ' ')}`;
  }
  const fog = fogForKey(key);
  if (fogEnabledInput instanceof HTMLInputElement) {
    fogEnabledInput.disabled = false;
    fogEnabledInput.checked = fog.enabled;
  }
  if (fogColorInput instanceof HTMLInputElement) {
    fogColorInput.disabled = false;
    fogColorInput.value = hexToCss(fog.color);
  }
  if (fogNearInput instanceof HTMLInputElement) {
    fogNearInput.disabled = false;
    fogNearInput.value = String(fog.near);
  }
  if (fogFarInput instanceof HTMLInputElement) {
    fogFarInput.disabled = false;
    fogFarInput.value = String(fog.far);
  }
  if (fogSaveBtn instanceof HTMLButtonElement) fogSaveBtn.disabled = false;
  if (fogColorVal instanceof HTMLElement) fogColorVal.textContent = hexToCss(fog.color);
  if (fogNearVal instanceof HTMLElement) fogNearVal.textContent = fog.near.toFixed(2);
  if (fogFarVal instanceof HTMLElement) fogFarVal.textContent = fog.far.toFixed(2);
  fogUiSyncing = false;
}

function writeFogFromControls(): void {
  if (fogUiSyncing || !fogUiKey) return;
  const prev = fogForKey(fogUiKey);
  let near = Number(fogNearInput.value);
  let far = Number(fogFarInput.value);
  if (far < near + 0.05) {
    far = near + 0.05;
    if (fogFarInput instanceof HTMLInputElement) fogFarInput.value = String(far);
  }
  const next: BackgroundFog = {
    // Embed has no Enabled checkbox — moving Near/Far turns fog on.
    enabled: fogEnabledInput instanceof HTMLInputElement ? fogEnabledInput.checked : true,
    color: fogColorInput instanceof HTMLInputElement ? cssToHex(fogColorInput.value) : prev.color,
    near,
    far,
  };
  fogLive.set(fogUiKey, next);
  if (fogColorVal instanceof HTMLElement) fogColorVal.textContent = hexToCss(next.color);
  if (fogNearVal instanceof HTMLElement) fogNearVal.textContent = near.toFixed(2);
  if (fogFarVal instanceof HTMLElement) fogFarVal.textContent = far.toFixed(2);
  applySceneFog();
  setFogSaveStatus('');
}

async function saveFogForCurrentBg(): Promise<void> {
  if (!fogUiKey) return;
  writeFogFromControls();
  const fog = fogForKey(fogUiKey);
  fogSaveBtn.disabled = true;
  setFogSaveStatus('Saving…');
  try {
    const res = await fetch('/__dev/save-materials', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        backgroundFog: { [fogUiKey]: fog },
      }),
    });
    const json = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
    setFogSaveStatus(`Saved ${fogUiKey}`, 'ok');
  } catch (e) {
    setFogSaveStatus(e instanceof Error ? e.message : String(e), 'err');
  } finally {
    fogSaveBtn.disabled = !fogUiKey;
  }
}

for (const el of [fogEnabledInput, fogColorInput, fogNearInput, fogFarInput]) {
  if (!(el instanceof HTMLInputElement)) continue;
  el.addEventListener('input', writeFogFromControls);
  el.addEventListener('change', writeFogFromControls);
}
if (fogSaveBtn instanceof HTMLButtonElement) {
  fogSaveBtn.addEventListener('click', () => {
    void saveFogForCurrentBg();
  });
}

function setSunSaveStatus(text: string, kind: '' | 'ok' | 'err' = ''): void {
  sunSaveStatus.textContent = text;
  sunSaveStatus.classList.toggle('is-ok', kind === 'ok');
  sunSaveStatus.classList.toggle('is-err', kind === 'err');
}

function syncSunControls(): void {
  const key = liveBackgroundKey();
  sunUiSyncing = true;
  sunUiKey = key;
  const inputs = [sunEnabledInput, sunColorInput, sunIntensityInput, sunAzimuthInput, sunElevationInput];
  if (!key) {
    sunTraitHint.textContent = 'Load a ghoul with a Background trait';
    for (const el of inputs) el.disabled = true;
    sunSaveBtn.disabled = true;
    sunUiSyncing = false;
    return;
  }
  sunTraitHint.textContent = `Editing sun for ${key.replace(/_/g, ' ')}`;
  const sun = dirLightForKey(key);
  for (const el of inputs) el.disabled = false;
  sunSaveBtn.disabled = false;
  sunEnabledInput.checked = sun.enabled;
  sunColorInput.value = hexToCss(sun.color);
  sunColorVal.textContent = hexToCss(sun.color);
  sunIntensityInput.value = String(sun.intensity);
  sunAzimuthInput.value = String(sun.azimuth);
  sunElevationInput.value = String(sun.elevation);
  sunIntensityVal.textContent = sun.intensity.toFixed(2);
  sunAzimuthVal.textContent = String(Math.round(sun.azimuth));
  sunElevationVal.textContent = String(Math.round(sun.elevation));
  sunUiSyncing = false;
}

function writeSunFromControls(): void {
  if (sunUiSyncing || !sunUiKey) return;
  const next: BackgroundDirLight = {
    enabled: sunEnabledInput.checked,
    color: cssToHex(sunColorInput.value),
    intensity: Number(sunIntensityInput.value),
    azimuth: Number(sunAzimuthInput.value),
    elevation: Number(sunElevationInput.value),
  };
  dirLightLive.set(sunUiKey, next);
  sunColorVal.textContent = hexToCss(next.color);
  sunIntensityVal.textContent = next.intensity.toFixed(2);
  sunAzimuthVal.textContent = String(Math.round(next.azimuth));
  sunElevationVal.textContent = String(Math.round(next.elevation));
  // Keep Lights-panel sun in sync with FX → Sun edits so the directional light updates live.
  applySunLevelsToLights(
    {
      sun: next.intensity,
      sunAzimuth: next.azimuth,
      sunElevation: next.elevation,
    },
    sunUiKey,
  );
  applyTraitDirLight();
  setSunSaveStatus('');
}

async function saveSunForCurrentBg(): Promise<void> {
  if (!sunUiKey) return;
  writeSunFromControls();
  const sun = dirLightForKey(sunUiKey);
  sunSaveBtn.disabled = true;
  setSunSaveStatus('Saving…');
  try {
    const res = await fetch('/__dev/save-materials', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        backgroundDirLight: { [sunUiKey]: sun },
      }),
    });
    const json = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
    setSunSaveStatus(`Saved ${sunUiKey}`, 'ok');
  } catch (e) {
    setSunSaveStatus(e instanceof Error ? e.message : String(e), 'err');
  } finally {
    sunSaveBtn.disabled = !sunUiKey;
  }
}

for (const el of [sunEnabledInput, sunColorInput, sunIntensityInput, sunAzimuthInput, sunElevationInput]) {
  el.addEventListener('input', writeSunFromControls);
  el.addEventListener('change', writeSunFromControls);
}
sunSaveBtn.addEventListener('click', () => {
  void saveSunForCurrentBg();
});

function setOceanSaveStatus(text: string, kind: '' | 'ok' | 'err' = ''): void {
  oceanSaveStatus.textContent = text;
  oceanSaveStatus.classList.toggle('is-ok', kind === 'ok');
  oceanSaveStatus.classList.toggle('is-err', kind === 'err');
}

function syncOceanControls(): void {
  const key = liveBackgroundKey();
  oceanUiSyncing = true;
  oceanUiKey = key;
  const matInputs = [
    oceanColorInput,
    oceanMetalnessInput,
    oceanRoughnessInput,
    oceanOpacityInput,
    oceanEnvInput,
  ];
  const rippleInputs = [oceanEnabledInput, oceanAmplitudeInput, oceanFrequencyInput, oceanSpeedInput];
  if (!key) {
    oceanTraitHint.textContent = 'Load a ghoul with a Background trait';
    for (const el of [...rippleInputs, ...matInputs, oceanSaveBtn]) el.disabled = true;
    oceanUiSyncing = false;
    return;
  }

  const hasWater = bgScenes.hasWaterPlane(key);
  oceanTraitHint.textContent = hasWater
    ? `Editing ocean for ${key.replace(/_/g, ' ')}`
    : `${key.replace(/_/g, ' ')} — no WaterPlane in this BG`;
  const ripple = rippleForKey(key);
  const mat = oceanMatForKey(key);
  for (const el of rippleInputs) el.disabled = false;
  for (const el of matInputs) el.disabled = !hasWater;
  oceanSaveBtn.disabled = false;
  oceanEnabledInput.checked = ripple.enabled;
  oceanAmplitudeInput.value = String(ripple.amplitude);
  oceanFrequencyInput.value = String(ripple.frequency);
  oceanSpeedInput.value = String(ripple.speed);
  oceanAmplitudeVal.textContent = ripple.amplitude.toFixed(3);
  oceanFrequencyVal.textContent = ripple.frequency.toFixed(2);
  oceanSpeedVal.textContent = ripple.speed.toFixed(2);
  oceanColorInput.value = hexToCss(mat.color);
  oceanColorVal.textContent = hexToCss(mat.color);
  oceanMetalnessInput.value = String(mat.metalness);
  oceanRoughnessInput.value = String(mat.roughness);
  oceanOpacityInput.value = String(mat.opacity);
  oceanEnvInput.value = String(mat.envMapIntensity);
  oceanMetalnessVal.textContent = mat.metalness.toFixed(2);
  oceanRoughnessVal.textContent = mat.roughness.toFixed(2);
  oceanOpacityVal.textContent = mat.opacity.toFixed(2);
  oceanEnvVal.textContent = mat.envMapIntensity.toFixed(2);
  oceanUiSyncing = false;
}

function writeOceanFromControls(): void {
  if (oceanUiSyncing || !oceanUiKey) return;
  const next: BackgroundRipple = {
    enabled: oceanEnabledInput.checked,
    amplitude: Number(oceanAmplitudeInput.value),
    frequency: Number(oceanFrequencyInput.value),
    speed: Number(oceanSpeedInput.value),
  };
  const mat: BackgroundOceanMat = {
    color: cssToHex(oceanColorInput.value),
    metalness: Number(oceanMetalnessInput.value),
    roughness: Number(oceanRoughnessInput.value),
    opacity: Number(oceanOpacityInput.value),
    envMapIntensity: Number(oceanEnvInput.value),
  };
  rippleLive.set(oceanUiKey, next);
  oceanMatLive.set(oceanUiKey, mat);
  oceanAmplitudeVal.textContent = next.amplitude.toFixed(3);
  oceanFrequencyVal.textContent = next.frequency.toFixed(2);
  oceanSpeedVal.textContent = next.speed.toFixed(2);
  oceanColorVal.textContent = hexToCss(mat.color);
  oceanMetalnessVal.textContent = mat.metalness.toFixed(2);
  oceanRoughnessVal.textContent = mat.roughness.toFixed(2);
  oceanOpacityVal.textContent = mat.opacity.toFixed(2);
  oceanEnvVal.textContent = mat.envMapIntensity.toFixed(2);
  bgScenes.setRipple(next);
  bgScenes.setOceanMaterial(oceanUiKey, mat);
  setOceanSaveStatus('');
}

async function saveOceanForCurrentBg(): Promise<void> {
  if (!oceanUiKey) return;
  writeOceanFromControls();
  const ripple = rippleForKey(oceanUiKey);
  const mat = oceanMatForKey(oceanUiKey);
  oceanSaveBtn.disabled = true;
  setOceanSaveStatus('Saving…');
  try {
    const res = await fetch('/__dev/save-materials', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        backgroundRipple: { [oceanUiKey]: ripple },
        backgroundOceanMat: { [oceanUiKey]: mat },
      }),
    });
    const json = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
    setOceanSaveStatus(`Saved ${oceanUiKey}`, 'ok');
  } catch (e) {
    setOceanSaveStatus(e instanceof Error ? e.message : String(e), 'err');
  } finally {
    oceanSaveBtn.disabled = !oceanUiKey;
  }
}

for (const el of [
  oceanEnabledInput,
  oceanAmplitudeInput,
  oceanFrequencyInput,
  oceanSpeedInput,
  oceanColorInput,
  oceanMetalnessInput,
  oceanRoughnessInput,
  oceanOpacityInput,
  oceanEnvInput,
]) {
  el.addEventListener('input', writeOceanFromControls);
  el.addEventListener('change', writeOceanFromControls);
}
oceanSaveBtn.addEventListener('click', () => {
  void saveOceanForCurrentBg();
});

function isRangeInput(el: HTMLElement): el is HTMLInputElement {
  return el instanceof HTMLInputElement && el.type === 'range';
}

function syncBallControlsFromParams(): void {
  const p = ghoulball.getMaterialParams();
  if (isRangeInput(ballSwirlInput)) {
    ballSwirlInput.value = String(p.swirl);
    ballSwirlVal.textContent = p.swirl.toFixed(2);
  }
  if (isRangeInput(ballMetalnessInput)) {
    ballMetalnessInput.value = String(p.metalness);
    ballMetalnessVal.textContent = p.metalness.toFixed(2);
  }
  if (isRangeInput(ballRoughnessInput)) {
    ballRoughnessInput.value = String(p.roughness);
    ballRoughnessVal.textContent = p.roughness.toFixed(2);
  }
  if (isRangeInput(ballClearcoatInput)) {
    ballClearcoatInput.value = String(p.clearcoat);
    ballClearcoatVal.textContent = p.clearcoat.toFixed(2);
  }
  if (isRangeInput(ballClearcoatRoughnessInput)) {
    ballClearcoatRoughnessInput.value = String(p.clearcoatRoughness);
    ballClearcoatRoughnessVal.textContent = p.clearcoatRoughness.toFixed(2);
  }
  if (isRangeInput(ballEnvInput)) {
    ballEnvInput.value = String(p.envMapIntensity);
    ballEnvVal.textContent = p.envMapIntensity.toFixed(2);
  }
  if (isRangeInput(ballReflectivityInput)) {
    ballReflectivityInput.value = String(p.reflectivity);
    ballReflectivityVal.textContent = p.reflectivity.toFixed(2);
  }
}

function writeBallFromControls(): void {
  const next: Partial<GhoulballMaterialParams> = {};
  if (isRangeInput(ballSwirlInput)) {
    next.swirl = Number(ballSwirlInput.value);
    ballSwirlVal.textContent = next.swirl.toFixed(2);
  }
  if (isRangeInput(ballMetalnessInput)) {
    next.metalness = Number(ballMetalnessInput.value);
    ballMetalnessVal.textContent = next.metalness.toFixed(2);
  }
  if (isRangeInput(ballRoughnessInput)) {
    next.roughness = Number(ballRoughnessInput.value);
    ballRoughnessVal.textContent = next.roughness.toFixed(2);
  }
  if (isRangeInput(ballClearcoatInput)) {
    next.clearcoat = Number(ballClearcoatInput.value);
    ballClearcoatVal.textContent = next.clearcoat.toFixed(2);
  }
  if (isRangeInput(ballClearcoatRoughnessInput)) {
    next.clearcoatRoughness = Number(ballClearcoatRoughnessInput.value);
    ballClearcoatRoughnessVal.textContent = next.clearcoatRoughness.toFixed(2);
  }
  if (isRangeInput(ballEnvInput)) {
    next.envMapIntensity = Number(ballEnvInput.value);
    ballEnvVal.textContent = next.envMapIntensity.toFixed(2);
  }
  if (isRangeInput(ballReflectivityInput)) {
    next.reflectivity = Number(ballReflectivityInput.value);
    ballReflectivityVal.textContent = next.reflectivity.toFixed(2);
  }
  if (Object.keys(next).length) ghoulball.setMaterialParams(next);
}

{
  const d = DEFAULT_GHOULBALL_MATERIAL;
  if (isRangeInput(ballSwirlInput)) ballSwirlInput.value = String(d.swirl);
  if (isRangeInput(ballMetalnessInput)) ballMetalnessInput.value = String(d.metalness);
  if (isRangeInput(ballRoughnessInput)) ballRoughnessInput.value = String(d.roughness);
  if (isRangeInput(ballClearcoatInput)) ballClearcoatInput.value = String(d.clearcoat);
  if (isRangeInput(ballClearcoatRoughnessInput)) {
    ballClearcoatRoughnessInput.value = String(d.clearcoatRoughness);
  }
  if (isRangeInput(ballEnvInput)) ballEnvInput.value = String(d.envMapIntensity);
  if (isRangeInput(ballReflectivityInput)) ballReflectivityInput.value = String(d.reflectivity);
  syncBallControlsFromParams();
}
for (const el of [
  ballSwirlInput,
  ballMetalnessInput,
  ballRoughnessInput,
  ballClearcoatInput,
  ballClearcoatRoughnessInput,
  ballEnvInput,
  ballReflectivityInput,
]) {
  if (!isRangeInput(el)) continue;
  el.addEventListener('input', writeBallFromControls);
  el.addEventListener('change', writeBallFromControls);
}

function writePlayFromControls(): void {
  if (!(playWalkSpeedInput instanceof HTMLInputElement)) return;
  const next = {
    walkSpeed: Number(playWalkSpeedInput.value),
    turnSpeed: Number(playTurnSpeedInput.value),
  };
  playWalkSpeedVal.textContent = next.walkSpeed.toFixed(2);
  playTurnSpeedVal.textContent = next.turnSpeed.toFixed(2);
  playMode.setParams(next);
}

{
  const d = DEFAULT_PLAY_PARAMS;
  playWalkSpeedInput.value = String(d.walkSpeed);
  playTurnSpeedInput.value = String(d.turnSpeed);
  playWalkSpeedVal.textContent = d.walkSpeed.toFixed(2);
  playTurnSpeedVal.textContent = d.turnSpeed.toFixed(2);
  playMode.setParams(d);
}
for (const el of [playWalkSpeedInput, playTurnSpeedInput]) {
  el.addEventListener('input', writePlayFromControls);
  el.addEventListener('change', writePlayFromControls);
}

window.addEventListener('popstate', () => {
  doLoad(ghoulIdFromUrl());
});

function animate(): void {
  requestAnimationFrame(animate);
  if (!renderer || !controls) return;
  const dt = clock.getDelta();
  if (!ghoulball.frozen) {
    animator.update(dt);
    cloakCloth.update(dt);
    cigSmoke.update(dt);
    cudiParticles.update(dt);
  }
  playMode.update(dt, ghoulball.frozen);
  updateLightTween(dt);
  syncLightsToGhoul();
  ghoulball.update(dt);
  updateCubeGrid(dt);
  bgScenes.update(dt);
  updateLightHelpers();
  if (playMode.orbitDrive) {
    constrainOrbitToFloor();
    controls.update();
    applyCamRoll();
  }
  clampCameraToFloor();
  if (playMode.cameraMode === 'follow') syncFollowCamUi();
  if (bgMode === 'ghoulball') syncBallRotUi();
  if (dither) dither.render(renderer, scene, camera);
  else renderer.render(scene, camera);
}

async function boot(): Promise<void> {
  try {
    attachEngine();
    if (!renderer || !controls) return;
    controls.addEventListener('start', () => {
      if (bgMode !== 'ghoulball' || ghoulball.isDragging) return;
      if (isOrbitRotating(controls!)) cubeGridWant = 1;
    });
    controls.addEventListener('end', () => {
      cubeGridWant = 0;
    });
    const initialId = updateUrlFlag ? ghoulIdFromUrl() : currentId;
    currentId = clampGhoulId(initialId);
    const palette = await loadCalmPalette();
    dither = new DitherComposer(renderer, palette);
    syncBloomControls();

    if (updateUrlFlag) document.title = `GhoulViewer · ${DISPLAY_SIZE}px`;

    await loadTraitData();
    assembler = await createAssembler();
    scene.add(assembler.root);
    ghoulball.attachInput(camera, canvas, controls);
    playMode.attach();

    assembler.root.traverse((o) => {
      if (o.name.startsWith('Magica ')) o.visible = false;
    });

    animator.bind(assembler.root, assembler.animations);
    cloakCloth.bind(assembler.root);
    frameCharacter(assembler);
    doLoad(currentId);
  } catch (e) {
    console.error(e);
  }
}

function setAnim(name: AnimName): void {
  animSelect.value = name;
  playSelectedAnim();
}

function buildApi(): GhoulViewer {
  return {
    get ready() {
      return bootPromise ?? Promise.resolve();
    },
    load(id: number) {
      doLoad(id);
    },
    getId() {
      return currentId;
    },
    setLights,
    getLights() {
      return { ...lightMix };
    },
    resetLights,
    setView,
    getView,
    resetView,
    setBloom,
    getBloom,
    resetBloom,
    setMode: setAppMode,
    getMode() {
      return appMode;
    },
    setCamera: setCamMode,
    getCamera() {
      return playMode.cameraMode;
    },
    setFollow,
    getFollow,
    resetFollow,
    setBackground: setBgMode,
    getBackground() {
      return bgMode;
    },
    setAnim,
    getAnim: selectedAnim,
    reset: resetGhoulAndCamera,
  };
}

let viewerApi: GhoulViewer | null = null;
let onGhoulLoad: ((id: number) => void) | undefined;

export function mountGhoulViewer(
  host: HTMLElement,
  options: GhoulViewerOptions = {},
): GhoulViewer {
  updateUrlFlag = options.updateUrl ?? false;
  if (options.onLoad) onGhoulLoad = options.onLoad;
  host.classList.add('ghoul-viewer-host');
  if (canvas.parentElement !== host) host.appendChild(canvas);

  if (options.id != null) currentId = clampGhoulId(options.id);

  if (!bootPromise) bootPromise = boot();

  const api = viewerApi ?? (viewerApi = buildApi());

  void api.ready.then(() => {
    if (options.id != null) doLoad(options.id);
    if (options.lights) setLights(options.lights);
    if (options.view) setView(options.view);
    if (options.bloom) setBloom(options.bloom);
    if (options.anim) setAnim(options.anim);
    if (options.mode) setAppMode(options.mode);
    if (options.camera) setCamMode(options.camera);
    if (options.background) setBgMode(options.background);
  });

  return api;
}

declare global {
  interface Window {
    GhoulViewer: {
      mount: typeof mountGhoulViewer;
    };
  }
}

window.GhoulViewer = { mount: mountGhoulViewer };

if (document.querySelector('#c')) {
  updateUrlFlag = true;
  currentId = ghoulIdFromUrl();
  bootPromise = boot();
  viewerApi = buildApi();
}
