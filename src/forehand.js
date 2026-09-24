import * as THREE from 'three';
import { RACKET } from './tennis.js';

/**
 * 女の子のフォアハンドとバックハンド（右利き）。モーションデータは使わず、手続きで作る。
 *
 *   構え        ラケットは体の前、左手はスロートに添える
 *   テイクバック  胸と腰を右へ閉じ、ラケットを右後ろの高い所へ引く。左手は球を指す
 *   ドロップ     ラケットの先を打点より下へ落とす（下から上へ振るため）
 *   インパクト    体の右前（右へ 72cm・前へ 32cm）、打点の高さで、面は打つ向きを向く
 *   フォロー     ラケットを左肩の上へ振り抜き、胸と腰は打つ向きへ開ききる
 *   戻り        構えへ戻る
 *
 * ラケットはどこに持つかをここで決め（グリップの位置・シャフトの向き・面の向き）、
 * 右手はそのグリップへ IK で伸ばす。手の骨にラケットを付けると、面の向きが腕の
 * 解け方しだいになって狙えない。打った球がどう飛ぶかは tennis.js の当たり判定が
 * ラケットの実際の動きから決めるので、ここは「いつ・どこを・どの向きで」通すかだけ。
 *
 * 体の座標は throwing.js と同じ：打つ向きが +Z、左手側が +X、高さは m（床から）。
 *
 * バックハンドは、フォアハンドを左右に映したもの（両手打ち）。体の左前で打ち、
 * 左手もグリップの上に添える。子どもは片手のバックハンドでは力が足りないので、
 * 両手で打つことが多い。
 */

/** 構え（打点によらない） */
const READY = { g: [-0.12, 0.80, 0.30], s: [0.35, 0.72, 0.28], n: [0, 0.25, 1] };

/** 打点の高さ hy に合わせたキー。y は hy からの差 */
const KEYS = {
  back: { g: [-0.40, 0.10, -0.12], s: [-0.15, 0.55, -0.80], n: [-1, 0, 0.1] },
  drop: { g: [-0.42, -0.12, -0.02], s: [-0.35, -0.30, -0.85], n: [-0.6, 0.1, 0.8] },
  impact: { c: [-0.72, 0, 0.32], s: [-0.92, 0.22, 0.10], n: [0, 0.12, 1] },
  follow: { g: [0.12, 0.35, 0.32], s: [0.55, 0.55, -0.55], n: [0.9, 0.1, 0.3] },
};
/**
 * インパクトで面の中心が来る場所（体の座標、y は打点の高さ）。先読みで立つ位置を決めるのに使う。
 * side は 1 がフォアハンド（右）、-1 がバックハンド（左）
 */
export const CONTACT = { x: KEYS.impact.c[0], z: KEYS.impact.c[2] };
export const contactFor = (side) => ({ x: CONTACT.x * side, z: CONTACT.z });

/** テイクバックの長さ（秒）。時間が足りなければ速く引く */
const TAKEBACK = 0.35;
/** 振り出しからの各キーの時刻：テイクバック → ドロップ → インパクト → フォロー → 構え */
const FORWARD_TIMES = [0, 0.18, 0.30, 0.50, 0.95];
export const IMPACT_AFTER_FORWARD = FORWARD_TIMES[2];
/** 振り出しから打つまでと、テイクバックを合わせた、打つまでにいる時間 */
export const SWING_LEAD = TAKEBACK + FORWARD_TIMES[2];
const IMPACT_SPEEDUP = 1.5;

// 体幹と脚。捻りは -（閉じる：右肩が後ろ）/ +（開く）
const BODY = {
  ready: { hipsYaw: 0, chestYaw: 0, bend: 0.12, hipDrop: 0.05, hipShift: 0, left: 0, right: 0 },
  back: { hipsYaw: -0.35, chestYaw: -0.75, bend: 0.10, hipDrop: 0.07, hipShift: -0.03, left: 0.10, right: -0.04 },
  impact: { hipsYaw: 0.10, chestYaw: 0.20, bend: 0.18, hipDrop: 0.08, hipShift: 0.05, left: 0.14, right: -0.04 },
  follow: { hipsYaw: 0.35, chestYaw: 0.70, bend: 0.12, hipDrop: 0.06, hipShift: 0.06, left: 0.14, right: 0.0 },
};

