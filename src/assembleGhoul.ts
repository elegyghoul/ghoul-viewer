import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { GhoulTraits, TraitRuleCase, TraitRules } from './types';
import {
  applySkinToObject,
  applyPartAccentOverrides,
  forEachMaterialSlot,
  partAccentKey,
  paintBeams,
  beamColorForPowerful,
  paintBlack,
  paintDischarge,
  paintEyes,
  enableBloomLayer,
  prepareEyewearTransparency,
  tintObject,
  materialAtSlot,
  clearBloomLayers,
  restoreCigTexture,
  skinColor,
  skinDarkColor,
} from './materials';
import {
  UNITY_ALWAYS_HIDE,
  UNITY_EYE_GROUPS,
  UNITY_PART_NAMES,
  UNITY_SOCKETS,
} from './unityNames';

const UNITY_GLB = '/models/ghoul-avatar.glb';

const loader = new GLTFLoader();

function nameVariants(name: string): string[] {
  const trimmed = name.trim();
  const underscored = trimmed.replace(/\s+/g, '_');
  const spaced = trimmed.replace(/_/g, ' ');
  // UnityGLTF turns "Glasses - BlueViper" into "Glasses_-_BlueViper"
  const dashUnderscored = trimmed.replace(/\s*-\s*/g, '_-_').replace(/\s+/g, '_');
  return [...new Set([trimmed, underscored, spaced, dashUnderscored, normalizeName(trimmed), normalizeName(underscored)])];
}

function normalizeName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().toLowerCase().replace(/ /g, '_');
}

function findByName(root: THREE.Object3D, name: string): THREE.Object3D | null {
  const variants = new Set(nameVariants(name).map(normalizeName));
  let found: THREE.Object3D | null = null;
  root.traverse((o) => {
    if (found) return;
    if (variants.has(normalizeName(o.name))) found = o;
  });
  return found;
}

function findAllByName(root: THREE.Object3D, name: string): THREE.Object3D[] {
  const variants = new Set(nameVariants(name).map(normalizeName));
  const out: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (variants.has(normalizeName(o.name))) out.push(o);
  });
  return out;
}

function resolvePart(root: THREE.Object3D, id: string): THREE.Object3D[] {
  const mapped = UNITY_PART_NAMES[id];
  if (!mapped) return findAllByName(root, id);
  const names = Array.isArray(mapped) ? mapped : [mapped];
  const out: THREE.Object3D[] = [];
  const seen = new Set<THREE.Object3D>();
  for (const n of names) {
    for (const obj of findAllByName(root, n)) {
      if (!seen.has(obj)) {
        seen.add(obj);
        out.push(obj);
      }
    }
  }
  return out;
}

function setTreeVisible(obj: THREE.Object3D, visible: boolean): void {
  obj.visible = visible;
}

/** Prefer outermost part roots when resolvePart returns parent+child with the same name. */
function outermostPartRoots(objs: THREE.Object3D[]): THREE.Object3D[] {
  const set = new Set(objs);
  return objs.filter((o) => {
    for (let p = o.parent; p; p = p.parent) {
      if (set.has(p)) return false;
    }
    return true;
  });
}

/**
 * GLTF often shares one material across Bandage parent/child meshes. Clone so each
 * slot can be edited/saved independently (bandage_0 / bandage_1).
 */
function ensureUniqueMeshMaterials(root: THREE.Object3D): void {
  const used = new Set<THREE.Material>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    let changed = false;
    const next = mats.map((m) => {
      if (!m) return m;
      if (!used.has(m)) {
        used.add(m);
        return m;
      }
      const clone = m.clone();
      used.add(clone);
      changed = true;
      return clone;
    });
    if (changed) mesh.material = Array.isArray(mesh.material) ? next : next[0]!;
  });
}

function ensureAncestorsVisible(obj: THREE.Object3D, stopAt: THREE.Object3D | null): void {
  let p: THREE.Object3D | null = obj.parent;
  while (p && p !== stopAt) {
    p.visible = true;
    p = p.parent;
  }
}

