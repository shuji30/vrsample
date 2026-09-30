import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { createWorld } from './world.js';
import { createPlayer } from './controllers.js';
import { createDesktopControls } from './desktop.js';
import { createKartDrive } from './kartdrive.js';
import { createDebugPanel } from './debug.js';
import { createMusic } from './music.js';
import { givenGirlName, givenGirlNameYomi, setGirlName, girlNameSpoken } from './girlname.js';
import { createTouchControls, isTouchDevice } from './touch.js';

const statusEl = document.getElementById('status');

// 説明（オーバーレイ）は × で閉じ、「？ 説明」か I キーで開き直せる。閉じたことは覚えておく
const overlayEl = document.getElementById('overlay');
const OVERLAY_KEY = 'vrsample.overlayClosed';
function setOverlay(open) {
  overlayEl?.classList.toggle('closed', !open);
  try { localStorage.setItem(OVERLAY_KEY, open ? '0' : '1'); } catch { /* 覚えられなくても動く */ }
}
try { if (localStorage.getItem(OVERLAY_KEY) === '1') overlayEl?.classList.add('closed'); } catch { /* 開いたまま */ }
document.getElementById('overlay-close')?.addEventListener('click', () => setOverlay(false));
document.getElementById('overlay-open')?.addEventListener('click', () => setOverlay(true));
window.addEventListener('keydown', (event) => {
  if (event.code === 'KeyI' && event.target?.tagName !== 'INPUT') setOverlay(overlayEl?.classList.contains('closed'));
});
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

  // 例外の種類まで出す。DOMException は message だけだと
  //「An attempt was made to use an object that is not, or is no longer, usable」
  // のように、どこで何が起きたのかまったく分からない。
  const name = error?.name ? `${error.name}: ` : '';
  const lines = [`${stage}で失敗しました。`, `${name}${error?.message ?? error}`];

  // XR セッションの確保に失敗する典型は、要求された解像度が大きすぎて
  // フレームバッファを取れないケース。広視野のヘッドセットで起きやすい。
  if (error?.name === 'InvalidStateError' || error?.name === 'OperationError' || error?.name === 'NotSupportedError') {
    lines.push('?scale=0.6 か ?safe を付けて開き直すと通ることがあります。');
  }

  report(lines.join('\n'), true);
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

/** ENTER VR を押して、まだ返事が来ていない状態か */
let requestingSession = false;

window.addEventListener('unhandledrejection', (event) => {
  const message = String(event.reason?.message ?? event.reason ?? '');
  // VRButton は requestSession に catch を付けていないので、VR に入れなかった
  // ときはここに落ちてくる。「すでにセッションがある」は原因がはっきりして
  // いるので、例外の文面ではなく対処を出す。
  if (/already an active/i.test(message)) {
    requestingSession = false;
    report(
      'VR セッションがすでに開いています。別のタブやウィンドウでこのページ'
      + '（や他の WebXR サイト）を開いていないか確認し、そちらで VR を終了する'
      + 'と入れるようになります。VR 中にリロードしたあとは、ブラウザを開き直すと戻ります。',
      true,
    );
    return;
  }
  fail('非同期処理', event.reason);
});

// `?safe` は原因の切り分け用。影を切り、テクスチャを最小にし、
// XR の解像度も落として「重すぎて開けない」のかどうかを見る。
const safeMode = params.has('safe');
// スマホ・タブレット（指で触る端末）：タッチ操作を出し、画質の既定を下げる（URL で指定したら、そちらが優先）
const touchMode = isTouchDevice(params);
if (touchMode) document.body.classList.add('touch');

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
const dprLimit = Number(params.get('dpr')) || (touchMode ? 1.5 : 2);
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
/** GT3 のルームミラー（?mirror=off で描かない） */
const MIRROR_ON = params.get('mirror') !== 'off';
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

