import * as THREE from 'three';
import { ROOM } from './room.js';
import { gardenPath } from './catchball.js';
import { CAROUSEL } from './carousel.js';
import { FERRIS } from './ferriswheel.js';

/**
 * パットパットゴルフ（女の子・順番・打ち方）。プレイヤーが観覧車の南の芝地（golf.js）へ入ると、
 * 女の子もしていた遊びをやめて歩いてきて、1 番ホールから交互に打つ。
 *
 * 順番：はじめはプレイヤー。そのあとは、まだ入れていない人のうち、カップから遠いほう（ゴルフのきまり）。
 * 7 打で入らなければ、そこで終わり（7 と数える）。二人とも終わったら次のホールへ（球はティーへ移る）。
 * 6 ホール回ったら合計で勝ち負けを言い、プレイヤーがまだいれば 10 秒で 1 番ホールからもう一度。
 * プレイヤーが芝地から 5 秒出ていたら、やめてキャッチボールへ戻る。
 *
 * プレイヤーの打ち方：
 * - VR：右手にパターを持つ（コントローラーの向きがシャフト）。自分の番に、ヘッドを球に当てると、
 *   当たったときのヘッドの速さ（水平）で転がる
 * - PC：自分の番になると、視点が球の後ろへ移る（ドラッグで球のまわりを回って狙う）。スペースを押している
 *   あいだ強さがたまり、離すと打つ。パターは球の後ろに見える
 * 女の子：自分の球の横に立ち、カップ（曲がったホールは曲がり角）を少しのずれで狙う。強さは距離と上りから。
 */
const OUTSIDE_Z = ROOM.minZ - ROOM.wall - 0.25;
const WALK = 1.3;
const GARDEN_EDGE = new THREE.Vector2(-6.2, -4.8);
const ROUTE = [
  new THREE.Vector2(-9.0, -5.2),
  new THREE.Vector2(CAROUSEL.x - 2, -5.2),
  new THREE.Vector2(CAROUSEL.x - 5.6, -4.6),
  new THREE.Vector2(FERRIS.x + 4.6, FERRIS.z - 2.2),
  new THREE.Vector2(FERRIS.x + 4.4, FERRIS.z + 7.5),
  new THREE.Vector2(-19.2, 15.8),
];

