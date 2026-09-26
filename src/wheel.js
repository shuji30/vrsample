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
 *   - 役割ごとに「どの機器の、どの軸か」を手で選ぶこともできる（割り当て）。ペダルは
 *     「離した値」「踏みきった値」をボタンで記録でき、アクセル・ブレーキだけを覚え直せる
 *   - Gamepad API に出てこないペダル（単体ペダルの一部）は、WebHID で直接つないで読む
 *     （設定の画面の「HID で直接つなぐ」）。つないだ機器は、ほかの機器と同じく軸の一覧に並ぶ
 *
 * Chrome は、機器を一度動かすまで Gamepad API に出さない。キャリブレーションの途中で
 * 現れた機器も拾えるよう、初めて見えたときの値を起点にする。
 *
 * ゲームパッド（Xbox など、mapping が 'standard'）は、左スティックでハンドル、RT で
 * アクセル、LT でブレーキ。
 */

import { looksLikeGamepad } from './gamepad.js';

const STORE = 'vrsample.wheel2';

const DEFAULT = {
  /** 役割ごとの { id（機器の名前）, axis, rest（離したときの値）, full（踏みきった / 左いっぱいの値） } */
  steer: null,
  throttle: null,
  brake: null,
  /** ハンドブレーキ（後輪だけのブレーキ）。レバー型の軸を割り当てる。ボタン型はボタンの割り当てで */
  handbrake: null,
  /** ハンコン全体の回転角（端から端、度）。G29 / T300 は 900、Fanatec / DD は 900〜1080 など */
  lockDegrees: 900,
  /** カートのハンドルがいっぱいになるまでに回す角度（中央から片側、度） */
  fullDegrees: 90,
};

