/**
 * スマホ・タブレットのタッチ操作。
 *
 * 画面の上に、左下の仮想スティックと右下のボタンを重ねる。どちらも PC のキーとして届ける
 * （window へ KeyboardEvent を送る。歩く・乗り物・ゲームは、今までどおりキーで動く）。
 *   - 左のスティック：前後左右（W / S / A / D）。いっぱいまで倒すと走る（Shift）。乗り物ではアクセル・ブレーキ・ハンドル
 *   - 右のボタン：拾う / 投げる（F。長押しでブーメランの強さをためる）、乗る / 降りる（E）、
 *     スペース（長押しでパット・ビリヤードの強さ、テニスのスイング）、視点（C）、置く / 右へ（G）
 *   - 見回す：画面をドラッグ（1 本指）、ズームは 2 本指でつまむ（OrbitControls のまま）
 *   - 物にさわる・乗り物に乗る・座る：その物をタップ（今までのクリックと同じ）
 * 出すのは、指で触る端末（pointer: coarse）か ?touch=on のとき。?touch=off で出さない。VR の最中は隠す。
 */

const BUTTONS = [
  { code: 'KeyF', key: 'f', label: '拾う\n投げる', cls: 'big' },
  { code: 'Space', key: ' ', label: 'スペース', cls: 'big' },
  { code: 'KeyE', key: 'e', label: '乗る\n降りる' },
  { code: 'KeyC', key: 'c', label: '視点' },
  { code: 'KeyG', key: 'g', label: '置く\n右へ' },
];

/** 指で触る端末か（?touch=on / off が優先） */
export function isTouchDevice(params = new URLSearchParams(location.search)) {
  const q = params.get('touch');
  if (q === 'on') return true;
  if (q === 'off') return false;
  try {
    return window.matchMedia('(pointer: coarse)').matches && !window.matchMedia('(pointer: fine)').matches;
  } catch {
    return false;
  }
}

/** ポインタを捕まえる（捕まえられない端末・合成のイベントでも止めない） */
function capture(el, id) {
  try { el.setPointerCapture(id); } catch { /* 捕まえられなくても、離したときの pointerup / pointercancel で戻す */ }
}

function send(type, code, key) {
  window.dispatchEvent(new KeyboardEvent(type, { code, key, bubbles: true }));
}

export function createTouchControls({ isXR = () => false } = {}) {
  const root = document.createElement('div');
  root.id = 'touch-ui';
  document.body.appendChild(root);

  // --- 左：仮想スティック ------------------------------------------------------
  const base = document.createElement('div');
  base.className = 'touch-stick';
  const knob = document.createElement('div');
  knob.className = 'touch-knob';
  base.appendChild(knob);
  root.appendChild(base);
  const held = new Set();          // いま押しているキー（スティックの分）
  const setKey = (code, key, on) => {
    if (on && !held.has(code)) { held.add(code); send('keydown', code, key); }
    else if (!on && held.has(code)) { held.delete(code); send('keyup', code, key); }
  };
  let stickId = null;
  let cx = 0;
  let cy = 0;
  const R = 56;                    // つまみが動ける半径（px）
  const stick = { x: 0, y: 0 };
  function applyStick(x, y) {
    stick.x = x;
    stick.y = y;
    knob.style.transform = `translate(${x * R}px, ${y * R}px)`;
    const m = Math.hypot(x, y);
    // 押しはじめ 0.35、離すのは 0.25（境目でばたつかない）
    const on = (v, code) => (held.has(code) ? v > 0.25 : v > 0.35);
    setKey('KeyW', 'w', on(-y, 'KeyW'));
    setKey('KeyS', 's', on(y, 'KeyS'));
    setKey('KeyA', 'a', on(-x, 'KeyA'));
    setKey('KeyD', 'd', on(x, 'KeyD'));
    setKey('ShiftLeft', 'Shift', held.has('ShiftLeft') ? m > 0.85 : m > 0.95);
  }
  base.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    stickId = e.pointerId;
    capture(base, e.pointerId);
    const r = base.getBoundingClientRect();
    cx = r.left + r.width / 2;
    cy = r.top + r.height / 2;
    move(e);
  });
  function move(e) {
    if (e.pointerId !== stickId) return;
    let x = (e.clientX - cx) / R;
    let y = (e.clientY - cy) / R;
    const m = Math.hypot(x, y);
    if (m > 1) { x /= m; y /= m; }
    applyStick(x, y);
  }
  base.addEventListener('pointermove', (e) => { e.preventDefault(); move(e); });
  const endStick = (e) => {
    if (e.pointerId !== stickId) return;
    stickId = null;
    applyStick(0, 0);
  };
  base.addEventListener('pointerup', endStick);
  base.addEventListener('pointercancel', endStick);

  // --- 右：ボタン ---------------------------------------------------------------
  const pad = document.createElement('div');
  pad.className = 'touch-buttons';
  root.appendChild(pad);
  const buttonEls = [];
  for (const b of BUTTONS) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `touch-btn ${b.cls ?? ''}`;
    el.textContent = b.label;
    el.dataset.code = b.code;
    let pointer = null;
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (pointer !== null) return;
      pointer = e.pointerId;
      capture(el, e.pointerId);
      el.classList.add('down');
      send('keydown', b.code, b.key);
    });
    const up = (e) => {
      if (e.pointerId !== pointer) return;
      pointer = null;
      el.classList.remove('down');
      send('keyup', b.code, b.key);
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    pad.appendChild(el);
    buttonEls.push(el);
  }

  // 指を離さずにページの外へ出た・別のアプリへ切り替えた：押しっぱなしを残さない
  const releaseAll = () => {
    applyStick(0, 0);
    stickId = null;
    for (const el of buttonEls) if (el.classList.contains('down')) { el.classList.remove('down'); send('keyup', el.dataset.code, ''); }
  };
  window.addEventListener('blur', releaseAll);
  document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAll(); });

  let shown = true;
  return {
    root,
    stick,
    /** 毎フレーム：VR の最中は隠す */
    update() {
      const want = !isXR();
      if (want !== shown) { shown = want; root.style.display = want ? '' : 'none'; if (!want) releaseAll(); }
    },
    releaseAll,
    /** 検証用：スティックを倒す（-1〜1。y は下が +） */
    debugStick(x, y) { applyStick(x, y); },
  };
}