// VRButton は requestSession と setSession の失敗を握りつぶすので、
// 先に包んでおく。ここを通さないと、セッションの確保に失敗したときに
// 「非同期処理で失敗しました」という中身の無い表示にしかならない。
if (navigator.xr?.requestSession) {
  const requestSession = navigator.xr.requestSession.bind(navigator.xr);
  navigator.xr.requestSession = (...args) => requestSession(...args).catch((error) => {
    requestingSession = false;
    // 「すでにセッションがある」は上の unhandledrejection がもっと具体的な
    // 案内を出すので、ここでは黙って投げ直す（二重に書くと上書き合戦になる）
    if (!/already an active/i.test(String(error?.message ?? error))) {
      fail('VR セッションの要求', error);
    }
    throw error;
  });
}
{
  const setSession = renderer.xr.setSession.bind(renderer.xr);
  renderer.xr.setSession = (session) => Promise.resolve(setSession(session)).catch((error) => {
    // ここで投げ直しても VRButton は受けないので、報告して後始末だけする
    requestingSession = false;
    fail('VR セッションの初期化', error);
    try { session?.end?.(); } catch { /* すでに終わっている */ }
  });
}

// 「ENTER VR」ボタンは重い初期化より **先** に出す。
// 後ろに置くと、シーン構築でこけたときにボタンごと出なくなる。
const vrButton = VRButton.createButton(renderer);
document.body.appendChild(vrButton);

// 二度押しよけ。VRButton は requestSession が返るまで内部の currentSession が
// null のままなので、返事を待たずにもう一度押すとセッションを 2 本要求してしまい
// 「There is already an active, immersive XRSession」で落ちる。
// capture で聞いて、VRButton 自身のハンドラより先に握りつぶす。
vrButton.addEventListener('click', (event) => {
  if (renderer.xr.isPresenting) return;   // 終了のクリックはそのまま通す
  if (requestingSession) {
    event.stopImmediatePropagation();
    event.preventDefault();
    return;
  }
  requestingSession = true;
  // ランタイムが無反応のまま返ってこないこともあるので、保険で戻す
  setTimeout(() => { requestingSession = false; }, 10000);
}, true);

const scene = new THREE.Scene();
// 天球が半径 300 あるので far はそれより外に取る
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 4000);   // 丘から海の沖まで

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

window.__vrsample = { renderer, scene, camera, THREE, safeMode, touchMode };