const smooth = (x) => x * x * (3 - 2 * x);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/**
 * 姿勢を 3 つの点（グリップ・面の中心・法線の先）にする。補間はこの点どうしで行う。
 * side = -1 で左右に映す（バックハンド）
 */
function points(key, hy, side = 1) {
  const m = (v) => [v[0] * side, v[1], v[2]];
  const s = m(key.s);
  // 低い球は、手を下げるのではなくラケットの先を下げて届かせる（手は膝より下へは
  // 届かない。届かない所へ手を伸ばすと、ラケットが手のほうへ寄って球の上を空振りした）
  if (key.c) s[1] += clamp((hy - 0.8) * 1.1, -0.6, 0.2);
  const shaft = new THREE.Vector3(...s).normalize();
  const normal = new THREE.Vector3(...m(key.n));
  normal.addScaledVector(shaft, -normal.dot(shaft)).normalize();
  let grip;
  if (key.c) {
    const c = m(key.c);
    const center = new THREE.Vector3(c[0], c[1] + hy, c[2]);
    grip = center.clone().addScaledVector(shaft, -RACKET.face.y);
  } else {
    const g = m(key.g);
    grip = new THREE.Vector3(g[0], Math.max(0.48, g[1] + hy), g[2]);
  }
  return [grip, grip.clone().addScaledVector(shaft, RACKET.face.y), grip.clone().addScaledVector(normal, 0.2)];
}

/** 時刻つきの点列を、速さが途切れないようにつなぐ（swing.js と同じ考え方） */
function hermite(pts, times, t, out) {
  const last = times.length - 1;
  if (t <= times[0]) return out.copy(pts[0]);
  if (t >= times[last]) return out.copy(pts[last]);
  let i = 0;
  while (t > times[i + 1]) i++;
  const h = times[i + 1] - times[i];
  const u = (t - times[i]) / h;
  const tangent = (k) => {
    if (k === 0 || k === last) return new THREE.Vector3();
    if (k === 2) return pts[2].clone().sub(pts[1]).multiplyScalar(IMPACT_SPEEDUP / (times[2] - times[1]));
    return pts[k + 1].clone().sub(pts[k - 1]).divideScalar(times[k + 1] - times[k - 1]);
  };
  const m0 = tangent(i).multiplyScalar(h);
  const m1 = tangent(i + 1).multiplyScalar(h);
  const u2 = u * u;
  const u3 = u2 * u;
  return out.copy(pts[i]).multiplyScalar(2 * u3 - 3 * u2 + 1)
    .addScaledVector(m0, u3 - 2 * u2 + u)
    .addScaledVector(pts[i + 1], -2 * u3 + 3 * u2)
    .addScaledVector(m1, u3 - u2);
}

function lerpBody(a, b, k, out, side = 1) {
  for (const name of ['bend', 'hipDrop', 'hipShift']) out[name] = a[name] + (b[name] - a[name]) * k;
  // バックハンドは捻りが逆、踏み出す足も逆
  out.hipsYaw = (a.hipsYaw + (b.hipsYaw - a.hipsYaw) * k) * side;
  out.chestYaw = (a.chestYaw + (b.chestYaw - a.chestYaw) * k) * side;
  const front = a.left + (b.left - a.left) * k;
  const back = a.right + (b.right - a.right) * k;
  out.left.forward = side > 0 ? front : back;
  out.right.forward = side > 0 ? back : front;
  return out;
}

/**
 * ラケットを持つ手と、ラケットの置き方を決める道具。構えでも振りでも使う。
 * 毎フレーム、体の座標の 3 点（グリップ・面の中心・法線の先）を渡すと、
 * ラケットの位置と向きを決め、右手をグリップへ、左手を leftTarget へ伸ばす。
 */
