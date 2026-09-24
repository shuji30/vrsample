import * as THREE from 'three';
import { ROOM } from './room.js';
import { gardenPath } from './catchball.js';
import { GATE, PADDOCK } from './stable.js';

/**
 * 乗馬体験（女の子の側）。プレイヤーが馬に乗ると、女の子は遊びをやめて馬場へ来る。
 *
 * はじめて乗ったときは「引き馬」：女の子が馬の頭の左を歩いて引き綱を持ち、馬場の内側の道を
 * 常歩で 1 周する（「せなかをまっすぐにね」など）。女の子が遅れると馬も待つ。1 周したら
 * （または乗り手が W を 1 秒押して急かしたら）引き綱を放して「こんどはひとりでのってみて！」。
 * そのあとは入口の外に立って見守り、速歩・駈歩になると喜ぶ。
 * 2 回目からは、はじめから入口の外で見守る。
 *
 * プレイヤーが降りてしばらくすると、女の子はキャッチボールへ戻る。
 *
 * 女の子は馬には乗らない（またがる姿勢は、短いスカートだと中が見えてしまうため。ポケバイと同じ）。
 */

const OUTSIDE_Z = ROOM.minZ - ROOM.wall - 0.25;
const WALK = 1.25;
const VIA = new THREE.Vector2(-5.6, -9.6);
/** 庭から馬場へ：遊具の手前 → 池とポケバイのコースのあいだ → 馬場の入口の外 */
const ROUTE = [new THREE.Vector2(-7.0, -6.6), new THREE.Vector2(-18.2, -6.6), new THREE.Vector2(-18.2, -17.5)];
const GATE_OUT = new THREE.Vector2(GATE.x + 0.3, GATE.z + 0.95);
const GATE_IN = new THREE.Vector2(GATE.x - 0.3, GATE.z - 0.85);
/** 見守る所（入口の右の柵の外） */
const SPOT = new THREE.Vector2(-21.0, -19.3);

export function createHorseGame({ character, horse, voice = null }) {
  const body = character.body;
  let state = 'off';
  let path = [];
  let playerRiding = false;
  let unwanted = 0;
  let onFinish = null;
  let leadDone = false;
  const driver = { get state() { return `horse:${state}`; } };
  const ideal = new THREE.Vector3();
  const hand = new THREE.Vector3();
  const palm = new THREE.Vector3();
  const target = new THREE.Vector2();
  const gaze = new THREE.Object3D();
  gaze.userData = { held: false, velocity: new THREE.Vector3() };

  function start() {
    if (state !== 'off') return;
    state = 'waitStand';
    unwanted = 0;
    // 引き馬のときは、女の子が来るまで馬は動かない
    if (!leadDone) { horse.lead = true; horse.leadSpeed = 0; }
  }

  function routeFrom(here) {
    // 池・馬場の側（x < -17）にいれば、そのまま入口へ
    if (here.x < -17) return [];
    return ROUTE;
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
    const tail = leadDone ? [SPOT] : [GATE_OUT, GATE_IN];
    const inside = ((here.x - PADDOCK.cx) / PADDOCK.rx) ** 2 + ((here.y - PADDOCK.cz) / PADDOCK.rz) ** 2 < 1;
    if (inside) path = leadDone ? [GATE_IN, GATE_OUT, SPOT] : [];
    else if (here.y > OUTSIDE_Z) {
      const exit = body.exitRoute();
      path = exit.concat(gardenPath(exit[exit.length - 1], VIA), ROUTE, tail);
    } else if (here.x < -17) path = [...tail];
    else path = gardenPath(here, VIA).concat(routeFrom(here), tail);
    voice?.say(leadDone ? 'horseWatchInvite' : 'horseInvite');
    state = leadDone ? 'toSpot' : 'toHorse';
  }

  let pathBest = Infinity;
  let pathStuck = 0;
  function followPath(dt, speed = WALK) {
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

  /** 引き綱を持つ右手（体の右前、腰の高さ） */
  function holdRope() {
    const y = body.yaw ?? 0;
    const g = body.position;
    hand.set(g.x + Math.sin(y) * 0.3 - Math.cos(y) * 0.22, 0.95, g.z + Math.cos(y) * 0.3 + Math.sin(y) * 0.22);
    body.reachHands({ right: { target: hand, amount: 1 } });
    body.palm('right', palm);
    horse.setLeadRope(palm);
  }

  let talkIn = 8;
  let cheerIn = 12;
  function update(dt) {
    if (!body.loaded) return;
    unwanted = playerRiding ? 0 : unwanted + dt;
    if (state !== 'off' && unwanted > 4) { stop(); return; }
    switch (state) {
      case 'off':
        return;
      case 'waitStand':
        if (!body.free && !body.driven) { body.requestStand(); break; }
        beginWalk();
        break;
      case 'toHorse': {
        // 入口を入ったら、馬の頭の左（引く位置）へ
        if (followPath(dt)) {
          horse.leadPoint(ideal);
          target.set(ideal.x, ideal.z);
          if (body.stepTowards(target, dt, WALK)) {
            state = 'lead';
            talkIn = 6;
            voice?.say('horseLeadStart');
          }
        }
        break;
      }
      case 'lead': {
        // 馬の頭の左を歩く。遅れたら馬が待つ
        horse.leadPoint(ideal);
        const y = horse.state.yaw;
        const fx = Math.sin(y);
        const fz = Math.cos(y);
        const dx = body.position.x - ideal.x;
        const dz = body.position.z - ideal.z;
        const along = dx * fx + dz * fz;          // 前に出ていれば正
        const off = Math.hypot(dx, dz);
        horse.leadSpeed = off < 0.55 ? 1.0 : off < 1.2 ? 0.45 : 0;
        target.set(ideal.x + fx * 0.8, ideal.z + fz * 0.8);
        body.stepTowards(target, dt, along > 0.3 ? 0.8 : along < -0.3 ? 1.35 : 1.05);
        holdRope();
        // 乗っているプレイヤーの顔を、ときどき見上げる
        horse.eye(gaze.position);
        character.watch(gaze);
        talkIn -= dt;
        if (talkIn < 0) { voice?.say('horseLeadTalk'); talkIn = 9 + Math.random() * 5; }
        if (horse.lapAngle > Math.PI * 2 || horse.skipRequested) {
          voice?.say(horse.skipRequested ? 'horseSkip' : 'horseRelease');
          horse.lead = false;
          horse.setLeadRope(null);
          body.reachHands(null);
          body.reach(null);   // reachHands(null) だけだと、両手で 1 点へ伸ばす形が残る
          leadDone = true;
          path = [GATE_IN, GATE_OUT, SPOT];
          state = 'toSpot';
        }
        break;
      }
      case 'toSpot':
        if (followPath(dt)) { state = 'watch'; cheerIn = 10; }
        break;
      case 'watch': {
        body.stand(dt);
        body.turnTowards(Math.atan2(horse.group.position.x - body.position.x, horse.group.position.z - body.position.z), dt);
        horse.eye(gaze.position);
        character.watch(gaze);
        cheerIn -= dt;
        if (cheerIn < 0 && horse.speed > 1) { voice?.say('horseCheer', { chance: 0.7 }); cheerIn = 14 + Math.random() * 10; }
        break;
      }
      default:
        break;
    }
  }

  function stop() {
    if (horse.lead) horse.lead = false;
    horse.setLeadRope(null);
    finish();
  }

  function finish() {
    body.reachHands(null);
    body.reach(null);
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
      if (state !== 'watch') return;
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
    get leadDone() { return leadDone; },
  };
}
