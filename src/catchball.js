import * as THREE from 'three';
import { ROOM } from './room.js';
import { PARK } from './park.js';
import { createThrow } from './throwing.js';

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
 * 投げ返しは throwing.js の投球モーション（振りかぶり → 踏み込み →
 * リリース → フォロースルー）で、手を離す瞬間に相手の胸へ届く初速を解く。
 */

/**
 * 投げ合う距離（m）。子どもとのキャッチボールで無理のない 4.5m から始め、
 * ラリーが続くと 1 往復ごとに 20cm ずつ離れていく（最大 6.3m）。
 * 取りこぼしたら最初の距離に戻る。
 */
const PLAY_DISTANCE = 4.5;
const DISTANCE_STEP = 0.2;
const DISTANCE_STEPS = 9;
/** 女の子の送球のばらつき（5m での標準偏差、m）。距離に比例させる */
const SCATTER_SIDE = 0.16;
const SCATTER_HEIGHT = 0.10;
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

/** 待つ場所を選ぶ範囲。家の壁と庭の縁から離して、投げ合う余裕を残す */
const PLAY_AREA = { minX: -5.4, maxX: 5.4, minZ: -12.4, maxZ: OUTSIDE_Z - 0.35 };
/**
 * 歩ける範囲。庭の縁（world.js の GARDEN）ぎりぎりまで。待つ場所の範囲と
 * 共用していたときは、縁へ転がった球の 50cm 手前で止まって拾えなかった
 */
const MOVE_AREA = { minX: -5.75, maxX: 5.75, minZ: -12.75, maxZ: OUTSIDE_Z - 0.35 };
/**
 * 庭の奥のテニスコート（外まわりまで）。球がコートへ転がって行ったら、
 * そこまで拾いに行けるように、動ける範囲は庭とコートを合わせたものにする
 */
const COURT_AREA = (() => {
  const c = PARK.court;
  const halfW = c.width / 2 + c.runoffSide - 0.25;
  return { minX: c.x - halfW, maxX: c.x + halfW, minZ: c.z - c.length / 2 - c.runoffEnd + 0.25 };
})();
/** 柵の切れ目のうち、体（半径 0.22m）が通り抜けられる x の範囲。押し戻しはこれで判定する */
const GAP = {
  min: PARK.fence.gapX - PARK.fence.gap / 2 + 0.22,
  max: PARK.fence.gapX + PARK.fence.gap / 2 - 0.22,
};
/**
 * 道順で切れ目を通る点は、さらに内側へ寄せる。通れる幅のちょうど端に
 * 置くと、少し外へずれた瞬間に柵へ押し戻され、切れ目の端で動けなくなった
 */
const GAP_PATH = { min: GAP.min + 0.25, max: GAP.max - 0.25 };
const BODY_RADIUS = 0.22;
const FENCE_MARGIN = 0.18;
/**
 * この距離までの位置直しは、相手を向いたまま寄る（m）。背を向けて歩いて
 * 行って振り返ると、こちらが捕った瞬間に横を向いているように見える
 */
const ADJUST_RANGE = 2.6;
const ADJUST_SPEED = 0.7;

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

/**
 * 障害物の芯（円なら中心、カプセルなら線分）の上で、点 (px, pz) にいちばん近い点
 */
function coreClosest(o, px, pz) {
  if (o.x2 === undefined) return { x: o.x, z: o.z };
  const hit = segmentDistance2D(o.x, o.z, o.x2, o.z2, px, pz);
  return { x: hit.x, z: hit.z };
}

/** 線分 a-b と障害物の芯との最短距離。カプセルは芯を刻んで調べる */
function segmentToObstacle(ax, az, bx, bz, o) {
  if (o.x2 === undefined) return { ...segmentDistance2D(ax, az, bx, bz, o.x, o.z), cx: o.x, cz: o.z };
  let best = null;
  for (let i = 0; i <= 12; i++) {
    const cx = o.x + (o.x2 - o.x) * (i / 12);
    const cz = o.z + (o.z2 - o.z) * (i / 12);
    const hit = segmentDistance2D(ax, az, bx, bz, cx, cz);
    if (!best || hit.distance < best.distance) best = { ...hit, cx, cz };
  }
  return best;
}

