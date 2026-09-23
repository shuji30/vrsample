import * as THREE from 'three';
import { ROOM } from './room.js';
import { PARK } from './park.js';

/**
 * 庭でのキャッチボール（女の子の側）。
 *
 * プレイヤーが庭へ出ると、女の子も部屋から出てきて、プレイヤーから少し
 * 離れた位置に立って待つ。ボールが飛んでくると、軌道を先読みして
 * 「間に合う中でいちばん受けやすい点」へ小走りで入り、両手を伸ばして捕る。
 * 捕り損ねたら転がった先まで拾いにいく。
 *
 * 体の動かし方（歩く・しゃがむ・腕を伸ばす）は character.js の body に任せ、
 * ここは「どこへ行って何をするか」だけを決める。
 *
 * 投げ返しは段階 4 で振りかぶりの動きを付けるまでの仮のもので、
 * 両手で持ったまま下からふわっと放るだけ。
 */

/** 投げ合う距離（m）。子どもとのキャッチボールで無理のない 5m を基準にする */
const PLAY_DISTANCE = 5.0;
/** 小走りの速さ（m/s）。ふだんの歩き 0.5m/s の倍ちょっと */
const HURRY = 1.25;
/** 庭へ出る / 位置を変えるときの歩く速さ */
const WALK = 0.75;
/** 飛んでくるのに気づいてから動き出すまで（秒） */
const REACTION = 0.18;
/** 手のあいだの点からこの距離を通れば捕れる（ボールの半径込み） */
const CATCH_RADIUS = 0.15;
/** 投げ返してから、自分の球を追わないようにする時間（秒） */
const COOLDOWN = 0.9;

const GRAVITY = -9.8;
const OUTSIDE_Z = ROOM.minZ - ROOM.wall - 0.25;   // これより外なら庭にいる
const INSIDE_Z = ROOM.minZ + 0.1;

/** 女の子が動ける庭の範囲。家の壁と庭の縁から少し離す */
const PLAY_AREA = { minX: -5.4, maxX: 5.4, minZ: -12.4, maxZ: OUTSIDE_Z - 0.35 };
/** 柵の切れ目（通り抜けられる x の範囲） */
const GAP = {
  min: PARK.fence.gapX - PARK.fence.gap / 2 + 0.3,
  max: PARK.fence.gapX + PARK.fence.gap / 2 - 0.3,
};
const BODY_RADIUS = 0.22;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const angleDelta = (to, from) => {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};

/**
 * ボールの軌道を先読みする。world.js と同じ式（二乗の空気抵抗 + 重力）を
 * 同じ刻みで回すので、跳ねる前までは実際の軌道とほぼ一致する。
 */
function predictFlight(position, velocity, drag, radius, { step = 1 / 60, maxTime = 2.6 } = {}) {
  const p = position.clone();
  const v = velocity.clone();
  const samples = [];
  for (let t = step; t <= maxTime; t += step) {
    const speed = v.length();
    if (speed > 0.01) v.multiplyScalar(1 - Math.min(0.9, drag * speed * step));
    v.y += GRAVITY * step;
    p.addScaledVector(v, step);
    if (p.y <= radius) {
      samples.push({ t, p: p.clone().setY(radius), v: v.clone(), landed: true });
      break;
    }
    samples.push({ t, p: p.clone(), v: v.clone(), landed: false });
  }
  return samples;
}

/** 線分 a-b と点 c の最短距離（XZ 平面） */
function segmentDistance2D(ax, az, bx, bz, cx, cz) {
  const dx = bx - ax;
  const dz = bz - az;
  const length2 = dx * dx + dz * dz;
  const t = length2 > 1e-9 ? clamp(((cx - ax) * dx + (cz - az) * dz) / length2, 0, 1) : 0;
  return { distance: Math.hypot(ax + dx * t - cx, az + dz * t - cz), x: ax + dx * t, z: az + dz * t };
}

/** 線分と点の最短距離（3D）。1 フレームで 15cm 以上進む速い球の取りこぼし防止 */
function segmentDistance3D(a, b, c) {
  const ab = new THREE.Vector3().subVectors(b, a);
  const length2 = ab.lengthSq();
  const t = length2 > 1e-9 ? clamp(new THREE.Vector3().subVectors(c, a).dot(ab) / length2, 0, 1) : 0;
  return a.clone().addScaledVector(ab, t).distanceTo(c);
}

