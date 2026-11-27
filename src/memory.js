import * as THREE from 'three';
import { girlName } from './girlname.js';

/**
 * 思い出ノートと思い出ボード（ROADMAP 8 の土台）。
 *
 * - その日にした遊び（女の子と遊んだもの。world.currentPlay が変わったとき）と、キャッチボールのいちばん長いラリーを
 *   このブラウザに覚える（日ごと。直近 10 日ぶん）
 * - ボードの下に「つぎは？」：きょうまだしていない遊びを 3 つ（台詞は足さない。ユーザーの判断）
 * - 家の奥の壁に「思い出ボード」をかける：きょうしたこと・前の休日にしたこと・ベスト。VR でも読める（シーンの中の板）
 *
 * 遊びの名前は plays.js の名前（kart・tennis など）。
 */

const KEY = 'vrsample.memory';
const KEEP_DAYS = 10;

/** 遊びの名前 → ボードに書く言葉 */
export const PLAY_LABELS = {
  catch: 'キャッチボール', tennis: 'テニス', kart: 'カート', bike: 'ポケバイ', seesaw: 'シーソー', buranko: 'ブランコ',
  fishing: '釣り', horse: '乗馬', carousel: 'メリーゴーランド', ferris: '観覧車', coaster: 'ジェットコースター',
  golf: 'パットゴルフ', billiard: 'ビリヤード', seat: 'おしゃべり', beach: '海辺', cruiser: 'クルーザー',
  jetski: 'ジェットスキー', dive: 'ダイビング', cessna: 'セスナ', f40: 'ドライブ', gt3: 'GT3 のレース',
};

/** 「つぎは？」に出す順（座って話すは出さない） */
const SUGGEST = ['catch', 'tennis', 'kart', 'fishing', 'ferris', 'coaster', 'golf', 'beach', 'horse', 'carousel', 'bike',
  'seesaw', 'buranko', 'billiard', 'cruiser', 'jetski', 'dive', 'cessna', 'f40', 'gt3'];

/** きょうまだしていない遊びを 3 つ。日によって始まりをずらす */
export function suggestNext(plays, date = new Date()) {
  const start = date.getDate() % SUGGEST.length;
  const order = [...SUGGEST.slice(start), ...SUGGEST.slice(0, start)];
  return order.filter((k) => !plays[k]).slice(0, 3);
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function load() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (v && typeof v === 'object' && v.days) return v;
  } catch { /* 覚えていない */ }
  return { days: {}, best: { rally: 0 } };
}

/**
 * @param {THREE.Object3D} parent ボードをかける所（部屋の group）
 * @param {{ x: number, y: number, z: number, yaw: number }} at ボードの位置と向き
 */