async function start() {
  // テクスチャを CPU で焼くあいだ画面が止まるので、先に一度描画させる
  report('部屋を焼いています…');
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  const started = performance.now();
  const world = createWorld(renderer, scene, {
    textureQuality: Number(params.get('quality')) || (safeMode ? 0.25 : touchMode ? 0.5 : 1),
    shadowMapSize: Number(params.get('shadow')) || (touchMode ? 1024 : 2048),
    environment: !safeMode,
    // キャラクターの視線に追わせる。?vrm= で別の VRM に差し替えられる
    camera,
    characterUrl: params.get('vrm') ?? undefined,
    wander: params.get('walk') !== 'off',
    sit: params.get('sit') !== 'off',
    voice: params.get('voice') !== 'off',
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
    // 歩くときの頭の上下動・左右の振れ（VR の歩きだけにかかる）。既定は切っておく。VR では揺れているのが
    // 自分の目なので、近くの壁や机（家）ほど動いて見え、「移動すると家が動く」と報告された。
    // ?bob=1 で入れる、?bob=0.5 で弱めに入れる
    bobScale: params.has('bob') ? Number(params.get('bob')) || 0 : 0,
    muted: params.has('mute'),
  });
  const desktop = createDesktopControls(renderer, camera, world);
  // スマホのボタン：いまできることだけを、そのときの名前で（touch.js）。kartDrive はこのあとで作るので、呼ばれたときに読む
  const touch = touchMode ? createTouchControls({ isXR: () => renderer.xr.isPresenting, actions: () => touchActions() }) : null;
  // カートの運転（乗り降り・操作・ハンコン・FFB）
  const kartDrive = createKartDrive({ renderer, camera, player, desktop, world, kart: world.karts.player, bike: world.bike, others: [world.seesaw, world.buranko, world.fishing, world.horse, world.carousel, world.ferris, world.coaster, world.cruiser, world.jetski, world.cessna, world.gt3, world.f40, world.diver, ...(world.seats?.list ?? [])].filter(Boolean), analogSteer: () => touch?.steer ?? null });
// パットゴルフ：VR は右手のパター、PC は視点を球の後ろへ
// セスナ：機内から見ているあいだ（VR・PC の運転席視点）は、機体を水平のまま見せる（酔いにくいように）
if (world.cessna) world.cessna.firstPerson = () => kartDrive.driving && kartDrive.vehicle === world.cessna && (renderer.xr.isPresenting || kartDrive.view === 'first');
world.golfGame?.bind({ controllers: player.controllers, desktop, isXR: () => renderer.xr.isPresenting });
// ビリヤード：VR は右手のキュー（左手がブリッジ）、PC は視点を手球の後ろへ
world.billiardGame?.bind({ controllers: player.controllers, desktop, isXR: () => renderer.xr.isPresenting });
// 会話の「そろそろいこうか」は、E と同じく立つ
if (world.talk) world.talk.onLeave = () => kartDrive.exit();
const talkEye = new THREE.Vector3();

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

  // BGM。?bgm=off で最初から切る、?bgm=0.3 のように数字なら音量。M キーでオン / オフ
  const bgmParam = params.get('bgm');
  const music = createMusic({
    enabled: bgmParam !== 'off',
    volume: bgmParam && !Number.isNaN(Number(bgmParam)) ? Math.min(1, Number(bgmParam)) : 0.35,
  });

  window.addEventListener('keydown', (event) => {
    // カートの運転中は D が右へのハンドルなので、デバッグ表示は切り替えない
    if ((event.key === 'd' || event.key === 'D') && !kartDrive.driving) debugPanel.toggle();
    if (event.key === 'r' || event.key === 'R') world.resetProps();
    if (event.key === 'm' || event.key === 'M') music.toggle();
    // C：乗り物に乗っていないときは、視点の位置を戻す（乗っているあいだは kartdrive.js が視点の切り替えに使う）
    if (event.code === 'KeyC' && !event.repeat && !kartDrive.driving) resetView();
    // 時間帯を順に（昼 → 夕方 → 夜）。夜は公園の奥で花火が上がる
    if (event.key === 't' || event.key === 'T') {
      const key = world.cycleTheme();
      if (key) console.info(`時間帯: ${key}`);
    }
    // 女の子の声を替える（入っている日本語の声を順に。選んだ声は覚えておく）
    if (event.key === 'v' || event.key === 'V') {
      const name = world.voice?.cycleVoice();
      if (name) console.info(`声: ${name}`);
    }
  });

  // VR 中の実測。ヘッドセットを被っている間は画面の文字が読めないので、
  // 抜けた瞬間に「何ピクセル要求されて、何 fps 出ていたか」を残す。
  // Pimax のような広視野機はレンダーターゲットが桁違いに大きくなるので、
  // 重いときはまずこの数字を見る。
  let stats = null;

  renderer.xr.addEventListener('sessionstart', () => {
    sessionStarts += 1;
    requestingSession = false;
    music.unlock();   // ENTER VR を押した操作の続きなので、ここで鳴らし始められる
    document.body.classList.add('xr-presenting');
    // PC で見ていた場所と向きから VR を始める（以前はリグを部屋の原点へ戻していて、
    // ENTER VR を押した場所と VR の中の場所が合わなかった）。頭の姿勢は数フレーム後に取れる
    // ので、そのときに合わせる。カートに乗っているときは、カートの側で運転席に合わせる
    camera.updateMatrixWorld(true);
    const from = camera.getWorldPosition(new THREE.Vector3());
    const look = camera.getWorldDirection(new THREE.Vector3());
    player.reset();
    player.player.position.set(0, 0, 0.9);
    player.alignHeadTo(from.x, from.z, Math.atan2(-look.x, -look.z));

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

  // --- VR の診断表示（VR の最中だけ、PC のモニターの左下に出す。?vrdiag=off で出さない）---------
  // 実機（Pimax など）でしか起きない不具合（移動しても位置が変わらない・目線合わせが効かない等）を
  // 調べるため、XR の状態・リグと頭の位置・VR のコントローラーとゲームパッドの値を見せる
  let sessionStarts = 0;
  const diagEl = document.createElement('pre');
  diagEl.id = 'vrdiag';
  diagEl.style.cssText = 'position:fixed;left:8px;bottom:8px;margin:0;padding:8px 10px;background:rgba(0,0,0,.75);color:#9f9;font:12px/1.35 monospace;border-radius:6px;z-index:20;display:none;max-width:60vw;white-space:pre-wrap';
  document.body.appendChild(diagEl);
  const showDiag = params.get('vrdiag') !== 'off';
  let diagIn = 0;
  const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : String(v));
  const vec = (v) => `${f2(v.x)}, ${f2(v.y)}, ${f2(v.z)}`;
  function updateDiag(dt) {
    const session = renderer.xr.getSession?.();
    diagEl.style.display = showDiag && (session || renderer.xr.isPresenting) ? '' : 'none';
    if (diagEl.style.display === 'none') return;
    diagIn -= dt;
    if (diagIn > 0) return;
    diagIn = 0.2;
    const head = camera.getWorldPosition(new THREE.Vector3());
    const lines = [
      `VR 診断（?vrdiag=off で消す）`,
      `isPresenting=${renderer.xr.isPresenting} session=${Boolean(session)} sessionstart=${sessionStarts} align=${JSON.stringify(player.alignInfo)}`,
      `rig=${vec(player.player.position)} rigYaw=${f2(player.player.rotation.y)} head=${vec(head)} headLocal=${vec(camera.position)}`,
      `driving=${kartDrive.driving} vehicle=${kartDrive.driving ? kartDrive.vehicle?.kind ?? '?' : '-'}`,
    ];
    for (const [i, src] of [...(session?.inputSources ?? [])].entries()) {
      const g = src.gamepad;
      lines.push(`xr[${i}] ${src.handedness} ${src.targetRayMode} axes=[${g ? [...g.axes].map(f2).join(',') : '-'}] btn=${g ? [...g.buttons].map((b) => (b.pressed ? 1 : 0)).join('') : '-'}`);
    }
    for (const g of [...(navigator.getGamepads?.() ?? [])].filter(Boolean)) {
      lines.push(`pad[${g.index}] ${g.id.slice(0, 40)} map=${g.mapping || '-'} n=${g.buttons.length} axes=[${[...g.axes].map(f2).join(',')}]`);
    }
    const xp = desktop.xrPad;
    lines.push(`vrpad=${desktop.vrPadMode}（auto は VR のコントローラーが無いときだけ） xrControllers=${[...(session?.inputSources ?? [])].filter((x) => x.gamepad).length}`);
    lines.push(`xrPad connected=${Boolean(xp?.connected)} move=${xp ? `${f2(xp.move.x)},${f2(xp.move.y)}` : '-'} look=${xp ? `${f2(xp.look.x)},${f2(xp.look.y)}` : '-'}`);
    diagEl.textContent = lines.join('\n');
  }

  const timer = new THREE.Timer();
  timer.connect(document); // タブが非表示の間は時間を進めない
  let loopErrors = 0;
  let loopErrorsInARow = 0;
  let loopErrorEl = null;
  let loopErrorHide = 0;
  /** 描画ループの例外を、画面の上に 8 秒だけ小さく出す */
  function showLoopError(error) {
    if (!loopErrorEl) {
      loopErrorEl = document.createElement('div');
      loopErrorEl.id = 'loop-error';
      loopErrorEl.style.cssText = 'position:fixed;left:50%;top:12px;transform:translateX(-50%);max-width:min(560px,calc(100vw - 32px));padding:6px 12px;border-radius:8px;background:rgba(120,20,20,.85);color:#fff;font:12px/1.4 sans-serif;z-index:30;pointer-events:none;white-space:pre-wrap';
      document.body.appendChild(loopErrorEl);
    }
    const where = String(error?.stack ?? '').split('\n').find((l) => /src\//.test(l))?.trim().replace(/^at /, '') ?? '';
    loopErrorEl.textContent = `エラーが起きました（続けます）：${error?.name ? `${error.name}: ` : ''}${error?.message ?? error}${where ? `\n${where}` : ''}`;
    loopErrorEl.style.display = '';
    clearTimeout(loopErrorHide);
    loopErrorHide = setTimeout(() => { loopErrorEl.style.display = 'none'; }, 8000);
  }
  // 検証用
  window.__vrsample.loopErrors = () => loopErrors;

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
      desktop.update(dt);
      touch?.update(dt);
      updateActionHint(dt);
      kartDrive.update(dt);
      world.update(dt);
      // 女の子がしゃべっているあいだは BGM を下げる
      music.update(dt, { ducked: Boolean(world.voice?.speaking || world.carousel?.musicPlaying) });
      debugPanel.update(elapsed);
      updatePerf(elapsed);
      updateDiag(elapsed);

      // 会話の札（VR は目の前に。PC は画面の下の札）
      if (world.talk?.active && kartDrive.driving && kartDrive.vehicle?.kind === 'seat') {
        world.talk.placeVr(kartDrive.vehicle.eye(talkEye), kartDrive.vehicle.state.yaw, renderer.xr.isPresenting);
      }
      // GT3 のルームミラー（運転席から見ているときだけ。VR はいつも運転席）
      // （F40 も同じ作りのミラー）
      for (const car of [world.gt3, world.f40]) {
        if (!car?.renderMirror || !MIRROR_ON) continue;
        if (kartDrive.driving && kartDrive.vehicle === car && (renderer.xr.isPresenting || kartDrive.view === 'first')) car.renderMirror(renderer, scene);
        else car.hideMirror();
      }
      renderer.render(scene, camera);
      loopErrorsInARow = 0;
    } catch (error) {
      // 1 フレームで例外が起きても、ループは止めない。以前は setAnimationLoop(null) で止めていたので、
      // 一度の例外（スマホの音声合成など）で画面がそのまま固まり、ゲームが先へ進まなくなった。
      // 内容は画面の上に小さく出す（説明画面を閉じていても見えるように）。同じ例外が続くときは 10 秒に 1 回だけ
      loopErrors++;
      loopErrorsInARow++;
      if (loopErrors === 1 || loopErrorsInARow % 600 === 1) {
        console.error('[vrsample] 描画ループ', error);
        showLoopError(error);
      }
      try { renderer.render(scene, camera); } catch { /* 描けなくても、次のフレームでもう一度 */ }
    }
  });

  // こむぎを VR の手でなでられるように
  world.corgi?.setHands(() => player.controllers);
  // 砂浜：VR の手でビーチボールをはたく、PC の F で打つ・貝がらを拾う、看板で行き来する
  world.beach?.setHands(() => player.controllers);
  // VR の最中もゲームパッドで歩く・向きを変える
  player.setPadSource(() => desktop.xrPad);
  // 乗り物に乗っていないときも、ハンコンで歩く（ハンドルで向き、アクセルで前、ブレーキで後ろ）
  player.setWheelSource(() => kartDrive.walkInput());
  desktop.setWheelSource(() => kartDrive.walkInput());
  desktop.onUse = () => Boolean(world.beachUse?.(camera));
  world.onPlayerTravel = (x, y, z, look) => {
    if (renderer.xr.isPresenting) {
      player.player.position.y = y;
      player.alignHeadTo(x, z, Math.atan2(-look.x, -look.z), 1);
    } else {
      camera.position.set(x, y + 1.62, z);
      desktop.controls.target.set(x + look.x * 3, y + 1.3, z + look.z * 3);
      desktop.controls.update();
    }
  };
  /**
   * 視点を戻す（C）：いまいる所にいちばん近い歩ける所の、地面の上の目の高さへ。向きはそのまま。
   * 地面の下にもぐってしまったとき・歩ける範囲の外へ出てしまったときのため。VR はリグを地面へ置いて、頭をそこへ合わせる
   */
  function resetView() {
    const clamp = (x, z) => world.clampToBounds?.(x, z, 0.25) ?? { x, z };
    const ground = (x, z) => world.groundHeight?.(x, z) ?? 0;
    if (renderer.xr.isPresenting) {
      const head = player.headWorldPosition(new THREE.Vector3());
      const q = new THREE.Quaternion();
      player.headWorldQuaternion(q);
      const f = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
      const p = clamp(head.x, head.z);
      player.player.position.y = ground(p.x, p.z);
      player.alignHeadTo(p.x, p.z, Math.atan2(-f.x, -f.z), 1);
      return;
    }
    const c = camera.position;
    const t = desktop.controls.target;
    let fx = t.x - c.x;
    let fz = t.z - c.z;
    const len = Math.hypot(fx, fz) || 1;
    fx /= len;
    fz /= len;
    const p = clamp(c.x, c.z);
    const g = ground(p.x, p.z);
    camera.position.set(p.x, g + 1.62, p.z);
    desktop.controls.target.set(p.x + fx * 3, g + 1.2, p.z + fz * 3);
    desktop.controls.update();
  }
  /**
   * 操作はスマホも PC も同じ形にそろえる：十字ボタン（PC は W A S D）と、右のボタン（PC はスペース）1 つ。
   *   - 歩いているとき：スペース（右の大きいボタン）が「いまできること」になる（打つ・投げる・拾う・乗る・座る…）。
   *     contextAction() がそれを決め、スペースを押すと、その動きのキー（F / E など）に置き換えて送る
   *   - 乗り物：▲ ▼（W / S）でアクセル・ブレーキ、◀ ▶（A / D）でハンドル。スペースはサイドブレーキ（潜っているときは上へ）
   * スマホのボタンは touchActions() が決める（{ buttons: 右下, chips: 上の小さいボタン, dpad: 十字ボタン（運転中） }）
   */
  const btn = (code, key, label, size = 'big', hint) => ({ code, key, label, size, ...(hint ? { hint } : {}) });
  const SIT = new Set(['seat', 'ferris', 'carousel', 'coaster']);
  const LEFT = btn('KeyA', 'a', '◀');
  const RIGHT = btn('KeyD', 'd', '▶');
  /** 歩いているときに、スペースでできること（{ code, key, label, hint }。無ければ null） */
  function contextAction() {
    if (kartDrive.driving) return null;
    const g = world.golfGame;
    if (g?.state === 'play' && g.turn === 'player' && g.phase === 'aim') return btn('Space', ' ', '打つ', 'big', '長押しで強く');
    const b = world.billiardGame;
    if (b?.state === 'play' && b.turn === 'player' && b.phase === 'aim' && !desktop.swing?.holding) return btn('Space', ' ', '突く', 'big', '長押しで強く');
    const held = desktop.heldKind;
    if (held === 'boomerang') return btn('KeyF', 'f', '投げる', 'big', '長押しで遠く');
    if (desktop.swing?.holding) return btn('Space', ' ', held === 'tennis' ? 'サーブ' : '振る');
    if (held) return btn('KeyF', 'f', '投げる');
    const beach = world.beachCanUse?.(camera);
    if (beach) return btn('KeyF', 'f', beach === 'ball' ? '打つ' : '拾う');
    if (desktop.canPick()) return btn('KeyF', 'f', '拾う');
    const near = kartDrive.nearby();
    if (near) {
      const k = near.kind;
      return btn('KeyE', 'e', k === 'seat' ? '座る' : k === 'diver' ? 'もぐる' : k === 'fishing' ? '釣る' : '乗る');
    }
    return null;
  }
  function touchActions() {
    if (kartDrive.driving) {
      const v = kartDrive.vehicle;
      const kind = v?.kind ?? 'kart';
      const view = btn('KeyC', 'c', '視点');
      const gyro = { code: 'gyro', label: touch.gyro ? 'ジャイロ ON' : 'ジャイロ', on: touch.gyro };
      if (kind === 'diver') {
        return { buttons: [btn('Space', ' ', '上へ'), btn('KeyG', 'g', '下へ', 'small')], chips: [btn('KeyE', 'e', '浜へ'), view],
          dpad: { up: btn('KeyW', 'w', '進む'), down: btn('KeyS', 's', '下がる'), left: LEFT, right: RIGHT } };
      }
      if (kind === 'seat') return { buttons: [btn('KeyE', 'e', '立つ')] };
      if (SIT.has(kind)) return { buttons: [btn('KeyE', 'e', '降りる')], chips: [view] };
      const out = btn('KeyE', 'e', '降りる');
      if (kind === 'seesaw') return { chips: [out], dpad: { up: btn('KeyW', 'w', 'ける') } };
      if (kind === 'buranko') return { chips: [out], dpad: { up: btn('KeyW', 'w', 'こぐ'), down: btn('KeyS', 's', '止める') } };
      if (kind === 'fishing') return { chips: [out], dpad: { up: btn('KeyW', 'w', '投げる・巻く') } };
      const dpad = { up: btn('KeyW', 'w', 'アクセル'), down: btn('KeyS', 's', 'ブレーキ'), left: LEFT, right: RIGHT };
      if (kind === 'horse') return { chips: [out, view, gyro], dpad: { ...dpad, up: btn('KeyW', 'w', '進む'), down: btn('KeyS', 's', '止まる') } };
      const chips = [out, view, gyro];
      const buttons = [];
      if (kind === 'kart' || kind === 'gt3' || kind === 'bike') buttons.push(btn('Space', ' ', 'サイド', 'big', 'ブレーキ'));
      // GT3・F40：シフトは右の小さいボタン（PC は X / Z）、上に AT / MT
      if (kind === 'gt3') { buttons.push(btn('KeyX', 'x', 'シフト▲', 'small'), btn('KeyZ', 'z', 'シフト▼', 'small')); chips.push(btn('KeyQ', 'q', 'AT/MT')); }
      return { buttons, chips, dpad };
    }
    // 歩いているとき：右の大きいボタンはスペース（いまできることの名前で）。2 つ目が要るときだけ小さく
    const a = contextAction();
    if (!a) return {};
    const buttons = [{ ...btn('Space', ' ', a.label), ...(a.hint ? { hint: a.hint } : {}) }];
    if (desktop.heldKind === 'boomerang') buttons.push(btn('KeyG', 'g', '右へ投げる', 'small'));
    if (desktop.swing?.holding) {
      if (desktop.canPick()) buttons.push(btn('KeyF', 'f', '拾う', 'small'));
      buttons.push(btn('KeyG', 'g', 'ラケットを置く', 'small'));
    }
    return { buttons };
  }
  // スペース：歩いているときは「いまできること」のキーに置き換えて送る（PC・スマホ共通。押しているあいだ押し続ける）
  let spaceAs = null;
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || e.repeat || e.fromPad || e.spaceMapped || renderer.xr.isPresenting || e.target?.tagName === 'INPUT') return;
    const a = contextAction();
    if (!a || a.code === 'Space') return;
    e.preventDefault();
    e.stopImmediatePropagation();
    spaceAs = a;
    const ev = new KeyboardEvent('keydown', { code: a.code, key: a.key, bubbles: true });
    window.dispatchEvent(ev);
  }, true);
  window.addEventListener('keyup', (e) => {
    if (e.code !== 'Space' || !spaceAs) return;
    e.stopImmediatePropagation();
    const a = spaceAs;
    spaceAs = null;
    window.dispatchEvent(new KeyboardEvent('keyup', { code: a.code, key: a.key, bubbles: true }));
  }, true);
  // PC：いまスペースでできることを、画面の下に小さく出す（スマホは右下のボタンの名前で分かる）
  const actionHint = document.createElement('div');
  actionHint.id = 'action-hint';
  document.body.appendChild(actionHint);
  let hintIn = 0;
  let hintText = '';
  function updateActionHint(dt) {
    if ((hintIn -= dt) > 0) return;
    hintIn = 0.2;
    let text = '';
    if (!touchMode && !renderer.xr.isPresenting) {
      if (kartDrive.driving) {
        const k = kartDrive.vehicle?.kind;
        text = k === 'diver' ? 'W 進む・A D 向き・スペース 上へ・Shift 下へ・E 浜へ'
          : SIT.has(k) ? 'E 降りる' : k === 'gt3' ? 'W / ↑ アクセル・S / ↓ ブレーキ・A D / ← → ハンドル・＞ ＜ シフト・スペース サイド・E 降りる'
          : 'W / ↑ アクセル・S / ↓ ブレーキ・A D / ← → ハンドル・スペース サイド・E 降りる';
      } else {
        const a = contextAction();
        if (a) text = `スペース　${a.label}${a.hint ? `（${a.hint}）` : ''}`;
      }
    }
    if (text !== hintText) { hintText = text; actionHint.textContent = text; actionHint.style.display = text ? 'block' : 'none'; }
  }
  // VR に入れない端末（スマホのブラウザなど）では、「VR NOT SUPPORTED」のボタンを出さない
  if (touchMode) navigator.xr?.isSessionSupported?.('immersive-vr').then((ok) => { if (!ok) vrButton.style.display = 'none'; }).catch(() => { vrButton.style.display = 'none'; });
  if (touchMode && !navigator.xr) vrButton.style.display = 'none';
  Object.assign(window.__vrsample, { contextAction, updateActionHint, world, player, desktop, touch, debugPanel, music, kartDrive, resetView });

  // 女の子の声の状態を開始画面に出す。日本語の声が無い端末では、入れ方を案内する
  const voiceStatusEl = document.getElementById('voice-status');
  // 女の子の名前（説明画面）。付けると女の子が喜ぶ。入力中のキーは、歩く・拾う・乗るなどへ渡さない
  {
    const form = document.getElementById('girl-name');
    const nameEl = document.getElementById('girl-name-input');
    const yomiEl = document.getElementById('girl-name-yomi');
    const noteEl = document.getElementById('girl-name-note');
    const showNote = () => {
      const n = givenGirlName();
      if (noteEl && n) noteEl.textContent = `いまの名前：${n}${givenGirlNameYomi() ? `（${givenGirlNameYomi()}）` : ''}。空にして「決める」で「女の子」に戻せます`;
    };
    if (nameEl) nameEl.value = givenGirlName();
    if (yomiEl) yomiEl.value = givenGirlNameYomi();
    showNote();
    for (const el of [nameEl, yomiEl]) {
      for (const type of ['keydown', 'keyup']) el?.addEventListener(type, (e) => { if (e.key !== 'Enter') e.stopPropagation(); });
    }
    form?.addEventListener('submit', (e) => {
      e.preventDefault();
      const before = givenGirlName();
      const n = setGirlName(nameEl?.value ?? '', yomiEl?.value ?? '');
      if (nameEl) nameEl.value = n;
      if (yomiEl) yomiEl.value = givenGirlNameYomi();
      if (!n && noteEl) noteEl.textContent = '名前を消しました（「女の子」と呼びます）';
      showNote();
      if (n && n !== before) world.voice?.say('girlNamed', { n, spoken: girlNameSpoken() });
      document.activeElement?.blur?.();
    });
  }

  world.voice?.onStatus((st) => {
    if (!voiceStatusEl) return;
    const short = (name) => name.replace(/^(Microsoft|Google|Apple)\s+/i, '').replace(/\s*-\s*Japanese.*$/i, '');
    if (!st.enabled) {
      voiceStatusEl.textContent = params.get('voice') === 'off'
        ? '女の子の声：オフ（?voice=off）'
        : '女の子の声：このブラウザは音声合成に対応していません（台詞は吹き出しで出ます）';
    } else if (st.engine === 'voicevox') {
      // VOICEVOX の利用規約で、声を使うときは「VOICEVOX:キャラクター名」の表記が要る
      voiceStatusEl.textContent = `女の子の声：${st.credit}　V キーで替えられます`;
    } else if (st.japanese) {
      voiceStatusEl.textContent = `女の子の声：${short(st.name)}（日本語）　V キーで替えられます`;
    } else if (st.searching) {
      voiceStatusEl.textContent = '女の子の声：日本語の声を探しています…';
    } else {
      voiceStatusEl.textContent = '女の子の声：日本語の声が見つかりません。台詞は吹き出しだけになります。'
        + 'Windows なら［設定］→［時刻と言語］→［言語と地域］→［日本語］の［言語のオプション］で'
        + '「音声合成」を追加するか、Microsoft Edge / Google Chrome で開いてください。';
    }
    voiceStatusEl.style.color = st.enabled && !st.japanese && !st.searching ? '#a04e00' : '';
  });

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
