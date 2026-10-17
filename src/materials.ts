import * as THREE from 'three';

/** Unity Resources/GhoulMaterials/Real/*.mat _BaseColor (style Real). */
const SKIN: Record<string, number> = {
  Bleached: 0xc4d5b3,
  Stricken: 0x845b9f,
  Irradiated: 0x4e44a7,
  Plagued: 0x548d4c,
  Cursed: 0x8d3b3a,
  Stained: rgb(0.5372549, 0.41176474, 0.0), // ochre
  Ashen: 0x2e2e2e,
  Rosy: 0xffadad,
  Poolside: 0x34bed4, // cyan
  Bone: rgb(0.85, 0.82, 0.75),
  Crayola: rgb(0.34117648, 0.53333336, 0.3529412),
  Drall: rgb(0.49411768, 0.80392164, 0.8313726),
  Lilb: rgb(0.54509807, 0.4156863, 0.0),
  Ray: 0xd18f66,
  OldOne: rgb(0.2, 0.5411765, 0.41176474),
};

/** Unity Real/*Dark.mat _BaseColor — head material slot 2. */
const SKIN_DARK: Record<string, number> = {
  Bleached: 0x564f48,
  Stricken: 0x5c4270,
  Irradiated: 0x2c284c,
  Plagued: 0x182313,
  Cursed: 0x460c15,
  Stained: rgb(0.27450982, 0.22352943, 0.0),
  Ashen: 0x111111,
  Rosy: 0x95697a,
  Poolside: 0x2b7691,
  Bone: rgb(0.35, 0.33, 0.3),
  Crayola: rgb(0.15, 0.25, 0.16),
  Drall: rgb(0.2, 0.4, 0.42),
  Lilb: rgb(0.25, 0.18, 0.0),
  Ray: 0x734d38,
  OldOne: rgb(0.08, 0.25, 0.18),
};

/** Optional per-skin lit finish (paintSlot defaults when missing). */
const SKIN_FINISH: Record<string, { roughness: number; metalness: number }> = {
  Plagued: { roughness: 0.79, metalness: 0.23 },
  Irradiated: { roughness: 0.82, metalness: 0 },
  Ashen: { roughness: 0.71, metalness: 0 },
  Stricken: { roughness: 0.53, metalness: 0.12 },
  Cursed: { roughness: 0.85, metalness: 0.02 },
  Bleached: { roughness: 0.85, metalness: 0.02 },
  Poolside: { roughness: 0.25, metalness: 0.21 },
  Rosy: { roughness: 0.85, metalness: 0 },
  Ray: { roughness: 0.91, metalness: 0.52 },

};

const DEFAULT_SKIN_ROUGHNESS = 0.85;
const DEFAULT_SKIN_METALNESS = 0.02;

