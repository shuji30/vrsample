import * as THREE from 'three';
import { ROOM } from './room.js';
import { KART } from './kart.js';
import { createKartAI } from './kartai.js';
import { gardenPath } from './catchball.js';
import { TRACK_LENGTH, trackPoint } from './karttrack.js';

/**
 * カート（女の子の側）。プレイヤーがカートに乗ると、女の子もキャッチボール（テニス）を
 * やめてピンクのカートまで歩き、乗り込んで走る（kartai.js）。プレイヤーが降りてしばらく
 * すると、カートを止めて降り、キャッチボールへ体を返す。
 *
 * 乗り込み：カートの左に立ち、座りながら座席へ滑り込む（0.7 秒）。座っているあいだは
 * カート用の座り方（腰を起こし、膝をハンドルの下へくぐらせる）で、両手はハンドルの左右を握る
 * （ハンドルが回ると手もいっしょに回る）。
 *
 * 2 台がぶつかったら、押し合って離す（円どうしの当たり）。
 */

const OUTSIDE_Z = ROOM.minZ - ROOM.wall - 0.25;
const SEAT_TOP = 0.2;
const GET_IN = 0.7;
const WALK = 1.0;
/** 2 台の当たりの半径（中心どうしがこれより近ければ押し合う） */
const KART_RADIUS = 0.62;

