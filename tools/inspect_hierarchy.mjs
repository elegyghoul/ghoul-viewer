import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

function loadGlb(filePath) {
  return new Promise((resolve, reject) => {
    const buf = fs.readFileSync(filePath);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const loader = new GLTFLoader();
    loader.parse(ab, '', (gltf) => resolve(gltf), (err) => reject(err));
  });
}

function fmtVec(v, digits = 4) {
  return `(${v.x.toFixed(digits)}, ${v.y.toFixed(digits)}, ${v.z.toFixed(digits)})`;
}

function bboxInfo(mesh, world = false) {
  const geo = mesh.geometry;
  if (!geo) return null;
  if (!geo.boundingBox) geo.computeBoundingBox();
  const box = geo.boundingBox.clone();
  if (world) {
    mesh.updateWorldMatrix(true, false);
    box.applyMatrix4(mesh.matrixWorld);
  }
  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  box.getCenter(center);
  box.getSize(size);
  return { center, size, min: box.min.clone(), max: box.max.clone() };
}

async function inspectBasedGhoul() {
  const filePath = path.join(root, 'public/models/based-ghoul.glb');
  console.log('\n' + '='.repeat(72));
  console.log('FILE:', filePath);
  console.log('='.repeat(72));

  const gltf = await loadGlb(filePath);
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);

  // 1. Full hierarchy for first 80 nodes
  console.log('\n--- 1. Hierarchy (first 80 nodes) ---');
  let count = 0;
  scene.traverse((obj) => {
    if (count >= 80) return;
    const parentName = obj.parent ? obj.parent.name || '(unnamed)' : '(root)';
    console.log(
      `[${count}] name="${obj.name || '(unnamed)'}" type=${obj.type} ` +
        `pos=${fmtVec(obj.position)} parent="${parentName}"`
    );
    count++;
  });
  console.log(`(printed ${count} nodes)`);

  // 2. Bones matching /head/i or /hips/i
  console.log('\n--- 2. Bones matching /head/i or /hips/i (world pos after updateMatrixWorld) ---');
  scene.updateMatrixWorld(true);
  const boneHits = [];
  scene.traverse((obj) => {
    if (!obj.isBone && obj.type !== 'Bone') return;
    if (!/head/i.test(obj.name) && !/hips/i.test(obj.name)) return;
    const wp = new THREE.Vector3();
    obj.getWorldPosition(wp);
    boneHits.push(obj);
    console.log(
      `Bone "${obj.name}" worldPos=${fmtVec(wp)} localPos=${fmtVec(obj.position)} ` +
        `parent="${obj.parent?.name || '(none)'}"`
    );
  });
  if (boneHits.length === 0) console.log('(no matching bones)');

  // 3. Each MESH: details + local/world bbox
  console.log('\n--- 3. All MESHES ---');
  const meshes = [];
  scene.traverse((obj) => {
    if (obj.isMesh) meshes.push(obj);
  });

  for (const mesh of meshes) {
    const local = bboxInfo(mesh, false);
    const world = bboxInfo(mesh, true);
    console.log(
      `\nMesh "${mesh.name || '(unnamed)'}" isSkinnedMesh=${!!mesh.isSkinnedMesh} ` +
        `type=${mesh.type} pos=${fmtVec(mesh.position)} parent="${mesh.parent?.name || '(none)'}"`
    );
    if (local) {
      console.log(`  local bbox center=${fmtVec(local.center)} size=${fmtVec(local.size)}`);
      console.log(`  local bbox min=${fmtVec(local.min)} max=${fmtVec(local.max)}`);
    }
    if (world) {
      console.log(`  world bbox center=${fmtVec(world.center)} size=${fmtVec(world.size)}`);
      console.log(`  world bbox min=${fmtVec(world.min)} max=${fmtVec(world.max)}`);
    }
    if (mesh.isSkinnedMesh && mesh.skeleton) {
      console.log(`  skeleton bones=${mesh.skeleton.bones.length}`);
      const bind = mesh.bindMatrix;
      console.log(
        `  bindMatrix translation≈ (${bind.elements[12].toFixed(4)}, ${bind.elements[13].toFixed(4)}, ${bind.elements[14].toFixed(4)})`
      );
    }
  }
  console.log(`\nTotal meshes: ${meshes.length}`);

  // 4. Head meshes: SkinnedMesh vs Mesh
  console.log('\n--- 4. Head meshes: SkinnedMesh vs Mesh ---');
  const headMeshes = meshes.filter((m) => /head/i.test(m.name));
  if (headMeshes.length === 0) {
    console.log('(no meshes with "head" in name — scanning related names)');
    const related = meshes.filter(
      (m) => /face|skull|neck|helmet|hair|horn|halo|eye|mouth/i.test(m.name)
    );
    for (const m of related) {
      console.log(
        `  related "${m.name}" isSkinnedMesh=${!!m.isSkinnedMesh} type=${m.type} ` +
          `parent="${m.parent?.name || '(none)'}"`
      );
    }
  } else {
    for (const m of headMeshes) {
      console.log(
        `  "${m.name}" isSkinnedMesh=${!!m.isSkinnedMesh} type=${m.type} ` +
          `parent="${m.parent?.name || '(none)'}" pos=${fmtVec(m.position)}`
      );
    }
  }

  // Extra: compare body vs head world centers for detachment diagnosis
  console.log('\n--- Diagnosis helpers ---');
  const bodyLike = meshes.filter((m) => /body|torso|ghoul|mesh/i.test(m.name) || m.isSkinnedMesh);
  for (const m of meshes) {
    const w = bboxInfo(m, true);
    if (!w) continue;
    console.log(
      `  "${m.name}" skinned=${!!m.isSkinnedMesh} worldCenter=${fmtVec(w.center)} ` +
        `parent="${m.parent?.name}"`
    );
  }

  // Print armature / root children
  console.log('\n--- Scene root children ---');
  scene.children.forEach((c, i) => {
    console.log(`  [${i}] "${c.name}" type=${c.type} pos=${fmtVec(c.position)} children=${c.children.length}`);
  });
}

async function inspectHalo() {
  const filePath = path.join(root, 'public/models/parts/halo.glb');
  console.log('\n' + '='.repeat(72));
  console.log('FILE:', filePath);
  console.log('='.repeat(72));

  const gltf = await loadGlb(filePath);
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);

  scene.traverse((obj) => {
    if (!obj.isMesh) return;
    const local = bboxInfo(obj, false);
    const world = bboxInfo(obj, true);
    console.log(
      `\nHalo mesh "${obj.name || '(unnamed)'}" isSkinnedMesh=${!!obj.isSkinnedMesh} ` +
        `pos=${fmtVec(obj.position)} parent="${obj.parent?.name || '(none)'}"`
    );
    if (local) {
      console.log(`  LOCAL bbox center=${fmtVec(local.center)} size=${fmtVec(local.size)}`);
      console.log(`  LOCAL bbox min=${fmtVec(local.min)} max=${fmtVec(local.max)}`);
    }
    if (world) {
      console.log(`  world bbox center=${fmtVec(world.center)} size=${fmtVec(world.size)}`);
    }
  });

  // Whole-scene local bbox (union of mesh local boxes in object space of roots)
  const box = new THREE.Box3().setFromObject(scene);
  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  box.getCenter(center);
  box.getSize(size);
  console.log(`\nScene (setFromObject) bbox center=${fmtVec(center)} size=${fmtVec(size)}`);
  console.log(`Scene bbox min=${fmtVec(box.min)} max=${fmtVec(box.max)}`);
}

async function main() {
  await inspectBasedGhoul();
  await inspectHalo();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
