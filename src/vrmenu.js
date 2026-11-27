import * as THREE from 'three';
import * as mixer from './mixer.js';
import { comfort, saveComfort } from './comfort.js';

/**
 * VR の中のメニュー（売り物の水準 B3）。
 *
 * VR に入ると開始画面（DOM）は見えないので、音量や時間帯を変えるには、いちど VR を出るしかなかった。
 * 左手の Y ボタンで、目の前に板を出す。右手のレーザーで項目を指してトリガーで選ぶ（会話の札と同じ）。
 *
 *   BGM の音量・声の音量 … 板の左の「－」・右の「＋」。このブラウザに覚える（PC でも効く）
 *   時間帯           … 昼 → 夕方 → 夜
 *   操作のしかた      … VR の操作の一覧に切り替える（もう一度選ぶと戻る）
 *   VR をやめる       … VR を終える
 *   閉じる           … 板を消す（Y ボタンでも）
 */

const LEVELS_KEY = 'vrsample.levels';
const W = 512;
const H = 680;
const ROW0 = 70;
const ROW_H = 54;

const HELP = [
  '歩く：左スティック　向き：右スティック',
  'つかむ・投げる・選ぶ：トリガー',
  '乗る：乗り物にトリガー',
  '降りる：左グリップを 0.5 秒',
  '乗り物で目線を合わせ直す：左スティック押し込み',
  'このメニュー：左手の Y',
];

/** 覚えている音量（0〜1）。無ければ既定 */
export function loadLevels() {
  try {
    const v = JSON.parse(localStorage.getItem(LEVELS_KEY) ?? 'null');
    if (v && typeof v.music === 'number' && typeof v.voice === 'number') return v;
  } catch { /* 覚えていない */ }
  return { music: 1, voice: 1 };
}

/**
 * @param {object} options
 * @param {THREE.WebGLRenderer} options.renderer
 * @param {THREE.Camera} options.camera
 * @param {object[]} options.interactables レーザーで指せる物の表（開いているあいだだけ板を入れる）
 * @param {() => string} options.theme いまの時間帯
 * @param {() => string} options.cycleTheme 時間帯を次へ。替えた先を返す
 */