export function createKartGame({ character, kart, playerKart, clamp, voice = null, race = null }) {
  const body = character.body;
  const ai = createKartAI(kart, { skill: 0.8 });
  let state = 'off';
  let timer = 0;
  let path = [];
  let playerDriving = false;
  let unwanted = 0;
  let driving = false;           // 女の子がカートを走らせている
  const seat = new THREE.Vector3();
  const side = new THREE.Vector3();
  const leftHand = new THREE.Vector3();
  const rightHand = new THREE.Vector3();
  const from = new THREE.Vector3();
  const driver = { get state() { return `kart:${state}`; } };
  // 前を見る（視線の先に置く見えない的）
  const gaze = new THREE.Object3D();
  gaze.userData = { held: false, velocity: new THREE.Vector3(8, 0, 0) };
  let onFinish = null;

  function start() {
    if (state !== 'off') return;
    state = 'waitStand';
    unwanted = 0;
  }

  function beginWalk() {
    body.drive(driver);
    body.setAttend(true);
    body.reach(null);
    body.reachHands(null);
    body.setThrowPose(null);
    body.setCrouch(0);
    body.setBend(0);
    kart.side(side);
    const target = new THREE.Vector2(side.x, side.z);
    const here = new THREE.Vector2(body.position.x, body.position.z);
    if (here.y > OUTSIDE_Z) {
      const exit = body.exitRoute();
      path = exit.concat(gardenPath(exit[exit.length - 1], target));
    } else {
      path = gardenPath(here, target);
    }
    voice?.say('kartInvite');
    state = 'toKart';
  }

  let pathBest = Infinity;
  let pathStuck = 0;
  function followPath(dt, speed) {
    if (path.length === 0) { body.stand(dt); return true; }
    const d = Math.hypot(path[0].x - body.position.x, path[0].y - body.position.z);
    if (d < pathBest - 0.02) { pathBest = d; pathStuck = 0; } else pathStuck += dt;
    if (body.stepTowards(path[0], dt, speed) || pathStuck > 0.8) {
      path.shift();
      pathBest = Infinity;
      pathStuck = 0;
    }
    return path.length === 0;
  }

  /** 座席の位置（ワールド、足元の高さ込み） */
  function seatPoint(out) {
    kart.group.localToWorld(out.set(0, 0, KART.seatZ - 0.08));
    out.y = body.seatRootY(SEAT_TOP);
    return out;
  }

  function holdWheel() {
    kart.steering.localToWorld(leftHand.set(0.14, -0.02, 0.01));
    kart.steering.localToWorld(rightHand.set(-0.14, -0.02, 0.01));
    body.reachHands({ left: { target: leftHand, amount: 1 }, right: { target: rightHand, amount: 1 } });
  }

  function lookAhead() {
    const yaw = kart.state.yaw;
    gaze.position.set(kart.group.position.x + Math.sin(yaw) * 6, 0.8, kart.group.position.z + Math.cos(yaw) * 6);
    character.watch(gaze);
    body.setAttend(false);
  }

  /** 2 台のカートが重なったら押し離す */
  function separate() {
    const a = kart.group.position;
    const b = playerKart.group.position;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const d = Math.hypot(dx, dz);
    if (d > KART_RADIUS * 2 || d < 1e-4) return 0;
    const push = (KART_RADIUS * 2 - d) / 2;
    const nx = dx / d;
    const nz = dz / d;
    a.x -= nx * push;
    a.z -= nz * push;
    b.x += nx * push;
    b.z += nz * push;
    // 後ろからぶつけた側（相手が前にいる側）だけ、相手の速さ近くまで落とす。以前は両方を
    // 毎フレーム 1 割ずつ落としていて、並んで走ると 2 台ともほとんど進まなかった
    const forward = (k, sx, sz) => Math.sin(k.state.yaw) * sx + Math.cos(k.state.yaw) * sz;
    if (forward(kart, nx, nz) > 0.3 && kart.state.speed > playerKart.state.speed) {
      kart.state.speed = Math.max(playerKart.state.speed, kart.state.speed * 0.85);
    }
    if (forward(playerKart, -nx, -nz) > 0.3 && playerKart.state.speed > kart.state.speed) {
      playerKart.state.speed = Math.max(kart.state.speed, playerKart.state.speed * 0.85);
    }
    return push;
  }

  /**
   * レース（kartrace.js）の指示どおりに走る。レースが無ければ、ずっと走る。
   *   hold   … 止まって待つ（ブレーキを踏み続けるとバックするので、止まったら離す）
   *   race   … 全力（追い上げの skill）
   *   toGrid … 自分の枠へ。コースを回って枠の 5m 手前まで来たら、枠の点を狙ってゆっくり寄せ、
   *            着いたら枠にぴったり置く
   */
  function raceInput() {
    const command = race ? race.herCommand() : 'race';
    kart.state.boost = race ? race.herBoost : 1;
    if (command === 'hold') {
      return { throttle: 0, brake: Math.abs(kart.speed) > 0.2 ? 1 : 0, steer: 0 };
    }
    if (command === 'race') {
      ai.skill = race ? race.herSkill : 0.8;
      return ai.update({ rival: playerKart });
    }
    const slot = race.slot;
    const p = kart.group.position;
    const distance = Math.hypot(slot.x - p.x, slot.z - p.z);
    // 枠まで、コースに沿って前へ何 m か（通り過ぎたばかりなら passed が小さい）
    const slotU = nearestSlotU(slot);
    let ahead = (slotU - kart.state.u) % 1;
    if (ahead < 0) ahead += 1;
    ahead *= TRACK_LENGTH;
    const passed = TRACK_LENGTH - ahead;
    // 着いた（少し行き過ぎても、近ければ着いたことにする）。速すぎたら先に止める
    if (distance < 0.7 || (passed < 1.5 && distance < 1.3)) {
      if (Math.abs(kart.speed) > 1.5) return { throttle: 0, brake: 1, steer: 0 };
      kart.place(slot.x, slot.z, slot.yaw);
      return { throttle: 0, brake: 0, steer: 0 };
    }
    ai.skill = 0.5;
    if (ahead < 7) {
      return ai.update({ target: slot, speedCap: Math.max(0.6, distance * 0.6), rival: playerKart });
    }
    return ai.update({ speedCap: 4.5, rival: playerKart });
  }
  let slotU = null;
  function nearestSlotU(slot) {
    if (slotU !== null) return slotU;
    // 枠の点にいちばん近いコース上の u（初めの 1 回だけ探す）
    let best = Infinity;
    const q = new THREE.Vector3();
    for (let i = 0; i < 2000; i++) {
      trackPoint(i / 2000, q);
      const d = (q.x - slot.x) ** 2 + (q.z - slot.z) ** 2;
      if (d < best) { best = d; slotU = i / 2000; }
    }
    return slotU;
  }

  function update(dt) {
    if (!body.loaded) return;
    unwanted = playerDriving ? 0 : unwanted + dt;
    if (state !== 'off' && unwanted > 4 && ['toKart', 'waitStand', 'drive'].includes(state)) stop();

    switch (state) {
      case 'off':
        return;
      case 'waitStand':
        if (!body.free && !body.driven) { body.requestStand(); break; }
        beginWalk();
        break;
      case 'toKart':
        if (followPath(dt, WALK)) {
          state = 'getIn';
          timer = 0;
          from.copy(body.position);
        }
        break;
      case 'getIn': {
        // 座りながら、座席へ滑り込む
        timer += dt;
        const k = Math.min(1, timer / GET_IN);
        const e = k * k * (3 - 2 * k);
        seatPoint(seat);
        body.position.lerpVectors(from, seat, e);
        body.turnTowards(kart.state.yaw, dt);
        if (k > 0.5) body.setYaw(kart.state.yaw);
        body.setSeat(e, 'kart');
        if (k > 0.4) holdWheel();
        if (k >= 1) { state = 'drive'; driving = true; }
        break;
      }
      case 'drive': {
        const input = raceInput();
        kart.update(dt, input, clamp);
        separate();
        seatPoint(seat);
        body.position.copy(seat);
        body.setYaw(kart.state.yaw);
        body.setSeat(1, 'kart');
        holdWheel();
        lookAhead();
        break;
      }
      case 'stopKart': {
        // 止まってから降りる
        kart.update(dt, { throttle: 0, brake: 1, steer: 0 }, clamp);
        seatPoint(seat);
        body.position.copy(seat);
        body.setYaw(kart.state.yaw);
        holdWheel();
        if (Math.abs(kart.speed) < 0.1) { state = 'getOut'; timer = 0; from.copy(body.position); driving = false; }
        break;
      }
      case 'getOut': {
        timer += dt;
        const k = Math.min(1, timer / GET_IN);
        const e = k * k * (3 - 2 * k);
        kart.side(side);
        side.y = 0;
        body.position.lerpVectors(from, side, e);
        body.setSeat(1 - e, 'kart');
        if (k > 0.5) { body.reachHands(null); body.reach(null); }
        if (k >= 1) {
          body.setSeat(0, 'kart');
          body.position.y = 0;
          finish();
        }
        break;
      }
      default:
        break;
    }
  }

  function stop() {
    if (state === 'drive') { state = 'stopKart'; return; }
    if (state === 'getIn') { state = 'getOut'; timer = 0; from.copy(body.position); return; }
    if (state === 'waitStand' || state === 'toKart') finish();
  }

  function finish() {
    body.reachHands(null);
    body.reach(null);
    body.setAttend(true);
    driving = false;
    state = 'off';
    onFinish?.();
  }

  return {
    update,
    start,
    stop,
    set onFinish(fn) { onFinish = fn; },
    set playerDriving(v) { playerDriving = Boolean(v); },
    get wanted() { return playerDriving; },
    get active() { return state !== 'off'; },
    get state() { return state; },
    get driving() { return driving; },
    ai,
  };
}