function rgb(r: number, g: number, b: number): number {
  return (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
}

/** Match Unity material base/emission colors. */
const ACCENT: Record<
  string,
  { color: number; emissive?: number; emissiveIntensity?: number; roughness?: number; metalness?: number }
> = {
  RedHalo: { color: 0xff1a1a },
  WhiteHalo: { color: 0xffffff },
  BlueHalo: { color: 0x7eecee },
  GoldHalo: { color: 0xffcc00 },
  BMGHalo: { color: 0xff3d9a },
  MowhawkRed: { color: 0xdb0000, roughness: 0.64, metalness: 0.36 },
  MowhawkTeal: { color: 0x138174, roughness: 0.85, metalness: 0.02 },
  RagGreen: { color: 0x1c4a1c, roughness: 0.85, metalness: 0.02 },
  RagBlue: { color: 0x3a5aaa },
  RoseRed: { color: 0xcc2244 },
  RosePink: { color: 0xf5a8bf, emissive: 0x000000, emissiveIntensity: 1, roughness: 0.39, metalness: 0.1 },
  RoseWhite: { color: 0x949494, roughness: 0.85, metalness: 0.51 },
  RoseDead: { color: 0x7d756d, emissive: 0x000000, emissiveIntensity: 1, roughness: 0.62, metalness: 0.4 },
  RoseGreen: { color: 0x267e26, emissive: 0x000000, emissiveIntensity: 1, roughness: 0.85, metalness: 0.02 },
  RoseDeadGreen: { color: 0x486837, emissive: 0x000000, emissiveIntensity: 1, roughness: 0.53, metalness: 0.32 },
  ArrowWood: { color: 0x644016, emissive: 0x000000, emissiveIntensity: 1, roughness: 1, metalness: 0 },
  ArrowRed: { color: 0x700000, roughness: 0.85, metalness: 0.02 },
  ArrowGreen: { color: 0x1b691b, emissive: 0x000000, emissiveIntensity: 1, roughness: 1, metalness: 0.02 },
  Black: { color: 0x000000 },
  jaysGlasses_0: { color: 0x6b5952, emissive: 0x000000, emissiveIntensity: 1, roughness: 0.14, metalness: 0.82 },
  jaysGlasses_1: { color: 0xffffff, emissive: 0x000000, emissiveIntensity: 1, roughness: 1, metalness: 0 },
  eyeBlood_0: { color: 0xa52d00, emissive: 0x000000, emissiveIntensity: 1, roughness: 0.17, metalness: 0.41 },
  eyeBlood_1: { color: 0xa52d00, emissive: 0x000000, emissiveIntensity: 1, roughness: 0.1, metalness: 0.41 },
  blueViper_0: { color: 0x162cb8, emissive: 0x000000, emissiveIntensity: 1, roughness: 0, metalness: 0.58 },
  blueViper_1: { color: 0x0047a3, emissive: 0x000000, emissiveIntensity: 1, roughness: 0.4, metalness: 0.55 },
  bandage_0: { color: 0xe8cda1, emissive: 0x000000, emissiveIntensity: 1, roughness: 1, metalness: 0 },
  bandage_1: { color: 0xc3af7f, emissive: 0x000000, emissiveIntensity: 1, roughness: 1, metalness: 0 },
  tatteredCloak_0: { color: 0x331f00, roughness: 0.86, metalness: 0 },
  // Hood rim — Unity ColorDim #8a5400; slight emissive so it reads through dither + cloak depth
  tatteredCloak_1: {
    color: 0x8a5400,
    emissive: 0x8a5400,
    emissiveIntensity: 0.45,
    roughness: 1,
    metalness: 0,
  },
  arrow_2: { color: 0x6d3d18, emissive: 0x000000, emissiveIntensity: 1, roughness: 1, metalness: 0 },
  arrow_3: { color: 0x72726b, emissive: 0x000000, emissiveIntensity: 1, roughness: 0.416, metalness: 0.72 },
  DialatedEyes_0: { color: 0xd185a6, emissive: 0x000000, emissiveIntensity: 1, roughness: 0.6, metalness: 0.02 },
  DialatedEyes_1: { color: 0x000000, emissive: 0x000000, emissiveIntensity: 1 },
  DialatedEyes_2: { color: 0xce7ea3, emissive: 0x000000, emissiveIntensity: 1, roughness: 0.6, metalness: 0.03 },
  DialatedEyes_3: { color: 0x000000, emissive: 0x000000, emissiveIntensity: 1 },
  CyclopsStareEyes_0: { color: 0xffffff, emissive: 0x000000, emissiveIntensity: 1, roughness: 0, metalness: 0 },
  CyclopsStareEyes_1: { color: 0xe60000, emissive: 0x000000, emissiveIntensity: 1, roughness: 1, metalness: 1 },
  BeadyEyes_0: { color: 0x000000, emissive: 0x000000, emissiveIntensity: 1 },
  BeadyEyes_1: { color: 0xfff4f1, emissive: 0x000000, emissiveIntensity: 1, roughness: 0, metalness: 0 },
  BeadyEyes_2: { color: 0x000000, emissive: 0x000000, emissiveIntensity: 1, roughness: 1, metalness: 1 },
  BeadyEyes_3: { color: 0xfff4f1, emissive: 0x000000, emissiveIntensity: 1, roughness: 0, metalness: 0 },
  xeKF420_0: { color: 0xffffff, emissive: 0x000000, emissiveIntensity: 1, roughness: 0, metalness: 0 },
  xeKF420_1: { color: 0x999999, emissive: 0x000000, emissiveIntensity: 1, roughness: 0.198, metalness: 0.921 },
  xeKF420_2: { color: 0x909290, emissive: 0x000000, emissiveIntensity: 1, roughness: 0.12, metalness: 0.45 },
  xeKF420_3: { color: 0xdd9a78, emissive: 0x000000, emissiveIntensity: 1, roughness: 1, metalness: 0 },
  xeKF420_4: { color: 0xffffff, emissive: 0x000000, emissiveIntensity: 1, roughness: 0, metalness: 0.742 },
  innerCircle_0: { color: 0x6a1616, emissive: 0x000000, emissiveIntensity: 1, roughness: 1, metalness: 0 },
  innerCircle_1: { color: 0xb0982b, emissive: 0x000000, emissiveIntensity: 1, roughness: 0.16, metalness: 0.21 },
  GlareEyes_0: { color: 0xe4e4cb, emissive: 0x000000, emissiveIntensity: 1, roughness: 1, metalness: 0 },
  GlareEyes_1: { color: 0xa00600, emissive: 0x000000, emissiveIntensity: 1, roughness: 0.85, metalness: 0.02 },
  GlareEyes_2: { color: 0xffffff, emissive: 0x000000, emissiveIntensity: 1, roughness: 1, metalness: 0 },
  GlareEyes_3: { color: 0xff0800, emissive: 0x000000, emissiveIntensity: 1, roughness: 0.85, metalness: 0.02 },
  sudoGems_0: { color: 0xffadeb, emissive: 0x000000, emissiveIntensity: 1, roughness: 0.53, metalness: 0.16 },
  sudoGems_1: { color: 0xffadeb, emissive: 0x000000, emissiveIntensity: 1, roughness: 0.53, metalness: 0.16 },
  sudoGems_2: { color: 0x3cc2ac, emissive: 0x000000, emissiveIntensity: 1, roughness: 0, metalness: 0 },
  rayGhoul_0: { color: 0xffffff, emissive: 0x000000, emissiveIntensity: 1, roughness: 1, metalness: 0 },
  rayGhoul_1: { color: 0xffffff, emissive: 0x000000, emissiveIntensity: 1, roughness: 1, metalness: 0 },
  rayGhoul_2: { color: 0xffffff, emissive: 0x000000, emissiveIntensity: 1, roughness: 1, metalness: 0 },
  rayGhoul_3: { color: 0x000000, emissive: 0x000000, emissiveIntensity: 1 },
  rayGhoul_4: { color: 0x050505, emissive: 0x000000, emissiveIntensity: 1 },
  eyeTears_0: { color: 0x414dd2, emissive: 0x000000, emissiveIntensity: 1, roughness: 0, metalness: 0.05 },
  bullHorns_0: { color: 0xd6c084, emissive: 0x000000, emissiveIntensity: 1, roughness: 0.2, metalness: 0.7 },
  key_0: { color: 0xeab950, emissive: 0x000000, emissiveIntensity: 1, roughness: 0.66, metalness: 1 },
  vaporwaveTea_0: { color: 0xffffff, emissive: 0x000000, emissiveIntensity: 1, roughness: 0.62, metalness: 0.554 },
  vaporwaveTea_1: { color: 0xba942b, emissive: 0x000000, emissiveIntensity: 1, roughness: 0.62, metalness: 0.78 },
  loldefi_0: { color: 0x00add5, emissive: 0x000000, emissiveIntensity: 1, roughness: 1, metalness: 0 },
  loldefi_1: { color: 0xffadca, emissive: 0x000000, emissiveIntensity: 1, roughness: 1, metalness: 0.27 },
  loldefi_2: { color: 0xffa8c1, emissive: 0x000000, emissiveIntensity: 1, roughness: 1, metalness: 0 },
  nc69r_0: { color: 0x9a9a9a, emissive: 0x000000, emissiveIntensity: 1, roughness: 0.103, metalness: 0.92 },
  nc69r_1: { color: 0x1a1a1a, emissive: 0x000000, emissiveIntensity: 1, roughness: 0.195, metalness: 0.739 },
  nc69r_2: { color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1.5, roughness: 1, metalness: 0.38 },
  beams_0: { color: 0x37ff00 },
  beams_1: { color: 0x66e943 },
  beams_2: { color: 0x87fb2e },
  beams_3: { color: 0x66e943 },
  beams_4: { color: 0x66e943 },
  InfernalCore: { color: 0x0c000f },
  InfernalMid: { color: 0x000000 },
  InfernalEdge: { color: 0xa84e8d },

};

const EYE_COLORS: Record<string, number> = {
  BlueEyes: 0x2244ff,
  GreenEyes: 0x57b11f,
  PinkEyes: 0xff66aa,
  RedEyes: 0xff0000,
  YellowEyes: 0xffcc00,
};

/** Solid scene clear colors for Trait BG mode (replaces the black void). */
const BACKGROUND: Record<string, number> = {
  None: 0x000000,
  Earth: 0x090200,
  Gloom: 0x070008,
  Sorrow: 0x010306,
  Decay: 0x020900,
  Pitch_Black: 0x000000,
  Based_Ghoul_Blue: 0x3187d3,
  Darkness: 0x000000,
  Dungeon: 0x000000,
  BasedChain: 0x000000,
  Retro_Sunset: 0x000000,
  Based_Classic: 0xecb38e,
  Retro_Palms: 0x15000f,
  Vaporwave_Palms: 0x000000,
  Vaporwave_Columns: 0x000000,
  Neon_Sunset: 0x000000,
  Neon_Palms: 0x000000,
  Vaporwave_Dreams: 0x000000,
  Chipwave: 0x000000,
  Rad: 0x000000,
  Moonbased: 0x000000,
  Based_Loans: 0x637ca1,
  Rebase_Radio: 0x000000,
  Pool_1: 0x000000,
};

/** Vertical clear-colour gradient (top → bottom) for Trait BG. */
export type BackgroundGradient = {
  top: number;
  bottom: number;
  /** 0 = knife-edge at mid-frame, 1 = full-frame blend, >1 = extra-soft (no solid edges). */
  distance?: number;
};

export const DEFAULT_GRADIENT_DISTANCE = 1;

const BACKGROUND_GRADIENT: Record<string, BackgroundGradient> = {
  Based_Loans: { top: 0x2a4b89, bottom: 0x637ca1 },
  Retro_Palms: { top: 0x15000f, bottom: 0x15000f },
  Based_Classic: { top: 0x498dc1, bottom: 0xecb38e, distance: 0.44 },

};

/** Tint for procedural Trait BG cloud sprites (white map × colour). */
const BACKGROUND_CLOUDS: Record<string, number> = {
  Based_Loans: 0xffffff,
};

/** Distance fog for Trait BG 3D scenes (per background trait key). */
export type BackgroundFog = {
  enabled: boolean;
  color: number;
  near: number;
  far: number;
};

const BACKGROUND_FOG: Record<string, BackgroundFog> = {
  Retro_Palms: { enabled: true, color: 0x240019, near: 4.9, far: 32.85 },
  Neon_Sunset: { enabled: true, color: 0xce397e, near: 3.95, far: 80 },

};

export function backgroundColor(name: string): number {
  return BACKGROUND[name] ?? 0x000000;
}

/** Top/bottom clear colours. Falls back to solid `backgroundColor` for both ends. */
export function backgroundGradient(name: string): BackgroundGradient {
  const g = BACKGROUND_GRADIENT[name];
  if (g) {
    return {
      top: g.top,
      bottom: g.bottom,
      distance: g.distance ?? DEFAULT_GRADIENT_DISTANCE,
    };
  }
  const c = backgroundColor(name);
  return { top: c, bottom: c, distance: DEFAULT_GRADIENT_DISTANCE };
}

export function backgroundCloudColor(name: string): number {
  return BACKGROUND_CLOUDS[name] ?? 0xffffff;
}

export function backgroundHasClouds(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(BACKGROUND_CLOUDS, name);
}

export function backgroundFog(name: string): BackgroundFog {
  const saved = BACKGROUND_FOG[name];
  if (saved) {
    return {
      enabled: saved.enabled,
      color: saved.color,
      near: saved.near,
      far: Math.max(saved.far, saved.near + 0.01),
    };
  }
  return {
    enabled: false,
    color: backgroundColor(name),
    near: 1.5,
    far: 4,
  };
}

export function listBackgroundKeys(): string[] {
  return Object.keys(BACKGROUND);
}

/** Trait-BG directional “sun” (per background trait key). */
export type BackgroundDirLight = {
  enabled: boolean;
  color: number;
  intensity: number;
  /** Degrees around Y; 0 = from +Z, 90 = from +X. */
  azimuth: number;
  /** Degrees above horizon; 90 = straight down from above. */
  elevation: number;
};

export const DEFAULT_DIR_LIGHT: BackgroundDirLight = {
  enabled: false,
  color: 0xfff2d0,
  intensity: 2.4,
  azimuth: 35,
  elevation: 48,
};

const BACKGROUND_DIR_LIGHT: Record<string, BackgroundDirLight> = {  Neon_Sunset: { enabled: true, color: 0x742a44, intensity: 12.8, azimuth: 160, elevation: 32 },
  Retro_Palms: { enabled: true, color: 0xffd0a3, intensity: 2.7, azimuth: 169, elevation: 42 },

};

export function backgroundDirLight(name: string): BackgroundDirLight {
  const saved = BACKGROUND_DIR_LIGHT[name];
  if (saved) return { ...saved };
  return { ...DEFAULT_DIR_LIGHT };
}

/** Vertex ocean ripple for WaterPlane meshes (per background trait key). */
export type BackgroundRipple = {
  enabled: boolean;
  amplitude: number;
  frequency: number;
  speed: number;
};

const BACKGROUND_RIPPLE: Record<string, BackgroundRipple> = {
  // Ocean disabled for now — re-enable via FX → Ocean when ready.
  Retro_Palms: { enabled: false, amplitude: 0.045, frequency: 1.6, speed: 1.15 },
  Neon_Sunset: { enabled: true, amplitude: 0.19, frequency: 16, speed: 0.4 },

};

export function backgroundRipple(name: string): BackgroundRipple {
  const saved = BACKGROUND_RIPPLE[name];
  if (saved) {
    return {
      enabled: saved.enabled,
      amplitude: saved.amplitude,
      frequency: saved.frequency,
      speed: saved.speed,
    };
  }
  return { enabled: false, amplitude: 0.04, frequency: 1.5, speed: 1 };
}

/** WaterPlane lit material (per background trait key). */
export type BackgroundOceanMat = {
  color: number;
  metalness: number;
  roughness: number;
  opacity: number;
  envMapIntensity: number;
};

export const DEFAULT_OCEAN_MAT: BackgroundOceanMat = {
  color: 0x2a6a88,
  metalness: 0.35,
  roughness: 0.22,
  opacity: 0.92,
  envMapIntensity: 1.2,
};

const BACKGROUND_OCEAN_MAT: Record<string, BackgroundOceanMat> = {  Neon_Sunset: { color: 0x34005e, metalness: 0.44, roughness: 0.44, opacity: 0.66, envMapIntensity: 0 },

};

export function backgroundOceanMat(name: string): BackgroundOceanMat | null {
  const saved = BACKGROUND_OCEAN_MAT[name];
  if (!saved) return null;
  return { ...saved };
}

export function skinColor(base: string): THREE.Color {
  return new THREE.Color(SKIN[base] ?? SKIN.Bleached!);
}

export function skinDarkColor(base: string): THREE.Color {
  return new THREE.Color(SKIN_DARK[base] ?? SKIN_DARK.Bleached!);
}

export function accentColor(name: string): THREE.Color {
  return new THREE.Color(ACCENT[name]?.color ?? 0x888888);
}

export function eyeColor(materialName: string): THREE.Color {
  return new THREE.Color(EYE_COLORS[materialName] ?? 0xff0000);
}

/** Layer used for selective bloom (halo). Halo also stays on layer 0 for correct depth. */
export const BLOOM_LAYER = 1;

/** Mark a hierarchy for bloom while keeping it in the main depth pass. */
export function enableBloomLayer(root: THREE.Object3D): void {
  root.traverse((o) => {
    o.userData.bloom = true;
    o.layers.enable(0);
    o.layers.enable(BLOOM_LAYER);
  });
}

/** Skybox bloom — extracted separately and masked to the dome silhouette. */
export function enableSkyBloom(root: THREE.Object3D): void {
  root.traverse((o) => {
    o.userData.skyBloom = true;
    o.layers.enable(0);
  });
}

/** Put every object back on the default layer (no bloom). */
export function clearBloomLayers(root: THREE.Object3D): void {
  root.traverse((o) => {
    o.userData.bloom = false;
    o.userData.skyBloom = false;
    o.layers.disable(BLOOM_LAYER);
    o.layers.enable(0);
  });
}

function isColorMaterial(
  mat: THREE.Material,
): mat is THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial | THREE.MeshBasicMaterial | THREE.MeshLambertMaterial {
  return (
    mat instanceof THREE.MeshStandardMaterial ||
    mat instanceof THREE.MeshPhysicalMaterial ||
    mat instanceof THREE.MeshBasicMaterial ||
    mat instanceof THREE.MeshLambertMaterial
  );
}

function hasTextureMaps(mat: THREE.Material): boolean {
  const m = mat as THREE.MeshStandardMaterial;
  return !!(
    m.map ||
    m.normalMap ||
    m.emissiveMap ||
    m.alphaMap ||
    m.roughnessMap ||
    m.metalnessMap ||
    m.aoMap ||
    m.bumpMap
  );
}

/** Tint color/PBR on a clone so authored maps (glasses prints, etc.) survive ACCENT save. */
function tintKeepMaps(
  src: THREE.Material,
  accent: {
    color: number;
    roughness?: number;
    metalness?: number;
    emissive?: number;
    emissiveIntensity?: number;
  },
  name: string,
): THREE.Material {
  const hook = src.onBeforeCompile;
  const cacheKey = src.customProgramCacheKey;
  const m = src.clone();
  // Material.clone() drops onBeforeCompile. The visor scroll lives there.
  m.onBeforeCompile = hook;
  m.customProgramCacheKey = () => cacheKey.call(m);
  if (isColorMaterial(m)) m.color.setHex(accent.color);
  if (m instanceof THREE.MeshStandardMaterial || m instanceof THREE.MeshPhysicalMaterial) {
    if (accent.roughness != null) m.roughness = accent.roughness;
    if (accent.metalness != null) m.metalness = accent.metalness;
    if (accent.emissive != null) {
      m.emissive.setHex(accent.emissive);
      m.emissiveIntensity = accent.emissiveIntensity ?? 1;
    }
  }
  m.name = name;
  m.needsUpdate = true;
  return m;
}

/** Flat cell-shaded look: solid lit color (responds to scene lights / brightness). */
function paintSlot(
  src: THREE.Material,
  hex: number,
  finish?: { roughness?: number; metalness?: number; emissive?: number; emissiveIntensity?: number },
): THREE.Material {
  if ((hex & 0xffffff) === 0) return paintBlackMaterial(src);
  const m = new THREE.MeshStandardMaterial({
    color: hex,
    roughness: finish?.roughness ?? DEFAULT_SKIN_ROUGHNESS,
    metalness: finish?.metalness ?? DEFAULT_SKIN_METALNESS,
    side: THREE.DoubleSide,
    vertexColors: false,
  });
  if (finish?.emissive != null) {
    m.emissive = new THREE.Color(finish.emissive);
    m.emissiveIntensity = finish.emissiveIntensity ?? 1;
  }
  m.name = src.name || m.name;
  return m;
}

function collectMeshes(root: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  // Always traverse — Bandage (and similar) is a Mesh with a Mesh child; early-returning
  // on `root.isMesh` hid the second material slot.
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) out.push(m);
  });
  return out;
}

