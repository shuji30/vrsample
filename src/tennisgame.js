import * as THREE from 'three';
import { PARK } from './park.js';
import { ROOM } from './room.js';
import { NET, predictTennis, solveShot } from './tennis.js';
import { createForehand, createRacketHands, readyPoints, contactFor, SWING_LEAD } from './forehand.js';
import { gardenPath, createRallyBoard } from './catchball.js';

/**
 * テニスコートでのテニス（女の子の側）。
 *
 * プレイヤーがラケットを持ってコートへ入ると、女の子もコートへ来て、自分の側の
 * ネットポストの脇に置いてある自分のラケットを拾い、ベースラインの少し内側で構える。
 *
 * 球が飛んでくると、tennis.js の先読み（空気抵抗・マグヌス・回転のバウンドまで
 * world.js と同じ式）で軌道を読み、1 回弾んだあとの「打ちやすい高さ」を通る点を
 * 選んで、そこを体の右前で打てる位置へ走る。間に合う時刻から逆算して
 * テイクバックを始め、インパクトで面の中心が球の通り道を通るように振る
 * （forehand.js）。
 *
 * 当たったかどうかはラケットの当たり判定（tennis.js）に任せる。当たったら、
 * 打ち返す球はプレイヤーの手前 1.8m に弾むように解き直す（狙って打つ）。
 * 当たらなければ空振りで、球はそのまま後ろへ抜ける。
 *
 * 自分の側に止まった球は拾いに行き、構えの位置から自分で落として打って送る。
 * プレイヤーがラケットを置く（または部屋へ戻る）と、ラケットを元の場所へ
 * 置いて、ネットの脇を回って手前側へ戻り、キャッチボールへ体を返す。
 * 持っている道具で遊びが変わる：ラケットを持って外へ出ればテニス、持って
 * いなければキャッチボール。
 *
 * ラリー：打った球が相手のコートに入るたびに 1 つ数え、ネットの上の看板に出す。
 * ネット・アウト・2 回弾む（返せなかった）・手で取ると途切れ、理由を台詞で言う。
 * 女の子もときどきミスをする（速い球、バックハンド、長いラリーほど増える）。
 * プレイヤーの打球は、相手のコートへ向かっている球だけ、落ちる所を少しコートの
 * 内側へ寄せる（VR は 35%、PC は 80%。PC は振りの向きを加減できないため）。
 */

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const angleDelta = (to, from) => {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};

const C = PARK.court;
/** ネットの向こう（女の子の側）のベースライン */
const BASELINE = C.z - C.length / 2;
/** 手前（プレイヤーの側）のベースライン */
const NEAR_BASELINE = C.z + C.length / 2;
const HALF_WIDTH = C.width / 2;
/** 女の子が動ける範囲（自分の側。外まわりの柵の内側、ネットから 0.5m 手前まで） */
const HER_AREA = {
  minX: C.x - HALF_WIDTH - C.runoffSide + 0.3,
  maxX: C.x + HALF_WIDTH + C.runoffSide - 0.3,
  minZ: BASELINE - C.runoffEnd + 0.3,
  maxZ: NET.z - 0.5,
};
/** 構える位置（ベースラインの 1.2m 内側） */
const HOME_Z = BASELINE + 1.2;
/** ネットポストの外側を回る道（コートの右側、x = +3.8） */
const POST_X = C.x + NET.halfSpan + 0.5;
const NEAR_POST = new THREE.Vector2(POST_X, NET.z + 1.4);
const FAR_POST = new THREE.Vector2(POST_X, NET.z - 1.0);
/** 女の子のラケットの置き場所（自分の側のネットポストの脇） */
export const HER_RACKET_SPOT = new THREE.Vector3(POST_X + 0.15, 0, NET.z - 1.2);

/** 走る速さ（m/s）。小学生くらいの子が小走りでコートを動く速さ */
const RUN = 2.3;
const WALK = 0.9;
/** 球が来るのに気づいてから動き出すまで（秒） */
const REACTION = 0.2;
/** 打ったあと、自分の打った球を追わない時間（秒） */
const COOLDOWN = 0.6;
/** 打ちやすい高さ（m）と、打てる高さの範囲 */
const SWEET_HEIGHT = 0.85;
const LOW = 0.32;
const HIGH = 1.4;
/** 屋外（庭）にいるか */
const OUTSIDE_Z = ROOM.minZ - ROOM.wall - 0.25;
/** ラリーの看板を出す所（ネットの上） */
const BOARD_AT = new THREE.Vector3(C.x, 2.5, NET.z);
/** 線の上に落ちた球は入り（球の半径ぶん甘く見る） */
const LINE = 0.035;
/** プレイヤーの打球を相手のコートの内側へ寄せる強さ */
const ASSIST = { player: 0.35, desktop: 0.8 };

