import * as THREE from 'three';
import { ROOM } from './room.js';
import { gardenPath } from './catchball.js';

/**
 * 釣り（女の子の側）。プレイヤーが池の桟橋のベンチ（右）に座ると、女の子は遊びをやめて
 * 歩いてきて左に座り、自分の竿を両手で持って釣る（竿・浮き・魚は pond.js の updateGirl）。
 * プレイヤーの浮きがしずむと「ひいてる！」、釣れると喜ぶ。自分が釣っても声をあげる。
 * プレイヤーが立ってしばらくすると、女の子も立ってキャッチボールへ戻る。
 *
 * 歩く道：遊び場（シーソー・ブランコ）の手前（z -6.5）を通って、桟橋の付け根から
 * まっすぐ桟橋へ入る（まっすぐ行くと遊具を突っ切り、池の縁の石も踏む）。
 */

const OUTSIDE_Z = ROOM.minZ - ROOM.wall - 0.25;
const WALK = 1.1;
const GET_IN = 0.7;
const VIA = new THREE.Vector2(-5.6, -9.6);
const ROUTE = [new THREE.Vector2(-7.0, -6.6), new THREE.Vector2(-20.0, -6.6), new THREE.Vector2(-24.9, -7.2)];

export function createFishingGame({ character, fishing, voice = null }) {
  const body = character.body;
  let state = 'off';
  let path = [];
  let playerRiding = false;
  let unwanted = 0;
  let timer = 0;
  let onFinish = null;
  const driver = { get state() { return `fishing:${state}`; } };
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
    fishing.girlSide(side);
    const target = new THREE.Vector2(side.x, side.z);
    const here = new THREE.Vector2(body.position.x, body.position.z);
    // 遊び場より左（池の側）にいれば、そのまま桟橋へ
    const route = here.x < -18 ? [ROUTE[2]] : ROUTE;
    if (here.y > OUTSIDE_Z) {
      const exit = body.exitRoute();
      path = exit.concat(gardenPath(exit[exit.length - 1], VIA), route, [target]);
    } else if (here.x < -18) {
      path = [...route, target];
    } else {
      path = gardenPath(here, VIA).concat(route, [target]);
    }
    voice?.say('fishingInvite');
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
    fishing.girlSeat(out);
    out.y = body.seatRootY(out.y);
    return out;
  }
  function holdRod() {
    fishing.girlHands(left, right);
    body.reachHands({ left: { target: left, amount: 1 }, right: { target: right, amount: 1 } });
  }

  let chatIn = 20;
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
        body.turnTowards(fishing.girlYaw(), dt);
        if (k > 0.5) body.setYaw(fishing.girlYaw());
        body.setSeat(e, 'upright');
        if (k >= 1) { state = 'ride'; voice?.say('fishingReady'); }
        break;
      }
      case 'ride': {
        seatPoint(seat);
        body.position.copy(seat);
        body.setYaw(fishing.girlYaw());
        body.setSeat(1, 'upright');
        holdRod();
        // ふだんは自分の浮きを、プレイヤーがかかったらプレイヤーの浮きのほうを見る
        fishing.gazeTarget(gaze.position);
        character.watch(gaze);
        body.setAttend(false);
        chatIn -= dt;
        if (chatIn < 0 && fishing.state.phase === 'wait' && fishing.state.timer > 4) { voice?.say('fishingChat', { chance: 0.6 }); chatIn = 25 + Math.random() * 20; }
        break;
      }
      case 'getOut': {
        timer += dt;
        const k = Math.min(1, timer / GET_IN);
        const e = k * k * (3 - 2 * k);
        fishing.girlSide(side);
        body.position.lerpVectors(from, side, e);
        body.setSeat(1 - e, 'upright');
        if (k > 0.3) body.reachHands(null);
        if (k >= 1) { body.setSeat(0, 'upright'); body.position.y = 0; finish(); }
        break;
      }
      default:
        break;
    }
  }

  function stop() {
    if (state === 'ride' || state === 'getIn') {
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
    /** 竿を持って座っているか（pond.js の updateGirl に渡す） */
    get seated() { return state === 'ride'; },
  };
}
