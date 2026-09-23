// node_modules の three.js から、配信に必要なファイルだけ vendor/ にコピーする。
// three のバージョンを上げたら `npm install three@<version> && npm run vendor` を実行する。
// @pixiv/three-vrm も同じ手順（`npm install @pixiv/three-vrm@<version> && npm run vendor`）。
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const FILES = [
  ['node_modules/three/build/three.module.js', 'vendor/three/three.module.js'],
  ['node_modules/three/build/three.core.js', 'vendor/three/three.core.js'],
  ['node_modules/three/examples/jsm/webxr/VRButton.js', 'vendor/three/addons/webxr/VRButton.js'],
  ['node_modules/three/examples/jsm/controls/OrbitControls.js', 'vendor/three/addons/controls/OrbitControls.js'],
  // 面光源（窓）に必要。RectAreaLight は使う前に UniformsLib の初期化が要る。
  ['node_modules/three/examples/jsm/lights/RectAreaLightUniformsLib.js', 'vendor/three/addons/lights/RectAreaLightUniformsLib.js'],
  ['node_modules/three/examples/jsm/lights/RectAreaLightTexturesLib.js', 'vendor/three/addons/lights/RectAreaLightTexturesLib.js'],
  // 面取りした箱。鋭いエッジは CG っぽさの最大の原因なので家具はこれで作る。
  ['node_modules/three/examples/jsm/geometries/RoundedBoxGeometry.js', 'vendor/three/addons/geometries/RoundedBoxGeometry.js'],
  // VRM（キャラクター）の読み込みに必要。GLTFLoader は utils の 2 つに依存している。
  ['node_modules/three/examples/jsm/loaders/GLTFLoader.js', 'vendor/three/addons/loaders/GLTFLoader.js'],
  ['node_modules/three/examples/jsm/utils/BufferGeometryUtils.js', 'vendor/three/addons/utils/BufferGeometryUtils.js'],
  ['node_modules/three/examples/jsm/utils/SkeletonUtils.js', 'vendor/three/addons/utils/SkeletonUtils.js'],
  // @pixiv/three-vrm（MToon・スプリングボーン・視線）。MIT なのでライセンスも一緒に置く。
  ['node_modules/@pixiv/three-vrm/lib/three-vrm.module.min.js', 'vendor/three-vrm/three-vrm.module.min.js'],
  ['node_modules/@pixiv/three-vrm/LICENSE', 'vendor/three-vrm/LICENSE'],
];

for (const [from, to] of FILES) {
  await mkdir(dirname(join(process.cwd(), to)), { recursive: true });
  await copyFile(from, to);
  console.log(`copied ${from} -> ${to}`);
}