/**
 * @param {object} options
 * @param {ReturnType<import('./character.js').createCharacter>} options.character
 * @param {THREE.Object3D} options.ball テニスボール
 * @param {THREE.Object3D} options.racket 女の子のラケット
 * @param {THREE.Object3D} options.playerRacket プレイヤーのラケット
 * @param {THREE.Camera} options.camera
 * @param {THREE.Scene} options.scene
 * @param {object} [options.voice]
 */
export function createTennisGame({ character, ball, racket, playerRacket, camera, scene, voice = null }) {
  const body = character.body;
  const data = ball.userData;
  const hands = createRacketHands(body, racket);
  const ready = readyPoints();

  let state = 'off';
  let timer = 0;
  let path = [];
  let plan = null;            // { point, t, stand, yaw, height }
  let planAge = 0;
  let swing = null;
  let cooldown = 0;
  let restFor = 0;
  let unwanted = 0;           // テニスをやめたそうにしている時間
  let holdingRacket = false;
  let holdingBall = false;
  let lastSeen = new THREE.Vector3().copy(ball.position);
  let random = Math.random;
  const player = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector2();
  const offset = new THREE.Vector3();
  const ballLeft = new THREE.Vector3();

  /** 検証用の数 */
  const stats = { returned: 0, swung: 0, missed: 0, fed: 0, fetched: 0, out: 0 };

  const driver = { get state() { return `tennis:${state}`; } };
  const gauss = () => {
    let u = 0;
    let v = 0;
    while (u === 0) u = random();
    while (v === 0) v = random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };

  function readPlayer() {
    camera.getWorldPosition(player);
  }

  /**
   * プレイヤーがラケットを持って外（庭かコート）にいるか。持っている道具で遊びを
   * 選ぶ：ラケットならテニス、そうでなければキャッチボール
   */
  function playerWantsTennis() {
    const held = playerRacket.userData.held && ['player', 'desktop'].includes(playerRacket.userData.heldBy);
    return held && player.z < OUTSIDE_Z;
  }

  const ballFree = () => !data.held;
  const onHerSide = (p) => p.z < NET.z - 0.1
    && p.x > HER_AREA.minX - 0.5 && p.x < HER_AREA.maxX + 0.5 && p.z > HER_AREA.minZ - 0.5;
  const clampHer = (v) => {
    v.x = clamp(v.x, HER_AREA.minX, HER_AREA.maxX);
    v.y = clamp(v.y, HER_AREA.minZ, HER_AREA.maxZ);
    return v;
  };

  /** 構える位置。プレイヤーの左右に少しついていく */
  function homeSpot() {
    return new THREE.Vector2(clamp(C.x + (player.x - C.x) * 0.4, C.x - 1.2, C.x + 1.2), HOME_Z);
  }

  /** 打ち返す先（地面の点）。プレイヤーの手前 1.8m、左右は少しばらつく（noise = false で真ん中） */
  function aimPoint(noise = true) {
    const inPlayerCourt = player.z > NET.z && player.z < NEAR_BASELINE + C.runoffEnd;
    const z = inPlayerCourt ? clamp(player.z - 1.8, NET.z + 2.2, NEAR_BASELINE - 0.6) : NEAR_BASELINE - 1.5;
    const x = clamp((inPlayerCourt ? player.x : C.x) + (noise ? gauss() * 0.35 : 0), C.x - HALF_WIDTH + 0.4, C.x + HALF_WIDTH - 0.4);
    return new THREE.Vector3(x, 0, z);
  }

  /** 打つ向き（体の正面）。打点から狙う点へ */
  function aimYaw(from) {
    const target = aimPoint(false);
    return Math.atan2(target.x - from.x, target.z - from.z);
  }

  /** 打点 point を体の右前（side = 1、フォア）/ 左前（-1、バック）で打つときの立ち位置 */
  function standFor(point, yaw, side = 1) {
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const contact = contactFor(side);
    // 左手側（+X）は (fz, -fx)。フォアの打点は右（x が負）なので、立ち位置は打点から左へ
    return clampHer(new THREE.Vector2(
      point.x - fz * contact.x - fx * contact.z,
      point.z + fx * contact.x - fz * contact.z,
    ));
  }

  /**
   * 飛んでくる球の打ち方を決める。自分の側で 1 回弾んだあと、打てる高さを
   * 通る点のうち、間に合って、打ちやすい高さに近く、動く距離が短いもの。
   */
  function planHit() {
    const samples = predictTennis(ball.position, data.velocity, data.spin, data);
    const here = new THREE.Vector2(body.position.x, body.position.z);
    let best = null;
    let bestScore = Infinity;
    let firstBounce = null;
    for (const s of samples) {
      if (s.net) return { hit: null, out: false, net: true };
      if (s.bounces === 0) continue;
      if (!firstBounce) firstBounce = s.p.clone();
      if (s.bounces > 1) break;             // 2 回目に弾む前に打つ
      if (!onHerSide(s.p) || s.p.y < LOW || s.p.y > HIGH) continue;
      const yaw = aimYaw(s.p);
      // 走り出しの向き直りと、振り始めてからは寄る速さが落ちるぶん、少し割り引いて見る
      const can = RUN * 0.85 * Math.max(0, s.t - REACTION - 0.15) + 0.2;
      // 構えの位置より後ろ（ベースラインの外）まで下がって打つのは避ける
      const deep = Math.max(0, HOME_Z - 0.3 - s.p.z);
      // フォアとバック（両手打ち）の両方を見て、よいほう。少しだけフォアを好む
      for (const side of [1, -1]) {
        const stand = standFor(s.p, yaw, side);
        const need = stand.distanceTo(here);
        if (need > can) continue;
        const score = Math.abs(s.p.y - SWEET_HEIGHT) * 1.5 + need * 0.3 + deep * 0.9
          + (s.v.y > 0 ? 0.15 : 0) + s.t * 0.05 + (side < 0 ? 0.12 : 0);
        if (score < bestScore) {
          bestScore = score;
          best = { point: s.p.clone(), t: s.t, stand, yaw, height: s.p.y, side, speed: s.v.length() };
        }
      }
    }
    // 自分の側のコートの外に弾む球は見送る
    const out = Boolean(firstBounce) && (Math.abs(firstBounce.x - C.x) > HALF_WIDTH + 0.05
      || firstBounce.z < BASELINE - 0.05);
    return { hit: best, out, bounce: firstBounce };
  }

  /** 飛んでくる球か（自分の側へ向かっている） */
  function incoming() {
    if (!ballFree() || cooldown > 0) return false;
    const v = data.velocity;
    return v.z < -1.5 && ball.position.z > NET.z - 3 && ball.position.y > 0.05 && v.length() > 2;
  }

  // --- 道順 -------------------------------------------------------------------

  /** いまの場所から p（コート上の点）への道順。ネットはポストの外側を回る */
  function routeTo(target) {
    const here = new THREE.Vector2(body.position.x, body.position.z);
    const points = [];
    let from = here;
    if (here.y > OUTSIDE_Z) {
      // 部屋の中：掃き出し窓から出る
      const exit = body.exitRoute();
      points.push(...exit);
      from = exit[exit.length - 1];
    }
    const hereSide = from.y < NET.z ? -1 : 1;
    const thereSide = target.y < NET.z ? -1 : 1;
    if (hereSide !== thereSide) {
      const first = hereSide > 0 ? NEAR_POST : FAR_POST;
      const second = hereSide > 0 ? FAR_POST : NEAR_POST;
      if (from.y > C.z + C.length / 2 + C.runoffEnd) points.push(...gardenPath(from, first.clone()));
      else points.push(first.clone());
      points.push(second.clone());
    } else if (from.y > C.z + C.length / 2 + C.runoffEnd) {
      points.push(...gardenPath(from, target.clone()).slice(0, -1));
    }
    points.push(target.clone());
    return points;
  }

  let pathBest = Infinity;
  let pathStuck = 0;
  function followPath(dt, speed) {
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

  /**
   * 相手のほうを向いたまま寄る（短い距離）か、向きを変えて走る（長い距離）。
   * 走るのは 2.5m より遠いときだけ。向き直るのに時間がかかるので、それより近ければ
   * 打つ向きのまま横へ動く（テニスのサイドステップ）
   */
  function moveTo(point, dt, speed, faceYaw) {
    const d = Math.hypot(point.x - body.position.x, point.y - body.position.z);
    if (d < 0.04) { body.turnTowards(faceYaw, dt); body.stand(dt); return true; }
    if (d < 2.5) return body.stepFacing(point, dt, speed, faceYaw);
    return body.stepTowards(point, dt, speed);
  }

  // --- ラケットと球の持ち方 -----------------------------------------------------

  function holdReady(yaw, leftLocal = null) {
    hands.frame(yaw);
    hands.apply(ready, leftLocal);
  }

  function pickUpRacket() {
    holdingRacket = true;
    scene.attach(racket);
    racket.userData.held = true;
    racket.userData.heldBy = 'character';
    racket.userData.velocity.set(0, 0, 0);
    racket.userData.spin.set(0, 0, 0);
  }

  function putDownRacket() {
    holdingRacket = false;
    hands.release();
    body.setThrowPose(null);
    racket.userData.held = false;
    racket.userData.heldBy = null;
    racket.position.copy(HER_RACKET_SPOT).setY(racket.userData.halfSize);
    racket.quaternion.copy(racket.userData.homeQuaternion);
    racket.userData.velocity.set(0, 0, 0);
  }

  function takeBall() {
    holdingBall = true;
    data.held = true;
    data.heldBy = 'character';
    data.velocity.set(0, 0, 0);
    data.spin.set(0, 0, 0);
    stats.fetched++;
  }

  function dropBall() {
    if (!holdingBall) return;
    holdingBall = false;
    if (data.heldBy === 'character') {
      data.held = false;
      data.heldBy = null;
      data.velocity.set(0, 0, 0);
    }
  }

  /** 持っている球を左手の位置に置く（体の座標で、胸の左前） */
  function placeHeldBall() {
    if (!holdingBall) return;
    if (data.heldBy !== 'character') { holdingBall = false; return; }
    body.palm('left', ballLeft);
    ball.position.copy(ballLeft);
  }

  // --- 始める / やめる -----------------------------------------------------------

  function start() {
    if (state !== 'off') return;
    state = 'waitStand';
    unwanted = 0;
    character.watch(ball);
  }

  function beginWalk() {
    body.drive(driver);
    body.setAttend(true);
    body.reach(null);
    body.setCrouch(0);
    body.setBend(0);
    const stand = new THREE.Vector2(HER_RACKET_SPOT.x - 0.35, HER_RACKET_SPOT.z);
    path = routeTo(stand);
    voice?.say('tennisInvite');
    state = holdingRacket ? 'toHome' : 'toRacket';
    if (holdingRacket) path = routeTo(homeSpot());
  }

  /** 途中でも、やめるほうへ向かう。ラケットを戻し、ネットの手前側へ戻る */
  function stop() {
    if (state === 'off' || state === 'returnRacket' || state === 'putRacket' || state === 'leave') return;
    swing?.cancel();
    swing = null;
    dropBall();
    plan = null;
    body.setThrowPose(null);
    if (state === 'waitStand' || !body.driven) { finish(); return; }
    if (holdingRacket) {
      path = routeTo(new THREE.Vector2(HER_RACKET_SPOT.x - 0.35, HER_RACKET_SPOT.z));
      state = 'returnRacket';
    } else {
      path = routeTo(NEAR_POST.clone());
      state = 'leave';
    }
  }

  let onFinish = null;
  function finish() {
    board.hide();
    rally.hitter = null;
    rally.count = 0;
    hands.release();
    body.setThrowPose(null);
    body.setCrouch(0);
    body.setBend(0);
    state = 'off';
    onFinish?.();
  }

  // --- 打つ ---------------------------------------------------------------------

  function beginSwing() {
    const yaw = plan.yaw;
    swing = createForehand(body, hands, { yaw, hitHeight: plan.height, impactIn: plan.t, side: plan.side });
    stats.swung++;
    hitThisSwing = false;
    state = 'swing';
  }

  /**
   * 当たり判定から呼ばれる。自分のラケットで当たったら、狙った所へ打ち直す
   * （ときどきミスして、ネットかアウトへ行く）。プレイヤーのラケットなら、
   * 相手のコートの内側へ少し寄せる
   */
  function onRacketHit(hit) {
    if (hit.ball !== ball || state === 'off') return;
    if (hit.racket !== racket) {
      assistPlayerShot(hit.by);
      beginShot(hit.by === 'character' ? 'her' : 'player');
      return;
    }
    const target = aimPoint();
    const distance = Math.hypot(target.x - ball.position.x, target.z - ball.position.z);
    // ラリーが続くと少しずつ速く（最大 15%）
    const pace = 1 - Math.min(0.15, rally.count * 0.01);
    // ミスの見込み。速い球・バックハンド・長いラリーほど増える
    const chance = clamp(0.03 + Math.max(0, (plan?.speed ?? 8) - 10) * 0.025
      + (plan?.side < 0 ? 0.03 : 0) + Math.max(0, rally.count - 8) * 0.01, 0, 0.35);
    if (state === 'swing' && random() < chance) {
      mishit(target);
    } else {
      const shot = solveShot(ball.position, target, data, {
        flight: clamp(0.35 + distance / 11, 0.95, 1.5) * pace,
        topspin: 35 + random() * 20,
      });
      data.velocity.copy(shot.velocity);
      data.spin.copy(shot.spin);
      lastShot = { target, landing: shot.landing };
    }
    cooldown = COOLDOWN;
    hitThisSwing = true;
    stats.returned++;
    voice?.say('tennisHit', { chance: 0.25 });
    beginShot('her');
  }

  /** 打ち損じ。半分はネット、半分は長すぎるか横へ外れる */
  function mishit(target) {
    stats.mishit = (stats.mishit ?? 0) + 1;
    if (random() < 0.5) {
      // ネットの白帯より下へ、まっすぐ
      const to = new THREE.Vector3(target.x, NET.height(target.x) * 0.55, NET.z);
      const t = 0.45;
      data.velocity.set((to.x - ball.position.x) / t, (to.y - ball.position.y + 4.9 * t * t) / t, (to.z - ball.position.z) / t);
      data.spin.set(0, 0, 0);
      lastShot = { target: to, landing: null, error: 'net' };
      return;
    }
    const wide = random() < 0.5;
    const out = wide
      ? new THREE.Vector3(C.x + Math.sign(target.x - C.x || 1) * (HALF_WIDTH + 0.7), 0, target.z)
      : new THREE.Vector3(target.x, 0, NEAR_BASELINE + 1.2 + random());
    const shot = solveShot(ball.position, out, data, { flight: 1.2, topspin: 30 });
    data.velocity.copy(shot.velocity);
    data.spin.copy(shot.spin);
    lastShot = { target: out, landing: shot.landing, error: 'out' };
  }

  /**
   * プレイヤーの打球を、相手のコートの内側へ寄せる。女の子の側へ向かっている球だけ。
   * 落ちる所がコートの外（か手前のネット）なら、コートの線の 0.5m 内側の点へ
   * strength の割合だけ近づけた所を狙い直す。大きく外れた球（4m 以上）はそのまま
   */
  function assistPlayerShot(by) {
    const strength = ASSIST[by] ?? 0;
    if (!strength || data.velocity.z > -2) return;
    const samples = predictTennis(ball.position, data.velocity, data.spin, data, { maxTime: 3 });
    let landing = null;
    let netted = false;
    for (const s of samples) {
      if (s.net) { netted = true; landing = s.p.clone().setZ(NET.z - 1.5); break; }
      if (s.bounces > 0) { landing = s.p.clone(); break; }
    }
    if (!landing) return;
    const inside = new THREE.Vector3(
      clamp(landing.x, C.x - HALF_WIDTH + 0.5, C.x + HALF_WIDTH - 0.5), 0,
      clamp(landing.z, BASELINE + 0.5, NET.z - 1.5),
    );
    const off = Math.hypot(inside.x - landing.x, inside.z - landing.z);
    const spin = data.spin.length();
    let flight = samples.find((s) => s.bounces > 0)?.t ?? 1.1;
    let target;
    if (by === 'desktop') {
      // PC は振りが決まっているので、いつも打ち返しやすい球に直す：ベースラインの
      // 2m 内側より手前に、1.15 秒以上かけて届く球（速く深い球は、弾んだあと
      // 女の子の頭の上を越えて返せなかった）
      if (off > 4) return;
      target = landing.clone().lerp(inside, strength);
      target.z = clamp(target.z, BASELINE + 2.0, NET.z - 1.8);
      flight = Math.max(flight, 1.15);
    } else {
      if (off < 0.01 && !netted) return;
      if (off > 4) return;
      if (netted) return;   // VR のネットはそのまま（持ち上げると不自然）
      target = landing.clone().lerp(inside, strength);
    }
    const shot = solveShot(ball.position, target, data, { flight: clamp(flight, 0.6, 1.6), topspin: Math.min(80, spin) });
    data.velocity.copy(shot.velocity);
    data.spin.copy(shot.spin);
  }

  // --- ラリー ---------------------------------------------------------------------

  const board = createRallyBoard({ scale: 2.2 });
  scene.add(board.sprite);
  const rally = { count: 0, best: 0, hitter: null, bounces: 0, prevVy: 0 };

  /** 打った（hitter: 'player' | 'her'）。ここから次に弾むまでを見る */
  function beginShot(hitter) {
    rally.hitter = hitter;
    rally.bounces = 0;
  }

  function endRally(reason, by) {
    if (!rally.hitter) return;
    const count = rally.count;
    rally.hitter = null;
    rally.count = 0;
    const labels = { net: 'ネット！', out: 'アウト！', miss: 'おしい！' };
    board.show(count, rally.best, true, labels[reason] ?? 'おしい！');
    stats.ended = stats.ended ?? {};
    const key = `${by}:${reason}`;
    stats.ended[key] = (stats.ended[key] ?? 0) + 1;
    if (by === 'player') {
      if (reason === 'net') voice?.say('tennisNet');
      else if (reason === 'out') voice?.say('tennisOut');
      else voice?.say('tennisPlayerMiss');
    } else if (reason === 'net') voice?.say('tennisMyNet');
    else if (reason === 'out') voice?.say('tennisMyOut');
    else voice?.say('tennisMiss');
    if (count >= 5) body.smile(2.4, 1);
  }

  /** 打った球が相手のコートに入った */
  function goodShot() {
    rally.count++;
    rally.best = Math.max(rally.best, rally.count);
    stats.rally = rally.count;
    stats.best = rally.best;
    board.show(rally.count, rally.best);
    if (rally.count % 5 === 0) {
      voice?.say('tennisRally', { n: rally.count });
      body.smile(2.4, 1);
    } else if (rally.hitter === 'player' && data.velocity.length() > 9) {
      voice?.say('tennisNice', { chance: 0.5 });
    }
  }

  /** 弾んだ所を見て、入ったか・返せなかったかを決める */
  function trackRally() {
    if (data.held) {
      // 手で取った / 拾った：その場で終わり（数えるだけで、台詞は言わない）
      if (rally.hitter) { rally.hitter = null; rally.count = 0; }
      rally.prevVy = 0;
      return;
    }
    const vy = data.velocity.y;
    const bounced = rally.prevVy < -0.4 && vy > 0 && ball.position.y < data.halfSize + 0.05;
    rally.prevVy = vy;
    if (!bounced || !rally.hitter) return;
    rally.bounces++;
    const p = ball.position;
    const receiverSide = rally.hitter === 'player' ? -1 : 1;   // -1 = 女の子の側（z < ネット）
    if (rally.bounces === 1) {
      const side = Math.sign(p.z - NET.z);
      const inLines = Math.abs(p.x - C.x) <= HALF_WIDTH + LINE
        && p.z >= BASELINE - LINE && p.z <= NEAR_BASELINE + LINE;
      if (side === receiverSide && inLines) goodShot();
      else endRally('out', rally.hitter);
    } else {
      // 2 回目：受ける側が返せなかった
      endRally('miss', rally.hitter === 'player' ? 'her' : 'player');
    }
  }

  /** ネットに掛かった（world.js から） */
  function onBallNet(prop) {
    if (prop !== ball || !rally.hitter) return;
    endRally('net', rally.hitter);
  }

  let lastShot = null;
  let hitThisSwing = false;

  /** 自分で球を落として打つ（止まった球を拾ったあと、相手へ送る） */
  let feedDrop = null;
  function beginFeed() {
    const yaw = aimYaw(new THREE.Vector3(body.position.x, 0, body.position.z));
    const hy = 0.85;
    swing = createForehand(body, hands, { yaw, hitHeight: hy, impactIn: SWING_LEAD });
    // 打点の真上から落とす。落ちきる時刻をインパクトに合わせる
    const fall = 0.4;
    feedDrop = { at: SWING_LEAD - Math.sqrt((2 * fall) / 9.8), fall, time: 0, yaw, hy };
    stats.fed++;
    state = 'feed';
  }

  // --- 毎フレーム ---------------------------------------------------------------

  function update(dt) {
    if (!body.loaded) return;
    readPlayer();
    cooldown = Math.max(0, cooldown - dt);
    const wants = playerWantsTennis();
    unwanted = wants ? 0 : unwanted + dt;
    if (state !== 'off' && unwanted > 3) stop();

    if (state !== 'off') {
      trackRally();
      board.update(dt, body, BOARD_AT);
    }

    const moved = lastSeen.distanceTo(ball.position);
    lastSeen.copy(ball.position);
    restFor = ballFree() && data.velocity.length() < 0.3 && ball.position.y < 0.1 && moved < 0.01 ? restFor + dt : 0;

    const faceYaw = Math.atan2(player.x - body.position.x, player.z - body.position.z);

    switch (state) {
      case 'off':
        return;

      case 'waitStand':
        if (body.driven && !holdingRacket && body.position.z < OUTSIDE_Z) { beginWalk(); break; }
        if (!body.free && !body.driven) { body.requestStand(); break; }
        beginWalk();
        break;

      case 'toRacket':
        hands.release();
        if (followPath(dt, state === 'toRacket' && body.position.z > OUTSIDE_Z ? 0.6 : WALK * 1.3)) {
          state = 'pickRacket';
          timer = 0;
        }
        break;

      case 'pickRacket': {
        // しゃがんで右手でグリップをつかむ
        timer += dt;
        body.turnTowards(Math.atan2(HER_RACKET_SPOT.x - body.position.x, HER_RACKET_SPOT.z - body.position.z), dt);
        body.setCrouch(0.55);
        body.setBend(0.35);
        racket.localToWorld(tmp.set(0, 0, 0));
        body.reachHands({ right: { target: tmp, amount: clamp(timer * 3, 0, 1) }, left: null });
        if (timer > 0.6) {
          pickUpRacket();
          body.setCrouch(0);
          body.setBend(0);
          path = routeTo(homeSpot());
          state = 'toHome';
        }
        break;
      }

      case 'toHome': {
        holdReady(body.yaw);
        if (incoming()) { beginPlan(); break; }
        if (followPath(dt, WALK * 1.3)) state = 'ready';
        break;
      }

      case 'ready': {
        const home = homeSpot();
        moveTo(home, dt, WALK, faceYaw);
        body.setCrouch(0.08);
        holdReady(body.yaw);
        if (incoming()) { beginPlan(); break; }
        // 自分の側に止まった球は拾いに行く
        if (restFor > 0.8 && onHerSide(ball.position) && !holdingBall) {
          path = routeTo(clampHer(new THREE.Vector2(ball.position.x - 0.25, ball.position.z + 0.2)));
          state = 'fetch';
        }
        break;
      }

      case 'run': {
        planAge += dt;
        if (planAge > 0.15 && ballFree()) {
          const next = planHit();
          if (next.hit) plan = next.hit;
          planAge = 0;
        }
        if (!plan || !ballFree()) { state = 'ready'; break; }
        plan.t -= dt;
        moveTo(plan.stand, dt, RUN, plan.yaw);
        holdReady(body.yaw);
        if (plan.t <= SWING_LEAD) beginSwing();
        break;
      }

      case 'swing': {
        // 着いていなければ、打つ向きを保ったまま寄る
        if (plan && !swing.impactPassed) {
          plan.t -= dt;
          const d = Math.hypot(plan.stand.x - body.position.x, plan.stand.y - body.position.z);
          if (d > 0.03) {
            const step = Math.min(RUN * 0.6 * dt, d);
            body.position.x += ((plan.stand.x - body.position.x) / d) * step;
            body.position.z += ((plan.stand.y - body.position.z) / d) * step;
          }
          // 打点のずれを直す（球がいま読める所と、振りが通る所の差）
          correctOffset();
        }
        swing.update(dt);
        if (swing.done) {
          if (!hitThisSwing) stats.missed++;
          swing = null;
          plan = null;
          state = 'ready';
        }
        break;
      }

      case 'fetch': {
        hands.frame(body.yaw);
        hands.apply(ready);
        if (incoming()) { beginPlan(); break; }
        if (!ballFree() || !onHerSide(ball.position)) { state = 'ready'; break; }
        if (followPath(dt, WALK * 1.6)) { state = 'pickBall'; timer = 0; }
        break;
      }

      case 'pickBall': {
        // 左手で拾う。右手はラケットを持ったまま体の横へ
        timer += dt;
        body.turnTowards(Math.atan2(ball.position.x - body.position.x, ball.position.z - body.position.z), dt);
        body.setCrouch(0.6);
        body.setBend(0.4);
        hands.frame(body.yaw);
        hands.apply(ready, null);
        tmp.copy(ball.position);
        body.reachHands({
          left: { target: tmp, amount: clamp(timer * 3, 0, 1) },
          right: { target: racket.position, amount: 1 },
        });
        if (!ballFree()) { state = 'ready'; break; }
        if (timer > 0.55) {
          takeBall();
          body.setCrouch(0);
          body.setBend(0);
          path = routeTo(homeSpot());
          state = 'carry';
          timer = 0;
        }
        break;
      }

      case 'carry': {
        placeHeldBall();
        holdReady(body.yaw, tmp.set(0.16, 0.95, 0.28));
        if (!holdingBall) { state = 'ready'; break; }
        if (followPath(dt, WALK * 1.3)) {
          body.turnTowards(faceYaw, dt);
          timer += dt;
          // プレイヤーが構えるのを少し待ってから送る
          if (timer > 1.2 && playerWantsTennis()) beginFeed();
        }
        break;
      }

      case 'feed': {
        feedDrop.time += dt;
        if (holdingBall) {
          if (feedDrop.time >= feedDrop.at) {
            // 打点の真上で離す
            swing.impactCenter(tmp);
            hands.frame(feedDrop.yaw);
            hands.toWorld(tmp, tmp2Vec);
            holdingBall = false;
            data.held = false;
            data.heldBy = null;
            ball.position.copy(tmp2Vec).setY(tmp2Vec.y + feedDrop.fall);
            data.velocity.set(0, 0, 0);
            data.spin.set(0, 0, 0);
          } else {
            placeHeldBall();
          }
        }
        swing.update(dt);
        if (swing.done) { swing = null; state = 'ready'; }
        break;
      }

      case 'returnRacket':
        holdReady(body.yaw);
        if (followPath(dt, WALK * 1.3)) { state = 'putRacket'; timer = 0; }
        break;

      case 'putRacket':
        timer += dt;
        body.turnTowards(Math.atan2(HER_RACKET_SPOT.x - body.position.x, HER_RACKET_SPOT.z - body.position.z), dt);
        body.setCrouch(0.5);
        body.setBend(0.3);
        if (timer > 0.6 && holdingRacket) putDownRacket();
        if (timer > 0.9) {
          body.setCrouch(0);
          body.setBend(0);
          path = routeTo(NEAR_POST.clone());
          state = 'leave';
        }
        break;

      case 'leave':
        hands.release();
        if (followPath(dt, WALK * 1.3)) finish();
        break;

      default:
        break;
    }
  }
  const tmp2Vec = new THREE.Vector3();

  function beginPlan() {
    const next = planHit();
    if (next.out) stats.out++;
    if (!next.hit || next.out) {
      // 届かない / アウト / ネット：見送る
      state = 'ready';
      cooldown = 0.4;
      return;
    }
    plan = next.hit;
    planAge = 0;
    state = 'run';
  }

  /** 振っている最中の打点の直し。読み直した球の位置と、振りが通る点の差（体の座標） */
  function correctOffset() {
    if (!swing || swing.untilImpact < 0.02 || !ballFree()) return;
    const samples = predictTennis(ball.position, data.velocity, data.spin, data, { maxTime: swing.untilImpact + 0.05 });
    let at = null;
    for (const s of samples) { if (s.t >= swing.untilImpact) { at = s; break; } }
    if (!at) return;
    const yaw = plan.yaw;
    hands.frame(yaw);
    swing.setOffset(offset.set(0, 0, 0));
    swing.impactCenter(tmp);
    hands.toWorld(tmp, tmp2Vec);
    // ワールドのずれを体の座標へ
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const dx = at.p.x - tmp2Vec.x;
    const dz = at.p.z - tmp2Vec.z;
    offset.set(clamp(dx * fz - dz * fx, -0.45, 0.45), clamp(at.p.y - tmp2Vec.y, -0.3, 0.3), clamp(dx * fx + dz * fz, -0.45, 0.45));
    swing.setOffset(offset);
  }

  /** IK を解いたあとに呼ぶ（world.js から） */
  function afterPose() {
    if (holdingRacket) hands.snapToPalm();
    placeHeldBall();
  }

  return {
    update,
    afterPose,
    onRacketHit,
    onBallNet,
    get rally() { return { count: rally.count, best: rally.best, hitter: rally.hitter }; },
    start,
    stop,
    set onFinish(fn) { onFinish = fn; },
    get state() { return state; },
    get active() { return state !== 'off'; },
    get wanted() { readPlayer(); return playerWantsTennis(); },
    get plan() { return plan; },
    get lastShot() { return lastShot; },
    /** 検証用：いま飛んでいる球をどう打つつもりか */
    debugPlan: () => { readPlayer(); return planHit(); },
    stats,
    /** 検証用：乱数を差し替える */
    setRandom(fn) { random = fn; },
  };
}
