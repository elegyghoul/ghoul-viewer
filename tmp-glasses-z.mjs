import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import fs from 'fs';
import path from 'path';

globalThis.self = globalThis;
globalThis.URL = URL;
globalThis.createImageBitmap = async () => ({ width:1, height:1, close(){} });
globalThis.document = {
  createElementNS: () => {
    const img = { width:1, height:1, onload:null, onerror:null, set src(v){ queue(() => img.onload && img.onload()); } };
    return img;
  }
};

const root = String.raw`c:\Users\gabri\GhoulViewer\HTML Version`;
const buf = fs.readFileSync(path.join(root, 'public/models/ghoul-avatar.glb'));
const loader = new GLTFLoader();
const glb = await new Promise((resolve, reject) => {
  loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', resolve, reject);
});
glb.scene.updateMatrixWorld(true);

let parent = null;
glb.scene.traverse(o => { if (o.name === 'Glasses_-_RiffRaff') parent = o; });

for (const child of parent.children) {
  if (!child.isMesh) continue;
  child.updateWorldMatrix(true, false);
  const pos = child.geometry.getAttribute('position');
  const v = new THREE.Vector3();
  let front = 0, back = 0, sumZ = 0;
  const zs = [];
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    child.localToWorld(v);
    zs.push(v.z);
    sumZ += v.z;
    if (v.z > 0.05) front++;
    if (v.z < 0) back++;
  }
  zs.sort((a,b)=>a-b);
  console.log(child.name, {
    verts: pos.count,
    meanZ: +(sumZ/pos.count).toFixed(4),
    frontZgt05: front,
    backZlt0: back,
    p10: +zs[Math.floor(zs.length*0.1)].toFixed(4),
    p50: +zs[Math.floor(zs.length*0.5)].toFixed(4),
    p90: +zs[Math.floor(zs.length*0.9)].toFixed(4),
  });
}
