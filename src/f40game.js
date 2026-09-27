import * as THREE from 'three';
import { ROOM } from './room.js';
import { gardenPath } from './catchball.js';
import { GT3_SEAT } from './gt3.js';
import { F40_PARK } from './roaddata.js';
import { LOOP_OFS, RAMP_OFS } from './road.js';

/**
 * F40 ふうの車でドライブ（女の子の側）。プレイヤーがガレージの車の運転席に座ると、女の子はしていた遊びをやめて
 * ガレージへ歩いてきて、助手席に座る（座るまでは車が動かない。来ないときは 30 秒で動けるようにする。world.js）。
 *
 * 屋根のある車なので、スカートは腿に沿わせるだけでよい（カートと同じ座り方 'kart'）。手は膝の上。
 * 体は毎フレーム、車の助手席の位置へ置く（gt3race.js の女の子の車と同じやり方。車の子にはしない）。
 *
 * 乗っているあいだは前・窓の外・プレイヤーを見る。ガレージを出る・高速道路に乗る・速い（120 / 200km/h）・
 * 海の上・飛行場の横・大きく曲がる・ガレージに戻る、で声をあげる。プレイヤーが降りると、女の子も降りて庭へ戻る。
 *
 * 歩く道：部屋にいれば掃き出し窓から出て、庭の中は gardenPath、庭の東の端から家の東の芝生を通って
 * （飾ってある GT3 の南をまわって）、ガレージの西の入り口から助手席のドアの外へ。
 */
const OUTSIDE_Z = ROOM.minZ - ROOM.wall - 0.25;
const WALK = 1.25;
const RUN = 2.2;
const GET_IN = 1.2;
const SEAT_TOP = 0.42;
const GARDEN_EAST = new THREE.Vector2(5.6, -4.9);
// 家の東のビリヤードの部屋（x 8.84 まで）の北東の角の外を回る
const TO_GARAGE = [new THREE.Vector2(9.8, -3.4), new THREE.Vector2(11, 2.3), new THREE.Vector2(17.6, 2.6), new THREE.Vector2(19.0, 4.95)];