export type DebugPartEntry = {
  id: string;
  category: string;
  unityNames: string[];
  found: boolean;
  visible: boolean;
  missingNames: string[];
};

export type MaterialSaveTarget =
  | { kind: 'skin'; key: string; slot: 'light' | 'dark' }
  | { kind: 'accent'; key: string }
  | { kind: 'eye'; key: string }
  | { kind: 'background'; key: string; slot: 'top' | 'bottom' | 'clouds' };

export type EditableMaterial = {
  label: string;
  material: THREE.Material;
  lit: boolean;
  saveTarget?: MaterialSaveTarget;
};

function pushUniqueMaterials(
  out: EditableMaterial[],
  seen: Set<THREE.Material>,
  root: THREE.Object3D,
  labelFor: (mesh: THREE.Mesh, index: number, total: number) => string,
  saveTarget?: MaterialSaveTarget,
): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.visible) return;
    let p: THREE.Object3D | null = mesh;
    while (p) {
      if (!p.visible) return;
      p = p.parent;
    }
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mats.forEach((mat, i) => {
      if (seen.has(mat)) return;
      seen.add(mat);
      const lit = mat instanceof THREE.MeshStandardMaterial || mat instanceof THREE.MeshPhysicalMaterial;
      out.push({
        label: labelFor(mesh, i, mats.length),
        material: mat,
        lit,
        saveTarget,
      });
    });
  });
}

/** World AABB of the primary Based Ghoul body only (never Cudi / accessories). */
export function box3BodyOnly(root: THREE.Object3D): THREE.Box3 {
  const box = new THREE.Box3();
  root.updateWorldMatrix(true, true);
  root.traverse((obj) => {
    if (!obj.visible) return;
    if (obj.name !== 'Based Ghoul Body - Teeth') return;
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    box.union(new THREE.Box3().setFromObject(mesh));
  });
  return box;
}

export function box3Visible(root: THREE.Object3D): THREE.Box3 {
  const box = new THREE.Box3();
  root.updateWorldMatrix(true, true);
  root.traverse((obj) => {
    if (!obj.visible) return;
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    if (!mesh.geometry.boundingBox) return;
    box.union(mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld));
  });
  return box;
}

function listHeadMeshes(root: THREE.Object3D): THREE.Mesh[] {
  const self = root as THREE.Mesh;
  if (self.isMesh) return [self];
  const out: THREE.Mesh[] = [];
  for (const child of root.children) {
    const m = child as THREE.Mesh;
    if (m.isMesh) out.push(m);
  }
  return out;
}

/** Idle/View clips bake inactive Fangs/Flesh at scale 0.01 — drop those tracks. */
function stripInactiveHeadTracks(clips: THREE.AnimationClip[]): void {
  const kill =
    /^(Head_-_Fangs|Head - Fangs|Head_-_Flesh|Head - Flesh|Based_Ghoul_Head|Based Ghoul Head)/i;
  for (const clip of clips) {
    clip.tracks = clip.tracks.filter((t) => !kill.test(t.name.split('.')[0] ?? ''));
  }
}

function applySkinToBodyOnly(
  root: THREE.Object3D,
  base: string,
  override?: { light?: number; dark?: number },
): void {
  const body =
    findByName(root, 'Based Ghoul Body - Teeth') ??
    findByName(root, 'Based Ghoul Body - Fangs') ??
    findByName(root, 'Based Ghoul Body - Flesh');
  if (body) {
    body.visible = true;
    applySkinToObject(body, base, override);
  }

  // Head display node (geometry already swapped onto Head - Teeth)
  const head =
    findByName(root, 'Head - Teeth') ??
    findByName(root, 'Head - Flesh') ??
    findByName(root, 'Head - Fangs');
  if (head) {
    head.visible = true;
    applySkinToObject(head, base, override);
  }
}

