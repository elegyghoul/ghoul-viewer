export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

export interface GhoulTraits {
  id: number;
  background: string;
  cranium: string;
  eyeDischarge: string;
  eyes: string;
  ghoul: string;
  lowerEyeAcc: string;
  lowerHeadAcc: string;
  midEyeAcc: string;
  midHeadAcc: string;
  mouthAcc: string;
  powerful: string;
  special: string;
  topEyeAcc: string;
  topHeadAcc: string;
  unique: string;
}

export interface AttachmentPart {
  id: string;
  model: string;
  parentBone: string;
  socket?: string;
  position: Vec3;
  rotation: Quat;
  scale: Vec3;
  unityName?: string;
  cyclopsPosition?: Vec3;
  defaultPosition?: Vec3;
}

export interface AttachmentMap {
  parentBone: string;
  parts: AttachmentPart[];
  notes?: string;
}

export interface TraitRuleCase {
  show?: string[];
  hide?: string[];
  materials?: { target: string; slot: number; name: string }[];
  cyclopsOffset?: boolean;
  forcedHead?: string;
  forcedSkin?: string;
  forcedEyes?: string;
  hideNormalHead?: boolean;
}

export interface TraitRules {
  style: string;
  cyclopsGlasses: {
    targets: string[];
    cyclopsOrCyclopsStare: Vec3;
    default: Vec3;
  };
  headMesh: Record<string, string>;
  lowerEyeAcc: Record<string, TraitRuleCase>;
  eyeDischarge: Record<string, TraitRuleCase>;
  lowerHeadAcc: Record<string, TraitRuleCase>;
  midHeadAcc: Record<string, TraitRuleCase>;
  mouthAcc: Record<string, TraitRuleCase>;
  midEyeAcc: Record<string, TraitRuleCase>;
  cranium: Record<string, TraitRuleCase>;
  special: Record<string, TraitRuleCase>;
  topHeadAcc: Record<string, TraitRuleCase>;
  topEyeAcc: Record<string, TraitRuleCase>;
  powerful: Record<string, TraitRuleCase>;
  eyes: Record<string, { groupChild: string; material?: string }>;
  unique: Record<string, TraitRuleCase>;
}
