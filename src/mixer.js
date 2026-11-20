/**
 * 音のまとめ役。ゲーム全体で AudioContext を 1 つだけ持ち、音楽・声・効果音・環境音の 4 本のバスに分けて混ぜる。
 *
 * 前は足音・打球音・エンジン・波・メリーゴーランド・コースター・犬・花火・馬・BGM・かもめ・声が、それぞれ自分の
 * AudioContext を作っていた（13 個）。スマホ（とくに iOS の Safari）は同時に持てる数が少なく、あとから作った物が
 * 鳴らないことがあった。操作のたびに再開（resume）する所も 1 つで済む。
 *
 *   source → …各自の音作り… → bus('sfx' など) → コンプレッサー → master → 出力
 *
 * - 声が鳴っているあいだ音楽を下げるのは music.js（update の ducked）
 * - 聞く人（カメラ）の位置と向きは setListener で毎フレーム入れる。向きのある音は spatial() の PannerNode を通す
 * - AudioContext は、ユーザーの操作のあとでないと作らない（操作の前に作ると、止まったままの物ができて警告が出る）
 */

/** バスの音量の既定値（0..1）。各自の音作りの中の音量は今までどおりで、ここは全体のつり合いだけ */
export const BUS_LEVELS = { music: 1.0, voice: 1.0, sfx: 0.85, ambience: 0.8 };

let context = null;
let failed = false;
let master = null;
const buses = {};

function build() {
  const Class = window.AudioContext ?? window.webkitAudioContext;
  if (!Class) { failed = true; return null; }
  try { context = new Class(); } catch { failed = true; return null; }
  master = context.createGain();
  // コンプレッサーは小さい音を自動で持ち上げる（+2.8dB ほど）ので、そのぶん下げておく
  master.gain.value = 0.65;
  // 重なって割れないように、軽く圧縮してから出す（花火・エンジン・声が重なる所）
  const comp = context.createDynamicsCompressor();
  comp.threshold.value = -12;
  comp.knee.value = 6;
  comp.ratio.value = 3;
  comp.attack.value = 0.005;
  comp.release.value = 0.25;
  comp.connect(master).connect(context.destination);
  for (const [name, level] of Object.entries(BUS_LEVELS)) {
    const g = context.createGain();
    g.gain.value = level;
    g.connect(comp);
    buses[name] = g;
  }
  // 止められたら（電話・タブの切り替え・iOS の割り込み）、戻ってきたときに再開する
  document.addEventListener('visibilitychange', () => { if (!document.hidden) resume(); });
  // iOS：本体の消音スイッチで消えないように（対応している Safari だけ）
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* 無くても鳴る */ }
  // iOS：操作の中で無音を 1 回鳴らすと、そのあとは操作の外からも鳴らせる
  try {
    const src = context.createBufferSource();
    src.buffer = context.createBuffer(1, 1, context.sampleRate);
    src.connect(context.destination);
    src.start(0);
  } catch { /* 鳴らせなくても続ける */ }
  return context;
}

/**
 * 共有の AudioContext。まだ無ければ作る。操作の前・音の出せない環境では null。
 * 返ってきたら、止まっていれば再開も試みる
 */
export function audioContext() {
  if (failed || typeof window === 'undefined') return null;
  if (!context) {
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return null;
    if (!build()) return null;
  }
  resume();
  return context;
}

/** 止まっていたら再開する（ユーザーの操作のイベントの中で呼ぶと、iOS でも鳴り始める） */
export function resume() {
  if (context && context.state !== 'running' && context.state !== 'closed') context.resume().catch(() => {});
}

/** 音をつなぐ先。name は 'music' | 'voice' | 'sfx' | 'ambience'。audioContext() が返ったあとで呼ぶ */
export function bus(name = 'sfx') {
  if (!audioContext()) return null;
  return buses[name] ?? buses.sfx;
}

/** バスの音量を変える（0..1） */
export function setBusLevel(name, level) {
  if (!context || !buses[name]) return;
  buses[name].gain.setTargetAtTime(Math.max(0, level), context.currentTime, 0.05);
}