export class GhoulAssembler {
  root = new THREE.Group();
  bodyRoot: THREE.Object3D | null = null;
  animations: THREE.AnimationClip[] = [];
  /** Effective skin family name (e.g. Plagued) after unique overrides. */
  skinBase = 'Bleached';
  skinLightHex = skinColor('Bleached').getHex();
  skinDarkHex = skinDarkColor('Bleached').getHex();
  private rules: TraitRules | null = null;
  private ready = false;
  private headMeshes = {
    teeth: null as THREE.Object3D | null,
    fangs: null as THREE.Object3D | null,
    flesh: null as THREE.Object3D | null,
  };
  /** Geometries for each mouth variant — applied onto Head - Teeth (Unity currentHead). */
  private headGeoms: Record<'teeth' | 'fangs' | 'flesh', THREE.BufferGeometry[]> = {
    teeth: [],
    fangs: [],
    flesh: [],
  };

  async init(_attachmentMap: unknown, rules: TraitRules): Promise<void> {
    this.rules = rules;
    const gltf = await loader.loadAsync(UNITY_GLB);
    this.animations = gltf.animations;
    stripInactiveHeadTracks(this.animations);
    this.bodyRoot = gltf.scene;
    this.root.add(this.bodyRoot);
    // CigReal used specular-glossiness in the GLB; Three no longer loads that map.
    restoreCigTexture(this.bodyRoot);

    // Unity uses one currentHead and swaps mesh assets. We keep Head - Teeth as
    // the display node (correct Idle TRS) and swap geometries for Flesh/Fangs.
    this.headMeshes.teeth = findByName(this.bodyRoot, 'Head - Teeth');
    this.headMeshes.fangs = findByName(this.bodyRoot, 'Head - Fangs');
    this.headMeshes.flesh = findByName(this.bodyRoot, 'Head - Flesh');
    for (const kind of ['teeth', 'fangs', 'flesh'] as const) {
      const node = this.headMeshes[kind];
      this.headGeoms[kind] = node ? listHeadMeshes(node).map((m) => m.geometry) : [];
      if (kind !== 'teeth' && node) node.visible = false;
    }

    // Hide Magica / placeholder / lights
    for (const name of UNITY_ALWAYS_HIDE) {
      this.bodyRoot.traverse((o) => {
        if (
          o.name === name ||
          o.name.startsWith('Magica ') ||
          o.name.startsWith('Magica_')
        ) {
          o.visible = false;
        }
      });
    }

    // GLB may include Unity lights — they ignore our Lights panel.
    this.bodyRoot.traverse((o) => {
      const light = o as THREE.Light;
      if (!light.isLight) return;
      light.intensity = 0;
      light.visible = false;
    });

    this.hideAllTraits();

    // Always keep the primary body visible
    const body = findByName(this.bodyRoot, 'Based Ghoul Body - Teeth');
    if (body) body.visible = true;

    this.ready = true;
  }

  private hideAllTraits(): void {
    if (!this.bodyRoot) return;

    clearBloomLayers(this.bodyRoot);

    // Hide every mapped part node
    for (const id of Object.keys(UNITY_PART_NAMES)) {
      for (const obj of resolvePart(this.bodyRoot, id)) {
        obj.visible = false;
      }
    }

    for (const socket of UNITY_SOCKETS) {
      const node = findByName(this.bodyRoot, socket);
      if (!node) continue;
      for (const child of node.children) {
        child.visible = false;
      }
    }

    for (const eye of UNITY_EYE_GROUPS) {
      const node = findByName(this.bodyRoot, eye);
      if (node) node.visible = false;
    }

    const one = findByName(this.bodyRoot, '1/1');
    if (one) {
      for (const child of one.children) child.visible = false;
    }
  }

