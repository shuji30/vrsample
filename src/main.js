import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { createWorld } from './world.js';
import { createPlayer } from './controllers.js';
import { createDesktopControls } from './desktop.js';

const statusEl = document.getElementById('status');

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 400);

const world = createWorld(scene);
const player = createPlayer(renderer, camera, scene, world);
const desktop = createDesktopControls(renderer, camera, world);

// 「ENTER VR」ボタン（WebXR 非対応ならその旨を表示してくれる）
document.body.appendChild(VRButton.createButton(renderer));

renderer.xr.addEventListener('sessionstart', () => {
  document.body.classList.add('xr-presenting');
  player.reset(); // VR に入るときはリグを原点に戻す
  player.player.position.z = 0.6;
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
  const elapsed = timer.getElapsed();

  player.update(dt);
  desktop.update();
  world.update(dt, elapsed);

  renderer.render(scene, camera);
});

// 起動状況の表示
if (navigator.xr?.isSessionSupported) {
  navigator.xr.isSessionSupported('immersive-vr').then((supported) => {
    statusEl.textContent = supported
      ? 'VR 対応デバイスを検出しました。「ENTER VR」で開始できます。'
      : 'このブラウザでは VR に入れません（PC 操作でそのまま遊べます）。';
  }).catch(() => {
    statusEl.textContent = 'WebXR の状態を確認できませんでした（PC 操作でそのまま遊べます）。';
  });
} else {
  statusEl.textContent = 'WebXR 非対応のブラウザです（PC 操作でそのまま遊べます）。';
}

// デバッグ用にコンソールから触れるようにしておく
window.__vrsample = { renderer, scene, camera, world, player };
