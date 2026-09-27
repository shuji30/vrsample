import * as THREE from 'three';
import { SEA_LEVEL } from './hill.js';
import { beachGround } from './beach.js';
import { PIER, onPier, pierDeckY } from './cruiser.js';

/**
 * ジェットスキー（女の子の側）。プレイヤーが桟橋の横のジェットスキーに乗ると、女の子はビーチバレー
 * （やパラソルの下）をやめて、砂浜を東へ走り、桟橋を渡って後ろの席に乗る。
 *
 * 後ろの席には横乗り（両脚を左へそろえて下ろし、体を前へ 30° ひねる）。またがると短いスカートの中が
 * 見えてしまうため（horsegame.js と同じ。手も膝の上にそろえる）。体（character.group）は、乗っているあいだ
 * 台（jetski.girlPivot）の子にして、傾き・揺れごと動かす。
 *
 * 乗っているあいだは前を見て、ときどきプレイヤーを見る。速いと喜び、急に曲がるとはしゃぎ、ぶつかると驚く。
 * プレイヤーが降りると、女の子も桟橋へ上がり、桟橋を砂浜まで歩いて戻ってから、ビーチバレーへ戻る。
 * 沖で降りたとき（world.js が暗くしているあいだ）は、桟橋の上に立たせてから同じように戻る（dropAtPier）。
 */
const WALK = 1.25;
const RUN = 2.6;
const GET_IN = 1.1;
const SEAT_TOP = 0.02;
const SIDE_YAW = Math.PI / 2 - 0.5;
const ROOT = new THREE.Vector2(PIER.x, PIER.fromZ + 1.4);
const PARASOL = new THREE.Vector2(6, -81);