function load() {
  let config;
  try { config = { ...DEFAULT, ...JSON.parse(localStorage.getItem(STORE) ?? '{}') }; } catch { return { ...DEFAULT }; }
  // 乗る / 降りるを一時 F にしていた。そのあいだに F へ割り当てたボタンは、E として使う
  if (config.buttons?.KeyF && !config.buttons.KeyE) {
    const { KeyF, ...rest } = config.buttons;
    config.buttons = { ...rest, KeyE: KeyF };
  }
  return config;
}
/** 最後に保存した時刻（設定の画面に出す）。保存できなかったときは -1 */
let lastSaved = 0;
function save(config) {
  try { localStorage.setItem(STORE, JSON.stringify(config)); lastSaved = Date.now(); } catch { lastSaved = -1; }
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const HID_STORE = 'vrsample.wheelHid';
/** 名前から、ハンドブレーキ・ハンコンらしい機器を見分ける（設定していないときの推し量りに使う） */
const HANDBRAKE_NAME = /hand ?brake|handbrake|e-?brake|サイドブレーキ/i;
const WHEEL_NAME = /wheel|ddwb|cammus|g29|g27|g25|g923|driving force|t300|t-gt|t248|t150|tmx|fanatec|csl|clubsport|podium|moza|simucube|simagic|asetek|thrustmaster|logitech g/i;
/**
 * VR のコントローラー。ブラウザによっては Gamepad API にも出てくる（Pimax P2N など）。
 * ハンコンの候補に並ぶと紛らわしく、ハンドルに選ばれてしまうこともあるので外す
 */
const VR_CONTROLLER = /pimax|oculus|meta quest|quest|touch controller|openvr|vive|valve|index controller|knuckles|windows mixed reality|spatial controller|hp reverb|pico|htc/i;

/**
 * WebHID でつないだ機器を、Gamepad のような形（id / axes / buttons）にする。
 *   軸 … 入力の報告の値の項目のうち、Generic Desktop（X / Y / Z / Rx … 0x30〜0x38）と
 *        Simulation Controls（アクセル・ブレーキ・ハンドルなど、page 0x02）のもの。-1..1 に並べる。
 *        ほかの項目（FFB の状態 page 0x0F やメーカー独自の page 0xFF00〜）まで軸にすると、
 *        CAMMUS DDWB では軸が 13 本になり、どれがハンドルか分かりにくかった。
 *        当てはまる項目が 1 つも無い機器（ペダルの一部）は、8 ビット以上の値の項目をすべて軸にする
 *   ボタン … Button（page 0x09）の 1 ビットの項目。ボタンの番号の順に並べる
 *        （以前は軸しか読まず、HID でつないだハンコンのボタンが効かなかった）
 */
function createHidPad(device) {
  const axesAll = [];      // { reportId, offset, size, min, max, signed, page }
  const buttonBits = [];   // { reportId, offset, number }
  const walk = (collections) => {
    for (const c of collections ?? []) {
      for (const r of c.inputReports ?? []) {
        let offset = 0;
        for (const item of r.items ?? []) {
          const usages = item.usages?.length ? item.usages
            : item.usageMinimum !== undefined ? Array.from({ length: Math.max(0, (item.usageMaximum ?? item.usageMinimum) - item.usageMinimum + 1) }, (_, i) => item.usageMinimum + i) : [];
          for (let k = 0; k < item.reportCount; k++) {
            const usage = usages[Math.min(k, usages.length - 1)] ?? 0;
            const page = usage >>> 16;
            const id = usage & 0xffff;
            if (!item.isArray && !item.isConstant) {
              if (page === 0x09 && item.reportSize === 1) {
                buttonBits.push({ reportId: r.reportId ?? 0, offset, number: id });
              } else if (item.reportSize >= 8 && item.logicalMaximum > item.logicalMinimum) {
                axesAll.push({ reportId: r.reportId ?? 0, offset, size: item.reportSize, min: item.logicalMinimum, max: item.logicalMaximum, signed: item.logicalMinimum < 0, page, id });
              }
            }
            offset += item.reportSize;
          }
        }
      }
      walk(c.children);
    }
  };
  walk(device.collections);
  const wanted = axesAll.filter((a) => (a.page === 0x01 && a.id >= 0x30 && a.id <= 0x38) || a.page === 0x02);
  const layout = wanted.length ? wanted : axesAll.filter((a) => a.page !== 0x0f && a.page < 0xff00);
  buttonBits.sort((a, b) => a.number - b.number);
  const name = `${device.productName || 'HID'} (HID Vendor: ${device.vendorId.toString(16).padStart(4, '0')} Product: ${device.productId.toString(16).padStart(4, '0')})`;
  const pad = {
    id: name, index: -1, connected: true, mapping: '', hid: true, seen: false,
    axes: layout.map(() => 0),
    buttons: buttonBits.map(() => ({ pressed: false, touched: false, value: 0 })),
  };
  const readBits = (data, offset, size) => {
    let v = 0;
    for (let b = 0; b < size; b++) {
      const bit = offset + b;
      if ((data[bit >> 3] ?? 0) & (1 << (bit & 7))) v += 2 ** b;
    }
    return v;
  };
  device.addEventListener('inputreport', (event) => {
    const data = new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength);
    layout.forEach((a, i) => {
      if (a.reportId !== event.reportId) return;
      let v = readBits(data, a.offset, a.size);
      if (a.signed && v >= 2 ** (a.size - 1)) v -= 2 ** a.size;
      pad.axes[i] = clamp(((v - a.min) / (a.max - a.min)) * 2 - 1, -1, 1);
    });
    buttonBits.forEach((b, i) => {
      if (b.reportId !== event.reportId) return;
      const on = readBits(data, b.offset, 1) === 1;
      pad.buttons[i] = { pressed: on, touched: on, value: on ? 1 : 0 };
    });
    pad.seen = true;
  });
  return pad;
}

