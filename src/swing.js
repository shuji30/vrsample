import * as THREE from 'three';
import { RACKET, predictTennis } from './tennis.js';

/**
 * PC でラケットを振る。VR なら手の動きがそのまま振りになるが、マウスと
 * キーボードでは無理なので、カメラに対する構え・振りかぶり・インパクト・
 * フォロースルーの姿勢を決めておき、そのあいだを補間して動かす。
 *
 * 打つ判定は VR と同じ（tennis.js の createRacketPhysics）。ラケットが実際に
 * 動いた速さで球が飛ぶので、ここでは「どこを、どれくらいの速さで通るか」を
 * 姿勢で決めているだけ。
 *
 * スペースを押したままにすると、振りかぶって待つ。飛んできた球が届く所へ来る
 * なら、その時刻に合わせて自動で振り出し、インパクトの位置も球の通り道へ寄せる
 * （マウスとキーボードでは、面を球の高さや左右へ合わせる手段が無いため）。
 * 離せばその場で振る。
 *
 * 姿勢は、カメラから見たグリップの位置 g、シャフトの向き s、面の法線 n で書く
 * （x 右・y 上・-z 前）。インパクトでは面の中心が目の 24cm 下、60cm 前に来て、
 * 面はまっすぐ前（少し上）を向く。
 */
const POSES = {
  // 構えは右寄り。トスした球（面の中心の真上）に振りかぶりで当てないように
  ready: { g: [0.30, -0.40, -0.40], s: [0.05, 0.9, -0.3], n: [-0.2, 0.3, -1] },
  // 振りかぶりでは面を体の横・低めに引き、下から上へ振り抜く（ネットを越える球筋）。
  // インパクトの面は 27° 上を向く（シャフトはその面に沿わせる）
  back: { g: [0.30, -0.55, -0.30], s: [-0.19, -0.30, 0.42], n: [1, 0.1, 0.3] },
  impact: { g: [0.40, -0.44, -0.66], s: [-1, 0.45, 0.225], n: [0, 0.5, -1] },
  follow: { g: [0.08, -0.15, -0.62], s: [-0.43, 0.2, -0.33], n: [-0.6, 0.2, -0.8] },
};

/** 振りかぶるまで（秒） */
const BACK_TIME = 0.2;
/** 振り出してからの各姿勢の時刻（秒）：振りかぶり → インパクト → フォロー → 構え */
const FORWARD_TIMES = [0, 0.15, 0.30, 0.62];
/**
 * インパクトでの速さは、振りかぶりからインパクトまでの平均の何倍か。1.5 以上で
 * インパクトまでずっと加速し続ける（エルミート補間の性質）。前後の点から接線を
 * 決めると、インパクトが振りの中ほどに来ないかぎり、そこで減速してしまう
 */
const IMPACT_SPEEDUP = 1.5;
/** トスしてから打つまで。トスと同時に振りかぶり、この時刻に面の中心へ落ちてくる */
const TOSS_HIT_TIME = 0.42;
const TOSS_UP = 1.2;

/** 姿勢を 3 つの点（グリップ・面の中心・法線の先）にする。補間はこの点どうしで行う */
function posePoints({ g, s, n }) {
  const grip = new THREE.Vector3(...g);
  const shaft = new THREE.Vector3(...s).normalize();
  const normal = new THREE.Vector3(...n);
  normal.addScaledVector(shaft, -normal.dot(shaft)).normalize();
  return [grip, grip.clone().addScaledVector(shaft, RACKET.face.y), grip.clone().addScaledVector(normal, 0.2)];
}

const KEYS = Object.fromEntries(Object.entries(POSES).map(([name, pose]) => [name, posePoints(pose)]));
/** 振り出しの点列。先頭は振り出した瞬間の姿勢、インパクトは球へ寄せた姿勢に毎回書き換えるので、別に持つ */
const FORWARD = [KEYS.back.map((p) => p.clone()), KEYS.impact.map((p) => p.clone()), KEYS.follow.map((p) => p.clone()), KEYS.ready];
/** インパクトを球へ寄せてよい量（カメラの座標、m）。左右・上下・前後 */
const REACH = { x: [-0.55, 0.45], y: [-0.75, 0.25], z: [-0.35, 0.3] };

