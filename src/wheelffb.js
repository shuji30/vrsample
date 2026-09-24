/**
 * ハンコンの FFB（フォースフィードバック）。
 *
 * ブラウザの Gamepad API では振動（ランブル）しか送れないので、Chrome / Edge の
 * WebHID でハンコンへ直接命令を送る。命令の形はメーカーごとに違うので、2 つ用意した。
 *
 *   lg4ff … Logitech（G29 / G27 / G25 / Driving Force GT / Pro）。Linux の hid-lg4ff
 *           ドライバで知られている命令。G920 / G923 の Xbox 版は別の形（HID++）で動かない
 *   pid   … HID の標準の FFB（Physical Interface Device）。DirectInput の FFB を標準の
 *           しくみで受ける機器（CAMMUS などのダイレクトドライブ）。機器が教えてくれる
 *           報告の形（どのビットに何を書くか）を読んで、定数の力の効果を 1 つ作って流し続ける。
 *           Thrustmaster（T300 / T-GT）と Fanatec は、Windows ではメーカーのドライバが
 *           FFB を受け持っていて、機器そのものがこの形を受けるかは分からない。まずこれで試す
 *
 * WebHID はユーザーが機器を選ぶ操作（ボタンを押す）が要る。ハンコンの設定の画面
 * （H キー）の「FFB を有効にする」から選ぶ。一度許可すれば、次からは自動でつなぐ。
 * 動かないときは「機器の情報を書き出す」で、報告の形を書き出せる（直すのに使う）。
 *
 * 出す力（-1〜1、左が +）：センタリング（速いほど重い）・ダンパー・縁石のガタガタ・
 * 芝生のざらつき・衝突の反動。G27 / G29 は回転計の LED も光らせる。
 *
 * この環境には実機が無く、どの機種でも動作は確かめられていない。
 */

const LOGITECH = 0x046d;
const LG4FF = new Map([
  [0xc24f, 'G29'], [0xc266, 'G923 (PS)'], [0xc267, 'G923 (PS)'], [0xc29b, 'G27'], [0xc299, 'G25'],
  [0xc29a, 'Driving Force GT'], [0xc298, 'Driving Force Pro'], [0xc294, 'Driving Force / 互換モード'],
]);
const STORE = 'vrsample.ffb';
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// --- HID PID（usage page 0x0F） ------------------------------------------------
const PID = 0x0f;
const U = (usage) => (PID << 16) | usage;
const USAGE = {
  setEffect: 0x21, blockIndex: 0x22, effectType: 0x25, constantForce: 0x26,
  duration: 0x50, samplePeriod: 0x51, gain: 0x52, triggerButton: 0x53, axesEnable: 0x55,
  directionEnable: 0x56, direction: 0x57, startDelay: 0xa7,
  setConstant: 0x73, magnitude: 0x70,
  effectOperation: 0x77, operation: 0x78, opStart: 0x79, opStartSolo: 0x7a, opStop: 0x7b, loopCount: 0x7c,
  deviceControl: 0x96, enableActuators: 0x97, stopAll: 0x99, reset: 0x9a,
  deviceGain: 0x7e, createNewEffect: 0xab, byteCount: 0x59, blockLoadStatus: 0x8b, blockLoadSuccess: 0x8c,
};

/** 報告の項目の「使い道」（拡張 usage）の一覧。usageMinimum..Maximum の範囲も広げる */
function itemUsages(item) {
  if (item.usages?.length) return item.usages;
  if (item.usageMinimum !== undefined && item.usageMaximum !== undefined) {
    const list = [];
    for (let u = item.usageMinimum; u <= item.usageMaximum && list.length < 64; u++) list.push(u);
    return list;
  }
  return [];
}

/** すべての報告を集める（コレクションの木を下りながら） */
function allReports(device) {
  const out = [];
  const walk = (collections) => {
    for (const c of collections ?? []) {
      for (const kind of ['outputReports', 'featureReports', 'inputReports']) {
        for (const r of c[kind] ?? []) out.push({ kind, report: r, collection: c });
      }
      walk(c.children);
    }
  };
  walk(device.collections);
  return out;
}

/** 使い道 usage を含む報告を探す（kind はしぼる種類） */
function findReport(reports, usage, kind) {
  return reports.find((r) => r.kind === kind && r.report.items?.some((it) => itemUsages(it).includes(U(usage))))
    ?? reports.find((r) => r.kind === kind && r.collection.usagePage === PID && r.collection.usage === usage)
    ?? null;
}

/**
 * 報告の中身を作る。values は 使い道 → 値。配列の項目（選ぶ種類）は、選ぶ使い道を
 * values に入れておく（値は無視して、その使い道の番号を書く）
 */
