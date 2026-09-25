import * as THREE from 'three';
import { ROOM } from './room.js';
import { gardenPath } from './catchball.js';
import { CAROUSEL } from './carousel.js';

/**
 * メリーゴーランド（女の子の側）。プレイヤーが木馬に乗ると、女の子は遊びをやめて歩いてきて、
 * すぐ内側の馬車に座り、前の手すりを握る。回りはじめると喜び、ときどき隣のプレイヤーに話しかける。
 * プレイヤーが降りると、止まるのを待ってから降りて、キャッチボールへ戻る。
 *
 * 歩く道：庭の左の端（x -6）から、メリーゴーランドのまわり（半径 4.2m の円）を回って、
 * 馬車の外側の乗り込む所へ。回転台を突っ切らないように、円に沿った点を足す。
 */

const OUTSIDE_Z = ROOM.minZ - ROOM.wall - 0.25;
const WALK = 1.2;
const GET_IN = 1.0;
/** 庭からメリーゴーランドへ出る所（庭の左の端） */
const GARDEN_EDGE = new THREE.Vector2(-6.2, -4.8);
const RING = CAROUSEL.radius + 1.0;

export function createCarouselGame({ character, carousel, voice = null }) {
  const body = character.body;
  let state = 'off';
  let path = [];
  let playerRiding = false;
  let unwanted = 0;
  let timer = 0;
  let onFinish = null;
  let wasRunning = false;
  let chatIn = 10;
  const driver = { get state() { return `carousel:${state}`; } };
  const seat = new THREE.Vector3();
  const from = new THREE.Vector3();
  const board = new THREE.Vector3();
  const left = new THREE.Vector3();
  const right = new THREE.Vector3();
  const axis = new THREE.Vector3();
  const gaze = new THREE.Object3D();
  gaze.userData = { held: false, velocity: new THREE.Vector3() };

  function start() {
    if (state !== 'off') return;
    state = 'waitStand';
    unwanted = 0;
    carousel.girlComing = true;
  }

  /** 円のまわりを、角度 a0 から a1 へ回る点（近いほうの向きで 30° ごと） */
  function arc(a0, a1) {
    let d = Math.atan2(Math.sin(a1 - a0), Math.cos(a1 - a0));
    const n = Math.max(1, Math.ceil(Math.abs(d) / (Math.PI / 6)));
    const out = [];
    for (let i = 1; i <= n; i++) {
      const a = a0 + (d * i) / n;
      out.push(new THREE.Vector2(CAROUSEL.x + Math.cos(a) * RING, CAROUSEL.z + Math.sin(a) * RING));
    }
    return out;
  }
  const angleOf = (x, z) => Math.atan2(z - CAROUSEL.z, x - CAROUSEL.x);

  function beginWalk() {
    body.drive(driver);
    body.setAttend(true);
    body.reach(null);
    body.reachHands(null);
    body.setThrowPose(null);
    body.setCrouch(0);
    body.setBend(0);
    carousel.girlBoard(board);
    const target = new THREE.Vector2(board.x, board.z);
    const here = new THREE.Vector2(body.position.x, body.position.z);
    let lead = [];
    const nearRing = Math.hypot(here.x - CAROUSEL.x, here.y - CAROUSEL.z) < RING + 2;
    if (here.y > OUTSIDE_Z && here.x > ROOM.minX - 0.5) {
      const exit = body.exitRoute();
      lead = exit.concat(gardenPath(exit[exit.length - 1], GARDEN_EDGE));
    } else if (!nearRing) {
      lead = gardenPath(here, GARDEN_EDGE);
    }
    const startPoint = lead.length ? lead[lead.length - 1] : here;
    const a0 = angleOf(startPoint.x, startPoint.y);
    const a1 = angleOf(board.x, board.z);
    const ringStart = new THREE.Vector2(CAROUSEL.x + Math.cos(a0) * RING, CAROUSEL.z + Math.sin(a0) * RING);
    path = [...lead, ringStart, ...arc(a0, a1), target];
    voice?.say('carouselInvite');
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
    carousel.girlSeat(out);
    out.y = body.seatRootY(out.y);
    return out;
  }
  function holdRail() {
    carousel.girlRail(1, left);
    carousel.girlRail(-1, right);
    const lx = Math.cos(body.yaw);
    const lz = -Math.sin(body.yaw);
    const leftness = (p) => (p.x - body.position.x) * lx + (p.z - body.position.z) * lz;
    if (leftness(left) < leftness(right)) { const t = left.clone(); left.copy(right); right.copy(t); }
    carousel.girlRailAxis(axis);
    body.reachHands({ left: { target: left, amount: 1, grip: axis }, right: { target: right, amount: 1, grip: axis } });
    body.setGrip(1);
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
        // 台に上がって、馬車に座る（段差 0.25m も、座る高さへ持ち上げるあいだに越える）
        timer += dt;
        const k = Math.min(1, timer / GET_IN);
        const e = k * k * (3 - 2 * k);
        seatPoint(seat);
        body.position.lerpVectors(from, seat, e);
        body.turnTowards(carousel.girlYaw(), dt);
        if (k > 0.5) body.setYaw(carousel.girlYaw());
        body.setSeat(e, 'upright');
        body.setFootFloor(carousel.girlFloorY());
        if (k > 0.5) holdRail();
        if (k >= 1) { state = 'ride'; carousel.girlSeated = true; voice?.say('carouselReady'); }
        break;
      }
      case 'ride': {
        seatPoint(seat);
        body.position.copy(seat);
        body.setYaw(carousel.girlYaw());
        body.setSeat(1, 'upright');
        body.setFootFloor(carousel.girlFloorY());
        holdRail();
        // 外側の木馬に乗っているプレイヤーを見る
        carousel.eye(gaze.position);
        character.watch(gaze);
        body.setAttend(false);
        if (carousel.running && !wasRunning) voice?.say('carouselStart');
        wasRunning = carousel.running;
        chatIn -= dt;
        if (carousel.running && chatIn < 0) { voice?.say('carouselFun', { chance: 0.7 }); chatIn = 12 + Math.random() * 8; }
        // プレイヤーが降りたら、止まるのを待って降りる
        if (!playerRiding && carousel.state.omega < 0.01) { state = 'getOut'; timer = 0; from.copy(body.position); carousel.girlBoard(board); }
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

  function stop() {
    if (state === 'ride' || state === 'getIn' || state === 'getOut') return;   // 止まってから降りる（update が進める）
    finish();
  }

  function finish() {
    body.reachHands(null);
    body.setGrip(0);
    body.setFootFloor(null);
    body.setAttend(true);
    carousel.girlSeated = false;
    carousel.girlComing = false;
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