/**
 * 時刻つきの点列を、速さが途切れないようにつなぐ（エルミート補間）。
 * 両端は止まった状態から始まり、止まった状態で終わる。途中の接線は前後の点の
 * 差を時間で割ったもの。姿勢ごとに滑らかに止めてしまうと、インパクトで
 * ラケットの速さが 0 になって球が飛ばない。
 */
function hermite(points, times, t, out) {
  const last = times.length - 1;
  if (t <= times[0]) return out.copy(points[0]);
  if (t >= times[last]) return out.copy(points[last]);
  let i = 0;
  while (t > times[i + 1]) i++;
  const t0 = times[i];
  const t1 = times[i + 1];
  const h = t1 - t0;
  const u = (t - t0) / h;
  const tangent = (k) => {
    if (k === 0 || k === last) return new THREE.Vector3();
    // インパクト（1 番目）は、振りかぶりからの向きのまま加速して通り抜ける
    if (k === 1) return points[1].clone().sub(points[0]).multiplyScalar(IMPACT_SPEEDUP / (times[1] - times[0]));
    return points[k + 1].clone().sub(points[k - 1]).divideScalar(times[k + 1] - times[k - 1]);
  };
  const m0 = tangent(i).multiplyScalar(h);
  const m1 = tangent(i + 1).multiplyScalar(h);
  const u2 = u * u;
  const u3 = u2 * u;
  out.copy(points[i]).multiplyScalar(2 * u3 - 3 * u2 + 1)
    .addScaledVector(m0, u3 - 2 * u2 + u)
    .addScaledVector(points[i + 1], -2 * u3 + 3 * u2)
    .addScaledVector(m1, u3 - u2);
  return out;
}

/**
 * @param {THREE.Camera} camera
 * @param {THREE.Object3D} racket
 * @param {{ ball?: THREE.Object3D }} [options] 自動で振るときに見るテニスボール
 */
