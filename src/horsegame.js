import * as THREE from 'three';
import { ROOM } from './room.js';
import { gardenPath } from './catchball.js';
import { GATE, PADDOCK } from './stable.js';

/**
 * 乗馬（女の子の側）。二人乗り：プレイヤーが馬に乗ると、女の子は遊びをやめて馬のところへ来て、
 * 鞍の前半分に横乗り（両脚を馬の左へそろえて下ろす）で乗る。プレイヤーはその後ろで手綱を持って操る。
 * 女の子が乗るまで馬は待つ（来ないときは 25 秒で動けるようにする）。
 *
 * 横乗りにするのは、またがると短いスカートの中が見えてしまうため（昔の婦人乗りと同じ）。
 * 体（character.group）は、乗っているあいだ馬の鞍の台（horse.girlPivot）の子にして、馬の揺れごと動かす。
 * そのあいだ、体の位置・向き・見る所は台のローカルで入れる（手の目標はワールドのまま効く）。
 *
 * 乗っているあいだは前を見て、ときどき振り返ってプレイヤーを見る。速歩・駈歩で喜び、止まると話しかける。
 * プレイヤーが降りると、女の子も馬の左へ降りて、キャッチボールへ戻る。
 *
 * 歩く道：馬が馬場の中にいれば、庭から池とポケバイのコースのあいだを通って入口から。外にいれば、
 * 庭の中は gardenPath で障害物をよけ、公園はまっすぐ。
 */

const OUTSIDE_Z = ROOM.minZ - ROOM.wall - 0.25;
const WALK = 1.25;
const RUN = 2.0;
const VIA = new THREE.Vector2(-5.6, -9.6);
/** 庭から馬場へ：遊具の手前 → 池とポケバイのコースのあいだ → 馬場の入口の外 */
const ROUTE = [new THREE.Vector2(-7.0, -6.6), new THREE.Vector2(-18.2, -6.6), new THREE.Vector2(-18.2, -17.5)];
const GATE_OUT = new THREE.Vector2(GATE.x + 0.3, GATE.z + 0.95);
const GATE_IN = new THREE.Vector2(GATE.x - 0.3, GATE.z - 0.85);
const MOUNT = 1.2;
const SEAT_TOP = 0.02;

