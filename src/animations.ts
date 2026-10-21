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
      if (key === 'Running') trimHeldLoopTail(clip);
      if (key && !this.clips.has(key)) this.clips.set(key, clip);
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

/**
 * Mixamo's Running bake repeats the loop pose for several frames after the
 * stride has already closed. Those extra keys hold the body still, so the
 * cycle pauses before it restarts. Keep the closure frame and drop the hold.
 */
const LOOP_HOLD_EPSILON = 1e-4;

function trimHeldLoopTail(clip: THREE.AnimationClip): void {
  const hips = clip.tracks.find((t) => /Hips\.position$/.test(t.name));
  if (!hips || hips.times.length < 4) return;

  const times = hips.times;
  const values = hips.values;
  const stride = hips.getValueSize();
  const dist = (i: number, j: number): number => {
    let sum = 0;
    for (let k = 0; k < stride; k++) {
      const d = values[i * stride + k]! - values[j * stride + k]!;
      sum += d * d;
    }
    return Math.sqrt(sum);
  };

  let tail = 0;
  for (let i = times.length - 1; i > 0; i--) {
    if (dist(i, i - 1) > LOOP_HOLD_EPSILON) break;
    tail++;
  }
  // One repeated end frame is the loop closure. Extra copies are the pause.
  if (tail < 2) return;
  const loopIndex = times.length - 1 - tail;
  if (loopIndex < 1) return;
  if (dist(0, loopIndex) > LOOP_HOLD_EPSILON) return;

  const cut = times[loopIndex]!;
  for (const track of clip.tracks) track.trim(0, cut);
  clip.resetDuration();
}

/** Idle/Walk keep hips at scale 1; crush any leftover bind-scale so parented head stays put. */
function normalizeMixamoHipsScale(root: THREE.Object3D): void {
  root.traverse((o) => {
    const n = o.name;
    if (n !== 'mixamorig:Hips' && n !== 'mixamorigHips' && n !== 'Hips') return;
    o.scale.set(1, 1, 1);
  });
}

/** Blender's copy suffix, as in Idle.002. Those clips must not replace Idle. */
function isDuplicateClip(name: string): boolean {
  return /\.\d{3}$/.test(name.trim());
}

function normalizeClipName(name: string): string | null {
  if (isDuplicateClip(name)) return null;
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
    if (isDuplicateClip(k)) continue;
    if (k.toLowerCase() === lower) return v;
    if (k.toLowerCase().includes(lower)) return v;
  }
  return undefined;
}
