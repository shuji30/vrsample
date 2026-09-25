import * as THREE from 'three';
import { ROOM } from './room.js';
import { gardenPath } from './catchball.js';
import { CAROUSEL } from './carousel.js';
import { FERRIS } from './ferriswheel.js';

/**
 * 観覧車（女の子の側）。プレイヤーがゴンドラに乗ると、女の子は遊びをやめて乗り場まで歩いてきて、
 * 同じゴンドラの隣（戸に近い東）に座る。回りはじめると外を見て、上がるにつれて話しかけ、
 * てっぺんでは海を眺める。1 周して乗り場へ戻ったら、プレイヤーが降りるのを待って降り、
 * キャッチボールへ戻る。途中で降りたときは、world.js が暗くしているあいだに乗り場へ降ろす。
 *
 * 歩く道：庭の左の端（x -6）から、メリーゴーランドの南（円の外、z -5.2）を西へ行き、
 * 観覧車の東の脚のあいだを抜けて乗り場へ。
 */

const OUTSIDE_Z = ROOM.minZ - ROOM.wall - 0.25;
const WALK = 1.25;
const GET_IN = 1.1;
const GARDEN_EDGE = new THREE.Vector2(-6.2, -4.8);
const ROUTE = [
  new THREE.Vector2(-9.0, -5.2),
  new THREE.Vector2(CAROUSEL.x - 2, -5.2),
  new THREE.Vector2(CAROUSEL.x - 5.6, -4.6),
  new THREE.Vector2(FERRIS.x + 4.6, FERRIS.z - 2.2),
  new THREE.Vector2(FERRIS.x + 3.0, FERRIS.z - 0.4),
];