/** Unity renderer slot → GLTF material[] index, or multi-prim mesh index. */
export function materialAtSlot(root: THREE.Object3D, slot: number): THREE.Material | null {
  const meshes = collectMeshes(root);
  if (meshes.length === 0) return null;
  if (meshes.length > 1) {
    const mesh = meshes[slot];
    if (!mesh) return null;
    return Array.isArray(mesh.material) ? mesh.material[0]! : mesh.material;
  }
  const mesh = meshes[0]!;
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  return mats[slot] ?? null;
}

/** Stable ACCENT key for parts that have no Unity materials[] rule (e.g. jaysGlasses). */
export function partAccentKey(partId: string, slot: number): string {
  return `${partId}_${slot}`;
}

export function hasAccent(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(ACCENT, name);
}

/** Apply saved `${partId}_${slot}` ACCENT entries after a part is shown. */
export function applyPartAccentOverrides(root: THREE.Object3D, partId: string): void {
  const meshes = collectMeshes(root);
  if (meshes.length === 0) return;

  const slotCount =
    meshes.length > 1
      ? meshes.length
      : Array.isArray(meshes[0]!.material)
        ? meshes[0]!.material.length
        : 1;

  for (let slot = 0; slot < slotCount; slot++) {
    const key = partAccentKey(partId, slot);
    if (!hasAccent(key)) continue;
    tintObject(root, slot, key);
  }
}

