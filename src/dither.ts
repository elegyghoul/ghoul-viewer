import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { BLOOM_LAYER } from './materials';

export const PIXEL_SIZE = 155;
export const PIXEL_SCALE = 3;
export const DISPLAY_SIZE = PIXEL_SIZE * PIXEL_SCALE;

const CALM_PALETTE_URL = '/Palette/dither-calm-48-1x.png';

const MAX_PALETTE = 64;

/** sRGB swatches appended to every loaded palette strip (survives palette URL swaps). */
const EXTRA_PALETTE_HEX: readonly number[] = [0x567e56, 0x8b6300];

function hexToPaletteColor(hex: number): THREE.Vector3 {
  return new THREE.Vector3(
    ((hex >> 16) & 0xff) / 255,
    ((hex >> 8) & 0xff) / 255,
    (hex & 0xff) / 255,
  );
}

function paletteColorKey(c: THREE.Vector3): string {
  return `${Math.round(c.x * 255)},${Math.round(c.y * 255)},${Math.round(c.z * 255)}`;
}

/** Append EXTRA_PALETTE_HEX entries not already on the strip; trim strip tail if over MAX_PALETTE. */
function appendExtraPaletteColors(colors: THREE.Vector3[]): THREE.Vector3[] {
  const seen = new Set(colors.map(paletteColorKey));
  const extras: THREE.Vector3[] = [];
  for (const hex of EXTRA_PALETTE_HEX) {
    const c = hexToPaletteColor(hex);
    const key = paletteColorKey(c);
    if (seen.has(key)) continue;
    seen.add(key);
    extras.push(c);
  }
  if (extras.length === 0) return colors.slice(0, MAX_PALETTE);
  const merged = [...colors, ...extras];
  if (merged.length <= MAX_PALETTE) return merged;
  const keepStrip = Math.max(0, MAX_PALETTE - extras.length);
  return [...colors.slice(0, keepStrip), ...extras];
}

const quadVert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const combineFrag = /* glsl */ `
precision highp float;
uniform sampler2D tBase;
uniform sampler2D tBloom;
uniform sampler2D tSkyBloom;
uniform sampler2D tSkyMask;
uniform float uSkyBloom;
varying vec2 vUv;
void main() {
  vec3 base = texture2D(tBase, vUv).rgb;
  vec3 bloom = texture2D(tBloom, vUv).rgb;
  vec3 skyBloom = texture2D(tSkyBloom, vUv).rgb;
  vec3 skyMask = texture2D(tSkyMask, vUv).rgb;
  // Hard-clip sky glow to visible skybox pixels (no bleed onto foreground).
  float m = step(0.001, max(skyMask.r, max(skyMask.g, skyMask.b)));
  gl_FragColor = vec4(base + bloom + skyBloom * m * uSkyBloom, 1.0);
}
`;