/** 点を動ける範囲に入れ、障害物の外へ押し出す */
function settle(point, fromZ = point.y) {
  point.x = clamp(point.x, PLAY_AREA.minX, PLAY_AREA.maxX);
  point.y = clamp(point.y, PLAY_AREA.minZ, PLAY_AREA.maxZ);
  for (const o of PARK.obstacles) {
    const dx = point.x - o.x;
    const dz = point.y - o.z;
    const r = o.r + BODY_RADIUS;
    const d = Math.hypot(dx, dz);
    if (d < r) {
      if (d > 1e-4) {
        point.x = o.x + (dx / d) * r;
        point.y = o.z + (dz / d) * r;
      } else {
        point.x = o.x + r;
      }
    }
  }
  // 柵。切れ目以外では、元いた側にとどめる
  const fz = PARK.fence.z;
  if (point.x < GAP.min || point.x > GAP.max) {
    if (fromZ > fz && point.y < fz + 0.3) point.y = fz + 0.3;
    if (fromZ < fz && point.y > fz - 0.3) point.y = fz - 0.3;
  }
  return point;
}

/**
 * 庭の中の道順。柵の向こう側へ行くなら切れ目を通し、途中の障害物は
 * 脇へよける点を 1 つ足してかわす（障害物はまばらなので、これで足りる）。
 */
function gardenPath(from, to) {
  const points = [from.clone()];
  const fz = PARK.fence.z;
  const sideA = Math.sign(from.y - fz);
  const sideB = Math.sign(to.y - fz);
  if (sideA !== sideB && sideA !== 0 && sideB !== 0) {
    const gx = clamp((from.x + to.x) / 2, GAP.min, GAP.max);
    points.push(new THREE.Vector2(gx, fz + sideA * 0.5));
    points.push(new THREE.Vector2(gx, fz + sideB * 0.5));
  }
  points.push(to.clone());

  // 障害物よけ。よけた点を足した線分もまた確かめる。
  //
  // 挿入数には上限を置く。滑り台の 2 つの円のように隣り合った障害物では、
  // 片方をよけた点がもう片方に入り、それをよけた点がまた元の円に入り…と
  // 際限なく点を足し続けて、実際にタブが落ちた。よけた点も settle で
  // 障害物の外へ出しておく。
  let inserted = 0;
  for (let i = 0; i < points.length - 1 && inserted < 4; i++) {
    const a = points[i];
    const b = points[i + 1];
    for (const o of PARK.obstacles) {
      const r = o.r + BODY_RADIUS + 0.1;
      const hit = segmentDistance2D(a.x, a.y, b.x, b.y, o.x, o.z);
      if (hit.distance >= r) continue;
      let nx = hit.x - o.x;
      let nz = hit.z - o.z;
      let n = Math.hypot(nx, nz);
      if (n < 1e-3) { nx = -(b.y - a.y); nz = b.x - a.x; n = Math.hypot(nx, nz); }
      if (n < 1e-6) break;   // 始点と終点が同じ
      const detour = new THREE.Vector2(o.x + (nx / n) * (r + 0.25), o.z + (nz / n) * (r + 0.25));
      points.splice(i + 1, 0, settle(detour, a.y));
      inserted++;
      i--;                   // 足した点までの線分を、もう一度確かめる
      break;
    }
  }
  return points.slice(1);
}

/** 投げる側と受ける側の間に、木や滑り台がはさまっていないか */
function lineClear(ax, az, bx, bz) {
  return PARK.obstacles.every((o) => !o.tall
    || segmentDistance2D(ax, az, bx, bz, o.x, o.z).distance > o.r + 0.35);
}

/**
 * @param {object} options
 * @param {ReturnType<import('./character.js').createCharacter>} options.character
 * @param {THREE.Object3D} options.ball
 * @param {THREE.Camera} options.camera プレイヤーの頭（XR 中も WebXRManager が更新する）
 * @param {THREE.Scene} options.scene
 */
