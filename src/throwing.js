import * as THREE from 'three';

/**
 * 手続きで作る投球モーション（右投げの上手投げ）。モーションデータは使わない。
 *
 *   0.00  構え     胸の前で両手に持つ
 *   0.18  割る     両手を離し、右手を体の右横に沿って持ち上げ始める
 *   0.40  振りかぶり 体を少し閉じ（左肩を相手へ）、左膝を軽く上げ、重心を後ろへ
 *   0.55  トップ   右手は右耳の横、左手は相手を指す
 *   0.58  踏み込み  左足を 30cm 前へ着く
 *   0.68  リリース  腰 → 胸の順に開き、右手が頭の上を通って前へ
 *   0.85  フォロースルー 右手は左の腰の前へ振り下ろし、上体が前へ倒れる
 *   1.00  終わり
 *
 * そのあと 0.5 秒かけて右足を前へ寄せて立ち直り、ふだんの構えに戻る。
 *
 * すべて「投げる相手のほうを +Z、左手側を +X」とした体の座標で書く。
 * 腕は character.js の 2 関節 IK で手首の位置から解くので、ここでは
 * 手の通り道だけを決めればよい。
 *
 * 大人の投球ほど大きくは振らない。相手は 5m 先で、子どもが軽く投げる
 * 距離なので、踏み込みも捻りも小さめにしてある。
 */

/** 投球そのものの長さ（秒）。子どもの軽い投球 */
export const THROW_DURATION = 1.05;
/** 投げ終わってから構えに戻るまで（秒） */
const RECOVER_DURATION = 0.5;
/** 手を離すタイミング（0..1） */
const RELEASE_AT = 0.68;
/** 踏み込みの幅（m） */
const STRIDE = 0.30;

// --- キーフレーム ------------------------------------------------------------
// 手の位置は [左右 x, 高さ（頭の高さに対する割合）, 前後 z]。右手は -x 側。

// 右腕を体の後ろへ回さない。以前は下から後ろへ大きく振りかぶっていたが、
// 腕が体の後ろへ水平に突き出して見え、気持ちが悪かった（体を閉じる捻りで
// 肩ごと後ろへ下がるぶん、余計に後ろへ出る）。子どもの投げ方に多い、
// 胸の前から体の右横を通して耳の横まで持ち上げ、そこから前へ出す形にする。
// 手は体の前後の中心（z = 0）より後ろへは出さない。
// トップからリリースへは頭の右上を回す。まっすぐ結ぶと手が頭の中を通る
const RIGHT_HAND = [
  [0.00, [-0.07, 0.62, 0.26]],
  [0.18, [-0.15, 0.68, 0.20]],
  [0.40, [-0.24, 0.88, 0.08]],
  [0.55, [-0.23, 1.02, 0.01]],
  [0.62, [-0.23, 1.10, 0.08]],
  [0.68, [-0.18, 1.08, 0.30]],
  [0.78, [-0.02, 0.85, 0.36]],
  [0.88, [0.14, 0.56, 0.28]],
  [1.00, [0.12, 0.52, 0.22]],
];

const LEFT_HAND = [
  [0.00, [0.07, 0.62, 0.26]],
  [0.18, [0.10, 0.63, 0.22]],
  [0.40, [0.12, 0.82, 0.34]],
  [0.55, [0.10, 0.95, 0.40]],
  [0.68, [0.24, 0.70, 0.12]],
  [0.85, [0.22, 0.56, 0.02]],
  [1.00, [0.20, 0.52, 0.06]],
];

