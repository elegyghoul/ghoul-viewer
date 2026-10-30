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
import { CloakClothManager, DEFAULT_CLOTH_PARAMS, holdWeightRgb, type ClothParticleHit } from './cloth';
import { CigSmokeManager } from './cigSmoke';
import { SpecialOrbitManager } from './headOrbit';
import { IdolTrailManager } from './idolTrail';
import { EyeLookManager, type EyeMoveMode } from './eyeLook';
import { CandleFlameManager, EyeFlameManager, InfernalFlameManager, TorchFlameManager } from './torchFlame';
import { HaloLightManager } from './haloLight';
import { GlassesLightManager } from './glassesLight';
import { PositronicLights } from './positronicLights';
import { bindToxicSlime, updateToxicSlime } from './toxicSlime';
import { bindToxicMist, updateToxicMist } from './toxicMist';
import { DroolManager, DROOL_PRESETS } from './drool';
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
  backgroundHasPointLight,
  backgroundHasSkyTint,
  backgroundOceanMat,
  backgroundPointLight,
  backgroundRipple,
  backgroundSkyTint,
  bindBeamSway,
  updateBeamSway,
  updateNc69rDisplayScroll,
  updateXeDisplayScroll,
  cssToHex,
  enableBloomLayer,
  SKY_LIGHT_LAYER,
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
import { assetUrl, shellRoot } from './assetUrl';

/** Studio controls, or a detached dummy so embed pages need no UI shell panels. */
function q<T extends HTMLElement>(sel: string): T {
  return (shellRoot().querySelector(sel) as T | null) ?? (document.createElement('div') as unknown as T);
}

function byId<T extends HTMLElement = HTMLElement>(id: string): T | null {
  return shellRoot().querySelector<T>('#' + CSS.escape(id));
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

/** Scene distance fog (Trait background, or ghouls with no background). */
export type FogLevels = {
  enabled: boolean;
  /** 0xRRGGBB */
  color: number;
  near: number;
  far: number;
};

export type FogPatch = {
  enabled?: boolean;
  /** Hex number (`0x240019`) or CSS (`'#240019'`). */
  color?: number | string;
  near?: number;
  far?: number;
};

/** Ghoulball pose + the embed material sliders. Rotation is degrees; spin is rad/s. */
export type BallLevels = {
  rotation: Vec3;
  spin: Vec3;
  metalness: number;
  roughness: number;
  swirl: number;
  clearcoat: number;
  clearcoatRoughness: number;
  envMapIntensity: number;
  reflectivity: number;
};

export type BallPatch = {
  rotation?: Partial<Vec3>;
  spin?: Partial<Vec3>;
  metalness?: number;
  roughness?: number;
  swirl?: number;
  clearcoat?: number;
  clearcoatRoughness?: number;
  envMapIntensity?: number;
  reflectivity?: number;
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
  fog?: FogPatch;
  ball?: BallPatch;
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
  setFog(levels: FogPatch): void;
  getFog(): FogLevels;
  resetFog(): void;
  setBall(levels: BallPatch): void;
  getBall(): BallLevels;
  resetBall(): void;
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
  shellRoot().querySelector<HTMLCanvasElement>('#c') ?? document.createElement('canvas');
const cleanCanvas = shellRoot().querySelector<HTMLCanvasElement>('#cClean');

let renderer: THREE.WebGLRenderer | null = null;
let cleanRenderer: THREE.WebGLRenderer | null = null;
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
  if (cleanCanvas && !cleanRenderer) {
    cleanRenderer = new THREE.WebGLRenderer({ canvas: cleanCanvas, antialias: false, alpha: false });
    cleanRenderer.setPixelRatio(1);
    cleanRenderer.setSize(PIXEL_SIZE, PIXEL_SIZE, false);
    cleanRenderer.outputColorSpace = THREE.SRGBColorSpace;
    cleanRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    cleanRenderer.toneMappingExposure = 1;
    cleanRenderer.shadowMap.enabled = true;
    cleanRenderer.shadowMap.type = THREE.BasicShadowMap;
    cleanRenderer.shadowMap.autoUpdate = false;
  }
  controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 1.0, 0);
  controls.enableDamping = true;
  controls.minDistance = orbitMinDistance();
  applyCameraNear();
  controls.maxDistance = 10;
  controls.maxPolarAngle = Math.PI / 2;
  controls.addEventListener('change', syncCamUiFromCamera);
  controls.update();
  animate();
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);

const camera = new THREE.PerspectiveCamera(35, 1, 0.05, SKYBOX_CLIP_FAR);
camera.layers.enable(SKY_LIGHT_LAYER);
camera.position.set(0, 1.1, 2.8);
const _camOff = new THREE.Vector3();
const _camSph = new THREE.Spherical();
const _camFwd = new THREE.Vector3();

/** World floor plane. Camera stays this far above it (also > near clip). */
const FLOOR_Y = 0;
const CAMERA_FLOOR_CLEARANCE = 0.12;
/** Usual orbit dolly limit, in metres from the look target. */
const ORBIT_MIN_DISTANCE = 1;
/** Close-zoom dolly limit. Near clip drops with it so the mesh is not cut off. */
const ORBIT_CLOSE_DISTANCE = 0.12;
const CAMERA_NEAR = 0.05;
const CAMERA_NEAR_CLOSE = 0.01;

function closeZoomEnabled(): boolean {
  const box = byId('closeZoom');
  return box instanceof HTMLInputElement && box.checked;
}

function orbitMinDistance(): number {
  return closeZoomEnabled() ? ORBIT_CLOSE_DISTANCE : ORBIT_MIN_DISTANCE;
}