export function forEachMaterialSlot(
  root: THREE.Object3D,
  fn: (slot: number, material: THREE.Material) => void,
): void {
  const meshes = collectMeshes(root);
  if (meshes.length === 0) return;
  if (meshes.length > 1) {
    meshes.forEach((mesh, slot) => {
      const mat = Array.isArray(mesh.material) ? mesh.material[0]! : mesh.material;
      fn(slot, mat);
    });
    return;
  }
  const mats = Array.isArray(meshes[0]!.material) ? meshes[0]!.material : [meshes[0]!.material];
  mats.forEach((mat, slot) => fn(slot, mat));
}

/**
 * Unity head: slot0 = base, slot1 = Black, slot2 = baseDark.
 * Body: usually a single slot0 material.
 * GLTF may express multi-material as one mesh (material[]) or N child meshes.
 */
export function applySkinSlots(
  root: THREE.Object3D,
  lightHex: number,
  darkHex: number,
  finish?: { roughness?: number; metalness?: number },
): void {
  const slots = [lightHex, 0x000000, darkHex];

  const meshes = collectMeshes(root);
  if (meshes.length === 0) return;

  // Multi-prim head: one material per mesh, slots by mesh order
  if (meshes.length > 1) {
    meshes.forEach((mesh, i) => {
      const hex = slots[Math.min(i, slots.length - 1)]!;
      const src = Array.isArray(mesh.material) ? mesh.material[0]! : mesh.material;
      mesh.material = paintSlot(src, hex, finish);
    });
    return;
  }

  const mesh = meshes[0]!;
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  if (mats.length === 1) {
    mesh.material = paintSlot(mats[0]!, lightHex, finish);
    return;
  }
  mesh.material = mats.map((mat, i) =>
    paintSlot(mat, slots[Math.min(i, slots.length - 1)]!, finish),
  );
}