// 体幹。捻りは -（閉じる：左肩が相手へ）/ +（開く）。bend は + が前かがみ
// 閉じる捻りは控えめにする。深く閉じると右肩が後ろへ下がり、右腕も後ろへ出る
const HIPS_YAW = [[0, 0], [0.30, -0.08], [0.52, -0.25], [0.62, -0.15], [0.72, 0.30], [1, 0.30]];
const CHEST_YAW = [[0, 0], [0.30, -0.10], [0.55, -0.32], [0.64, -0.20], [0.74, 0.55], [1, 0.45]];
const BEND = [[0, 0], [0.45, -0.06], [0.60, 0.00], [0.72, 0.30], [0.86, 0.70], [1, 0.55]];
/** 腰の前後（+ が前）。振りかぶりで後ろへ、踏み込みで前へ */
const HIP_SHIFT = [[0, 0], [0.45, -0.05], [0.60, 0.04], [0.74, 0.12], [1, 0.15]];
/** 腰を落とす量（m）。脚を前後に開くと、そのぶん腰が下がる */
const HIP_DROP = [[0, 0.02], [0.42, 0.03], [0.62, 0.07], [0.80, 0.07], [1, 0.05]];
/** 左足（踏み込む足）。前後と持ち上げ */
const LEFT_FORWARD = [[0, 0], [0.38, 0], [0.58, STRIDE], [1, STRIDE]];
const LEFT_LIFT = [[0, 0], [0.30, 0], [0.44, 0.07], [0.52, 0.05], [0.58, 0], [1, 0]];
/** 右足（軸足）。投げ終わりに踵が浮く */
const RIGHT_FORWARD = [[0, 0], [0.80, 0], [1, 0.03]];
const RIGHT_LIFT = [[0, 0], [0.78, 0], [0.92, 0.04], [1, 0.03]];

const smooth = (x) => x * x * (3 - 2 * x);

/** スカラーのキーフレームを、区間ごとに smoothstep でつなぐ */
function scalar(keys, t) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1] = keys[i];
    if (t <= t1) {
      const [t0, v0] = keys[i - 1];
      return v0 + (v1 - v0) * smooth((t - t0) / (t1 - t0));
    }
  }
  return keys[keys.length - 1][1];
}

/**
 * 手の通り道。Catmull-Rom で点をなめらかにつなぐ。区間ごとに smoothstep で
 * つなぐと、キーごとに手が一瞬止まって、振りがカクカクして見える。
 * キーの時刻が不等間隔なので、接線は時間で割った差分から作る。
 */
function path(keys, t, out) {
  const n = keys.length;
  if (t <= keys[0][0]) return out.fromArray(keys[0][1]);
  if (t >= keys[n - 1][0]) return out.fromArray(keys[n - 1][1]);
  let i = 1;
  while (t > keys[i][0]) i++;
  const [t0, p0] = keys[i - 1];
  const [t1, p1] = keys[i];
  const h = t1 - t0;
  const u = (t - t0) / h;
  const tangent = (k) => {
    const a = keys[Math.max(0, k - 1)];
    const b = keys[Math.min(n - 1, k + 1)];
    return [0, 1, 2].map((c) => (b[1][c] - a[1][c]) / (b[0] - a[0] || 1));
  };
  const m0 = tangent(i - 1);
  const m1 = tangent(i);
  const u2 = u * u;
  const u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1;
  const h10 = u3 - 2 * u2 + u;
  const h01 = -2 * u3 + 3 * u2;
  const h11 = u3 - u2;
  return out.set(
    h00 * p0[0] + h10 * h * m0[0] + h01 * p1[0] + h11 * h * m1[0],
    h00 * p0[1] + h10 * h * m0[1] + h01 * p1[1] + h11 * h * m1[1],
    h00 * p0[2] + h10 * h * m0[2] + h01 * p1[2] + h11 * h * m1[2],
  );
}

/**
 * 1 回ぶんの投球。update(dt) を毎フレーム呼ぶと体を動かし、手を離す瞬間に
 * onRelease(palm) を呼ぶ。終わったら done が true になる。
 *
 * @param {object} body character.body
 * @param {THREE.Vector3} target 投げる相手の位置（向きを決めるのに使う）
 * @param {{ onRelease: (palm: THREE.Vector3) => void }} handlers
 */