const ditherFrag = /* glsl */ `
precision highp float;

uniform sampler2D tDiffuse;
uniform vec3 uPalette[${MAX_PALETTE}];
uniform int uPaletteSize;
uniform float uDitherStrength;
uniform vec2 uResolution;

varying vec2 vUv;

float bayer8(vec2 fragCoord) {
  int x = int(mod(fragCoord.x, 8.0));
  int y = int(mod(fragCoord.y, 8.0));
  int index = x + y * 8;
  float m[64];
  m[0]=0.0/64.0;   m[1]=32.0/64.0;  m[2]=8.0/64.0;   m[3]=40.0/64.0;
  m[4]=2.0/64.0;   m[5]=34.0/64.0;  m[6]=10.0/64.0;  m[7]=42.0/64.0;
  m[8]=48.0/64.0;  m[9]=16.0/64.0;  m[10]=56.0/64.0; m[11]=24.0/64.0;
  m[12]=50.0/64.0; m[13]=18.0/64.0; m[14]=58.0/64.0; m[15]=26.0/64.0;
  m[16]=12.0/64.0; m[17]=44.0/64.0; m[18]=4.0/64.0;  m[19]=36.0/64.0;
  m[20]=14.0/64.0; m[21]=46.0/64.0; m[22]=6.0/64.0;  m[23]=38.0/64.0;
  m[24]=60.0/64.0; m[25]=28.0/64.0; m[26]=52.0/64.0; m[27]=20.0/64.0;
  m[28]=62.0/64.0; m[29]=30.0/64.0; m[30]=54.0/64.0; m[31]=22.0/64.0;
  m[32]=3.0/64.0;  m[33]=35.0/64.0; m[34]=11.0/64.0; m[35]=43.0/64.0;
  m[36]=1.0/64.0;  m[37]=33.0/64.0; m[38]=9.0/64.0;  m[39]=41.0/64.0;
  m[40]=51.0/64.0; m[41]=19.0/64.0; m[42]=59.0/64.0; m[43]=27.0/64.0;
  m[44]=49.0/64.0; m[45]=17.0/64.0; m[46]=57.0/64.0; m[47]=25.0/64.0;
  m[48]=15.0/64.0; m[49]=47.0/64.0; m[50]=7.0/64.0;  m[51]=39.0/64.0;
  m[52]=13.0/64.0; m[53]=45.0/64.0; m[54]=5.0/64.0;  m[55]=37.0/64.0;
  m[56]=63.0/64.0; m[57]=31.0/64.0; m[58]=55.0/64.0; m[59]=23.0/64.0;
  m[60]=61.0/64.0; m[61]=29.0/64.0; m[62]=53.0/64.0; m[63]=21.0/64.0;
  return m[index];
}

vec3 linearToSrgb(vec3 c) {
  return pow(max(c, vec3(0.0)), vec3(1.0 / 2.2));
}

vec3 nearestPalette(vec3 color) {
  vec3 best = uPalette[0];
  float bestDist = 1e20;
  for (int i = 0; i < ${MAX_PALETTE}; i++) {
    if (i >= uPaletteSize) break;
    vec3 p = uPalette[i];
    vec3 d = color - p;
    float dist = dot(d, d);
    if (dist < bestDist) {
      bestDist = dist;
      best = p;
    }
  }
  return best;
}

void main() {
  vec3 linearColor = texture2D(tDiffuse, vUv).rgb;
  vec3 color = linearToSrgb(linearColor);
  vec3 snapped = nearestPalette(color);
  vec3 delta = color - snapped;
  // Solid palette colors (pitch black BG, flat fills) stay flat.
  // Bayer noise would otherwise kick them into the next swatch.
  if (dot(delta, delta) > 0.0004) {
    float threshold = bayer8(vUv * uResolution) - 0.5;
    color += threshold * uDitherStrength;
    color = clamp(color, 0.0, 1.0);
    snapped = nearestPalette(color);
  }
  gl_FragColor = vec4(snapped, 1.0);
}
`;

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load palette: ${url}`));
    img.src = url;
  });
}

/** Load calm palette strip as sRGB 0–1 colors for dither matching. */
export async function loadCalmPalette(): Promise<THREE.Vector3[]> {
  const img = await loadImage(CALM_PALETTE_URL);
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  const { data } = ctx.getImageData(0, 0, img.width, 1);
  const colors: THREE.Vector3[] = [];
  for (let i = 0; i < img.width; i++) {
    colors.push(
      new THREE.Vector3(data[i * 4]! / 255, data[i * 4 + 1]! / 255, data[i * 4 + 2]! / 255),
    );
  }
  const hasPitchBlack = colors.some((c) => c.x <= 1 / 255 && c.y <= 1 / 255 && c.z <= 1 / 255);
  if (!hasPitchBlack) colors.unshift(new THREE.Vector3(0, 0, 0));
  return appendExtraPaletteColors(colors);
}

function makeRt(depth: boolean): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(PIXEL_SIZE, PIXEL_SIZE, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    colorSpace: THREE.LinearSRGBColorSpace,
    depthBuffer: depth,
    stencilBuffer: false,
    magFilter: THREE.NearestFilter,
    minFilter: THREE.NearestFilter,
  });
}

export type BloomMode = 'objects' | 'screen';

export class DitherComposer {
  bloomMode: BloomMode = 'objects';
  readonly bloomPass: UnrealBloomPass;
  private readonly baseTarget: THREE.WebGLRenderTarget;
  private readonly combineTarget: THREE.WebGLRenderTarget;
  private readonly haloBloomTarget: THREE.WebGLRenderTarget;
  private readonly skyMaskTarget: THREE.WebGLRenderTarget;
  private readonly bloomComposer: EffectComposer;
  private readonly bloomRenderPass: RenderPass;
  private readonly combineMaterial: THREE.ShaderMaterial;
  private readonly ditherMaterial: THREE.ShaderMaterial;
  private readonly blitMaterial: THREE.ShaderMaterial;
  private readonly quadScene: THREE.Scene;
  private readonly quadCamera: THREE.OrthographicCamera;
  private readonly darkSceneBg = new THREE.Color(0x000000);
  private readonly darkMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 });
  private readonly savedMaterials = new Map<number, THREE.Material | THREE.Material[]>();

  constructor(renderer: THREE.WebGLRenderer, palette: THREE.Vector3[]) {
    this.baseTarget = makeRt(true);
    this.combineTarget = makeRt(false);
    this.haloBloomTarget = makeRt(false);
    this.haloBloomTarget.texture.magFilter = THREE.LinearFilter;
    this.haloBloomTarget.texture.minFilter = THREE.LinearFilter;
    this.skyMaskTarget = makeRt(true);

    const bloomTarget = makeRt(true);
    bloomTarget.texture.magFilter = THREE.LinearFilter;
    bloomTarget.texture.minFilter = THREE.LinearFilter;

    this.bloomComposer = new EffectComposer(renderer, bloomTarget);
    this.bloomComposer.renderToScreen = false;
    this.bloomComposer.setSize(PIXEL_SIZE, PIXEL_SIZE);

    this.bloomRenderPass = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
    this.bloomRenderPass.clear = true;
    this.bloomComposer.addPass(this.bloomRenderPass);

    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(PIXEL_SIZE, PIXEL_SIZE), 0.1, 0.11, 0.08);
    this.bloomComposer.addPass(this.bloomPass);

    this.combineMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tBase: { value: this.baseTarget.texture },
        tBloom: { value: this.haloBloomTarget.texture },
        tSkyBloom: { value: null as THREE.Texture | null },
        tSkyMask: { value: this.skyMaskTarget.texture },
        uSkyBloom: { value: 1 },
      },
      vertexShader: quadVert,
      fragmentShader: combineFrag,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });

    this.blitMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null as THREE.Texture | null },
      },
      vertexShader: quadVert,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform sampler2D tDiffuse;
        varying vec2 vUv;
        void main() {
          gl_FragColor = texture2D(tDiffuse, vUv);
        }
      `,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });

    const paletteArr = Array.from({ length: MAX_PALETTE }, (_, i) =>
      i < palette.length ? palette[i]!.clone() : new THREE.Vector3(),
    );

    this.ditherMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: this.combineTarget.texture },
        uPalette: { value: paletteArr },
        uPaletteSize: { value: palette.length },
        uDitherStrength: { value: 0.14 },
        uResolution: { value: new THREE.Vector2(PIXEL_SIZE, PIXEL_SIZE) },
      },
      vertexShader: quadVert,
      fragmentShader: ditherFrag,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });

    this.quadScene = new THREE.Scene();
    this.quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.combineMaterial));
  }

  private darkenUnless = (keepKey: 'bloom' | 'skyBloom') => (obj: THREE.Object3D): void => {
    if (obj.userData[keepKey]) return;
    const mesh = obj as THREE.Mesh;
    const line = obj as THREE.Line;
    if (!mesh.isMesh && !line.isLine) return;
    this.savedMaterials.set(obj.id, mesh.material);
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map(() => this.darkMaterial)
      : this.darkMaterial;
  };

  private restoreMaterial = (obj: THREE.Object3D): void => {
    const saved = this.savedMaterials.get(obj.id);
    if (!saved) return;
    (obj as THREE.Mesh).material = saved;
    this.savedMaterials.delete(obj.id);
  };

  private bloomOutputTexture(): THREE.Texture {
    return (
      this.bloomPass as UnrealBloomPass & {
        renderTargetsHorizontal: THREE.WebGLRenderTarget[];
      }
    ).renderTargetsHorizontal[0]!.texture;
  }

  private blitTo(renderer: THREE.WebGLRenderer, src: THREE.Texture, dst: THREE.WebGLRenderTarget): void {
    const quad = this.quadScene.children[0] as THREE.Mesh;
    this.blitMaterial.uniforms.tDiffuse!.value = src;
    quad.material = this.blitMaterial;
    renderer.setRenderTarget(dst);
    renderer.clear();
    renderer.render(this.quadScene, this.quadCamera);
  }

  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): void {
    const prevOutput = renderer.outputColorSpace;
    const prevTone = renderer.toneMapping;
    const prevBg = scene.background;
    const prevMask = camera.layers.mask;

    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    camera.layers.enable(0);
    camera.layers.enable(BLOOM_LAYER);

    const prevShadowAuto = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;

    // 1) Full coloured scene
    renderer.setRenderTarget(this.baseTarget);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.shadowMap.needsUpdate = false;

    this.bloomRenderPass.scene = scene;
    this.bloomRenderPass.camera = camera;

    if (this.bloomMode === 'screen') {
      this.bloomComposer.render();
      this.blitTo(renderer, this.bloomOutputTexture(), this.haloBloomTarget);
      this.combineMaterial.uniforms.uSkyBloom!.value = 0;
      this.combineMaterial.uniforms.tSkyBloom!.value = this.haloBloomTarget.texture;
    } else {
      scene.background = this.darkSceneBg;

      // 2) Halo / accent bloom (unmasked soft bleed)
      scene.traverse(this.darkenUnless('bloom'));
      this.bloomComposer.render();
      scene.traverse(this.restoreMaterial);
      this.blitTo(renderer, this.bloomOutputTexture(), this.haloBloomTarget);

      // 3) Skybox bloom + hard silhouette mask (no bleed onto foreground)
      scene.traverse(this.darkenUnless('skyBloom'));
      renderer.setRenderTarget(this.skyMaskTarget);
      renderer.clear();
      renderer.render(scene, camera);
      this.bloomComposer.render();
      scene.traverse(this.restoreMaterial);
      scene.background = prevBg;

      this.combineMaterial.uniforms.uSkyBloom!.value = 1;
      this.combineMaterial.uniforms.tSkyBloom!.value = this.bloomOutputTexture();
    }
    const quad = this.quadScene.children[0] as THREE.Mesh;
    quad.material = this.combineMaterial;
    renderer.setRenderTarget(this.combineTarget);
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.render(this.quadScene, this.quadCamera);

    // 5) Dither to canvas
    this.ditherMaterial.uniforms.tDiffuse!.value = this.combineTarget.texture;
    quad.material = this.ditherMaterial;
    renderer.setRenderTarget(null);
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.render(this.quadScene, this.quadCamera);

    camera.layers.mask = prevMask;
    renderer.outputColorSpace = prevOutput;
    renderer.toneMapping = prevTone;
    renderer.shadowMap.autoUpdate = prevShadowAuto;
  }

  dispose(): void {
    this.baseTarget.dispose();
    this.combineTarget.dispose();
    this.haloBloomTarget.dispose();
    this.skyMaskTarget.dispose();
    this.bloomComposer.dispose();
    this.bloomPass.dispose();
    this.combineMaterial.dispose();
    this.ditherMaterial.dispose();
    this.blitMaterial.dispose();
    this.darkMaterial.dispose();
  }
}