function applyCameraNear(): void {
  camera.near = closeZoomEnabled() ? CAMERA_NEAR_CLOSE : CAMERA_NEAR;
  camera.updateProjectionMatrix();
}

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
dirLight.layers.enable(SKY_LIGHT_LAYER);
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
    if (
      !light.isLight ||
      MANAGED_LIGHTS.has(light) ||
      light.name === 'TorchFlameLight' ||
      light.name === 'EyeFlameLight' ||
      light.name === 'InfernalFlameLight' ||
      light.name === 'CandleFlameLight' ||
      light.name === 'HaloPointLight'
    )
      return;
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
        const skyMesh = mesh.name.startsWith('Skybox') || mesh.name.startsWith('GradientSky');
        if (skyMesh) {
          // Trait BG domes are not part of the point-light rig. Restore a full
          // colour if an earlier pass already stored a dimmed base.
          if (mat instanceof THREE.MeshBasicMaterial) {
            const base = unlitColorBase.get(mat);
            if (base) {
              mat.color.copy(base);
              unlitColorBase.delete(mat);
            }
          }
          continue;
        }
        if (mat instanceof THREE.MeshBasicMaterial) {
          let base = unlitColorBase.get(mat);
          if (!base) {
            base = mat.color.clone();
            unlitColorBase.set(mat, base);
          }
          // Halos emit their own colour, so the point-light master does not dim them.
          if (mat.name.includes('Halo')) {
            mat.color.copy(base);
            continue;
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
/** 1/1 Ghoul Pegs (#0207) has no Background trait. Trait BG is this flat clear. */
const GHOUL_PEGS_ID = 207;
const GHOUL_PEGS_BG = 0xf6e2b4;
/** 1/1 Crayola (#2181) has no Background trait. Trait BG is Based Loans. */
const CRAYOLA_BG = 'Based_Loans';

function liveBackgroundKey(): string | null {
  if (currentTraits?.unique === 'Crayola') return CRAYOLA_BG;
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
    if (t.slot === 'clouds' || t.slot === 'tint' || t.slot === 'point') continue;
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

const bgSkyTintLive = new Map<string, number>();

function skyTintFromEditor(key: string): number | null {
  if (selectedTraitKey !== 'background') return null;
  if (currentTraits?.background !== key) return null;
  for (const e of editorEntries) {
    const t = e.saveTarget;
    if (!t || t.kind !== 'background' || t.key !== key || t.slot !== 'tint') continue;
    const withColor = e.material as THREE.Material & { color?: THREE.Color };
    if (!withColor.color?.isColor) continue;
    return withColor.color.getHex() & 0xffffff;
  }
  return null;
}

function skyTintForKey(key: string): number {
  return skyTintFromEditor(key) ?? bgSkyTintLive.get(key) ?? backgroundSkyTint(key);
}

const pointLightLive = new Map<string, { color: number; intensity: number }>();

function pointColorFromEditor(key: string): number | null {
  if (selectedTraitKey !== 'background') return null;
  if (currentTraits?.background !== key) return null;
  for (const e of editorEntries) {
    const t = e.saveTarget;
    if (!t || t.kind !== 'background' || t.key !== key || t.slot !== 'point') continue;
    const withColor = e.material as THREE.Material & { color?: THREE.Color };
    if (!withColor.color?.isColor) continue;
    return withColor.color.getHex() & 0xffffff;
  }
  return null;
}

function pointLightForKey(key: string): { color: number; intensity: number } {
  const saved = backgroundPointLight(key) ?? { color: 0xfff6ea, intensity: 28000 };
  const live = pointLightLive.get(key);
  return {
    color: pointColorFromEditor(key) ?? live?.color ?? saved.color,
    intensity: live?.intensity ?? saved.intensity,
  };
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
    const g =
      currentId === GHOUL_PEGS_ID
        ? { top: GHOUL_PEGS_BG, bottom: GHOUL_PEGS_BG, distance: DEFAULT_GRADIENT_DISTANCE }
        : key
          ? gradientForKey(key)
          : { top: GRID_CLEAR, bottom: GRID_CLEAR, distance: DEFAULT_GRADIENT_DISTANCE };
    // Flat clear matches horizon; the sphere skybox carries the vertical gradient.
    scene.background = new THREE.Color(g.bottom);
    bgScenes.setClearGradient(g.top, g.bottom, g.distance ?? DEFAULT_GRADIENT_DISTANCE);
    if (key) {
      bgScenes.setCloudColor(cloudColorForKey(key));
      bgScenes.setSkyTint(key, skyTintForKey(key));
      if (backgroundHasPointLight(key)) {
        const point = pointLightForKey(key);
        bgScenes.setPoolLight(key, point.color, point.intensity);
      }
    }
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
      bgScenes.setSkyTint(key, skyTintForKey(key));
      if (backgroundHasPointLight(key)) {
        const point = pointLightForKey(key);
        bgScenes.setPoolLight(key, point.color, point.intensity);
      }
      applyOceanMatIfSet(key);
      if (
        selectedTraitKey === 'background' &&
        currentTraits?.background === key &&
        !editorEntries.some(
          (e) => e.saveTarget?.kind === 'background' && e.saveTarget.slot === 'columns',
        )
      ) {
        appendColumnMaterialCard(key);
      }
      if (
        selectedTraitKey === 'background' &&
        currentTraits?.background === key &&
        !editorEntries.some(
          (e) => e.saveTarget?.kind === 'background' && e.saveTarget.slot === 'palms' && e.saveTarget.key === key,
        )
      ) {
        appendPalmMaterialCard(key);
      }
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
void cloakCloth.loadWeightOverrides();
const cigSmoke = new CigSmokeManager();
const torchFlame = new TorchFlameManager();
const eyeFlame = new EyeFlameManager();
const candleFlame = new CandleFlameManager();
const eyeLook = new EyeLookManager();
eyeLook.attach(canvas);
const infernalFlame = new InfernalFlameManager();
const specialOrbit = new SpecialOrbitManager();
const idolTrail = new IdolTrailManager();
const haloLight = new HaloLightManager();
const glassesLight = new GlassesLightManager();
const positronicLights = new PositronicLights();
const cudiParticles = new CudiParticleManager();
const drool = new DroolManager();
const ghoulball = new GhoulballController();
const playMode = new PlayController();
let assembler: GhoulAssembler | null = null;
let dither: DitherComposer | null = null;
let cleanDither: DitherComposer | null = null;
let currentId = 0;
let updateUrlFlag = !!byId('workspace');
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
const lightGlassesInput = q<HTMLInputElement>('#lightGlasses');
const lightGlassesDistInput = q<HTMLInputElement>('#lightGlassesDist');
const lightGlassesRangeInput = q<HTMLInputElement>('#lightGlassesRange');
const lightGlassesVal = q<HTMLSpanElement>('#lightGlassesVal');
const lightGlassesDistVal = q<HTMLSpanElement>('#lightGlassesDistVal');
const lightGlassesRangeVal = q<HTMLSpanElement>('#lightGlassesRangeVal');

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
const clothWeightHint = q<HTMLElement>('#clothWeightHint');
const clothWeightInput = q<HTMLInputElement>('#clothWeight');
const clothWeightVal = q<HTMLSpanElement>('#clothWeightVal');
const clothWeightMark = q<HTMLElement>('#clothWeightMark');
const clothWeightMirrorInput = q<HTMLInputElement>('#clothWeightMirror');
const clothHitchSelect = q<HTMLSelectElement>('#clothHitch');
const clothHitchDistInput = q<HTMLInputElement>('#clothHitchDist');
const clothHitchDistVal = q<HTMLSpanElement>('#clothHitchDistVal');
const clothHitchFollowInput = q<HTMLInputElement>('#clothHitchFollow');
const clothHitchFollowVal = q<HTMLSpanElement>('#clothHitchFollowVal');
const clothWeightSaveBtn = q<HTMLButtonElement>('#clothWeightSaveBtn');
const clothWeightResetBtn = q<HTMLButtonElement>('#clothWeightResetBtn');
const clothWeightSaveStatus = q<HTMLElement>('#clothWeightSaveStatus');
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
const animButtons = [...shellRoot().querySelectorAll<HTMLButtonElement>('.anim-btn[data-anim]')];
const eyeMoveButtons = [...shellRoot().querySelectorAll<HTMLButtonElement>('.eye-move-btn')];
const colliderDebugBtn = q<HTMLButtonElement>('#colliderDebugBtn');
const particleDebugBtn = q<HTMLButtonElement>('#particleDebugBtn');
const pinDebugBtn = q<HTMLButtonElement>('#pinDebugBtn');
const particlePickHud = q<HTMLSpanElement>('#particlePickHud');
const particlePickName = q<HTMLSpanElement>('#particlePickName');
const particlePickAngle = q<HTMLSpanElement>('#particlePickAngle');
const particlePickHeight = q<HTMLSpanElement>('#particlePickHeight');
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
const sceneVertsEl = q<HTMLElement>('#sceneVerts');
const sceneTrisEl = q<HTMLElement>('#sceneTris');
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

/**
 * Colour to show and save. Unlit materials (beams, eyes) are dimmed in place by
 * the light rig; the authored colour lives in unlitColorBase.
 */
function authoredColorHex(mat: THREE.Material): number | null {
  const stored = unlitColorBase.get(mat as THREE.MeshBasicMaterial);
  if (stored) return stored.getHex() & 0xffffff;
  const withColor = mat as THREE.Material & { color?: THREE.Color };
  if (withColor.color?.isColor) return withColor.color.getHex() & 0xffffff;
  return null;
}

function colorFromMaterial(mat: THREE.Material): string {
  const hex = authoredColorHex(mat);
  return hex == null ? '#000000' : hexToCss(hex);
}

function setMaterialColor(mat: THREE.Material, css: string, label?: string): void {
  const hex = cssToHex(css);
  const withColor = mat as THREE.Material & { color?: THREE.Color };
  if (withColor.color && withColor.color.isColor) {
    withColor.color.setHex(hex);
    const stored = unlitColorBase.get(mat as THREE.MeshBasicMaterial);
    if (stored) stored.setHex(hex);
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
  background?: Record<
    string,
    {
      color?: number;
      top?: number;
      bottom?: number;
      clouds?: number;
      distance?: number;
      tint?: number;
      pointColor?: number;
      pointIntensity?: number;
      columnsColor?: number;
      columnsRoughness?: number;
      columnsMetalness?: number;
      palmsColor?: number;
      palmsRoughness?: number;
      palmsMetalness?: number;
    }
  >;
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
    {
      color?: number;
      top?: number;
      bottom?: number;
      clouds?: number;
      distance?: number;
      tint?: number;
      pointColor?: number;
      pointIntensity?: number;
      columnsColor?: number;
      columnsRoughness?: number;
      columnsMetalness?: number;
      palmsColor?: number;
      palmsRoughness?: number;
      palmsMetalness?: number;
    }
  > = {};
  const seen = new Set<string>();

  for (const entry of editorEntries) {
    const target = entry.saveTarget;
    if (!target) continue;
    const key = saveTargetKey(target);
    // One write per palette key (Body/Head Light share a target and stay synced).
    if (seen.has(key)) continue;
    seen.add(key);

    const color = authoredColorHex(entry.material);
    if (color == null) continue;

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
      } else if (target.slot === 'tint') {
        row.tint = color;
      } else if (target.slot === 'point') {
        const point = pointLightForKey(target.key);
        row.pointColor = color;
        row.pointIntensity = point.intensity;
      } else if (target.slot === 'columns') {
        const std = entry.material as THREE.MeshStandardMaterial;
        row.columnsColor = color;
        row.columnsRoughness = std.roughness;
        row.columnsMetalness = std.metalness;
      } else if (target.slot === 'palms') {
        const std = entry.material as THREE.MeshStandardMaterial;
        row.palmsColor = color;
        row.palmsRoughness = std.roughness;
        row.palmsMetalness = std.metalness;
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
    if (v.tint != null) bits.push(`${k} tint ${hexToCss(v.tint)}`);
    if (v.pointColor != null) bits.push(`${k} point ${hexToCss(v.pointColor)} ×${v.pointIntensity ?? ''}`);
    if (v.columnsColor != null) bits.push(`${k} columns ${hexToCss(v.columnsColor)}`);
    if (v.palmsColor != null) bits.push(`${k} trees ${hexToCss(v.palmsColor)}`);
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

/** One card for every column in a background. They share a single material. */
function appendColumnMaterialCard(key: string): void {
  const mats = bgScenes.columnMaterials(key);
  const mat = mats[0];
  if (!mat) return;
  if (
    editorEntries.some(
      (e) => e.saveTarget?.kind === 'background' && e.saveTarget.slot === 'columns' && e.saveTarget.key === key,
    )
  ) {
    return;
  }
  const entry: EditableMaterial = {
    label: `${key} · Columns`,
    material: mat,
    lit: true,
    saveTarget: { kind: 'background', key, slot: 'columns' },
  };
  editorEntries.push(entry);
  for (const extra of mats.slice(1)) {
    editorEntries.push({ ...entry, material: extra });
  }

  const card = document.createElement('div');
  card.className = 'mat-card';
  const title = document.createElement('div');
  title.className = 'mat-card-title';
  title.textContent = 'Columns';
  const meta = document.createElement('div');
  meta.className = 'mat-card-meta';
  meta.textContent = 'Lit · every column · savable';
  card.append(title, meta);

  const colorRow = document.createElement('label');
  colorRow.className = 'mat-color-row';
  colorRow.append('Colour');
  const colorInput = document.createElement('input');
  colorInput.type = 'color';
  colorInput.value = colorFromMaterial(mat);
  const colorVal = document.createElement('span');
  colorVal.className = 'mat-val';
  colorVal.textContent = colorInput.value;
  colorInput.addEventListener('input', () => {
    applyColorToGroup(entry, colorInput.value);
    colorVal.textContent = hexToCss(cssToHex(colorInput.value));
  });
  colorRow.append(colorInput, colorVal);

  const roughRow = document.createElement('label');
  roughRow.append('Roughness');
  const roughInput = document.createElement('input');
  roughInput.type = 'range';
  roughInput.min = '0';
  roughInput.max = '1';
  roughInput.step = '0.01';
  roughInput.value = String(mat.roughness);
  const roughVal = document.createElement('span');
  roughVal.className = 'mat-val';
  roughVal.textContent = mat.roughness.toFixed(2);
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
  metalInput.value = String(mat.metalness);
  const metalVal = document.createElement('span');
  metalVal.className = 'mat-val';
  metalVal.textContent = mat.metalness.toFixed(2);
  metalInput.addEventListener('input', () => {
    const v = Number(metalInput.value);
    applyFinishToGroup(entry, 'metalness', v);
    metalVal.textContent = v.toFixed(2);
  });
  metalRow.append(metalInput, metalVal);

  card.append(colorRow, roughRow, metalRow);
  materialList.append(card);
  if (!materialHint.textContent.includes('columns')) {
    materialHint.textContent = `${materialHint.textContent} · columns`;
  }
  syncSaveButton();
}

/** One card for every palm in a background. They share a single material, keyed by trait. */
function appendPalmMaterialCard(key: string): void {
  const mats = bgScenes.palmMaterials(key);
  const mat = mats[0];
  if (!mat) return;
  if (
    editorEntries.some(
      (e) => e.saveTarget?.kind === 'background' && e.saveTarget.slot === 'palms' && e.saveTarget.key === key,
    )
  ) {
    return;
  }
  // Trait key, not the shared Retro_Palms file. Saving Neon_Palms must not write Retro_Palms.
  const entry: EditableMaterial = {
    label: `${key} · Trees`,
    material: mat,
    lit: true,
    saveTarget: { kind: 'background', key, slot: 'palms' },
  };
  editorEntries.push(entry);
  for (const extra of mats.slice(1)) {
    editorEntries.push({ ...entry, material: extra });
  }

  const card = document.createElement('div');
  card.className = 'mat-card';
  const title = document.createElement('div');
  title.className = 'mat-card-title';
  title.textContent = 'Trees';
  const meta = document.createElement('div');
  meta.className = 'mat-card-meta';
  meta.textContent = 'Lit · every palm · savable';
  card.append(title, meta);

  const colorRow = document.createElement('label');
  colorRow.className = 'mat-color-row';
  colorRow.append('Colour');
  const colorInput = document.createElement('input');
  colorInput.type = 'color';
  colorInput.value = colorFromMaterial(mat);
  const colorVal = document.createElement('span');
  colorVal.className = 'mat-val';
  colorVal.textContent = colorInput.value;
  colorInput.addEventListener('input', () => {
    applyColorToGroup(entry, colorInput.value);
    colorVal.textContent = hexToCss(cssToHex(colorInput.value));
  });
  colorRow.append(colorInput, colorVal);

  const roughRow = document.createElement('label');
  roughRow.append('Roughness');
  const roughInput = document.createElement('input');
  roughInput.type = 'range';
  roughInput.min = '0';
  roughInput.max = '1';
  roughInput.step = '0.01';
  roughInput.value = String(mat.roughness);
  const roughVal = document.createElement('span');
  roughVal.className = 'mat-val';
  roughVal.textContent = mat.roughness.toFixed(2);
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
  metalInput.value = String(mat.metalness);
  const metalVal = document.createElement('span');
  metalVal.className = 'mat-val';
  metalVal.textContent = mat.metalness.toFixed(2);
  metalInput.addEventListener('input', () => {
    const v = Number(metalInput.value);
    applyFinishToGroup(entry, 'metalness', v);
    metalVal.textContent = v.toFixed(2);
  });
  metalRow.append(metalInput, metalVal);

  card.append(colorRow, roughRow, metalRow);
  materialList.append(card);
  if (!materialHint.textContent.includes('trees')) {
    materialHint.textContent = `${materialHint.textContent} · trees`;
  }
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
    const showSkyTint = backgroundHasSkyTint(key);
    if (showSkyTint) {
      const tintHex = bgSkyTintLive.get(key) ?? backgroundSkyTint(key);
      editorEntries.push({
        label: `${key} · Tint`,
        material: new THREE.MeshBasicMaterial({ color: tintHex }),
        lit: false,
        saveTarget: { kind: 'background', key, slot: 'tint' },
      });
    }
    const showPoint = backgroundHasPointLight(key);
    if (showPoint) {
      const point = pointLightForKey(key);
      editorEntries.push({
        label: `${key} · Point`,
        material: new THREE.MeshBasicMaterial({ color: point.color }),
        lit: false,
        saveTarget: { kind: 'background', key, slot: 'point' },
      });
    }
    materialHint.textContent = showPoint
      ? `${formatTraitValue(key)} · point light · savable`
      : showSkyTint
        ? `${formatTraitValue(key)} · ocean sphere tint · savable`
        : `${formatTraitValue(key)} · skybox gradient${showClouds ? ' + clouds' : ''} · savable`;
    const card = document.createElement('div');
    card.className = 'mat-card';
    const title = document.createElement('div');
    title.className = 'mat-card-title';
    title.textContent = key;
    const meta = document.createElement('div');
    meta.className = 'mat-card-meta';
    meta.textContent = showPoint
      ? 'Ocean sphere · point light · savable'
      : showSkyTint
        ? 'Ocean sphere · tint × texture · savable'
        : showClouds
          ? 'Skybox gradient + clouds · savable'
          : 'Skybox gradient · top → bottom · savable';
    card.append(title, meta);

    for (const entry of editorEntries) {
      const slot = entry.saveTarget?.kind === 'background' ? entry.saveTarget.slot : 'top';
      if (slot === 'clouds' || slot === 'tint' || slot === 'point') continue;
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

    for (const entry of editorEntries) {
      const slot = entry.saveTarget?.kind === 'background' ? entry.saveTarget.slot : 'top';
      if (slot !== 'tint') continue;
      const row = document.createElement('label');
      row.className = 'mat-color-row';
      row.append('Tint');
      const colorInput = document.createElement('input');
      colorInput.type = 'color';
      colorInput.value = colorFromMaterial(entry.material);
      const val = document.createElement('span');
      val.className = 'mat-val';
      val.textContent = colorInput.value;
      colorInput.addEventListener('input', () => {
        applyColorToGroup(entry, colorInput.value);
        val.textContent = hexToCss(cssToHex(colorInput.value));
        const tint = skyTintFromEditor(key);
        if (tint != null) {
          bgSkyTintLive.set(key, tint);
          bgScenes.setSkyTint(key, tint);
        }
      });
      row.append(colorInput, val);
      card.append(row);
    }

    if (showPoint) {
      const point = pointLightForKey(key);
      const applyPoint = (color: number, intensity: number): void => {
        pointLightLive.set(key, { color, intensity });
        bgScenes.setPoolLight(key, color, intensity);
      };
      for (const entry of editorEntries) {
        const slot = entry.saveTarget?.kind === 'background' ? entry.saveTarget.slot : 'top';
        if (slot !== 'point') continue;
        const row = document.createElement('label');
        row.className = 'mat-color-row';
        row.append('Point');
        const colorInput = document.createElement('input');
        colorInput.type = 'color';
        colorInput.value = colorFromMaterial(entry.material);
        const val = document.createElement('span');
        val.className = 'mat-val';
        val.textContent = colorInput.value;
        colorInput.addEventListener('input', () => {
          applyColorToGroup(entry, colorInput.value);
          val.textContent = hexToCss(cssToHex(colorInput.value));
          const color = pointColorFromEditor(key);
          if (color != null) applyPoint(color, pointLightForKey(key).intensity);
        });
        row.append(colorInput, val);
        card.append(row);
      }
      const strengthRow = document.createElement('label');
      strengthRow.title = 'Centre point light strength. Only the Pool 1 sky receives it.';
      strengthRow.append('Point strength');
      const strengthInput = document.createElement('input');
      strengthInput.type = 'range';
      strengthInput.min = '0';
      strengthInput.max = '100000';
      strengthInput.step = '100';
      strengthInput.value = String(point.intensity);
      const strengthVal = document.createElement('span');
      strengthVal.className = 'mat-val';
      strengthVal.textContent = String(Math.round(point.intensity));
      strengthInput.addEventListener('input', () => {
        const intensity = Number(strengthInput.value);
        strengthVal.textContent = String(Math.round(intensity));
        const color = pointLightForKey(key).color;
        applyPoint(color, intensity);
        dirtySaveKeys.add(`background:${key}:point`);
      });
      strengthRow.append(strengthInput, strengthVal);
      card.append(strengthRow);
    }
    materialList.append(card);
    appendColumnMaterialCard(key);
    appendPalmMaterialCard(key);
    syncSaveButton();
    syncGridAndBackground();
    return;
  }

  let entries = assembler.getMaterialsForTrait(category, value);
  if (category === 'special' && value === 'Infernal_Flame') {
    entries = [...infernalFlame.materials(), ...entries];
  }
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
            : entry.saveTarget.slot === 'columns'
              ? 'Columns'
              : entry.saveTarget.slot === 'palms'
                ? 'Trees'
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

/** Skin painted on the body when a unique forces it and the Ghoul trait is None. */
function forcedBodySkin(): string | null {
  if (!currentTraits || currentTraits.ghoul !== 'None' || !assembler) return null;
  const skin = assembler.skinBase;
  if (!skin || skin === 'None') return null;
  return skin;
}

function selectTrait(category: keyof GhoulTraits): void {
  if (!currentTraits) return;
  const value = currentTraits[category];
  if (typeof value !== 'string' || !value) return;
  const forcedSkin = category === 'ghoul' ? forcedBodySkin() : null;
  if (value === 'None' && category !== 'background' && !forcedSkin) return;

  selectedTraitKey = category;
  for (const row of traitsListEl.querySelectorAll('.trait-row')) {
    const selected = (row as HTMLElement).dataset.key === category;
    row.classList.toggle('is-selected', selected);
    row.setAttribute('aria-pressed', selected ? 'true' : 'false');
  }
  showMaterialEditor(category, forcedSkin ?? value);
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

function syncGlassesLight(): void {
  if (lightGlassesInput instanceof HTMLInputElement) {
    glassesLight.setStrength(Number(lightGlassesInput.value));
    if (lightGlassesVal.isConnected) lightGlassesVal.textContent = Number(lightGlassesInput.value).toFixed(3);
  }
  if (lightGlassesDistInput instanceof HTMLInputElement) {
    glassesLight.setDistance(Number(lightGlassesDistInput.value));
    if (lightGlassesDistVal.isConnected) {
      lightGlassesDistVal.textContent = Number(lightGlassesDistInput.value).toFixed(2);
    }
  }
  if (lightGlassesRangeInput instanceof HTMLInputElement) {
    glassesLight.setRange(Number(lightGlassesRangeInput.value));
    if (lightGlassesRangeVal.isConnected) {
      lightGlassesRangeVal.textContent = Number(lightGlassesRangeInput.value).toFixed(2);
    }
  }
}

lightGlassesInput.addEventListener('input', syncGlassesLight);
lightGlassesDistInput.addEventListener('input', syncGlassesLight);
lightGlassesRangeInput.addEventListener('input', syncGlassesLight);
syncGlassesLight();

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
  const bodySkin = traits.ghoul === 'None' ? forcedBodySkin() : null;
  for (const { key, label } of TRAIT_LABELS) {
    const value = traits[key];
    if (typeof value !== 'string') continue;
    const display = key === 'ghoul' && bodySkin ? bodySkin : value;
    if (!display || display === 'None') continue;
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
    dd.textContent = formatTraitValue(display);
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
  refImage.src = assetUrl(`/Ghouls/${padded}.png`);
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

let clothWeightSyncing = false;
let clothWeightPick: { family: string; id: number; mirrorId: number } | null = null;

function setClothWeightStatus(text: string, kind: '' | 'ok' | 'err' = ''): void {
  if (!(clothWeightSaveStatus instanceof HTMLElement) || !clothWeightSaveStatus.isConnected) return;
  clothWeightSaveStatus.textContent = text;
  clothWeightSaveStatus.classList.toggle('is-ok', kind === 'ok');
  clothWeightSaveStatus.classList.toggle('is-err', kind === 'err');
}

function refreshPinnedButton(): void {
  if (!(pinDebugBtn instanceof HTMLButtonElement) || !pinDebugBtn.isConnected) return;
  if (pinDebugBtn.getAttribute('aria-pressed') !== 'true') return;
  pinDebugBtn.textContent = `Pinned (${cloakCloth.pinnedCount})`;
}

function syncClothHitchSelect(family: string | null, id: number): void {
  if (!(clothHitchSelect instanceof HTMLSelectElement) || !clothHitchSelect.isConnected) return;
  if (!family) {
    clothHitchSelect.value = '';
    clothHitchSelect.disabled = true;
    syncClothHitchDistance();
    syncClothHitchFollow();
    return;
  }
  clothHitchSelect.disabled = false;
  clothHitchSelect.value = cloakCloth.particleHitchName(family, id) ?? '';
  syncClothHitchDistance();
  syncClothHitchFollow();
}

function syncClothHitchDistance(): void {
  const hasSlider = clothHitchDistInput instanceof HTMLInputElement && clothHitchDistInput.isConnected;
  if (!hasSlider) return;
  const dists = cloakCloth.selectionHitchDistances();
  if (dists.length === 0) {
    clothHitchDistInput.disabled = true;
    clothHitchDistInput.value = '0';
    if (clothHitchDistVal instanceof HTMLElement && clothHitchDistVal.isConnected) {
      clothHitchDistVal.textContent = '—';
    }
    return;
  }
  const first = dists[0]!;
  const same = dists.every((d) => Math.abs(d - first) <= 0.001);
  const shown = same ? first : dists.reduce((sum, d) => sum + d, 0) / dists.length;
  clothHitchDistInput.disabled = false;
  clothHitchDistInput.max = String(Math.max(0.6, ...dists, shown));
  clothHitchDistInput.value = String(shown);
  if (clothHitchDistVal instanceof HTMLElement && clothHitchDistVal.isConnected) {
    clothHitchDistVal.textContent = same ? (shown * 100).toFixed(1) : 'mix';
  }
}

function syncClothHitchFollow(): void {
  const hasSlider = clothHitchFollowInput instanceof HTMLInputElement && clothHitchFollowInput.isConnected;
  if (!hasSlider) return;
  const amounts = cloakCloth.selectionHitchFollows();
  if (amounts.length === 0) {
    clothHitchFollowInput.disabled = true;
    clothHitchFollowInput.value = '1';
    if (clothHitchFollowVal instanceof HTMLElement && clothHitchFollowVal.isConnected) {
      clothHitchFollowVal.textContent = '—';
    }
    return;
  }
  const first = amounts[0]!;
  const same = amounts.every((amount) => Math.abs(amount - first) <= 0.005);
  const shown = same ? first : amounts.reduce((sum, amount) => sum + amount, 0) / amounts.length;
  clothHitchFollowInput.disabled = false;
  clothHitchFollowInput.value = String(shown);
  if (clothHitchFollowVal instanceof HTMLElement && clothHitchFollowVal.isConnected) {
    clothHitchFollowVal.textContent = same ? String(Math.round(shown * 100)) : 'mix';
  }
}

function paintClothWeightReadout(weight: number): void {
  if (clothWeightVal instanceof HTMLElement && clothWeightVal.isConnected) {
    clothWeightVal.textContent = weight.toFixed(2);
    const [r, g, b] = holdWeightRgb(weight);
    clothWeightVal.style.color = `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
  }
  if (clothWeightMark instanceof HTMLElement && clothWeightMark.isConnected) {
    clothWeightMark.style.left = `${Math.min(1, Math.max(0, weight)) * 100}%`;
  }
}

function particleWeightLabel(family: string, id: number, weight: number, mirrorId: number): string {
  const mirror = mirrorId >= 0 ? ` · mirror #${mirrorId}` : '';
  return `${family} #${id} · weight ${weight.toFixed(2)}${mirror}`;
}

function syncClothWeightPanel(hit: ClothParticleHit | null): void {
  clothWeightSyncing = true;
  const hasSlider = clothWeightInput instanceof HTMLInputElement && clothWeightInput.isConnected;
  if (!hit || !hasSlider) {
    clothWeightPick = hit
      ? { family: hit.family, id: hit.id, mirrorId: hit.mirrorId }
      : clothWeightPick;
    if (!hit) clothWeightPick = null;
    if (clothWeightHint instanceof HTMLElement && clothWeightHint.isConnected) {
      clothWeightHint.textContent = hit
        ? `${hit.family} #${hit.id}`
        : 'Show Particles, then click one on the cloak';
    }
    if (hasSlider && !hit) clothWeightInput.disabled = true;
    if (clothWeightResetBtn instanceof HTMLButtonElement && clothWeightResetBtn.isConnected) {
      clothWeightResetBtn.disabled = !hit;
    }
    if (hit) paintClothWeightReadout(hit.weight);
    syncClothHitchSelect(hit ? hit.family : null, hit ? hit.id : -1);
    clothWeightSyncing = false;
    return;
  }
  clothWeightPick = { family: hit.family, id: hit.id, mirrorId: hit.mirrorId };
  if (clothWeightHint instanceof HTMLElement && clothWeightHint.isConnected) {
    clothWeightHint.textContent = `${hit.family} #${hit.id}`;
  }
  clothWeightInput.disabled = false;
  clothWeightInput.value = (Math.round(hit.weight * 100) / 100).toFixed(2);
  if (clothWeightResetBtn instanceof HTMLButtonElement && clothWeightResetBtn.isConnected) {
    clothWeightResetBtn.disabled = false;
  }
  paintClothWeightReadout(hit.weight);
  syncClothHitchSelect(hit.family, hit.id);
  clothWeightSyncing = false;
}

function applyClothWeightFromUi(): void {
  if (clothWeightSyncing || !clothWeightPick) return;
  if (!(clothWeightInput instanceof HTMLInputElement)) return;
  const weight = Number(clothWeightInput.value);
  const mirror = clothWeightMirrorInput instanceof HTMLInputElement && clothWeightMirrorInput.checked;
  cloakCloth.setParticleWeight(clothWeightPick.family, clothWeightPick.id, weight, mirror);
  if (clothHitchSelect instanceof HTMLSelectElement && clothHitchSelect.isConnected) {
    clothHitchSelect.value = '';
  }
  syncClothHitchDistance();
  refreshPinnedButton();
  paintClothWeightReadout(weight);
  if (particlePickName.isConnected) {
    particlePickName.textContent = particleWeightLabel(
      clothWeightPick.family,
      clothWeightPick.id,
      weight,
      clothWeightPick.mirrorId,
    );
  }
  setClothWeightStatus('Unsaved');
}

function resetClothWeightFromUi(): void {
  if (!clothWeightPick) return;
  const mirror = clothWeightMirrorInput instanceof HTMLInputElement && clothWeightMirrorInput.checked;
  cloakCloth.resetParticleWeight(clothWeightPick.family, clothWeightPick.id, mirror);
  const weight = cloakCloth.particleHold(clothWeightPick.family, clothWeightPick.id) ?? 0;
  clothWeightSyncing = true;
  if (clothWeightInput instanceof HTMLInputElement && clothWeightInput.isConnected) {
    clothWeightInput.value = (Math.round(weight * 100) / 100).toFixed(2);
  }
  clothWeightSyncing = false;
  paintClothWeightReadout(weight);
  syncClothHitchSelect(clothWeightPick.family, clothWeightPick.id);
  refreshPinnedButton();
  if (particlePickName.isConnected) {
    particlePickName.textContent = particleWeightLabel(
      clothWeightPick.family,
      clothWeightPick.id,
      weight,
      clothWeightPick.mirrorId,
    );
  }
  setClothWeightStatus('Unsaved');
}

async function saveClothWeights(): Promise<void> {
  if (!(clothWeightSaveBtn instanceof HTMLButtonElement) || !clothWeightSaveBtn.isConnected) return;
  clothWeightSaveBtn.disabled = true;
  setClothWeightStatus('Saving…');
  try {
    const res = await fetch('/__dev/save-cloth-weights', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cloakCloth.exportWeightOverrides()),
    });
    const json = await readDevSaveJson(res);
    if (!json.ok) throw new Error(json.error || `HTTP ${res.status}`);
    setClothWeightStatus('Saved', 'ok');
  } catch (e) {
    setClothWeightStatus(devSaveError(e), 'err');
  } finally {
    clothWeightSaveBtn.disabled = false;
  }
}

if (clothWeightInput instanceof HTMLInputElement && clothWeightInput.isConnected) {
  clothWeightInput.addEventListener('input', applyClothWeightFromUi);
}
if (clothWeightMirrorInput instanceof HTMLInputElement && clothWeightMirrorInput.isConnected) {
  clothWeightMirrorInput.addEventListener('change', () => {
    if (!clothWeightMirrorInput.checked || !clothWeightPick) return;
    const bone =
      clothHitchSelect instanceof HTMLSelectElement && clothHitchSelect.isConnected
        ? clothHitchSelect.value
        : '';
    const dist =
      clothHitchDistInput instanceof HTMLInputElement && clothHitchDistInput.isConnected
        ? Number(clothHitchDistInput.value)
        : 0;
    const follow =
      clothHitchFollowInput instanceof HTMLInputElement && clothHitchFollowInput.isConnected
        ? Number(clothHitchFollowInput.value)
        : 1;
    applyClothWeightFromUi();
    if (!bone) return;
    cloakCloth.setSelectionHitch(bone, true);
    if (Number.isFinite(dist)) {
      cloakCloth.setSelectionHitchDistance(dist, true);
    }
    if (Number.isFinite(follow)) {
      cloakCloth.setSelectionHitchFollow(follow, true);
    }
    clothWeightSyncing = true;
    syncClothHitchSelect(clothWeightPick.family, clothWeightPick.id);
    clothWeightSyncing = false;
    refreshPinnedButton();
  });
}
if (clothHitchSelect instanceof HTMLSelectElement && clothHitchSelect.isConnected) {
  clothHitchSelect.addEventListener('change', () => {
    if (clothWeightSyncing || !clothWeightPick) return;
    const bone = clothHitchSelect.value === '' ? null : clothHitchSelect.value;
    const mirror = clothWeightMirrorInput instanceof HTMLInputElement && clothWeightMirrorInput.checked;
    if (cloakCloth.selectionCount === 0) {
      cloakCloth.setParticleHitch(clothWeightPick.family, clothWeightPick.id, bone, mirror);
    } else {
      cloakCloth.setSelectionHitch(bone, mirror);
    }
    clothWeightSyncing = true;
    syncClothHitchDistance();
    syncClothHitchFollow();
    clothWeightSyncing = false;
    setClothWeightStatus('Unsaved');
    refreshPinnedButton();
  });
}
if (clothHitchDistInput instanceof HTMLInputElement && clothHitchDistInput.isConnected) {
  clothHitchDistInput.addEventListener('input', () => {
    if (clothWeightSyncing || !clothWeightPick) return;
    if (clothHitchDistInput.disabled) return;
    const meters = Number(clothHitchDistInput.value);
    if (!Number.isFinite(meters)) return;
    const mirror = clothWeightMirrorInput instanceof HTMLInputElement && clothWeightMirrorInput.checked;
    cloakCloth.setSelectionHitchDistance(meters, mirror);
    if (clothHitchDistVal instanceof HTMLElement && clothHitchDistVal.isConnected) {
      clothHitchDistVal.textContent = (meters * 100).toFixed(1);
    }
    setClothWeightStatus('Unsaved');
  });
}
if (clothHitchFollowInput instanceof HTMLInputElement && clothHitchFollowInput.isConnected) {
  clothHitchFollowInput.addEventListener('input', () => {
    if (clothWeightSyncing || !clothWeightPick) return;
    if (clothHitchFollowInput.disabled) return;
    const amount = Number(clothHitchFollowInput.value);
    if (!Number.isFinite(amount)) return;
    const mirror = clothWeightMirrorInput instanceof HTMLInputElement && clothWeightMirrorInput.checked;
    cloakCloth.setSelectionHitchFollow(amount, mirror);
    if (clothHitchFollowVal instanceof HTMLElement && clothHitchFollowVal.isConnected) {
      clothHitchFollowVal.textContent = String(Math.round(amount * 100));
    }
    setClothWeightStatus('Unsaved');
  });
}
if (clothWeightResetBtn instanceof HTMLButtonElement && clothWeightResetBtn.isConnected) {
  clothWeightResetBtn.addEventListener('click', resetClothWeightFromUi);
}
if (clothWeightSaveBtn instanceof HTMLButtonElement && clothWeightSaveBtn.isConnected) {
  clothWeightSaveBtn.addEventListener('click', () => {
    void saveClothWeights();
  });
}

type ClothParticleGroup = {
  id: string;
  name: string;
  members: Record<string, number[]>;
};

const clothGroupSelect = q<HTMLSelectElement>('#clothGroup');
const clothGroupCount = q<HTMLElement>('#clothGroupCount');
const clothGroupNameInput = q<HTMLInputElement>('#clothGroupName');
const clothGroupCreateBtn = q<HTMLButtonElement>('#clothGroupCreateBtn');
const clothGroupDeleteBtn = q<HTMLButtonElement>('#clothGroupDeleteBtn');
const clothGroupSelectBtn = q<HTMLButtonElement>('#clothGroupSelectBtn');
const clothGroupAssignBtn = q<HTMLButtonElement>('#clothGroupAssignBtn');
const clothGroupRemoveBtn = q<HTMLButtonElement>('#clothGroupRemoveBtn');
const clothGroupStatus = q<HTMLElement>('#clothGroupStatus');

let clothGroups: ClothParticleGroup[] = [];

function setClothGroupStatus(text: string, kind: '' | 'ok' | 'err' = ''): void {
  if (!(clothGroupStatus instanceof HTMLElement) || !clothGroupStatus.isConnected) return;
  clothGroupStatus.textContent = text;
  clothGroupStatus.classList.toggle('is-ok', kind === 'ok');
  clothGroupStatus.classList.toggle('is-err', kind === 'err');
}

function clothGroupById(id: string): ClothParticleGroup | undefined {
  return clothGroups.find((group) => group.id === id);
}

function clothGroupMemberTotal(group: ClothParticleGroup): number {
  let n = 0;
  for (const ids of Object.values(group.members)) n += ids.length;
  return n;
}

function refreshClothGroupUi(): void {
  if (!(clothGroupSelect instanceof HTMLSelectElement) || !clothGroupSelect.isConnected) return;
  const current = clothGroupSelect.value;
  clothGroupSelect.replaceChildren();
  if (clothGroups.length === 0) {
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = 'No groups';
    clothGroupSelect.append(empty);
  } else {
    for (const group of clothGroups) {
      const option = document.createElement('option');
      option.value = group.id;
      option.textContent = group.name;
      clothGroupSelect.append(option);
    }
    if (clothGroups.some((group) => group.id === current)) clothGroupSelect.value = current;
  }
  const group = clothGroupById(clothGroupSelect.value);
  const total = group ? clothGroupMemberTotal(group) : 0;
  if (clothGroupCount instanceof HTMLElement && clothGroupCount.isConnected) {
    clothGroupCount.textContent = group ? String(total) : '';
  }
  const hasGroup = group != null;
  const hasSelection = cloakCloth.selectionCount > 0;
  if (clothGroupDeleteBtn instanceof HTMLButtonElement) clothGroupDeleteBtn.disabled = !hasGroup;
  if (clothGroupSelectBtn instanceof HTMLButtonElement) clothGroupSelectBtn.disabled = !hasGroup || total === 0;
  if (clothGroupAssignBtn instanceof HTMLButtonElement) clothGroupAssignBtn.disabled = !hasGroup || !hasSelection;
  if (clothGroupRemoveBtn instanceof HTMLButtonElement) clothGroupRemoveBtn.disabled = !hasGroup || !hasSelection;
}

function clothGroupIdFromName(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const root = base || 'group';
  const taken = new Set(clothGroups.map((group) => group.id));
  let id = root;
  let n = 2;
  while (taken.has(id)) {
    const suffix = `-${n}`;
    id = `${root.slice(0, 40 - suffix.length)}${suffix}`;
    n++;
  }
  return id;
}

function addGroupMembers(group: ClothParticleGroup, particles: readonly { family: string; id: number }[]): number {
  let added = 0;
  for (const particle of particles) {
    const list = group.members[particle.family] ?? [];
    if (list.includes(particle.id)) continue;
    list.push(particle.id);
    list.sort((a, b) => a - b);
    group.members[particle.family] = list;
    added++;
  }
  return added;
}

function removeGroupMembers(group: ClothParticleGroup, particles: readonly { family: string; id: number }[]): number {
  let removed = 0;
  for (const particle of particles) {
    const list = group.members[particle.family];
    if (!list) continue;
    const next = list.filter((id) => id !== particle.id);
    removed += list.length - next.length;
    if (next.length === 0) delete group.members[particle.family];
    else group.members[particle.family] = next;
  }
  return removed;
}

async function readDevSaveJson(res: Response): Promise<{ ok?: boolean; error?: string }> {
  const text = await res.text();
  try {
    return JSON.parse(text) as { ok?: boolean; error?: string };
  } catch {
    throw new Error('LOCAL_ONLY');
  }
}

function devSaveError(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  if (message === 'LOCAL_ONLY' || message === 'Failed to fetch') {
    return 'Saving only works in the local viewer';
  }
  return message;
}

async function saveClothGroups(): Promise<boolean> {
  try {
    const res = await fetch('/__dev/save-cloth-groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groups: clothGroups }),
    });
    const json = await readDevSaveJson(res);
    if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
    return true;
  } catch (e) {
    setClothGroupStatus(devSaveError(e), 'err');
    return false;
  }
}

async function loadClothGroups(): Promise<void> {
  try {
    const res = await fetch(assetUrl('/data/cloth-particle-groups.json'), { cache: 'no-store' });
    if (!res.ok) return;
    const data = (await res.json()) as { groups?: ClothParticleGroup[] };
    if (!Array.isArray(data.groups)) return;
    clothGroups = data.groups.flatMap((group) => {
      if (!group || typeof group.id !== 'string' || typeof group.name !== 'string' || !group.members) return [];
      const members: Record<string, number[]> = {};
      for (const [family, ids] of Object.entries(group.members)) {
        if (!Array.isArray(ids)) continue;
        const clean = ids.filter((id) => Number.isInteger(id) && id >= 0);
        if (clean.length > 0) members[family] = clean;
      }
      return [{ id: group.id, name: group.name, members }];
    });
  } catch {
    clothGroups = [];
  }
  refreshClothGroupUi();
}

if (clothGroupSelect instanceof HTMLSelectElement && clothGroupSelect.isConnected) {
  clothGroupSelect.addEventListener('change', () => {
    refreshClothGroupUi();
    setClothGroupStatus('');
  });
}

if (clothGroupNameInput instanceof HTMLInputElement && clothGroupNameInput.isConnected) {
  clothGroupNameInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (clothGroupCreateBtn instanceof HTMLButtonElement) clothGroupCreateBtn.click();
  });
}

if (clothGroupCreateBtn instanceof HTMLButtonElement && clothGroupCreateBtn.isConnected) {
  clothGroupCreateBtn.addEventListener('click', () => {
    const name = clothGroupNameInput instanceof HTMLInputElement ? clothGroupNameInput.value.trim() : '';
    if (!name) {
      setClothGroupStatus('Name the group first', 'err');
      return;
    }
    const group: ClothParticleGroup = { id: clothGroupIdFromName(name), name: name.slice(0, 40), members: {} };
    clothGroups.push(group);
    if (clothGroupNameInput instanceof HTMLInputElement) clothGroupNameInput.value = '';
    refreshClothGroupUi();
    if (clothGroupSelect instanceof HTMLSelectElement) clothGroupSelect.value = group.id;
    refreshClothGroupUi();
    setClothGroupStatus('Saving…');
    void saveClothGroups().then((ok) => {
      if (ok) setClothGroupStatus(`Saved “${group.name}”`, 'ok');
    });
  });
}

if (clothGroupDeleteBtn instanceof HTMLButtonElement && clothGroupDeleteBtn.isConnected) {
  clothGroupDeleteBtn.addEventListener('click', () => {
    if (!(clothGroupSelect instanceof HTMLSelectElement)) return;
    const group = clothGroupById(clothGroupSelect.value);
    if (!group) return;
    clothGroups = clothGroups.filter((entry) => entry.id !== group.id);
    refreshClothGroupUi();
    setClothGroupStatus('Saving…');
    void saveClothGroups().then((ok) => {
      if (ok) setClothGroupStatus(`Deleted “${group.name}”`, 'ok');
    });
  });
}

if (clothGroupSelectBtn instanceof HTMLButtonElement && clothGroupSelectBtn.isConnected) {
  clothGroupSelectBtn.addEventListener('click', () => {
    if (!(clothGroupSelect instanceof HTMLSelectElement)) return;
    const group = clothGroupById(clothGroupSelect.value);
    if (!group) return;
    const hits = cloakCloth.hitsForMembers(group.members);
    const absent = cloakCloth.absentMemberCount(group.members);
    showParticleSelection(hits);
    if (hits.length === 0 && absent === 0) {
      setClothGroupStatus(`“${group.name}” is empty`, 'err');
      return;
    }
    const extra = absent > 0 ? ` · ${absent} on another cloak` : '';
    const see = cloakCloth.showingParticles ? '' : ' · turn Particles on to see them';
    setClothGroupStatus(`Selected ${hits.length}${extra}${see}`, 'ok');
  });
}

if (clothGroupAssignBtn instanceof HTMLButtonElement && clothGroupAssignBtn.isConnected) {
  clothGroupAssignBtn.addEventListener('click', () => {
    if (!(clothGroupSelect instanceof HTMLSelectElement)) return;
    const group = clothGroupById(clothGroupSelect.value);
    if (!group) return;
    const added = addGroupMembers(group, cloakCloth.selectedParticles());
    refreshClothGroupUi();
    setClothGroupStatus('Saving…');
    void saveClothGroups().then((ok) => {
      if (ok) setClothGroupStatus(added > 0 ? `Assigned ${added} to “${group.name}”` : 'Already in that group', 'ok');
    });
  });
}

if (clothGroupRemoveBtn instanceof HTMLButtonElement && clothGroupRemoveBtn.isConnected) {
  clothGroupRemoveBtn.addEventListener('click', () => {
    if (!(clothGroupSelect instanceof HTMLSelectElement)) return;
    const group = clothGroupById(clothGroupSelect.value);
    if (!group) return;
    const removed = removeGroupMembers(group, cloakCloth.selectedParticles());
    refreshClothGroupUi();
    setClothGroupStatus('Saving…');
    void saveClothGroups().then((ok) => {
      if (ok) setClothGroupStatus(removed > 0 ? `Removed ${removed} from “${group.name}”` : 'None of those were in the group', 'ok');
    });
  });
}

void loadClothGroups();

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
  camera.position.set(target.x - dist * 0.2, target.y + height * 0.05, target.z + dist);
  applyCameraNear();
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
      const ballRotPane = byId('ghoulballRotControls');
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

function syncAnimButtons(): void {
  const current = selectedAnim();
  const locked = appMode === 'play';
  for (const btn of animButtons) {
    btn.disabled = locked;
    btn.setAttribute('aria-pressed', btn.dataset.anim === current ? 'true' : 'false');
  }
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
  syncAnimButtons();
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
  const fixedPane = byId('camFixedControls');
  const followPane = byId('camFollowControls');
  if (fixedPane) fixedPane.hidden = next === 'follow';
  if (followPane) followPane.hidden = next !== 'follow';
  if (next === 'follow') syncFollowCamUi();
  if (next === 'fixed' && fromFollow) resetView();
  syncCameraChromeForBg();
}

function syncCameraChromeForBg(): void {
  const ball = bgMode === 'ghoulball';
  const modeTabs = byId('camModeTabs');
  const rotPane = byId('camRotControls');
  const followPane = byId('camFollowControls');
  // Fixed/Follow tabs only in Play (and never during Ghoulball).
  if (modeTabs) modeTabs.hidden = ball || appMode !== 'play';
  if (rotPane) rotPane.hidden = ball;
  if (ball) {
    if (followPane) followPane.hidden = true;
    const fixedPane = byId('camFixedControls');
    if (fixedPane) fixedPane.hidden = false;
  } else if (appMode === 'view') {
    // View is always the Fixed control set; Follow pane stays tucked away.
    if (followPane) followPane.hidden = true;
    const fixedPane = byId('camFixedControls');
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
  _camSph.radius = Math.min(10, Math.max(orbitMinDistance(), zoom));
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
    if (playMode.active) playMode.syncFloorFromRoot();
    bindToxicSlime(assembler.root);
    bindToxicMist(assembler.root, scene);
    // The tattered sim is created once, and sleeve verts are pinned to the
    // arm pose at that moment. play() does not sample until the next frame,
    // so a direct load is still on the GLB T-pose: the forearms are out, the
    // cloak pins an outward offset, and it hangs off the ribs. A later switch
    // builds the sim after Idle is already playing.
    animator.snapTo(playMode.active ? 'Idle' : selectedAnim());
    if (playMode.active) playMode.refreshLocomotion();
    cloakCloth.sync();
    drool.sync(assembler.root, scene, [
      { anchorNames: ['Sludge Mouth', 'Sludge_Mouth'], style: DROOL_PRESETS.sludge },
      { anchorNames: ['Blood Mouth', 'Blood_Mouth'], style: DROOL_PRESETS.blood },
    ]);
    cigSmoke.sync(assembler.root, scene);
    torchFlame.sync(assembler.root, scene);
    eyeFlame.sync(assembler.root, scene);
    candleFlame.sync(assembler.root, scene);
    eyeLook.sync(assembler.root);
    infernalFlame.sync(assembler.root, scene);
    specialOrbit.sync(assembler.root);
    idolTrail.sync(assembler.root, scene);
    haloLight.sync(assembler.root);
    glassesLight.sync(assembler.root);
    positronicLights.sync(assembler.root);
    void cudiParticles.sync(assembler.root, scene);
    playSelectedAnim();
    assembler.syncEyepatch();
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
        if (pts.name.startsWith('CudiParticles') || pts.name.startsWith('Cig') || pts.name.startsWith('TorchFlame') || pts.name.startsWith('EyeFlame') || pts.name.startsWith('InfernalFlame') || pts.name.startsWith('CandleFlame')) extras.push(pts);
      });
      const refUrl =
        refImage.src || assetUrl(`/Ghouls/${String(n).padStart(4, '0')}.png`);
      ghoulball.start(assembler.root, scene, refUrl, extras);
      reapplyStoredBall();
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

const closeZoomInput = q<HTMLInputElement>('#closeZoom');
if (closeZoomInput instanceof HTMLInputElement && closeZoomInput.isConnected) {
  closeZoomInput.addEventListener('change', () => {
    if (!controls) return;
    controls.minDistance = orbitMinDistance();
    applyCameraNear();
    if (!closeZoomEnabled() && controls.getDistance() < ORBIT_MIN_DISTANCE) {
      applyCamZoom(ORBIT_MIN_DISTANCE);
    } else {
      controls.update();
    }
  });
}
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
  syncAnimButtons();
  playSelectedAnim();
});

for (const btn of animButtons) {
  btn.addEventListener('click', () => {
    const name = btn.dataset.anim as AnimName | undefined;
    if (!name || appMode === 'play') return;
    setAnim(name);
  });
}

function setEyeMove(mode: EyeMoveMode): void {
  eyeLook.setMode(mode);
  for (const btn of eyeMoveButtons) {
    btn.setAttribute('aria-pressed', btn.dataset.eyeMove === mode ? 'true' : 'false');
  }
}

for (const btn of eyeMoveButtons) {
  btn.addEventListener('click', () => {
    const mode = btn.dataset.eyeMove;
    if (mode !== 'none' && mode !== 'natural' && mode !== 'follow') return;
    setEyeMove(mode);
  });
}

colliderDebugBtn.addEventListener('click', () => {
  const next = !cloakCloth.showingColliders;
  cloakCloth.setShowColliders(next, scene);
  colliderDebugBtn.setAttribute('aria-pressed', next ? 'true' : 'false');
  colliderDebugBtn.textContent = next
    ? `Colliders (${cloakCloth.colliderCount})`
    : 'Colliders';
});

const particleCullBtn = q<HTMLButtonElement>('#particleCullBtn');
if (particleCullBtn instanceof HTMLButtonElement && particleCullBtn.isConnected) {
  particleCullBtn.addEventListener('click', () => {
    const next = particleCullBtn.getAttribute('aria-pressed') !== 'true';
    cloakCloth.setParticleCull(next);
    particleCullBtn.setAttribute('aria-pressed', next ? 'true' : 'false');
  });
}

particleDebugBtn.addEventListener('click', () => {
  const next = !cloakCloth.showingParticles;
  cloakCloth.setShowParticles(next, scene);
  particleDebugBtn.setAttribute('aria-pressed', next ? 'true' : 'false');
  particleDebugBtn.textContent = next
    ? `Particles (${cloakCloth.particleCount})`
    : 'Particles';
  particlePickHud.hidden = !next;
  if (!next) {
    particlePickName.textContent = '';
    particlePickAngle.textContent = '';
    particlePickAngle.hidden = true;
    particlePickHeight.textContent = '';
    particlePickHeight.hidden = true;
  }
});

pinDebugBtn.addEventListener('click', () => {
  if (!pinDebugBtn.isConnected) return;
  const next = !cloakCloth.showingPins;
  cloakCloth.setShowPins(next, scene);
  pinDebugBtn.setAttribute('aria-pressed', next ? 'true' : 'false');
  pinDebugBtn.textContent = next ? `Pinned (${cloakCloth.pinnedCount})` : 'Pinned';
});

function refreshParticleAngle(): void {
  if (particlePickHud.hidden || particlePickName.textContent === '' || particlePickName.textContent === 'no particle') {
    particlePickAngle.hidden = true;
    particlePickAngle.textContent = '';
    particlePickHeight.hidden = true;
    particlePickHeight.textContent = '';
    return;
  }
  const tilt = cloakCloth.mirrorScreenTilt(camera);
  const heights = cloakCloth.mirrorHeights();
  if (!tilt || !heights) {
    particlePickAngle.hidden = true;
    particlePickAngle.textContent = '';
    particlePickHeight.hidden = true;
    particlePickHeight.textContent = '';
    return;
  }
  const sign = tilt.deg > 0.05 ? '+' : '';
  particlePickAngle.hidden = false;
  particlePickAngle.dataset.tilt = tilt.straight ? 'straight' : 'diagonal';
  particlePickAngle.textContent = `${sign}${tilt.deg.toFixed(1)}° ${tilt.straight ? 'straight line' : 'diagonal'}`;
  const dyMm = (heights.mirrorY - heights.y) * 1000;
  const dySign = dyMm > 0.05 ? '+' : '';
  particlePickHeight.hidden = false;
  particlePickHeight.textContent =
    `#${heights.id} height ${heights.y.toFixed(3)} m\n#${heights.mirrorId} height ${heights.mirrorY.toFixed(3)} m\nmirror ${dySign}${dyMm.toFixed(1)} mm`;
}

const particleMarquee = document.createElement('div');
particleMarquee.id = 'particleMarquee';
particleMarquee.hidden = true;
document.body.appendChild(particleMarquee);

function showParticleSelection(hits: ClothParticleHit[]): void {
  cloakCloth.setSelection(hits);
  particlePickHud.hidden = false;
  if (hits.length === 0) {
    particlePickName.textContent = 'no particle';
    particlePickAngle.hidden = true;
    particlePickAngle.textContent = '';
    particlePickHeight.hidden = true;
    particlePickHeight.textContent = '';
    syncClothWeightPanel(null);
    refreshClothGroupUi();
    return;
  }
  const hit = hits[0]!;
  if (hits.length === 1) {
    particlePickName.textContent = particleWeightLabel(hit.family, hit.id, hit.weight, hit.mirrorId);
  } else {
    particlePickName.textContent = `${hits.length} particles`;
    particlePickAngle.hidden = true;
    particlePickAngle.textContent = '';
    particlePickHeight.hidden = true;
    particlePickHeight.textContent = '';
  }
  syncClothWeightPanel(hit);
  if (hits.length > 1 && clothWeightHint instanceof HTMLElement && clothWeightHint.isConnected) {
    clothWeightHint.textContent = `${hits.length} highlighted · Arm bone, Distance, and Follow apply to each one`;
  }
  shellRoot().querySelector('#clothPanel')?.scrollIntoView({ block: 'nearest' });
  refreshClothGroupUi();
  if (hits.length === 1) {
    refreshParticleAngle();
    void navigator.clipboard?.writeText(`${hit.family} ${hit.id}`).catch(() => {});
    console.log('[cloth particle]', hit);
  }
}

let particleDrag: { x: number; y: number; pointerId: number; moved: boolean } | null = null;

function hideParticleMarquee(): void {
  particleMarquee.hidden = true;
}

canvas.addEventListener(
  'pointerdown',
  (e) => {
    if (!cloakCloth.showingParticles || e.button !== 0) return;
    e.stopPropagation();
    particleDrag = { x: e.clientX, y: e.clientY, pointerId: e.pointerId, moved: false };
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // The pointer can already be gone. The move and up listeners still see the drag.
    }
  },
  true,
);

canvas.addEventListener('pointermove', (e) => {
  if (!particleDrag || e.pointerId !== particleDrag.pointerId) return;
  const dx = e.clientX - particleDrag.x;
  const dy = e.clientY - particleDrag.y;
  if (!particleDrag.moved && dx * dx + dy * dy <= 64) return;
  particleDrag.moved = true;
  const left = Math.min(particleDrag.x, e.clientX);
  const top = Math.min(particleDrag.y, e.clientY);
  particleMarquee.hidden = false;
  particleMarquee.style.left = `${left}px`;
  particleMarquee.style.top = `${top}px`;
  particleMarquee.style.width = `${Math.abs(e.clientX - particleDrag.x)}px`;
  particleMarquee.style.height = `${Math.abs(e.clientY - particleDrag.y)}px`;
});

function endParticleDrag(e: PointerEvent): void {
  if (!particleDrag || e.pointerId !== particleDrag.pointerId) return;
  const drag = particleDrag;
  particleDrag = null;
  hideParticleMarquee();
  if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  if (!cloakCloth.showingParticles) return;
  const rect = canvas.getBoundingClientRect();
  if (drag.moved) {
    showParticleSelection(
      cloakCloth.pickParticlesInRect(camera, rect, drag.x, drag.y, e.clientX, e.clientY),
    );
    return;
  }
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
  showParticleSelection(hit ? [hit] : []);
}

canvas.addEventListener('pointerup', endParticleDrag);
canvas.addEventListener('pointercancel', endParticleDrag);

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
  const ballRotPane = byId('ghoulballRotControls');
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
        syncAnimButtons();
        playMode.setEnabled(false, null, null, camera, controls!);
        animator.snapTo('Idle');
        syncPlayBanner();
      }

      const extras: THREE.Object3D[] = [];
      scene.traverse((o) => {
        const pts = o as THREE.Points;
        if (!pts.isPoints) return;
        if (pts.name.startsWith('CudiParticles') || pts.name.startsWith('Cig') || pts.name.startsWith('TorchFlame') || pts.name.startsWith('EyeFlame') || pts.name.startsWith('InfernalFlame') || pts.name.startsWith('CandleFlame')) extras.push(pts);
      });
      const refUrl = refImage.src || assetUrl(`/Ghouls/${String(clampGhoulId(Number(ghoulIdInput.value))).padStart(4, '0')}.png`);
      ghoulball.start(asm.root, scene, refUrl, extras);
      reapplyStoredBall();
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
    // Pose still snaps; the orbit the user left stays put.
    const heldPos = camera.position.clone();
    const heldTarget = controls?.target.clone();
    resetGhoulPoseAndCamera();
    if (controls && heldTarget) {
      camera.position.copy(heldPos);
      controls.target.copy(heldTarget);
      controls.update();
      applyCamRoll();
      syncCamUiFromCamera();
    }
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
    pane: q<HTMLElement>('#clothSimControls'),
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

function fogColorFromPatch(color: number | string): number {
  if (typeof color === 'number') return color & 0xffffff;
  return cssToHex(color);
}

function getFog(): FogLevels {
  const key = fogBackgroundKey();
  if (!key) {
    return { enabled: false, color: 0x000000, near: 1.5, far: 4 };
  }
  const fog = fogForKey(key);
  return { enabled: fog.enabled, color: fog.color, near: fog.near, far: fog.far };
}

function setFog(levels: FogPatch): void {
  const key = fogBackgroundKey();
  if (!key) return;
  const prev = fogForKey(key);
  const next: BackgroundFog = { ...prev };
  if (levels.enabled != null) next.enabled = levels.enabled;
  if (levels.color != null) next.color = fogColorFromPatch(levels.color);
  if (levels.near != null) next.near = levels.near;
  if (levels.far != null) next.far = levels.far;
  if (next.far < next.near + 0.05) next.far = next.near + 0.05;
  if (
    levels.enabled == null &&
    (levels.near != null || levels.far != null || levels.color != null)
  ) {
    next.enabled = true;
  }
  fogLive.set(key, next);
  applySceneFog();
  syncFogControls();
}

function resetFog(): void {
  const key = fogBackgroundKey();
  if (!key) return;
  fogLive.delete(key);
  applySceneFog();
  syncFogControls();
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

  const hasOcean = bgScenes.hasEditableOcean(key);
  oceanTraitHint.textContent = hasOcean
    ? `Editing ocean for ${key.replace(/_/g, ' ')}`
    : `${key.replace(/_/g, ' ')} — no WaterPlane in this BG`;
  const ripple = rippleForKey(key);
  const mat = oceanMatForKey(key);
  for (const el of rippleInputs) el.disabled = false;
  for (const el of matInputs) el.disabled = !hasOcean;
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

let lastBallPatch: BallPatch = {};

function mergeBallPatch(a: BallPatch, b: BallPatch): BallPatch {
  return {
    ...a,
    ...b,
    rotation: b.rotation ? { ...a.rotation, ...b.rotation } : a.rotation,
    spin: b.spin ? { ...a.spin, ...b.spin } : a.spin,
  };
}

function applyBallPatch(levels: BallPatch): void {
  if (levels.rotation) ghoulball.setRotation(levels.rotation);
  if (levels.spin) ghoulball.setSpin(levels.spin);
  const mat: Partial<GhoulballMaterialParams> = {};
  if (levels.metalness != null) mat.metalness = levels.metalness;
  if (levels.roughness != null) mat.roughness = levels.roughness;
  if (levels.swirl != null) mat.swirl = levels.swirl;
  if (levels.clearcoat != null) mat.clearcoat = levels.clearcoat;
  if (levels.clearcoatRoughness != null) mat.clearcoatRoughness = levels.clearcoatRoughness;
  if (levels.envMapIntensity != null) mat.envMapIntensity = levels.envMapIntensity;
  if (levels.reflectivity != null) mat.reflectivity = levels.reflectivity;
  if (Object.keys(mat).length) ghoulball.setMaterialParams(mat);
  syncBallRotUi();
  syncBallControlsFromParams();
}

function reapplyStoredBall(): void {
  if (
    lastBallPatch.rotation ||
    lastBallPatch.spin ||
    lastBallPatch.metalness != null ||
    lastBallPatch.roughness != null ||
    lastBallPatch.swirl != null ||
    lastBallPatch.clearcoat != null ||
    lastBallPatch.clearcoatRoughness != null ||
    lastBallPatch.envMapIntensity != null ||
    lastBallPatch.reflectivity != null
  ) {
    applyBallPatch(lastBallPatch);
  }
}

function getBall(): BallLevels {
  const p = ghoulball.getMaterialParams();
  return {
    rotation: ghoulball.getRotation(),
    spin: ghoulball.getSpin(),
    metalness: p.metalness,
    roughness: p.roughness,
    swirl: p.swirl,
    clearcoat: p.clearcoat,
    clearcoatRoughness: p.clearcoatRoughness,
    envMapIntensity: p.envMapIntensity,
    reflectivity: p.reflectivity,
  };
}

function setBall(levels: BallPatch): void {
  lastBallPatch = mergeBallPatch(lastBallPatch, levels);
  applyBallPatch(levels);
}

function resetBall(): void {
  lastBallPatch = {};
  ghoulball.resetRotation();
  ghoulball.setMaterialParams({ ...DEFAULT_GHOULBALL_MATERIAL });
  syncBallRotUi();
  syncBallControlsFromParams();
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
    assembler?.syncEyepatch();
    eyeLook.update(dt, camera);
    cloakCloth.update(dt);
    cigSmoke.update(dt);
    drool.update(dt);
    torchFlame.update(dt);
    eyeFlame.update(dt);
    candleFlame.update(dt);
    infernalFlame.update(dt);
    specialOrbit.update();
    idolTrail.update(dt);
    haloLight.update();
    glassesLight.update();
    cudiParticles.update(dt);
  }
  positronicLights.update();
  playMode.update(dt, ghoulball.frozen);
  updateLightTween(dt);
  updateBeamSway(dt);
  updateToxicSlime(dt);
  updateToxicMist(dt);
  updateNc69rDisplayScroll(dt);
  updateXeDisplayScroll(dt);
  syncLightsToGhoul();
  ghoulball.update(dt);
  updateCubeGrid(dt);
  updateLightHelpers();
  if (playMode.orbitDrive) {
    constrainOrbitToFloor();
    controls.update();
    applyCamRoll();
  }
  clampCameraToFloor();
  bgScenes.update(dt, camera);
  if (playMode.cameraMode === 'follow') syncFollowCamUi();
  if (bgMode === 'ghoulball') syncBallRotUi();
  if (!particlePickHud.hidden) refreshParticleAngle();
  if (cleanRenderer && cleanDither) {
    cloakCloth.suppressParticleOverlay(true);
    cleanDither.renderPlain(cleanRenderer, scene, camera);
    cloakCloth.suppressParticleOverlay(false);
  }
  if (dither) dither.render(renderer, scene, camera);
  else renderer.render(scene, camera);
  updateSceneStats();
}

let shownSceneVerts = -1;
let shownSceneTris = -1;

function branchVisible(obj: THREE.Object3D): boolean {
  let p: THREE.Object3D | null = obj;
  while (p) {
    if (!p.visible) return false;
    p = p.parent;
  }
  return true;
}

/** Visible meshes in the live scene. Hidden traits are left out. */
function updateSceneStats(): void {
  let vertices = 0;
  let triangles = 0;
  scene.traverse((obj) => {
    if (!branchVisible(obj)) return;
    const mesh = obj as THREE.Mesh;
    const geo = mesh.geometry as THREE.BufferGeometry | undefined;
    if (!geo) return;
    const line = obj as THREE.Line;
    const points = obj as THREE.Points;
    if (!mesh.isMesh && !line.isLine && !points.isPoints) return;
    const pos = geo.getAttribute('position');
    if (!pos) return;
    const copies = (mesh as THREE.InstancedMesh).isInstancedMesh
      ? Math.max(0, (mesh as THREE.InstancedMesh).count)
      : 1;
    vertices += pos.count * copies;
    if (!mesh.isMesh) return;
    const index = geo.getIndex();
    const tris = index ? index.count / 3 : pos.count / 3;
    triangles += tris * copies;
  });
  const verts = Math.round(vertices);
  const tris = Math.round(triangles);
  if (verts === shownSceneVerts && tris === shownSceneTris) return;
  shownSceneVerts = verts;
  shownSceneTris = tris;
  sceneVertsEl.textContent = verts.toLocaleString('en-US');
  sceneTrisEl.textContent = tris.toLocaleString('en-US');
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
    if (cleanRenderer) cleanDither = new DitherComposer(cleanRenderer, palette);
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
    bindBeamSway(assembler.root);
    cloakCloth.bind(assembler.root);
    frameCharacter(assembler);
    doLoad(currentId);
  } catch (e) {
    console.error(e);
  }
}

function setAnim(name: AnimName): void {
  if (appMode === 'play') return;
  animSelect.value = name;
  syncAnimButtons();
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
    setFog,
    getFog,
    resetFog,
    setBall,
    getBall,
    resetBall,
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
    if (options.fog) setFog(options.fog);
    if (options.ball) setBall(options.ball);
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

if (shellRoot().querySelector('#c')) {
  updateUrlFlag = true;
  currentId = ghoulIdFromUrl();
  bootPromise = boot();
  viewerApi = buildApi();
}
