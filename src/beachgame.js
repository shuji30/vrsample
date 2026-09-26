import * as THREE from 'three';
import { SEA_LEVEL } from './hill.js';
import { beachGround, BEACH_AREA, COURT } from './beach.js';

/**
 * 砂浜（女の子の側）。プレイヤーが看板で砂浜へ下りると、女の子も遊びをやめて階段を下りてきて
 * （階段の下に出て、ネットの向こうの自分のコートまで歩く）、ビーチバレーをする。
 *
 * - 女の子はネットの東（自分のコート）を守る。点は beach.js が決める（相手のコートの中に落とせば点）。
 *   7 点先取。ときどき（12%）打ちそこねて、外へ出したりネットにかけたりする
 * - プレイヤーのコートで止まったボールは、プレイヤーがそばにいれば目の前へ軽く上がる（サーブ用）
 * - プレイヤーが打ったボールは、落ちてくる所（高さ 1.2m）を読んで走っていき、頭の上で打ち返す
 *   （プレイヤーの顔のあたりへ 1.7 秒でふわっと届く放物線）。続くと数える
 * - ボールが砂や海に落ちて、プレイヤーのそばに無ければ、拾いに行って「いくよー」とサーブする
 *   （海に浮いたボールは、波で浜へ寄ってくる。浅い所までは取りに入る）
 * - ボールがプレイヤーのそばで止まっているときは、少し離れて待つ
 * - 貝がらを拾うと喜ぶ
 * プレイヤーが丘の上へ戻ると（world.js が暗くしているあいだに）一緒に上へ戻って、キャッチボールへ。
 */
const RUN = 2.6;
const WALK = 1.3;
const HIT_H = 1.25;     // 打つ高さ（足もとから）
const SERVE_WAIT = 0.9;
/** 女の子の待つ所（自分のコートの真ん中より少しネット寄り） */
const HOME = { x: COURT.netX + 3.2, z: (COURT.minZ + COURT.maxZ) / 2 };
const onHerSide = (x) => x > COURT.netX;