/**
 * 点を動ける範囲（庭とコートを合わせたもの）のいちばん近いところへ寄せる。
 * 庭より奥でコートの幅から外れた点は、コートの横へ寄せるか庭の縁へ戻すか、
 * 近いほうにする（いつもコートへ寄せると、庭の端から奥へ出た瞬間に横へ跳ぶ）
 */
function clampToArea(point) {
  point.x = clamp(point.x, MOVE_AREA.minX, MOVE_AREA.maxX);
  point.y = Math.min(point.y, MOVE_AREA.maxZ);
  if (point.y >= MOVE_AREA.minZ) return;
  const cx = clamp(point.x, COURT_AREA.minX, COURT_AREA.maxX);
  const cz = Math.max(point.y, COURT_AREA.minZ);
  const toCourt = Math.hypot(point.x - cx, point.y - cz);
  const toGarden = MOVE_AREA.minZ - point.y;
  if (toCourt <= toGarden) {
    point.x = cx;
    point.y = cz;
  } else {
    point.y = MOVE_AREA.minZ;
  }
}

/** 点を動ける範囲に入れ、障害物の外へ押し出す */
export function settle(point, fromZ = point.y) {
  clampToArea(point);
  for (const o of PARK.obstacles) {
    const c = coreClosest(o, point.x, point.y);
    const dx = point.x - c.x;
    const dz = point.y - c.z;
    const r = o.r + BODY_RADIUS;
    const d = Math.hypot(dx, dz);
    if (d < r) {
      if (d > 1e-4) {
        point.x = c.x + (dx / d) * r;
        point.y = c.z + (dz / d) * r;
      } else {
        point.x = c.x + r;
      }
    }
  }
  // 柵。切れ目以外では、元いた側にとどめる
  const fz = PARK.fence.z;
  // 余白は体の半径ぶん。広く取りすぎると、柵とシュートの端のあいだが
  // 通れなくなり、柵ぎわに止まった球を取りに行けなかった
  if (point.x < GAP.min || point.x > GAP.max) {
    if (fromZ > fz && point.y < fz + FENCE_MARGIN) point.y = fz + FENCE_MARGIN;
    if (fromZ < fz && point.y > fz - FENCE_MARGIN) point.y = fz - FENCE_MARGIN;
  }
  return point;
}

/**
 * 庭の中の道順。柵の向こう側へ行くなら切れ目を通し、途中の障害物は
 * 脇へよける点を 1 つ足してかわす（障害物はまばらなので、これで足りる）。
 */
