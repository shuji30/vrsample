import * as THREE from 'three';
import { ROOM } from './room.js';
import { gardenPath } from './catchball.js';
import { COASTER } from './coaster.js';

/**
 * ジェットコースター（女の子の側）。プレイヤーが乗ると、女の子は遊びをやめて駅まで歩いてきて、
 * 先頭の車両の左の席（ホームの側）に座る。走っているあいだは車両といっしょに回り（宙返りでは逆さま）、
 * 安全バーを両手で握って、リフト・頂上・落下・宙返りで声をあげる。駅へ戻ってプレイヤーが降りたら降りる。
 *
 * 体（character.group）は、座るあいだ車両の席の台（coaster.girlPivot）の子にする。character.js の体は
 * 向き（yaw）しか持たないので、宙返りのように前後・左右にも回すには、親ごと回すしかない。
 * そのあいだ、体の位置・向き・見る所は台のローカルで入れる（手の目標はワールドのまま効く）。
 *
 * 歩く道：部屋にいれば窓から出て、庭から家の右の芝生（GT3 の所）を通り、家の南の駅のホームへ。
 */
const OUTSIDE_Z = ROOM.minZ - ROOM.wall - 0.25;
const WALK = 1.25;
const GET_IN = 1.1;
const SEAT_TOP = 0.05;   // 台（座面）の上
const VIA = [new THREE.Vector2(6.8, -3.2), new THREE.Vector2(7.6, 3.2), new THREE.Vector2(8.6, 7.6)];