function packReport(report, values) {
  let bits = 0;
  for (const item of report.items) bits += item.reportSize * item.reportCount;
  const bytes = new Uint8Array(Math.ceil(bits / 8));
  let offset = 0;
  const write = (value, size) => {
    let v = BigInt.asUintN(size, BigInt(Math.round(value)));
    for (let b = 0; b < size; b++) {
      if (v & 1n) bytes[(offset + b) >> 3] |= 1 << ((offset + b) & 7);
      v >>= 1n;
    }
  };
  for (const item of report.items) {
    const usages = itemUsages(item);
    for (let k = 0; k < item.reportCount; k++) {
      let value = 0;
      if (item.isArray) {
        // 配列：選んだ使い道の番号（logicalMinimum から数える）
        const chosen = usages.findIndex((u) => values.has(u));
        value = chosen >= 0 ? (item.logicalMinimum ?? 0) + chosen : 0;
      } else {
        const u = usages[Math.min(k, usages.length - 1)];
        if (values.has(u)) {
          const want = values.get(u);
          // 「いっぱい」の指定は logicalMaximum へ
          // 'max' は logicalMaximum、'inf' はすべてのビットを 1（PID の「無限の長さ」）、
          // 'null' は範囲の外（押しボタンを割り当てない）
          value = want === 'max' ? item.logicalMaximum : want === 'inf' ? -1 : want === 'null' ? (item.logicalMaximum + 1) : want;
        }
      }
      write(value, item.reportSize);
      offset += item.reportSize;
    }
  }
  return bytes;
}

/** 報告の中身から、使い道 usage の値を読む */
function unpackReport(report, data, usage) {
  let offset = 0;
  const read = (size) => {
    let v = 0;
    for (let b = 0; b < size; b++) {
      const byte = data[(offset + b) >> 3] ?? 0;
      if (byte & (1 << ((offset + b) & 7))) v |= 1 << b;
    }
    return v;
  };
  for (const item of report.items) {
    const usages = itemUsages(item);
    for (let k = 0; k < item.reportCount; k++) {
      const v = read(item.reportSize);
      if (item.isArray) {
        if (usages[v - (item.logicalMinimum ?? 0)] === U(usage)) return v;
      } else if (usages[Math.min(k, usages.length - 1)] === U(usage)) return v;
      offset += item.reportSize;
    }
  }
  return null;
}

/** 力の大きさの項目（logical の範囲）を調べる。-1..1 をその範囲へ */
function magnitudeRange(report) {
  for (const item of report.items) {
    if (itemUsages(item).includes(U(USAGE.magnitude))) {
      let min = item.logicalMinimum;
      const max = item.logicalMaximum;
      // 符号なしで書かれている機器もある
      if (min >= 0) min = -max;
      return { min, max };
    }
  }
  return { min: -10000, max: 10000 };
}

function createPidDriver(device) {
  const reports = allReports(device);
  const setEffect = findReport(reports, USAGE.effectType, 'outputReports') ?? findReport(reports, USAGE.setEffect, 'outputReports');
  const setConstant = findReport(reports, USAGE.magnitude, 'outputReports');
  const operation = findReport(reports, USAGE.opStart, 'outputReports') ?? findReport(reports, USAGE.operation, 'outputReports');
  const control = findReport(reports, USAGE.enableActuators, 'outputReports') ?? findReport(reports, USAGE.deviceControl, 'outputReports');
  const gain = findReport(reports, USAGE.deviceGain, 'outputReports');
  const create = findReport(reports, USAGE.createNewEffect, 'featureReports') ?? findReport(reports, USAGE.byteCount, 'featureReports');
  const blockLoad = findReport(reports, USAGE.blockLoadStatus, 'featureReports');
  const ok = Boolean(setEffect && setConstant && operation);
  let block = 1;
  let restarted = performance.now();
  let range = setConstant ? magnitudeRange(setConstant.report) : { min: -10000, max: 10000 };

  const send = (entry, values) => device.sendReport(entry.report.reportId, packReport(entry.report, values));

  return {
    ok,
    missing: [['Set Effect', setEffect], ['Set Constant Force', setConstant], ['Effect Operation', operation]]
      .filter(([, r]) => !r).map(([n]) => n),
    async start() {
      if (control) {
        await send(control, new Map([[U(USAGE.reset), 1]]));
        await send(control, new Map([[U(USAGE.enableActuators), 1]]));
      }
      if (gain) await send(gain, new Map([[U(USAGE.deviceGain), 'max']]));
      // 効果の置き場所を借りる（無い機器もある。そのときは 1 番を使う）
      if (create) {
        await device.sendFeatureReport(create.report.reportId, packReport(create.report, new Map([
          [U(USAGE.constantForce), 1], [U(USAGE.byteCount), 0],
        ])));
        if (blockLoad) {
          const view = await device.receiveFeatureReport(blockLoad.report.reportId);
          const data = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
          // 先頭が報告の番号なら飛ばす
          const body = data[0] === blockLoad.report.reportId ? data.subarray(1) : data;
          block = unpackReport(blockLoad.report, body, USAGE.blockIndex) ?? 1;
        }
      }
      await send(setEffect, new Map([
        [U(USAGE.blockIndex), block], [U(USAGE.constantForce), 1], [U(USAGE.duration), 'inf'],
        [U(USAGE.samplePeriod), 0], [U(USAGE.gain), 'max'], [U(USAGE.triggerButton), 'null'],
        [U(USAGE.axesEnable), 1], [U(USAGE.directionEnable), 1], [U(USAGE.direction), 0], [U(USAGE.startDelay), 0],
      ]));
      await send(setConstant, new Map([[U(USAGE.blockIndex), block], [U(USAGE.magnitude), 0]]));
      await send(operation, new Map([[U(USAGE.blockIndex), block], [U(USAGE.opStart), 1], [U(USAGE.loopCount), 'max']]));
    },
    async force(f) {
      const m = f >= 0 ? f * range.max : -f * range.min;
      await send(setConstant, new Map([[U(USAGE.blockIndex), block], [U(USAGE.magnitude), Math.round(m)]]));
      // 長さの「無限」を受けない機器もあるので、10 秒ごとに効果を始め直す
      const now = performance.now();
      if (now - restarted > 10000) {
        restarted = now;
        await send(operation, new Map([[U(USAGE.blockIndex), block], [U(USAGE.opStart), 1], [U(USAGE.loopCount), 'max']]));
      }
    },
    async stop() {
      await send(setConstant, new Map([[U(USAGE.blockIndex), block], [U(USAGE.magnitude), 0]]));
      if (control) await send(control, new Map([[U(USAGE.stopAll), 1]]));
    },
  };
}