export function applySkinToObject(
  root: THREE.Object3D,
  base: string,
  override?: { light?: number; dark?: number },
): void {
  const light = override?.light ?? skinColor(base).getHex();
  const dark = override?.dark ?? skinDarkColor(base).getHex();
  const finish = SKIN_FINISH[base];
  applySkinSlots(root, light, dark, finish);
}

export function hexToCss(hex: number): string {
  return `#${(hex & 0xffffff).toString(16).padStart(6, '0')}`;
}

export function cssToHex(css: string): number {
  const cleaned = css.trim().replace(/^#/, '');
  return Number.parseInt(cleaned, 16) & 0xffffff;
}

/** Make imported GLB materials readable; lift near-black except intentional Black. */
export function normalizeMaterials(root: THREE.Object3D, opts?: { keepBlack?: boolean }): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const next = mats.map((mat) => {
      if (!isColorMaterial(mat)) return mat;
      const color = 'color' in mat ? mat.color.clone() : new THREE.Color(0xcccccc);
      const hsl = { h: 0, s: 0, l: 0 };
      color.getHSL(hsl);
      if (!opts?.keepBlack && hsl.l < 0.12) {
        color.setRGB(0.45, 0.45, 0.48);
      }
      return new THREE.MeshStandardMaterial({
        color,
        roughness: 0.7,
        metalness: 0.05,
        side: THREE.DoubleSide,
      });
    });
    mesh.material = Array.isArray(mesh.material) ? next : next[0]!;
  });
}

let cigTexture: THREE.Texture | null = null;

/**
 * Unity CigReal ships as KHR_materials_pbrSpecularGlossiness with a diffuse map.
 * Three r152+ dropped that extension, so Cig1/Cig2 arrive untextured — re-bind the map.
 */
export function restoreCigTexture(root: THREE.Object3D): void {
  if (!cigTexture) {
    cigTexture = new THREE.TextureLoader().load('/textures/cig-texture.jpg');
    cigTexture.colorSpace = THREE.SRGBColorSpace;
    cigTexture.flipY = false;
    cigTexture.wrapS = THREE.RepeatWrapping;
    cigTexture.wrapT = THREE.RepeatWrapping;
  }
  const map = cigTexture;

  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const isCigMesh = mesh.name === 'Cig1' || mesh.name === 'Cig2';
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    let changed = false;
    const next = mats.map((src) => {
      const isCigMat = /cigreal/i.test(src.name || '');
      if (!isCigMesh && !isCigMat) return src;
      if (
        src instanceof THREE.MeshStandardMaterial ||
        src instanceof THREE.MeshPhysicalMaterial
      ) {
        if (src.map === map) return src;
        src.map = map;
        src.color.setRGB(1, 1, 1);
        src.roughness = 0.85;
        src.metalness = 0;
        src.needsUpdate = true;
        return src;
      }
      const m = new THREE.MeshStandardMaterial({
        map,
        color: 0xffffff,
        roughness: 0.85,
        metalness: 0,
        side: THREE.DoubleSide,
      });
      m.name = src.name || 'CigReal';
      changed = true;
      return m;
    });
    if (changed || isCigMesh) {
      mesh.material = Array.isArray(mesh.material) ? next : next[0]!;
    }
  });
}

