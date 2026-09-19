// node_modules の three.js から、配信に必要なファイルだけ vendor/ にコピーする。
// three のバージョンを上げたら `npm install three@<version> && npm run vendor` を実行する。
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const FILES = [
  ['node_modules/three/build/three.module.js', 'vendor/three/three.module.js'],
  ['node_modules/three/build/three.core.js', 'vendor/three/three.core.js'],
  ['node_modules/three/examples/jsm/webxr/VRButton.js', 'vendor/three/addons/webxr/VRButton.js'],
  ['node_modules/three/examples/jsm/controls/OrbitControls.js', 'vendor/three/addons/controls/OrbitControls.js'],
];

for (const [from, to] of FILES) {
  await mkdir(dirname(join(process.cwd(), to)), { recursive: true });
  await copyFile(from, to);
  console.log(`copied ${from} -> ${to}`);
}
