import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { BackgroundOceanMat, BackgroundRipple } from './materials';
import { backgroundColumnMat, backgroundPalmMat, enableBloomLayer } from './materials';
import { enableSkyBloom, SKY_BLOOM_EXTRACT, SKY_LIGHT_LAYER } from './materials';

const gltfLoader = new GLTFLoader();
const texLoader = new THREE.TextureLoader();

/** Large enough that camera orbit doesn't show obvious parallax. */
const SKYBOX_RADIUS = 80;

/** Per-trait skybox radius overrides (default: `SKYBOX_RADIUS`). */
const SKYBOX_RADIUS_BY_KEY: Record<string, number> = {
  Retro_Palms: 10_000,
  Neon_Palms: 10_000,
};

/** Per-trait vertical shift (negative = lower horizon). */
const SKYBOX_Y_BY_KEY: Record<string, number> = {
  Retro_Palms: -25,
  Neon_Palms: -25,
};

/** Traits that reuse another background's sky photo. */
const SKYBOX_FILE_BY_KEY: Record<string, string> = {
  Vaporwave_Columns: 'Vaporwave_Palms',
  Neon_Palms: 'Retro_Palms',
};

/** Traits that reuse another background's floor GLB. Palm materials stay per trait. */
const FLOOR_FILE_BY_KEY: Record<string, string> = {
  Neon_Palms: 'Retro_Palms',
};

function skyboxRadius(name: string): number {
  return SKYBOX_RADIUS_BY_KEY[name] ?? SKYBOX_RADIUS;
}

/** Drop layer 0 so ambient / hemi / key / fill cannot light the dome. */
function isolateSkyFromPointLights(mesh: THREE.Object3D): void {
  mesh.layers.set(SKY_LIGHT_LAYER);
}

/**
 * Full sphere, entire JPEG, no mirror. The file is a bit taller than 90°,
 * so the extra strip hangs below the horizon and the bottom edge clamps
 * across the rest of the sphere.
 */
const SPILL_SKY_KEYS = new Set(['Neon_Sunset']);

/** Full sphere wrapped in the shared ocean map, rippled like the water plane. */
const OCEAN_SKY_KEYS = new Set(['Pool_1']);

/** Wave height on an ocean sky, as a fraction of the sphere radius at amplitude 1.
 *  The ocean map's height only swings about ±0.4, so this has to be large
 *  before a radius-80 shell moves toward the ghoul. */
const OCEAN_SKY_WAVE = 4;

/** Ocean-sky UV repeat relative to the water ripple frequency. 0.25 = 4× larger tiles. */
const OCEAN_SKY_TILE_SCALE = 0.25;

/** Point light at the world origin, compiled into the Pool sky only. */
const DEFAULT_POOL_LIGHT = { color: 0xfff6ea, intensity: 28000 };

type PoolLightUniform = {
  color: { value: THREE.Color };
  intensity: { value: number };
};

const poolLightUniforms = new WeakMap<THREE.Material, PoolLightUniform>();

function attachPoolCenterLight(
  mat: THREE.MeshStandardMaterial,
  color = DEFAULT_POOL_LIGHT.color,
  intensity = DEFAULT_POOL_LIGHT.intensity,
): void {
  const uniforms: PoolLightUniform = {
    color: { value: new THREE.Color(color) },
    intensity: { value: intensity },
  };
  const bloomExtract = { value: 0 };
  poolLightUniforms.set(mat, uniforms);
  mat.userData[SKY_BLOOM_EXTRACT] = bloomExtract;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uPoolLightColor = uniforms.color;
    shader.uniforms.uPoolLightIntensity = uniforms.intensity;
    shader.uniforms.uBloomExtract = bloomExtract;
    shader.fragmentShader =
      'uniform vec3 uPoolLightColor;\nuniform float uPoolLightIntensity;\nuniform float uBloomExtract;\n' +
      shader.fragmentShader.replace(
        '#include <opaque_fragment>',
        /* glsl */ `
          {
            // View-space position of this fragment, and of the world origin.
            vec3 poolPos = - vViewPosition;
            vec3 poolLight = (viewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
            vec3 toLight = poolLight - poolPos;
            float dist = length(toLight);
            float atten = uPoolLightIntensity / max(dist * dist, 1.0);
            vec3 L = toLight / max(dist, 1e-4);
            vec3 N = normalize(normal);
            vec3 V = normalize(vViewPosition);
            vec3 H = normalize(L + V);
            float ndotl = clamp(dot(N, L), 0.0, 1.0);
            float ndoth = clamp(dot(N, H), 0.0, 1.0);
            // Metalness removes the diffuse tint. Roughness widens the highlight.
            float rough = clamp(material.roughness, 0.045, 1.0);
            float specPower = exp2(12.0 * (1.0 - rough));
            float spec = pow(ndoth, specPower) * (specPower + 8.0) * 0.125;
            vec3 diffuse = material.diffuseContribution * RECIPROCAL_PI;
            vec3 specular = material.specularColorBlended * spec;
            outgoingLight += (diffuse + specular) * uPoolLightColor * atten * ndotl;
          }
          #include <opaque_fragment>
          if (uBloomExtract > 0.5) gl_FragColor.a = 1.0;
        `,
      );
  };
  mat.customProgramCacheKey = () => 'pool-center-light-pbr-bloom';
  mat.needsUpdate = true;
}

function writePoolCenterLight(mat: THREE.Material, color: number, intensity: number): void {
  const uniforms = poolLightUniforms.get(mat);
  if (!uniforms) return;
  uniforms.color.value.setHex(color & 0xffffff);
  uniforms.intensity.value = intensity;
}

/**
 * SphereGeometry UVs run 1 at the north pole → 0 at the south pole.
 * Fold them so the equator is 0 and both poles are 1. With the existing
 * horizon crop, the lower hemisphere then mirrors the upper sky.
 */
function mirrorLowerHemisphere(geometry: THREE.SphereGeometry): THREE.SphereGeometry {
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    uv.setY(i, Math.abs(uv.getY(i) - 0.5) * 2);
  }
  uv.needsUpdate = true;
  return geometry;
}

