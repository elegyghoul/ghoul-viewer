import * as THREE from 'three';

/**
 * Point light just in front of Blue Vipers, Riff Raff, and Slaughtermelon.
 * The renderer applies every camera-visible light to every lit mesh, so this
 * light lives on a layer the camera never enables and is added by hand only
 * in those glasses' shaders.
 */

const GLASSES_LIGHT_LAYER = 3;
const COLOR = 0xffffff;
const INTENSITY = 0.095;
const DISTANCE = 0.53;
const DECAY = 2;
/** Meters past the front of the frames, along the glasses' forward axis. */
const GAP = 0;

const TARGETS = new Set(['glasses_-_blueviper', 'glasses_-_riffraff', 'melonglasses']);

const _box = new THREE.Box3();
const _meshBox = new THREE.Box3();
const _center = new THREE.Vector3();
const _corner = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _forward = new THREE.Vector3();
const _world = new THREE.Vector3();

type LightUniforms = {
  color: { value: THREE.Color };
  intensity: { value: number };
  position: { value: THREE.Vector3 };
  distance: { value: number };
};

const uniforms: LightUniforms = {
  color: { value: new THREE.Color(COLOR) },
  intensity: { value: 0 },
  position: { value: new THREE.Vector3() },
  distance: { value: DISTANCE },
};

function glassesName(name: string): boolean {
  return TARGETS.has(name.trim().toLowerCase().replace(/\s+/g, '_'));
}

function chainVisible(obj: THREE.Object3D): boolean {
  let p: THREE.Object3D | null = obj;
  while (p) {
    if (!p.visible) return false;
    p = p.parent;
  }
  return true;
}

function isLitMaterial(
  mat: THREE.Material,
): mat is THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial {
  return mat instanceof THREE.MeshStandardMaterial || mat instanceof THREE.MeshPhysicalMaterial;
}

function attachLight(mat: THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial): void {
  if (mat.userData.glassesPointLight) return;
  mat.userData.glassesPointLight = true;
  const previous = mat.onBeforeCompile;
  const previousKey = mat.customProgramCacheKey?.bind(mat);
  mat.onBeforeCompile = (shader, renderer) => {
    previous?.(shader, renderer);
    shader.uniforms.uGlassesLightColor = uniforms.color;
    shader.uniforms.uGlassesLightIntensity = uniforms.intensity;
    shader.uniforms.uGlassesLightPos = uniforms.position;
    shader.uniforms.uGlassesLightDistance = uniforms.distance;
    shader.fragmentShader =
      'uniform vec3 uGlassesLightColor;\nuniform float uGlassesLightIntensity;\nuniform vec3 uGlassesLightPos;\nuniform float uGlassesLightDistance;\n' +
      shader.fragmentShader.replace(
        '#include <opaque_fragment>',
        /* glsl */ `
          {
            // glasses-point-light-v1
            vec3 fragPos = - vViewPosition;
            vec3 lightPos = (viewMatrix * vec4(uGlassesLightPos, 1.0)).xyz;
            vec3 toLight = lightPos - fragPos;
            float dist = length(toLight);
            float atten = uGlassesLightIntensity / max(dist * dist, 1e-4);
            if (uGlassesLightDistance > 0.0) {
              atten *= pow(clamp(1.0 - pow(dist / uGlassesLightDistance, 4.0), 0.0, 1.0), 2.0);
            }
            vec3 L = toLight / max(dist, 1e-4);
            vec3 N = normalize(normal);
            vec3 V = normalize(vViewPosition);
            vec3 H = normalize(L + V);
            float ndotl = clamp(dot(N, L), 0.0, 1.0);
            float ndoth = clamp(dot(N, H), 0.0, 1.0);
            float rough = clamp(material.roughness, 0.045, 1.0);
            float specPower = exp2(12.0 * (1.0 - rough));
            float spec = pow(ndoth, specPower) * (specPower + 8.0) * 0.125;
            vec3 diffuse = material.diffuseContribution * RECIPROCAL_PI;
            vec3 specular = material.specularColorBlended * spec;
            outgoingLight += (diffuse + specular) * uGlassesLightColor * atten * ndotl;
          }
          #include <opaque_fragment>
        `,
      );
  };
  mat.customProgramCacheKey = () =>
    `glasses-point-light-v1|${previousKey ? previousKey() : ''}`;
  mat.needsUpdate = true;
}