function createLg4ffDriver(device) {
  const send = (bytes) => device.sendReport(0x00, new Uint8Array(bytes));
  return {
    ok: true,
    missing: [],
    async start() {
      await send([0xf5, 0, 0, 0, 0, 0, 0]);                          // 本体の自動センタリングを切る
      await send([0xf8, 0x81, 540 & 0xff, 540 >> 8, 0, 0, 0]);       // 回転角 540°
    },
    async force(f) {
      const byte = clamp(Math.round(128 - f * 127), 0, 255);
      if (Math.abs(f) < 0.01) await send([0x13, 0, 0, 0, 0, 0, 0]);
      else await send([0x11, 0x08, byte, 0x80, 0, 0, 0]);
    },
    async leds(mask) { await send([0xf8, 0x12, mask, 0, 0, 0, 0]); },
    async stop() { await send([0x13, 0, 0, 0, 0, 0, 0]); },
  };
}

/** 機器の報告の形を、人が読める形に書き出す（うまく動かないときに、直すための情報） */
export function describeDevice(device) {
  const hex = (n) => `0x${(n >>> 0).toString(16)}`;
  const lines = [`${device.productName}  vendor ${hex(device.vendorId)}  product ${hex(device.productId)}`];
  const walk = (collections, depth) => {
    for (const c of collections ?? []) {
      lines.push(`${'  '.repeat(depth)}collection page ${hex(c.usagePage)} usage ${hex(c.usage)} type ${c.type}`);
      for (const kind of ['inputReports', 'outputReports', 'featureReports']) {
        for (const r of c[kind] ?? []) {
          const items = (r.items ?? []).map((it) => `${itemUsages(it).map(hex).join('/') || '-'}:${it.reportSize}x${it.reportCount}${it.isArray ? '[arr]' : ''}(${it.logicalMinimum}..${it.logicalMaximum})`);
          lines.push(`${'  '.repeat(depth + 1)}${kind} id ${r.reportId}: ${items.join(' ')}`);
        }
      }
      walk(c.children, depth + 1);
    }
  };
  walk(device.collections, 0);
  return lines.join('\n');
}