  private setPartVisible(id: string, visible: boolean): void {
    if (!this.bodyRoot) return;
    let objs = resolvePart(this.bodyRoot, id);
    // HTML cloth uses the static *_webgl cloak meshes; keep Magica source hidden.
    if (visible && (id === 'tatteredCloak' || id === 'innerCircle')) {
      const webgl = objs.filter((o) => /webgl/i.test(o.name));
      if (webgl.length) {
        for (const obj of objs) {
          if (!webgl.includes(obj)) setTreeVisible(obj, false);
        }
        objs = webgl;
      }
    }
    for (const obj of objs) {
      setTreeVisible(obj, visible);
      if (visible) {
        ensureAncestorsVisible(obj, this.bodyRoot);
        // Nested same-name meshes (Bandage/Bandage) may stay authored-hidden.
        obj.traverse((o) => {
          o.visible = true;
        });
        ensureUniqueMeshMaterials(obj);
        if (id === 'eyeSocket' || id === 'perforated' || id === 'punctured') {
          paintBlack(obj);
        }
        // Unity Discharge/*.mat are opaque (_Surface: 0). Transparent blood
        // sorts incorrectly and draws over glasses lenses.
        if (id === 'eyeTears') {
          paintDischarge(obj, 0x484e94); // Tears.mat
        }
        if (id === 'eyeBlood') {
          paintDischarge(obj, 0xa52d00); // Blood.mat
        }
        if (id === 'eyeGunk') {
          paintDischarge(obj, 0x00a813); // Gunk.mat
        }
        if (
          id === 'blueViper' ||
          id === 'riffRaff' ||
          id === 'melonGlasses' ||
          id === 'nc69r' ||
          id === 'xeKF420' ||
          id === 'lilBGlasses' ||
          id === 'jaysGlasses'
        ) {
          prepareEyewearTransparency(obj);
        }
      }
    }
  }

  /** Manual debug toggle (same as trait show/hide). */
  setDebugVisible(id: string, visible: boolean): void {
    if (id.startsWith('eye:')) {
      const eyeName = id.slice(4);
      const node = this.bodyRoot ? findByName(this.bodyRoot, eyeName) : null;
      if (node) {
        node.visible = visible;
        if (visible) ensureAncestorsVisible(node, this.bodyRoot);
      }
      return;
    }
    if (id.startsWith('head:')) {
      const kind = id.slice(5);
      if (visible) this.selectHeadMesh(kind);
      else {
        const node =
          kind === 'teeth'
            ? this.headMeshes.teeth
            : kind === 'fangs'
              ? this.headMeshes.fangs
              : this.headMeshes.flesh;
        if (node) node.visible = false;
      }
      return;
    }
    if (id.startsWith('socketChild:')) {
      // id format socketChild:ParentName/ChildName
      const rest = id.slice('socketChild:'.length);
      const slash = rest.indexOf('/');
      if (slash < 0 || !this.bodyRoot) return;
      const childName = rest.slice(slash + 1);
      const node = findByName(this.bodyRoot, childName);
      if (node) {
        node.visible = visible;
        if (visible) ensureAncestorsVisible(node, this.bodyRoot);
      }
      return;
    }
    this.setPartVisible(id, visible);
  }