function wireGlasses(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? [...mesh.material] : [mesh.material];
    let changed = false;
    for (let i = 0; i < mats.length; i++) {
      const src = mats[i];
      if (!src || !isLitMaterial(src)) continue;
      if (src.userData.glassesPointLight) continue;
      // Clone so a material shared with the body never receives this light.
      const mat = src.clone();
      attachLight(mat);
      mats[i] = mat;
      changed = true;
    }
    if (changed) mesh.material = Array.isArray(mesh.material) ? mats : mats[0]!;
  });
}

/** Local offset that sits `gap` meters in front of the glasses' front face. */
function placeInFront(light: THREE.Object3D, glasses: THREE.Object3D, gap: number): void {
  glasses.updateWorldMatrix(true, true);
  _box.makeEmpty();
  glasses.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const bb = mesh.geometry.boundingBox;
    if (!bb) return;
    _meshBox.copy(bb).applyMatrix4(mesh.matrixWorld);
    _box.union(_meshBox);
  });
  if (_box.isEmpty()) {
    light.position.set(0, 0, gap);
    return;
  }

  glasses.getWorldQuaternion(_quat);
  _forward.set(0, 0, 1).applyQuaternion(_quat).normalize();
  _box.getCenter(_center);
  let extent = 0;
  const { min, max } = _box;
  for (const x of [min.x, max.x]) {
    for (const y of [min.y, max.y]) {
      for (const z of [min.z, max.z]) {
        _corner.set(x, y, z).sub(_center);
        extent = Math.max(extent, _corner.dot(_forward));
      }
    }
  }
  _world.copy(_center).addScaledVector(_forward, extent + gap);
  glasses.worldToLocal(_world);
  light.position.copy(_world);
}

export class GlassesLightManager {
  private readonly light: THREE.PointLight;
  private hosts: THREE.Object3D[] = [];
  private host: THREE.Object3D | null = null;
  private strength = INTENSITY;
  private gap = GAP;

  constructor() {
    // Intensity stays 0 on the light itself. The renderer would otherwise add it
    // to every lit material. The glasses shader uses `uniforms.intensity`.
    this.light = new THREE.PointLight(COLOR, 0, DISTANCE, DECAY);
    this.light.name = 'GlassesPointLight';
    this.light.castShadow = false;
    this.light.layers.set(GLASSES_LIGHT_LAYER);
    uniforms.color.value.copy(this.light.color);
    uniforms.distance.value = DISTANCE;
  }

  sync(root: THREE.Object3D | null): void {
    this.light.removeFromParent();
    this.hosts = [];
    this.host = null;
    uniforms.intensity.value = 0;
    if (!root) return;

    root.traverse((obj) => {
      if (!glassesName(obj.name)) return;
      this.hosts.push(obj);
      wireGlasses(obj);
    });
    this.followHost();
  }

  /** Shader brightness. The engine light stays at 0 so other meshes are not lit. */
  setStrength(value: number): void {
    this.strength = value;
  }

  /** Meters in front of the frames, along the glasses' forward axis. */
  setDistance(meters: number): void {
    if (meters === this.gap) return;
    this.gap = meters;
    if (this.host) placeInFront(this.light, this.host, this.gap);
  }

  /** Meters from the light before it fades out. 0 leaves inverse-square falloff only. */
  setRange(meters: number): void {
    uniforms.distance.value = meters;
  }

  update(): void {
    this.light.intensity = 0;
    this.light.layers.set(GLASSES_LIGHT_LAYER);
    this.followHost();
    const host = this.host;
    if (!host || !chainVisible(host)) {
      uniforms.intensity.value = 0;
      return;
    }
    this.light.getWorldPosition(uniforms.position.value);
    uniforms.intensity.value = this.strength;
  }

  private followHost(): void {
    const next = this.hosts.find(chainVisible) ?? null;
    if (next === this.host && this.light.parent === next) return;
    this.host = next;
    this.light.removeFromParent();
    if (!next) return;
    next.add(this.light);
    placeInFront(this.light, next, this.gap);
  }
}
