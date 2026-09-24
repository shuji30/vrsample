/**
 * ハンコン（ハンドル型コントローラー）・ペダル・ゲームパッドを読む（Gamepad API）。
 *
 * どの機種でも同じ読み方をする（Logitech / Thrustmaster T300・T-GT / Fanatec /
 * CAMMUS などのダイレクトドライブ / SIMJACK などの単体ペダル）。ハンドルとペダルが
 * 別々の USB 機器でもよい。VR の最中もページの JavaScript は動いているので、PC に
 * つないだハンコンは VR の中でも読める。
 *
 * 役割（ハンドル・アクセル・ブレーキ）ごとに「どの機器の、どの軸か」を覚える。
 *   - 設定の画面（H キー）の「キャリブレーションを始める」で、ハンドル（まっすぐ →
 *     左いっぱい → 右いっぱい）・アクセル・ブレーキ（踏みきって離す）を順に案内し、
 *     いちばん大きく動いた軸と、離したとき・踏みきったときの値を覚える（ロードセルの
 *     ペダルは、踏みきったときの値が機器側の設定しだいなので、端の ±1 とは決めつけない）。
 *     localStorage に保存する
 *   - 設定していなければ、軸 0 をハンドルとし、止まっているときに端（±1）にある軸を
 *     ペダルと見る（多くのペダルは、離すと端にある）
 *   - ハンドルの回す角度（何度回すとカートのハンドルがいっぱいか）と、ハンコン全体の
 *     回転角も設定できる
 *
 * ゲームパッド（Xbox など、mapping が 'standard'）は、左スティックでハンドル、RT で
 * アクセル、LT でブレーキ。
 */

const STORE = 'vrsample.wheel2';

const DEFAULT = {
  /** 役割ごとの { id（機器の名前）, axis, rest（離したときの値）, full（踏みきった / 左いっぱいの値） } */
  steer: null,
  throttle: null,
  brake: null,
  /** ハンコン全体の回転角（端から端、度）。G29 / T300 は 900、Fanatec / DD は 900〜1080 など */
  lockDegrees: 900,
  /** カートのハンドルがいっぱいになるまでに回す角度（中央から片側、度） */
  fullDegrees: 90,
};

