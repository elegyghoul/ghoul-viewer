import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { BackgroundOceanMat, BackgroundRipple } from './materials';
import { backgroundColor, backgroundFog, enableSkyBloom } from './materials';

const gltfLoader = new GLTFLoader();
const texLoader = new THREE.TextureLoader();

/** Large enough that camera orbit doesn't show obvious parallax. */
const SKYBOX_RADIUS = 80;

/** Per-trait skybox radius overrides (default: `SKYBOX_RADIUS`). */
const SKYBOX_RADIUS_BY_KEY: Record<string, number> = {
  Retro_Palms: 10_000,
};

/** Per-trait vertical shift (negative = lower horizon). */
const SKYBOX_Y_BY_KEY: Record<string, number> = {
  Retro_Palms: -25,
};

function skyboxRadius(name: string): number {
  return SKYBOX_RADIUS_BY_KEY[name] ?? SKYBOX_RADIUS;
}

function groundColorFromFloor(floor: THREE.Object3D | null, fallback: number): number {
  if (!floor) return fallback;
  const size = new THREE.Vector3();
  let best = fallback;
  let bestArea = 0;
  floor.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox;
    if (!box) return;
    box.getSize(size);
    const area = Math.abs(size.x * size.z);
    if (area <= bestArea) return;
    const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as
      | THREE.MeshBasicMaterial
      | THREE.MeshStandardMaterial
      | undefined;
    if (!mat || !('color' in mat) || !mat.color) return;
    bestArea = area;
    best = mat.color.getHex() & 0xffffff;
  });
  return best;
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

function makeGradientSkyMaterial(top: number, bottom: number, distance: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTop: { value: new THREE.Color(top) },
      uBottom: { value: new THREE.Color(bottom) },
      uDistance: { value: distance },
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
      varying vec4 vClip;
      void main() {
        // Screen-space Y so the mix matches 2D pixel-art BGs (not a 3D horizon).
        // ndcY -1 = bottom of frame, +1 = top.
        // Distance 1 = full-frame blend; lower = tighter; higher = softer edges.
        float ndcY = vClip.y / max(vClip.w, 1e-5);
        float d = max(uDistance, 0.02);
        float t = clamp(0.5 + 0.5 * (ndcY / d), 0.0, 1.0);
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
  private readonly horizonDiscCache = new Map<string, THREE.Mesh>();
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

  hasWaterPlane(key: string | null | undefined): boolean {
    if (!key) return false;
    return (this.waterByBg.get(key)?.length ?? 0) > 0;
  }

  setOceanMaterial(key: string, settings: BackgroundOceanMat): void {
    this.oceanMatByKey.set(key, { ...settings });
    this.applyOceanMatToKey(key);
  }

  readOceanMaterial(key: string): BackgroundOceanMat | null {
    const saved = this.oceanMatByKey.get(key);
    if (saved) return { ...saved };
    const waters = this.waterByBg.get(key);
    const mesh = waters?.[0]?.mesh;
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

  /** Tint procedural cloud sprites (map × colour). */
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
      const disc = this.ensureHorizonDisc(name, floor);
      disc.visible = true;
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
    );
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(SKYBOX_RADIUS, 64, 32), mat);
    mesh.name = `GradientSky_${name}`;
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
    const waters = this.waterByBg.get(key);
    if (!settings || !waters) return;
    for (const w of waters) this.applyOceanMatToMesh(w.mesh, settings);
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
              mat.fog = true;
              mat.needsUpdate = true;
            }
            mesh.castShadow = true;
            mesh.receiveShadow = true;
          });
          this.collectWaterPlanes(root, name);
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

  private ensureHorizonDisc(name: string, floor: THREE.Object3D | null): THREE.Mesh {
    const cached = this.horizonDiscCache.get(name);
    if (cached) return cached;

    const fog = backgroundFog(name);
    const fallback = fog.enabled ? fog.color : backgroundColor(name);
    const color = groundColorFromFloor(floor, fallback);
    const radius = skyboxRadius(name) * 0.999;
    const geo = new THREE.CircleGeometry(radius, 64);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color,
      fog: true,
      depthWrite: true,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = `HorizonDisc_${name}`;
    mesh.position.y = -0.04;
    mesh.renderOrder = -9;
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.receiveShadow = false;
    this.root.add(mesh);
    this.horizonDiscCache.set(name, mesh);
    return mesh;
  }

  private async loadSkybox(name: string): Promise<THREE.Object3D | null> {
    const cached = this.skyCache.get(name);
    if (cached) return cached;
    if (this.skyMissing.has(name)) return null;

    let pending = this.skyInflight.get(name);
    if (!pending) {
      pending = new Promise<THREE.Object3D | null>((resolve) => {
        texLoader.load(
          `/models/skybox/${name}.jpg`,
          (tex) => {
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.flipY = true;
            tex.wrapS = THREE.RepeatWrapping;
            tex.wrapT = THREE.ClampToEdgeWrapping;

            // Equirect strip: width = 360°, height = vertical FOV.
            // Ideal upper-hemisphere map is 4:1 (360×90). Ours is 4096×1100
            // (~3.72:1 ≈ 97° tall) — sample the top 90° and drop the rest.
            const img = tex.image as { width: number; height: number };
            const aspect = img.width / Math.max(1, img.height);
            const imageVFov = (Math.PI * 2) / aspect;
            const domeVFov = Math.PI * 0.5;
            const vRepeat = Math.min(1, domeVFov / imageVFov);
            tex.repeat.set(1, vRepeat);
            tex.offset.set(0, 1 - vRepeat);
            tex.needsUpdate = true;

            const mat = new THREE.MeshBasicMaterial({
              map: tex,
              side: THREE.BackSide,
              depthWrite: false,
              fog: false,
              toneMapped: false,
            });
            // Upper hemisphere only (Y-up) — flat rim sits on the ground plane.
            const radius = skyboxRadius(name);
            const mesh = new THREE.Mesh(
              new THREE.SphereGeometry(radius, 64, 24, 0, Math.PI * 2, 0, domeVFov),
              mat,
            );
            mesh.position.y = SKYBOX_Y_BY_KEY[name] ?? 0;
            mesh.name = `Skybox_${name}`;
            mesh.renderOrder = -10;
            mesh.frustumCulled = false;
            mesh.visible = false;
            // Clipped sky bloom (masked to dome) — not halo bloom.
            if (name === 'Retro_Palms' || name === 'Neon_Sunset') enableSkyBloom(mesh);
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
}