const setPos = (node, x, y, z) => {
  if (node.positionX) { node.positionX.value = x; node.positionY.value = y; node.positionZ.value = z; } else node.setPosition(x, y, z);
};

/**
 * 聞く人（カメラ）の位置と向きを入れる。毎フレーム呼ぶ。
 * @param {{x,y,z}} position @param {{x,y,z}} forward @param {{x,y,z}} up
 */
export function setListener(position, forward, up) {
  if (!context) return;
  const l = context.listener;
  if (l.positionX) {
    l.positionX.value = position.x; l.positionY.value = position.y; l.positionZ.value = position.z;
    l.forwardX.value = forward.x; l.forwardY.value = forward.y; l.forwardZ.value = forward.z;
    l.upX.value = up.x; l.upY.value = up.y; l.upZ.value = up.z;
  } else {
    l.setPosition(position.x, position.y, position.z);
    l.setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
  }
}

/**
 * 向きのある音の出口（PannerNode）を作って、バスへつなぐ。返った node へ音をつなぐ。
 * 短い効果音は鳴らすたびに作ってよい（鳴り終わると、つながりごと捨てられる）。鳴り続ける音は 1 つ作って move で動かす。
 *
 * @param {{x,y,z}} position 音の出る所（ワールド座標）
 * @param {object} [options]
 * @param {string} [options.to] バスの名前
 * @param {boolean} [options.distance] true なら距離でも小さくする。false（既定）は向きだけ
 *   （距離で音量を決める計算を自分で持っている音：犬・かもめ・花火・馬）
 * @param {number} [options.ref] この距離までは小さくならない（m）
 * @param {number} [options.rolloff] 小さくなる速さ
 * @param {number} [options.max] これより遠くは同じ大きさ（m）
 */
export function spatial(position, { to = 'sfx', distance = false, ref = 2, rolloff = 1, max = 80 } = {}) {
  const out = bus(to);
  if (!out) return null;
  const node = context.createPanner();
  // equalpower：左右の振り分けだけ。HRTF は 1 つごとに畳み込みが要り、Quest などで数が増えると重い（声だけ HRTF）
  node.panningModel = 'equalpower';
  node.distanceModel = 'inverse';
  node.refDistance = ref;
  node.rolloffFactor = distance ? rolloff : 0;
  node.maxDistance = max;
  setPos(node, position.x, position.y, position.z);
  node.connect(out);
  // 真横の音は、振り分けだけだと反対の耳が 0 になり、ヘッドホンで不自然。少しだけ（30%）両耳へそのまま回す
  const input = context.createGain();
  const bleed = context.createGain();
  bleed.gain.value = 0.3;
  input.connect(node);
  input.connect(bleed).connect(out);
  return { node: input, panner: node, move(p) { setPos(node, p.x, p.y, p.z); } };
}

/** 検証用：出力の大きさ（RMS）を測る。呼ぶたびに、いまの値を返す */
let analyser = null;
export function outputLevel() {
  if (!context) return 0;
  if (!analyser) { analyser = context.createAnalyser(); analyser.fftSize = 2048; master.connect(analyser); }
  const data = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(data);
  let sum = 0;
  for (const v of data) sum += v * v;
  return Math.sqrt(sum / data.length);
}

/** 検証用 */
export function mixerState() {
  return { created: Boolean(context), state: context?.state ?? null, levels: Object.fromEntries(Object.entries(buses).map(([k, g]) => [k, g.gain.value])) };
}

// 操作のたびに、作る・再開する。iOS の Safari は、操作のイベントの中で同期して作って resume しないと鳴らない
// （touchend / pointerup が確実。割り込みで止まったあとも、次の操作で戻る）
if (typeof window !== 'undefined') {
  for (const name of ['pointerdown', 'pointerup', 'touchend', 'keydown']) {
    window.addEventListener(name, () => { audioContext(); }, { passive: true, capture: true });
  }
}