export function createThrow(body, target, { onRelease }) {
  const origin = body.position.clone();
  const yaw = Math.atan2(target.x - origin.x, target.z - origin.z);
  const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  const left = new THREE.Vector3(forward.z, 0, -forward.x);
  const H = body.headHeight;

  const local = new THREE.Vector3();
  const rightTarget = new THREE.Vector3();
  const leftTarget = new THREE.Vector3();
  // 投げる腕の肘は外・少し下へ逃がす。後ろへ逃がすと肘が体の後ろへ突き出す
  const rightPole = new THREE.Vector3().addScaledVector(left, -1).add(new THREE.Vector3(0, -0.5, 0)).normalize();
  const leftPole = new THREE.Vector3().addScaledVector(left, 1).add(new THREE.Vector3(0, -0.6, 0)).normalize();

  let time = 0;
  let released = false;
  let done = false;
  const pose = {
    weight: 1, hipsYaw: 0, chestYaw: 0, bend: 0, hipShift: 0, hipDrop: 0,
    left: { forward: 0, lift: 0 }, right: { forward: 0, lift: 0 },
  };

  /** 体の座標 → ワールド。origin は投げ始めの足元（踏み出しても動かさない） */
  function toWorld(v, out) {
    return out.copy(origin)
      .addScaledVector(left, v.x)
      .addScaledVector(forward, v.z)
      .setY(v.y * H);
  }

  function sampleThrow(t) {
    pose.hipsYaw = scalar(HIPS_YAW, t);
    pose.chestYaw = scalar(CHEST_YAW, t);
    pose.bend = scalar(BEND, t);
    pose.hipShift = scalar(HIP_SHIFT, t);
    pose.hipDrop = scalar(HIP_DROP, t);
    pose.left.forward = scalar(LEFT_FORWARD, t);
    pose.left.lift = scalar(LEFT_LIFT, t);
    pose.right.forward = scalar(RIGHT_FORWARD, t);
    pose.right.lift = scalar(RIGHT_LIFT, t);
    toWorld(path(RIGHT_HAND, t, local), rightTarget);
    toWorld(path(LEFT_HAND, t, local), leftTarget);
  }

  /**
   * 立ち直り。右足を左足の横まで寄せ、腰もそこへ運ぶ。足が揃ったところで
   * 体ごと前へ移し、同じ量だけ足と腰の値を引く。見た目は変わらないまま、
   * 踏み出したぶんだけ立ち位置が前へ進む。
   */
  function sampleRecover(u) {
    const e = smooth(u);
    sampleThrow(1);
    const end = { ...pose, left: { ...pose.left }, right: { ...pose.right } };
    const joined = STRIDE - 0.02;
    pose.hipsYaw = end.hipsYaw * (1 - e);
    pose.chestYaw = end.chestYaw * (1 - e);
    pose.bend = end.bend * (1 - e);
    pose.hipShift = end.hipShift + (joined - end.hipShift) * e;
    pose.hipDrop = end.hipDrop + (0.02 - end.hipDrop) * e;
    pose.right.forward = end.right.forward + (joined - 0.02 - end.right.forward) * e;
    pose.right.lift = Math.sin(Math.PI * u) * 0.06 + end.right.lift * (1 - e);
    pose.left.forward = STRIDE;
    pose.left.lift = 0;
    // 手は胸の前の構えへ。体は踏み出したぶん前にいるので、そこから 24cm 前
    const readyL = local.set(0.10, 0.62, joined + 0.24);
    const endL = path(LEFT_HAND, 1, new THREE.Vector3());
    toWorld(endL.lerp(readyL, e), leftTarget);
    const readyR = new THREE.Vector3(-0.10, 0.62, joined + 0.24);
    const endR = path(RIGHT_HAND, 1, new THREE.Vector3());
    toWorld(endR.lerp(readyR, e), rightTarget);
  }

  function apply(amount) {
    body.setYaw(yaw);
    body.setThrowPose(pose);
    body.reachHands({
      left: { target: leftTarget, amount, pole: leftPole },
      right: { target: rightTarget, amount, pole: rightPole },
    });
  }

  return {
    get done() { return done; },
    get released() { return released; },
    /** 0..1 の進み。検証用 */
    get progress() { return Math.min(1, time / THROW_DURATION); },
    forward,
    update(dt) {
      if (done) return;
      time += dt;
      const t = time / THROW_DURATION;
      if (t <= 1) {
        sampleThrow(t);
        // 最初のキーは両手で持っていた位置と同じなので、効きは最初から 1
        apply(1);
        if (!released && t >= RELEASE_AT) {
          released = true;
          onRelease?.(body.palm('right'));
        }
        return;
      }
      const u = (time - THROW_DURATION) / RECOVER_DURATION;
      if (u < 1) {
        sampleRecover(u);
        apply(1);
        return;
      }
      // 足が揃った。体を前へ移し、足と腰の前後ずれを 0 に戻す
      sampleRecover(1);
      const moved = pose.hipShift;
      body.position.addScaledVector(forward, moved);
      body.setThrowPose(null);
      body.reachHands(null);
      done = true;
    },
    /** 途中でやめる（ボールを奪われた、プレイヤーが部屋に戻った） */
    cancel() {
      body.setThrowPose(null);
      body.reachHands(null);
      done = true;
    },
  };
}