export function createMemory(parent, at) {
  const data = load();
  const save = () => {
    // 古い日を捨てる
    const keys = Object.keys(data.days).sort();
    while (keys.length > KEEP_DAYS) delete data.days[keys.shift()];
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* 覚えられなくてもよい */ }
  };
  const day = (key = today()) => (data.days[key] ??= { plays: {}, rally: 0 });

  // --- ボード ---------------------------------------------------------------
  const W = 768;
  const H = 528;
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  let texture = null;
  const board = new THREE.Group();
  board.name = 'memoryBoard';
  if (canvas) {
    canvas.width = W;
    canvas.height = H;
    texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    const w = 1.0;
    const h = w * H / W;
    // コルクの板と木の枠
    const frame = new THREE.Mesh(new THREE.BoxGeometry(w + 0.06, h + 0.06, 0.025), new THREE.MeshStandardMaterial({ color: 0x6d5236, roughness: 0.8 }));
    frame.position.z = -0.012;
    board.add(frame);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: texture, roughness: 0.95 }));
    face.position.z = 0.002;
    board.add(face);
    board.position.set(at.x, at.y, at.z);
    board.rotation.y = at.yaw;
    parent.add(board);
  }

  function draw() {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    // コルク
    ctx.fillStyle = '#c69a6a';
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = `rgba(${90 + Math.random() * 60},${60 + Math.random() * 40},${30 + Math.random() * 20},0.25)`;
      ctx.fillRect(Math.random() * W, Math.random() * H, 2, 2);
    }
    const note = (x, y, w, h, color, tilt) => {
      ctx.save();
      ctx.translate(x + w / 2, y + h / 2);
      ctx.rotate(tilt);
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fillRect(-w / 2 + 4, -h / 2 + 5, w, h);
      ctx.fillStyle = color;
      ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.fillStyle = '#d23b3b';
      ctx.beginPath();
      ctx.arc(0, -h / 2 + 12, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };
    ctx.fillStyle = '#3b2a1a';
    ctx.textBaseline = 'top';
    ctx.font = 'bold 34px system-ui, sans-serif';
    ctx.fillText(`${girlName()}との思い出`, 28, 20);

    const list = (plays) => Object.keys(plays).map((k) => PLAY_LABELS[k] ?? k);
    const todayKey = today();
    const t = day(todayKey);
    const prevKey = Object.keys(data.days).filter((k) => k < todayKey && Object.keys(data.days[k].plays).length).sort().pop();
    const card = (x, y, title, lines, color, tilt) => {
      note(x, y, 340, 380, color, tilt);
      ctx.save();
      ctx.translate(x + 170, y + 190);
      ctx.rotate(tilt);
      ctx.fillStyle = '#2a2018';
      ctx.font = 'bold 32px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(title, 0, -150);
      ctx.font = 'bold 30px system-ui, sans-serif';
      ctx.textAlign = 'left';
      const shown = lines.length ? lines.slice(0, 6) : ['（まだ　なにも）'];
      shown.forEach((line, i) => ctx.fillText(`・${line}`, -150, -104 + i * 44));
      if (lines.length > 6) ctx.fillText(`ほか ${lines.length - 6} こ`, -150, -104 + 6 * 44);
      ctx.restore();
    };
    card(24, 88, 'きょう', list(t.plays), '#fff6c8', -0.02);
    card(400, 92, prevKey ? `${Number(prevKey.slice(5, 7))}月${Number(prevKey.slice(8))}日` : 'まえの休日', prevKey ? list(data.days[prevKey].plays) : [], '#d8f0ff', 0.025);
    // ベスト
    ctx.fillStyle = '#3b2a1a';
    ctx.font = 'bold 24px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`キャッチボールのベスト ${data.best.rally ?? 0} かい`, W - 26, 26);
    ctx.textAlign = 'left';
    // つぎは？：きょうまだしていない遊びを 3 つ（日によって並びを回す）
    const next = suggestNext(t.plays);
    if (next.length) {
      ctx.fillStyle = '#2a2018';
      ctx.font = 'bold 26px system-ui, sans-serif';
      ctx.fillText(`つぎは？　${next.map((k) => PLAY_LABELS[k]).join('・')}`, 30, H - 44);
    }
    texture.needsUpdate = true;
  }
  draw();

  let last = null;
  return {
    board,
    data,
    /** いまの遊び（world.currentPlay）。変わって新しい遊びが始まったら、きょうの思い出に足す */
    notePlay(play) {
      if (!play || play === last) return;
      last = play;
      if (play === 'catch') return;   // ふだん（キャッチボールの待ち）は数えない。ラリーで数える
      const d = day();
      d.plays[play] = (d.plays[play] ?? 0) + 1;
      save();
      draw();
    },
    /** キャッチボールのラリー（つづいた回数）。3 回以上で、きょうの思い出に足す。ベストを覚える */
    noteRally(n) {
      if (!(n > 0)) return;
      const d = day();
      let changed = false;
      if (n >= 3 && !d.plays.catch) { d.plays.catch = 1; changed = true; }
      if (n > d.rally) { d.rally = n; changed = true; }
      if (n > (data.best.rally ?? 0)) { data.best.rally = n; changed = true; }
      if (changed) { save(); draw(); }
    },
    /** きょうしていない遊び（plays の名前）。「つぎ、なにする？」に使う */
    notYetToday(names) { const d = day(); return names.filter((n) => !d.plays[n]); },
    redraw: draw,
  };
}
