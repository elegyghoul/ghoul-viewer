import * as THREE from 'three';

/**
 * ToxicHead hangs off the skull. Vertices fall with gravity, and one side of
 * the blob droops farther than the opposite side. That heavy side walks
 * around the head, so the front hangs lower for a while and the back takes
 * over later. Motion toward the inside of the skull is removed, so a vertex
 * never sits deeper than it was modeled.
 *
 * uToxicDown is one metre of world-down, expressed in mesh-local units.
 */
const timeUniform = { value: 0 };
const downUniform = { value: new THREE.Vector3(0, -0.05323, -0.01815) };
const forwardUniform = { value: new THREE.Vector3(0, -0.01815, 0.05323) };

const DRIP_KEY = 'toxic-drip-v4';

/** Head +Z (the face) in ToxicHead local space, before the world matrix. */
const FACE_LOCAL = new THREE.Vector3(0, -0.01815, 0.05323).normalize();

const _inv = new THREE.Matrix4();
const _down = new THREE.Vector3();
const _faceWorld = new THREE.Vector3();
const _forward = new THREE.Vector3();

let slimeMesh: THREE.Mesh | null = null;

function isToxicHead(name: string): boolean {
  return name.replace(/[\s_]+/g, '').toLowerCase() === 'toxichead';
}

function dripInstalled(mat: THREE.Material): boolean {
  return mat.userData.toxicDrip === DRIP_KEY;
}

/** Multiply by the matrix's 3×3 only, so a direction stays a direction. */
function apply3x3(m: THREE.Matrix4, v: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  const e = m.elements;
  const x = v.x;
  const y = v.y;
  const z = v.z;
  return out.set(
    e[0] * x + e[4] * y + e[8] * z,
    e[1] * x + e[5] * y + e[9] * z,
    e[2] * x + e[6] * y + e[10] * z,
  );
}

function install(mat: THREE.Material): void {
  if (!(mat instanceof THREE.MeshStandardMaterial)) return;
  // userData survives Material.clone(); the compile hook does not.
  // A second bind used to chain another hook, which declared the uniforms twice.
  if (dripInstalled(mat)) return;
  mat.userData.toxicDrip = DRIP_KEY;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uToxicTime = timeUniform;
    shader.uniforms.uToxicDown = downUniform;
    shader.uniforms.uToxicForward = forwardUniform;
    let source = shader.vertexShader;
    if (!source.includes('uToxicTime')) {
      source =
        'uniform float uToxicTime;\n' +
        'uniform vec3 uToxicDown;\n' +
        'uniform vec3 uToxicForward;\n' +
        source;
    }
    shader.vertexShader = source.replace(
        '#include <begin_vertex>',
        /* glsl */ `
        #include <begin_vertex>
        // toxic-drip-v4
        {
          vec3 downDir = normalize(uToxicDown);
          vec3 fwd = normalize(uToxicForward);
          vec3 side = cross(downDir, fwd);
          // 0 is the face. The peak walks around so front and back trade off.
          float ang = atan(dot(position, side), dot(position, fwd));
          float lobe = 0.5 + 0.5 * cos(ang - uToxicTime * 0.55);
          lobe *= lobe;
          // Tips, already lower on the blob, fall farther than the cap.
          float hang = smoothstep(-0.0015, 0.0095, dot(position, downDir));
          float flutter = 0.82 + 0.18 * sin(uToxicTime * 2.4 + ang * 3.0 + position.y * 80.0);
          float meters = mix(0.0075, 0.055, lobe) * mix(0.28, 1.0, hang) * flutter;
          vec3 offset = uToxicDown * meters;
          // Skull interior in this mesh's space. Rest pose is as deep as a vertex may sit.
          vec3 fromSkull = position - vec3(0.00018, -0.00358, 0.00116);
          float skullDist = length(fromSkull);
          vec3 outward = skullDist > 0.0004 ? fromSkull / skullDist : vec3(0.0, 1.0, 0.0);
          float into = dot(offset, outward);
          if (into < 0.0) offset -= outward * into;
          transformed += offset;
        }
        `,
      );
  };
  mat.customProgramCacheKey = () => DRIP_KEY;
  mat.needsUpdate = true;
}

/** Install the drip on whatever ToxicHead meshes are in the current ghoul. */
export function bindToxicSlime(root: THREE.Object3D): void {
  slimeMesh = null;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !isToxicHead(mesh.name)) return;
    slimeMesh = mesh;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) install(mat);
  });
}

export function updateToxicSlime(dt: number): void {
  if (dt > 0) timeUniform.value += dt;
  const mesh = slimeMesh;
  if (!mesh) return;
  mesh.updateWorldMatrix(true, false);
  _inv.copy(mesh.matrixWorld).invert();
  apply3x3(_inv, _down.set(0, -1, 0), downUniform.value);

  apply3x3(mesh.matrixWorld, FACE_LOCAL, _faceWorld);
  _faceWorld.y = 0;
  if (_faceWorld.lengthSq() < 1e-8) _faceWorld.set(0, 0, 1);
  _faceWorld.normalize();
  apply3x3(_inv, _faceWorld, _forward);
  // Circumference is around vertical, so forward stays level with the ground.
  _down.copy(downUniform.value).normalize();
  _forward.addScaledVector(_down, -_forward.dot(_down));
  if (_forward.lengthSq() < 1e-10) _forward.copy(FACE_LOCAL);
  forwardUniform.value.copy(_forward);
}