export function createF40Game({ character, car, voice = null, playerHead = null, isNight = () => false }) {
  const body = character.body;
  let state = 'off';        // off / waitStand / toCar / getIn / ride / getOut
  let path = [];
  let playerRiding = false;
  let unwanted = 0;
  let timer = 0;
  let onFinish = null;
  let lookMode = 'ahead';
  let lookFor = 3;
  let talkIn = 14;
  let said = {};
  let cool = {};
  const driver = { get state() { return `f40:${state}`; } };
  const from = new THREE.Vector3();
  const seat = new THREE.Vector3();
  const door = new THREE.Vector3();
  const left = new THREE.Vector3();
  const right = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const gaze = new THREE.Object3D();
  gaze.userData = { held: false, velocity: new THREE.Vector3() };

  /** 助手席のドアの外（車のローカルで右 1.35m） */
  function doorPoint(out) {
    car.group.updateMatrixWorld(true);
    car.group.localToWorld(out.set(-GT3_SEAT.x - 0.95, 0, GT3_SEAT.z));
    out.y = car.group.position.y;
    return out;
  }
  function seatPoint(out) {
    car.group.updateMatrixWorld(true);
    return car.group.localToWorld(out.set(-GT3_SEAT.x, body.seatRootY(SEAT_TOP), GT3_SEAT.z));
  }

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
    body.setSeat(0, 'kart');
    let here = new THREE.Vector2(body.position.x, body.position.z);
    let lead = [];
    if (here.y > OUTSIDE_Z && here.x > ROOM.minX - 0.5 && here.x < ROOM.maxX + 0.5 && here.y < ROOM.maxZ) {
      const exit = body.exitRoute();
      lead = exit;
      here = exit[exit.length - 1].clone();
    }
    // 庭・公園の側（家より北）にいれば、庭の東の端まで障害物をよけて。家の東の芝生・南にいれば、そのまま
    if (here.y < -4.2) lead = lead.concat(gardenPath(here, GARDEN_EAST));
    const rest = here.x > 17 ? TO_GARAGE.slice(-1) : TO_GARAGE;
    doorPoint(door);
    path = [...lead, ...rest.map((p) => p.clone()), new THREE.Vector2(door.x, door.z)];
    voice?.say('f40Invite');
    state = 'toCar';
  }

  let pathBest = Infinity;
  let pathStuck = 0;
  function followPath(dt) {
    if (path.length === 0) { body.stand(dt); return true; }
    const d = Math.hypot(path[0].x - body.position.x, path[0].y - body.position.z);
    if (d < pathBest - 0.02) { pathBest = d; pathStuck = 0; } else pathStuck += dt;
    const far = Math.hypot(door.x - body.position.x, door.z - body.position.z) > 8;
    if (body.stepTowards(path[0], dt, far ? RUN : WALK) || pathStuck > 0.8) {
      path.shift();
      pathBest = Infinity;
      pathStuck = 0;
    }
    return path.length === 0;
  }

  function sit() {
    seatPoint(seat);
    body.position.copy(seat);
    body.setYaw(car.state.yaw);
    body.setSeat(1, 'kart');
    car.group.localToWorld(left.set(-GT3_SEAT.x + 0.06, 0.62, GT3_SEAT.z + 0.28));
    car.group.localToWorld(right.set(-GT3_SEAT.x - 0.06, 0.63, GT3_SEAT.z + 0.29));
    body.reachHands({ left: { target: left, amount: 1 }, right: { target: right, amount: 1 } });
    body.setGrip(0.3);
  }
  function look(dt) {
    lookFor -= dt;
    if (lookFor <= 0) {
      const r = Math.random();
      lookMode = voice?.speaking || r < 0.3 ? 'player' : r < 0.55 ? 'window' : 'ahead';
      lookFor = lookMode === 'player' ? 2.2 : 3 + Math.random() * 4;
    }
    const yaw = car.state.yaw;
    const p = car.group.position;
    if (lookMode === 'player' && playerHead) playerHead(gaze.position);
    else if (lookMode === 'window') gaze.position.set(p.x + Math.sin(yaw - 1.2) * 20, p.y + 1, p.z + Math.cos(yaw - 1.2) * 20);
    else gaze.position.set(p.x + Math.sin(yaw) * 25, p.y + 1.1, p.z + Math.cos(yaw) * 25);
    character.watch(gaze);
  }
  function say(key, opts) { voice?.say(key, opts); talkIn = Math.max(talkIn, 7); }
  function talk(dt) {
    const v = car.speed * 3.6;
    const p = car.group.position;
    const onLoop = car.state.s >= LOOP_OFS && car.state.s < RAMP_OFS;
    const onRamp = car.state.s >= RAMP_OFS;
    for (const k of Object.keys(cool)) cool[k] -= dt;
    if (!said.out && Math.hypot(p.x - F40_PARK.x, p.z - F40_PARK.z) > 8) { said.out = true; say('f40Start'); return; }
    if (!said.hwy && onLoop) { said.hwy = true; say(isNight() ? 'f40Night' : 'f40Highway'); body.smile(2, 1); return; }
    // ループ橋（ガレージへ戻る出口）をぐるっと回るとき
    if (onRamp && !(cool.ramp > 0) && Math.abs(car.state.steer) > 0.25) { cool.ramp = 60; say('f40Ramp'); body.smile(2, 1); return; }
    if (v > 200 && !(cool.vfast > 0)) { cool.vfast = 40; say('f40VeryFast'); return; }
    if (v > 120 && !(cool.fast > 0)) { cool.fast = 60; say('f40Fast'); body.smile(2, 1); return; }
    if (onLoop && !said.sea && p.z < -200) { said.sea = true; say('f40Sea'); return; }
    if (onLoop && !said.air && p.z > 280 && p.x < -150) { said.air = true; say('f40Airfield'); return; }
    if (Math.abs(car.state.steer) > 0.6 && v > 60 && !(cool.corner > 0)) { cool.corner = 20; say('f40Corner', { chance: 0.8 }); return; }
    if (said.hwy && !said.home && !onLoop && Math.hypot(p.x - F40_PARK.x, p.z - F40_PARK.z) < 3 && Math.abs(car.speed) < 0.5) { said.home = true; say('f40Home'); return; }
    talkIn -= dt;
    if (talkIn < 0) { voice?.say(Math.abs(car.speed) < 0.5 ? 'f40Wait' : 'f40Fun', { chance: 0.8 }); talkIn = 22 + Math.random() * 14; }
  }

  function update(dt) {
    if (!body.loaded) return;
    unwanted = playerRiding ? 0 : unwanted + dt;
    if ((state === 'waitStand' || state === 'toCar') && unwanted > 1) { finish(); return; }
    switch (state) {
      case 'off':
        return;
      case 'waitStand':
        if (!body.free && !body.driven) { body.requestStand(); break; }
        beginWalk();
        break;
      case 'toCar':
        if (playerHead && path.length <= 2) { playerHead(gaze.position); character.watch(gaze); }
        if (followPath(dt)) {
          state = 'getIn';
          timer = 0;
          from.copy(body.position);
          voice?.say('f40Ready');
        }
        break;
      case 'getIn': {
        // ドアの外から、低い助手席へ腰を落とす
        timer += dt;
        const k = Math.min(1, timer / GET_IN);
        const e = k * k * (3 - 2 * k);
        seatPoint(seat);
        body.position.lerpVectors(from, seat, e);
        body.turnTowards(car.state.yaw, dt * 3);
        body.setSeat(Math.max(0, e * 1.3 - 0.3), 'kart');
        if (k >= 1) {
          sit();
          state = 'ride';
          said = {};
          cool = {};
          talkIn = 12;
          body.smile(2, 1);
        }
        break;
      }
      case 'ride':
        sit();
        body.setAttend(false);
        look(dt);
        talk(dt);
        if (!playerRiding) {
          state = 'getOut';
          timer = 0;
          from.copy(body.position);
          doorPoint(door);
          voice?.say('f40Bye', { chance: 0.7 });
        }
        break;
      case 'getOut': {
        timer += dt;
        const k = Math.min(1, timer / GET_IN);
        const e = k * k * (3 - 2 * k);
        body.position.lerpVectors(from, door, e);
        body.setSeat(1 - e, 'kart');
        if (k > 0.3) { body.reachHands(null); body.setGrip(0); }
        if (k >= 1) { body.setSeat(0, 'kart'); body.position.y = 0; finish(); }
        break;
      }
      default:
        break;
    }
  }

  /** 高速道路で降りたとき（暗いあいだ。車はガレージに戻っている）：助手席のドアの外に立たせる */
  function dropAtGarage() {
    if (state === 'off') return;
    doorPoint(door);
    body.position.set(door.x, 0, door.z);
    body.setYaw(car.state.yaw + Math.PI / 2);
    body.setSeat(0, 'kart');
    finish();
  }

  function finish() {
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
    dropAtGarage,
    set onFinish(fn) { onFinish = fn; },
    set playerRiding(v) { playerRiding = Boolean(v); },
    get wanted() { return playerRiding; },
    get active() { return state !== 'off'; },
    get state() { return state; },
    get seated() { return state === 'ride'; },
  };
}
