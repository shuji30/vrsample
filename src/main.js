import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { createWorld } from './world.js';
import { createPlayer } from './controllers.js';
import { createDesktopControls } from './desktop.js';
import { createDebugPanel } from './debug.js';

const statusEl = document.getElementById('status');
const params = new URLSearchParams(location.search);

/**
 * 起動の進捗と失敗を画面に出す。
 *
 * ヘッドセットで試すときは DevTools を開くのが面倒なので、どこまで進んだかと
 * 何で落ちたかは必ずページ上に出す。ここが無いと「開けなかった」としか
 * 分からなくなる。
 */
function report(message, isError = false) {
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.style.color = isError ? '#ff9c9c' : '';
  statusEl.style.whiteSpace = 'pre-wrap';
}

function fail(stage, error) {
  console.error(`[vrsample] ${stage}`, error);
  report(`${stage}で失敗しました。\n${error?.message ?? error}`, true);
}

window.addEventListener('error', (event) => fail('スクリプトエラー', event.error ?? event.message));
window.addEventListener('unhandledrejection', (event) => fail('非同期処理', event.reason));

// `?safe` は原因の切り分け用。影を切り、テクスチャを最小にし、
// XR の解像度も落として「重すぎて開けない」のかどうかを見る。
const safeMode = params.has('safe');

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
// r180 台で PCFSoftShadowMap は削除され、PCF に一本化された。
// 室内は影の縁がそのまま目に入るので、Basic ではなく PCF を使う。
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.shadowMap.enabled = !safeMode && params.get('shadow') !== 'off';
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0; // 実際の値はテーマが上書きする
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');

// 超広視野のヘッドセット（Pimax など）はレンダーターゲットが巨大になるので、
// 重いときは ?scale=0.8 のように解像度を落とせるようにしておく。
const framebufferScale = Number(params.get('scale')) || (safeMode ? 0.7 : 0);
if (Number.isFinite(framebufferScale) && framebufferScale > 0) {
  renderer.xr.setFramebufferScaleFactor(framebufferScale);
}
document.body.appendChild(renderer.domElement);

// WebGL のコンテキストが飛ぶと画面が固まるだけで何も分からないので拾っておく。
// Pimax のような巨大なレンダーターゲットではメモリ不足で起こりうる。
renderer.domElement.addEventListener('webglcontextlost', (event) => {
  event.preventDefault();
  report('WebGL のコンテキストが失われました。?safe を付けて開き直してください。', true);
});

// 「ENTER VR」ボタンは重い初期化より **先** に出す。
// 後ろに置くと、シーン構築でこけたときにボタンごと出なくなる。
document.body.appendChild(VRButton.createButton(renderer));

const scene = new THREE.Scene();
// 天球が半径 300 あるので far はそれより外に取る
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 500);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

window.__vrsample = { renderer, scene, camera, THREE, safeMode };

async function start() {
  // テクスチャを CPU で焼くあいだ画面が止まるので、先に一度描画させる
  report('部屋を焼いています…');
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  const started = performance.now();
  const world = createWorld(renderer, scene, {
    textureQuality: Number(params.get('quality')) || (safeMode ? 0.25 : 1),
    shadowMapSize: Number(params.get('shadow')) || 4096,
    environment: !safeMode,
  });
  const buildMs = Math.round(performance.now() - started);

  report('操作の準備中…');
  const player = createPlayer(renderer, camera, scene, world);
  const desktop = createDesktopControls(renderer, camera, world);

  // three.js は左右の目が平行に向いている前提で、カリング用にひとつの視錐台を
  // 合成する（WebXRManager の setProjectionFromUnion）。Pimax のようにディスプレイが
  // 内向きに傾いたヘッドセットではこの視錐台が実際より狭くなり、視界の外縁で
  // オブジェクトが早々に消える。
  //
  // シーンが数百オブジェクトあるのでカリング自体は効かせたまま、各ジオメトリの
  // バウンディングスフィアを膨らませて対処する。
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

  window.addEventListener('keydown', (event) => {
    if (event.key === 'd' || event.key === 'D') debugPanel.toggle();
    if (event.key === 'r' || event.key === 'R') world.resetProps();
  });

  renderer.xr.addEventListener('sessionstart', () => {
    document.body.classList.add('xr-presenting');
    player.reset(); // VR に入るときはリグを原点に戻す
    player.player.position.set(0, 0, 0.9);
  });

  renderer.xr.addEventListener('sessionend', () => {
    document.body.classList.remove('xr-presenting');
    player.reset(); // 持ったままのオブジェクトを手放し、PC 操作に戻す
  });

  const timer = new THREE.Timer();
  timer.connect(document); // タブが非表示の間は時間を進めない

  renderer.setAnimationLoop((timestamp) => {
    try {
      timer.update(timestamp);
      const dt = Math.min(timer.getDelta(), 0.05); // フレーム落ち時の飛びを抑える

      player.update(dt);
      desktop.update();
      world.update(dt);
      debugPanel.update(dt);

      renderer.render(scene, camera);
    } catch (error) {
      renderer.setAnimationLoop(null);
      fail('描画ループ', error);
    }
  });

  Object.assign(window.__vrsample, { world, player, desktop, debugPanel });

  // 起動状況の表示
  const suffix = `（生成 ${buildMs}ms${safeMode ? ' / safe' : ''}）`;
  if (navigator.xr?.isSessionSupported) {
    navigator.xr.isSessionSupported('immersive-vr').then((supported) => {
      report((supported
        ? 'VR 対応デバイスを検出しました。「ENTER VR」で開始できます。'
        : 'このブラウザでは VR に入れません（PC 操作でそのまま見られます）。') + suffix);
    }).catch(() => {
      report('WebXR の状態を確認できませんでした（PC 操作でそのまま見られます）。' + suffix);
    });
  } else {
    report('WebXR 非対応のブラウザです（PC 操作でそのまま見られます）。' + suffix);
  }
}

start().catch((error) => fail('シーンの構築', error));
