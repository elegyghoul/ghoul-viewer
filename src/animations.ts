import * as THREE from 'three';

const PREFERRED = ['Idle', 'Walking', 'Running', 'Praying', 'Dancing'] as const;
export type AnimName = (typeof PREFERRED)[number];

export class GhoulAnimator {
  mixer: THREE.AnimationMixer | null = null;
  clips: Map<string, THREE.AnimationClip> = new Map();
  current: THREE.AnimationAction | null = null;

  bind(root: THREE.Object3D, animations: THREE.AnimationClip[]): void {
    this.mixer = new THREE.AnimationMixer(root);
    this.clips.clear();
    this.current = null;

    for (const clip of animations) {
      const key = normalizeClipName(clip.name);
      if (key) this.clips.set(key, clip);
      // Also keep raw name
      this.clips.set(clip.name, clip);
    }
  }

  play(name: AnimName | string, fade = 1): void {
    if (!this.mixer) return;
    const clip = this.clips.get(name) ?? findFuzzy(this.clips, name);
    if (!clip) {
      console.warn(`Animation not found: ${name}`, [...this.clips.keys()]);
      return;
    }
    const next = this.mixer.clipAction(clip);
    next.reset();
    next.setLoop(THREE.LoopRepeat, Infinity);
    next.clampWhenFinished = false;
    if (this.current && this.current !== next) {
      if (fade <= 0) {
        this.current.stop();
        next.setEffectiveWeight(1).play();
      } else {
        this.current.fadeOut(fade);
        next.reset().fadeIn(fade).play();
      }
    } else {
      next.enabled = true;
      next.setEffectiveWeight(1);
      next.play();
    }
    this.current = next;
  }

  /**
   * Hard-cut to a clip and apply its pose immediately (no crossfade).
   * Do NOT call skeleton.pose() — this Unity GLB's inverse-binds imply ~100× hips
   * scale; pose() restores that bind, and parented Head/Halo (not skinned) fly apart
   * while the skinned body still looks fine. Idle/Walk already key Hips.scale = 1.
   */
  snapTo(name: AnimName | string): void {
    if (!this.mixer) return;
    this.mixer.stopAllAction();
    this.current = null;
    this.play(name, 0);
    this.mixer.update(0);
    const root = this.mixer.getRoot();
    if (root instanceof THREE.Object3D) {
      normalizeMixamoHipsScale(root);
      root.updateWorldMatrix(true, true);
    }
  }

  update(dt: number): void {
    this.mixer?.update(dt);
  }

  listPreferred(): string[] {
    return PREFERRED.filter((n) => this.clips.has(n) || findFuzzy(this.clips, n));
  }
}

/** Idle/Walk keep hips at scale 1; crush any leftover bind-scale so parented head stays put. */
function normalizeMixamoHipsScale(root: THREE.Object3D): void {
  root.traverse((o) => {
    const n = o.name;
    if (n !== 'mixamorig:Hips' && n !== 'mixamorigHips' && n !== 'Hips') return;
    o.scale.set(1, 1, 1);
  });
}

function normalizeClipName(name: string): string | null {
  const lower = name.toLowerCase();
  for (const p of PREFERRED) {
    if (lower === p.toLowerCase()) return p;
    if (lower.includes(p.toLowerCase())) return p;
  }
  if (lower.includes('standing') && lower.includes('idle')) return 'Idle';
  if (lower.includes('rumba') || lower.includes('danc')) return 'Dancing';
  return null;
}

function findFuzzy(map: Map<string, THREE.AnimationClip>, name: string): THREE.AnimationClip | undefined {
  const lower = name.toLowerCase();
  for (const [k, v] of map) {
    if (k.toLowerCase() === lower) return v;
    if (k.toLowerCase().includes(lower)) return v;
  }
  return undefined;
}