export function createRacketHands(body, racket) {
  const left = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const origin = new THREE.Vector3();
  const grip = new THREE.Vector3();
  const head = new THREE.Vector3();
  const tip = new THREE.Vector3();
  const axisX = new THREE.Vector3();
  const axisY = new THREE.Vector3();
  const axisZ = new THREE.Vector3();
  const basis = new THREE.Matrix4();
  const rightTarget = new THREE.Vector3();
  const leftHand = new THREE.Vector3();
  const rightPole = new THREE.Vector3();
  const leftPole = new THREE.Vector3();
  const palm = new THREE.Vector3();
  const gripWorld = new THREE.Vector3();

  const toWorld = (v, out) => out.copy(origin).addScaledVector(left, v.x).addScaledVector(forward, v.z).setY(v.y);

  return {
    /** 体の座標 → ワールド（いまの足元と、与えた向きで） */
    toWorld,
    frame(yaw) {
      origin.set(body.position.x, 0, body.position.z);
      forward.set(Math.sin(yaw), 0, Math.cos(yaw));
      left.set(forward.z, 0, -forward.x);
    },
    /**
     * @param {THREE.Vector3[]} pts 体の座標の [グリップ, 面の中心, 法線の先]
     * @param {THREE.Vector3 | null} leftLocal 左手の行き先（体の座標）。null ならスロートに添える
     */
    apply(pts, leftLocal = null, amount = 1, twoHanded = false) {
      toWorld(pts[0], grip);
      toWorld(pts[1], head);
      toWorld(pts[2], tip);
      axisY.subVectors(head, grip).normalize();
      axisZ.subVectors(tip, grip);
      axisZ.addScaledVector(axisY, -axisZ.dot(axisY)).normalize();
      axisX.crossVectors(axisY, axisZ);
      racket.position.copy(grip);
      racket.quaternion.setFromRotationMatrix(basis.makeBasis(axisX, axisY, axisZ));
      racket.updateMatrixWorld(true);
      rightTarget.copy(grip);
      if (twoHanded) leftHand.copy(grip).addScaledVector(axisY, 0.09);   // 両手打ち：右手の上を握る
      else if (leftLocal) toWorld(leftLocal, leftHand);
      else leftHand.copy(grip).addScaledVector(axisY, 0.24);   // スロート
      // 肘は外・下へ逃がす
      rightPole.copy(left).multiplyScalar(-1).add(new THREE.Vector3(0, -0.8, 0)).normalize();
      leftPole.copy(left).add(new THREE.Vector3(0, -0.8, 0)).normalize();
      body.reachHands({
        left: { target: leftHand, amount, pole: leftPole },
        right: { target: rightTarget, amount, pole: rightPole },
      });
    },
    /**
     * IK を解いたあとに呼ぶ。手が届かずにグリップから離れたら、ラケットを手のほうへ
     * 寄せる（ラケットが宙に浮いて見えないように。当たり判定もこの位置で行う）
     */
    snapToPalm() {
      body.palm('right', palm);
      gripWorld.copy(racket.position);
      racket.position.add(palm.sub(gripWorld));
      racket.updateMatrixWorld(true);
    },
    /** 手を離して腕を下ろす（reachHands(null) だけだと、両手を前へ出した構えに戻る） */
    release() {
      body.reachHands(null);
      body.reach(null);
    },
  };
}

/** 構えの 3 点（体の座標） */
export function readyPoints() {
  return points(READY, 0);
}

/**
 * 1 回ぶんのフォアハンド。impactIn 秒後に面の中心が打点を通るように振る。
 * update(dt) を毎フレーム呼ぶ。setOffset で打点のずれ（体の座標）を直せる。
 *
 * @param {object} body character.body
 * @param {ReturnType<typeof createRacketHands>} hands
 * @param {{ yaw: number, hitHeight: number, impactIn: number, side?: number }} options
 *   side: 1 = フォアハンド、-1 = バックハンド（両手打ち）
 */
