/**
 * ゲームパッド（Xbox 配置、Gamepad API の mapping が 'standard'）で PC 版を遊ぶ。
 *
 *   左スティック … 歩く（LB を押しながらで速く）
 *   右スティック … 見回す
 *   A … 拾う / 投げる（F）      B … ラケットを置く（G）
 *   X … カートに乗る / 降りる（E）  Y … カートの視点（C）
 *   RB … ラケットを振る（押しているあいだ構える。スペース）
 *   View（Back）… BGM のオン / オフ（M）   Menu（Start）… ハンコンの設定（H）
 *   カートの運転は、左スティック・RT・LT（wheel.js が読む）
 *
 * ボタンはキーボードのキーを押したことにして、各所のキー操作をそのまま使う
 * （どの遊びでも操作が同じになる）。スティックは、歩きと見回しへ直接渡す。
 *
 * ハンコン（mapping が 'standard' でない機器）は、ここでは読まない。
 */

const BUTTON_KEYS = [
  [0, 'KeyF', 'f'],
  [1, 'KeyG', 'g'],
  [2, 'KeyE', 'e'],
  [3, 'KeyC', 'c'],
  [5, 'Space', ' '],
  [4, 'ShiftLeft', 'Shift'],
  [8, 'KeyM', 'm'],
  [9, 'KeyH', 'h'],
];
const DEAD = 0.18;

const dead = (v) => (Math.abs(v) < DEAD ? 0 : Math.sign(v) * (Math.abs(v) - DEAD) / (1 - DEAD));

export function createGamepadInput() {
  const pressed = new Map();

  function pad() {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return null;
    return [...navigator.getGamepads()].find((p) => p && p.connected && p.mapping === 'standard') ?? null;
  }

  const fire = (type, code, key) => window.dispatchEvent(new KeyboardEvent(type, { code, key, bubbles: true }));

  /**
   * 毎フレーム呼ぶ。スティックの値を返す（歩き：move、見回し：look。どちらも -1..1）
   * @returns {{ move: { x: number, y: number }, look: { x: number, y: number }, connected: boolean }}
   */
  function update() {
    const p = pad();
    if (!p) {
      // 抜かれたら、押しっぱなしのキーを離す
      for (const [index, code, key] of BUTTON_KEYS) {
        if (pressed.get(index)) { fire('keyup', code, key); pressed.set(index, false); }
      }
      return { move: { x: 0, y: 0 }, look: { x: 0, y: 0 }, connected: false };
    }
    for (const [index, code, key] of BUTTON_KEYS) {
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
