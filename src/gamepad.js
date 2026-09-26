/**
 * ゲームパッド（Xbox 配置、Gamepad API の mapping が 'standard'）で PC 版を遊ぶ。
 *
 *   左スティック … 歩く（LB を押しながらで速く）
 *   右スティック … 見回す
 *   A … 拾う / 投げる（F）      B … ラケットを置く（G）
 *   X … 乗り物に乗る / 降りる（E）  Y … 乗り物の視点（C）   十字キー上 … GT3 の AT / MT（Q）
 *   RB … ラケットを振る（押しているあいだ構える。スペース）
 *   View（Back）… BGM のオン / オフ（M）   Menu（Start）… ハンコンの設定（H）
 *   カートの運転は、左スティック・RT・LT（wheel.js が読む）
 *
 * ボタンはキーボードのキーを押したことにして、各所のキー操作をそのまま使う
 * （どの遊びでも操作が同じになる）。スティックは、歩きと見回しへ直接渡す。
 *
 * mapping が 'standard' でないゲームパッド（ブラウザや接続のしかたで、Xbox / PlayStation の
 * パッドでもそうなることがある）も、名前がゲームパッドらしければ使う。そのときの
 * ボタンの並びは DirectInput の多くのパッドの並び（A B X Y LB RB Back Start）とみる。
 * ハンコン・ペダル（それ以外の 'standard' でない機器）は、ここでは読まない。
 */

/** 名前からゲームパッドらしいか（ハンコン・ペダルと見分ける） */
const PAD_NAME = /xbox|xinput|gamepad|game ?pad|controller|dualshock|dualsense|wireless|joy-?con|8bitdo|pro controller|playstation|ps[345]/i;
const WHEEL_NAME = /wheel|pedal|racing|cammus|simjack|fanatec|thrustmaster|logitech g2|g29|g27|g923|moza|simucube|heusinkveld|simagic/i;
export function looksLikeGamepad(pad) {
  if (!pad) return false;
  if (pad.mapping === 'standard') return true;
  return PAD_NAME.test(pad.id) && !WHEEL_NAME.test(pad.id);
}

const BUTTON_KEYS = [
  [0, 'KeyF', 'f'],
  [1, 'KeyG', 'g'],
  [2, 'KeyE', 'e'],
  [3, 'KeyC', 'c'],
  [5, 'Space', ' '],
  [4, 'ShiftLeft', 'Shift'],
  [8, 'KeyM', 'm'],
  [9, 'KeyH', 'h'],
  [12, 'KeyQ', 'q'],     // 十字キーの上：GT3 の AT / MT
];
/** 'standard' でないパッドのボタンの並び（Back / Start が 6 / 7） */
const LOOSE_KEYS = [
  [0, 'KeyF', 'f'], [1, 'KeyG', 'g'], [2, 'KeyE', 'e'], [3, 'KeyC', 'c'],
  [5, 'Space', ' '], [4, 'ShiftLeft', 'Shift'], [6, 'KeyM', 'm'], [7, 'KeyH', 'h'],
];
const DEAD = 0.18;

const dead = (v) => (Math.abs(v) < DEAD ? 0 : Math.sign(v) * (Math.abs(v) - DEAD) / (1 - DEAD));

export function createGamepadInput() {
  const pressed = new Map();

  function pad() {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return null;
    const list = [...navigator.getGamepads()].filter((p) => p && p.connected);
    return list.find((p) => p.mapping === 'standard') ?? list.find((p) => looksLikeGamepad(p)) ?? null;
  }

  // パッドから出したキーには印を付ける（運転中の RB / LB は wheel.js がシフトとして読むので、
  // kartdrive.js がスペース（ハンドブレーキ）・Shift として重ねて受けないように）
  const fire = (type, code, key) => {
    const event = new KeyboardEvent(type, { code, key, bubbles: true });
    event.fromPad = true;
    window.dispatchEvent(event);
  };

  /**
   * 毎フレーム呼ぶ。スティックの値を返す（歩き：move、見回し：look。どちらも -1..1）
   * @returns {{ move: { x: number, y: number }, look: { x: number, y: number }, connected: boolean }}
   */
  let layout = BUTTON_KEYS;
  function update() {
    const p = pad();
    const want = p && p.mapping !== 'standard' ? LOOSE_KEYS : BUTTON_KEYS;
    if (!p || want !== layout) {
      // 抜かれたら（並びが変わったら）、押しっぱなしのキーを離す
      for (const [index, code, key] of layout) {
        if (pressed.get(index)) { fire('keyup', code, key); pressed.set(index, false); }
      }
      layout = want;
      if (!p) return { move: { x: 0, y: 0 }, look: { x: 0, y: 0 }, connected: false };
    }
    for (const [index, code, key] of layout) {
      const down = Boolean(p.buttons[index]?.pressed);
      if (down !== Boolean(pressed.get(index))) {
        fire(down ? 'keydown' : 'keyup', code, key);
        pressed.set(index, down);
      }
    }
    return {
      move: { x: dead(p.axes[0] ?? 0), y: dead(p.axes[1] ?? 0) },
      look: { x: dead(p.axes[2] ?? 0), y: dead(p.axes[3] ?? 0) },
      connected: true,
    };
  }

  return { update };
}