export function createVrMenu({ renderer, camera, interactables, theme, cycleTheme, setSeated = null }) {
  const levels = loadLevels();
  const apply = () => {
    mixer.setBusLevel('music', levels.music);
    mixer.setBusLevel('voice', levels.voice);
  };
  apply();
  const save = () => { try { localStorage.setItem(LEVELS_KEY, JSON.stringify(levels)); } catch { /* 覚えられなくてもよい */ } };

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const panel = new THREE.Mesh(
    new THREE.PlaneGeometry(0.4, 0.4 * H / W),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, toneMapped: false }),
  );
  panel.name = 'vrMenu';
  panel.visible = false;
  panel.renderOrder = 6;
  panel.userData.interactive = true;
  panel.userData.seatedSelect = true;   // 乗り物に乗っているあいだも指して選べる
  panel.userData.onSelectHit = (hit) => { if (hit?.uv) press(hit.uv); };

  let page = 'main';
  const THEME_NAME = { day: '昼', sunset: '夕方', night: '夜' };
  const rows = () => [
    { label: 'BGM の音量', value: `${Math.round(levels.music * 100)}%`, step: 'music' },
    { label: '声の音量', value: `${Math.round(levels.voice * 100)}%`, step: 'voice' },
    { label: '時間帯', value: THEME_NAME[theme()] ?? theme(), act: () => cycleTheme() },
    { label: '旋回', value: comfort.turn === 'smooth' ? 'なめらか' : '30° ずつ', act: () => { comfort.turn = comfort.turn === 'smooth' ? 'snap' : 'smooth'; saveComfort(); } },
    { label: '視野しぼり（酔い止め）', value: comfort.vignette ? '入' : '切', act: () => { comfort.vignette = !comfort.vignette; saveComfort(); } },
    { label: '座って遊ぶ', value: comfort.seated ? `入（+${Math.round(comfort.heightOffset * 100)}cm）` : '切', act: () => setSeated?.(!comfort.seated) },
    { label: 'コースター', value: comfort.coaster === 'full' ? '宙返りあり*' : 'やさしい*', act: () => { comfort.coaster = comfort.coaster === 'full' ? 'gentle' : 'full'; saveComfort(); } },
    { label: '操作のしかた', act: () => { page = 'help'; } },
    { label: 'VR をやめる', act: () => { close(); renderer.xr.getSession()?.end(); }, warn: true },
    { label: '閉じる', act: () => close() },
  ];

  function draw() {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(10, 16, 34, 0.92)';
    roundRect(0, 0, W, H, 28);
    ctx.fill();
    ctx.strokeStyle = 'rgba(143, 220, 255, 0.6)';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = '#bfe8ff';
    ctx.font = 'bold 30px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(page === 'help' ? '操作のしかた' : 'メニュー', 28, 38);
    if (page === 'help') {
      ctx.fillStyle = '#e8ecf8';
      ctx.font = '24px system-ui, sans-serif';
      HELP.forEach((line, i) => ctx.fillText(line, 28, ROW0 + 22 + i * 52));
      ctx.fillStyle = '#8fa3cc';
      ctx.font = '20px system-ui, sans-serif';
      ctx.fillText('（どこかを選ぶと戻る）', 28, H - 28);
    } else {
      ctx.fillStyle = '#8fa3cc';
      ctx.font = '18px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('* コースターは、ページを読み込み直すと変わります', 28, H - 22);
      rows().forEach((row, i) => {
        const y = ROW0 + i * ROW_H;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
        roundRect(18, y, W - 36, ROW_H - 8, 12);
        ctx.fill();
        ctx.fillStyle = row.warn ? '#ffb0a8' : '#e8ecf8';
        ctx.font = '26px system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(row.label, 36, y + (ROW_H - 8) / 2);
        if (row.step) {
          ctx.textAlign = 'center';
          ctx.fillStyle = '#5fc8ff';
          ctx.font = 'bold 30px system-ui, sans-serif';
          ctx.fillText('－', W - 200, y + (ROW_H - 8) / 2);
          ctx.fillText('＋', W - 60, y + (ROW_H - 8) / 2);
          ctx.fillStyle = '#e8ecf8';
          ctx.font = '24px system-ui, sans-serif';
          ctx.fillText(row.value, W - 130, y + (ROW_H - 8) / 2);
        } else if (row.value) {
          ctx.textAlign = 'right';
          ctx.fillStyle = '#5fc8ff';
          ctx.fillText(row.value, W - 40, y + (ROW_H - 8) / 2);
        }
      });
    }
    texture.needsUpdate = true;
  }
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /** 板の上の uv（0〜1）で選んだ */
  function press(uv) {
    if (!panel.visible) return;
    if (page === 'help') { page = 'main'; draw(); return; }
    const px = uv.x * W;
    const py = (1 - uv.y) * H;
    const i = Math.floor((py - ROW0) / ROW_H);
    const row = rows()[i];
    if (!row) return;
    if (row.step) {
      // 左半分（－の側）で下げる、右の端（＋）で上げる。10% きざみ
      const delta = px > W - 95 ? 0.1 : px > W - 235 && px < W - 165 ? -0.1 : 0;
      if (!delta) return;
      levels[row.step] = Math.round(Math.min(1, Math.max(0, levels[row.step] + delta)) * 10) / 10;
      apply();
      save();
    } else {
      row.act?.();
    }
    if (panel.visible) draw();
  }

  const eye = new THREE.Vector3();
  const dir = new THREE.Vector3();
  function open() {
    camera.getWorldPosition(eye);
    camera.getWorldDirection(dir);
    dir.y = 0;
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
    dir.normalize();
    // 目の前 55cm、少し下。顔のほうへ向ける
    panel.position.set(eye.x + dir.x * 0.55, eye.y - 0.12, eye.z + dir.z * 0.55);
    panel.lookAt(eye.x, eye.y - 0.05, eye.z);
    page = 'main';
    draw();
    panel.visible = true;
    if (!interactables.includes(panel)) interactables.push(panel);
  }
  function close() {
    panel.visible = false;
    const at = interactables.indexOf(panel);
    if (at >= 0) interactables.splice(at, 1);
  }

  let yWas = false;
  // 音の入れ物（AudioContext）は、最初の操作のあとで作られる。できたときに覚えた音量を入れ直す
  let applied = false;
  return {
    panel,
    get open() { return panel.visible; },
    toggle() { if (panel.visible) close(); else open(); },
    press,
    levels,
    /** 毎フレーム：左手の Y ボタンで開け閉め。VR を出たら閉じる */
    update() {
      if (!applied && mixer.mixerState().created) { apply(); applied = true; }
      const session = renderer.xr.isPresenting ? renderer.xr.getSession() : null;
      if (!session) { if (panel.visible) close(); yWas = false; return; }
      let y = false;
      [...session.inputSources].forEach((source, index) => {
        const hand = source.handedness === 'left' || source.handedness === 'right' ? source.handedness : index === 0 ? 'left' : 'right';
        if (hand === 'left' && source.gamepad?.buttons[5]?.pressed) y = true;
      });
      if (y && !yWas) { if (panel.visible) close(); else open(); }
      yWas = y;
    },
  };
}