export function createGolfGame({ character, golf, voice = null, playerHead, camera = null }) {
  let controllers = null;
  let desktop = null;
  let isXR = () => false;
  const body = character.body;
  let state = 'off';            // off / waitStand / toCourse / play
  let playerHere = false;
  let awayFor = 0;
  let onFinish = null;
  let path = [];
  let turn = 'player';          // player / girl
  let phase = 'aim';            // aim / rolling / holeDone / finished
  let timer = 0;
  let girlStep = 'walk';        // walk / address / back / through / watch
  let girlAim = new THREE.Vector2();
  let girlSpeed = 0;
  let scores = [[], []];
  let charge = 0;
  let charging = false;
  let pcTurnSet = false;
  const driver = { get state() { return `golf:${state}:${phase}:${turn}`; } };
  const gaze = new THREE.Object3D();
  gaze.userData = { held: false, velocity: new THREE.Vector3() };
  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();
  const head = new THREE.Vector3();
  const prevHead = new THREE.Vector3();
  let hadHead = false;
  let hitCool = 0;
  const left = new THREE.Vector3();
  const right = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const m4 = new THREE.Matrix4();
  const up = new THREE.Vector3(0, 1, 0);

  const P = () => golf.balls[0];
  const Gb = () => golf.balls[1];
  const cup = () => golf.hole.cup;
  const done = (b) => b.inCup || b.strokes >= 7;
  const distCup = (b) => Math.hypot(b.x - cup()[0], b.z - cup()[1]);
  const totals = () => scores.map((l) => l.reduce((a, v) => a + (v ?? 0), 0));

  function start() {
    if (state !== 'off') return;
    state = 'waitStand';
    golf.current = 0;
    golf.resetBalls();
    scores = [[], []];
    golf.drawBoard(scores, totals());
    turn = 'player';
    phase = 'aim';
    pcTurnSet = false;
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
    let lead = [];
    let route = ROUTE;
    if (here.y > OUTSIDE_Z && here.x > ROOM.minX - 0.5 && here.x < ROOM.maxX + 0.5) {
      const exit = body.exitRoute();
      lead = exit.concat(gardenPath(exit[exit.length - 1], GARDEN_EDGE));
    } else if (here.x > -6.5) {
      lead = gardenPath(here, GARDEN_EDGE);
    } else {
      route = ROUTE.filter((p) => p.x < here.x - 0.5 || p.y > here.y + 0.5);
    }
    path = [...lead, ...route.map((p) => p.clone())];
    voice?.say('golfInvite');
    state = 'toCourse';
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

  // --- 女の子の打ち方 -------------------------------------------------------
  /** 狙う点：カップが見えればカップ、見えなければ曲がり角 */
  function aimPoint(b) {
    const [cx, cz] = cup();
    if (golf.clear(b.x, b.z, cx, cz)) return { x: cx, z: cz, toCup: true };
    const aims = golf.hole.aim ?? [];
    for (const [ax, az] of aims) if (golf.clear(b.x, b.z, ax, az)) return { x: ax, z: az, toCup: false };
    return { x: cx, z: cz, toCup: true };
  }
  function planGirl() {
    const b = Gb();
    const a = aimPoint(b);
    let dx = a.x - b.x;
    let dz = a.z - b.z;
    const d = Math.hypot(dx, dz);
    dx /= d; dz /= d;
    // ずれ：向きは ±3°、強さは ±12%（近いほど正確）
    const err = (Math.random() - 0.5) * 2 * THREE.MathUtils.degToRad(1 + Math.min(4, d * 0.8));
    const c = Math.cos(err);
    const s = Math.sin(err);
    girlAim.set(dx * c - dz * s, dx * s + dz * c);
    const dh = golf.laneY(a.x, a.z) - golf.laneY(b.x, b.z);
    // 橋のこぶは越えられるだけの速さを足す
    const hump = golf.hole.bridge && b.z < 21 ? 0.24 : 0;
    const want = a.toCup ? d + 0.35 : d + 0.9;
    girlSpeed = golf.speedFor(want, Math.max(dh, hump)) * (0.94 + Math.random() * 0.2);
    if (golf.hole.windmill && b.z < 21) girlSpeed = Math.max(girlSpeed, golf.speedFor(d + 0.6));
  }
  /** 立つ所：球の横（右打ち。狙う向きが体の左） */
  function stance(out) {
    const b = Gb();
    const fx = -girlAim.y;
    const fz = girlAim.x;
    return out.set(b.x - fx * 0.42, 0, b.z - fz * 0.42);
  }
  function placeGirlPutter(back) {
    const b = Gb();
    const fx = -girlAim.y;
    const fz = girlAim.x;
    // グリップはおなかの前、ヘッドは球の後ろ（back だけ引く）
    const grip = tmp.set(body.position.x + fx * 0.28, 0.78, body.position.z + fz * 0.28);
    const headAt = tmp2.set(b.x - girlAim.x * (0.05 + back), golf.laneY(b.x, b.z), b.z - girlAim.y * (0.05 + back));
    const shaft = grip.clone().sub(headAt).normalize();
    const side = new THREE.Vector3(girlAim.x, 0, girlAim.y);
    const zAxis = new THREE.Vector3().crossVectors(side, shaft).normalize();
    const xAxis = new THREE.Vector3().crossVectors(shaft, zAxis).normalize();
    m4.makeBasis(xAxis, shaft, zAxis);
    golf.girlPutter.quaternion.setFromRotationMatrix(m4);
    golf.girlPutter.position.copy(headAt);
    golf.girlPutter.visible = true;
    // 両手でグリップを握る
    golf.girlPutter.updateMatrixWorld(true);
    golf.girlPutter.localToWorld(left.set(0, 0.8, 0));
    golf.girlPutter.localToWorld(right.set(0, 0.7, 0));
    body.reachHands({ left: { target: left, amount: 1 }, right: { target: right, amount: 1 } });
    body.setGrip(1);
  }

  function girlTurn(dt) {
    const b = Gb();
    timer += dt;
    switch (girlStep) {
      case 'walk': {
        const at = stance(tmp);
        body.setBend(0);
        // 遠いとき（次のホール・入口から）は少し急ぐ
        const far = Math.hypot(at.x - body.position.x, at.z - body.position.z) > 3;
        if (body.stepTowards(new THREE.Vector2(at.x, at.z), dt, far ? 1.8 : WALK) || timer > 20) { girlStep = 'address'; timer = 0; }
        watchPoint(b.x, golf.laneY(b.x, b.z), b.z);
        break;
      }
      case 'address': {
        const at = stance(tmp);
        body.position.x += (at.x - body.position.x) * Math.min(1, dt * 4);
        body.position.z += (at.z - body.position.z) * Math.min(1, dt * 4);
        body.turnTowards(Math.atan2(-girlAim.y, girlAim.x), dt * 2);
        body.stand(dt);
        body.setBend(0.35);
        placeGirlPutter(0);
        // カップのほうを見てから、球を見る
        if (timer < 0.8) watchPoint(cup()[0], golf.laneY(...cup()), cup()[1]);
        else watchPoint(b.x, golf.laneY(b.x, b.z), b.z);
        // 風車は羽根が開いてから
        if (timer > 1.4 && (!golf.hole.windmill || b.z > 21 || golf.millOpen)) { girlStep = 'back'; timer = 0; }
        break;
      }
      case 'back': {
        const k = Math.min(1, timer / 0.6);
        placeGirlPutter(k * THREE.MathUtils.clamp(girlSpeed / 12, 0.05, 0.3));
        watchPoint(b.x, golf.laneY(b.x, b.z), b.z);
        if (k >= 1) { girlStep = 'through'; timer = 0; }
        break;
      }
      case 'through': {
        const k = Math.min(1, timer / 0.18);
        placeGirlPutter((1 - k) * THREE.MathUtils.clamp(girlSpeed / 12, 0.05, 0.3) - k * 0.05);
        if (k >= 1) {
          golf.strike(1, girlAim.x * girlSpeed, girlAim.y * girlSpeed);
          phase = 'rolling';
          girlStep = 'watch';
          timer = 0;
        }
        break;
      }
      default:
        break;
    }
  }

  function watchPoint(x, y, z) {
    gaze.position.set(x, y, z);
    character.watch(gaze);
  }

  /** 見ている所：プレイヤーの番はプレイヤーの球、転がっているあいだは転がっている球 */
  function spectate(dt) {
    body.reachHands(null);
    body.setGrip(0);
    body.setBend(0);
    golf.girlPutter.visible = false;
    const b = P();
    // プレイヤーの番は、女の子は自分の球の少し後ろに立って見ている
    const g = Gb();
    const stand = new THREE.Vector2(g.x - 0.6, g.z - 0.5);
    if (Math.hypot(body.position.x - stand.x, body.position.z - stand.y) > 0.35) body.stepTowards(stand, dt, WALK);
    else { body.stand(dt); body.turnTowards(Math.atan2(b.x - body.position.x, b.z - body.position.z), dt); }
    watchPoint(b.x, golf.laneY(b.x, b.z), b.z);
  }

  // --- プレイヤーの打ち方 ----------------------------------------------------
  function rightHand() {
    if (!controllers) return null;
    return controllers.find((c) => c.userData.handedness === 'right') ?? controllers[1] ?? null;
  }
  /** VR：パターを右手に。シャフトはコントローラーの前（-Z）へ伸びる */
  function holdPutterVR(dt) {
    const hand = rightHand();
    const pt = golf.playerPutter;
    if (!hand?.visible) { pt.visible = false; hadHead = false; return; }
    pt.visible = true;
    hand.updateMatrixWorld(true);
    hand.getWorldQuaternion(q);
    // パターの +Y（ヘッド → グリップ）を、コントローラーの +Z（手前）へ
    pt.quaternion.copy(q).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2));
    hand.getWorldPosition(tmp);
    pt.position.copy(tmp).sub(new THREE.Vector3(0, 0.76, 0).applyQuaternion(pt.quaternion));
    pt.updateMatrixWorld(true);
    pt.userData.head.getWorldPosition(head);
    // 自分の番に、ヘッドが球をかすめたら打つ（前のフレームからの線分で見る）
    hitCool = Math.max(0, hitCool - dt);
    const b = P();
    if (hadHead && turn === 'player' && phase === 'aim' && !b.moving && !b.inCup && hitCool === 0 && dt > 0) {
      const bx = b.x;
      const by = golf.laneY(b.x, b.z) + 0.03;
      const bz = b.z;
      const seg = tmp2.subVectors(head, prevHead);
      const L2 = seg.lengthSq();
      let t = L2 > 1e-8 ? ((bx - prevHead.x) * seg.x + (by - prevHead.y) * seg.y + (bz - prevHead.z) * seg.z) / L2 : 1;
      t = Math.max(0, Math.min(1, t));
      const cx = prevHead.x + seg.x * t;
      const cy = prevHead.y + seg.y * t;
      const cz = prevHead.z + seg.z * t;
      // ヘッドは長さ 10cm：横は 8cm（半分の長さ＋球の半径）、高さは 6cm 以内なら当たり
      const flat = Math.hypot(cx - bx, cz - bz);
      const vx = seg.x / dt;
      const vz = seg.z / dt;
      if (flat < 0.08 && Math.abs(cy - by) < 0.06 && Math.hypot(vx, vz) > 0.15) {
        golf.strike(0, vx * 1.1, vz * 1.1);
        phase = 'rolling';
        hitCool = 1;
      }
    }
    prevHead.copy(head);
    hadHead = true;
  }

  /** PC：視点を球の後ろへ（カップか曲がり角のほうを向いて） */
  function pcBehindBall() {
    if (!desktop || !camera) return;
    const b = P();
    const a = aimPoint(b);
    let dx = a.x - b.x;
    let dz = a.z - b.z;
    const d = Math.hypot(dx, dz) || 1;
    dx /= d; dz /= d;
    const y = golf.laneY(b.x, b.z);
    camera.position.set(b.x - dx * 1.8, y + 1.35, b.z - dz * 1.8);
    desktop.controls.target.set(b.x, y + 0.05, b.z);
    desktop.controls.update();
  }
  function pcAimDir(out) {
    const b = P();
    camera.getWorldPosition(tmp);
    out.set(b.x - tmp.x, 0, b.z - tmp.z).normalize();
    return out;
  }
  function placePutterPC(back) {
    const b = P();
    const aim = pcAimDir(new THREE.Vector3());
    const side = new THREE.Vector3().crossVectors(aim, up).normalize();
    const shaft = new THREE.Vector3().copy(up).addScaledVector(aim, -0.45).normalize();
    const zAxis = new THREE.Vector3().crossVectors(side.clone().negate(), shaft).normalize();
    m4.makeBasis(side.clone().negate(), shaft, zAxis);
    const pt = golf.playerPutter;
    pt.quaternion.setFromRotationMatrix(m4);
    pt.position.set(b.x - aim.x * (0.05 + back), golf.laneY(b.x, b.z), b.z - aim.z * (0.05 + back));
    pt.visible = true;
  }
  let throughFor = 0;
  function pcTurn(dt) {
    const b = P();
    if (!pcTurnSet) { pcBehindBall(); pcTurnSet = true; charge = 0; charging = false; }
    if (charging) charge = Math.min(1, charge + dt * 0.75);
    const aim = pcAimDir(new THREE.Vector3());
    const from = new THREE.Vector3(b.x, golf.laneY(b.x, b.z) + 0.02, b.z);
    golf.showAim(from, aim, charge, `${golf.current + 1} 番ホール（${golf.hole.name}）　あなたの番　${b.strokes + 1} 打め`);
    placePutterPC(throughFor > 0 ? -0.04 : charge * 0.3);
  }
  function pcRelease() {
    if (!(turn === 'player' && phase === 'aim' && charging)) { charging = false; return; }
    charging = false;
    const aim = pcAimDir(new THREE.Vector3());
    const v = 0.25 + charge ** 1.4 * 4.3;
    golf.strike(0, aim.x * v, aim.z * v);
    phase = 'rolling';
    throughFor = 0.2;
    charge = 0;
    golf.showAim(null);
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Space' || state !== 'play' || isXR()) return;
      if (turn === 'player' && phase === 'aim') { e.preventDefault(); if (!e.repeat) charging = true; }
    });
    window.addEventListener('keyup', (e) => {
      if (e.code !== 'Space' || state !== 'play' || isXR()) return;
      pcRelease();
    });
  }

  // --- 順番 ------------------------------------------------------------------
  function nextTurn() {
    const p = P();
    const g = Gb();
    if (done(p) && done(g)) {
      phase = 'holeDone';
      timer = 0;
      scores[0][golf.current] = p.strokes;
      scores[1][golf.current] = g.strokes;
      golf.drawBoard(scores, totals());
      return;
    }
    if (done(p)) turn = 'girl';
    else if (done(g)) turn = 'player';
    else turn = distCup(p) >= distCup(g) ? 'player' : 'girl';
    phase = 'aim';
    timer = 0;
    pcTurnSet = false;
    if (turn === 'girl') { planGirl(); girlStep = 'walk'; voice?.say('golfMyTurn', { chance: 0.5 }); } else voice?.say('golfYourTurn', { chance: 0.35 });
  }

  function onBallEvent(i, ev) {
    const b = golf.balls[i];
    if (ev === 'cup') {
      if (i === 0) voice?.say(b.strokes === 1 ? 'golfPlayerAce' : 'golfPlayerIn');
      else { voice?.say(b.strokes === 1 ? 'golfGirlAce' : 'golfGirlIn'); body.smile(2.5, 1); }
    } else if (ev === 'stop' && !b.inCup) {
      const d = distCup(b);
      if (i === 0 && d < 0.35) voice?.say('golfClose', { chance: 0.7 });
      if (i === 1 && d < 0.35) voice?.say('golfClose', { chance: 0.4 });
    }
  }

  function update(dt) {
    if (!body.loaded) return;
    awayFor = playerHere ? 0 : awayFor + dt;
    if (state !== 'off' && awayFor > 5) { finish(); return; }
    // 球とパター（女の子が来る前も、プレイヤーは打てる）
    const events = state === 'off' ? [null, null] : golf.update(dt);
    if (state === 'off') return;
    if (isXR()) holdPutterVR(dt);
    else if (!(turn === 'player' && phase === 'aim')) golf.playerPutter.visible = false;
    throughFor = Math.max(0, throughFor - dt);
    events.forEach((ev, i) => { if (ev) onBallEvent(i, ev); });
    if (phase === 'rolling' && !P().moving && !Gb().moving) nextTurn();
    if (phase === 'holeDone') {
      timer += dt;
      if (timer > 2.5) {
        if (golf.current >= golf.holes.length - 1) {
          phase = 'finished';
          timer = 0;
          const [a, b] = totals();
          voice?.say(a < b ? 'golfLose' : a > b ? 'golfWin' : 'golfDraw');
          golf.showText(`おわり！　あなた ${a}　女の子 ${b}`);
        } else {
          golf.current += 1;
          golf.resetBalls();
          golf.drawBoard(scores, totals());
          turn = 'player';
          phase = 'aim';
          pcTurnSet = false;
          voice?.say('golfNext', { chance: 0.6 });
        }
      }
    }
    if (phase === 'finished') {
      timer += dt;
      if (timer > 10) {
        voice?.say('golfAgain');
        golf.current = 0;
        golf.resetBalls();
        scores = [[], []];
        golf.drawBoard(scores, totals());
        turn = 'player';
        phase = 'aim';
        pcTurnSet = false;
      }
    }
    // PC の自分の番
    if (!isXR() && turn === 'player' && phase === 'aim') pcTurn(dt);
    else if (!isXR() && phase !== 'finished') {
      const b = turn === 'girl' ? 'あいての番' : '転がっています';
      golf.showText(`${golf.current + 1} 番ホール（${golf.hole.name}）　${b}`);
    }
    // 女の子
    switch (state) {
      case 'waitStand':
        if (!body.free && !body.driven) { body.requestStand(); break; }
        beginWalk();
        break;
      case 'toCourse':
        playerHead(gaze.position);
        character.watch(gaze);
        if (followPath(dt)) state = 'play';
        break;
      case 'play':
        body.position.y = 0;
        if (turn === 'girl' && phase === 'aim') girlTurn(dt);
        else if (phase === 'rolling' && turn === 'girl') {
          body.stand(dt);
          body.reachHands(null);
          golf.girlPutter.visible = false;
          const b = Gb();
          watchPoint(b.x, golf.laneY(b.x, b.z), b.z);
        } else spectate(dt);
        break;
      default:
        break;
    }
  }

  function finish() {
    body.reachHands(null);
    body.setGrip(0);
    body.setBend(0);
    body.setAttend(true);
    golf.hideBalls();
    golf.playerPutter.visible = false;
    golf.girlPutter.visible = false;
    golf.showAim(null);
    golf.showText(null);
    state = 'off';
    path = [];
    onFinish?.();
  }

  return {
    update,
    start,
    set onFinish(fn) { onFinish = fn; },
    set playerHere(v) { playerHere = Boolean(v); },
    get wanted() { return playerHere; },
    get active() { return state !== 'off'; },
    get state() { return state; },
    get turn() { return turn; },
    get phase() { return phase; },
    get scores() { return scores; },
    /** テスト用 */
    get debug() { return { state, phase, turn, pos: [+body.position.x.toFixed(2), +body.position.z.toFixed(2)], girlStep, yaw: +body.yaw.toFixed(2), want: +Math.atan2(-girlAim.y, girlAim.x).toFixed(2), timer: +timer.toFixed(2) }; },
    /** main.js から：VR のコントローラー・PC の視点・VR かどうか */
    bind(o) { controllers = o.controllers ?? controllers; desktop = o.desktop ?? desktop; isXR = o.isXR ?? isXR; },
    /** テスト用：PC で打つ（強さ 0..1） */
    debugPutt(power) { charging = true; charge = power; pcRelease(); },
  };
}