/** Camera far plane must clear the largest skybox dome. */
export const SKYBOX_CLIP_FAR =
  Math.max(SKYBOX_RADIUS, ...Object.values(SKYBOX_RADIUS_BY_KEY)) * 1.25;

/** Backgrounds that get a procedural drifting cloud field (no skybox jpg required). */
const CLOUD_FIELD_KEYS = new Set(['Based_Loans']);

type WaterPlaneRipple = {
  mesh: THREE.Mesh;
  rest: Float32Array;
  positions: THREE.BufferAttribute;
  uvs: THREE.BufferAttribute | null;
};

type OceanSky = {
  mesh: THREE.Mesh;
  rest: Float32Array;
  normals: Float32Array;
  positions: THREE.BufferAttribute;
  uvs: THREE.BufferAttribute;
  radius: number;
};

type CloudPuff = {
  sprite: THREE.Sprite;
  radius: number;
  baseY: number;
  angle: number;
  spin: number;
  bob: number;
  bobPhase: number;
};

const OCEAN_MAP_URL = '/models/backgrounds/ocean.jpg';

function isFloorGrid(mesh: THREE.Mesh): boolean {
  const n = mesh.name.trim().toLowerCase();
  return n === 'plane' || n.startsWith('grid');
}

/** Column meshes in a columns background share one lit material. The ground grid stays separate. */
const COLUMN_BG_KEYS = new Set(['Vaporwave_Columns']);

/** Palm backgrounds share one lit tree material per trait key. */
const PALM_BG_KEYS = new Set(['Retro_Palms', 'Neon_Palms']);

/** GLTFLoader strips '.' from node names, so "palm.012" arrives as "palm012". */
function isPalmNodeName(name: string): boolean {
  const n = name.trim().toLowerCase();
  if (n === 'palm' || n.startsWith('palm.') || n.startsWith('palm_')) return true;
  return /^palm\d+$/.test(n);
}

function isPalmMaterialName(name: string): boolean {
  const n = name.trim().toLowerCase().replace(/[\s_-]/g, '');
  return n === 'palmtree' || n.startsWith('palmtree');
}

function isPalmMesh(mesh: THREE.Mesh): boolean {
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  if (mats.some((mat) => mat && isPalmMaterialName(mat.name))) return true;
  let o: THREE.Object3D | null = mesh;
  while (o) {
    if (isPalmNodeName(o.name)) return true;
    o = o.parent;
  }
  return false;
}

function collectPalmMeshes(root: THREE.Object3D): THREE.Mesh[] {
  const palms: THREE.Mesh[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !isPalmMesh(mesh)) return;
    palms.push(mesh);
  });
  return palms;
}

/** Copy the floor, but give this trait its own palm material so edits cannot leak. */
function cloneFloorWithOwnPalmMaterial(source: THREE.Object3D, traitKey: string): THREE.Object3D {
  const root = source.clone(true);
  let shared: THREE.Material | null = null;
  for (const mesh of collectPalmMeshes(root)) {
    if (!shared) {
      const srcMat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      shared = srcMat.clone();
      shared.name = `PalmTree_${traitKey}`;
    }
    mesh.material = shared;
  }
  return root;
}

function unifyPalmMaterial(root: THREE.Object3D, bgKey: string): void {
  if (!PALM_BG_KEYS.has(bgKey)) return;
  const palms = collectPalmMeshes(root);
  let shared: THREE.MeshStandardMaterial | null = null;
  for (const mesh of palms) {
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      if (mat instanceof THREE.MeshStandardMaterial) {
        shared = mat;
        break;
      }
    }
    if (shared) break;
  }
  if (!shared) return;
  const saved = backgroundPalmMat(bgKey);
  if (saved) {
    shared.color.setHex(saved.color);
    shared.roughness = saved.roughness;
    shared.metalness = saved.metalness;
    shared.needsUpdate = true;
  }
  for (const mesh of palms) mesh.material = shared;
  // Neon trees join the selective bloom pass. Retro keeps the unmarked GLB meshes.
  if (bgKey === 'Neon_Palms') {
    for (const mesh of palms) enableBloomLayer(mesh);
  }
}

function collectColumnMeshes(root: THREE.Object3D): THREE.Mesh[] {
  const columns: THREE.Mesh[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || isFloorGrid(mesh)) return;
    columns.push(mesh);
  });
  return columns;
}

function unifyColumnMaterial(root: THREE.Object3D, bgKey: string): void {
  if (!COLUMN_BG_KEYS.has(bgKey)) return;
  const columns = collectColumnMeshes(root);
  let shared: THREE.MeshStandardMaterial | null = null;
  for (const mesh of columns) {
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      if (mat instanceof THREE.MeshStandardMaterial) {
        shared = mat;
        break;
      }
    }
    if (shared) break;
  }
  if (!shared) return;
  const saved = backgroundColumnMat(bgKey);
  if (saved) {
    shared.color.setHex(saved.color);
    shared.roughness = saved.roughness;
    shared.metalness = saved.metalness;
  }
  for (const mesh of columns) mesh.material = shared;
}

function isWaterPlaneName(name: string): boolean {
  const n = name.trim();
  return n === 'WaterPlane' || n.startsWith('WaterPlane.');
}

