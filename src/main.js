import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { createWorld } from './world.js';
import { createPlayer } from './controllers.js';
import { createDesktopControls } from './desktop.js';
import { createDebugPanel } from './debug.js';

const statusEl = document.getElementById('status');
const perfEl = document.getElementById('perf');
const creditEl = document.getElementById('credit');
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

/**
 * VR セッションの実測をひとことにまとめる。
 *
 * 目安として、90fps を保てるのはおおむね 900 万ピクセル／フレームまで。
 * それを超えていれば、まず解像度を落とすのが一番効く。
 */
function describeSession(stats) {
  if (!stats || stats.seconds <= 0) return 'VR を終了しました。';

  const fps = stats.frames / stats.seconds;
  const pixels = stats.width * stats.height;
  const megapixels = (pixels / 1e6).toFixed(1);
  const lines = [
    `VR 実測: ${fps.toFixed(0)}fps / フレームバッファ ${stats.width}x${stats.height}（${megapixels}Mpx）`,
  ];

  if (pixels > 9e6) {
    const suggested = Math.max(0.4, Math.min(1, Math.sqrt(9e6 / pixels))).toFixed(1);
    lines.push(`解像度が大きすぎます。?scale=${suggested} を試してください。`);
  } else if (fps < 60) {
    lines.push('?scale=0.8 または ?shadow=1024、それでも重ければ ?safe を試してください。');
  }

  return lines.join('\n');
}

window.addEventListener('error', (event) => fail('スクリプトエラー', event.error ?? event.message));
window.addEventListener('unhandledrejection', (event) => fail('非同期処理', event.reason));

// `?safe` は原因の切り分け用。影を切り、テクスチャを最小にし、
// XR の解像度も落として「重すぎて開けない」のかどうかを見る。
const safeMode = params.has('safe');

/** GPU の名前。Chrome が伏せている場合もあるので、取れなければそう言う。 */
function describeGpu(gl) {
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  } catch {
    return '不明';
  }
}

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
// 描画コストはピクセル数にほぼ比例する。4K ディスプレイを 200% 表示で使っていると
// devicePixelRatio が 2 になり、同じウィンドウでも塗る量が 4 倍になる。
// GPU が上の PC のほうが重い、という現象はたいていこれ。?dpr=1 で抑えられる。
const dprLimit = Number(params.get('dpr')) || 2;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, dprLimit));
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

const gpuName = describeGpu(renderer.getContext());

/**
 * 実際に塗っているピクセル数。CSS ピクセルではなくバックバッファの実寸で見る。
 * 2 台の PC で重さを比べるときは、まずこの数字が同じかどうかを確認する。
 */
function describeCanvas() {
  const canvas = renderer.domElement;
  const megapixels = (canvas.width * canvas.height / 1e6).toFixed(1);
  return `${canvas.width}x${canvas.height} (${megapixels}Mpx) dpr ${renderer.getPixelRatio().toFixed(2)}`;
}

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
    shadowMapSize: Number(params.get('shadow')) || 2048,
    environment: !safeMode,
    // キャラクターの視線に追わせる。?vrm= で別の VRM に差し替えられる
    camera,
    characterUrl: params.get('vrm') ?? undefined,
    wander: params.get('walk') !== 'off',
  });
  const buildMs = Math.round(performance.now() - started);

  // VRM のライセンスはたいてい作者表示（creditNotation）を求めるので、
  // 読み込めたら名前と作者を出しておく。
  world.character?.ready?.then((vrm) => {
    if (!vrm || !creditEl) return;
    const meta = vrm.meta;
    const name = meta.name ?? meta.title ?? 'VRM';
    const authors = meta.authors?.join(', ') ?? meta.author ?? '';
    creditEl.textContent = `キャラクター: ${name}${authors ? ` / ${authors}` : ''}`;
  }).catch(() => {});

  report('操作の準備中…');
  const player = createPlayer(renderer, camera, scene, world, {
    // 上下動は VR だと酔いにつながるので、弱めたり切ったりできるようにしておく
    bobScale: params.has('bob') ? Number(params.get('bob')) || 0 : 1,
    muted: params.has('mute'),
  });
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

  // VR 中の実測。ヘッドセットを被っている間は画面の文字が読めないので、
  // 抜けた瞬間に「何ピクセル要求されて、何 fps 出ていたか」を残す。
  // Pimax のような広視野機はレンダーターゲットが桁違いに大きくなるので、
  // 重いときはまずこの数字を見る。
  let stats = null;

  renderer.xr.addEventListener('sessionstart', () => {
    document.body.classList.add('xr-presenting');
    player.reset(); // VR に入るときはリグを原点に戻す
    player.player.position.set(0, 0, 0.9);

    const layer = renderer.xr.getSession()?.renderState?.baseLayer;
    stats = {
      width: layer?.framebufferWidth ?? 0,
      height: layer?.framebufferHeight ?? 0,
      frames: 0,
      seconds: 0,
      warmup: 1.0,   // 最初の 1 秒はシェーダーのコンパイルが混ざるので捨てる
    };
  });

  renderer.xr.addEventListener('sessionend', () => {
    document.body.classList.remove('xr-presenting');
    player.reset(); // 持ったままのオブジェクトを手放し、PC 操作に戻す
    report(describeSession(stats));
    stats = null;
  });

  const timer = new THREE.Timer();
  timer.connect(document); // タブが非表示の間は時間を進めない

  renderer.setAnimationLoop((timestamp) => {
    try {
      timer.update(timestamp);
      const elapsed = timer.getDelta();
      const dt = Math.min(elapsed, 0.05); // フレーム落ち時の飛びを抑える

      // 計測には **クランプ前の実時間** を使う。物理用の dt は 0.05 秒で
      // 頭打ちにしてあるので、それで fps を出すと 20fps より下が測れず、
      // 重さを調べるための表示としては嘘をつくことになる。
      if (stats) {
        if (stats.warmup > 0) stats.warmup -= elapsed;
        else { stats.frames++; stats.seconds += elapsed; }
      }

      player.update(dt);
      desktop.update();
      world.update(dt);
      debugPanel.update(elapsed);
      updatePerf(elapsed);

      renderer.render(scene, camera);
    } catch (error) {
      renderer.setAnimationLoop(null);
      fail('描画ループ', error);
    }
  });

  Object.assign(window.__vrsample, { world, player, desktop, debugPanel });

  // 実測表示（?perf / ?debug）
  const showPerf = params.has('perf') || params.has('debug');
  let perfTimer = 0;
  let perfFrames = 0;
  let perfSeconds = 0;
  if (perfEl && showPerf) perfEl.hidden = false;

  function updatePerf(dt) {
    if (!perfEl || !showPerf || renderer.xr.isPresenting) return;
    perfFrames++;
    perfSeconds += dt;
    perfTimer += dt;
    if (perfTimer < 0.5) return;

    const fps = perfFrames / perfSeconds;
    perfEl.textContent = `${fps.toFixed(0)} fps\n${describeCanvas()}\n${gpuName}`;
    perfTimer = 0;
    perfFrames = 0;
    perfSeconds = 0;
  }

  // 起動状況の表示
  const suffix = `（生成 ${buildMs}ms${safeMode ? ' / safe' : ''}）\n${describeCanvas()} / ${gpuName}`;
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