export function createJetskiGame({ character, jetski, beach = null, voice = null, scene = null, playerHead = null }) {
  const body = character.body;
  let state = 'off';        // off / waitStand / toSki / getIn / ride / getOut / back
  let path = [];
  let playerRiding = false;
  let unwanted = 0;
  let timer = 0;
  let onFinish = null;
  let attached = false;
  let lookBack = 0;
  let lookIn = 5;
  let talkIn = 12;
  let fastSaid = 0;
  let turnSaid = 0;
  const driver = { get state() { return `jetski:${state}`; } };
  const from = new THREE.Vector3();
  const seat = new THREE.Vector3();
  const board = new THREE.Vector3();
  const left = new THREE.Vector3();
  const right = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const gaze = new THREE.Object3D();
  gaze.userData = { held: false, velocity: new THREE.Vector3() };

  const floorAt = (x, z) => (onPier(x, z) ? pierDeckY(x, z) : beachGround(x, z));

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
    body.setSeat(0, 'upright');
    // 丘の上にいたら（砂浜の遊びをしていなかったら）、階段の下から来る
    if (body.position.y > SEA_LEVEL + 8 && beach) {
      beach.bottomPoint(tmp);
      body.position.set(tmp.x - 0.9, beachGround(tmp.x - 0.9, tmp.z + 0.6), tmp.z + 0.6);
    }
    const here = new THREE.Vector2(body.position.x, body.position.z);
    jetski.girlBoard(board);
    path = [];
    if (!onPier(here.x, here.y)) {
      if (here.x < PARASOL.x + 1.5 && here.y > PARASOL.y - 3) path.push(new THREE.Vector2(PARASOL.x - 1.2, PARASOL.y - 2.6), new THREE.Vector2(PARASOL.x + 1.6, PARASOL.y - 2.6));
      path.push(ROOT.clone());
    }
    path.push(new THREE.Vector2(PIER.x, board.z + 0.4), new THREE.Vector2(board.x, board.z));
    pathBest = Infinity;
    pathStuck = 0;
    voice?.say('jetInvite');
    state = 'toSki';
  }

  let pathBest = Infinity;
  let pathStuck = 0;
  function followPath(dt) {
    if (path.length === 0) { body.stand(dt); return true; }
    const d = Math.hypot(path[0].x - body.position.x, path[0].y - body.position.z);
    if (d < pathBest - 0.02) { pathBest = d; pathStuck = 0; } else pathStuck += dt;
    const far = path.length > 1 && Math.hypot(board.x - body.position.x, board.z - body.position.z) > 6;
    if (body.stepTowards(path[0], dt, far ? RUN : WALK) || pathStuck > 0.8) {
      path.shift();
      pathBest = Infinity;
      pathStuck = 0;
    }
    return path.length === 0;
  }

  function attach() {
    if (attached) return;
    jetski.girlPivot.add(character.group);
    attached = true;
  }
  function detach() {
    if (!attached) return;
    (scene ?? jetski.group.parent).attach(character.group);
    attached = false;
    const f = tmp.set(0, 0, 1).applyQuaternion(character.group.quaternion);
    const yaw = Math.atan2(f.x, f.z);
    character.group.rotation.set(0, yaw, 0);
    body.setYaw(yaw);
  }
  /** 台のローカルで横乗り（horsegame.js と同じ形）。手は膝の上 */
  function sitLocal() {
    body.position.set(0, body.seatRootY(SEAT_TOP), 0);
    body.setYaw(SIDE_YAW);
    character.group.rotation.set(0, SIDE_YAW, 0);
    body.setSeat(1, 'upright', { skirt: true });
    body.setFootFloor(null);
    jetski.girlPivot.updateMatrixWorld(true);
    jetski.girlPivot.localToWorld(left.set(Math.sin(SIDE_YAW) * 0.24 + Math.cos(SIDE_YAW) * 0.06, 0.15, Math.cos(SIDE_YAW) * 0.24 - Math.sin(SIDE_YAW) * 0.06));
    jetski.girlPivot.localToWorld(right.set(Math.sin(SIDE_YAW) * 0.25 - Math.cos(SIDE_YAW) * 0.06, 0.16, Math.cos(SIDE_YAW) * 0.25 + Math.sin(SIDE_YAW) * 0.06));
    body.reachHands({ left: { target: left, amount: 1 }, right: { target: right, amount: 1 } });
    body.setGrip(0.3);
  }
  function lookLocal(dt) {
    lookIn -= dt;
    if (lookIn < 0) { lookBack = lookBack > 0 ? 0 : 2.2; lookIn = lookBack > 0 ? 2.2 : 5 + Math.random() * 5; }
    if (lookBack > 0) lookBack -= dt;
    if ((lookBack > 0 || voice?.speaking) && playerHead) {
      playerHead(tmp);
      jetski.girlPivot.worldToLocal(gaze.position.copy(tmp));
    } else {
      gaze.position.set(-0.3, 0.9, 10);
    }
    character.watch(gaze);
  }
  function talk(dt) {
    fastSaid -= dt;
    turnSaid -= dt;
    talkIn -= dt;
    const v = jetski.speed;
    if (v > 16 && fastSaid < 0) { voice?.say('jetFast'); body.smile(2, 1); fastSaid = 25; talkIn = Math.max(talkIn, 8); return; }
    if (Math.abs(jetski.turnRate) > 0.7 && v > 9 && turnSaid < 0) { voice?.say('jetTurn', { chance: 0.8 }); turnSaid = 12; talkIn = Math.max(talkIn, 6); return; }
    if (talkIn < 0) { voice?.say(v > 3 ? 'jetFun' : 'jetStop', { chance: 0.8 }); talkIn = 18 + Math.random() * 12; }
  }

  function update(dt) {
    if (!body.loaded) return;
    unwanted = playerRiding ? 0 : unwanted + dt;
    if (state === 'waitStand' && unwanted > 1) { finish(); return; }
    if (state === 'toSki' && unwanted > 1) { goBack(); return; }
    if (state === 'back' && playerRiding && jetski.atDock) { beginWalk(); return; }
    switch (state) {
      case 'off':
        return;
      case 'waitStand':
        if (!body.free && !body.driven) { body.requestStand(); break; }
        beginWalk();
        break;
      case 'toSki':
        body.position.y = floorAt(body.position.x, body.position.z);
        if (playerHead && path.length <= 1) { playerHead(gaze.position); character.watch(gaze); }
        // ジェットスキーが待っていないとき（女の子が来る前に 40 秒たって出ていった）は、浜へ戻る
        if (!jetski.hold && !jetski.atDock) { goBack(); break; }
        if (followPath(dt)) {
          state = 'getIn';
          timer = 0;
          from.copy(body.position);
          voice?.say('jetReady');
        }
        break;
      case 'getIn': {
        // 桟橋から、後ろの席へ横に腰かける（少し下りる）
        timer += dt;
        const k = Math.min(1, timer / GET_IN);
        const e = k * k * (3 - 2 * k);
        jetski.girlPivot.updateMatrixWorld(true);
        jetski.girlPivot.getWorldPosition(seat);
        seat.y += body.seatRootY(SEAT_TOP);
        body.position.lerpVectors(from, seat, e);
        body.position.y += Math.sin(Math.PI * k) * 0.2;
        body.turnTowards(jetski.state.yaw + SIDE_YAW, dt * 3);
        body.setSeat(Math.max(0, e * 1.4 - 0.4), 'upright', { skirt: true });
        if (k >= 1) {
          attach();
          sitLocal();
          state = 'ride';
          jetski.hold = false;
          voice?.say('jetGo');
          body.smile(2, 1);
          talkIn = 14;
          fastSaid = 6;
          turnSaid = 4;
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
          state = 'getOut';
          timer = 0;
          from.copy(body.position);
          jetski.girlBoard(board);
          voice?.say('jetBye', { chance: 0.7 });
        }
        break;
      case 'getOut': {
        timer += dt;
        const k = Math.min(1, timer / GET_IN);
        const e = k * k * (3 - 2 * k);
        body.position.lerpVectors(from, board, e);
        body.position.y += Math.sin(Math.PI * k) * 0.25;
        body.setSeat(1 - e, 'upright', { skirt: true });
        if (k > 0.3) { body.reachHands(null); body.setGrip(0); }
        if (k >= 1) { body.setSeat(0, 'upright'); body.position.y = floorAt(board.x, board.z); goBack(); }
        break;
      }
      case 'back':
        body.position.y = floorAt(body.position.x, body.position.z);
        if (followPath(dt)) finish();
        break;
      default:
        break;
    }
  }

  /** ぶつかった（jetski.onBump から） */
  function onBump(speed) {
    if (state !== 'ride') return;
    voice?.say(speed > 8 ? 'jetBump' : 'jetBumpSoft');
    talkIn = Math.max(talkIn, 6);
  }

  /** 沖で降りたとき（暗いあいだ）：桟橋の上に立たせる */
  function dropAtPier() {
    if (state === 'off') return;
    detach();
    jetski.girlBoard(board);
    body.position.set(board.x, floorAt(board.x, board.z), board.z);
    body.setYaw(0);             // 浜（+Z）を向けて立たせる（振り向くあいだ「進んでいない」と道を捨てないように）
    body.setSeat(0, 'upright');
    body.reachHands(null);
    body.setGrip(0);
    goBack();
  }
  /** 桟橋の上なら、付け根（砂浜）まで歩いてから終わる */
  function goBack() {
    detach();
    // 降りるときの reachHands(null) は「いま手のある所」へ伸ばし続けるので、ここで放す（桟橋を歩くあいだ腕が伸びたままにならないように）
    body.reach(null);
    body.setAttend(true);
    if (!onPier(body.position.x, body.position.z)) { finish(); return; }
    path = [ROOT.clone()];
    pathBest = Infinity;
    pathStuck = -1.5;           // 振り向くぶんの猶予
    state = 'back';
  }

  function finish() {
    detach();
    jetski.hold = false;
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
    dropAtPier,
    onBump,
    set onFinish(fn) { onFinish = fn; },
    set playerRiding(v) { playerRiding = Boolean(v); },
    get wanted() { return playerRiding; },
    get active() { return state !== 'off'; },
    get state() { return state; },
    get seated() { return state === 'ride'; },
  };
}