export function createForehand(body, hands, { yaw, hitHeight, impactIn, side = 1 }) {
  const hy = clamp(hitHeight, 0.3, 1.35);
  const ready = points(READY, 0);
  const twoHanded = side < 0;
  const keys = {
    back: points(KEYS.back, hy, side),
    drop: points(KEYS.drop, hy, side),
    impact: points(KEYS.impact, hy, side),
    follow: points(KEYS.follow, hy, side),
  };
  // 振り出しの時刻。テイクバックに使える時間が短ければ、速く引く
  const forwardAt = Math.max(0.12, impactIn - IMPACT_AFTER_FORWARD);
  const takeback = Math.min(TAKEBACK, forwardAt);
  const offset = new THREE.Vector3();
  const current = ready.map((p) => p.clone());
  const shifted = [0, 1, 2, 3, 4].map(() => [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]);
  const leftLocal = new THREE.Vector3();
  const pose = {
    weight: 1, hipsYaw: 0, chestYaw: 0, bend: 0, hipShift: 0, hipDrop: 0,
    left: { forward: 0, lift: 0 }, right: { forward: 0, lift: 0 },
  };
  // 低い球は膝を曲げて腰を落とす
  const low = clamp((0.85 - hy) * 0.5, 0, 0.22);

  let time = 0;
  let done = false;
  let impactPassed = false;

  function forwardPoints() {
    const seq = [keys.back, keys.drop, keys.impact, keys.follow, ready];
    // 打点のずれは、テイクバックからインパクトまでは全部、フォローで半分、構えで 0
    const weights = [1, 1, 1, 0.5, 0];
    seq.forEach((key, k) => key.forEach((p, i) => shifted[k][i].copy(p).addScaledVector(offset, weights[k])));
    return shifted;
  }

  function sampleBody(tau) {
    if (tau < forwardAt) {
      const k = smooth(clamp(tau / takeback, 0, 1));
      lerpBody(BODY.ready, BODY.back, k, pose, side);
    } else {
      const f = tau - forwardAt;
      const T = FORWARD_TIMES;
      if (f < T[2]) lerpBody(BODY.back, BODY.impact, smooth(f / T[2]), pose, side);
      else if (f < T[3]) lerpBody(BODY.impact, BODY.follow, smooth((f - T[2]) / (T[3] - T[2])), pose, side);
      else lerpBody(BODY.follow, BODY.ready, smooth(clamp((f - T[3]) / (T[4] - T[3]), 0, 1)), pose, side);
    }
    pose.hipDrop += low;
    pose.bend += low * 0.8;
  }

  return {
    get done() { return done; },
    /** インパクトまでの残り時間（過ぎたら負） */
    get untilImpact() { return forwardAt + IMPACT_AFTER_FORWARD - time; },
    get impactPassed() { return impactPassed; },
    /** 打点のずれ（体の座標、m）。テイクバックからインパクトまでのキーを動かす */
    setOffset(v) { offset.copy(v); },
    /** インパクトで面の中心が来る点（体の座標） */
    impactCenter(out) { return out.copy(keys.impact[1]).add(offset); },
    update(dt) {
      if (done) return;
      time += dt;
      hands.frame(yaw);
      body.setYaw(yaw);
      if (time < forwardAt) {
        // テイクバック：構えから引いた位置へ。左手は打点の少し手前を指す
        const k = smooth(clamp(time / takeback, 0, 1));
        current.forEach((p, i) => p.lerpVectors(ready[i], keys.back[i], k).addScaledVector(offset, k));
        leftLocal.set(0.25, hy + 0.25, 0.45);
        hands.apply(current, k > 0.3 && !twoHanded ? leftLocal : null, 1, twoHanded && k > 0.2);
      } else {
        const f = time - forwardAt;
        const seq = forwardPoints();
        current.forEach((p, i) => hermite(seq.map((key) => key[i]), FORWARD_TIMES, f, p));
        // 左手は胸へ引きつける
        leftLocal.set(0.18, 1.0, 0.22);
        hands.apply(current, f < FORWARD_TIMES[3] && !twoHanded ? leftLocal : null, 1, twoHanded && f < FORWARD_TIMES[3]);
        if (f >= FORWARD_TIMES[2]) impactPassed = true;
        if (f >= FORWARD_TIMES[4]) {
          done = true;
          body.setThrowPose(null);
          return;
        }
      }
      sampleBody(time);
      body.setThrowPose(pose);
    },
    cancel() {
      done = true;
      body.setThrowPose(null);
    },
  };
}
