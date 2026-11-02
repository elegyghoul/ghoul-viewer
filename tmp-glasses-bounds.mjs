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
const parent = (() => {
  let p = null;
  glb.scene.traverse(o => { if (o.name === 'Glasses_-_RiffRaff') p = o; });
  return p;
})();
parent.updateMatrixWorld(true);
for (const child of parent.children) {
  if (!child.isMesh) continue;
  const b = new THREE.Box3().setFromObject(child);
  const size = b.getSize(new THREE.Vector3());
  const center = b.getCenter(new THREE.Vector3());
  console.log(child.name, {
    size: size.toArray().map(v => +v.toFixed(4)),
    center: center.toArray().map(v => +v.toFixed(4)),
    zMin: +b.min.z.toFixed(4),
    zMax: +b.max.z.toFixed(4),
    indexCount: child.geometry.index?.count,
  });
}