export function createBeachGame({ character, beach, voice = null, playerPosition }) {
  const body = character.body;
  const ball = beach.ball;
  let state = 'off';
  let playerHere = false;
  let onFinish = null;
  let rally = 0;
  let timer = 0;
  let reachFor = 0;
  let wetSaid = false;
  let waitSaid = 0;
  let path = [];
  const driver = { get state() { return `beach:${state}`; } };
  const tmp = new THREE.Vector3();
  const aim = new THREE.Vector3();
  const goal = new THREE.Vector2();
  const gaze = new THREE.Object3D();
  gaze.userData = { held: false, velocity: new THREE.Vector3() };

  const ground = () => beachGround(body.position.x, body.position.z);
  const player = () => playerPosition();
  const flatDist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

  function start() {
    if (state !== 'off') return;
    state = 'waitStand';
    rally = 0;
    wetSaid = false;
  }

  /** 階段の下に出して、プレイヤーのところまで歩かせる */
  function arrive() {
    body.drive(driver);
    body.setAttend(true);
    body.reach(null);
    body.reachHands(null);
    body.setThrowPose(null);
    body.setCrouch(0);
    body.setBend(0);
    beach.bottomPoint(tmp);
    body.position.set(tmp.x - 0.9, 0, tmp.z + 0.6);
    body.position.y = ground();
    body.setYaw(Math.PI);
    // 階段の下から、ネットの柱の外（北）を回って自分のコートへ
    path = [new THREE.Vector2(COURT.netX - 0.8, COURT.maxZ + 1.4), new THREE.Vector2(COURT.netX + 1.0, COURT.maxZ + 1.4), new THREE.Vector2(HOME.x, HOME.z)];
    state = 'toPlayer';
  }

  function walkTo(point, dt, speed) {
    goal.set(point.x, point.z);
    // 砂浜の外へは出ない（沖は水深 0.6m まで）
    goal.x = THREE.MathUtils.clamp(goal.x, BEACH_AREA.minX + 0.5, BEACH_AREA.maxX - 0.5);
    goal.y = THREE.MathUtils.clamp(goal.y, BEACH_AREA.minZ + 0.5, BEACH_AREA.maxZ - 0.5);
    return body.stepTowards(goal, dt, speed);
  }
  function face(point, dt) { body.turnTowards(Math.atan2(point.x - body.position.x, point.z - body.position.z), dt); }

  /** 女の子がボールを打つ：プレイヤーの顔のあたりへ（相手のコートの中に収める）。ときどき打ちそこねる */
  function hitToPlayer(T = 1.7, canMiss = true) {
    const p = player();
    const r = Math.random();
    if (canMiss && r < 0.06) {
      // 大きすぎて外へ
      aim.set(COURT.minX - 1.8, beachGround(COURT.minX, p.z) + 1.0, p.z);
      beach.launchTo(aim, T + 0.3, 'girl');
      return;
    }
    if (canMiss && r < 0.12) {
      // 低くてネットへ
      aim.set(COURT.netX - 0.4, beachGround(COURT.netX, body.position.z) + 1.0, body.position.z);
      beach.launchTo(aim, 0.55, 'girl');
      return;
    }
    const x = THREE.MathUtils.clamp(p.x + (Math.random() - 0.5) * 1.2, COURT.minX + 0.8, COURT.netX - 1.0);
    const z = THREE.MathUtils.clamp(p.z + (Math.random() - 0.5) * 1.0, COURT.minZ + 0.6, COURT.maxZ - 0.6);
    aim.set(x, beachGround(x, z) + 1.35, z);
    beach.launchTo(aim, T, 'girl');
  }
  function goHome(dt) {
    if (Math.hypot(body.position.x - HOME.x, body.position.z - HOME.z) > 0.4) walkTo(HOME, dt, WALK * 1.3);
    else { body.stand(dt); face(player(), dt); }
  }
  let restFor = 0;

  function update(dt) {
    if (!body.loaded) return;
    if (state === 'off') return;
    if (state === 'waitStand') {
      if (!body.free && !body.driven) { body.requestStand(); return; }
      arrive();
      return;
    }
    // 砂浜の高さに立つ
    body.position.y = ground();
    if (reachFor > 0) { reachFor -= dt; if (reachFor <= 0) body.reach(null); }
    if (!wetSaid && ground() < SEA_LEVEL - 0.05) { wetSaid = true; voice?.say('beachWater'); }
    const p = player();
    switch (state) {
      case 'toPlayer': {
        if (walkTo({ x: path[0].x, z: path[0].y }, dt, WALK * 1.4)) {
          path.shift();
          if (path.length === 0) { state = 'play'; voice?.say('beachArrive'); }
        }
        break;
      }
      case 'play': {
        const b = ball.position;
        const hereToBall = flatDist(body.position, b);
        if (beach.airborne && beach.lastTouch === 'player') {
          // 落ちてくる所へ走って、頭の上で打ち返す
          const pr = beach.predictAt(ground() + HIT_H, tmp);
          const reachable = pr && flatDist(pr.point, body.position) < RUN * pr.t + 1.2;
          // 自分のコートに来る球だけ追う（ネットの手前 0.6m まで）
          if (pr && reachable && onHerSide(pr.point.x)) {
            pr.point.x = Math.max(pr.point.x, COURT.netX + 0.6);
            if (flatDist(pr.point, body.position) > 0.25) walkTo(pr.point, dt, RUN);
            else { body.stand(dt); face(p, dt); }
          } else { goHome(dt); }
          const dy = b.y - ground();
          if (hereToBall < 0.85 && dy > 0.7 && dy < 2.3 && ball.userData.velocity.y < 1.5) {
            body.reach(b, 1, 0.1);
            reachFor = 0.35;
            hitToPlayer();
            rally += 1;
            if (rally >= 3 && rally % 3 === 0) voice?.say('beachRally', { n: rally });
            else voice?.say('beachHit', { chance: 0.35 });
          }
        } else if (beach.airborne) {
          // 自分の打った球（とプレイヤーのトス）を見送って、待つ所へ戻る
          goHome(dt);
        } else {
          if (!onHerSide(b.x)) {
            // プレイヤーのコート（か西の外）に止まった：プレイヤーの番。自分のコートで待つ
            goHome(dt);
            restFor += dt;
            // プレイヤーがそばにいれば、目の前へ軽く上げる（VR で砂の上の球をはたくのは難しいので）
            if (restFor > 1.2 && flatDist(b, p) < 3.0) {
              const fx = Math.sign(COURT.netX - p.x) || 1;
              tmp.set(p.x + fx * 0.55, beachGround(p.x, p.z) + 1.0, p.z);
              beach.tossUp(tmp);
              restFor = 0;
            }
            waitSaid -= dt;
            if (waitSaid < 0 && flatDist(b, p) > 3) { voice?.say('beachWait', { chance: 0.5 }); waitSaid = 14; }
          } else if (hereToBall > 0.55) {
            walkTo(b, dt, hereToBall > 3 ? RUN * 0.8 : WALK);
            timer = 0;
          } else {
            // 拾って、頭の上から「いくよー」とサーブ
            body.stand(dt);
            face(p, dt);
            timer += dt;
            const fx = Math.sin(body.yaw);
            const fz = Math.cos(body.yaw);
            ball.position.set(body.position.x + fx * 0.3, ground() + 1.55, body.position.z + fz * 0.3);
            ball.userData.velocity.set(0, 0, 0);
            body.reach(ball.position, 1, 0.12);
            reachFor = 0.4;
            if (timer - dt <= 0) voice?.say('beachServe');
            if (timer > SERVE_WAIT) { hitToPlayer(1.8, false); timer = 0; rally = 0; }
          }
        }
        gaze.position.copy(beach.airborne || flatDist(b, p) > 2.2 ? b : p);
        if (!beach.airborne && flatDist(b, p) <= 2.2) gaze.position.y = p.y;
        character.watch(gaze);
        break;
      }
      default:
        break;
    }
  }

  /** ボールが落ちた（beach.js から） */
  function onBall(kind) {
    if (state !== 'play') return;
    if (kind === 'land' || kind === 'water') { rally = 0; restFor = 0; }
  }
  /** 点が入った（beach.js から）。game は 7 点を取った側 */
  function onPoint(winner, score, game) {
    if (state !== 'play') return;
    if (game) { voice?.say(game === 'girl' ? 'beachWin' : 'beachLose'); return; }
    if (winner === 'girl') voice?.say('beachPointGirl', { chance: 0.7 });
    else voice?.say(rally >= 2 ? 'beachMiss' : 'beachPointPlayer', { chance: 0.7 });
  }
  function onShell(n, all) {
    if (state === 'off') return;
    voice?.say(all ? 'beachShellAll' : n === 1 ? 'beachShellFirst' : 'beachShell', { n, chance: all || n === 1 ? 1 : 0.6 });
  }

  /** 丘の上へ戻る（world.js が暗くしているあいだ）。at の横に立たせる */
  function leave(at) {
    if (state === 'off') return;
    if (state !== 'waitStand') {
      body.position.set(at.x + 1.1, 0, at.z + 0.6);
      body.setYaw(Math.PI);
      voice?.say('beachLeave', { chance: 0.6 });
    }
    finish();
  }
  /** パラソルの下で座って話したあと（seatgame.js が体を返したとき）：ビーチバレーへ戻る */
  function resume() {
    if (state === 'off') return;
    body.drive(driver);
    body.setAttend(true);
    body.setSeat(0, 'upright');
    restFor = 0;
    timer = 0;
    state = 'play';
  }
  function finish() {
    body.reach(null);
    body.reachHands(null);
    body.setAttend(true);
    state = 'off';
    path = [];
    onFinish?.();
  }

  return {
    update,
    start,
    leave,
    resume,
    onBall,
    onPoint,
    onShell,
    set onFinish(fn) { onFinish = fn; },
    set playerHere(v) { playerHere = Boolean(v); },
    get wanted() { return playerHere; },
    get active() { return state !== 'off'; },
    get state() { return state; },
    get rally() { return rally; },
  };
}