function load() {
  try { return { ...DEFAULT, ...JSON.parse(localStorage.getItem(STORE) ?? '{}') }; } catch { return { ...DEFAULT }; }
}
function save(config) {
  try { localStorage.setItem(STORE, JSON.stringify(config)); } catch { /* 覚えられなくても動く */ }
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export function createWheelInput() {
  let config = load();
  /** 機器ごとの、最初に見たときの軸の値（ペダルの軸を見分けるのに使う） */
  const firstAxes = new Map();

  function pads() {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return [];
    return [...navigator.getGamepads()].filter((p) => p && p.connected && p.axes.length > 0);
  }
  /** ゲームパッドでない入力機器（ハンコン・ペダル・シフターなど） */
  const isSimDevice = (pad) => pad.mapping !== 'standard';
  const byId = (id) => pads().find((p) => p.id === id) ?? null;

  /** 設定していない役割を、つながっている機器から推し量る */
  function guess() {
    const sims = pads().filter(isSimDevice);
    for (const pad of sims) if (!firstAxes.has(pad.id)) firstAxes.set(pad.id, pad.axes.slice());
    const roles = { steer: config.steer, throttle: config.throttle, brake: config.brake };
    if (!roles.steer) {
      // ハンドルは、軸が 3 つ以上ある機器の軸 0（ハンドルとペダルが一体の機種）、無ければ最初の機器の軸 0
      const wheel = sims.find((p) => p.axes.length >= 3) ?? sims[0];
      if (wheel) roles.steer = { id: wheel.id, axis: 0, rest: 0, full: -1 };
    }
    if (!roles.throttle || !roles.brake) {
      const pedals = [];
      for (const pad of sims) {
        const rest = firstAxes.get(pad.id);
        rest.forEach((v, i) => {
          if (roles.steer && pad.id === roles.steer.id && i === roles.steer.axis) return;
          if (Math.abs(Math.abs(v) - 1) < 0.05) pedals.push({ id: pad.id, axis: i, rest: Math.sign(v), full: -Math.sign(v) });
        });
      }
      roles.throttle ??= pedals[0] ?? null;
      roles.brake ??= pedals.find((p) => p !== roles.throttle && !(p.id === roles.throttle?.id && p.axis === roles.throttle?.axis)) ?? null;
    }
    return roles;
  }

  function axisValue(role) {
    if (!role) return null;
    const pad = byId(role.id);
    return pad ? pad.axes[role.axis] ?? null : null;
  }

  /** ペダルを 0（離す）〜 1（踏みきる）に */
  function pedalValue(role) {
    const v = axisValue(role);
    if (v === null || role.full === role.rest) return 0;
    return clamp((v - role.rest) / (role.full - role.rest), 0, 1);
  }

  /**
   * いまの入力。ハンコンもゲームパッドも無ければ null
   * @returns {{ steer: number, throttle: number, brake: number, kind: 'wheel' | 'pad', angle: number, id: string, pad: Gamepad } | null}
   *   steer は -1（右）〜 1（左）、angle はハンコンの実際の角度（度、左が +）
   */
  function read() {
    const roles = guess();
    const raw = axisValue(roles.steer);
    if (raw !== null) {
      // 覚えた「左いっぱい」の値の符号で向きを決める。軸の -1..1 が全体の回転角
      const left = Math.sign((roles.steer.full ?? -1) - (roles.steer.rest ?? 0)) || -1;
      const angle = (raw - (roles.steer.rest ?? 0)) * left * (config.lockDegrees / 2);
      return {
        steer: clamp(angle / config.fullDegrees, -1, 1),
        throttle: pedalValue(roles.throttle),
        brake: pedalValue(roles.brake),
        kind: 'wheel',
        angle,
        id: roles.steer.id,
        pad: byId(roles.steer.id),
      };
    }
    for (const pad of pads()) {
      if (pad.mapping !== 'standard') continue;
      const x = pad.axes[0] ?? 0;
      const steer = Math.abs(x) < 0.12 ? 0 : -x;
      const throttle = pad.buttons[7]?.value ?? 0;
      const brake = pad.buttons[6]?.value ?? 0;
      if (Math.abs(steer) > 0 || throttle > 0.02 || brake > 0.02 || pad.buttons.some((b) => b.pressed)) {
        return { steer, throttle, brake, kind: 'pad', angle: steer * 90, id: pad.id, pad };
      }
    }
    return null;
  }

  // --- キャリブレーションと設定の画面（PC、H キー） ------------------------------
  //
  // 手順を案内して、ハンドル・アクセル・ブレーキを 1 つずつ覚える。
  //   1. ハンドルをまっすぐにして「次へ」… すべての軸の、止まっているときの値を覚える
  //   2. ハンドルを左いっぱい → 右いっぱい → 真ん中 … いちばん大きく動いた軸がハンドル。
  //      先に動いた向きが左
  //   3. アクセルを踏みきって離す … ハンドル以外でいちばん動いた軸。離したとき・踏みきった
  //      ときの値を覚える（ロードセルのペダルは踏みきった値が機器の設定しだいなので決めつけない）
  //   4. ブレーキを踏みきって離す … 同じ
  // ハンドルとペダルが別々の機器でもよい。
  let panel = null;
  let loop = 0;
  let wizard = null;   // { step, center: Map<id, axes>, track: {...} }

  const STEPS = {
    center: 'ハンドルをまっすぐ（真ん中）にして、ペダルから足を離し、「次へ」を押してください',
    steer: 'ハンドルを左いっぱいまで回し、次に右いっぱいまで回して、真ん中に戻してください（回しきれないときは、左右へ回したあとで「次へ」）',
    throttle: 'アクセルをいっぱいに踏んで、離してください',
    brake: 'ブレーキをいっぱいに踏んで、離してください',
    done: 'キャリブレーションが終わりました。下のバーで、ハンドル・アクセル・ブレーキが動くか確かめてください',
  };

  const same = (a, b) => a && b && a.id === b.id && a.axis === b.axis;

  /** 覚えはじめからいちばん大きく動いた軸（除く軸は選ばない）。動いた量・いちばん端の値も */
  function biggestMove(exclude = []) {
    let best = null;
    for (const pad of pads().filter(isSimDevice)) {
      const center = wizard.center.get(pad.id);
      if (!center) continue;
      pad.axes.forEach((v, i) => {
        if (exclude.some((e) => same(e, { id: pad.id, axis: i }))) return;
        const key = `${pad.id}#${i}`;
        const t = wizard.track.get(key) ?? { id: pad.id, axis: i, rest: center[i], min: center[i], max: center[i], first: 0 };
        t.min = Math.min(t.min, v);
        t.max = Math.max(t.max, v);
        // 最初に大きく動いた向き（ハンドルの左を決める）
        if (!t.first && Math.abs(v - t.rest) > 0.25) t.first = Math.sign(v - t.rest);
        t.now = v;
        wizard.track.set(key, t);
        const range = t.max - t.min;
        if (range > 0.12 && (!best || range > best.max - best.min)) best = t;
      });
    }
    return best;
  }

  function wizardStep() {
    if (!wizard) return;
    if (wizard.step === 'steer') {
      const t = biggestMove();
      // 左右の両方へ動かして、真ん中へ戻したら決める。回転角を大きく設定した DD では
      // いっぱいまで回すと軸の値の変わりが小さいので、片側 0.05（900° なら 22°）で足りるとする。
      // 回しきれないときは「次へ」でも決められる
      if (t && t.max - t.rest > 0.05 && t.rest - t.min > 0.05 && Math.abs(t.now - t.rest) < 0.03) finishSteer(t);
    } else if (wizard.step === 'throttle' || wizard.step === 'brake') {
      const exclude = [config.steer, wizard.step === 'brake' ? config.throttle : null].filter(Boolean);
      const t = biggestMove(exclude);
      if (t && t.max - t.min > 0.3 && Math.abs(t.now - t.rest) < 0.06) {
        const full = Math.abs(t.max - t.rest) > Math.abs(t.min - t.rest) ? t.max : t.min;
        config[wizard.step] = { id: t.id, axis: t.axis, rest: t.rest, full };
        save(config);
        wizard.track.clear();
        wizard.step = wizard.step === 'throttle' ? 'brake' : 'done';
      }
    }
  }

  function finishSteer(t) {
    config.steer = { id: t.id, axis: t.axis, rest: t.rest, full: t.rest + (t.first || -1) };
    save(config);
    wizard.track.clear();
    wizard.step = 'throttle';
  }

  function startWizard() {
    wizard = { step: 'center', center: new Map(), track: new Map() };
  }
  function wizardNext() {
    if (wizard?.step === 'steer') {
      // 回しきれなかった：いままでにいちばん動いた軸で決める
      const t = biggestMove();
      if (t) finishSteer(t);
      return;
    }
    if (wizard?.step !== 'center') return;
    for (const pad of pads().filter(isSimDevice)) wizard.center.set(pad.id, pad.axes.slice());
    wizard.step = 'steer';
  }

  const bar = (label, value, signed = false) => {
    const pct = Math.round(Math.abs(value) * 100);
    const left = signed ? (value > 0 ? 50 - pct / 2 : 50) : 0;
    const width = signed ? pct / 2 : pct;
    return `<div style="display:flex;align-items:center;gap:8px"><span style="width:6em">${label}</span>`
      + `<span style="position:relative;display:inline-block;width:260px;height:12px;background:#334;border-radius:6px">`
      + `<span style="position:absolute;left:${left}%;width:${width}%;height:100%;background:#7fd1ff;border-radius:6px"></span>`
      + `${signed ? '<span style="position:absolute;left:50%;width:1px;height:100%;background:#fff"></span>' : ''}</span>`
      + `<span>${signed ? (value > 0 ? '左 ' : value < 0 ? '右 ' : '') : ''}${pct}%</span></div>`;
  };

  function render() {
    if (!panel) return;
    wizardStep();
    const sims = pads();
    const input = read();
    const roles = guess();
    const describe = (role) => (role ? `${short(role.id)} の軸 ${role.axis}` : '未設定');
    panel.querySelector('[data-devices]').innerHTML = sims.length
      ? sims.map((p) => `・${short(p.id)}　<small>${p.axes.map((v, i) => `${i}:${v.toFixed(2)}`).join(' ')}</small>`).join('<br>')
      : '（見つかりません。ハンドルを少し回すか、ペダルを踏んでください）';
    panel.querySelector('[data-map]').textContent = `ハンドル：${describe(roles.steer)}　アクセル：${describe(roles.throttle)}　ブレーキ：${describe(roles.brake)}`;
    panel.querySelector('[data-bars]').innerHTML = input
      ? bar('ハンドル', input.steer, true) + bar('アクセル', input.throttle) + bar('ブレーキ', input.brake)
        + `<small>ハンドルの角度 ${input.angle.toFixed(0)}°</small>`
      : '';
    const stepEl = panel.querySelector('[data-step]');
    stepEl.textContent = wizard ? STEPS[wizard.step] : '';
    panel.querySelector('[data-next]').style.display = wizard?.step === 'center' || wizard?.step === 'steer' ? '' : 'none';
    loop = requestAnimationFrame(render);
  }

  const short = (id) => id.replace(/\s*\(.*?Vendor:.*?\)\s*/i, '').slice(0, 48);

  function openPanel() {
    if (panel) { closePanel(); return; }
    panel = document.createElement('div');
    panel.id = 'wheel-panel';
    panel.style.cssText = 'position:fixed;left:16px;bottom:16px;max-width:640px;padding:14px 16px;'
      + 'background:rgba(16,20,28,0.94);color:#eef;font:14px/1.6 sans-serif;border-radius:10px;z-index:20';
    panel.innerHTML = `
      <b>ハンコンの設定</b>（H キーで閉じる）<br>
      <span data-devices></span><br>
      <span data-map></span>
      <div data-bars style="margin:6px 0"></div>
      <b data-step style="color:#ffd28a"></b>
      <button data-next>次へ</button><br>
      <button data-wizard>キャリブレーションを始める</button>
      <button data-reset>設定を消す</button><br>
      ハンドルいっぱいまでの角度（中央から）：<input data-full type="number" min="20" max="540" step="10" style="width:5em">°
      　ハンコン全体の回転角：<input data-lock type="number" min="180" max="2520" step="10" style="width:5em">°
      <div data-ffb></div>`;
    document.body.appendChild(panel);
    panel.querySelector('[data-full]').value = config.fullDegrees;
    panel.querySelector('[data-lock]').value = config.lockDegrees;
    panel.addEventListener('click', (event) => {
      if (event.target.hasAttribute?.('data-wizard')) startWizard();
      if (event.target.hasAttribute?.('data-next')) wizardNext();
      if (event.target.hasAttribute?.('data-reset')) { config = { ...DEFAULT }; save(config); firstAxes.clear(); wizard = null; }
    });
    panel.addEventListener('change', (event) => {
      if (event.target.hasAttribute('data-full')) config.fullDegrees = clamp(Number(event.target.value) || 90, 20, 540);
      if (event.target.hasAttribute('data-lock')) config.lockDegrees = clamp(Number(event.target.value) || 900, 180, 2520);
      save(config);
    });
    // 入力欄で打ったキーで、歩いたり運転したりしないように
    panel.addEventListener('keydown', (event) => event.stopPropagation());
    onPanel?.(panel);
    render();
  }

  function closePanel() {
    cancelAnimationFrame(loop);
    panel?.remove();
    panel = null;
    wizard = null;
  }

  let onPanel = null;
  return {
    read,
    openPanel,
    closePanel,
    /** 検証用：キャリブレーションを進める */
    startCalibration() { startWizard(); },
    calibrationNext() { wizardNext(); },
    calibrationTick() { wizardStep(); return wizard?.step ?? null; },
    get config() { return { ...config, ...guess() }; },
    /** 設定の画面を開いたときに呼ぶ（FFB の欄を足すのに使う） */
    set onPanel(fn) { onPanel = fn; },
  };
}