export function gardenPath(from, to) {
  const points = [from.clone()];
  const fz = PARK.fence.z;
  const sideA = Math.sign(from.y - fz);
  const sideB = Math.sign(to.y - fz);
  if (sideA !== sideB && sideA !== 0 && sideB !== 0) {
    const gx = clamp((from.x + to.x) / 2, GAP_PATH.min, GAP_PATH.max);
    // すでに切れ目の中にいるなら、手前の点は入れない。道順は 0.3 秒ごとに
    // 引き直すので、入れると少し進んだところで手前の点が背中側になり、
    // 切れ目の前で行ったり来たりして抜けられなかった
    const inGap = from.x >= GAP.min - 0.05 && from.x <= GAP.max + 0.05 && Math.abs(from.y - fz) < 0.6;
    // 切れ目の前後の点も障害物の外へ出す。シュートの端が切れ目のすぐ先にあり、
    // 抜けた先の点が余白の中へ入って、いつまでもそこへ着けなかった
    if (!inGap) points.push(settle(new THREE.Vector2(gx, fz + sideA * 0.5), fz + sideA));
    points.push(settle(new THREE.Vector2(inGap ? clamp(from.x, GAP_PATH.min, GAP_PATH.max) : gx, fz + sideB * 0.5), fz + sideB));
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
    const last = i === points.length - 2;
    for (const o of PARK.obstacles) {
      const r = o.r + BODY_RADIUS + 0.1;
      // 行き先そのものが障害物に寄り添っている（木の根元の球を拾う）ときは、
      // 最後の区間でその障害物をよけない。よけると、余白の内側にある行き先へ
      // いつまでも入れず、まわりを回り続ける
      const near = coreClosest(o, b.x, b.y);
      if (last && Math.hypot(b.x - near.x, b.y - near.z) < r + 0.05) continue;
      const hit = segmentToObstacle(a.x, a.y, b.x, b.y, o);
      if (hit.distance >= r) continue;
      let nx = hit.x - hit.cx;
      let nz = hit.z - hit.cz;
      let n = Math.hypot(nx, nz);
      if (n < 1e-3) { nx = -(b.y - a.y); nz = b.x - a.x; n = Math.hypot(nx, nz); }
      if (n < 1e-6) break;   // 始点と終点が同じ
      const detour = new THREE.Vector2(hit.cx + (nx / n) * (r + 0.25), hit.cz + (nz / n) * (r + 0.25));
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
    || segmentToObstacle(ax, az, bx, bz, o).distance > o.r + 0.35);
}

/**
 * @param {object} options
 * @param {ReturnType<import('./character.js').createCharacter>} options.character
 * @param {THREE.Object3D} options.ball
 * @param {THREE.Camera} options.camera プレイヤーの頭（XR 中も WebXRManager が更新する）
 * @param {THREE.Scene} options.scene
 */
export function createCatchGame({ character, ball, camera, scene, voice = null }) {
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
  let throwing = null;       // 投球中のモーション
  let giveUp = 0;            // 届かない球を前に立っている時間
  const ignored = new THREE.Vector3(1e6, 0, 0);   // あきらめた球の位置
  const lastBall = new THREE.Vector3().copy(ball.position);
  const player = new THREE.Vector3();
  const playerForward = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const ready = new THREE.Vector3();
  const target2 = new THREE.Vector2();
  const holdAt = new THREE.Vector3();   // 持っている球の位置（捕った所から胸元へ寄せる）
  // holdAt は体から見た位置（前 z・上 y・左 x）で持つ。ワールドのまま持つと、
  // 持ったまま下がったり向きを変えたりしたときに手が取り残される
  const holdLocal = new THREE.Vector3();
  const toLocal = (p, out) => {
    const dx = p.x - body.position.x;
    const dz = p.z - body.position.z;
    const c = Math.cos(body.yaw);
    const sn = Math.sin(body.yaw);
    return out.set(dx * c - dz * sn, p.y, dx * sn + dz * c);
  };
  const toWorldPoint = (l, out) => {
    const c = Math.cos(body.yaw);
    const sn = Math.sin(body.yaw);
    return out.set(body.position.x + l.x * c + l.z * sn, l.y, body.position.z - l.x * sn + l.z * c);
  };

  /** 捕った数・落とした数（検証用） */
  const stats = { caught: 0, missed: 0, fumbled: 0, pickedUp: 0, tossed: 0, rally: 0, best: 0 };

  // --- ラリー ---------------------------------------------------------------
  // 地面に落とさずに何回やりとりできたか。いま飛んでいる球を誰が投げたかを
  // 覚えておき、相手が手で受けたら +1、地面に着いたら 0 に戻す。
  let flight = null;          // 'girl' | 'player' | null
  let cheerFor = 0;           // 受けてもらって喜んでいるあいだ（立ち位置を直さない）
  let lastHeldBy = data.heldBy ?? null;
  const preferredDistance = () => PLAY_DISTANCE + Math.min(stats.rally, DISTANCE_STEPS) * DISTANCE_STEP;

  const board = createRallyBoard();
  scene.add(board.sprite);

  function bumpRally() {
    stats.rally++;
    stats.best = Math.max(stats.best, stats.rally);
    board.show(stats.rally, stats.best);
  }
  /** 5 の倍数のラリーなら、その回数を言う。言ったら true */
  function sayRally() {
    return stats.rally >= 5 && stats.rally % 5 === 0 && Boolean(voice?.say('rally', { n: stats.rally }));
  }
  function breakRally() {
    if (stats.rally > 0) board.show(0, stats.best, true);
    stats.rally = 0;
  }

  /** 誰が投げた / 受けたかを見て、ラリーを数える */
  function trackRally() {
    const heldBy = data.heldBy ?? null;
    const byPlayer = (who) => who === 'player' || who === 'desktop';
    if (heldBy !== lastHeldBy) {
      // プレイヤーの手から離れて飛んでいった
      if (byPlayer(lastHeldBy) && !heldBy && data.velocity.length() > 1.5) flight = 'player';
      // 女の子の球をプレイヤーが受けた。こちらを向いたまま、にっこり笑う
      if (byPlayer(heldBy) && flight === 'girl') {
        bumpRally();
        flight = null;
        body.smile(2.4, 1);
        cheerFor = 1.8;
        if (!sayRally()) voice?.say('playerCatch');
      }
      lastHeldBy = heldBy;
    }
    // 地面に着いた（ワンバウンドも途切れたことにする）
    if (flight && ballFree() && ball.position.y <= data.halfSize + 0.004) {
      // 自分の送球をプレイヤーが受けられなかった
      if (flight === 'girl') voice?.say('playerMiss', { chance: 0.7 });
      breakRally();
      flight = null;
    }
  }

  // 乱数は差し替えられるようにしておく（検証で再現できるように）
  let random = Math.random;
  const gauss = () => {
    const u = Math.max(1e-9, random());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
  };

  /**
   * 捕れる見込み。胸の高さで正面に入れた球はほぼ捕るが、速い球・高い / 低い球・
   * 走り込みが間に合わず手だけ伸ばした球は、ときどき手からこぼす。
   * 何でも捕れてしまうと、相手が人形のように見える。
   */
  function catchChance() {
    const h = body.headHeight;
    let p = 0.97;
    const speed = data.velocity.length();
    if (speed > 8) p -= (speed - 8) * 0.07;
    const dh = Math.abs(ball.position.y - h * 0.72) / h;
    p -= Math.max(0, dh - 0.25) * 0.8;
    if (plan) {
      const off = Math.hypot(plan.stand.x - body.position.x, plan.stand.y - body.position.z);
      p -= clamp((off - 0.1) * 0.8, 0, 0.35);
    }
    return clamp(p, 0.25, 0.97);
  }

  /** 手に当ててこぼす。少し上に弾んで、足元へ落ちる */
  function fumble() {
    const v = data.velocity;
    const side = (random() - 0.5) * 1.2;
    v.set(-v.x * 0.15 + Math.cos(body.yaw) * side, 1.1 + random() * 0.6, -v.z * 0.15 - Math.sin(body.yaw) * side);
    data.spin.set(random() - 0.5, random() - 0.5, random() - 0.5).multiplyScalar(30);
    cooldown = 0.5;
    stats.fumbled++;
  }

  // 持っているあいだは、姿勢が決まった直後に手のあいだへ置く。
  // 投球中は右手のひらに付ける
  const palm = new THREE.Vector3();
  body.onPosed = () => {
    if (data.heldBy !== 'character') return;
    if (throwing) ball.position.copy(body.palm('right', palm));
    else ball.position.copy(body.catchPoint);
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
    const want = preferredDistance();
    for (const distance of [want, want - 1, want + 1]) {
      for (let i = 0; i < 32; i++) {
        const angle = (i / 32) * Math.PI * 2;
        const x = player.x + Math.sin(angle) * distance;
        const z = player.z + Math.cos(angle) * distance;
        if (x < PLAY_AREA.minX || x > PLAY_AREA.maxX || z < PLAY_AREA.minZ || z > PLAY_AREA.maxZ) continue;
        if (PARK.obstacles.some((o) => { const c = coreClosest(o, x, z); return Math.hypot(x - c.x, z - c.z) < o.r + 0.5; })) continue;
        if (Math.abs(z - PARK.fence.z) < 0.5) continue;
        if (!lineClear(player.x, player.z, x, z)) continue;
        const facing = Math.abs(angleDelta(angle, Math.atan2(playerForward.x, playerForward.z)));
        const score = facing * 1.2 + Math.hypot(x - here.x, z - here.z) * 0.12
          + Math.abs(distance - want) * 0.4;
        if (score < bestScore) { bestScore = score; best = new THREE.Vector2(x, z); }
      }
      if (best) break;
    }
    return best;
  }

  /**
   * 立ち位置を直すべきか。投げるたびに踏み込みで 30cm、捕るたびに前へ
   * 出るぶんが積み重なり、放っておくと 1 往復ごとに間合いが縮んで、
   * 20 往復でプレイヤーの目の前まで来てしまった。望む間合いから 0.5m、
   * 決めた立ち位置から 0.6m ずれたら戻る。ラリーが続いて望む間合いが
   * 広がったときも、これで下がる。
   */
  function needsSpot() {
    const gap = Math.hypot(player.x - body.position.x, player.z - body.position.z);
    if (gap < 2.5 || Math.abs(gap - preferredDistance()) > 0.5) return true;
    return Boolean(spot && Math.hypot(spot.x - body.position.x, spot.y - body.position.z) > 0.6);
  }

  /** プレイヤーの方を向いて立つ位置へ向かう */
  function goToSpot() {
    if (spotRetry > 0) return;
    spotRetry = 1.0;
    const next = chooseSpot();
    spotFor = player.clone();
    if (!next) { state = 'ready'; return; }
    spot = next;
    // 近くて、まっすぐ寄れる（柵や障害物をよけなくてよい）なら、相手を向いたまま寄る。
    // 背を向けて歩いて行って振り返るのは大げさ。柵の向こうへ横歩きで寄ろうと
    // すると柵に押し戻され続けるので、そのときは道順を引いて歩く
    const route = gardenPath(new THREE.Vector2(body.position.x, body.position.z), spot);
    if (route.length === 1 && Math.hypot(spot.x - body.position.x, spot.y - body.position.z) < ADJUST_RANGE) {
      path = [];
      timer = 0;
      state = 'adjust';
      return;
    }
    path = route;
    state = 'reposition';
  }

  /** 相手を向いたまま立ち位置へ寄る。着いたら true */
  function adjustToSpot(dt) {
    if (!spot) return true;
    const faceYaw = Math.atan2(player.x - body.position.x, player.z - body.position.z);
    if (Math.hypot(spot.x - body.position.x, spot.y - body.position.z) > ADJUST_RANGE) return true;
    return body.stepFacing(spot, dt, ADJUST_SPEED, faceYaw);
  }

  /**
   * 決めた道順を歩く。着いたら true。
   * 押し戻されて点へ近づけないまま 0.8 秒たったら、その点は飛ばす
   * （障害物の余白の中に点が入ると、いつまでも着けずに立ち尽くす）
   */
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
    toLocal(body.catchPoint, holdLocal);
    body.setFocus(false);
  }

  /**
   * 手を離す。プレイヤーの胸へ、距離に応じた山なりで届く初速を解いて放る。
   * 空気抵抗は 5m で 1.5% ほどしか効かないので、解くときは無視している。
   */
  function release(from) {
    const to = tmp.set(player.x, player.y - 0.35, player.z);
    // 毎回ぴったり胸には来ない。距離に比例して左右と高さがばらつく
    const ax = to.x - from.x;
    const az = to.z - from.z;
    const reach = Math.hypot(ax, az) || 1;
    const k = reach / 5;
    const side = gauss() * SCATTER_SIDE * k;
    to.x += (az / reach) * side;      // 投げる向きに直角な方向へずらす
    to.z -= (ax / reach) * side;
    to.y += gauss() * SCATTER_HEIGHT * k;
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
    flight = 'girl';
  }

  /** 持っていたボールをその場に置いて手を離す */
  function dropBall() {
    if (data.heldBy !== 'character') return;
    data.held = false;
    data.heldBy = null;
    data.velocity.set(0, 0, 0);
  }

  function startGoingIn() {
    voice?.say('goIn');
    throwing?.cancel();
    throwing = null;
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

  /** body.drive に渡す窓口（検証のログに「いまの状態」を出す） */
  const driver = { get state() { return state; } };

  /**
   * テニスに体を譲る。持っている球は置き、投げかけていたらやめる。
   * 譲っているあいだ update は呼ばれない（world.js が止める）
   */
  function suspend() {
    if (state === 'suspended') return;
    throwing?.cancel();
    throwing = null;
    dropBall();
    body.reach(null);
    body.reachHands(null);
    body.setThrowPose(null);
    body.setCrouch(0);
    body.setBend(0);
    body.setFocus(false);
    board.sprite.visible = false;
    flight = null;
    path = [];
    state = 'suspended';
  }

  /** テニスから戻る。庭（コート）にいれば構えから、部屋にいれば部屋のうろうろから */
  function resume() {
    if (state !== 'suspended') return;
    lastBall.copy(ball.position);
    readPlayer();
    if (body.position.z < OUTSIDE_Z) {
      body.drive(driver);
      body.setAttend(true);
      spot = null;
      spotFor = null;
      spotRetry = 0;
      timer = 0;
      state = 'ready';
      goToSpot();
    } else {
      body.drive(null);
      state = 'off';
    }
  }

  function update(dt) {
    if (!body.loaded || state === 'suspended') return;
    readPlayer();
    cooldown = Math.max(0, cooldown - dt);
    spotRetry = Math.max(0, spotRetry - dt);

    const playerOutside = player.z < OUTSIDE_Z;
    const playerInside = player.z > INSIDE_Z;
    outsideFor = playerOutside ? outsideFor + dt : 0;
    insideFor = playerInside ? insideFor + dt : 0;

    // プレイヤーが持っていったら、こちらは手を離す（奪われた）
    if (data.heldBy === 'character' && !restParents.has(ball.parent)) data.heldBy = null;

    trackRally();
    board.update(dt, body);
    cheerFor = Math.max(0, cheerFor - dt);
    body.setHandOpen(0);   // 指は field のときだけ開く

    const ballMoved = lastBall.distanceTo(ball.position);
    const speed = data.velocity.length();
    restFor = ballFree() && speed < 0.05 && ballMoved < 1e-3 ? restFor + dt : 0;

    switch (state) {
      case 'off': {
        if (outsideFor < 0.8) break;
        if (!body.free) { body.requestStand(); break; }
        body.drive(driver);
        body.setAttend(true);
        voice?.say('invite');
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
        // 歩くときは腕を下ろす。構えの目標点を残したまま振り返って歩くと、
        // 背中側に残った目標点へ両腕が引っぱられた（歩きながら腕を後ろへ突き出す）
        body.reach(null);
        body.setCrouch(0);
        body.setBend(0);
        const outside = body.position.z < OUTSIDE_Z;
        if (outside && incoming()) { beginField(); break; }
        if (followPath(dt, state === 'goOut' && !outside ? 0.6 : WALK)) state = 'ready';
        break;
      }

      case 'adjust': {
        if (incoming()) { beginField(); break; }
        timer += dt;
        body.setCrouch(0.10);
        body.setBend(0.10);
        body.reach(null);   // 構えでは手を出さない（胸の前に出すと小包を抱えて見える）
        // 障害物に押し戻されて着けないこともある。2.5 秒で切り上げる
        if (adjustToSpot(dt) || timer > 2.5) { timer = 0; state = 'ready'; }
        break;
      }

      case 'ready': {
        const faceYaw = Math.atan2(player.x - body.position.x, player.z - body.position.z);
        body.turnTowards(faceYaw, dt);
        body.setCrouch(0.10);
        body.setBend(0.10);
        body.reach(null);   // 構えでは手を出さない（胸の前に出すと小包を抱えて見える）

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
        if (flight !== 'girl' && cheerFor <= 0 && spotFor && Math.hypot(player.x - spotFor.x, player.z - spotFor.z) > 1.6) goToSpot();
        if (flight !== 'girl' && cheerFor <= 0 && needsSpot()) goToSpot();
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
        const reachIn = clamp(1 - (dist - 0.4) / 2.4, 0, 1);
        const handsAt = readyPoint(ready);
        // 手を寄せるのは、球が体の前にあるときだけ。横や後ろへ抜けていく球へ
        // 手を伸ばすと、腕が体の後ろへねじれる
        const ahead = (ball.position.x - body.position.x) * Math.sin(body.yaw)
          + (ball.position.z - body.position.z) * Math.cos(body.yaw);
        if (ballFree() && ahead > 0) handsAt.lerp(ball.position, reachIn * 0.85);
        // 手を出すのは球が近づいてから。遠いうちは腕を下ろしたまま走る
        if (reachIn > 0.02) body.reach(handsAt, reachIn, 0.075 + (1 - reachIn) * 0.05);
        else body.reach(null);
        body.setHandOpen(reachIn * 0.9);   // 受ける手は開く
        body.setCrouch(0.14);
        body.setBend(0.12);

        if (ballFree() && segmentDistance3D(lastBall, ball.position, body.catchPoint) < CATCH_RADIUS) {
          if (random() < catchChance()) {
            takeBall();
            stats.caught++;
            body.smile(1.0, 0.5);
            if (flight === 'player') {
              bumpRally();
              if (!sayRally()) voice?.say('herCatch', { chance: 0.5 });
            }
            flight = null;
            timer = 0;
            state = 'hold';
          } else {
            fumble();
            voice?.say('fumble');
            state = 'chase';
          }
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
        // 柵の向こうへ転がった球も、球のある側で寄れる所を探す（道順は柵の切れ目を通る）。
        // 自分のいる側へ押し戻すと、柵の向こうの球にいつまでも届かずあきらめていた
        const edge = settle(new THREE.Vector2(ball.position.x, ball.position.z), ball.position.z);
        const gapToBall = Math.hypot(edge.x - ball.position.x, edge.y - ball.position.z);
        if (gapToBall > 0.5 && speed < 0.3 && ball.position.y < 0.2) {
          giveUp += dt;
          body.stand(dt);
          if (giveUp > 2.5) {
            voice?.say('unreachable');
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
        let approach = false;
        if (d > stopAt + 0.02) {
          target2.set(body.position.x + dx * (1 - stopAt / d), body.position.z + dz * (1 - stopAt / d));
          settle(target2, ball.position.z);
          // 障害物の縁へ押し出されて、もうこれ以上は近づけないなら着いたことにする
          approach = Math.hypot(target2.x - body.position.x, target2.y - body.position.z) > 0.05;
        }
        if (approach) {
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
        // 向き直るまでは手を出さない（後ろの球へ手を伸ばすと腕が背中側へ回る）
        const aheadPick = (ball.position.x - body.position.x) * Math.sin(body.yaw)
          + (ball.position.z - body.position.z) * Math.cos(body.yaw);
        if (aheadPick > 0.05) body.reach(ball.position, Math.min(1, timer / 0.3), 0.07);
        else { body.reach(null); timer = Math.min(timer, 0.1); }
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
        // 捕ったら、持ったまま相手を向いて 2〜3 歩下がり、間合いを直してから投げる。
        // 投げるたびの踏み込みと、捕りに前へ出たぶんを、ここで取り返す
        if (timer < dt * 1.5 && needsSpot()) {
          spotRetry = 0;
          const next = chooseSpot();
          // 持ったまま寄るのは、まっすぐ寄れるときだけ
          if (next && gardenPath(new THREE.Vector2(body.position.x, body.position.z), next).length === 1) spot = next;
        }
        // 持ったまま寄れないとき（障害物に押し戻され続ける）は、2.5 秒でその場から投げる。
        // これが無いと、滑り台の脇で着いたことにならず、いつまでも投げ返さなかった
        const placed = adjustToSpot(dt) || timer > 2.5;
        const facing = placed && body.turnTowards(faceYaw, dt);
        // 捕った手をそのまま胸元へ引き寄せる。いきなり胸の前へ持っていくと、
        // 伸ばしていた腕が 1 フレームで縮んで見える
        holdLocal.lerp(toLocal(readyPoint(ready, 0.62), tmp), Math.min(1, dt * 5));
        body.reach(toWorldPoint(holdLocal, holdAt), 1, 0.07);
        // 胸の前で持って、相手のほうを向いてから投げる
        if (timer > 1.2 && placed && facing && playerOutside) {
          throwing = createThrow(body, player, { onRelease: release });
          state = 'throw';
        }
        break;
      }

      case 'throw': {
        body.setCrouch(0);
        body.setBend(0);
        throwing.update(dt);
        if (!throwing.released && data.heldBy !== 'character') {
          // 投げる前に奪われた
          throwing.cancel();
        }
        if (throwing.done) {
          throwing = null;
          timer = 0;
          state = 'ready';
          // 立ち位置は、相手が捕るのを見届けてから直す（ready で）。飛んでいる
          // うちに動くと、相手が捕った瞬間に横を向いて歩いていることがある
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
    if (state !== 'off' && state !== 'goIn' && body.position.z < MOVE_AREA.maxZ) {
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

  /**
   * プレイヤーの送球の手助け。女の子のほうへ投げたと分かる球だけ、向きを
   * 相手へ寄せる。strength 1 は PC 用で、届く初速まで解き直す（マウスでは
   * 強さを加減できないため）。VR は 0.5 で、向きと高さを半分寄せるだけにして、
   * 横の速さ（＝届くまでの時間）は腕の振りのまま残す。
   */
  function assistThrow(from, velocity, strength = 0.5) {
    if (state === 'off' || state === 'goIn' || !body.loaded) return velocity;
    const tx = body.position.x - from.x;
    const tz = body.position.z - from.z;
    const d = Math.hypot(tx, tz);
    const h = Math.hypot(velocity.x, velocity.z);
    if (d < 1 || h < 1) return velocity;
    const want = Math.atan2(tx, tz);
    const have = Math.atan2(velocity.x, velocity.z);
    const off = angleDelta(want, have);
    if (Math.abs(off) > (strength >= 1 ? 0.45 : 0.3)) return velocity;
    if (strength >= 1) {
      const t = clamp(0.4 + d * 0.085, 0.5, 1.0);
      const toY = body.headHeight * 0.72;
      velocity.set(tx / t, (toY - from.y - 0.5 * GRAVITY * t * t) / t, tz / t);
      return velocity;
    }
    const yaw = have + off * strength;
    velocity.x = Math.sin(yaw) * h;
    velocity.z = Math.cos(yaw) * h;
    // 高さも同じだけ寄せる。横の速さはそのまま（届く時間は腕の振りで決まる）で、
    // その時間に相手の胸の高さへ来る縦の速さへ半分近づける。VR の振りは
    // 上下の角度がばらつきやすく、膝下へ落ちたり頭上を越えたりしがち
    const t = d / h;
    if (t > 0.35 && t < 1.8) {
      const need = (body.headHeight * 0.72 - from.y - 0.5 * GRAVITY * t * t) / t;
      velocity.y += (need - velocity.y) * strength;
    }
    return velocity;
  }

  return {
    update,
    assistThrow,
    suspend,
    resume,
    get state() { return state; },
    get plan() { return plan; },
    stats,
    /** 検証用：乱数を差し替える */
    setRandom(fn) { random = fn; },
    /** 検証用 */
    predictFlight: (p, v) => predictFlight(p, v, data.drag ?? 0.02, data.halfSize),
  };
}

/**
 * ラリー回数の看板。女の子の頭の上に出て、数秒で消える。
 * VR でも読めるよう、DOM ではなくシーンの中のスプライトにする。
 */
function createRallyBoard() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 192;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(1.0, 0.375, 1);   // 6m 先でも読める大きさ（VR で視角 9 度ほど）
  sprite.visible = false;
  sprite.renderOrder = 3;
  let showFor = 0;

  function draw(rally, best, broke) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(20, 24, 32, 0.62)';
    const r = 40;
    ctx.beginPath();
    ctx.roundRect(8, 8, canvas.width - 16, canvas.height - 16, r);
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = broke ? '#ffd6a0' : '#ffffff';
    ctx.font = 'bold 84px sans-serif';
    ctx.fillText(broke ? 'おしい！' : `ラリー ${rally}`, canvas.width / 2, 78);
    ctx.fillStyle = '#b9d7ff';
    ctx.font = 'bold 44px sans-serif';
    ctx.fillText(`ベスト ${best}`, canvas.width / 2, 148);
    texture.needsUpdate = true;
  }

  return {
    sprite,
    show(rally, best, broke = false) {
      draw(rally, best, broke);
      showFor = 2.6;
      sprite.visible = true;
    },
    update(dt, body) {
      if (!sprite.visible) return;
      showFor -= dt;
      if (showFor <= 0) { sprite.visible = false; return; }
      material.opacity = Math.min(1, showFor / 0.5);
      sprite.position.set(body.position.x, body.headHeight + 0.5, body.position.z);
    },
  };
}