export function tintObject(root: THREE.Object3D, slot: number, materialName: string): void {
  const accent = ACCENT[materialName] ?? { color: 0x888888 };
  const color = new THREE.Color(accent.color);
  const isHalo = materialName.includes('Halo');

  if (isHalo) enableBloomLayer(root);

  const apply = (src: THREE.Material): THREE.Material => {
    if (materialName === 'Black') {
      return paintBlackMaterial(src);
    }
    // Halos: flat unlit cell color (like eyes) so they stay vivid through lighting + bloom.
    if (isHalo) {
      const m = new THREE.MeshBasicMaterial({
        color,
        side: THREE.DoubleSide,
        toneMapped: false,
        fog: false,
      });
      m.name = materialName;
      return m;
    }
    if (hasTextureMaps(src)) {
      return tintKeepMaps(src, accent, materialName);
    }
    const m = paintSlot(src, color.getHex(), {
      roughness: accent.roughness,
      metalness: accent.metalness,
      emissive: accent.emissive,
      emissiveIntensity: accent.emissiveIntensity,
    });
    m.name = materialName;
    return m;
  };

  const meshes = collectMeshes(root);
  if (meshes.length === 0) return;

  // Multi-prim export: Unity material slots map to mesh order (rose stem, arrow, etc.).
  if (meshes.length > 1) {
    const mesh = meshes[slot];
    if (!mesh) return;
    const src = Array.isArray(mesh.material) ? mesh.material[0]! : mesh.material;
    mesh.material = apply(src);
    return;
  }

  const mesh = meshes[0]!;
  if (Array.isArray(mesh.material)) {
    if (slot < mesh.material.length) {
      const next = mesh.material.slice();
      next[slot] = apply(next[slot]!);
      mesh.material = next;
    }
  } else if (slot === 0) {
    mesh.material = apply(mesh.material);
  }
}

function paintBlackMaterial(src: THREE.Material): THREE.Material {
  const m = new THREE.MeshBasicMaterial({
    color: 0x000000,
    side: THREE.DoubleSide,
    toneMapped: false,
    fog: false,
    vertexColors: false,
  });
  m.name = src.name || 'Black';
  return m;
}

/** Opaque eye discharge (Unity Discharge mats are _Surface: Opaque). */
export function paintDischarge(root: THREE.Object3D, hex: number): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.renderOrder = 0;
    mesh.material = new THREE.MeshStandardMaterial({
      color: hex,
      roughness: 0.45,
      metalness: 0.05,
      transparent: false,
      depthWrite: true,
      depthTest: true,
      side: THREE.DoubleSide,
      vertexColors: false,
    });
  });
}

/** Unity Real lens colors (opaque cell mats — GLB wrongly exported transmission). */
const LENS_COLOR: Record<string, number> = {
  blueviper: rgb(0.09758811, 0.16914038, 0.4056604),
  riffraff: rgb(0.75, 0.08, 0.05),
  melon: rgb(0.15, 0.55, 0.2),
  lilb: rgb(0.1, 0.1, 0.12),
  default: rgb(0.15, 0.2, 0.35),
};

function lensColorForName(name: string): number {
  const n = name.toLowerCase();
  if (n.includes('viper')) return LENS_COLOR.blueviper!;
  if (n.includes('riff')) return LENS_COLOR.riffraff!;
  if (n.includes('melon')) return LENS_COLOR.melon!;
  if (n.includes('lilb') || n.includes('lil_b')) return LENS_COLOR.lilb!;
  return LENS_COLOR.default!;
}

/** Kill GLB transmission/blend so the visor occludes arms, keep authored maps. */
function makeLensOpaque(src: THREE.Material): THREE.Material {
  const m = src.clone();
  if (m instanceof THREE.MeshPhysicalMaterial) {
    m.transmission = 0;
    m.thickness = 0;
  }
  m.transparent = false;
  m.opacity = 1;
  m.depthWrite = true;
  m.depthTest = true;
  m.side = THREE.FrontSide;
  m.needsUpdate = true;
  return m;
}

/**
 * Unity eyewear lenses are opaque (_Surface: 0). GLB ships them as
 * transmission glass, which makes temple arms visible through the visor.
 * Textured lenses (Slaughtermelon print, etc.) keep their maps; untextured
 * visors become solid cell colors that depth-occlude arms (and blood).
 */
export function prepareEyewearTransparency(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? [...mesh.material] : [mesh.material];
    let changed = false;
    for (let i = 0; i < mats.length; i++) {
      const src = mats[i]!;
      const name = `${src.name || ''} ${mesh.name || ''}`;
      if (/arm/i.test(name) && !/lens/i.test(name)) continue;
      const isLens =
        /lens/i.test(name) ||
        ('transmission' in src && (src as THREE.MeshPhysicalMaterial).transmission > 0) ||
        (isColorMaterial(src) && (src.transparent || src.opacity < 0.99));
      if (!isLens) continue;
      if (hasTextureMaps(src)) {
        mats[i] = makeLensOpaque(src);
        changed = true;
        continue;
      }
      mats[i] = new THREE.MeshStandardMaterial({
        color: lensColorForName(name),
        roughness: 0.35,
        metalness: 0.05,
        transparent: false,
        opacity: 1,
        depthWrite: true,
        depthTest: true,
        side: THREE.FrontSide,
        vertexColors: false,
        name: src.name,
      });
      changed = true;
    }
    if (!changed) return;
    mesh.material = mats.length === 1 ? mats[0]! : mats;
  });
}