  getDebugCatalog(): DebugPartEntry[] {
    if (!this.bodyRoot) return [];
    const entries: DebugPartEntry[] = [];

    const categoryFor = (id: string): string => {
      if (['halo', 'mowhawk', 'candle', 'dirt', 'nightcap', 'circlet', 'redHorns', 'loldefi', 'positronic', 'crown', 'fleshner', 'drallHorns', 'santaHat', 'lilBHat'].includes(id))
        return 'Top Head';
      if (['rag', 'toxicHead'].includes(id)) return 'Lower Head';
      if (['tatteredCloak', 'innerCircle', 'bullHorns'].includes(id)) return 'Mid Head';
      if (['bandage', 'patch'].includes(id)) return 'Lower Eye Acc';
      if (['blueViper', 'riffRaff', 'melonGlasses', 'nc69r', 'xeKF420', 'lilBGlasses', 'jaysGlasses', 'redacted'].includes(id))
        return 'Eye Acc';
      if (['eyeSocket', 'perforated', 'punctured'].includes(id)) return 'Cranium';
      if (['eyeBlood', 'eyeGunk', 'eyeTears'].includes(id)) return 'Eye Discharge';
      if (['mouthBlood', 'mouthSludge', 'arrow', 'rose', 'cig', 'cig2', 'torch', 'blade', 'cross', 'stogie', 'key', 'crayon', 'candyCane', 'staceyAxe'].includes(id))
        return 'Mouth';
      if (['idol', 'vaporwaveTea', 'doodle', 'infernalFlame'].includes(id)) return 'Special';
      if (['flames', 'beams'].includes(id)) return 'Powerful';
      if (['rayGhoul', 'ghoulPegs', 'oldOne', 'dreamer', 'cudi', 'sudoGems', 'idkCandle', 'idkGlasses', 'idkGunk', 'idkParticleGroup'].includes(id))
        return 'Unique';
      return 'Other';
    };

    for (const [id, mapped] of Object.entries(UNITY_PART_NAMES)) {
      const names = Array.isArray(mapped) ? mapped : [mapped];
      const objs = resolvePart(this.bodyRoot, id);
      const found = objs.length > 0;
      const visible = found && objs.some((o) => o.visible);
      entries.push({
        id,
        category: categoryFor(id),
        unityNames: names,
        found,
        visible,
        missingNames: names.filter((n) => !findByName(this.bodyRoot!, n)),
      });
    }

    for (const eye of UNITY_EYE_GROUPS) {
      const node = findByName(this.bodyRoot, eye);
      entries.push({
        id: `eye:${eye}`,
        category: 'Eyes',
        unityNames: [eye],
        found: !!node,
        visible: !!node?.visible,
        missingNames: node ? [] : [eye],
      });
    }

    for (const [kind, node] of Object.entries(this.headMeshes)) {
      entries.push({
        id: `head:${kind}`,
        category: 'Head Mesh',
        unityNames: [node?.name ?? kind],
        found: !!node,
        visible: !!node?.visible,
        missingNames: node ? [] : [kind],
      });
    }

    // Unmapped socket children — helps catch naming mismatches
    const mappedUnityNames = new Set<string>();
    for (const v of Object.values(UNITY_PART_NAMES)) {
      for (const n of Array.isArray(v) ? v : [v]) mappedUnityNames.add(n);
    }
    for (const eye of UNITY_EYE_GROUPS) mappedUnityNames.add(eye);

    for (const socket of UNITY_SOCKETS) {
      const node = findByName(this.bodyRoot, socket);
      if (!node) continue;
      for (const child of node.children) {
        if (mappedUnityNames.has(child.name)) continue;
        if (UNITY_ALWAYS_HIDE.includes(child.name)) continue;
        if (child.name.startsWith('Magica ') || child.name.startsWith('Magica_')) continue;
        entries.push({
          id: `socketChild:${socket}/${child.name}`,
          category: `Unmapped · ${socket}`,
          unityNames: [child.name],
          found: true,
          visible: child.visible,
          missingNames: [],
        });
      }
    }

    return entries;
  }

  private applyCase(rule: TraitRuleCase | undefined): void {
    if (!rule) return;
    for (const id of rule.hide ?? []) this.setPartVisible(id, false);
    for (const id of rule.show ?? []) this.setPartVisible(id, true);
    for (const mat of rule.materials ?? []) {
      if (!this.bodyRoot) continue;
      for (const obj of resolvePart(this.bodyRoot, mat.target)) {
        tintObject(obj, mat.slot, mat.name);
      }
    }
    // Re-apply saved part accents (topEyeAcc etc. have no materials[] rule).
    // Skip beams — opaque ACCENT saves override Unity's additive gradient fade.
    for (const id of rule.show ?? []) {
      if (id === 'beams') continue;
      if (!this.bodyRoot) continue;
      for (const obj of resolvePart(this.bodyRoot, id)) {
        applyPartAccentOverrides(obj, id);
      }
    }
  }