export function createCatchGame({ character, ball, camera, scene }) {
  const body = character.body;
  const data = ball.userData;

  let state = 'off';
  let timer = 0;
  let outsideFor = 0;
  let insideFor = 0;
  let cooldown = 0;
  let restFor = 0;           // ボールが止まったまま転がっている時間
  let path = [];
  let spot = null;           // 待つ場所
  let spotFor = null;        // その場所を決めたときのプレイヤー位置
  let plan = null;           // 捕りにいく点 { stand, point, t }
  let planAge = 0;
  let replan = 0;            // 拾いにいく道順を引き直すまで
  let spotRetry = 0;         // 立ち位置を選び直すまでの待ち（毎フレーム探さない）
  let giveUp = 0;            // 届かない球を前に立っている時間
  const ignored = new THREE.Vector3(1e6, 0, 0);   // あきらめた球の位置
  const lastBall = new THREE.Vector3().copy(ball.position);
  const player = new THREE.Vector3();
  const playerForward = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const ready = new THREE.Vector3();
  const target2 = new THREE.Vector2();
  const holdAt = new THREE.Vector3();   // 持っている球の位置（捕った所から胸元へ寄せる）

  /** 捕った数・落とした数（検証用） */
  const stats = { caught: 0, missed: 0, pickedUp: 0, tossed: 0 };

  // 持っているあいだは、姿勢が決まった直後に手のあいだへ置く
  body.onPosed = () => {
    if (data.heldBy !== 'character') return;
    ball.position.copy(body.catchPoint);
  };

  function readPlayer() {
    camera.getWorldPosition(player);
    camera.getWorldDirection(playerForward);
    playerForward.y = 0;
    if (playerForward.lengthSq() < 1e-6) playerForward.set(0, 0, -1);
    playerForward.normalize();
  }

  // ボールが置かれている親。最初は家具のグループ、プレイヤーが一度持って
  // 放すとシーン直下になる。これ以外（コントローラー）の子なら手に持たれている
  const restParents = new Set([scene, ball.parent]);

  /** 誰にも持たれていない、飛んでいる / 転がっている / 置いてあるボールか */
  function ballFree() {
    return !data.held && restParents.has(ball.parent);
  }

  /** プレイヤーの見ている方向を優先して、PLAY_DISTANCE 離れた立ち位置を選ぶ */
  function chooseSpot() {
    let best = null;
    let bestScore = Infinity;
    const here = body.position;
    for (const distance of [PLAY_DISTANCE, PLAY_DISTANCE - 1, PLAY_DISTANCE + 1]) {
      for (let i = 0; i < 32; i++) {
        const angle = (i / 32) * Math.PI * 2;
        const x = player.x + Math.sin(angle) * distance;
        const z = player.z + Math.cos(angle) * distance;
        if (x < PLAY_AREA.minX || x > PLAY_AREA.maxX || z < PLAY_AREA.minZ || z > PLAY_AREA.maxZ) continue;
        if (PARK.obstacles.some((o) => Math.hypot(x - o.x, z - o.z) < o.r + 0.5)) continue;
        if (Math.abs(z - PARK.fence.z) < 0.5) continue;
        if (!lineClear(player.x, player.z, x, z)) continue;
        const facing = Math.abs(angleDelta(angle, Math.atan2(playerForward.x, playerForward.z)));
        const score = facing * 1.2 + Math.hypot(x - here.x, z - here.z) * 0.12
          + Math.abs(distance - PLAY_DISTANCE) * 0.4;
        if (score < bestScore) { bestScore = score; best = new THREE.Vector2(x, z); }
      }
      if (best) break;
    }
    return best;
  }

  /** プレイヤーの方を向いて立つ位置へ向かう */
  function goToSpot() {
    if (spotRetry > 0) return;
    spotRetry = 1.0;
    spot = chooseSpot();
    spotFor = player.clone();
    if (!spot) { state = 'ready'; return; }
    path = gardenPath(new THREE.Vector2(body.position.x, body.position.z), spot);
    state = 'reposition';
  }

  /** 決めた道順を歩く。着いたら true */
  function followPath(dt, speed) {
    if (path.length === 0) { body.stand(dt); return true; }
    if (body.stepTowards(path[0], dt, speed)) path.shift();
    return path.length === 0;
  }

  /** プレイヤーの胸の前あたりで構える点 */
  function readyPoint(out, height = 0.74) {
    const yaw = body.yaw;
    return out.set(
      body.position.x + Math.sin(yaw) * 0.26,
      body.headHeight * height,
      body.position.z + Math.cos(yaw) * 0.26,
    );
  }

  /** 飛んでくる球が「こちらへ向かっている」か */
  function incoming() {
    if (!ballFree() || cooldown > 0) return false;
    const v = data.velocity;
    if (v.length() < 2.0 || ball.position.y < 0.15) return false;
    const toMe = tmp.set(body.position.x - ball.position.x, 0, body.position.z - ball.position.z);
    const horizontal = Math.hypot(v.x, v.z);
    if (horizontal < 0.5) return false;
    // 進む向きと自分への向きが 50 度以内
    return (toMe.x * v.x + toMe.z * v.z) / (toMe.length() * horizontal + 1e-6) > Math.cos(0.87);
  }

  /** 地面を転がってこちらへ来る球（ゴロ） */
  function incomingGrounder() {
    if (!ballFree() || cooldown > 0) return false;
    const v = data.velocity;
    const horizontal = Math.hypot(v.x, v.z);
    if (ball.position.y > 0.1 || horizontal < 0.7) return false;
    const toX = body.position.x - ball.position.x;
    const toZ = body.position.z - ball.position.z;
    const d = Math.hypot(toX, toZ);
    return d < 7 && (toX * v.x + toZ * v.z) / (d * horizontal + 1e-6) > Math.cos(0.87);
  }

  /** 球がこちらへ近づいているか（向きだけ） */
  function approaching() {
    const toX = body.position.x - ball.position.x;
    const toZ = body.position.z - ball.position.z;
    return toX * data.velocity.x + toZ * data.velocity.z > 0;
  }

  /**
   * 捕る点を決める。軌道の上で「手の届く高さにあり、そこへ間に合う」点の
   * うち、胸の高さに近く、動く距離が短いものを選ぶ。どれも間に合わなければ
   * 落ちたところへ向かう（転がったのを拾う）。
   */
  function planCatch() {
    const samples = predictFlight(ball.position, data.velocity, data.drag ?? 0.02, data.halfSize);
    const h = body.headHeight;
    const low = 0.30;
    const high = h * 1.08;
    const chest = h * 0.72;
    let best = null;
    let bestScore = Infinity;
    const here = new THREE.Vector2(body.position.x, body.position.z);
    for (const s of samples) {
      if (s.p.y < low || s.p.y > high) continue;
      const horizontal = Math.hypot(s.v.x, s.v.z) || 1;
      // 体は球の来る向きに正対し、手のあいだ（体の 0.3m 前）で受ける
      const stand = settle(new THREE.Vector2(
        s.p.x + (s.v.x / horizontal) * 0.30,
        s.p.z + (s.v.z / horizontal) * 0.30,
      ), body.position.z);
      const need = stand.distanceTo(here);
      const can = HURRY * Math.max(0, s.t - REACTION) + 0.12;
      if (need > can) continue;
      const score = need + Math.abs(s.p.y - chest) * 1.4 + s.t * 0.05;
      if (score < bestScore) {
        bestScore = score;
        best = { stand, point: s.p.clone(), t: s.t, from: new THREE.Vector3(-s.v.x, 0, -s.v.z) };
      }
    }
    const last = samples[samples.length - 1];
    return { catch: best, landing: last ? last.p.clone() : ball.position.clone() };
  }

  function takeBall() {
    data.held = true;
    data.heldBy = 'character';
    data.velocity.set(0, 0, 0);
    data.spin.set(0, 0, 0);
    ball.position.copy(body.catchPoint);
    holdAt.copy(body.catchPoint);
    body.setFocus(false);
  }

  /**
   * 仮の投げ返し（段階 4 で振りかぶりの動きに置き換える）。
   * プレイヤーの胸へ、距離に応じた山なりで届く初速を解いて放る。
   */
  function tossBack() {
    const from = body.catchPoint.clone();
    from.x += Math.sin(body.yaw) * 0.08;
    from.z += Math.cos(body.yaw) * 0.08;
    const to = tmp.set(player.x, player.y - 0.35, player.z);
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const distance = Math.hypot(dx, dz);
    const t = clamp(0.45 + distance * 0.09, 0.55, 1.1);
    ball.position.copy(from);
    data.velocity.set(dx / t, (to.y - from.y - 0.5 * GRAVITY * t * t) / t, dz / t);
    data.spin.set(-data.velocity.z, 0, data.velocity.x).multiplyScalar(0.3 / data.halfSize);
    data.held = false;
    data.heldBy = null;
    cooldown = COOLDOWN;
    stats.tossed++;
  }

  /** 持っていたボールをその場に置いて手を離す */
  function dropBall() {
    if (data.heldBy !== 'character') return;
    data.held = false;
    data.heldBy = null;
    data.velocity.set(0, 0, 0);
  }

  function startGoingIn() {
    dropBall();
    body.reach(null);
    body.setCrouch(0);
    body.setBend(0);
    body.setFocus(false);
    const here = new THREE.Vector2(body.position.x, body.position.z);
    const door = body.entryRoute();
    path = here.y < OUTSIDE_Z ? gardenPath(here, door[0]).concat(door.slice(1)) : door;
    state = 'goIn';
  }

  function update(dt) {
    if (!body.loaded) return;
    readPlayer();
    cooldown = Math.max(0, cooldown - dt);
    spotRetry = Math.max(0, spotRetry - dt);

    const playerOutside = player.z < OUTSIDE_Z;
    const playerInside = player.z > INSIDE_Z;
    outsideFor = playerOutside ? outsideFor + dt : 0;
    insideFor = playerInside ? insideFor + dt : 0;

    // プレイヤーが持っていったら、こちらは手を離す（奪われた）
    if (data.heldBy === 'character' && !restParents.has(ball.parent)) data.heldBy = null;

    const ballMoved = lastBall.distanceTo(ball.position);
    const speed = data.velocity.length();
    restFor = ballFree() && speed < 0.05 && ballMoved < 1e-3 ? restFor + dt : 0;

    switch (state) {
      case 'off': {
        if (outsideFor < 0.8) break;
        if (!body.free) { body.requestStand(); break; }
        body.drive({ get state() { return state; } });
        const route = body.exitRoute();
        const terrace = route[route.length - 1];
        spot = chooseSpot();
        spotFor = player.clone();
        path = route.concat(spot ? gardenPath(terrace, spot) : []);
        state = 'goOut';
        break;
      }

      case 'goOut':
      case 'reposition': {
        const outside = body.position.z < OUTSIDE_Z;
        if (outside && incoming()) { beginField(); break; }
        if (followPath(dt, state === 'goOut' && !outside ? 0.6 : WALK)) state = 'ready';
        break;
      }

      case 'ready': {
        const faceYaw = Math.atan2(player.x - body.position.x, player.z - body.position.z);
        body.turnTowards(faceYaw, dt);
        body.setCrouch(0.10);
        body.setBend(0.10);
        body.reach(readyPoint(ready), 0.55, 0.12);

        if (incoming()) { beginField(); break; }
        if (incomingGrounder()) { body.setFocus(true); state = 'chase'; break; }

        // ボールが止まったまま転がっていて、プレイヤーの手元でもなければ拾いにいく
        if (restFor > 1.2 && ball.position.y < 0.2
          && ball.position.distanceTo(ignored) > 0.3
          && Math.hypot(ball.position.x - player.x, ball.position.z - player.z) > 1.3
          && ball.position.z < OUTSIDE_Z) {
          state = 'chase';
          break;
        }

        // プレイヤーが大きく動いたら立ち位置を取り直す（庭にいるときだけ。
        // 部屋へ戻りかけたプレイヤーを基準に選ぶと、家の壁ぎわへ寄っていく）
        if (!playerOutside) break;
        if (spotFor && Math.hypot(player.x - spotFor.x, player.z - spotFor.z) > 1.6) goToSpot();
        const gap = Math.hypot(player.x - body.position.x, player.z - body.position.z);
        if (gap < 2.5 || gap > 6.8) goToSpot();
        // 拾いにいった先から、元の立ち位置へ戻る
        else if (spot && Math.hypot(spot.x - body.position.x, spot.y - body.position.z) > 1.8) goToSpot();
        break;
      }

      case 'field': {
        planAge += dt;
        if (planAge > 0.2 && ballFree() && ball.position.y > 0.1) {
          // 軌道は決まっているが、跳ねや壁で変わることがあるので少しずつ見直す
          const next = planCatch();
          if (next.catch) plan = next.catch;
          planAge = 0;
        }
        const dist = ball.position.distanceTo(body.catchPoint);

        if (plan) {
          target2.copy(plan.stand);
          const arrived = Math.hypot(target2.x - body.position.x, target2.y - body.position.z) < 0.05;
          if (!arrived) body.stepTowards(target2, dt, HURRY);
          else body.turnTowards(Math.atan2(plan.from.x, plan.from.z), dt);
        } else {
          body.stand(dt);
        }

        // 近づいてきたら手を球へ。遠いうちは構えのまま
        const reachIn = clamp(1 - (dist - 0.4) / 1.6, 0, 1);
        const handsAt = readyPoint(ready);
        if (ballFree()) handsAt.lerp(ball.position, reachIn * 0.85);
        body.reach(handsAt, 0.55 + reachIn * 0.45, 0.075 + (1 - reachIn) * 0.05);
        body.setCrouch(0.14);
        body.setBend(0.12);

        if (ballFree() && segmentDistance3D(lastBall, ball.position, body.catchPoint) < CATCH_RADIUS) {
          takeBall();
          stats.caught++;
          timer = 0;
          state = 'hold';
          break;
        }
        // 落ちた / 通り過ぎた
        const passed = ball.position.y < 0.12
          || (Math.hypot(ball.position.x - body.position.x, ball.position.z - body.position.z) > 0.8
            && !incoming());
        if (!ballFree()) state = 'ready';
        else if (passed) { stats.missed++; state = 'chase'; }
        break;
      }

      case 'chase': {
        if (!ballFree()) { state = 'ready'; break; }
        body.setFocus(true);
        body.reach(null);
        body.setCrouch(0);
        body.setBend(0);
        if (incoming()) { beginField(); break; }
        // 飛んでいるうちは落ちる場所へ、転がっていれば少し先を見越して向かう
        if (ball.position.y > 0.2) {
          const samples = predictFlight(ball.position, data.velocity, data.drag ?? 0.02, data.halfSize);
          const landing = samples[samples.length - 1]?.p ?? ball.position;
          target2.set(landing.x, landing.z);
        } else {
          const lead = clamp(speed * 0.5, 0, 1.2);
          const horizontal = Math.hypot(data.velocity.x, data.velocity.z) || 1;
          target2.set(
            ball.position.x + (data.velocity.x / horizontal) * lead,
            ball.position.z + (data.velocity.z / horizontal) * lead,
          );
        }
        // 滑り台の下などに入った球は、障害物の縁までしか寄れない。そこから
        // 手が届けば拾い、届かなければしばらくしてあきらめる
        const edge = settle(new THREE.Vector2(ball.position.x, ball.position.z), body.position.z);
        const gapToBall = Math.hypot(edge.x - ball.position.x, edge.y - ball.position.z);
        if (gapToBall > 0.5 && speed < 0.3 && ball.position.y < 0.2) {
          giveUp += dt;
          body.stand(dt);
          if (giveUp > 2.5) {
            ignored.copy(ball.position);
            body.setFocus(false);
            state = 'ready';
          }
          break;
        }
        giveUp = 0;
        // ボールの手前（しゃがんで手が届く距離）で止まる
        const stopAt = clamp(gapToBall + 0.05, 0.34, 0.5);
        const dx = target2.x - body.position.x;
        const dz = target2.y - body.position.z;
        const d = Math.hypot(dx, dz);
        if (d > stopAt + 0.02) {
          target2.set(body.position.x + dx * (1 - stopAt / d), body.position.z + dz * (1 - stopAt / d));
          settle(target2, body.position.z);
          // 滑り台や木の向こうへ転がったら回り込む。まっすぐ向かうと障害物に
          // 押し戻され続けて、2 つの円のあいだに挟まって動けなくなる
          replan -= dt;
          if (replan <= 0 || path.length === 0) {
            path = gardenPath(new THREE.Vector2(body.position.x, body.position.z), target2.clone());
            replan = 0.3;
          }
          followPath(dt, speed > 0.3 || ball.position.y > 0.2 ? HURRY : WALK + 0.15);
        } else if (speed < 0.35 || approaching()) {
          // 止まった球か、こちらへ転がってくる球なら、しゃがんで拾う
          timer = 0;
          state = 'pickUp';
        } else {
          body.stand(dt);
        }
        break;
      }

      case 'pickUp': {
        if (!ballFree()) { state = 'ready'; body.setCrouch(0); body.setBend(0); break; }
        timer += dt;
        const yawToBall = Math.atan2(ball.position.x - body.position.x, ball.position.z - body.position.z);
        body.turnTowards(yawToBall, dt);
        // 深くしゃがみ、骨盤ごと前へ倒して手を地面へ（character.js の applyCrouch）
        body.setCrouch(1);
        body.setBend(1);
        body.reach(ball.position, Math.min(1, timer / 0.3), 0.07);
        // 転がってくる球は手の間を通り過ぎる瞬間を捕る（1 フレームの移動を線分で見る）
        const reached = segmentDistance3D(lastBall, ball.position, body.catchPoint) < 0.2;
        if (timer > 0.45 && reached) {
          takeBall();
          stats.pickedUp++;
          timer = 0;
          state = 'hold';
        } else if (timer > 1.6 || (speed > 0.35 && !approaching())) {
          // 届かなかった / 転がっていってしまった。もう一度寄り直す
          state = 'chase';
        }
        break;
      }

      case 'hold': {
        if (data.heldBy !== 'character') { state = 'ready'; break; }
        timer += dt;
        body.setCrouch(0.06);
        body.setBend(0);
        const faceYaw = Math.atan2(player.x - body.position.x, player.z - body.position.z);
        const facing = body.turnTowards(faceYaw, dt);
        // 捕った手をそのまま胸元へ引き寄せる。いきなり胸の前へ持っていくと、
        // 伸ばしていた腕が 1 フレームで縮んで見える
        holdAt.lerp(readyPoint(ready, 0.62), Math.min(1, dt * 5));
        body.reach(holdAt, 1, 0.07);
        // 胸の前で持って、相手のほうを向いてから返す
        if (timer > 1.5 && facing && playerOutside) {
          tossBack();
          timer = 0;
          state = 'ready';
        }
        break;
      }

      case 'goIn':
        if (followPath(dt, WALK)) {
          body.drive(null, body.exitNode());
          state = 'off';
        }
        break;
    }

    // プレイヤーが部屋へ戻ったら、しばらくして自分も戻る
    if (state !== 'off' && state !== 'goIn' && insideFor > 5) startGoingIn();

    // 障害物と柵は歩いていてもすり抜けない
    // （動ける範囲の縁より家側、つまり掃き出し窓を出入りしているあいだは触らない。
    // 押し戻すと窓を出た瞬間に 30cm 跳ぶ）
    if (state !== 'off' && state !== 'goIn' && body.position.z < PLAY_AREA.maxZ) {
      const p = new THREE.Vector2(body.position.x, body.position.z);
      settle(p, lastZ);
      body.position.x = p.x;
      body.position.z = p.y;
    }
    lastZ = body.position.z;
    lastBall.copy(ball.position);
  }
  let lastZ = body.position.z;

  function beginField() {
    const next = planCatch();
    plan = next.catch;
    planAge = 0;
    body.setFocus(false);
    if (!plan) {
      // 間に合わない。落ちる場所へ向かっておき、転がったら拾う
      state = 'chase';
      return;
    }
    state = 'field';
  }

  return {
    update,
    get state() { return state; },
    get plan() { return plan; },
    stats,
    /** 検証用 */
    predictFlight: (p, v) => predictFlight(p, v, data.drag ?? 0.02, data.halfSize),
  };
}
