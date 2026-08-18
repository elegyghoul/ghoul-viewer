import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname);

const files = [
  path.join(root, 'public/models/based-ghoul.glb'),
  path.join(root, 'public/models/heads/flesh.glb'),
];

function hexColor(c) {
  if (!c) return null;
  return '#' + c.getHexString();
}

function classifyMaterial(mat) {
  if (mat.isMeshPhysicalMaterial) return 'MeshPhysicalMaterial';
  if (mat.isMeshStandardMaterial) return 'MeshStandardMaterial';
  if (mat.isMeshBasicMaterial) return 'MeshBasicMaterial';
  if (mat.isMeshPhongMaterial) return 'MeshPhongMaterial';
  if (mat.isMeshLambertMaterial) return 'MeshLambertMaterial';
  if (mat.isMeshToonMaterial) return 'MeshToonMaterial';
  return mat.type || mat.constructor?.name || 'Unknown';
}

function dumpMaterial(mat, label) {
  const typeName = mat.type || mat.constructor?.name;
  const kind = classifyMaterial(mat);
  const color = mat.color ? hexColor(mat.color) : '(no color)';
  const map = !!mat.map;
  const metalness = mat.metalness !== undefined ? mat.metalness : '(n/a)';
  const roughness = mat.roughness !== undefined ? mat.roughness : '(n/a)';
  const emissive = mat.emissive ? hexColor(mat.emissive) : '(n/a)';
  const opacity = mat.opacity;
  const transparent = mat.transparent;
  const sideMap = { 0: 'FrontSide', 1: 'BackSide', 2: 'DoubleSide' };
  const side = sideMap[mat.side] ?? mat.side;

  console.log(`  [${label}]`);
  console.log(`    type name: ${typeName}`);
  console.log(`    kind: ${kind} (Basic=${kind === 'MeshBasicMaterial'}, Standard=${kind === 'MeshStandardMaterial'}, Physical=${kind === 'MeshPhysicalMaterial'})`);
  console.log(`    color: ${color}`);
  console.log(`    map present?: ${map}`);
  console.log(`    metalness: ${metalness}, roughness: ${roughness}`);
  console.log(`    emissive: ${emissive}`);
  console.log(`    opacity: ${opacity}, transparent: ${transparent}`);
  console.log(`    side: ${side}`);
  if (mat.name) console.log(`    material.name: ${mat.name}`);
}

function loadGlb(filePath) {
  return new Promise((resolve, reject) => {
    const buf = fs.readFileSync(filePath);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const loader = new GLTFLoader();
    loader.parse(
      ab,
      '',
      (gltf) => resolve(gltf),
      (err) => reject(err)
    );
  });
}

async function dumpFile(filePath) {
  console.log('\n' + '='.repeat(72));
  console.log('FILE:', filePath);
  console.log('='.repeat(72));

  const gltf = await loadGlb(filePath);
  const scene = gltf.scene;

  let skinnedCount = 0;
  let meshCount = 0;
  const seenMats = new Set();

  scene.traverse((obj) => {
    if (obj.isSkinnedMesh) {
      skinnedCount++;
      const sk = obj.skeleton;
      console.log(`\nSkinnedMesh: "${obj.name}" bones=${sk?.bones?.length ?? 0}`);
      if (sk) {
        console.log(`  skeleton.boneInverses: ${sk.boneInverses?.length ?? 0}`);
        // Check if bones look identity / zeroed
        const b0 = sk.bones[0];
        if (b0) {
          console.log(`  bone[0]="${b0.name}" pos=(${b0.position.x.toFixed(4)}, ${b0.position.y.toFixed(4)}, ${b0.position.z.toFixed(4)})`);
        }
      }
    }
    if (!obj.isMesh) return;
    meshCount++;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    console.log(`\nMesh: "${obj.name}" (isSkinnedMesh=${!!obj.isSkinnedMesh}) materials=${mats.length}`);
    mats.forEach((mat, i) => {
      dumpMaterial(mat, `slot ${i}`);
      seenMats.add(mat.uuid);
    });
  });

  console.log(`\n--- Summary: meshes=${meshCount}, skinned=${skinnedCount}, unique materials=${seenMats.size} ---`);
}

async function main() {
  for (const f of files) {
    if (!fs.existsSync(f)) {
      console.error('MISSING:', f);
      continue;
    }
    await dumpFile(f);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
