/**
 * デバイスブリッジ（shuji30/vrgame2 の ffb-bridge/bridge.py）とのやりとり。
 *
 * ブリッジは PC で動く小さな常駐プログラムで、ws://127.0.0.1:18765 で待ち受ける。
 *   - FFB：ゲームが送った力（定数の力・ダンパー・スプリング・振動）を、SDL2 経由（Windows では DirectInput の FFB）で
 *     ハンコンへ出す。メーカーの PC 用ドライバーが入っていれば Fanatec / Thrustmaster / CAMMUS / Logitech / MOZA /
 *     Simagic など、どの FFB ハンコンでも同じように動く（WebHID で直接命令を送るより確か）
 *   - 入力の中継：すべてのジョイスティック（ホイールベース・ペダル・サイドブレーキ・シフター）の軸とボタンを送ってくる。
 *     ブラウザの Gamepad API は 4 台までしか扱えず、VR ヘッドセット（Pimax など）に枠を取られると、ハンコンや
 *     ペダルが見えなくなることがある
 *
 * やりとり（JSON）
 *   送る：{ t: 'hello', input: true } / { t: 'ffb', c, d, s, r, hz }（c は -1..1 で + が右へ回す力。0.25 秒来ないと
 *         ブリッジが力を 0 にする）/ { t: 'stop' } / { t: 'test', effect: 'left'|'right'|'rumble'|'center', gain } /
 *         { t: 'select', device }（FFB を出す機器を名前で選ぶ。開き直してエフェクトを作り直す）
 *   受ける：{ t: 'status', devices: [{ index, name, haptic, features }], selected, error } /
 *           { t: 'input', pads: [{ id（名前）, index, axes: [-1..1], buttons: [0|1] }] }
 *
 * ブリッジは許可した Origin（https://shuji30.github.io・http://localhost:8080 など）からの接続だけを受ける。
 * ほかの所で開くときは、ブリッジの origins.txt に URL を足す。
 * いつつなぎに行くか：一度でもつながったことがあれば、ページを開いたときから自動でつなぎ、切れても間をあけて
 * つなぎ直し続ける（あとから起動しても使える）。まだつながったことがなければ、乗り物に乗ったとき・ハンコンの設定の
 * 画面を開いたとき・VR で H を押したときに 1 回だけ試す（ブリッジを使わない人のブラウザに、つなげなかったという
 * エラーを出し続けないため。ブラウザは WebSocket がつながらないと、必ずコンソールにエラーを出す）。?bridge=off で使わない。
 */

const URL_DEFAULT = 'ws://127.0.0.1:18765';
const STORE = 'vrsample.bridge';