export function createWheelInput() {
  let config = load();
  /** 機器ごとの、最初に見たときの軸の値（ペダルの軸を見分けるのに使う） */
  const firstAxes = new Map();

  /** WebHID でつないだ機器（Gamepad API に出てこないペダルなど） */
  const hidPads = [];
  let hidStatus = '';
  const hidSupported = typeof navigator !== 'undefined' && 'hid' in navigator;

  function pads() {
    const list = typeof navigator !== 'undefined' && navigator.getGamepads
      ? [...navigator.getGamepads()].filter((p) => p && p.connected && p.axes.length > 0 && !VR_CONTROLLER.test(p.id)) : [];
    return list.concat(hidPads.filter((p) => p.seen && p.axes.length > 0));
  }

  async function openHid(device) {
    if (hidPads.some((p) => p.device === device)) return;
    if (!device.opened) await device.open();
    const pad = createHidPad(device);
    pad.device = device;
    // 同じ機器の、軸もボタンも無い口（インターフェース）は並べない
    if (pad.axes.length === 0 && pad.buttons.length === 0) return;
    hidPads.push(pad);
    hidStatus = `${device.productName || 'HID の機器'} をつなぎました（軸 ${pad.axes.length} 本・ボタン ${pad.buttons.length} 個）。動かすと一覧に出ます`;
  }
  /** HID で直接つなぐ（ボタンを押したときに呼ぶ） */
  async function connectHid() {
    if (!hidSupported) { hidStatus = 'このブラウザは WebHID に対応していません（Chrome / Edge で開いてください）'; return; }
    try {
      // 絞り込まずに、すべての HID の機器から選べるようにする（ペダルの記述子は機種ごとに
      // ばらばらで、ジョイスティックとして名のらないものもある）
      const picked = await navigator.hid.requestDevice({ filters: [] });
      for (const d of picked) {
        await openHid(d);
        try {
          const saved = JSON.parse(localStorage.getItem(HID_STORE) ?? '[]');
          const key = `${d.vendorId}:${d.productId}`;
          if (!saved.includes(key)) localStorage.setItem(HID_STORE, JSON.stringify([...saved, key]));
        } catch { /* 次は選び直し */ }
      }
    } catch (error) {
      hidStatus = `HID でつなげませんでした（${error?.message ?? error}）`;
    }
  }
  /** 前に許可した HID の機器を、ページを開いたときにつなぎ直す */
  (async () => {
    if (!hidSupported) return;
    try {
      const saved = JSON.parse(localStorage.getItem(HID_STORE) ?? '[]');
      if (!saved.length) return;
      for (const d of await navigator.hid.getDevices()) {
        if (saved.includes(`${d.vendorId}:${d.productId}`)) await openHid(d).catch(() => {});
      }
    } catch { /* ボタンから */ }
  })();
  /** ゲームパッドでない入力機器（ハンコン・ペダル・シフターなど） */
  // 'standard' でなくても、名前がゲームパッドらしい機器はハンコンとして扱わない
  // （そうしないと、パッドがハンドルに選ばれてしまう）
  const isSimDevice = (pad) => pad.mapping !== 'standard' && !looksLikeGamepad(pad);
  const byId = (id) => pads().find((p) => p.id === id) ?? null;

  /** 設定していない役割を、つながっている機器から推し量る */
  function guess() {
    const sims = pads().filter(isSimDevice);
    for (const pad of sims) if (!firstAxes.has(pad.id)) firstAxes.set(pad.id, pad.axes.slice());
    const roles = { steer: config.steer, throttle: config.throttle, brake: config.brake, handbrake: config.handbrake ?? null };
    // ハンドブレーキ・シフター・単体のペダルは、ハンドルに選ばない。名前がハンコンらしい機器を先に
    const notWheel = (p) => HANDBRAKE_NAME.test(p.id) || /shifter|pedal/i.test(p.id);
    if (!roles.steer) {
      // ハンドルは、名前がハンコンらしい機器 → 軸が 3 つ以上ある機器 → 最初の機器、の軸 0
      const candidates = sims.filter((p) => !notWheel(p));
      const wheel = candidates.find((p) => WHEEL_NAME.test(p.id)) ?? candidates.find((p) => p.axes.length >= 3) ?? candidates[0];
      if (wheel) roles.steer = { id: wheel.id, axis: 0, rest: 0, full: -1 };
    }
    if (!roles.handbrake) {
      // 名前がハンドブレーキの機器の、離したとき端（±1）にある軸
      const hb = sims.find((p) => HANDBRAKE_NAME.test(p.id));
      const rest = hb && firstAxes.get(hb.id);
      const axis = rest ? rest.findIndex((v) => Math.abs(Math.abs(v) - 1) < 0.05) : -1;
      if (axis >= 0) roles.handbrake = { id: hb.id, axis, rest: Math.sign(rest[axis]), full: -Math.sign(rest[axis]) };
    }
    if (!roles.throttle || !roles.brake) {
      const pedals = [];
      for (const pad of sims) {
        if (HANDBRAKE_NAME.test(pad.id)) continue;
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
        handbrake: pedalValue(roles.handbrake),
        kind: 'wheel',
        angle,
        id: roles.steer.id,
        pad: byId(roles.steer.id),
      };
    }
    return readPad();
  }

  /** ゲームパッド（左スティック・RT・LT）の入力。触っていなければ null */
  function readPad() {
    for (const pad of pads()) {
      if (!looksLikeGamepad(pad)) continue;
      const x = pad.axes[0] ?? 0;
      const steer = Math.abs(x) < 0.12 ? 0 : -x;
      // 'standard' は RT / LT。そうでないパッドは並びが機器しだいなので A / B で
      const standard = pad.mapping === 'standard';
      const throttle = (standard ? pad.buttons[7]?.value : pad.buttons[0]?.value) ?? 0;
      const brake = (standard ? pad.buttons[6]?.value : pad.buttons[1]?.value) ?? 0;
      // ハンドブレーキ：'standard' は B
      const handbrake = standard ? pad.buttons[1]?.value ?? 0 : 0;
      // シフト（GT3）：'standard' は RB で上げる、LB で下げる
      const shiftUp = standard && Boolean(pad.buttons[5]?.pressed);
      const shiftDown = standard && Boolean(pad.buttons[4]?.pressed);
      if (Math.abs(steer) > 0 || throttle > 0.02 || brake > 0.02 || pad.buttons.some((b) => b.pressed)) {
        return { steer, throttle, brake, handbrake, shiftUp, shiftDown, kind: 'pad', angle: steer * 90, id: pad.id, pad };
      }
    }
    return null;
  }

  // --- ハンコンのボタン ------------------------------------------------------------
  // ハンコンのボタンを、キー（E 乗る / 降りる、C 視点、H 設定、Q AT / MT）に割り当てる。
  // 設定の画面で「覚える」を押してから、使いたいボタンを押す。
  // シフトアップ / ダウン（GT3 のパドル）も割り当てられる。Logitech（G29 / G920 / G923）は、はじめから
  // 右のパドル（ボタン 4）がアップ、左のパドル（ボタン 5）がダウン
  const BUTTON_ACTIONS = [['KeyE', 'e', '乗る / 降りる'], ['KeyC', 'c', '視点'], ['KeyH', 'h', '設定の画面'], ['Space', ' ', 'ハンドブレーキ'], ['KeyX', 'x', 'シフトアップ'], ['KeyZ', 'z', 'シフトダウン'], ['KeyQ', 'q', 'AT / MT 切り替え']];
  const PADDLE_GUESS = /G29|G920|G923|Logitech/i;
  let learning = null;           // 覚えているキー（code）
  const lastPressed = new Map(); // `${id}#${index}` → 押されていたか
  const fireKey = (type, code, key) => window.dispatchEvent(new KeyboardEvent(type, { code, key, bubbles: true }));
  function pollButtons() {
    const buttons = config.buttons ?? {};
    for (const pad of pads().filter(isSimDevice)) {
      (pad.buttons ?? []).forEach((b, index) => {
        const key = `${pad.id}#${index}`;
        const down = Boolean(b?.pressed);
        const was = Boolean(lastPressed.get(key));
        if (down === was) return;
        lastPressed.set(key, down);
        if (learning && down) {
          config.buttons = { ...buttons, [learning]: { id: pad.id, index } };
          save(config);
          learning = null;
          return;
        }
        for (const [code, name] of BUTTON_ACTIONS) {
          let m = buttons[code];
          // パドルの割り当てが無ければ、Logitech のパドルの並びで
          if (!m && PADDLE_GUESS.test(pad.id) && (code === 'KeyX' || code === 'KeyZ')) m = { id: pad.id, index: code === 'KeyX' ? 4 : 5 };
          if (m && m.id === pad.id && m.index === index) fireKey(down ? 'keydown' : 'keyup', code, name);
        }
      });
    }
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
    handbrake: 'ハンドブレーキをいっぱいに引いて、戻してください',
    brake: 'ブレーキをいっぱいに踏んで、離してください',
    done: 'キャリブレーションが終わりました。下のバーで、ハンドル・アクセル・ブレーキが動くか確かめてください',
  };

  const same = (a, b) => a && b && a.id === b.id && a.axis === b.axis;

  /** 覚えはじめからいちばん大きく動いた軸（除く軸は選ばない）。動いた量・いちばん端の値も */
  function biggestMove(exclude = []) {
    let best = null;
    for (const pad of pads().filter(isSimDevice)) {
      // 途中で現れた機器（Chrome は動かすまで出さない）は、初めて見えた値を起点にする
      if (!wizard.center.has(pad.id)) wizard.center.set(pad.id, pad.axes.slice());
      const center = wizard.center.get(pad.id);
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
    } else if (PEDAL_ROLES.includes(wizard.step)) {
      // ほかの役割に割り当て済みの軸は選ばない（順に覚えるときは、先に覚えたものだけ）
      const others = wizard.only ? PEDAL_ROLES.filter((r) => r !== wizard.step).map((r) => config[r])
        : wizard.step === 'brake' ? [config.throttle] : [];
      const exclude = [config.steer, ...others].filter(Boolean);
      const t = pedalMove(exclude);
      if (t) {
        config[wizard.step] = { id: t.id, axis: t.axis, rest: t.now, full: t.full };
        save(config);
        wizard.track.clear();
        wizard.step = wizard.only || wizard.step === 'brake' ? 'done' : 'brake';
      }
    }
  }

  /**
   * ペダルを踏んで離した軸を探す。初めて見えた値から最初に動いた向きの端を「踏みきった値」、
   * そこから戻って止まった値を「離した値」とする。Chrome はペダルを動かすまで機器を
   * 出さないので、初めて見えたのが踏んでいる途中でも決められるように、離した値は
   * 最初の値ではなく、戻って止まった値で取る。
   */
  function pedalMove(exclude) {
    let best = null;
    for (const pad of pads().filter(isSimDevice)) {
      pad.axes.forEach((v, i) => {
        if (exclude.some((e) => same(e, { id: pad.id, axis: i }))) return;
        const key = `${pad.id}#${i}`;
        const t = wizard.track.get(key) ?? { id: pad.id, axis: i, first: v, full: v, dir: 0, last: v, still: 0 };
        if (!t.dir && Math.abs(v - t.first) > 0.08) t.dir = Math.sign(v - t.first);
        if (t.dir && (v - t.full) * t.dir > 0) t.full = v;
        // 止まっているフレームを数える（画面の 1 フレームごとに呼ばれる。15 で約 0.25 秒）
        t.still = Math.abs(v - t.last) > 0.01 ? 0 : t.still + 1;
        t.last = v;
        t.now = v;
        wizard.track.set(key, t);
        const back = (t.full - v) * t.dir;   // 踏みきった端から、どれだけ戻ったか
        if (t.dir && back > 0.3 && t.still >= 15 && (!best || back > (best.full - best.now) * best.dir)) best = t;
      });
    }
    return best;
  }

  function finishSteer(t) {
    config.steer = { id: t.id, axis: t.axis, rest: t.rest, full: t.rest + (t.first || -1) };
    save(config);
    wizard.track.clear();
    wizard.step = 'throttle';
  }

  function startWizard(only = null) {
    wizard = { step: only ?? 'center', only: Boolean(only), center: new Map(), track: new Map() };
  }

  // --- 手で割り当てる -----------------------------------------------------------
  const ROLE_NAMES = { steer: 'ハンドル', throttle: 'アクセル', brake: 'ブレーキ', handbrake: 'ハンドブレーキ' };
  const PEDAL_ROLES = ['throttle', 'brake', 'handbrake'];
  /** 役割に、機器の軸を割り当てる（値は今の値を「離した / 真ん中」として取る） */
  function assign(role, id, axis) {
    if (!id) { config[role] = null; save(config); return; }
    const pad = byId(id);
    const v = pad?.axes[axis] ?? 0;
    if (role === 'steer') config.steer = { id, axis, rest: v, full: v - 1 };
    else {
      // 踏みきった値は、離した値の反対の端と仮に決める（「踏みきった値を記録」で直せる）
      const full = Math.abs(v) > 0.5 ? -Math.sign(v) : 1;
      config[role] = { id, axis, rest: v, full };
    }
    save(config);
  }
  /** 今の値を、ペダルの離した値（'rest'）か踏みきった値（'full'）として記録する */
  function record(role, which) {
    const current = guess()[role];
    if (!current) return;
    const v = axisValue(current);
    if (v === null) return;
    config[role] = { ...current, [which]: v };
    save(config);
  }
  /** 向きを逆にする（ハンドルは左右、ペダルは離した値と踏みきった値の入れ替え） */
  function flip(role) {
    const current = guess()[role];
    if (!current) return;
    config[role] = role === 'steer'
      ? { ...current, full: current.rest - (current.full - current.rest) }
      : { ...current, rest: current.full, full: current.rest };
    save(config);
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
    // 軸の一覧。いま動いている軸（最近 1 秒で 0.05 以上動いた）を黄色で目立たせる
    const nowMs = performance.now();
    panel.querySelector('[data-devices]').innerHTML = sims.length
      ? sims.map((p) => `・${short(p.id)}${p.hid ? '（HID）' : p.mapping === 'standard' ? '（ゲームパッド）' : ''}　<small>${p.axes.map((v, i) => {
        const key = `${p.id}#${i}`;
        const seen = axisSeen.get(key) ?? { v, at: 0 };
        if (Math.abs(v - seen.v) > 0.05) { seen.v = v; seen.at = nowMs; }
        axisSeen.set(key, seen);
        const moving = nowMs - seen.at < 1000;
        return `<span style="${moving ? 'color:#ffd84a;font-weight:bold' : ''}">${i}:${v.toFixed(2)}</span>`;
      }).join(' ')}</small>`).join('<br>')
      : '（見つかりません。ハンドルを少し回すか、ペダルを踏んでください）';
    panel.querySelector('[data-map]').textContent = `ハンドル：${describe(roles.steer)}　アクセル：${describe(roles.throttle)}　ブレーキ：${describe(roles.brake)}`
      + `　ハンドブレーキ：${describe(roles.handbrake)}`;
    panel.querySelector('[data-bars]').innerHTML = input
      ? bar('ハンドル', input.steer, true) + bar('アクセル', input.throttle) + bar('ブレーキ', input.brake)
        + bar('サイド', input.handbrake ?? 0)
        + `<small>ハンドルの角度 ${input.angle.toFixed(0)}°</small>`
      : '';
    // 割り当ての選択肢（機器や軸が増えたときだけ作り直す）
    const optionsKey = sims.map((p) => `${p.id}#${p.axes.length}`).join('|');
    if (optionsKey !== panel.dataset.options) {
      panel.dataset.options = optionsKey;
      for (const sel of panel.querySelectorAll('[data-assign]')) {
        const opts = ['<option value="">自動 / 未設定</option>'];
        for (const p of sims) p.axes.forEach((_, i) => opts.push(`<option value="${encodeURIComponent(p.id)}#${i}">${short(p.id)} の軸 ${i}</option>`));
        sel.innerHTML = opts.join('');
      }
    }
    for (const sel of panel.querySelectorAll('[data-assign]')) {
      if (document.activeElement === sel) continue;
      const role = config[sel.dataset.assign];
      const want = role ? `${encodeURIComponent(role.id)}#${role.axis}` : '';
      if (sel.value !== want) sel.value = [...sel.options].some((o) => o.value === want) ? want : '';
    }
    panel.querySelector('[data-hidstatus]').textContent = hidStatus;
    panel.querySelector('[data-saved]').textContent = lastSaved < 0
      ? '設定をこのブラウザに保存できませんでした（プライベートウィンドウなど）'
      : `設定はこのブラウザに自動で保存されます${lastSaved ? `（${new Date(lastSaved).toLocaleTimeString()} に保存）` : ''}${importMessage ? `　${importMessage}` : ''}`;
    for (const el of panel.querySelectorAll('[data-btn]')) {
      const m = config.buttons?.[el.dataset.btn];
      el.textContent = learning === el.dataset.btn ? 'ボタンを押してください…' : m ? `${short(m.id)} のボタン ${m.index}` : '未設定';
    }
    const stepEl = panel.querySelector('[data-step]');
    stepEl.textContent = wizard ? STEPS[wizard.step] : '';
    panel.querySelector('[data-next]').style.display = wizard?.step === 'center' || wizard?.step === 'steer' ? '' : 'none';
    loop = requestAnimationFrame(render);
  }

  const short = (id) => id.replace(/\s*\(.*?Vendor:.*?\)\s*/i, '').slice(0, 48);

  const axisSeen = new Map();
  let importMessage = '';

  /**
   * 設定の書き出し・読み込み（JSON）。設定はふだんから、このブラウザ（localStorage）に
   * 自動で保存している。ブラウザを変えるときや、消えたときのための控え
   */
  function exportSettings() {
    let ffb = null;
    let hid = null;
    try { ffb = JSON.parse(localStorage.getItem('vrsample.ffb') ?? 'null'); } catch { /* 無し */ }
    try { hid = JSON.parse(localStorage.getItem(HID_STORE) ?? 'null'); } catch { /* 無し */ }
    return JSON.stringify({ vrsampleWheel: 1, wheel: config, ffb, hid }, null, 1);
  }
  function importSettings(text) {
    try {
      const data = JSON.parse(text);
      if (!data || data.vrsampleWheel !== 1 || typeof data.wheel !== 'object') return false;
      config = { ...DEFAULT, ...data.wheel };
      save(config);
      if (data.ffb) localStorage.setItem('vrsample.ffb', JSON.stringify(data.ffb));
      if (Array.isArray(data.hid)) localStorage.setItem(HID_STORE, JSON.stringify(data.hid));
      return true;
    } catch {
      return false;
    }
  }

  /** 入力機器の情報（うまく読めないときに送ってもらう） */
  function describeInputs() {
    const lines = [];
    const all = typeof navigator !== 'undefined' && navigator.getGamepads ? [...navigator.getGamepads()] : [];
    all.forEach((p, i) => {
      if (!p) { lines.push(`#${i}: (空き)`); return; }
      lines.push(`#${i}: ${p.id}  mapping=${p.mapping || '(なし)'}  connected=${p.connected}`);
      lines.push(`   軸 ${p.axes.length}: ${p.axes.map((v, k) => `${k}:${v.toFixed(3)}`).join(' ')}`);
      lines.push(`   ボタン ${p.buttons.length}: 押している ${p.buttons.map((b, k) => (b.pressed || b.value > 0.05 ? `${k}(${b.value.toFixed(2)})` : null)).filter(Boolean).join(' ') || 'なし'}`);
    });
    for (const p of hidPads) lines.push(`HID: ${p.id}  軸 ${p.axes.length}: ${p.axes.map((v, k) => `${k}:${v.toFixed(3)}`).join(' ')}  受信 ${p.seen ? 'あり' : 'まだ'}`);
    const roles = guess();
    for (const role of ['steer', ...PEDAL_ROLES]) {
      const r = roles[role];
      lines.push(`${ROLE_NAMES[role]}: ${r ? `${r.id} 軸 ${r.axis} 離した ${r.rest?.toFixed?.(3)} 踏みきった ${r.full?.toFixed?.(3)} いま ${axisValue(r)?.toFixed?.(3) ?? '読めない'}${config[role] ? '' : '（自動）'}` : '未設定'}`);
    }
    return lines.join('\n');
  }

  function openPanel() {
    if (panel) { closePanel(); return; }
    panel = document.createElement('div');
    panel.id = 'wheel-panel';
    panel.style.cssText = 'position:fixed;left:16px;bottom:16px;max-width:640px;padding:14px 16px;'
      + 'background:rgba(16,20,28,0.94);color:#eef;font:14px/1.6 sans-serif;border-radius:10px;z-index:20;'
      + 'max-height:calc(100vh - 32px);overflow:auto';
    panel.innerHTML = `
      <b>ハンコンの設定</b>（H キーで閉じる）<br>
      <span data-devices></span><br>
      <span data-map></span>
      <div data-bars style="margin:6px 0"></div>
      <b data-step style="color:#ffd28a"></b>
      <button data-next>次へ</button><br>
      <button data-wizard>キャリブレーションを始める</button>
      <button data-only="throttle">アクセルだけ覚え直す</button>
      <button data-only="brake">ブレーキだけ覚え直す</button>
      <button data-only="handbrake">ハンドブレーキを覚える</button>
      <button data-reset>設定を消す</button>
      <div style="margin:6px 0">
        <b>割り当て</b>（機器と軸を選ぶ。ペダルは離した状態で選ぶ）<br>
        ${['steer', ...PEDAL_ROLES].map((role) => `<div>${ROLE_NAMES[role]}：<select data-assign="${role}" style="max-width:320px"></select>
          ${role === 'steer' ? '<button data-flip="steer">左右を反転</button>'
            : `<button data-record="${role}:rest">離した値を記録</button><button data-record="${role}:full">踏みきった値を記録</button><button data-flip="${role}">反転</button>`}</div>`).join('')}
        <b>ハンコンのボタン</b>（「覚える」を押してから、使いたいボタンを押す）<br>
        ${BUTTON_ACTIONS.map(([code, , label]) => `${label}：<span data-btn="${code}"></span> <button data-learn="${code}">覚える</button>`).join('　')}<br>
        <small>ペダルが一覧に出ないとき：一度踏んでみる。それでも出なければ</small>
        <button data-hid>HID で直接つなぐ</button> <small data-hidstatus></small><br>
        <button data-inputs>入力機器の情報を書き出す</button><br>
        <small data-saved></small>
        <button data-export>設定を書き出す</button> <button data-import>貼り付けた設定を読み込む</button>
        <textarea data-inputdump style="display:none;width:100%;height:9em;font:11px monospace"></textarea>
      </div>
      ハンドルいっぱいまでの角度（中央から）：<input data-full type="number" min="20" max="540" step="10" style="width:5em">°
      　ハンコン全体の回転角：<input data-lock type="number" min="180" max="2520" step="10" style="width:5em">°
      <div data-ffb></div>`;
    document.body.appendChild(panel);
    panel.querySelector('[data-full]').value = config.fullDegrees;
    panel.querySelector('[data-lock]').value = config.lockDegrees;
    panel.addEventListener('click', (event) => {
      const el = event.target;
      if (el.hasAttribute?.('data-wizard')) startWizard();
      if (el.dataset?.only) startWizard(el.dataset.only);
      if (el.dataset?.record) { const [role, which] = el.dataset.record.split(':'); record(role, which); }
      if (el.dataset?.flip) flip(el.dataset.flip);
      if (el.hasAttribute?.('data-hid')) connectHid();
      if (el.dataset?.learn) learning = el.dataset.learn;
      if (el.hasAttribute?.('data-export')) {
        const dump = panel.querySelector('[data-inputdump]');
        dump.value = exportSettings();
        dump.style.display = '';
        dump.select();
      }
      if (el.hasAttribute?.('data-import')) {
        const dump = panel.querySelector('[data-inputdump]');
        if (dump.style.display === 'none') {
          dump.value = '';
          dump.style.display = '';
          dump.placeholder = '書き出した設定をここに貼り付けて、もう一度「貼り付けた設定を読み込む」を押してください';
          dump.focus();
        } else {
          importMessage = importSettings(dump.value) ? '設定を読み込みました' : '読み込めませんでした（書き出した内容をそのまま貼り付けてください）';
        }
      }
      if (el.hasAttribute?.('data-inputs')) {
        const dump = panel.querySelector('[data-inputdump]');
        dump.value = describeInputs();
        dump.style.display = '';
        dump.select();
      }
      if (event.target.hasAttribute?.('data-next')) wizardNext();
      if (event.target.hasAttribute?.('data-reset')) { config = { ...DEFAULT }; save(config); firstAxes.clear(); wizard = null; }
    });
    panel.addEventListener('change', (event) => {
      if (event.target.dataset?.assign) {
        const [id, axis] = event.target.value ? event.target.value.split('#') : [null, 0];
        assign(event.target.dataset.assign, id ? decodeURIComponent(id) : null, Number(axis));
      }
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
    readPad,
    pollButtons,
    openPanel,
    closePanel,
    /** 検証用：キャリブレーションを進める */
    startCalibration() { startWizard(); },
    calibrationNext() { wizardNext(); },
    calibrationTick() { wizardStep(); return wizard?.step ?? null; },
    /** 検証用：割り当て・記録・反転・ペダルだけの覚え直し */
    assign(role, id, axis) { assign(role, id, axis); },
    record(role, which) { record(role, which); },
    flip(role) { flip(role); },
    recalibrate(role) { startWizard(role); },
    connectHid() { return connectHid(); },
    learnButton(code) { learning = code; },
    describeInputs() { return describeInputs(); },
    exportSettings() { return exportSettings(); },
    importSettings(text) { return importSettings(text); },
    get config() { return { ...config, ...guess() }; },
    /** 設定の画面を開いたときに呼ぶ（FFB の欄を足すのに使う） */
    set onPanel(fn) { onPanel = fn; },
  };
}
