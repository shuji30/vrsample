import * as THREE from 'three';
import { SEA_LEVEL } from './hill.js';
import { beachGround } from './beach.js';
import { PIER, onPier, pierDeckY } from './cruiser.js';

/**
 * クルーザーの島めぐり（女の子の側）。プレイヤーが桟橋の先の船に乗ると、女の子はビーチバレー
 * （やパラソルの下）をやめて、砂浜を東へ歩き、桟橋を渡って船に乗り、操縦席のベンチの左に座る。
 * 座ったら（cruiser.girlSeated）プレイヤーが操縦できる。
 *
 * 体（character.group）は、座っているあいだ船の席の台（cruiser.girlPivot）の子にして、船の揺れごと動かす
 * （horsegame.js と同じ。台のローカルで体の位置・向き・見る所を入れ、手の目標はワールドのまま）。
 * スカートは腿に沿わせて、手を膝の上に置く（向かいに誰もいないが、VR でのぞきこめないように）。
 *
 * 乗っているあいだは海や島を見て、ときどきプレイヤーの顔を見る。灯台の近く・島の近く・大きく曲がる・ぶつかるで声をあげ、
 * 沖へ出てから桟橋へ戻ってきたら「ついたー」。プレイヤーが降りると、女の子も桟橋へ上がり、桟橋を砂浜まで歩いて戻ってから
 * ビーチバレーへ戻す（ビーチバレーの側は桟橋を知らず、桟橋の上から浜へまっすぐ歩くと海に落ちるため）。
 * 途中で降りたとき（world.js が暗くしているあいだ）は、桟橋の上に立たせてから同じように戻る（dropAtPier）。
 */
const WALK = 1.25;
const RUN = 2.6;
const GET_IN = 1.3;
const SEAT_TOP = 0.0;
/** 桟橋の付け根の少し手前（砂浜の上）と、桟橋の先の T 字の手前 */
const ROOT = new THREE.Vector2(PIER.x, PIER.fromZ + 1.4);
const HEAD = new THREE.Vector2(PIER.x, PIER.headZ + 0.4);
/** パラソルといす（beach.js / seats.js）。西から来るときは、その海側を回る */
const PARASOL = new THREE.Vector2(6, -81);
/** 見どころ（hill.js の灯台と西の島） */
const LIGHTHOUSE = new THREE.Vector3(150, SEA_LEVEL + 8, -230);
const ISLAND = new THREE.Vector3(-260, SEA_LEVEL + 12, -520);