export function createDesktopSwing(camera, racket, { ball = null } = {}) {
  const ballLocal = new THREE.Vector3();
  const offset = new THREE.Vector3();
  let spaceHeld = false;

  /**
   * いま振り出したら、インパクト（FORWARD_TIMES[1] 秒後）に球はカメラから見て
   * どこにいるか。届く範囲に入るなら、面の中心からのずれを返す（入らなければ null）
   */
  function reachOffset(out) {
    if (!ball || ball.userData.held) return null;
    const d = ball.userData;
    // こちらへ向かってくる球だけ
    camera.updateWorldMatrix(true, false);
    const eye = camera.getWorldPosition(new THREE.Vector3());
    const toEye = eye.sub(ball.position);
    if (toEye.dot(d.velocity) <= 0 || toEye.length() > 12) return null;
    const lead = FORWARD_TIMES[1];
    const samples = predictTennis(ball.position, d.velocity, d.spin, d, { maxTime: lead + 0.02 });
    const at = samples.find((sample) => sample.t >= lead - 1e-3);
    if (!at) return null;
    ballLocal.copy(at.p);
    camera.worldToLocal(ballLocal);
    out.subVectors(ballLocal, KEYS.impact[1]);
    const inside = out.x >= REACH.x[0] && out.x <= REACH.x[1] && out.y >= REACH.y[0] && out.y <= REACH.y[1]
      && out.z >= REACH.z[0] && out.z <= REACH.z[1];
    return inside ? out : null;
  }

  /** 振り出す。ずれ（offset）はインパクトに全部、フォローに半分かける */
  function startForward(shift = null) {
    FORWARD[0].forEach((p, i) => p.copy(current[i]));
    FORWARD[1].forEach((p, i) => p.copy(KEYS.impact[i]).add(shift ?? offset.set(0, 0, 0)));
    FORWARD[2].forEach((p, i) => p.copy(KEYS.follow[i]).addScaledVector(shift ?? offset, 0.5));
    phase = 'forward';
    time = 0;
  }

  let holding = false;
  let phase = 'ready';   // ready | back | forward
  let time = 0;
  /** 振りかぶりを始めたときの姿勢（途中からでも滑らかに振りかぶる） */
  const from = KEYS.ready.map((p) => p.clone());
  const current = KEYS.ready.map((p) => p.clone());
  /** トスして自動で打つときの、振り出す時刻（振りかぶってからの秒） */
  let autoForwardAt = null;

  const axisX = new THREE.Vector3();
  const axisY = new THREE.Vector3();
  const axisZ = new THREE.Vector3();
  const basis = new THREE.Matrix4();

  function apply() {
    const [grip, head, normalTip] = current;
    axisY.subVectors(head, grip).normalize();
    axisZ.subVectors(normalTip, grip);
    axisZ.addScaledVector(axisY, -axisZ.dot(axisY)).normalize();
    axisX.crossVectors(axisY, axisZ);
    racket.position.copy(grip);
    racket.quaternion.setFromRotationMatrix(basis.makeBasis(axisX, axisY, axisZ));
  }

  function setPose(points) {
    current.forEach((p, i) => p.copy(points[i]));
  }

  return {
    get holding() { return holding; },
    get phase() { return phase; },

    take() {
      holding = true;
      racket.userData.held = true;
      racket.userData.heldBy = 'desktop';
      racket.userData.velocity.set(0, 0, 0);
      racket.userData.spin.set(0, 0, 0);
      camera.add(racket);
      phase = 'ready';
      setPose(KEYS.ready);
      apply();
    },

    /** 足もとの少し前に落とす */
    drop() {
      if (!holding) return;
      holding = false;
      spaceHeld = false;
      phase = 'ready';
      autoForwardAt = null;
      // シーン直下へ戻す（attach はワールドでの位置と向きを保つ）
      let root = camera;
      while (root.parent) root = root.parent;
      root.attach(racket);
      racket.userData.held = false;
      racket.userData.heldBy = null;
      racket.userData.velocity.set(0, -0.5, 0);
    },

    backswing() {
      spaceHeld = true;
      if (!holding || phase !== 'ready') return;
      from.forEach((p, i) => p.copy(current[i]));
      phase = 'back';
      time = 0;
    },

    forward() {
      spaceHeld = false;
      if (!holding || phase !== 'back' || autoForwardAt !== null) return;
      // 振りかぶりきる前に離しても、そこから振り出す。球が届く所へ来るなら寄せる
      startForward(reachOffset(offset));
    },

    /** テニスボールを目の前にトスして、落ちてくるところを打つ */
    tossAndHit(ball) {
      if (!holding || phase !== 'ready') return;
      camera.updateWorldMatrix(true, false);
      const center = camera.localToWorld(KEYS.impact[1].clone());
      const drop = TOSS_UP * TOSS_HIT_TIME - 0.5 * 9.8 * TOSS_HIT_TIME * TOSS_HIT_TIME;
      ball.position.copy(center).add(new THREE.Vector3(0, -drop, 0));
      ball.userData.velocity.set(0, TOSS_UP, 0);
      ball.userData.spin.set(0, 0, 0);
      this.backswing();
      autoForwardAt = TOSS_HIT_TIME - FORWARD_TIMES[1];
    },

    update(dt) {
      if (!holding) return;
      // 押したままなら、振り終わって構えに戻ったところで、また振りかぶって待つ
      if (phase === 'ready' && spaceHeld && autoForwardAt === null) this.backswing();
      time += dt;
      if (phase === 'back') {
        const k = Math.min(1, time / BACK_TIME);
        const e = k * k * (3 - 2 * k);
        current.forEach((p, i) => p.lerpVectors(from[i], KEYS.back[i], e));
        if (autoForwardAt !== null && time >= autoForwardAt) {
          // 振り出しの時刻を過ぎたぶんは、振りのほうへ持ち越す。フレームの区切りまで
          // 待って 0 から始めると、フレームが落ちたときにトスした球より遅れて空振りする
          time -= autoForwardAt;
          autoForwardAt = null;
          FORWARD[0].forEach((p, i) => p.copy(KEYS.back[i]));
          FORWARD[1].forEach((p, i) => p.copy(KEYS.impact[i]));
          FORWARD[2].forEach((p, i) => p.copy(KEYS.follow[i]));
          phase = 'forward';
        } else if (autoForwardAt === null && spaceHeld && k >= 1 && reachOffset(offset)) {
          // 押したまま待っていて、球が届く所へ来る：いま振り出す
          startForward(offset);
        }
      }
      if (phase === 'forward') {
        current.forEach((p, i) => hermite(FORWARD.map((key) => key[i]), FORWARD_TIMES, time, p));
        if (time >= FORWARD_TIMES[FORWARD_TIMES.length - 1]) {
          phase = 'ready';
          FORWARD[0].forEach((p, i) => p.copy(KEYS.back[i]));
        }
      }
      apply();
    },
  };
}