export function createHorseGame({ character, horse, voice = null, scene = null, playerHead = null }) {
  const body = character.body;
  let state = 'off';        // off / waitStand / toHorse / mount / ride / dismount
  let path = [];
  let playerRiding = false;
  let unwanted = 0;
  let waited = 0;
  let timer = 0;
  let onFinish = null;
  let attached = false;
  let lookBack = 0;
  let lookIn = 5;
  let talkIn = 12;
  const driver = { get state() { return `horse:${state}`; } };
  const from = new THREE.Vector3();
  const seat = new THREE.Vector3();
  const mountAt = new THREE.Vector3();
  const left = new THREE.Vector3();
  const right = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const gaze = new THREE.Object3D();
  gaze.userData = { held: false, velocity: new THREE.Vector3() };

  const inPaddock = (x, z) => ((x - PADDOCK.cx) / PADDOCK.rx) ** 2 + ((z - PADDOCK.cz) / PADDOCK.rz) ** 2 < 1;

  function start() {
    if (state !== 'off') return;
    state = 'waitStand';
    unwanted = 0;
    waited = 0;
    horse.hold = true;
  }

  function beginWalk() {
    body.drive(driver);
    body.setAttend(true);
    body.reach(null);
    body.reachHands(null);
    body.setThrowPose(null);
    body.setCrouch(0);
    body.setBend(0);
    const here = new THREE.Vector2(body.position.x, body.position.z);
    horse.mountPoint(mountAt);
    const target = new THREE.Vector2(mountAt.x, mountAt.z);
    const hp = horse.group.position;
    const horseIn = inPaddock(hp.x, hp.z);
    const girlIn = inPaddock(here.x, here.y);
    let lead = [];
    if (here.y > OUTSIDE_Z && here.x > ROOM.minX - 0.5 && here.x < ROOM.maxX + 0.5 && here.y < ROOM.maxZ) {
      const exit = body.exitRoute();
      lead = exit.concat(gardenPath(exit[exit.length - 1], VIA));
      here.copy(VIA);
    }
    if (horseIn && !girlIn) {
      // 馬場の入口から入る
      const toGate = here.x < -17 ? [] : (lead.length ? ROUTE : gardenPath(here, VIA).concat(ROUTE));
      path = [...lead, ...toGate, GATE_OUT, GATE_IN, target];
    } else if (!horseIn && girlIn) {
      path = [GATE_IN, GATE_OUT, target];
    } else if (Math.abs(here.x) < 6.5 && here.y < -4 && here.y > -14) {
      path = [...lead, ...gardenPath(here, target)];
    } else {
      path = [...lead, target];
    }
    voice?.say('horseInvite');
    state = 'toHorse';
  }

  let pathBest = Infinity;
  let pathStuck = 0;
  function followPath(dt, speed = WALK) {
    if (path.length === 0) { body.stand(dt); return true; }
    const d = Math.hypot(path[0].x - body.position.x, path[0].y - body.position.z);
    if (d < pathBest - 0.02) { pathBest = d; pathStuck = 0; } else pathStuck += dt;
    if (body.stepTowards(path[0], dt, d > 4 ? RUN : speed) || pathStuck > 0.8) {
      path.shift();
      pathBest = Infinity;
      pathStuck = 0;
    }
    return path.length === 0;
  }

  /** 鞍に座った体を、台の子にする */
  function attach() {
    if (attached) return;
    horse.girlPivot.add(character.group);
    attached = true;
  }
  function detach() {
    if (!attached) return;
    (scene ?? horse.group.parent).attach(character.group);
    attached = false;
    const f = tmp.set(0, 0, 1).applyQuaternion(character.group.quaternion);
    const yaw = Math.atan2(f.x, f.z);
    character.group.rotation.set(0, yaw, 0);
    body.setYaw(yaw);
  }
  /** 台のローカルで横乗り：体は左（+X）へ向けて、前へ 30° ひねる */
  const SIDE_YAW = Math.PI / 2 - 0.5;
  function sitLocal() {
    body.position.set(0, body.seatRootY(SEAT_TOP), 0);
    body.setYaw(SIDE_YAW);
    character.group.rotation.set(0, SIDE_YAW, 0);
    body.setSeat(1, 'upright', { skirt: true });
    body.setFootFloor(null);
    // 手は膝の上（スカートの前）にそろえる。馬の左から見ても、スカートの奥が見えないように
    horse.girlPivot.updateMatrixWorld(true);
    horse.girlPivot.localToWorld(left.set(Math.sin(SIDE_YAW) * 0.24 + Math.cos(SIDE_YAW) * 0.06, 0.15, Math.cos(SIDE_YAW) * 0.24 - Math.sin(SIDE_YAW) * 0.06));
    horse.girlPivot.localToWorld(right.set(Math.sin(SIDE_YAW) * 0.25 - Math.cos(SIDE_YAW) * 0.06, 0.16, Math.cos(SIDE_YAW) * 0.25 + Math.sin(SIDE_YAW) * 0.06));
    body.reachHands({ left: { target: left, amount: 1 }, right: { target: right, amount: 1 } });
    body.setGrip(0.3);
  }
  /** 見る所（台のローカル）：前か、振り返ってプレイヤー */
  function lookLocal(dt) {
    lookIn -= dt;
    if (lookIn < 0) { lookBack = lookBack > 0 ? 0 : 2.5; lookIn = lookBack > 0 ? 2.5 : 6 + Math.random() * 5; }
    if (lookBack > 0) lookBack -= dt;
    if (lookBack > 0 && playerHead) {
      playerHead(tmp);
      horse.girlPivot.worldToLocal(gaze.position.copy(tmp));
    } else {
      gaze.position.set(-0.1, 0.8, 8);
    }
    character.watch(gaze);
  }

  function update(dt) {
    if (!body.loaded) return;
    unwanted = playerRiding ? 0 : unwanted + dt;
    // 女の子が来ないときは、25 秒で馬を動けるようにする
    if (horse.hold) { waited += dt; if (waited > 25) horse.hold = false; }
    if (state !== 'off' && state !== 'ride' && state !== 'mount' && state !== 'dismount' && unwanted > 4) { stop(); return; }
    switch (state) {
      case 'off':
        return;
      case 'waitStand':
        if (!body.free && !body.driven) { body.requestStand(); break; }
        beginWalk();
        break;
      case 'toHorse': {
        if (playerHead) { playerHead(gaze.position); character.watch(gaze); }
        if (followPath(dt)) {
          // 最後に馬の左へ（馬が少し動いていても、いまの位置へ）
          horse.mountPoint(mountAt);
          if (body.stepTowards(new THREE.Vector2(mountAt.x, mountAt.z), dt, WALK)) {
            state = 'mount';
            timer = 0;
            from.copy(body.position);
            voice?.say('horseMount');
          }
        }
        break;
      }
      case 'mount': {
        // 馬の左から、鞍の前半分へ横に腰かける
        timer += dt;
        const k = Math.min(1, timer / MOUNT);
        const e = k * k * (3 - 2 * k);
        horse.girlPivot.updateMatrixWorld(true);
        horse.girlPivot.getWorldPosition(seat);
        seat.y += body.seatRootY(SEAT_TOP);
        // 高いので、一度上へ持ち上げてから座る
        body.position.lerpVectors(from, seat, e);
        body.position.y += Math.sin(Math.PI * k) * 0.25;
        body.turnTowards(horse.state.yaw + SIDE_YAW, dt * 3);
        body.setSeat(e, 'upright', { skirt: true });
        if (k >= 1) {
          attach();
          sitLocal();
          state = 'ride';
          horse.hold = false;
          voice?.say('horseRideStart');
          body.smile(2.5, 1);
          talkIn = 10;
        }
        break;
      }
      case 'ride': {
        sitLocal();
        body.setAttend(false);
        lookLocal(dt);
        talkIn -= dt;
        if (talkIn < 0) { voice?.say(horse.speed > 0.5 ? 'horseTandem' : 'horseTandemStop', { chance: 0.7 }); talkIn = 14 + Math.random() * 10; }
        if (!playerRiding) {
          detach();
          state = 'dismount';
          timer = 0;
          from.copy(body.position);
          horse.mountPoint(mountAt);
          voice?.say('horseDismount', { chance: 0.7 });
        }
        break;
      }
      case 'dismount': {
        timer += dt;
        const k = Math.min(1, timer / MOUNT);
        const e = k * k * (3 - 2 * k);
        body.position.lerpVectors(from, mountAt, e);
        body.position.y += Math.sin(Math.PI * k) * 0.15;
        body.setSeat(1 - e, 'upright', { skirt: true });
        if (k > 0.3) { body.reachHands(null); body.setGrip(0); }
        if (k >= 1) { body.setSeat(0, 'upright'); body.position.y = 0; finish(); }
        break;
      }
      default:
        break;
    }
  }

  function stop() {
    if (state === 'ride' || state === 'mount' || state === 'dismount') return;
    finish();
  }

  function finish() {
    detach();
    horse.hold = false;
    horse.setLeadRope(null);
    body.reachHands(null);
    body.reach(null);
    body.setGrip(0);
    body.setAttend(true);
    state = 'off';
    path = [];
    onFinish?.();
  }

  return {
    update,
    start,
    stop,
    /** 馬の歩様が替わった（horse.js の onGait から） */
    onGait(gait, prev = 0) {
      if (state !== 'ride') return;
      // 速くしたときだけ喜ぶ（駈歩から落としていくときに「はやあし！」と言わない）
      if (gait > 0 && gait < prev) return;
      if (gait === 2) voice?.say('horseTrot');
      else if (gait === 3) voice?.say('horseCanter');
      else if (gait === 0) voice?.say('horseHalt', { chance: 0.6 });
    },
    set onFinish(fn) { onFinish = fn; },
    set playerRiding(v) { playerRiding = Boolean(v); },
    get wanted() { return playerRiding; },
    get active() { return state !== 'off'; },
    get state() { return state; },
    get seated() { return state === 'ride'; },
  };
}
