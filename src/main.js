import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { createWorld } from './world.js';
import { createPlayer } from './controllers.js';
import { createDesktopControls } from './desktop.js';
import { createDebugPanel } from './debug.js';

const statusEl = document.getElementById('status');
const params = new URLSearchParams(location.search);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
// r180 台で PCFSoftShadowMap は削除され、PCF に一本化された。
// 室内は影の縁がそのまま目に入るので、Basic ではなく PCF を使う。
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0; // 実際の値はテーマが上書きする
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');

// 超広視野のヘッドセット（Pimax など）はレンダーターゲットが巨大になるので、
// 重いときは ?scale=0.8 のように解像度を落とせるようにしておく。
const framebufferScale = Number(params.get('scale'));
if (Number.isFinite(framebufferScale) && framebufferScale > 0) {
  renderer.xr.setFramebufferScaleFactor(framebufferScale);
}
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
// 天球が半径 300 あるので far はそれより外に取る
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 500);

// テクスチャを CPU で焼くあいだ画面が止まるので、先に一度描画させる
statusEl.textContent = '部屋を焼いています…';
await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

const started = performance.now();
const world = createWorld(renderer, scene, {
  textureQuality: Number(params.get('quality')) || 1,
  shadowMapSize: Number(params.get('shadow')) || 4096,
});
const buildMs = Math.round(performance.now() - started);

const player = createPlayer(renderer, camera, scene, world);
const desktop = createDesktopControls(renderer, camera, world);

// three.js は左右の目が平行に向いている前提で、カリング用にひとつの視錐台を
// 合成する（WebXRManager の setProjectionFromUnion）。Pimax のようにディスプレイが
// 内向きに傾いたヘッドセットではこの視錐台が実際より狭くなり、視界の外縁で
// オブジェクトが早々に消える。
//
// 以前はカリング自体を切っていたが、公園まで作ったことでシーンが数百
// オブジェクトになったので、代わりに各ジオメトリのバウンディングスフィアを
// 膨らませて対処する。カリングは効いたまま、外縁で消える症状だけが消える。
const inflated = new Set();
scene.traverse((object) => {
  const geometry = object.geometry;
  if (!geometry || inflated.has(geometry)) return;
  inflated.add(geometry);
  if (!geometry.boundingSphere) geometry.computeBoundingSphere();
  if (geometry.boundingSphere) geometry.boundingSphere.radius *= 1.35;
});

// それでも外縁が欠けるヘッドセット向けの最終手段
if (params.get('cull') === 'off') {
  scene.traverse((object) => { object.frustumCulled = false; });
}

const debugPanel = createDebugPanel(renderer, player);
debugPanel.setVisible(params.has('debug'));

// VR 内でパネルを出せないときのために、PC 側のキーでも切り替えられるように
window.addEventListener('keydown', (event) => {
  if (event.key === 'd' || event.key === 'D') debugPanel.toggle();
  if (event.key === 'r' || event.key === 'R') world.resetProps();
});

// 「ENTER VR」ボタン（WebXR 非対応ならその旨を表示してくれる）
document.body.appendChild(VRButton.createButton(renderer));

renderer.xr.addEventListener('sessionstart', () => {
  document.body.classList.add('xr-presenting');
  player.reset(); // VR に入るときはリグを原点に戻す
  player.player.position.set(0, 0, 0.9);
});

renderer.xr.addEventListener('sessionend', () => {
  document.body.classList.remove('xr-presenting');
  player.reset(); // 持ったままのオブジェクトを手放し、PC 操作に戻す
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const timer = new THREE.Timer();
timer.connect(document); // タブが非表示の間は時間を進めない

renderer.setAnimationLoop((timestamp) => {
  timer.update(timestamp);
  const dt = Math.min(timer.getDelta(), 0.05); // フレーム落ち時の飛びを抑える

  player.update(dt);
  desktop.update();
  world.update(dt);
  debugPanel.update(dt);

  renderer.render(scene, camera);
});

// 起動状況の表示
function report(message) {
  statusEl.textContent = `${message}（生成 ${buildMs}ms）`;
}

if (navigator.xr?.isSessionSupported) {
  navigator.xr.isSessionSupported('immersive-vr').then((supported) => {
    report(supported
      ? 'VR 対応デバイスを検出しました。「ENTER VR」で開始できます。'
      : 'このブラウザでは VR に入れません（PC 操作でそのまま見られます）。');
  }).catch(() => {
    report('WebXR の状態を確認できませんでした（PC 操作でそのまま見られます）。');
  });
} else {
  report('WebXR 非対応のブラウザです（PC 操作でそのまま見られます）。');
}

// デバッグ用にコンソールから触れるようにしておく
window.__vrsample = { renderer, scene, camera, world, player, desktop, debugPanel, THREE };