/** Force solid unlit black (cranium Eye Socket “hole”). */
export function paintBlack(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.material = paintBlackMaterial(mesh.material as THREE.Material);
  });
}

/** Unlit eyes (Unity RedEyes is Unlit Color) + selective bloom like halos. */
export function paintEyes(root: THREE.Object3D, materialName?: string): void {
  enableBloomLayer(root);
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const src = Array.isArray(mesh.material) ? mesh.material[0]! : mesh.material;
    let color: THREE.Color;
    if (materialName) {
      color = eyeColor(materialName);
    } else if (isColorMaterial(src) && 'color' in src) {
      color = src.color.clone();
    } else {
      color = new THREE.Color(0xffffff);
    }
    const m = new THREE.MeshBasicMaterial({
      color,
      side: THREE.DoubleSide,
      toneMapped: false,
      fog: false,
      vertexColors: false,
    });
    m.name = src.name || materialName || 'Eyes';
    mesh.material = m;
  });
}

/** Unity BeamMaterials/*Beam* colors (Solid _Color / Gradient _BaseColor). */
const BEAM_COLORS: Record<string, number> = {
  White_Beams: 0xffffff,
  Pink_Beams: 0xf54395,
  Gold_Beams: 0xf5ca3d,
  Green_Beams: 0x66e943,
  Red_Beams: 0xff000a,
  Blue_Beams: 0x00f0ec,
};

export function beamColorForPowerful(powerful: string): number {
  return BEAM_COLORS[powerful] ?? 0xff000a;
}

let beamGradientMap: THREE.Texture | null = null;

function getBeamGradientMap(): THREE.Texture {
  if (beamGradientMap) return beamGradientMap;
  const tex = new THREE.TextureLoader().load('/textures/whiteGradient.png');
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  // Default flipY made the fade strong at the tip; invert so strength is at the eyes.
  tex.flipY = false;
  beamGradientMap = tex;
  return tex;
}

/** Eye shafts use gradient; nose / balls are solid (matches Unity BeamLeft/Right vs Nose/Balls). */
function isBeamGradientMesh(mesh: THREE.Object3D): boolean {
  let o: THREE.Object3D | null = mesh;
  while (o) {
    const n = o.name.toLowerCase().replace(/_/g, '');
    if (n.includes('ball') || n.includes('nose') || n.includes('placeholder')) return false;
    if (n.includes('beam') && (n.includes('left') || n.includes('right'))) return true;
    o = o.parent;
  }
  return false;
}

/**
 * Unity RedBeamGradient: transparent additive + white→black fade map.
 * Solids (nose/balls): unlit opaque color. Bloom so they read through dither.
 */
export function paintBeams(root: THREE.Object3D, hex: number): void {
  enableBloomLayer(root);
  const color = new THREE.Color(hex);
  const gradientMap = getBeamGradientMap();

  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const gradient = isBeamGradientMesh(mesh);
    mesh.renderOrder = 2;
    if (gradient) {
      mesh.material = new THREE.MeshBasicMaterial({
        color,
        map: gradientMap,
        transparent: true,
        opacity: 1,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide,
        toneMapped: false,
        fog: false,
        vertexColors: false,
      });
    } else {
      mesh.material = new THREE.MeshBasicMaterial({
        color,
        transparent: false,
        depthWrite: true,
        depthTest: true,
        side: THREE.DoubleSide,
        toneMapped: false,
        fog: false,
        vertexColors: false,
      });
    }
  });
}

/**
 * Eye lasers yaw together from the sockets. They sit on the midpoint between
 * the authored right pose and its mirror, and only reach 20% of the way
 * toward either end. Nose and ball meshes stay put — only the two shafts
 * move, for every beam color. Cosine so each side is a turn, not a stop.
 */
const BEAM_SWAY_PERIOD = 16;
/** Fraction of the old center-to-end gap kept on each side. */
const BEAM_SWAY_REACH = 0.2;

type SwayBeam = {
  object: THREE.Object3D;
  rest: THREE.Quaternion;
  /** Head up, expressed in the beam parent's space. */
  axis: THREE.Vector3;
};

const swayBeams: SwayBeam[] = [];
let beamSwayElapsed = 0;
/** Signed yaw (radians) of the authored shafts. Zero offset keeps that pose. */
let beamSwayHalf = 0;

const _swayQuat = new THREE.Quaternion();
const _swayInv = new THREE.Quaternion();
const _swayBase = new THREE.Vector3();
const _swayCorner = new THREE.Vector3();

function farthestBeamCorner(mesh: THREE.Mesh): THREE.Vector3 {
  const geo = mesh.geometry;
  if (!geo.boundingBox) geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const tip = new THREE.Vector3();
  if (!bb) return tip;
  let best = -1;
  for (const x of [bb.min.x, bb.max.x]) {
    for (const y of [bb.min.y, bb.max.y]) {
      for (const z of [bb.min.z, bb.max.z]) {
        _swayCorner.set(x, y, z);
        const len = _swayCorner.lengthSq();
        if (len > best) {
          best = len;
          tip.copy(_swayCorner);
        }
      }
    }
  }
  return tip;
}

/** Head +Y walked down into `beam.parent` local space. */
function headUpInParent(beam: THREE.Object3D, head: THREE.Object3D): THREE.Vector3 {
  const axis = new THREE.Vector3(0, 1, 0);
  const chain: THREE.Object3D[] = [];
  let o: THREE.Object3D | null = beam.parent;
  while (o && o !== head) {
    chain.push(o);
    o = o.parent;
  }
  for (let i = chain.length - 1; i >= 0; i--) {
    _swayInv.copy(chain[i]!.quaternion).invert();
    axis.applyQuaternion(_swayInv);
  }
  return axis.normalize();
}