/** Deterministic 0–1 from integer seed. */
function hash01(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** Soft fluffy cloud silhouette on a transparent canvas (no external art). */
function makeCloudTexture(variant: number): THREE.CanvasTexture {
  const w = 256;
  const h = 128;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, w, h);

  const blobs = 3 + Math.floor(hash01(variant * 17 + 3) * 3);
  for (let i = 0; i < blobs; i++) {
    const seed = variant * 31 + i * 13;
    const cx = w * (0.22 + hash01(seed) * 0.56);
    const cy = h * (0.38 + hash01(seed + 1) * 0.3);
    const rx = w * (0.1 + hash01(seed + 2) * 0.18);
    const ry = h * (0.14 + hash01(seed + 3) * 0.22);
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(rx, ry));
    const a0 = 0.22 + hash01(seed + 4) * 0.22;
    g.addColorStop(0, `rgba(255,255,255,${a0.toFixed(3)})`);
    g.addColorStop(0.4, `rgba(255,255,255,${(a0 * 0.4).toFixed(3)})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function buildCloudField(name: string): { root: THREE.Group; puffs: CloudPuff[] } {
  const root = new THREE.Group();
  root.name = `Clouds_${name}`;
  root.visible = false;

  const textures = [0, 1, 2, 3].map((v) => makeCloudTexture(v + name.length * 7));
  const puffs: CloudPuff[] = [];
  const count = 18;

  for (let i = 0; i < count; i++) {
    const s = i * 19 + 41;
    const mat = new THREE.SpriteMaterial({
      map: textures[i % textures.length]!,
      transparent: true,
      depthWrite: false,
      fog: false,
      toneMapped: false,
      opacity: 0.28 + hash01(s) * 0.28,
    });
    const sprite = new THREE.Sprite(mat);
    const scaleX = 7 + hash01(s + 1) * 14;
    const scaleY = scaleX * (0.32 + hash01(s + 2) * 0.3);
    sprite.scale.set(scaleX, scaleY, 1);

    const radius = 32 + hash01(s + 3) * 28;
    const angle = hash01(s + 4) * Math.PI * 2;
    const baseY = 6 + hash01(s + 5) * 16;
    sprite.position.set(Math.cos(angle) * radius, baseY, Math.sin(angle) * radius);
    sprite.renderOrder = -8;
    sprite.frustumCulled = false;
    root.add(sprite);

    puffs.push({
      sprite,
      radius,
      baseY,
      angle,
      spin: (0.015 + hash01(s + 6) * 0.04) * (hash01(s + 7) > 0.5 ? 1 : -1),
      bob: 0.15 + hash01(s + 8) * 0.45,
      bobPhase: hash01(s + 9) * Math.PI * 2,
    });
  }

  return { root, puffs };
}

/** Screen-space column swirl for procedural skies. 0 keeps a straight gradient. */
const GRADIENT_COLUMN_SWIRL: Record<string, number> = {
  Based_Classic: 1,
};

function gradientColumnSwirl(name: string): number {
  return GRADIENT_COLUMN_SWIRL[name] ?? 0;
}

function makeGradientSkyMaterial(
  top: number,
  bottom: number,
  distance: number,
  swirl = 0,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTop: { value: new THREE.Color(top) },
      uBottom: { value: new THREE.Color(bottom) },
      uDistance: { value: distance },
      uSwirl: { value: swirl },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec4 vClip;
      void main() {
        vClip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = vClip;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop;
      uniform vec3 uBottom;
      uniform float uDistance;
      uniform float uSwirl;
      uniform float uTime;
      varying vec4 vClip;

      float hash(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
      }

      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
        float a = hash(i);
        float b = hash(i + vec2(1.0, 0.0));
        float c = hash(i + vec2(0.0, 1.0));
        float d = hash(i + vec2(1.0, 1.0));
        return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
      }

      float fbm(vec2 p) {
        float v = 0.0;
        float a = 0.5;
        mat2 rot = mat2(0.80, 0.60, -0.60, 0.80);
        for (int i = 0; i < 3; i++) {
          v += a * noise(p);
          p = rot * p * 2.02 + vec2(1.7, 9.2);
          a *= 0.5;
        }
        return v / 0.875;
      }

      void main() {
        // Screen-space so the mix matches 2D pixel-art BGs (not a 3D horizon).
        // ndc -1 = left/bottom of frame, +1 = right/top.
        // Distance 1 = full-frame blend; lower = tighter; higher = softer edges.
        float ndcX = vClip.x / max(vClip.w, 1e-5);
        float ndcY = vClip.y / max(vClip.w, 1e-5);
        float d = max(uDistance, 0.02);
        float y = ndcY;

        if (uSwirl > 0.001) {
          // Slow drift: crests travel across columns, noise flows upward through them.
          float t = uTime;
          // Low horizontal frequency so a crest spans a wide run of columns.
          float column =
            sin(ndcX * 0.95 + 0.40 + t * 0.16) * 0.62 +
            sin(ndcX * 1.85 - 1.20 - t * 0.09) * 0.24 +
            sin(ndcX * 0.42 + 2.00 + t * 0.06) * 0.22;
          vec2 p = vec2(ndcX * 0.62 + t * 0.03, ndcY * 0.95 - t * 0.13);
          vec2 q = vec2(fbm(p), fbm(p + vec2(5.2, 1.3)));
          vec2 r = vec2(
            fbm(p + 0.55 * q + vec2(1.7, 9.2)),
            fbm(p + 0.55 * q + vec2(8.3, 2.8))
          );
          float ebb = column * 0.20 + (r.y - 0.5) * 0.46 + (q.x - 0.5) * 0.18;
          float curl = (r.x - 0.5) * 0.22 + (q.y - 0.5) * 0.10;
          y += (ebb + curl * 0.35) * uSwirl;
        }

        float t = clamp(0.5 + 0.5 * (y / d), 0.0, 1.0);
        gl_FragColor = vec4(mix(uBottom, uTop, t), 1.0);
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  });
}

/**
 * Optional Trait BG floor GLBs (`/models/backgrounds/{TraitKey}.glb`)
 * and unlit sphere skyboxes (`/models/skybox/{TraitKey}.jpg`).
 * WaterPlane meshes use `/models/backgrounds/ocean.jpg` as a scrolling
 * normal map + CPU height displacement (green channel as height proxy).
 * Based_Loans (and any BG without a photo skybox) uses a procedural
 * gradient sphere + optional cloud field.
 */
export class BackgroundSceneManager {
  private readonly root = new THREE.Group();
  private readonly floorCache = new Map<string, THREE.Object3D>();
  private readonly skyCache = new Map<string, THREE.Object3D>();
  private readonly oceanSkyCache = new Map<string, OceanSky>();
  private readonly skyTint = new Map<string, number>();
  private readonly poolLight = new Map<string, { color: number; intensity: number }>();
  private readonly gradientSkyCache = new Map<string, THREE.Mesh>();
  private readonly cloudCache = new Map<string, { root: THREE.Group; puffs: CloudPuff[] }>();
  private readonly waterByBg = new Map<string, WaterPlaneRipple[]>();
  private readonly floorMissing = new Set<string>();
  private readonly skyMissing = new Set<string>();
  private readonly floorInflight = new Map<string, Promise<THREE.Object3D | null>>();
  private readonly skyInflight = new Map<string, Promise<THREE.Object3D | null>>();
  private activeKey: string | null = null;
  private wantVisible = false;
  private clearGrad = { top: 0x000000, bottom: 0x000000, distance: 1 };
  private cloudColor = 0xffffff;
  private ripple: BackgroundRipple = {
    enabled: false,
    amplitude: 0.04,
    frequency: 1.5,
    speed: 1,
  };
  private time = 0;
  private oceanTex: THREE.Texture | null = null;
  private oceanPixels: Uint8ClampedArray | null = null;
  private oceanW = 0;
  private oceanH = 0;
  private oceanReady: Promise<void> | null = null;
  private readonly oceanMatByKey = new Map<string, BackgroundOceanMat>();

  constructor(scene: THREE.Scene) {
    this.root.name = 'BackgroundScenes';
    scene.add(this.root);
  }

  /** The one material driving every column. Empty until that background has loaded. */
  columnMaterials(key: string | null | undefined): THREE.MeshStandardMaterial[] {
    if (!key || !COLUMN_BG_KEYS.has(key)) return [];
    const root = this.floorCache.get(key);
    if (!root) return [];
    const seen = new Set<THREE.Material>();
    const out: THREE.MeshStandardMaterial[] = [];
    for (const mesh of collectColumnMeshes(root)) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of mats) {
        if (!(mat instanceof THREE.MeshStandardMaterial) || seen.has(mat)) continue;
        seen.add(mat);
        out.push(mat);
      }
    }
    return out;
  }

  /** The one material driving every palm. Empty until that background has loaded. */
  palmMaterials(key: string | null | undefined): THREE.MeshStandardMaterial[] {
    if (!key || !PALM_BG_KEYS.has(key)) return [];
    const root = this.floorCache.get(key);
    if (!root) return [];
    const seen = new Set<THREE.Material>();
    const out: THREE.MeshStandardMaterial[] = [];
    for (const mesh of collectPalmMeshes(root)) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of mats) {
        if (!(mat instanceof THREE.MeshStandardMaterial) || seen.has(mat)) continue;
        seen.add(mat);
        out.push(mat);
      }
    }
    return out;
  }

  hasWaterPlane(key: string | null | undefined): boolean {
    if (!key) return false;
    return (this.waterByBg.get(key)?.length ?? 0) > 0;
  }

  /** Water plane, or an ocean-texture sky that uses the same material controls. */
  hasEditableOcean(key: string | null | undefined): boolean {
    if (!key) return false;
    return this.hasWaterPlane(key) || OCEAN_SKY_KEYS.has(key);
  }

  setOceanMaterial(key: string, settings: BackgroundOceanMat): void {
    this.oceanMatByKey.set(key, { ...settings });
    this.applyOceanMatToKey(key);
  }

  readOceanMaterial(key: string): BackgroundOceanMat | null {
    const saved = this.oceanMatByKey.get(key);
    if (saved) return { ...saved };
    const waters = this.waterByBg.get(key);
    const sky = this.oceanSkyCache.get(key);
    const mesh = waters?.[0]?.mesh ?? sky?.mesh;
    if (!mesh) return null;
    const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as
      | THREE.MeshStandardMaterial
      | THREE.MeshBasicMaterial
      | undefined;
    if (!mat) return null;
    const color = 'color' in mat && mat.color ? mat.color.getHex() : 0x2a6a88;
    const std = mat as THREE.MeshStandardMaterial;
    return {
      color,
      metalness: typeof std.metalness === 'number' ? std.metalness : 0.35,
      roughness: typeof std.roughness === 'number' ? std.roughness : 0.22,
      opacity: typeof mat.opacity === 'number' ? mat.opacity : 1,
      envMapIntensity: typeof std.envMapIntensity === 'number' ? std.envMapIntensity : 1,
    };
  }

  setRipple(settings: BackgroundRipple): void {
    this.ripple = { ...settings };
    if (!settings.enabled) {
      this.resetWaterHeights();
      this.clearOceanNormalMaps();
    } else {
      void this.ensureOceanMap().then(() => {
        for (const waters of this.waterByBg.values()) {
          for (const w of waters) this.applyOceanNormalMap(w.mesh);
        }
      });
    }
  }

  /** Editable Trait BG clear gradient (applied to procedural sphere skybox). */
  setClearGradient(top: number, bottom: number, distance = 1): void {
    this.clearGrad = {
      top: top & 0xffffff,
      bottom: bottom & 0xffffff,
      distance: Math.max(0, distance),
    };
    if (!this.activeKey || !this.wantVisible) return;
    const mesh = this.gradientSkyCache.get(this.activeKey);
    if (mesh?.visible) this.applyGradientColors(mesh);
  }

  /** Tint for an ocean-texture sky sphere (map × colour). */
  setSkyTint(key: string, hex: number): void {
    const color = hex & 0xffffff;
    this.skyTint.set(key, color);
    const sky = this.oceanSkyCache.get(key);
    if (!sky) return;
    const mat = sky.mesh.material as THREE.MeshBasicMaterial;
    mat.color.setHex(color);
  }

  /** Centre point light compiled into an ocean sky. No effect on other materials. */
  setPoolLight(key: string, color: number, intensity: number): void {
    const next = { color: color & 0xffffff, intensity };
    this.poolLight.set(key, next);
    const sky = this.oceanSkyCache.get(key);
    if (!sky) return;
    writePoolCenterLight(sky.mesh.material as THREE.Material, next.color, next.intensity);
  }
  setCloudColor(hex: number): void {
    this.cloudColor = hex & 0xffffff;
    if (!this.activeKey || !this.wantVisible) return;
    this.applyCloudColor(this.activeKey);
  }

  hasCloudField(key: string | null | undefined): boolean {
    return !!key && CLOUD_FIELD_KEYS.has(key);
  }

  /** Show floor + skybox / clouds for `key` when visible. Returns whether anything is shown. */
  async setActive(key: string | null | undefined, visible: boolean): Promise<boolean> {
    const name = key && key !== 'None' ? key : null;
    this.wantVisible = visible && !!name;
    this.activeKey = name;

    for (const child of this.root.children) child.visible = false;

    if (!this.wantVisible || !name) {
      this.resetWaterHeights();
      return false;
    }

    const [floor, sky, clouds] = await Promise.all([
      this.loadFloor(name),
      this.loadSkybox(name),
      Promise.resolve(this.loadCloudField(name)),
    ]);
    if (this.activeKey !== name || !this.wantVisible) return false;

    let shown = false;
    if (floor) {
      floor.visible = true;
      shown = true;
    }
    if (sky) {
      sky.visible = true;
      shown = true;
    } else {
      // No photo skybox — procedural vertical gradient on a sphere.
      const gradSky = this.ensureGradientSky(name);
      gradSky.visible = true;
      shown = true;
    }
    if (clouds) {
      clouds.visible = true;
      this.applyCloudColor(name);
      shown = true;
    }
    return shown;
  }

  private applyCloudColor(key: string): void {
    const field = this.cloudCache.get(key);
    if (!field) return;
    const c = this.cloudColor;
    for (const puff of field.puffs) {
      const mat = puff.sprite.material as THREE.SpriteMaterial;
      mat.color.setHex(c);
      mat.needsUpdate = true;
    }
  }

  private applyGradientColors(mesh: THREE.Mesh): void {
    const mat = mesh.material as THREE.ShaderMaterial;
    mat.uniforms.uTop!.value.setHex(this.clearGrad.top);
    mat.uniforms.uBottom!.value.setHex(this.clearGrad.bottom);
    mat.uniforms.uDistance!.value = this.clearGrad.distance;
  }

  private ensureGradientSky(name: string): THREE.Mesh {
    const cached = this.gradientSkyCache.get(name);
    if (cached) {
      this.applyGradientColors(cached);
      return cached;
    }
    const mat = makeGradientSkyMaterial(
      this.clearGrad.top,
      this.clearGrad.bottom,
      this.clearGrad.distance,
      gradientColumnSwirl(name),
    );
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(SKYBOX_RADIUS, 64, 32), mat);
    mesh.name = `GradientSky_${name}`;
    isolateSkyFromPointLights(mesh);
    mesh.renderOrder = -10;
    mesh.frustumCulled = false;
    mesh.visible = false;
    this.root.add(mesh);
    this.gradientSkyCache.set(name, mesh);
    return mesh;
  }

  update(dt: number): void {
    if (!this.wantVisible || !this.activeKey) return;

    this.time += dt;
    this.updateClouds(this.activeKey, this.time);
    this.updateGradientSwirl(this.activeKey);
    this.updateOceanSky(this.activeKey);

    const waters = this.waterByBg.get(this.activeKey);
    if (!waters?.length) return;

    const { enabled, amplitude, frequency, speed } = this.ripple;
    if (!enabled || amplitude <= 1e-6) {
      this.resetWaterHeights();
      if (this.oceanTex) this.oceanTex.offset.set(0, 0);
      return;
    }

    const t = this.time * speed;
    const tile = Math.max(0.05, frequency);

    // Scroll the shared normal map for lighting detail.
    if (this.oceanTex) {
      this.oceanTex.offset.set(t * 0.035, t * 0.022);
      this.oceanTex.repeat.set(tile, tile);
    }

    for (const w of waters) {
      if (!w.mesh.visible) continue;
      const pos = w.positions.array as Float32Array;
      const rest = w.rest;
      const uvs = w.uvs;

      for (let i = 0, vi = 0; i < rest.length; i += 3, vi++) {
        const x = rest[i]!;
        const z = rest[i + 2]!;
        let h: number;
        if (this.oceanPixels && uvs) {
          const u0 = uvs.getX(vi);
          const v0 = uvs.getY(vi);
          // Dual scrolled samples from the normal map (green ≈ height proxy).
          const h1 = this.sampleOceanHeight(u0 * tile + t * 0.08, v0 * tile + t * 0.05);
          const h2 = this.sampleOceanHeight(u0 * tile * 0.7 - t * 0.04, v0 * tile * 0.85 + t * 0.07);
          h = h1 * 0.65 + h2 * 0.35;
        } else {
          h =
            Math.sin(x * tile + t) * Math.cos(z * tile * 0.85 + t * 1.15) * 0.55 +
            Math.sin((x + z) * tile * 0.55 - t * 0.9) * 0.3 +
            Math.sin((x * 0.35 - z) * tile * 1.4 + t * 1.35) * 0.15;
        }
        pos[i] = x;
        pos[i + 1] = rest[i + 1]! + h * amplitude;
        pos[i + 2] = z;
      }
      w.positions.needsUpdate = true;
      w.mesh.geometry.computeVertexNormals();
    }
  }

  private updateGradientSwirl(key: string): void {
    if (gradientColumnSwirl(key) <= 0) return;
    const mesh = this.gradientSkyCache.get(key);
    if (!mesh?.visible) return;
    const mat = mesh.material as THREE.ShaderMaterial;
    const uTime = mat.uniforms.uTime;
    if (uTime) uTime.value = this.time;
  }

  private updateClouds(key: string, t: number): void {
    const field = this.cloudCache.get(key);
    if (!field?.root.visible) return;
    for (const puff of field.puffs) {
      const a = puff.angle + t * puff.spin;
      puff.sprite.position.x = Math.cos(a) * puff.radius;
      puff.sprite.position.z = Math.sin(a) * puff.radius;
      puff.sprite.position.y = puff.baseY + Math.sin(t * 0.35 + puff.bobPhase) * puff.bob;
    }
  }

  private loadCloudField(name: string): THREE.Group | null {
    if (!CLOUD_FIELD_KEYS.has(name)) return null;
    const cached = this.cloudCache.get(name);
    if (cached) return cached.root;
    const field = buildCloudField(name);
    this.root.add(field.root);
    this.cloudCache.set(name, field);
    return field.root;
  }

  /** Green channel of ocean.jpg as -1..1 height (normal-map proxy). */
  private sampleOceanHeight(u: number, v: number): number {
    const pix = this.oceanPixels;
    if (!pix || !this.oceanW || !this.oceanH) return 0;
    const uu = u - Math.floor(u);
    const vv = v - Math.floor(v);
    const x = Math.min(this.oceanW - 1, (uu * this.oceanW) | 0);
    const y = Math.min(this.oceanH - 1, ((1 - vv) * this.oceanH) | 0);
    const g = pix[(y * this.oceanW + x) * 4 + 1]! / 255;
    return g * 2 - 1;
  }

  private resetWaterHeights(): void {
    for (const waters of this.waterByBg.values()) {
      for (const w of waters) {
        const pos = w.positions.array as Float32Array;
        pos.set(w.rest);
        w.positions.needsUpdate = true;
        w.mesh.geometry.computeVertexNormals();
      }
    }
  }

  private ensureOceanMap(): Promise<void> {
    if (this.oceanTex && this.oceanPixels) return Promise.resolve();
    if (this.oceanReady) return this.oceanReady;
    this.oceanReady = texLoader
      .loadAsync(OCEAN_MAP_URL)
      .then((tex) => {
        tex.colorSpace = THREE.NoColorSpace;
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.flipY = true;
        tex.needsUpdate = true;
        this.oceanTex = tex;

        const img = tex.image as HTMLImageElement | ImageBitmap;
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(img as CanvasImageSource, 0, 0);
        const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
        this.oceanPixels = data;
        this.oceanW = width;
        this.oceanH = height;
      })
      .catch((err) => {
        console.warn('[ocean] failed to load', OCEAN_MAP_URL, err);
        this.oceanReady = null;
      });
    return this.oceanReady;
  }

  private applyOceanMatToKey(key: string): void {
    const settings = this.oceanMatByKey.get(key);
    if (!settings) return;
    const waters = this.waterByBg.get(key);
    if (waters) for (const w of waters) this.applyOceanMatToMesh(w.mesh, settings);
    const sky = this.oceanSkyCache.get(key);
    if (sky) this.applyOceanMatToSky(key, sky, settings);
  }

  /** Lit ocean settings on the sky sphere, without the floor-mesh fog/depth flags. */
  private applyOceanMatToSky(key: string, sky: OceanSky, settings: BackgroundOceanMat): void {
    const current = sky.mesh.material as THREE.Material;
    const map =
      current instanceof THREE.MeshStandardMaterial || current instanceof THREE.MeshBasicMaterial
        ? current.map
        : null;
    let std: THREE.MeshStandardMaterial;
    if (current instanceof THREE.MeshStandardMaterial) {
      std = current;
    } else {
      std = new THREE.MeshStandardMaterial({
        map,
        side: THREE.BackSide,
        fog: false,
        toneMapped: false,
      });
      attachPoolCenterLight(
        std,
        this.poolLight.get(key)?.color ?? DEFAULT_POOL_LIGHT.color,
        this.poolLight.get(key)?.intensity ?? DEFAULT_POOL_LIGHT.intensity,
      );
      current.dispose();
      sky.mesh.material = std;
    }
    std.color.setHex(settings.color);
    std.metalness = settings.metalness;
    std.roughness = settings.roughness;
    std.opacity = settings.opacity;
    std.transparent = settings.opacity < 0.999;
    std.depthWrite = false;
    std.envMapIntensity = settings.envMapIntensity;
    std.side = THREE.BackSide;
    std.fog = false;
    std.toneMapped = false;
    if (map && this.ripple.enabled) {
      std.normalMap = map;
      std.normalScale.set(1.1, 1.1);
    } else {
      std.normalMap = null;
    }
    std.needsUpdate = true;
    this.skyTint.set(key, settings.color);
  }

  private applyOceanMatToMesh(mesh: THREE.Mesh, settings: BackgroundOceanMat): void {
    const src = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const next: THREE.Material[] = [];
    for (const mat of src) {
      let std: THREE.MeshStandardMaterial;
      if (mat instanceof THREE.MeshStandardMaterial || mat instanceof THREE.MeshPhysicalMaterial) {
        std = mat;
      } else {
        const basic = mat as THREE.MeshBasicMaterial;
        std = new THREE.MeshStandardMaterial({
          map: 'map' in basic ? basic.map : null,
          fog: true,
        });
        mat.dispose();
      }
      std.color.setHex(settings.color);
      std.metalness = settings.metalness;
      std.roughness = settings.roughness;
      std.opacity = settings.opacity;
      std.transparent = settings.opacity < 0.999;
      std.depthWrite = settings.opacity >= 0.999;
      std.envMapIntensity = settings.envMapIntensity;
      std.needsUpdate = true;
      next.push(std);
    }
    mesh.material = next.length === 1 ? next[0]! : next;
    if (this.ripple.enabled) this.applyOceanNormalMap(mesh);
  }

  private applyOceanNormalMap(mesh: THREE.Mesh): void {
    if (!this.oceanTex || !this.ripple.enabled) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      if (
        mat instanceof THREE.MeshStandardMaterial ||
        mat instanceof THREE.MeshPhysicalMaterial
      ) {
        mat.normalMap = this.oceanTex;
        mat.normalScale.set(1.1, 1.1);
        mat.needsUpdate = true;
      }
    }
  }

  private clearOceanNormalMaps(): void {
    for (const waters of this.waterByBg.values()) {
      for (const w of waters) {
        const mats = Array.isArray(w.mesh.material) ? w.mesh.material : [w.mesh.material];
        for (const mat of mats) {
          if (
            mat instanceof THREE.MeshStandardMaterial ||
            mat instanceof THREE.MeshPhysicalMaterial
          ) {
            mat.normalMap = null;
            mat.needsUpdate = true;
          }
        }
      }
    }
  }

  private collectWaterPlanes(root: THREE.Object3D, bgKey: string): void {
    const list: WaterPlaneRipple[] = [];
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry) return;
      if (!isWaterPlaneName(mesh.name)) return;
      const attr = mesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
      if (!attr?.array) return;
      if (
        (attr as THREE.BufferAttribute & { isInterleavedBufferAttribute?: boolean })
          .isInterleavedBufferAttribute
      ) {
        return;
      }
      const uvAttr = mesh.geometry.getAttribute('uv') as THREE.BufferAttribute | undefined;
      const rest = new Float32Array(attr.array as Float32Array);
      if (this.ripple.enabled) this.applyOceanNormalMap(mesh);
      list.push({ mesh, rest, positions: attr, uvs: uvAttr ?? null });
    });
    this.waterByBg.set(bgKey, list);
    this.applyOceanMatToKey(bgKey);
  }

  private async loadFloor(name: string): Promise<THREE.Object3D | null> {
    const cached = this.floorCache.get(name);
    if (cached) {
      if (this.ripple.enabled) {
        await this.ensureOceanMap();
        const waters = this.waterByBg.get(name);
        if (waters) for (const w of waters) this.applyOceanNormalMap(w.mesh);
      } else {
        this.clearOceanNormalMaps();
      }
      this.applyOceanMatToKey(name);
      return cached;
    }
    if (this.floorMissing.has(name)) return null;

    const sourceKey = FLOOR_FILE_BY_KEY[name];
    if (sourceKey && sourceKey !== name) {
      let aliasPending = this.floorInflight.get(name);
      if (!aliasPending) {
        aliasPending = (async () => {
          try {
            const source = await this.loadFloor(sourceKey);
            if (!source) {
              this.floorMissing.add(name);
              return null;
            }
            const root = cloneFloorWithOwnPalmMaterial(source, name);
            root.name = `Background_${name}`;
            root.visible = false;
            this.collectWaterPlanes(root, name);
            unifyPalmMaterial(root, name);
            this.root.add(root);
            this.floorCache.set(name, root);
            return root;
          } finally {
            this.floorInflight.delete(name);
          }
        })();
        this.floorInflight.set(name, aliasPending);
      }
      return aliasPending;
    }

    let pending = this.floorInflight.get(name);
    if (!pending) {
      pending = (async () => {
        try {
          if (this.ripple.enabled) await this.ensureOceanMap();
          const gltf = await gltfLoader.loadAsync(`/models/backgrounds/${name}.glb`);
          const root = gltf.scene;
          root.name = `Background_${name}`;
          root.visible = false;
          root.traverse((o) => {
            const mesh = o as THREE.Mesh;
            if (!mesh.isMesh) return;
            const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            for (const mat of mats) {
              (mat as THREE.MeshStandardMaterial).fog = true;
              mat.needsUpdate = true;
            }
            mesh.castShadow = true;
            // Neon Sunset ocean should not show the sun shadow on the water.
            mesh.receiveShadow = !(name === 'Neon_Sunset' && isWaterPlaneName(mesh.name));
          });
          this.collectWaterPlanes(root, name);
          unifyColumnMaterial(root, name);
          unifyPalmMaterial(root, name);
          this.root.add(root);
          this.floorCache.set(name, root);
          return root;
        } catch {
          this.floorMissing.add(name);
          return null;
        } finally {
          this.floorInflight.delete(name);
        }
      })();
      this.floorInflight.set(name, pending);
    }
    return pending;
  }

  private async loadSkybox(name: string): Promise<THREE.Object3D | null> {
    if (OCEAN_SKY_KEYS.has(name)) return this.loadOceanSky(name);
    const cached = this.skyCache.get(name);
    if (cached) return cached;
    if (this.skyMissing.has(name)) return null;

    let pending = this.skyInflight.get(name);
    if (!pending) {
      pending = new Promise<THREE.Object3D | null>((resolve) => {
        texLoader.load(
          `/models/skybox/${SKYBOX_FILE_BY_KEY[name] ?? name}.jpg`,
          (tex) => {
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.flipY = true;
            tex.wrapS = THREE.RepeatWrapping;
            tex.wrapT = THREE.ClampToEdgeWrapping;

            // Equirect strip: width = 360°, height = vertical FOV.
            // Ideal upper-hemisphere map is 4:1 (360×90). 4096×1100 is
            // ~3.72:1, about 97° tall.
            const img = tex.image as { width: number; height: number };
            const aspect = img.width / Math.max(1, img.height);
            const imageVFov = (Math.PI * 2) / aspect;
            const upperVFov = Math.PI * 0.5;
            const spill = SPILL_SKY_KEYS.has(name);
            if (spill) {
              // Whole image, same degrees-per-pixel. Zenith is the top edge.
              // The bottom edge lands imageVFov below the zenith, a few
              // degrees under the horizon. Clamp holds that edge to the nadir.
              const vScale = Math.PI / Math.max(imageVFov, 1e-4);
              tex.repeat.set(1, vScale);
              tex.offset.set(0, 1 - vScale);
            } else {
              // Top 90° only. The lower hemisphere mirrors that crop.
              const vRepeat = Math.min(1, upperVFov / imageVFov);
              tex.repeat.set(1, vRepeat);
              tex.offset.set(0, 1 - vRepeat);
            }
            tex.needsUpdate = true;

            const mat = new THREE.MeshBasicMaterial({
              map: tex,
              side: THREE.BackSide,
              depthWrite: false,
              fog: false,
              toneMapped: false,
            });
            const radius = skyboxRadius(name);
            const geometry = spill
              ? new THREE.SphereGeometry(radius, 64, 48)
              : mirrorLowerHemisphere(new THREE.SphereGeometry(radius, 64, 48));
            const mesh = new THREE.Mesh(geometry, mat);
            mesh.position.y = SKYBOX_Y_BY_KEY[name] ?? 0;
            mesh.name = `Skybox_${name}`;
            mesh.renderOrder = -10;
            mesh.frustumCulled = false;
            mesh.visible = false;
            // Clipped sky bloom (masked to dome) — not halo bloom.
            if (name === 'Retro_Palms' || name === 'Neon_Palms' || name === 'Neon_Sunset') enableSkyBloom(mesh);
            isolateSkyFromPointLights(mesh);
            this.root.add(mesh);
            this.skyCache.set(name, mesh);
            this.skyInflight.delete(name);
            resolve(mesh);
          },
          undefined,
          () => {
            this.skyMissing.add(name);
            this.skyInflight.delete(name);
            resolve(null);
          },
        );
      });
      this.skyInflight.set(name, pending);
    }
    return pending;
  }

  private async loadOceanSky(name: string): Promise<THREE.Object3D | null> {
    const cached = this.skyCache.get(name);
    if (cached) return cached;
    if (this.skyMissing.has(name)) return null;

    let pending = this.skyInflight.get(name);
    if (!pending) {
      pending = (async () => {
        try {
          await this.ensureOceanMap();
          const src = this.oceanTex;
          if (!src) {
            this.skyMissing.add(name);
            return null;
          }
          const map = src.clone();
          map.colorSpace = THREE.SRGBColorSpace;
          map.wrapS = THREE.RepeatWrapping;
          map.wrapT = THREE.RepeatWrapping;
          map.needsUpdate = true;

          const radius = skyboxRadius(name);
          const geometry = new THREE.SphereGeometry(radius, 128, 96);
          const position = geometry.getAttribute('position') as THREE.BufferAttribute;
          const normal = geometry.getAttribute('normal') as THREE.BufferAttribute;
          const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
          const mat = new THREE.MeshStandardMaterial({
            map,
            color: this.skyTint.get(name) ?? 0xffffff,
            side: THREE.BackSide,
            depthWrite: false,
            fog: false,
            toneMapped: false,
            roughness: 0.45,
            metalness: 0.15,
          });
          const pool = this.poolLight.get(name) ?? DEFAULT_POOL_LIGHT;
          attachPoolCenterLight(mat, pool.color, pool.intensity);
          const mesh = new THREE.Mesh(geometry, mat);
          mesh.name = `Skybox_${name}`;
          // Clipped sky bloom (masked to the sphere) — not halo bloom.
          enableSkyBloom(mesh);
          isolateSkyFromPointLights(mesh);
          mesh.renderOrder = -10;
          mesh.frustumCulled = false;
          mesh.visible = false;
          this.root.add(mesh);
          this.skyCache.set(name, mesh);
          this.oceanSkyCache.set(name, {
            mesh,
            rest: new Float32Array(position.array as Float32Array),
            normals: new Float32Array(normal.array as Float32Array),
            positions: position,
            uvs: uv,
            radius,
          });
          return mesh;
        } catch {
          this.skyMissing.add(name);
          return null;
        } finally {
          this.skyInflight.delete(name);
        }
      })();
      this.skyInflight.set(name, pending);
    }
    return pending;
  }

  /** Scroll and displace an ocean sky the same way a WaterPlane ripples. */
  private updateOceanSky(key: string): void {
    const sky = this.oceanSkyCache.get(key);
    if (!sky?.mesh.visible) return;

    const map = (sky.mesh.material as THREE.MeshBasicMaterial).map;
    const { enabled, amplitude, frequency, speed } = this.ripple;
    const pos = sky.positions.array as Float32Array;
    if (!enabled || amplitude <= 1e-6) {
      pos.set(sky.rest);
      sky.positions.needsUpdate = true;
      if (map) {
        map.offset.set(0, 0);
        map.repeat.set(1, 1);
      }
      sky.mesh.geometry.computeVertexNormals();
      return;
    }

    const t = this.time * speed;
    const tile = Math.max(0.05, frequency) * OCEAN_SKY_TILE_SCALE;
    const wave = amplitude * sky.radius * OCEAN_SKY_WAVE;
    if (map) {
      map.offset.set(t * 0.035, t * 0.022);
      map.repeat.set(tile, tile);
    }

    const rest = sky.rest;
    const nrm = sky.normals;
    for (let i = 0, vi = 0; i < rest.length; i += 3, vi++) {
      let h: number;
      if (this.oceanPixels) {
        const u0 = sky.uvs.getX(vi);
        const v0 = sky.uvs.getY(vi);
        const h1 = this.sampleOceanHeight(u0 * tile + t * 0.08, v0 * tile + t * 0.05);
        const h2 = this.sampleOceanHeight(u0 * tile * 0.7 - t * 0.04, v0 * tile * 0.85 + t * 0.07);
        h = h1 * 0.65 + h2 * 0.35;
      } else {
        const x = rest[i]!;
        const y = rest[i + 1]!;
        const z = rest[i + 2]!;
        h =
          Math.sin(x * tile + t) * Math.cos(z * tile * 0.85 + t * 1.15) * 0.55 +
          Math.sin((x + y) * tile * 0.55 - t * 0.9) * 0.3 +
          Math.sin((x * 0.35 - z) * tile * 1.4 + t * 1.35) * 0.15;
      }
      pos[i] = rest[i]! + nrm[i]! * h * wave;
      pos[i + 1] = rest[i + 1]! + nrm[i + 1]! * h * wave;
      pos[i + 2] = rest[i + 2]! + nrm[i + 2]! * h * wave;
    }
    sky.positions.needsUpdate = true;
    sky.mesh.geometry.computeVertexNormals();
  }
}
