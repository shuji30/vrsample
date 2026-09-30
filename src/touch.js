/**
 * スマホ・タブレットのタッチ操作。
 *
 * 画面の上に、左下の仮想スティックと右下のボタンを重ねる。どちらも PC のキーとして届ける
 * （window へ KeyboardEvent を送る。歩く・乗り物・ゲームは、今までどおりキーで動く）。
 *   - 左のスティック：前後左右（W / S / A / D）。いっぱいまで倒すと走る（Shift）
 *   - 乗り物の運転中は、左のスティックが十字ボタンに変わる：◀ ▶ でハンドル、▲ ▼ でシフトアップ・ダウン（GT3・F40）、
 *     潜っているときは上へ・下へ。上の「ジャイロ」を入れると、スマホを傾けてハンドルを切れる（ハンドルのように、
 *     画面を左右に傾ける。±30° でいっぱい）
 *   - 右のボタン：いまできることを 1 つだけ、大きいボタンで出す（名前もそのときの動き：乗る・降りる・拾う・投げる・
 *     打つ・振る・座る・もぐる…）。2 つ同時に要るとき（潜っているときの上へ・下へ、ブーメランの右へ投げる、
 *     ラケットを置く・サイドブレーキ）だけ、小さいボタンを足す。降りる・視点・ジャイロ・AT/MT は上（左上の「？ 説明」の右）に小さく。
 *     何もできないときは出さない
 *     （以前は 5 つのボタンがいつも出ていて、「スペース」「置く / 右へ」など、何をするのか分かりにくかった）。
 *     出すボタンは main.js の actions() が決める（{ buttons, chips, dpad }。ボタンは { code, key, label, size, hint }。
 *     code 'gyro' はキーではなく、ジャイロの入り切り）
 *   - 見回す：画面をドラッグ（1 本指）、ズームは 2 本指でつまむ（OrbitControls のまま）
 *   - 物にさわる・乗り物に乗る・座る：その物をタップ（今までのクリックと同じ）
 * 出すのは、指で触る端末（pointer: coarse）か ?touch=on のとき。?touch=off で出さない。VR の最中は隠す。
 */

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

