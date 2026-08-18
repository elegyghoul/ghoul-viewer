/**
 * MagicaCloth2 collider + selection paint exported from
 * Assets/Prefabs Export/GhoulPrefab.prefab (TatteredCloak / InnerCloak).
 *
 * Collider transforms live on Magica_* empties inside ghoul-avatar.glb;
 * sizes/centers come from MagicaCapsuleCollider / MagicaSphereCollider.
 * Vertex Fixed/Move attributes are Magica selectionData (Manual paint),
 * transferred by nearest-neighbour in mesh-local space.
 */

export type MagicaColliderDef = {
  kind: 'capsule' | 'sphere';
  /** Unity GameObject name (pre-GLTF sanitization), or a Mixamo bone name. */
  name: string;
  center: readonly [number, number, number];
  /** Start radius (Magica size.x). Sphere uses this × lossyScale. */
  radius: number;
  /** Capsule length (Magica size.z). 0 for spheres. */
  length: number;
  /** 0=X 1=Y 2=Z, -1=sphere */
  direction: number;
  /** Size the capsule to this bone's first child (finger segments). */
  fitToChild?: boolean;
};

export type MagicaSelectionPoint = {
  p: readonly [number, number, number];
  /** 1 = Fixed, 2 = Move */
  a: number;
};

export type MagicaClothPaint = {
  maxConnectionDistance: number;
  points: MagicaSelectionPoint[];
};

const HAND_SIDES = ['Left', 'Right'] as const;
const FINGERS = ['Index', 'Middle', 'Ring', 'Pinky', 'Thumb'] as const;
const FINGER_RADIUS: Record<(typeof FINGERS)[number], readonly [number, number, number]> = {
  Index: [0.02, 0.017, 0.015],
  Middle: [0.021, 0.018, 0.016],
  Ring: [0.02, 0.017, 0.015],
  Pinky: [0.016, 0.014, 0.013],
  Thumb: [0.025, 0.021, 0.018],
};

/** Palm + per-finger capsules parented to Mixamo hand bones (not the Magica stick). */
function handShapeColliders(): MagicaColliderDef[] {
  const out: MagicaColliderDef[] = [];
  for (const side of HAND_SIDES) {
    const hand = `mixamorig:${side}Hand`;
    out.push(
      {
        kind: 'capsule',
        name: hand,
        center: [0, 0.04, 0],
        radius: 0.05,
        length: 0.08,
        direction: 1,
      },
      {
        kind: 'capsule',
        name: hand,
        center: [0, 0.05, 0],
        radius: 0.038,
        length: 0.075,
        direction: 0,
      },
    );
    for (const finger of FINGERS) {
      const radii = FINGER_RADIUS[finger];
      for (let seg = 1; seg <= 3; seg++) {
        out.push({
          kind: 'capsule',
          name: `mixamorig:${side}Hand${finger}${seg}`,
          center: [0, 0, 0],
          radius: radii[seg - 1]!,
          length: 0.04,
          direction: 1,
          fitToChild: true,
        });
      }
    }
  }
  return out;
}

/** Magica capsule/sphere sizes — matched to Magica_* nodes in the GLB by name. */
export const MAGICA_COLLIDERS: MagicaColliderDef[] = [
  {
    kind: 'capsule',
    name: 'Magica Capsule Collider (mixamorig:Hips)',
    center: [0, 0, 0],
    radius: 0.129,
    length: 0.438,
    direction: 1,
  },
  {
    kind: 'capsule',
    name: 'Magica Capsule Collider (mixamorig:Spine1)',
    center: [0, 0, 0],
    radius: 0.14,
    length: 0.628,
    direction: 1,
  },
  {
    kind: 'capsule',
    name: 'Magica Capsule Collider (mixamorig:LeftArm)',
    center: [0, 0.15, 0],
    radius: 0.085,
    length: 0.423,
    direction: 1,
  },
  {
    kind: 'capsule',
    name: 'Magica Capsule Collider (mixamorig:RightArm)',
    center: [0, 0.15, 0],
    radius: 0.09,
    length: 0.423,
    direction: 1,
  },
  {
    kind: 'capsule',
    name: 'Magica Capsule Collider (mixamorig:LeftForeArm)',
    center: [0, 0.13, 0],
    radius: 0.08,
    length: 0.3,
    direction: 1,
  },
  {
    kind: 'capsule',
    name: 'Magica Capsule Collider (mixamorig:RightForeArm)',
    center: [0, 0.13, 0],
    radius: 0.08,
    length: 0.3,
    direction: 1,
  },
  ...handShapeColliders(),
  {
    kind: 'capsule',
    name: 'Magica Capsule Collider (mixamorig:LeftUpLeg)',
    center: [0, 0.27, 0],
    radius: 0.055,
    length: 0.519,
    direction: 1,
  },
  {
    kind: 'capsule',
    name: 'Magica Capsule Collider (mixamorig:RightUpLeg)',
    center: [0, 0.27, 0],
    radius: 0.055,
    length: 0.519,
    direction: 1,
  },
  {
    kind: 'capsule',
    name: 'Magica Capsule Collider (mixamorig:LeftLeg)',
    center: [0, 0.19, 0],
    radius: 0.054,
    length: 0.526,
    direction: 1,
  },
  {
    kind: 'capsule',
    name: 'Magica Capsule Collider (mixamorig:RightLeg)',
    center: [0, 0.19, 0],
    radius: 0.054,
    length: 0.526,
    direction: 1,
  },
  {
    kind: 'capsule',
    name: 'Magica Capsule Collider (mixamorig:LeftFoot)',
    center: [0, 0.08, -0.06],
    radius: 0.075,
    length: 0.322,
    direction: 1,
  },
  {
    kind: 'capsule',
    name: 'Magica Capsule Collider (mixamorig:RightFoot)',
    center: [0, 0.08, -0.06],
    radius: 0.075,
    length: 0.322,
    direction: 1,
  },
  {
    kind: 'capsule',
    name: 'Magica Capsule Collider (MouthAcc)',
    center: [0, 0.03, 0.15],
    radius: 0.064,
    length: 0.358,
    direction: 0,
  },
  {
    kind: 'capsule',
    name: 'Magica Capsule Collider Eyes',
    center: [0, 0.03, 0.15],
    radius: 0.035,
    length: 0.242,
    direction: 0,
  },
  {
    kind: 'sphere',
    name: 'Magica Sphere Collider (Head - Teeth)',
    center: [0, 0, 0],
    radius: 0.1,
    length: 0,
    direction: -1,
  },
];

/** Unity → UnityGLTF object name (spaces→_, strip colon, keep underscores). */
export function magicaGltfName(unityName: string): string {
  return unityName.replace(/:/g, '').replace(/ /g, '_');
}