export function createFfbBridge({ url = URL_DEFAULT } = {}) {
  const off = typeof location !== 'undefined' && new URLSearchParams(location.search).get('bridge') === 'off';
  let ws = null;
  let retry = null;
  let wait = 3000;
  let rawPads = [];
  const latch = new Map();
  const status = { connected: false, devices: [], selected: null, error: null, tried: false };
  const listeners = new Set();
  let device = null;   // 使う FFB の機器（名前）。無ければブリッジが選ぶ
  let seen = false;    // 一度でもつながったことがあるか
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) ?? '{}');
    device = saved.device ?? null;
    seen = Boolean(saved.seen);
  } catch { /* 既定のまま */ }
  const store = () => { try { localStorage.setItem(STORE, JSON.stringify({ device, seen })); } catch { /* 覚えられなくても動く */ } };
  const emit = () => { for (const fn of listeners) fn(status); };

  function send(msg) {
    if (ws && ws.readyState === 1) { ws.send(JSON.stringify(msg)); return true; }
    return false;
  }

  function connect() {
    if (off || typeof WebSocket === 'undefined') return;
    clearTimeout(retry);
    if (ws) return;
    let sock;
    try { sock = new WebSocket(url); } catch (error) { status.error = String(error?.message ?? error); emit(); return; }
    ws = sock;
    status.tried = true;
    sock.onopen = () => {
      wait = 3000;
      if (!seen) { seen = true; store(); }
      status.connected = true;
      status.error = null;
      send({ t: 'hello', app: 'vrsample', v: 1, input: true });
      if (device) send({ t: 'select', device });
      emit();
    };
    sock.onmessage = (event) => {
      let m;
      try { m = JSON.parse(event.data); } catch { return; }
      if (m.t === 'input') {
        rawPads = Array.isArray(m.pads) ? m.pads : [];
        // 次に読まれるまでに一度でも押されたボタンを覚えておく（短い押下を取りこぼさない）
        for (const p of rawPads) {
          const key = `${p.index}:${p.id}`;
          const l = latch.get(key) ?? [];
          (p.buttons ?? []).forEach((v, i) => { if (v > 0.5) l[i] = 1; });
          latch.set(key, l);
        }
      } else if (m.t === 'status') {
        status.devices = Array.isArray(m.devices) ? m.devices : [];
        status.selected = m.selected ?? null;
        status.error = m.error ?? null;
        emit();
      }
    };
    sock.onclose = () => {
      if (ws === sock) ws = null;
      rawPads = [];
      const was = status.connected;
      status.connected = false;
      if (was) emit();
      // 一度でもつながったことがあれば、だんだん間をあけて（3 秒 → 最大 60 秒）つなぎ直す。乗り物に乗ったとき・
      // 設定の画面を開いたときは、すぐ試す（connectNow）
      if (!seen) return;
      retry = setTimeout(connect, wait);
      wait = Math.min(60000, wait * 2);
    };
    sock.onerror = () => {
      status.error = 'ブリッジに接続できません（ffb-bridge を起動してください）';
    };
  }

  /**
   * Gamepad API の Gamepad と同じ形にした、ブリッジ経由の入力機器（id は「SDL: 名前」）。
   * 1 フレームに何度も呼ばれるので、5ms のあいだは同じものを返す（押した印を消すのは作り直すときだけ）
   */
  let cached = [];
  let cachedAt = -1;
  function pads() {
    if (!ws || ws.readyState !== 1) return [];
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - cachedAt < 5) return cached;
    cachedAt = now;
    cached = rawPads.map((p) => {
      const l = latch.get(`${p.index}:${p.id}`) ?? [];
      return {
        id: `SDL: ${p.id}`,
        index: 1000 + (p.index ?? 0),
        mapping: '',
        connected: true,
        bridge: true,
        axes: (p.axes ?? []).map(Number),
        buttons: (p.buttons ?? []).map((v, i) => {
          const value = Math.max(Number(v) || 0, l[i] || 0);
          return { pressed: value > 0.5, value, touched: value > 0.5 };
        }),
      };
    });
    latch.clear();
    return cached;
  }

  if (seen) connect();

  return {
    /** すぐつなぎ直す（乗り物に乗ったとき・設定の画面を開いたとき・VR で H を押したとき）。つながっていれば、FFB の機器を開き直す */
    connectNow() {
      if (ws && ws.readyState === 1) { send({ t: 'select', device }); return; }
      if (!ws) { wait = 3000; connect(); }
    },
    pads,
    /** 力を送る（c は -1..1、+ が右へ回す力。d・s・r は 0..1、hz は振動の周波数） */
    ffb(f) {
      return send({ t: 'ffb', c: round(f.c), d: round(f.d), s: round(f.s), r: round(f.r), hz: Math.round(f.hz || 0) });
    },
    stop() { send({ t: 'stop' }); },
    test(effect, gain = 0.5) { send({ t: 'test', effect, gain }); },
    select(name) {
      device = name || null;
      store();
      send({ t: 'select', device });
    },
    onStatus(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    get status() { return status; },
    get connected() { return status.connected; },
    /** FFB を出せる（ブリッジにつながっていて、FFB の機器を開けている） */
    get ffbReady() { return status.connected && Boolean(status.selected); },
    get device() { return device; },
    get disabled() { return off; },
    /** 一度でもつながったことがあるか */
    get seen() { return seen; },
    url,
  };
}

const round = (v) => Math.round((Number(v) || 0) * 1000) / 1000;