  /**
   * Unity: EnumContains Fangs → headWithFangs, else Flesh → headWithFlesh, else Teeth.
   * Display always on Head - Teeth (animated at scale 1); swap geometries for variants.
   */
  private selectHeadMesh(kind: string): void {
    const display = this.headMeshes.teeth;
    if (this.headMeshes.fangs) this.headMeshes.fangs.visible = false;
    if (this.headMeshes.flesh) this.headMeshes.flesh.visible = false;
    if (!display) return;

    display.visible = true;
    ensureAncestorsVisible(display, this.bodyRoot);

    const key: 'teeth' | 'fangs' | 'flesh' =
      kind === 'fangs' || kind === 'flesh' ? kind : 'teeth';
    const geoms = this.headGeoms[key];
    const meshes = listHeadMeshes(display);
    for (let i = 0; i < meshes.length; i++) {
      const geom = geoms[i] ?? this.headGeoms.teeth[i];
      if (!geom) continue;
      meshes[i]!.geometry = geom;
      geom.computeBoundingSphere();
      geom.computeBoundingBox();
    }
  }

  private parseGhoulSkin(ghoul: string): { mesh: string; base: string } {
    // Same order as GhoulStats.UpdateGhoul EnumContains checks
    let mesh = 'teeth';
    if (ghoul.includes('Fangs')) mesh = 'fangs';
    else if (ghoul.includes('Flesh')) mesh = 'flesh';
    else if (ghoul.includes('Teeth')) mesh = 'teeth';

    const base = ghoul.split('_')[0] || 'Bleached';
    return { mesh, base };
  }

  assemble(traits: GhoulTraits): void {
    if (!this.ready || !this.rules || !this.bodyRoot) {
      throw new Error('GhoulAssembler not initialized');
    }
    const rules = this.rules;
    this.hideAllTraits();

    const { mesh, base } = this.parseGhoulSkin(traits.ghoul);
    this.selectHeadMesh(mesh);
    applySkinToBodyOnly(this.bodyRoot, base);

    // Re-assert body visibility after trait toggles
    const body = findByName(this.bodyRoot, 'Based Ghoul Body - Teeth');
    if (body) body.visible = true;

    const categories: (keyof TraitRules)[] = [
      'lowerEyeAcc',
      'eyeDischarge',
      'lowerHeadAcc',
      'midHeadAcc',
      'mouthAcc',
      'midEyeAcc',
      'cranium',
      'special',
      'topHeadAcc',
      'topEyeAcc',
      'powerful',
    ];

    for (const cat of categories) {
      const table = rules[cat] as Record<string, TraitRuleCase>;
      const value = traits[cat as keyof GhoulTraits] as string;
      this.applyCase(table[value] ?? table.None);
    }

    // Unity BeamMaterials: eye shafts additive+gradient fade; nose/balls solid.
    if (traits.powerful.includes('Beams') && this.bodyRoot) {
      const hex = beamColorForPowerful(traits.powerful);
      for (const obj of resolvePart(this.bodyRoot, 'beams')) {
        paintBeams(obj, hex);
      }
    }

    // Eyes
    const eyeRule = rules.eyes[traits.eyes];
    if (eyeRule?.groupChild) {
      const eyeNode = findByName(this.bodyRoot, eyeRule.groupChild);
      if (eyeNode) {
        eyeNode.visible = true;
        ensureAncestorsVisible(eyeNode, this.bodyRoot);
        // Patch hides RightEye; always restore both so a prior Patch ghoul
        // doesn't leave RightEye off for later loads (matches Unity SetActive).
        const right = eyeNode.getObjectByName('RightEye');
        const left = eyeNode.getObjectByName('LeftEye');
        if (left) left.visible = true;
        if (right) right.visible = traits.lowerEyeAcc !== 'Patch';
        // Single-color Unity eyes (Red/Blue/…) get a flat unlit paint.
        // Authored multi-mat eyes (Dialated, Beady, …) keep GLB slots.
        if (eyeRule.material) {
          paintEyes(eyeNode, eyeRule.material);
        } else {
          enableBloomLayer(eyeNode);
          applyPartAccentOverrides(eyeNode, eyeRule.groupChild);
        }
      }
    }

    // Uniques last
    const unique = rules.unique[traits.unique] ?? rules.unique.None;
    let skinName = base;
    if (unique) {
      this.applyCase(unique);
      if (unique.forcedHead) this.selectHeadMesh(unique.forcedHead);
      if (unique.forcedSkin) {
        skinName = unique.forcedSkin;
        applySkinToBodyOnly(this.bodyRoot, unique.forcedSkin);
      }
      if (unique.hideNormalHead) {
        for (const node of Object.values(this.headMeshes)) {
          if (node) node.visible = false;
        }
      }
      if (unique.forcedEyes) {
        for (const eye of UNITY_EYE_GROUPS) {
          const n = findByName(this.bodyRoot, eye);
          if (n) n.visible = false;
        }
        const eyeNode = findByName(this.bodyRoot, unique.forcedEyes);
        if (eyeNode) {
          eyeNode.visible = true;
          ensureAncestorsVisible(eyeNode, this.bodyRoot);
          const right = eyeNode.getObjectByName('RightEye');
          const left = eyeNode.getObjectByName('LeftEye');
          if (left) left.visible = true;
          if (right) right.visible = traits.lowerEyeAcc !== 'Patch';
          paintEyes(eyeNode);
        }
      }
    }

    this.skinBase = skinName;
    this.skinLightHex = skinColor(skinName).getHex();
    this.skinDarkHex = skinDarkColor(skinName).getHex();
  }

