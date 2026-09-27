import * as THREE from 'three';
import { AIRFIELD_ZONE, PLATEAU } from './hill.js';
import { AIRFIELD_ARRIVAL, APRON, RUNWAY } from './cessna.js';

/**
 * 飛行場とセスナ（女の子の側）。プレイヤーが看板で飛行場へ行くと、女の子も（していた遊びをやめて）一緒に来る
 * （world.js が暗くしているあいだに移す）。飛行場では、プレイヤーのそばについて歩く。
 *
 * プレイヤーがセスナに乗ると、右のドアへ歩いていって右の席に座る（座るまで機体は動かない。来ないときは 30 秒で動く）。
 * 体（character.group）は、座っているあいだ機体の席の台（cessna.girlPivot）の子にする。スカートは腿に沿わせ、
 * 手を膝の上に置く。足は床の上に置く（setFootFloor）。
 *
 * 乗っているあいだは前・右の窓の外・プレイヤーを見る。離陸・高く上がったとき・丘の上（家）・海・サーキットの上・
 * 大きく旋回したとき・着陸で声をあげる。ぶつかって戻されたときは「びっくりした…」。
 * プレイヤーが降りると、右のドアから降りて、またそばにつく。プレイヤーが看板で丘の上へ戻ると、一緒に戻って
 * キャッチボールへ。
 */
const WALK = 1.3;
const RUN = 2.4;
const GET_IN = 1.4;
const SEAT_TOP = 0.0;
/** 飛行場の歩ける所（world.js の範囲と同じ） */
const WALKABLE = [
  { minX: APRON.minX + 0.5, maxX: APRON.maxX - 0.5, minZ: APRON.minZ - 23, maxZ: APRON.maxZ - 0.5 },
  { minX: RUNWAY.x0 + 0.5, maxX: RUNWAY.x1 - 0.5, minZ: RUNWAY.z - RUNWAY.width / 2 + 0.5, maxZ: RUNWAY.z + RUNWAY.width / 2 - 0.5 },
];
const inWalkable = (x, z) => WALKABLE.some((r) => x > r.minX && x < r.maxX && z > r.minZ && z < r.maxZ);