export function createWheelFFB() {
  let device = null;
  let driver = null;
  let model = null;
  let status = '';
  let lastForce = null;
  let lastLeds = -1;
  let lastSent = 0;
  let busy = false;
  let impulse = 0;
  let time = 0;
  let prevAngle = 0;
  let invert = false;
  let strength = 1;
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) ?? '{}');
    invert = Boolean(saved.invert);
    strength = clamp(Number(saved.strength ?? 1), 0, 1.5);
  } catch { /* 既定のまま */ }
  const store = () => { try { localStorage.setItem(STORE, JSON.stringify({ invert, strength })); } catch { /* 覚えられなくても動く */ } };

  const supported = typeof navigator !== 'undefined' && 'hid' in navigator;

  async function open(d) {
    device = d;
    if (!d.opened) await d.open();
    if (d.vendorId === LOGITECH && LG4FF.has(d.productId)) {
      model = LG4FF.get(d.productId);
      driver = createLg4ffDriver(d);
    } else {
      model = d.productName || `0x${d.vendorId.toString(16)}:0x${d.productId.toString(16)}`;
      driver = createPidDriver(d);
    }
    if (!driver.ok) {
      status = `FFB の報告が見つかりません（${driver.missing.join(', ')}）。「機器の情報を書き出す」の内容を送ってください`;
      return;
    }
    try {
      await driver.start();
      status = `${model}：FFB を送っています（${driver === null ? '' : d.vendorId === LOGITECH ? 'Logitech' : 'HID PID'}）`;
    } catch (error) {
      status = `${model}：FFB を始められませんでした（${error?.message ?? error}）`;
    }
    lastForce = null;
  }

  async function reconnect() {
    if (!supported) return false;
    try {
      const saved = localStorage.getItem(`${STORE}.device`);
      if (!saved) return false;
      const devices = await navigator.hid.getDevices();
      const d = devices.find((x) => `${x.vendorId}:${x.productId}` === saved);
      if (d) { await open(d); return true; }
    } catch { /* ボタンから */ }
    return false;
  }

  /** 機器を選んでつなぐ（ボタンを押したときに呼ぶ） */
  async function connect() {
    if (!supported) return false;
    try {
      const picked = await navigator.hid.requestDevice({
        filters: [
          { vendorId: LOGITECH },
          { usagePage: 0x01, usage: 0x04 },   // ジョイスティック（多くのハンコン）
          { usagePage: 0x01, usage: 0x05 },   // ゲームパッド
          { usagePage: PID },
        ],
      });
      const d = picked[0];
      if (!d) return false;
      try { localStorage.setItem(`${STORE}.device`, `${d.vendorId}:${d.productId}`); } catch { /* 次は選び直し */ }
      await open(d);
      return true;
    } catch (error) {
      status = `つなげませんでした（${error?.message ?? error}）`;
      return false;
    }
  }

  function sendForce(f) {
    if (busy || !driver?.ok) return;
    busy = true;
    driver.force(f).catch(() => {}).finally(() => { busy = false; });
  }

  /**
   * 毎フレーム呼ぶ。
   * @param {{ angle: number, fullDegrees: number, speed: number, maxSpeed: number,
   *   onCurb: boolean, onGrass: boolean, rpm: number, driving: boolean }} t
   *   angle はハンコンの角度（度、左が +）、rpm は 0..1
   */
  function update(dt, t) {
    time += dt;
    impulse *= Math.exp(-dt / 0.12);
    if (!device?.opened || !driver?.ok) return;
    let force = 0;
    if (t.driving) {
      const a = clamp(t.angle / Math.max(10, t.fullDegrees), -1.5, 1.5);
      const k = 0.2 + 0.6 * clamp(Math.abs(t.speed) / t.maxSpeed, 0, 1);
      const rate = (t.angle - prevAngle) / Math.max(1e-3, dt) / 360;
      force = -a * k - clamp(rate, -2, 2) * 0.08;
      if (t.onCurb) force += Math.sin(time * Math.PI * 2 * 18) * 0.2;
      if (t.onGrass) force += (Math.random() - 0.5) * 0.18 * clamp(Math.abs(t.speed) / 3, 0, 1);
      force += impulse;
    }
    prevAngle = t.angle;
    force = clamp(force * strength * (invert ? -1 : 1), -1, 1);
    const q = Math.round(force * 100);
    const now = performance.now();
    if (q !== lastForce && now - lastSent > 16) {
      lastForce = q;
      lastSent = now;
      sendForce(force);
    }
    const leds = t.driving ? [0, 1, 3, 7, 15, 31][Math.round(clamp(t.rpm, 0, 1) * 5)] : 0;
    if (driver.leds && leds !== lastLeds && (model === 'G29' || model === 'G27')) {
      lastLeds = leds;
      driver.leds(leds).catch(() => {});
    }
  }

  function bump(amount, direction = 1) {
    impulse += clamp(amount, 0, 1) * 0.7 * Math.sign(direction || 1);
  }

  function release() {
    lastForce = 0;
    driver?.stop?.().catch(() => {});
    if (driver?.leds) driver.leds(0).catch(() => {});
  }

  reconnect();

  return {
    supported,
    connect,
    update,
    bump,
    release,
    describe: () => (device ? describeDevice(device) : ''),
    get connected() { return Boolean(device?.opened); },
    get model() { return model; },
    get status() { return status; },
    get invert() { return invert; },
    set invert(v) { invert = Boolean(v); store(); },
    get strength() { return strength; },
    set strength(v) { strength = clamp(Number(v) || 0, 0, 1.5); store(); },
  };
}