  /** Live-update body/head light + dark skin slots without reassembling traits. */
  recolorSkin(lightHex: number, darkHex: number): void {
    if (!this.bodyRoot) return;
    this.skinLightHex = lightHex & 0xffffff;
    this.skinDarkHex = darkHex & 0xffffff;
    applySkinToBodyOnly(this.bodyRoot, this.skinBase, {
      light: this.skinLightHex,
      dark: this.skinDarkHex,
    });
  }

  /**
   * Materials currently driving a trait on the assembled ghoul.
   * `ghoul` → body/head light, black, dark slots.
   * Other categories → visible part meshes for that trait's show list.
   */
  getMaterialsForTrait(category: keyof GhoulTraits, value: string): EditableMaterial[] {
    if (!this.bodyRoot || !this.rules) return [];
    const out: EditableMaterial[] = [];
    const seen = new Set<THREE.Material>();

    if (category === 'ghoul' || category === 'background') {
      if (category === 'background') return [];
      const body =
        findByName(this.bodyRoot, 'Based Ghoul Body - Teeth') ??
        findByName(this.bodyRoot, 'Based Ghoul Body - Fangs') ??
        findByName(this.bodyRoot, 'Based Ghoul Body - Flesh');
      const head =
        findByName(this.bodyRoot, 'Head - Teeth') ??
        findByName(this.bodyRoot, 'Head - Flesh') ??
        findByName(this.bodyRoot, 'Head - Fangs');
      const skinLabels = ['Light', 'Black', 'Dark'] as const;
      const skinKey = this.skinBase;

      const pushSkinMat = (
        mat: THREE.Material,
        where: string,
        slotName: (typeof skinLabels)[number],
      ): void => {
        if (seen.has(mat)) return;
        seen.add(mat);
        const saveTarget: MaterialSaveTarget | undefined =
          slotName === 'Light'
            ? { kind: 'skin', key: skinKey, slot: 'light' }
            : slotName === 'Dark'
              ? { kind: 'skin', key: skinKey, slot: 'dark' }
              : undefined;
        out.push({
          label: `${where} · ${slotName}`,
          material: mat,
          lit:
            mat instanceof THREE.MeshStandardMaterial ||
            mat instanceof THREE.MeshPhysicalMaterial,
          saveTarget,
        });
      };

      for (const node of [body, head]) {
        if (!node) continue;
        const meshes: THREE.Mesh[] = [];
        const self = node as THREE.Mesh;
        if (self.isMesh) meshes.push(self);
        else {
          for (const child of node.children) {
            const m = child as THREE.Mesh;
            if (m.isMesh) meshes.push(m);
          }
        }
        const where = node === body ? 'Body' : 'Head';
        if (meshes.length > 1) {
          meshes.forEach((mesh, i) => {
            const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            const slotName = skinLabels[Math.min(i, skinLabels.length - 1)]!;
            mats.forEach((mat) => pushSkinMat(mat, where, slotName));
          });
        } else if (meshes[0]) {
          const mats = Array.isArray(meshes[0].material) ? meshes[0].material : [meshes[0].material];
          mats.forEach((mat, i) => {
            const slotName =
              mats.length === 1 ? 'Light' : skinLabels[Math.min(i, skinLabels.length - 1)]!;
            pushSkinMat(mat, where, slotName);
          });
        }
      }
      return out;
    }

    if (category === 'eyes') {
      const eyeRule = this.rules.eyes[value];
      if (!eyeRule?.groupChild) return [];
      const eyeNode = findByName(this.bodyRoot, eyeRule.groupChild);
      if (!eyeNode) return [];
      if (eyeRule.material) {
        pushUniqueMaterials(
          out,
          seen,
          eyeNode,
          (mesh, i, total) => {
            const base = mesh.name || eyeRule.groupChild;
            return total > 1 ? `${base} [${i}]` : base;
          },
          { kind: 'eye', key: eyeRule.material },
        );
        return out;
      }
      // Multi-slot authored eyes — each mesh/material slot is savable as ACCENT.
      forEachMaterialSlot(eyeNode, (slot, mat) => {
        if (seen.has(mat)) return;
        seen.add(mat);
        const key = partAccentKey(eyeRule.groupChild!, slot);
        out.push({
          label: key,
          material: mat,
          lit:
            mat instanceof THREE.MeshStandardMaterial ||
            mat instanceof THREE.MeshPhysicalMaterial,
          saveTarget: { kind: 'accent', key },
        });
      });
      return out;
    }

    const table = this.rules[category as keyof TraitRules] as Record<string, TraitRuleCase> | undefined;
    if (!table || typeof table !== 'object') return [];
    const rule = table[value] ?? table.None;
    if (!rule) return [];

    // Prefer explicit material rules so we know the ACCENT palette key.
    for (const matRule of rule.materials ?? []) {
      for (const obj of resolvePart(this.bodyRoot, matRule.target)) {
        if (!obj.visible) continue;
        const mat = materialAtSlot(obj, matRule.slot);
        if (!mat || seen.has(mat)) continue;
        seen.add(mat);
        out.push({
          label: `${matRule.name}`,
          material: mat,
          lit:
            mat instanceof THREE.MeshStandardMaterial ||
            mat instanceof THREE.MeshPhysicalMaterial,
          saveTarget: { kind: 'accent', key: matRule.name },
        });
      }
    }

    const targets = new Set<string>(rule.show ?? []);
    for (const mat of rule.materials ?? []) targets.add(mat.target);

    for (const id of targets) {
      const roots = outermostPartRoots(resolvePart(this.bodyRoot, id));
      for (const obj of roots) {
        if (!obj.visible) continue;
        ensureUniqueMeshMaterials(obj);
        forEachMaterialSlot(obj, (slot, mat) => {
          if (seen.has(mat)) return;
          seen.add(mat);
          const key = partAccentKey(id, slot);
          out.push({
            label: key,
            material: mat,
            lit:
              mat instanceof THREE.MeshStandardMaterial ||
              mat instanceof THREE.MeshPhysicalMaterial,
            saveTarget: { kind: 'accent', key },
          });
        });
      }
    }
    return out;
  }
}