export function createFerrisGame({ character, ferris, voice = null }) {
  const body = character.body;
  let state = 'off';
  let path = [];
  let playerRiding = false;
  let unwanted = 0;
  let timer = 0;
  let onFinish = null;
  let said = {};
  let chatIn = 14;
  const driver = { get state() { return `ferris:${state}`; } };
  const seat = new THREE.Vector3();
  const from = new THREE.Vector3();
  const board = new THREE.Vector3();
  const left = new THREE.Vector3();
  const right = new THREE.Vector3();
  const gaze = new THREE.Object3D();
  gaze.userData = { held: false, velocity: new THREE.Vector3() };

  function start() {
    if (state !== 'off') return;
    state = 'waitStand';
    unwanted = 0;
    said = {};
    ferris.girlComing = true;
  }

  function beginWalk() {
    body.drive(driver);
    body.setAttend(true);
    body.reach(null);
    body.reachHands(null);
    body.setThrowPose(null);
    body.setCrouch(0);
    body.setBend(0);
    ferris.girlBoard(board);
    const here = new THREE.Vector2(body.position.x, body.position.z);
    let lead = [];
    let route = ROUTE;
    if (here.y > OUTSIDE_Z && here.x > ROOM.minX - 0.5) {
      const exit = body.exitRoute();
      lead = exit.concat(gardenPath(exit[exit.length - 1], GARDEN_EDGE));
    } else if (here.x > -6.5) {
      lead = gardenPath(here, GARDEN_EDGE);
    } else {
      // もう庭の外（公園・池のほう）にいる：いまの所より西の点からたどる
      route = ROUTE.filter((p) => p.x < here.x - 0.5);
    }
    path = [...lead, ...route, new THREE.Vector2(board.x, board.z)];
    voice?.say('ferrisInvite');
    state = 'toBoard';
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
    ferris.girlSeat(out);
    out.y = body.seatRootY(out.y);
    return out;
  }
  /** 手は膝の上（スカートの前）にそろえる（drive 中は座ったときの腕が効かないので、ここで置く） */
  function handsOnLap() {
    ferris.girlSeat(seat);
    const yaw = ferris.girlYaw();
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const lx = Math.cos(yaw);
    const lz = -Math.sin(yaw);
    left.set(seat.x + fx * 0.24 + lx * 0.06, seat.y + 0.13, seat.z + fz * 0.24 + lz * 0.06);
    right.set(seat.x + fx * 0.25 - lx * 0.06, seat.y + 0.14, seat.z + fz * 0.25 - lz * 0.06);
    body.reachHands({ left: { target: left, amount: 1 }, right: { target: right, amount: 1 } });
    body.setGrip(0.3);
  }

  function sayOnce(key, when) {
    if (!when || said[key]) return;
    said[key] = true;
    voice?.say(key);
  }

  function update(dt) {
    if (!body.loaded) return;
    unwanted = playerRiding ? 0 : unwanted + dt;
    if (state !== 'off' && unwanted > 4 && state !== 'ride' && state !== 'getIn' && state !== 'getOut') { stop(); return; }
    switch (state) {
      case 'off':
        return;
      case 'waitStand':
        if (!body.free && !body.driven) { body.requestStand(); break; }
        beginWalk();
        break;
      case 'toBoard':
        if (followPath(dt)) { state = 'getIn'; timer = 0; from.copy(body.position); }
        break;
      case 'getIn': {
        // 戸をくぐって、ベンチの東に座る
        timer += dt;
        const k = Math.min(1, timer / GET_IN);
        const e = k * k * (3 - 2 * k);
        seatPoint(seat);
        body.position.lerpVectors(from, seat, e);
        body.turnTowards(k < 0.4 ? Math.PI * 1.5 : ferris.girlYaw(), dt);
        if (k > 0.6) body.setYaw(ferris.girlYaw());
        body.setSeat(e, 'upright');
        body.setFootFloor(ferris.girlFloorY());
        if (k > 0.6) handsOnLap();
        if (k >= 1) { state = 'ride'; ferris.girlSeated = true; voice?.say('ferrisReady'); }
        break;
      }
      case 'ride': {
        seatPoint(seat);
        body.position.copy(seat);
        body.setYaw(ferris.girlYaw());
        body.setSeat(1, 'upright');
        body.setFootFloor(ferris.girlFloorY());
        handsOnLap();
        const p = ferris.progress;
        // 下のほうでは隣のプレイヤーを、上のほうでは窓の外（北の海）を見る
        const outside = p > 0.3 && p < 0.7 && !(p > 0.46 && p < 0.52);
        if (outside) {
          ferris.girlSeat(gaze.position);
          gaze.position.x -= 0.6;
          gaze.position.y -= 3 + ferris.height * 0.4;
          gaze.position.z -= 20;
        } else {
          ferris.eye(gaze.position);
        }
        character.watch(gaze);
        body.setAttend(false);
        if (ferris.phase === 'riding') {
          sayOnce('ferrisUp', p > 0.08);
          sayOnce('ferrisSea', p > 0.3);
          sayOnce('ferrisTop', p > 0.47);
          sayOnce('ferrisDown', p > 0.75);
          chatIn -= dt;
          if (chatIn < 0 && p > 0.12 && p < 0.9) { voice?.say('ferrisFun', { chance: 0.6 }); chatIn = 16 + Math.random() * 8; }
        }
        if (ferris.phase === 'arrived') sayOnce('ferrisEnd', true);
        // プレイヤーが降りたら（乗り場に着いていれば）降りる
        if (!playerRiding) { state = 'getOut'; timer = 0; from.copy(body.position); ferris.girlBoard(board); }
        break;
      }
      case 'getOut': {
        timer += dt;
        const k = Math.min(1, timer / GET_IN);
        const e = k * k * (3 - 2 * k);
        body.position.lerpVectors(from, board.setY(0), e);
        body.setSeat(1 - e, 'upright');
        if (k > 0.3) { body.reachHands(null); body.setGrip(0); }
        if (k >= 1) { body.setSeat(0, 'upright'); body.position.y = 0; finish(); }
        break;
      }
      default:
        break;
    }
  }

  /** 途中で降りた（world.js が暗くしているあいだ）：すぐ乗り場に立たせる */
  function dropAtStation() {
    if (state === 'off') return;
    ferris.girlBoard(board);
    // 降りたプレイヤー（side()：乗り場の東、z +0.4）とは 1.6m ほど離して、そちらを向かせる
    body.position.set(board.x + 0.6, 0, board.z - 1.2);
    body.setYaw(0);
    body.setSeat(0, 'upright');
    finish();
  }

  function stop() {
    if (state === 'ride' || state === 'getIn' || state === 'getOut') return;
    finish();
  }

  function finish() {
    body.reachHands(null);
    body.setGrip(0);
    body.setFootFloor(null);
    body.setAttend(true);
    ferris.girlSeated = false;
    ferris.girlComing = false;
    state = 'off';
    path = [];
    onFinish?.();
  }

  return {
    update,
    start,
    stop,
    dropAtStation,
    set onFinish(fn) { onFinish = fn; },
    set playerRiding(v) { playerRiding = Boolean(v); },
    get wanted() { return playerRiding; },
    get active() { return state !== 'off'; },
    get state() { return state; },
  };
}