/** Signed yaw of the shaft in head space. +Z is straight out of the face. */
function pointInHead(beam: THREE.Object3D, head: THREE.Object3D, local: THREE.Vector3): THREE.Vector3 {
  const v = local.clone();
  let o: THREE.Object3D | null = beam;
  while (o && o !== head) {
    v.multiply(o.scale);
    v.applyQuaternion(o.quaternion);
    v.add(o.position);
    o = o.parent;
  }
  return v;
}

function beamYawInHead(beam: THREE.Object3D, head: THREE.Object3D, tipLocal: THREE.Vector3): number {
  const tip = pointInHead(beam, head, tipLocal);
  const base = pointInHead(beam, head, _swayBase.set(0, 0, 0));
  tip.sub(base);
  return Math.atan2(tip.x, tip.z);
}

export function bindBeamSway(root: THREE.Object3D): void {
  swayBeams.length = 0;
  beamSwayHalf = 0;
  let head: THREE.Object3D | null = null;
  root.traverse((o) => {
    if (!head && (o.name === 'mixamorig:Head' || o.name === 'mixamorigHead')) head = o;
  });
  if (!head) return;

  const yaws: number[] = [];
  for (const name of ['Beam_Left', 'Beam_Right']) {
    const beam = root.getObjectByName(name);
    const mesh = beam as THREE.Mesh | undefined;
    if (!beam || !mesh?.isMesh) continue;
    const tip = farthestBeamCorner(mesh);
    yaws.push(beamYawInHead(beam, head, tip));
    swayBeams.push({
      object: beam,
      rest: beam.quaternion.clone(),
      axis: headUpInParent(beam, head),
    });
  }
  if (!yaws.length) return;
  beamSwayHalf = yaws.reduce((a, b) => a + b, 0) / yaws.length;
}

export function updateBeamSway(dt: number): void {
  if (!swayBeams.length || beamSwayHalf === 0) return;
  if (dt > 0) beamSwayElapsed += dt;
  const phase = (beamSwayElapsed / BEAM_SWAY_PERIOD) * Math.PI * 2;
  // -half is straight ahead. ±reach*half is 20% of the way to each old end.
  const offset = -beamSwayHalf * (1 - BEAM_SWAY_REACH * Math.cos(phase));
  for (const b of swayBeams) {
    _swayQuat.setFromAxisAngle(b.axis, offset);
    b.object.quaternion.copy(_swayQuat).multiply(b.rest);
  }
}

/**
 * nc69r visor (`nc69r Display`). The two lenses share one map, and the right
 * lens V runs upward while the left lens V runs downward. One shared V shift
 * therefore sends them opposite ways on the face. Flipping the offset per side
 * cancels that mirror and they travel together.
 * Span is the visor’s own V height: a texel at one edge arrives at the other,
 * then the trip reverses. The map repeats so the gradient never runs out.
 */
const NC69_SCROLL_LEG = 1.6;
const NC69_SCROLL_SPAN = 0.4945;
const nc69ScrollUniform = { value: 0 };
let nc69ScrollElapsed = 0;
let nc69Gradient: THREE.Texture | null = null;

/** Live Unity file, not the JPEG baked into ghoul-avatar.glb. */
function nc69DisplayTexture(): THREE.Texture {
  if (nc69Gradient) return nc69Gradient;
  const tex = new THREE.TextureLoader().load(`/textures/redgradient.png?v=${Date.now()}`);
  tex.name = 'redgradient';
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  nc69Gradient = tex;
  return tex;
}


function displayScrollInstalled(mat: THREE.Material): boolean {
  return mat.onBeforeCompile.toString().includes('nc69-scroll-v4');
}

function isNc69DisplayMaterial(mat: THREE.Material, meshName: string): boolean {
  // ACCENT save renames the material to nc69r_2. The display mesh stays nc69r_3.
  if (meshName === 'nc69r_3') return true;
  const name = `${mat.name} ${meshName}`.toLowerCase();
  if (name.includes('nc69r') && name.includes('display')) return true;
  const mapName = ((mat as THREE.MeshStandardMaterial).map?.name ?? '').toLowerCase();
  return name.includes('nc69r') && mapName.includes('redgradient');
}

export function attachNc69rDisplayScroll(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      if (!mat || !isNc69DisplayMaterial(mat, mesh.name)) continue;
      const std = mat as THREE.MeshStandardMaterial;
      const map = nc69DisplayTexture();
      std.map = map;
      std.emissiveMap = map;
      std.emissive.set(0xffffff);
      std.emissiveIntensity = 1.5;
      std.toneMapped = false;
      std.fog = false;
      std.needsUpdate = true;
      enableBloomLayer(mesh);
      if (displayScrollInstalled(mat)) continue;
      std.onBeforeCompile = (shader) => {
        shader.uniforms.uNc69Scroll = nc69ScrollUniform;
        shader.vertexShader =
          'uniform float uNc69Scroll;\n' +
          shader.vertexShader.replace(
            '#include <uv_vertex>',
            /* glsl */ `
            #include <uv_vertex>
            #ifdef USE_MAP
              // nc69-scroll-v4
              // Bridge strip sits at U ~ 0.93; leave that seam parked.
              // Same V shift on both lenses: their unwraps are mirrored, so
              // the bands travel opposite ways on the face.
              if (uv.x <= 0.85) {
                vMapUv.y -= uNc69Scroll;
                #ifdef USE_EMISSIVEMAP
                  vEmissiveMapUv.y -= uNc69Scroll;
                #endif
              }
            #endif
            `,
          );
      };
      std.customProgramCacheKey = () => 'nc69r-display-scroll-v4';
      std.userData.nc69DisplayScroll = true;
    }
  });
}

export function updateNc69rDisplayScroll(dt: number): void {
  if (dt > 0) nc69ScrollElapsed += dt;
  // Cosine, not an ease-in-out. Reverse acceleration is already building
  // through the far half of the trip, so the turn doesn't sit at a stop.
  const theta = ((nc69ScrollElapsed % (NC69_SCROLL_LEG * 2)) / NC69_SCROLL_LEG) * Math.PI;
  nc69ScrollUniform.value = ((1 - Math.cos(theta)) / 2) * NC69_SCROLL_SPAN;
}