export function createCoasterGame({ character, coaster, voice = null, scene, playerHead }) {
  const body = character.body;
  let state = 'off';
  let path = [];
  let playerRiding = false;
  let unwanted = 0;
  let timer = 0;
  let onFinish = null;
  let said = {};
  let lastSection = '';
  let chatIn = 12;
  let attached = false;
  const driver = { get state() { return `coaster:${state}`; } };
  const from = new THREE.Vector3();
  const seat = new THREE.Vector3();
  const board = new THREE.Vector3();
  const left = new THREE.Vector3();
  const right = new THREE.Vector3();
  const gaze = new THREE.Object3D();
  gaze.userData = { held: false, velocity: new THREE.Vector3() };
  const tmp = new THREE.Vector3();

  function start() {
    if (state !== 'off') return;
    state = 'waitStand';
    unwanted = 0;
    said = {};
    lastSection = '';
    coaster.girlComing = true;
  }

  function beginWalk() {
    body.drive(driver);
    body.setAttend(true);
    body.reach(null);
    body.reachHands(null);
    body.setThrowPose(null);
    body.setCrouch(0);
    body.setBend(0);
    coaster.girlBoard(board);
    const here = new THREE.Vector2(body.position.x, body.position.z);
    const target = new THREE.Vector2(board.x, board.z);
    let lead = [];
    if (here.y > OUTSIDE_Z && here.x > ROOM.minX - 0.5 && here.x < ROOM.maxX + 0.5 && here.y < ROOM.maxZ) {
      const exit = body.exitRoute();
      lead = exit.concat(gardenPath(exit[exit.length - 1], VIA[0]));
    } else if (here.y < 2) {
      lead = gardenPath(here, VIA[0]);
    }
    // 家の南・東（駅の近く）にいれば、そのまま
    const via = here.y > 2 ? [] : VIA.map((p) => p.clone());
    path = [...lead, ...via, target];
    voice?.say('coasterInvite');
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

  /** 席に座った体を、台の子にする（位置・向きは台のローカル） */
  function attach() {
    if (attached) return;
    coaster.girlPivot.add(character.group);
    attached = true;
  }
  function detach() {
    if (!attached) return;
    scene.attach(character.group);
    attached = false;
    // 前後・左右の傾きを消して、向きだけにする
    const f = tmp.set(0, 0, 1).applyQuaternion(character.group.quaternion);
    const yaw = Math.atan2(f.x, f.z);
    character.group.rotation.set(0, yaw, 0);
    body.setYaw(yaw);
  }

  function sitLocal() {
    body.position.set(0, body.seatRootY(SEAT_TOP), 0);
    body.setYaw(0);
    character.group.rotation.set(0, 0, 0);
    body.setSeat(1, 'upright', { skirt: true });
    body.setFootFloor(null);
    coaster.barPoints(left, right);
    body.reachHands({ left: { target: left, amount: 1 }, right: { target: right, amount: 1 } });
    body.setGrip(1);
  }

  function sayOnce(key, when) {
    if (!when || said[key]) return;
    said[key] = true;
    voice?.say(key);
  }

  /** 見る所（台のローカル）。ふだんは前、頂上とゆっくりのときはプレイヤー（右） */
  function lookLocal(section) {
    if (section === 'top' || section === 'boarding' || section === 'arrived' || section === 'brake') {
      playerHead(tmp);
      coaster.girlPivot.worldToLocal(gaze.position.copy(tmp));
    } else {
      gaze.position.set(0, 0.8, 12);
    }
    character.watch(gaze);
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
        playerHead(gaze.position);
        character.watch(gaze);
        if (followPath(dt)) { state = 'getIn'; timer = 0; from.copy(body.position); }
        break;
      case 'getIn': {
        // ホームから車両へ入って、席に腰を下ろす（車両は駅に止まっている）
        timer += dt;
        const k = Math.min(1, timer / GET_IN);
        const e = k * k * (3 - 2 * k);
        coaster.girlPivot.updateMatrixWorld(true);
        coaster.girlPivot.getWorldPosition(seat);
        seat.y += body.seatRootY(SEAT_TOP);
        body.position.lerpVectors(from, seat, e);
        body.turnTowards(coaster.state.yaw, dt * 2);
        if (k > 0.5) body.setYaw(coaster.state.yaw);
        body.setSeat(e, 'upright', { skirt: true });
        if (k >= 1) {
          attach();
          sitLocal();
          state = 'ride';
          coaster.girlSeated = true;
          voice?.say('coasterReady');
          body.smile(2, 0.8);
        }
        break;
      }
      case 'ride': {
        sitLocal();
        body.setAttend(false);
        const sec = coaster.section;
        lookLocal(sec);
        if (sec !== lastSection) {
          if (sec === 'lift') sayOnce('coasterLift', true);
          if (sec === 'top') sayOnce('coasterTop', true);
          if (sec === 'drop') { sayOnce('coasterDrop', true); body.smile(3, 1); }
          if (sec === 'loop') sayOnce('coasterLoop', true);
          if (sec === 'arrived') { voice?.say('coasterEnd'); said = {}; }
          lastSection = sec;
        }
        if (sec === 'ride') {
          chatIn -= dt;
          if (chatIn < 0) { voice?.say('coasterFun', { chance: 0.7 }); chatIn = 6 + Math.random() * 5; }
        }
        // プレイヤーが降りたら（駅に止まっていれば）降りる
        if (!playerRiding) {
          detach();
          state = 'getOut';
          timer = 0;
          from.copy(body.position);
          coaster.girlBoard(board);
        }
        break;
      }
      case 'getOut': {
        timer += dt;
        const k = Math.min(1, timer / GET_IN);
        const e = k * k * (3 - 2 * k);
        body.position.lerpVectors(from, board.setY(0), e);
        body.setSeat(1 - e, 'upright', { skirt: true });
        if (k > 0.3) { body.reachHands(null); body.setGrip(0); }
        if (k >= 1) { body.setSeat(0, 'upright'); body.position.y = 0; finish(); }
        break;
      }
      default:
        break;
    }
  }

  /** 途中で降りた（world.js が暗くしているあいだ）：ホームに立たせる */
  function dropAtStation() {
    if (state === 'off') return;
    detach();
    coaster.girlBoard(board);
    body.position.set(board.x - 1.4, 0, board.z - 0.4);
    body.setYaw(Math.PI / 2);
    body.setSeat(0, 'upright');
    finish();
  }

  function stop() {
    if (state === 'ride' || state === 'getIn' || state === 'getOut') return;
    finish();
  }

  function finish() {
    detach();
    body.reachHands(null);
    body.setGrip(0);
    body.setFootFloor(null);
    body.setAttend(true);
    coaster.girlSeated = false;
    coaster.girlComing = false;
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
export { COASTER };
