import * as THREE from 'three';
import { ROOM } from './room.js';
import { gardenPath } from './catchball.js';

/**
 * シーソー（女の子の側）。プレイヤーがシーソーの席に乗ると、女の子は遊びをやめて反対の
 * 席まで歩いてきて座り、取っ手を握る。自分の側が下りると、少し待ってからけり返す
 * （seesaw.js の girlSeated）。ギッコン・バッタンと声を出し、上がると喜ぶ。
 * プレイヤーが降りてしばらくすると、女の子も降りてキャッチボールへ戻る。
 *
 * 座り方はソファと同じふつうの座り方（膝をそろえて、足を下ろす）。シーソーのいちばん下で
 * 足がちょうど地面に届くよう、席の高さを合わせてある（seesaw.js）。
 */

const OUTSIDE_Z = ROOM.minZ - ROOM.wall - 0.25;
const WALK = 1.1;
const GET_IN = 0.7;
/** 庭から遊び場へ行くときの中継点 */
const VIA = new THREE.Vector2(-5.6, -9.6);

export function createSeesawGame({ character, seesaw, voice = null }) {
  const body = character.body;
  let state = 'off';
  let path = [];
  let playerRiding = false;
  let unwanted = 0;
  let timer = 0;
  let onFinish = null;
  const driver = { get state() { return `seesaw:${state}`; } };
  const seat = new THREE.Vector3();
  const from = new THREE.Vector3();
  const side = new THREE.Vector3();
  const left = new THREE.Vector3();
  const right = new THREE.Vector3();
  const gripAxis = new THREE.Vector3();
  // 向かいのプレイヤーを見る的
  const gaze = new THREE.Object3D();
  gaze.userData = { held: false, velocity: new THREE.Vector3() };

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
    seesaw.girlSide(side);
    const target = new THREE.Vector2(side.x, side.z);
    const here = new THREE.Vector2(body.position.x, body.position.z);
    if (here.y > OUTSIDE_Z) {
      const exit = body.exitRoute();
      path = exit.concat(gardenPath(exit[exit.length - 1], VIA), [target]);
    } else {
      path = gardenPath(here, VIA).concat([target]);
    }
    voice?.say('seesawInvite');
    state = 'toSeat';
  }

  let pathBest = Infinity;
  let pathStuck = 0;
  function followPath(dt) {
    if (path.length === 0) { body.stand(dt); return true; }
    const d = Math.hypot(path[0].x - body.position.x, path[0].y - body.position.z);
    if (d < pathBest - 0.02) { pathBest = d; pathStuck = 0; } else pathStuck += dt;
    if (body.stepTowards(path[0], dt, WALK) || pathStuck > 0.8) {
      path.shift();
      pathBest = Infinity;
      pathStuck = 0;
    }
    return path.length === 0;
  }

  /** 席の上に腰を下ろす位置（足元のルートの高さ込み） */
  function seatPoint(out) {
    seesaw.girlSeat(out);
    // 座面の手前へ少しずらす（腰は席の中ほど、腿は支点のほうへ）
    const yaw = seesaw.girlYaw();
    out.x -= Math.sin(yaw) * 0.06;
    out.z -= Math.cos(yaw) * 0.06;
    out.y = body.seatRootY(out.y);
    return out;
  }
  /**
   * 両脇のグリップを握る。どちらが左手かは、体の左（yaw から）に近いほう
   */
  function holdHandles() {
    seesaw.girlHandle(1, left);
    seesaw.girlHandle(-1, right);
    const lx = Math.cos(body.yaw);
    const lz = -Math.sin(body.yaw);
    const leftness = (p) => (p.x - body.position.x) * lx + (p.z - body.position.z) * lz;
    if (leftness(left) < leftness(right)) { const t = left.clone(); left.copy(right); right.copy(t); }
    // 拳の穴をグリップに通す（親指は前 = 支点のほう）
    const axis = seesaw.girlHandleAxis(gripAxis);
    body.reachHands({ left: { target: left, amount: 1, grip: axis }, right: { target: right, amount: 1, grip: axis } });
    body.setGrip(1);
  }

  let wasUp = false;
  let playerDownFor = 0;
  function update(dt) {
    if (!body.loaded) return;
    unwanted = playerRiding ? 0 : unwanted + dt;
    if (state !== 'off' && unwanted > 4) stop();
    switch (state) {
      case 'off':
        return;
      case 'waitStand':
        if (!body.free && !body.driven) { body.requestStand(); break; }
        beginWalk();
        break;
      case 'toSeat':
        if (followPath(dt)) { state = 'getIn'; timer = 0; from.copy(body.position); }
        break;
      case 'getIn': {
        timer += dt;
        const k = Math.min(1, timer / GET_IN);
        const e = k * k * (3 - 2 * k);
        seatPoint(seat);
        body.position.lerpVectors(from, seat, e);
        body.turnTowards(seesaw.girlYaw(), dt);
        if (k > 0.5) body.setYaw(seesaw.girlYaw());
        body.setSeat(e, 'upright');
        // いちばん下では、足を地面に着ける（地面へめり込ませない）
        body.setFootFloor(0);
        if (k > 0.4) holdHandles();
        if (k >= 1) { state = 'ride'; seesaw.girlSeated = true; voice?.say('seesawReady'); }
        break;
      }
      case 'ride': {
        seatPoint(seat);
        body.position.copy(seat);
        body.setYaw(seesaw.girlYaw());
        body.setSeat(1, 'upright');
        holdHandles();
        // 向かいのプレイヤー（の目の高さ）を見る
        seesaw.eye(gaze.position);
        character.watch(gaze);
        body.setAttend(false);
        // ギッコン・バッタン、上がったら喜ぶ
        const s = seesaw.state;
        if (s.landed === -1) voice?.say('seesawDown', { chance: 0.5 });
        if (s.landed === 1) voice?.say('seesawUp', { chance: 0.5 });
        // プレイヤーの側が下りたまま、けらないでいたら声をかける
        playerDownFor = s.angle <= -seesaw.maxAngle + 1e-3 ? playerDownFor + dt : 0;
        if (playerDownFor > 4) { voice?.say('seesawKick'); playerDownFor = 0; }
        const up = s.angle < -seesaw.maxAngle * 0.8;
        if (up && !wasUp) voice?.say('seesawHigh', { chance: 0.25 });
        wasUp = up;
        break;
      }
      case 'getOut': {
        timer += dt;
        const k = Math.min(1, timer / GET_IN);
        const e = k * k * (3 - 2 * k);
        seesaw.girlSide(side);
        side.y = 0;
        body.position.lerpVectors(from, side, e);
        body.setSeat(1 - e, 'upright');
        if (k > 0.5) { body.reachHands(null); body.setGrip(0); }
        if (k >= 1) { body.setSeat(0, 'upright'); body.position.y = 0; finish(); }
        break;
      }
      default:
        break;
    }
  }

  function stop() {
    if (state === 'ride' || state === 'getIn') {
      seesaw.girlSeated = false;
      state = 'getOut';
      timer = 0;
      from.copy(body.position);
      return;
    }
    if (state !== 'getOut') finish();
  }

  function finish() {
    body.reachHands(null);
    body.setGrip(0);
    body.setFootFloor(null);
    body.setAttend(true);
    seesaw.girlSeated = false;
    state = 'off';
    path = [];
    onFinish?.();
  }

  return {
    update,
    start,
    stop,
    set onFinish(fn) { onFinish = fn; },
    set playerRiding(v) { playerRiding = Boolean(v); },
    get wanted() { return playerRiding; },
    get active() { return state !== 'off'; },
    get state() { return state; },
  };
}