export function createCessnaGame({ character, cessna, voice = null, scene = null, playerHead = null }) {
  const body = character.body;
  let state = 'off';        // off / waitStand / idle / toPlane / getIn / ride / getOut
  let playerHere = false;
  let playerRiding = false;
  let timer = 0;
  let onFinish = null;
  let attached = false;
  let lookMode = 'ahead';
  let lookFor = 3;
  let talkIn = 16;
  let flight = {};
  const driver = { get state() { return `cessna:${state}`; } };
  const from = new THREE.Vector3();
  const seat = new THREE.Vector3();
  const door = new THREE.Vector3();
  const left = new THREE.Vector3();
  const right = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const goal = new THREE.Vector2();
  const gaze = new THREE.Object3D();
  gaze.userData = { held: false, velocity: new THREE.Vector3() };
  const Y = AIRFIELD_ZONE.y;

  function start() {
    if (state !== 'off') return;
    state = 'waitStand';
  }

  /** 飛行場に着いた（暗いあいだ）：看板の横に立たせる */
  function arrive() {
    body.drive(driver);
    body.setAttend(true);
    body.reach(null);
    body.reachHands(null);
    body.setThrowPose(null);
    body.setCrouch(0);
    body.setBend(0);
    body.setSeat(0, 'upright');
    body.position.set(AIRFIELD_ARRIVAL.x + 1.2, Y, AIRFIELD_ARRIVAL.z - 0.6);
    body.setYaw(-Math.PI / 2 - 0.4);
    state = 'idle';
    voice?.say('airfieldArrive');
  }

  function stepTo(x, z, dt, speed) {
    goal.set(x, z);
    const ok = body.stepTowards(goal, dt, speed);
    // 飛行場の歩ける所の外へは出ない
    if (!inWalkable(body.position.x, body.position.z)) {
      const r = WALKABLE.reduce((best, w) => {
        const cx = THREE.MathUtils.clamp(body.position.x, w.minX, w.maxX);
        const cz = THREE.MathUtils.clamp(body.position.z, w.minZ, w.maxZ);
        const d = Math.hypot(cx - body.position.x, cz - body.position.z);
        return d < best.d ? { d, cx, cz } : best;
      }, { d: Infinity, cx: 0, cz: 0 });
      body.position.x = r.cx;
      body.position.z = r.cz;
    }
    body.position.y = Y;
    return ok;
  }

  function attach() {
    if (attached) return;
    cessna.girlPivot.add(character.group);
    attached = true;
  }
  function detach() {
    if (!attached) return;
    (scene ?? cessna.group.parent).attach(character.group);
    attached = false;
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
    cessna.girlPivot.updateMatrixWorld(true);
    // 足は床の上（機体の床は席の 0.43m 下）
    cessna.girlPivot.localToWorld(tmp.set(0, -0.43, 0.3));
    body.setFootFloor(tmp.y);
    cessna.girlPivot.localToWorld(left.set(0.06, 0.13, 0.24));
    cessna.girlPivot.localToWorld(right.set(-0.06, 0.14, 0.25));
    body.reachHands({ left: { target: left, amount: 1 }, right: { target: right, amount: 1 } });
    body.setGrip(0.3);
  }
  function lookLocal(dt) {
    lookFor -= dt;
    if (lookFor <= 0) {
      const r = Math.random();
      lookMode = voice?.speaking || r < 0.3 ? 'player' : r < 0.65 ? 'window' : 'ahead';
      lookFor = lookMode === 'player' ? 2.5 : 3.5 + Math.random() * 4;
    }
    if (lookMode === 'player' && playerHead) {
      playerHead(tmp);
      cessna.girlPivot.worldToLocal(gaze.position.copy(tmp));
    } else if (lookMode === 'window') {
      gaze.position.set(-8, -2.5, 5);        // 右の窓の外、少し下
    } else {
      gaze.position.set(0.1, 0.4, 20);
    }
    character.watch(gaze);
  }

  function say(key, opts) { voice?.say(key, opts); talkIn = Math.max(talkIn, 7); }
  function talk(dt) {
    const p = cessna.position;
    const alt = cessna.altitude;
    if (!cessna.onGround) {
      if (!flight.high && alt > 140) { flight.high = true; say('cessnaHigh'); body.smile(2, 1); return; }
      const P = PLATEAU;
      if (!flight.house && p.x > P.minX - 40 && p.x < P.maxX + 40 && p.z > P.minZ - 40 && p.z < P.maxZ + 40) { flight.house = true; say('cessnaHouse'); return; }
      if (!flight.sea && p.z < -120) { flight.sea = true; say('cessnaSea'); return; }
      if (!flight.circuit && p.x > 150 && p.x < 950 && p.z > -130 && p.z < 140) { flight.circuit = true; say('cessnaCircuit'); return; }
      flight.turnCool = (flight.turnCool ?? 0) - dt;
      if (Math.abs(cessna.bank) > 0.48 && flight.turnCool < 0) { flight.turnCool = 25; say('cessnaTurn', { chance: 0.8 }); return; }
    } else if (!flight.roll && cessna.speed > 12) {
      flight.roll = true;
      say('cessnaRoll');
      return;
    }
    talkIn -= dt;
    if (talkIn < 0) { voice?.say(cessna.onGround ? 'cessnaWait' : 'cessnaFun', { chance: 0.8 }); talkIn = 20 + Math.random() * 14; }
  }

  function update(dt) {
    if (!body.loaded) return;
    switch (state) {
      case 'off':
        return;
      case 'waitStand':
        if (!body.free && !body.driven) { body.requestStand(); break; }
        arrive();
        break;
      case 'idle': {
        // プレイヤーのそばについて歩く（3m より離れたら）。乗ったら右のドアへ
        if (playerRiding) {
          state = 'toPlane';
          voice?.say('cessnaInvite');
          break;
        }
        if (playerHead) playerHead(tmp);
        const d = Math.hypot(tmp.x - body.position.x, tmp.z - body.position.z);
        if (playerHead && d > 3) stepTo(tmp.x, tmp.z, dt, d > 8 ? RUN : WALK);
        else body.stand(dt);
        if (playerHead) { gaze.position.copy(tmp); character.watch(gaze); }
        body.position.y = Y;
        break;
      }
      case 'toPlane': {
        if (!playerRiding) { state = 'idle'; break; }
        cessna.girlDoor(door);
        const far = Math.hypot(door.x - body.position.x, door.z - body.position.z) > 6;
        if (stepTo(door.x, door.z, dt, far ? RUN : WALK)) {
          state = 'getIn';
          timer = 0;
          from.copy(body.position);
          voice?.say('cessnaReady');
        }
        break;
      }
      case 'getIn': {
        timer += dt;
        const k = Math.min(1, timer / GET_IN);
        const e = k * k * (3 - 2 * k);
        cessna.girlPivot.updateMatrixWorld(true);
        cessna.girlPivot.getWorldPosition(seat);
        seat.y += body.seatRootY(SEAT_TOP);
        body.position.lerpVectors(from, seat, e);
        body.position.y += Math.sin(Math.PI * k) * 0.3;
        body.turnTowards(cessna.state.yaw, dt * 3);
        body.setSeat(Math.max(0, e * 1.4 - 0.4), 'upright', { skirt: true });
        if (k >= 1) {
          attach();
          sitLocal();
          state = 'ride';
          cessna.hold = false;
          flight = {};
          talkIn = 12;
          body.smile(2, 1);
        }
        break;
      }
      case 'ride':
        sitLocal();
        body.setAttend(false);
        lookLocal(dt);
        talk(dt);
        if (!playerRiding) {
          detach();
          body.setFootFloor(null);
          state = 'getOut';
          timer = 0;
          from.copy(body.position);
          cessna.girlDoor(door);
          voice?.say('cessnaBye', { chance: 0.7 });
        }
        break;
      case 'getOut': {
        timer += dt;
        const k = Math.min(1, timer / GET_IN);
        const e = k * k * (3 - 2 * k);
        body.position.lerpVectors(from, door, e);
        body.position.y += Math.sin(Math.PI * k) * 0.3;
        body.setSeat(1 - e, 'upright', { skirt: true });
        if (k > 0.3) { body.reachHands(null); body.setGrip(0); }
        // reachHands(null) は「いま手のある所」へ伸ばし続ける（片手の reach に戻る）ので、reach(null) で放す。
        // 放さないと、降りたあとも膝の上だった所へ腕が伸びたままになった（飛行場ではそのままそばにつくので、finish を通らない）
        if (k >= 1) { body.reach(null); body.setSeat(0, 'upright'); body.position.y = Y; body.setAttend(true); state = 'idle'; }
        break;
      }
      default:
        break;
    }
  }

  /** セスナの出来事（cessna.onEvent から） */
  function onEvent(kind) {
    if (state !== 'ride') return;
    if (kind === 'liftoff') { say('cessnaLiftoff'); body.smile(2.5, 1); }
    else if (kind === 'touchdown') { say('cessnaLanding'); flight = { roll: true }; }
    else if (kind === 'crash') { say('cessnaCrash'); flight = { roll: true }; }
  }

  /** 空で降りたとき（暗いあいだ。機体は止めておく所に戻っている）：右のドアの外に立たせる */
  function dropAtPlane() {
    if (state === 'off') return;
    detach();
    body.setFootFloor(null);
    body.reachHands(null);
    body.reach(null);
    body.setGrip(0);
    body.setSeat(0, 'upright');
    cessna.girlDoor(door);
    body.position.set(door.x, Y, door.z);
    body.setYaw(cessna.state.yaw + Math.PI / 2);
    body.setAttend(true);
    state = 'idle';
  }

  /** プレイヤーが丘の上へ戻った（暗いあいだ）：at の横に立たせて、終わる */
  function leave(at) {
    if (state === 'off') return;
    detach();
    body.setFootFloor(null);
    if (state !== 'waitStand') {
      body.position.set(at.x + 1.1, 0, at.z - 0.4);
      body.setYaw(Math.PI);
      body.setSeat(0, 'upright');
      voice?.say('airfieldLeave', { chance: 0.6 });
    }
    finish();
  }

  function finish() {
    detach();
    cessna.hold = false;
    body.reachHands(null);
    body.reach(null);
    body.setGrip(0);
    body.setAttend(true);
    state = 'off';
    onFinish?.();
  }

  return {
    update,
    start,
    leave,
    dropAtPlane,
    onEvent,
    set onFinish(fn) { onFinish = fn; },
    set playerHere(v) { playerHere = Boolean(v); },
    set playerRiding(v) { playerRiding = Boolean(v); },
    get wanted() { return playerHere; },
    get active() { return state !== 'off'; },
    get state() { return state; },
    get seated() { return state === 'ride'; },
  };
}
