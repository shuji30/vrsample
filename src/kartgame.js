import * as THREE from 'three';
import { ROOM } from './room.js';
import { KART } from './kart.js';
import { createKartAI } from './kartai.js';
import { gardenPath } from './catchball.js';

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

export function createKartGame({ character, kart, playerKart, clamp, voice = null }) {
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
    kart.state.speed *= 0.9;
    playerKart.state.speed *= 0.9;
    return push;
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
        const input = ai.update();
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