export function createTouchControls({ isXR = () => false, actions = () => ({}) } = {}) {
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

  // --- ボタン（押しているあいだキーを押す） ----------------------------------------
  const allButtons = [];
  function makeButton(parent, cls = '') {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `touch-btn ${cls}`;
    el.style.display = 'none';
    let pointer = null;
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (pointer !== null || !el.dataset.code) return;
      if (el.dataset.code === 'gyro') { toggleGyro(); return; }
      pointer = e.pointerId;
      capture(el, e.pointerId);
      el.classList.add('pressed');
      // 押した時のキーを覚えておく（押しているあいだに名前が変わっても、同じキーを離す）
      el.dataset.held = el.dataset.code;
      send('keydown', el.dataset.code, el.dataset.key);
    });
    const up = (e) => {
      if (e.pointerId !== pointer) return;
      pointer = null;
      el.classList.remove('pressed');
      if (el.dataset.held) send('keyup', el.dataset.held, '');
      el.dataset.held = '';
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    parent.appendChild(el);
    allButtons.push(el);
    return el;
  }
  /** ボタン 1 つに、出すもの（{ code, key, label, size, hint }）を入れる。null なら隠す */
  function fill(el, a, cls) {
    if (el.classList.contains('pressed')) return false;
    el.style.display = a ? '' : 'none';
    if (!a) { el.dataset.code = ''; return true; }
    el.dataset.code = a.code;
    el.dataset.key = a.key ?? '';
    el.className = `touch-btn ${cls ?? (a.size === 'small' ? 'small' : 'big')}${a.on ? ' on' : ''}`;
    el.textContent = a.label;
    if (a.hint) {
      const h = document.createElement('small');
      h.textContent = a.hint;
      el.append(h);
    }
    return true;
  }
  // 右下：いまできること（大きいボタン、ときどき小さいボタン）
  const pad = document.createElement('div');
  pad.className = 'touch-buttons';
  root.appendChild(pad);
  const mainEls = Array.from({ length: 4 }, () => makeButton(pad));
  // 上（「？ 説明」の右）：降りる・視点・ジャイロ・AT/MT
  const bar = document.createElement('div');
  bar.className = 'touch-chips';
  root.appendChild(bar);
  const chipEls = Array.from({ length: 4 }, () => makeButton(bar, 'chip'));
  // 左下：運転中の十字ボタン（スティックと入れ替える）
  const cross = document.createElement('div');
  cross.className = 'touch-dpad';
  cross.style.display = 'none';
  root.appendChild(cross);
  const dirEls = {};
  for (const dir of ['up', 'left', 'right', 'down']) dirEls[dir] = makeButton(cross, `dpad ${dir}`);

  let shownKey = null;
  function setActions(a = {}) {
    const list = Array.isArray(a) ? { buttons: a } : a;
    const key = JSON.stringify(list);
    if (key === shownKey) return;
    shownKey = key;
    let ok = true;
    mainEls.forEach((el, i) => { ok = fill(el, list.buttons?.[i]) && ok; });
    chipEls.forEach((el, i) => { ok = fill(el, list.chips?.[i], 'chip') && ok; });
    const d = list.dpad;
    // 十字ボタンのあいだは、スティックを隠して離す
    const useDpad = Boolean(d);
    if (useDpad !== (cross.style.display !== 'none')) {
      applyStick(0, 0);
      stickId = null;
      base.style.display = useDpad ? 'none' : '';
      cross.style.display = useDpad ? '' : 'none';
    }
    for (const dir of Object.keys(dirEls)) ok = fill(dirEls[dir], d?.[dir] ?? null, `dpad ${dir}`) && ok;
    if (!ok) shownKey = null;      // 押しているボタンは離すまでそのまま。離したら入れ替える
  }
  setActions({});

  // --- ジャイロのハンドル --------------------------------------------------------
  // 画面を左右に傾けた角度（ハンドルのように）。横向きでは beta、縦向きでは gamma が画面の中の傾き
  let gyroOn = false;
  let tilt = null;
  let tilt0 = 0;                    // 入れたときの傾き（まっすぐ）
  let zeroNext = false;
  function onOrient(e) {
    if (e.beta == null || e.gamma == null) return;
    const angle = screen.orientation?.angle ?? window.orientation ?? 0;
    const t = angle === 90 ? e.beta : angle === -90 || angle === 270 ? -e.beta : angle === 180 ? -e.gamma : e.gamma;
    if (zeroNext) { tilt0 = t; zeroNext = false; }
    tilt = t - tilt0;
  }
  async function toggleGyro() {
    if (gyroOn) { gyroOn = false; tilt = null; window.removeEventListener('deviceorientation', onOrient); shownKey = null; return; }
    // iOS は、タップの中で許可を求める
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        const r = await DeviceOrientationEvent.requestPermission();
        if (r !== 'granted') return;
      }
    } catch { return; }
    gyroOn = true;
    zeroNext = true;
    window.addEventListener('deviceorientation', onOrient);
    shownKey = null;
  }

  // 指を離さずにページの外へ出た・別のアプリへ切り替えた：押しっぱなしを残さない
  const releaseAll = () => {
    applyStick(0, 0);
    stickId = null;
    for (const el of allButtons) if (el.classList.contains('pressed')) { el.classList.remove('pressed'); send('keyup', el.dataset.held || el.dataset.code, ''); el.dataset.held = ''; }
  };
  window.addEventListener('blur', releaseAll);
  document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAll(); });

  let shown = true;
  let actionsIn = 0;
  return {
    root,
    stick,
    /** 毎フレーム：VR の最中は隠す。ボタンは 0.15 秒ごとに、いまできることへ入れ替える */
    update(dt = 1 / 60) {
      const want = !isXR();
      if (want !== shown) { shown = want; root.style.display = want ? '' : 'none'; if (!want) releaseAll(); }
      if (!shown) return;
      actionsIn -= dt;
      if (actionsIn <= 0) {
        actionsIn = 0.15;
        try { setActions(actions()); } catch { /* 途中の状態で読めないときは、前のまま */ }
      }
    },
    setActions,
    /** ジャイロのハンドル（-1 右 〜 +1 左。入っていない・読めないときは null） */
    get steer() {
      if (!gyroOn || tilt === null) return null;
      const d = Math.abs(tilt) < 3 ? 0 : tilt - Math.sign(tilt) * 3;
      return Math.max(-1, Math.min(1, -d / 27));
    },
    get gyro() { return gyroOn; },
    /** 検証用：傾きを入れる（度。+ で右へ傾ける） */
    debugTilt(deg) { gyroOn = true; tilt = deg; },
    /** 検証用：いま出ているボタン */
    get shown() { return allButtons.filter((el) => el.style.display !== 'none').map((el) => el.textContent); },
    releaseAll,
    /** 検証用：スティックを倒す（-1〜1。y は下が +） */
    debugStick(x, y) { applyStick(x, y); },
  };
}
