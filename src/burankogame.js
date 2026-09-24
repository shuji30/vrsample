import * as THREE from 'three';
import { ROOM } from './room.js';
import { gardenPath } from './catchball.js';

/**
 * ブランコ（女の子の側）。プレイヤーがブランコの席に乗ると、女の子は遊びをやめて隣の席まで
 * 歩いてきて座り、両手で鎖を握る。自分のブランコをこいで、揺れの大きさと向きをプレイヤーに
 * そろえる（buranko.js の girlPump）。そろうと「そろったね！」、高くなると「たかーい！」。
 * プレイヤーが降りてしばらくすると、女の子も降りてキャッチボールへ戻る。
 *
 * こぎ方：プレイヤーの揺れの大きさより小さければこぐ。向きがずれていれば、プレイヤーと同じ
 * 向きに振れているあいだだけこいで、ずれを少しずつ詰める。
 *
 * 座り方はシーソーと同じふつうの座り方（膝をそろえて足を下ろす）。足を前へ伸ばしてこぐ
 * 動きは入れない（前から見ると中が見えてしまうため）。
 */

const OUTSIDE_Z = ROOM.minZ - ROOM.wall - 0.25;
const WALK = 1.1;
const GET_IN = 0.7;
const VIA = new THREE.Vector2(-5.6, -9.6);

export function createBurankoGame({ character, buranko, voice = null }) {
  const body = character.body;
  let state = 'off';
  let path = [];
  let playerRiding = false;
  let unwanted = 0;
  let timer = 0;
  let onFinish = null;
  const driver = { get state() { return `buranko:${state}`; } };
  const seat = new THREE.Vector3();
  const from = new THREE.Vector3();
  const side = new THREE.Vector3();
  const left = new THREE.Vector3();
  const right = new THREE.Vector3();
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
    buranko.girlSide(side);
    const target = new THREE.Vector2(side.x, side.z);
    const here = new THREE.Vector2(body.position.x, body.position.z);
    if (here.y > OUTSIDE_Z) {
      const exit = body.exitRoute();
      path = exit.concat(gardenPath(exit[exit.length - 1], VIA), [target]);
    } else {
      path = gardenPath(here, VIA).concat([target]);
    }
    voice?.say('burankoInvite');
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

  function seatPoint(out) {
    buranko.girlSeat(out);
    out.y = body.seatRootY(out.y);
    return out;
  }
  function holdChains() {
    buranko.girlChain(1, left);
    buranko.girlChain(-1, right);
    body.reachHands({ left: { target: left, amount: 1 }, right: { target: right, amount: 1 } });
  }

  /** プレイヤーに揺れをそろえるように、こぐ力を決める */
  function pumpToMatch() {
    const p = buranko.player;
    const g = buranko.girl;
    const want = p.amplitude;
    let pump = THREE.MathUtils.clamp((want - g.amplitude) * 3, 0, 1);
    // 向きのずれ（同じ向きに振れていなければ、こがずに揺れが落ちるのを待つ）
    const sameDirection = Math.sign(p.omega) === Math.sign(g.omega) || Math.abs(g.omega) < 0.2;
    if (!sameDirection) pump = 0;
    buranko.girlPump = pump;
    // プレイヤーが止めたら、女の子も足でブレーキ
    buranko.girlBrake = want < g.amplitude - 0.12 ? 0.8 : 0;
    return { want, diff: Math.abs(p.angle - g.angle) };
  }

  let syncFor = 0;
  let wasHigh = false;
  let cheerIn = 5;
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
        body.turnTowards(buranko.girlYaw(), dt);
        if (k > 0.5) body.setYaw(buranko.girlYaw());
        body.setSeat(e, 'upright');
        if (k > 0.4) holdChains();
        if (k >= 1) { state = 'ride'; buranko.girlSeated = true; voice?.say('burankoReady'); }
        break;
      }
      case 'ride': {
        const { want, diff } = pumpToMatch();
        seatPoint(seat);
        body.position.copy(seat);
        body.setYaw(buranko.girlYaw());
        body.setSeat(1, 'upright');
        holdChains();
        // 隣のプレイヤーを見る
        buranko.eye(gaze.position);
        character.watch(gaze);
        body.setAttend(false);
        // そろった・高い・こいでと言う
        syncFor = want > 0.35 && diff < 0.2 ? syncFor + dt : 0;
        if (syncFor > 2.5) { voice?.say('burankoSync'); syncFor = -6; }
        const high = buranko.girl.amplitude > 0.75;
        if (high && !wasHigh) voice?.say('burankoHigh', { chance: 0.6 });
        wasHigh = high;
        cheerIn -= dt;
        if (want < 0.1 && cheerIn < 0) { voice?.say('burankoPump'); cheerIn = 10; }
        break;
      }
      case 'getOut': {
        // 揺れが収まってから降りる
        if (buranko.girl.amplitude > 0.08) { seatPoint(seat); body.position.copy(seat); holdChains(); buranko.girlPump = 0; buranko.girlBrake = 1; from.copy(body.position); break; }
        buranko.girlSeated = false;
        timer += dt;
        const k = Math.min(1, timer / GET_IN);
        const e = k * k * (3 - 2 * k);
        buranko.girlSide(side);
        side.y = 0;
        body.position.lerpVectors(from, side, e);
        body.setSeat(1 - e, 'upright');
        if (k > 0.5) body.reachHands(null);
        if (k >= 1) { body.setSeat(0, 'upright'); body.position.y = 0; finish(); }
        break;
      }
      default:
        break;
    }
  }

  function stop() {
    if (state === 'ride' || state === 'getIn') {
      buranko.girlBrake = 1;
      state = 'getOut';
      timer = 0;
      from.copy(body.position);
      return;
    }
    if (state !== 'getOut') finish();
  }

  function finish() {
    body.reachHands(null);
    body.setAttend(true);
    buranko.girlSeated = false;
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