export function createCruiserGame({ character, cruiser, beach = null, voice = null, scene = null, playerHead = null }) {
  const body = character.body;
  let state = 'off';        // off / waitStand / toBoat / getIn / ride / getOut / back
  let path = [];
  let playerRiding = false;
  let unwanted = 0;
  let timer = 0;
  let onFinish = null;
  let attached = false;
  let lookMode = 'ahead';
  let lookFor = 4;
  let talkIn = 18;
  let saidLighthouse = false;
  let saidIsland = false;
  let saidBack = false;
  let wentFar = false;
  let turnCool = 0;
  const driver = { get state() { return `cruiser:${state}`; } };
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
    cruiser.girlBoard(board);
    path = [];
    if (!onPier(here.x, here.y)) {
      // パラソルの陸側を東へ抜けるなら、いすの海側を回る
      if (here.x < PARASOL.x + 1.5 && here.y > PARASOL.y - 3) path.push(new THREE.Vector2(PARASOL.x - 1.2, PARASOL.y - 2.6), new THREE.Vector2(PARASOL.x + 1.6, PARASOL.y - 2.6));
      path.push(ROOT.clone());
    }
    path.push(HEAD.clone(), new THREE.Vector2(board.x, board.z));
    cruiser.girlComing = true;
    voice?.say('cruiseInvite');
    state = 'toBoat';
  }

  let pathBest = Infinity;
  let pathStuck = 0;
  function followPath(dt) {
    if (path.length === 0) { body.stand(dt); return true; }
    const d = Math.hypot(path[0].x - body.position.x, path[0].y - body.position.z);
    if (d < pathBest - 0.02) { pathBest = d; pathStuck = 0; } else pathStuck += dt;
    const far = path.length > 1 && Math.hypot(board.x - body.position.x, board.z - body.position.z) > 8;
    if (body.stepTowards(path[0], dt, far ? RUN : WALK) || pathStuck > 0.8) {
      path.shift();
      pathBest = Infinity;
      pathStuck = 0;
    }
    return path.length === 0;
  }

  function attach() {
    if (attached) return;
    cruiser.girlPivot.add(character.group);
    attached = true;
  }
  function detach() {
    if (!attached) return;
    (scene ?? cruiser.group.parent).attach(character.group);
    attached = false;
    const f = tmp.set(0, 0, 1).applyQuaternion(character.group.quaternion);
    const yaw = Math.atan2(f.x, f.z);
    character.group.rotation.set(0, yaw, 0);
    body.setYaw(yaw);
  }
  /** 台のローカルで、前（船首）を向いて座る。手は膝の上 */
  function sitLocal() {
    body.position.set(0, body.seatRootY(SEAT_TOP), 0);
    body.setYaw(0);
    character.group.rotation.set(0, 0, 0);
    body.setSeat(1, 'upright', { skirt: true });
    body.setFootFloor(null);
    cruiser.girlPivot.updateMatrixWorld(true);
    // 手は左右の膝の上に（前は腰の前の真ん中へ寄せていて、肘が胴の中へ入り、腕が体にめり込んで見えた。
    // 太ももの上でもまだ右の肘が胴の後ろへ入ったので、膝まで出して腕を伸ばし気味にする）
    cruiser.girlPivot.localToWorld(left.set(0.085, 0.165, 0.31));
    cruiser.girlPivot.localToWorld(right.set(-0.085, 0.165, 0.31));
    body.reachHands({ left: { target: left, amount: 1 }, right: { target: right, amount: 1 } });
    body.setGrip(0.3);
  }
  // イルカ（world.js が setDolphins で渡す）。見つけた・跳んだで声をあげ、しばらくそっちを見る
  let dolphins = null;
  let saidDolphin = false;
  let dolphinJumpCool = 0;
  let dolphinLook = 0;
  const dolphinAt = new THREE.Vector3();
  function setDolphins(d) {
    dolphins = d;
    d.onJump = (x, z) => {
      if (state !== 'ride' || !cruiser.boat) return;
      const b = cruiser.boat.position;
      if (Math.hypot(x - b.x, z - b.z) > 45) return;
      dolphinAt.set(x, b.y + 1.5, z);
      dolphinLook = 2.5;
      if (dolphinJumpCool > 0) return;
      dolphinJumpCool = 14;
      voice?.say('cruiseDolphinJump');
      body.smile(2.5, 1);
      talkIn = Math.max(talkIn, 8);
    };
  }
  /** 見る所（台のローカル）：前の海・横の景色・プレイヤー */
  function lookLocal(dt) {
    lookFor -= dt;
    dolphinLook -= dt;
    if (dolphinLook > 0) {
      cruiser.girlPivot.worldToLocal(gaze.position.copy(dolphinAt));
      character.watch(gaze);
      return;
    }
    if (lookFor <= 0) {
      const r = Math.random();
      lookMode = voice?.speaking || r < 0.35 ? 'player' : r < 0.65 ? 'side' : 'ahead';
      lookFor = lookMode === 'player' ? 2.5 + Math.random() * 2 : 4 + Math.random() * 4;
    }
    // 島・灯台の近くでは、そっちを見る
    const scenic = cruiser.nearLighthouse ? LIGHTHOUSE : cruiser.nearIsland ? ISLAND : null;
    if (scenic && lookMode !== 'player') {
      cruiser.girlPivot.worldToLocal(gaze.position.copy(scenic));
    } else if (lookMode === 'player' && playerHead) {
      playerHead(tmp);
      cruiser.girlPivot.worldToLocal(gaze.position.copy(tmp));
    } else if (lookMode === 'side') {
      gaze.position.set(20, 0.6, 12);
    } else {
      gaze.position.set(0.2, 0.3, 30);
    }
    character.watch(gaze);
  }

  function talk(dt) {
    if (cruiser.phase !== 'cruising') return;
    const far = cruiser.dockDistance;
    dolphinJumpCool -= dt;
    // イルカが近く（50m 以内）に来た：はじめて見つけたとき
    if (dolphins && !saidDolphin) {
      const b = cruiser.boat.position;
      const n = dolphins.nearest(b.x, b.z, dolphinAt);
      if (n.distance < 50) {
        saidDolphin = true;
        dolphinAt.y = b.y + 1;
        dolphinLook = 3;
        voice?.say('cruiseDolphin');
        body.smile(2.5, 1);
        talkIn = Math.max(talkIn, 10);
        return;
      }
    }
    if (!saidLighthouse && cruiser.nearLighthouse) { saidLighthouse = true; voice?.say('cruiseLighthouse'); talkIn = Math.max(talkIn, 12); return; }
    if (!saidIsland && cruiser.nearIsland) { saidIsland = true; voice?.say('cruiseIsland'); body.smile(2, 1); talkIn = Math.max(talkIn, 12); return; }
    // 沖へ出て（150m より遠く）から戻ってきた：桟橋が近い・着いた
    if (far > 150) wentFar = true;
    if (wentFar && !saidBack && far < 60) { saidBack = true; voice?.say('cruiseBack', { chance: 0.8 }); return; }
    if (wentFar && saidBack && cruiser.atDock) {
      voice?.say('cruiseEnd');
      body.smile(2.5, 1);
      saidLighthouse = saidIsland = saidBack = wentFar = saidDolphin = false;
      talkIn = 20;
      return;
    }
    if (Math.abs(cruiser.turnRate) > 0.18 && Math.abs(cruiser.speed) > 6 && turnCool < 0) { turnCool = 25; voice?.say('cruiseTurn', { chance: 0.7 }); return; }
    turnCool -= dt;
    talkIn -= dt;
    if (talkIn < 0) { voice?.say(Math.abs(cruiser.speed) < 0.5 ? 'cruiseWait' : 'cruiseFun', { chance: 0.8 }); talkIn = 20 + Math.random() * 14; }
  }

  /** ぶつかった（cruiser.onBump から） */
  function onBump(speed) {
    if (state !== 'ride') return;
    voice?.say(speed > 4 ? 'cruiseBump' : 'jetBumpSoft');
    talkIn = Math.max(talkIn, 6);
  }

  function update(dt) {
    if (!body.loaded) return;
    unwanted = playerRiding ? 0 : unwanted + dt;
    if (state === 'waitStand' && unwanted > 1) { finish(); return; }
    // プレイヤーが降りた・待たずに船が出た：浜へ戻る
    if (state === 'toBoat' && (unwanted > 1 || cruiser.phase === 'cruising')) { goBack(); return; }
    // 戻る途中でまた乗った：もう一度船へ
    if (state === 'back' && playerRiding && cruiser.phase === 'boarding') { beginWalk(); return; }
    switch (state) {
      case 'off':
        return;
      case 'waitStand':
        if (!body.free && !body.driven) { body.requestStand(); break; }
        beginWalk();
        break;
      case 'toBoat': {
        body.position.y = floorAt(body.position.x, body.position.z);
        if (playerHead && path.length <= 1) { playerHead(gaze.position); character.watch(gaze); }
        if (followPath(dt) && cruiser.phase === 'boarding') {
          state = 'getIn';
          timer = 0;
          from.copy(body.position);
          voice?.say('cruiseReady');
        }
        break;
      }
      case 'getIn': {
        // 桟橋から船べりをまたいで、ベンチへ
        timer += dt;
        const k = Math.min(1, timer / GET_IN);
        const e = k * k * (3 - 2 * k);
        cruiser.girlPivot.updateMatrixWorld(true);
        cruiser.girlPivot.getWorldPosition(seat);
        seat.y += body.seatRootY(SEAT_TOP);
        body.position.lerpVectors(from, seat, e);
        body.position.y += Math.sin(Math.PI * k) * 0.35;
        body.turnTowards(cruiser.state.yaw, dt * 3);
        body.setSeat(Math.max(0, e * 1.4 - 0.4), 'upright', { skirt: true });
        if (k >= 1) {
          attach();
          sitLocal();
          state = 'ride';
          cruiser.girlSeated = true;
          cruiser.girlComing = false;
          wentFar = false;
          talkIn = 16;
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
          state = 'getOut';
          timer = 0;
          from.copy(body.position);
          cruiser.girlBoard(board);
        }
        break;
      case 'back':
        body.position.y = floorAt(body.position.x, body.position.z);
        if (followPath(dt)) finish();
        break;
      case 'getOut': {
        timer += dt;
        const k = Math.min(1, timer / GET_IN);
        const e = k * k * (3 - 2 * k);
        body.position.lerpVectors(from, board, e);
        body.position.y += Math.sin(Math.PI * k) * 0.3;
        body.setSeat(1 - e, 'upright', { skirt: true });
        if (k > 0.3) { body.reachHands(null); body.setGrip(0); }
        if (k >= 1) { body.setSeat(0, 'upright'); body.position.y = floorAt(board.x, board.z); goBack(); }
        break;
      }
      default:
        break;
    }
  }

  /** 途中で降りたとき（暗いあいだ）：桟橋の上に立たせる */
  function dropAtPier() {
    if (state === 'off') return;
    detach();
    cruiser.girlBoard(board);
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
    cruiser.girlSeated = false;
    cruiser.girlComing = false;
    body.setAttend(true);
    if (!onPier(body.position.x, body.position.z)) { finish(); return; }
    path = body.position.z < PIER.headZ + 0.3 ? [HEAD.clone(), ROOT.clone()] : [ROOT.clone()];
    pathBest = Infinity;
    pathStuck = -1.5;           // 振り向くぶんの猶予
    state = 'back';
  }

  function finish() {
    detach();
    cruiser.girlSeated = false;
    cruiser.girlComing = false;
    body.reachHands(null);
    body.reach(null);
    body.setGrip(0);
    body.setAttend(true);
    state = 'off';
    path = [];
    onFinish?.();
  }

  return {
    setDolphins,
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
