import * as THREE from 'three';
import { PARK } from './park.js';
import { ROOM } from './room.js';

/**
 * テニスの道具（ラケットとテニスボール）と、ラケット面で球を打つ判定。
 *
 * ラケットのローカル座標:
 *   +Y … グリップから先端へ（シャフトの向き）
 *   +Z … 面の法線（表裏どちらでも打てる）
 *   +X … 面の横幅の向き
 * 原点はグリップを握る位置。フェイス（打つ面）は楕円で、中心は RACKET.face。
 */
export const RACKET = {
  /** 全長はおよそ 70cm（グリップ端 -0.035 〜 先端 0.665） */
  butt: -0.035,
  handleTop: 0.175,
  face: { y: 0.50, a: 0.125, b: 0.165 },
  /** 面の厚み（フレームの半分）。球の半径にこれを足した距離で当たる */
  thickness: 0.012,
};

export const TENNIS_BALL_RADIUS = 0.033;

/**
 * ラケットで打ったときの反発。手に持ったラケットは打った瞬間に押し戻される
 * ので、弦そのものの反発（0.85 ほど）より小さい「見かけの反発係数」で考える。
 * 実測だとスイートスポットで 0.4〜0.45。面の端ほど下がる
 */
const RACKET_RESTITUTION = 0.45;
/** 面に沿った向きの速さのうち、弦との摩擦で失われる割合 */
const RACKET_GRIP_LOSS = 0.3;
/** 弦に食いついて回転がかかる度合い（1 で面の上を転がる状態） */
const RACKET_SPIN = 0.75;
/** 同じラケットで続けて当たったことにしない時間（秒） */
const HIT_COOLDOWN = 0.12;

/**
 * テニスボールの表面。蛍光の黄緑のフェルトに、白いゴムの継ぎ目が
 * 8 の字（野球ボールと同じ曲線）に 1 本走る。
 */
function createTennisBallTexture(size = 512) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size / 2;
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;

  ctx.fillStyle = '#cfe03a';
  ctx.fillRect(0, 0, W, H);
  // フェルトの毛羽。明るい点と暗い点を細かく散らす
  for (let i = 0; i < 9000; i++) {
    const light = Math.random() < 0.5;
    ctx.fillStyle = light ? `rgba(245,255,170,${Math.random() * 0.25})` : `rgba(90,110,10,${Math.random() * 0.18})`;
    ctx.fillRect(Math.random() * W, Math.random() * H, 1.5, 1.5);
  }

  const amp = H * 0.24;
  const seam = (x) => H / 2 + amp * Math.sin((x / W) * Math.PI * 2);
  ctx.strokeStyle = 'rgba(250, 250, 240, 0.95)';
  ctx.lineWidth = Math.max(3, size * 0.014);
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let x = 0; x <= W; x += 3) {
    const y = seam(x);
    if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/** 弦の格子。縦 16 本・横 19 本（実物に近い本数） */
function createStringTexture(size = 512) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  ctx.strokeStyle = 'rgba(240, 240, 232, 1)';
  ctx.lineWidth = size * 0.0065;
  const mains = 16;
  const crosses = 19;
  for (let i = 1; i <= mains; i++) {
    const x = (i / (mains + 1)) * size;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, size); ctx.stroke();
  }
  for (let i = 1; i <= crosses; i++) {
    const y = (i / (crosses + 1)) * size;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(size, y); ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/** グリップテープ。白地に斜めの巻き目 */
function createGripTexture(size = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f1f1ee';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = 'rgba(120, 120, 120, 0.55)';
  ctx.lineWidth = size * 0.02;
  for (let i = -8; i < 16; i++) {
    ctx.beginPath();
    ctx.moveTo(i * size / 8, 0);
    ctx.lineTo(i * size / 8 + size * 0.5, size);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1, 3);
  return texture;
}

/** 楕円のフレーム上の点（ローカル座標） */
function facePoint(angle, grow = 0) {
  const { y, a, b } = RACKET.face;
  return new THREE.Vector3(Math.sin(angle) * (a + grow), y - Math.cos(angle) * (b + grow), 0);
}

/** 2 点をつなぐ円柱 */
function rod(from, to, radius, material, segments = 10) {
  const length = from.distanceTo(to);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, segments), material);
  mesh.position.copy(from).add(to).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
  mesh.castShadow = true;
  return mesh;
}

/**
 * ラケット。フレーム・弦・グリップをひとつのグループにまとめる。
 * つかむ判定は子のメッシュに当たるので、userData はグループに持たせる。
 */
export function createRacket({ color = 0x1f5fb0, name = 'racket' } = {}) {
  const group = new THREE.Group();
  group.name = name;

  const frameMaterial = new THREE.MeshPhysicalMaterial({
    color, roughness: 0.32, metalness: 0.25, clearcoat: 0.8, clearcoatRoughness: 0.2,
  });
  const accentMaterial = new THREE.MeshPhysicalMaterial({ color: 0xf4f4f0, roughness: 0.4, clearcoat: 0.5 });
  const gripMaterial = new THREE.MeshStandardMaterial({ map: createGripTexture(), roughness: 0.85 });
  const capMaterial = new THREE.MeshStandardMaterial({ color: 0x23252a, roughness: 0.6 });

  // フレーム（楕円の輪）
  const ring = [];
  for (let i = 0; i <= 64; i++) ring.push(facePoint((i / 64) * Math.PI * 2, 0.006));
  const frameCurve = new THREE.CatmullRomCurve3(ring, true);
  const frame = new THREE.Mesh(new THREE.TubeGeometry(frameCurve, 128, 0.0095, 8, true), frameMaterial);
  frame.castShadow = true;
  group.add(frame);
  // フレームの上側に白い差し色
  const topArc = [];
  for (let i = 0; i <= 24; i++) topArc.push(facePoint(Math.PI * 0.72 + (i / 24) * Math.PI * 0.56, 0.006).setZ(0.0));
  const accent = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(topArc), 48, 0.0098, 8, false),
    accentMaterial,
  );
  group.add(accent);

  // スロート（シャフトから二股に分かれてフレームの下へ）
  const shaftTop = new THREE.Vector3(0, 0.235, 0);
  group.add(rod(new THREE.Vector3(0, RACKET.handleTop - 0.01, 0), shaftTop, 0.011, frameMaterial));
  for (const side of [-1, 1]) {
    group.add(rod(shaftTop, facePoint(side * 0.62, 0.006), 0.009, frameMaterial));
  }

  // 弦。楕円の形に切った板に、格子のテクスチャを透かして貼る
  const { y: cy, a, b } = RACKET.face;
  const shape = new THREE.Shape();
  shape.absellipse(0, 0, a, b, 0, Math.PI * 2, false, 0);
  const stringGeometry = new THREE.ShapeGeometry(shape, 48);
  // UV を楕円の外接矩形で 0〜1 に
  const uv = stringGeometry.attributes.uv;
  const pos = stringGeometry.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / (2 * a) + 0.5, pos.getY(i) / (2 * b) + 0.5);
  stringGeometry.translate(0, cy, 0);
  const strings = new THREE.Mesh(stringGeometry, new THREE.MeshStandardMaterial({
    map: createStringTexture(),
    transparent: true,
    alphaTest: 0.35,
    side: THREE.DoubleSide,
    roughness: 0.6,
  }));
  strings.castShadow = true;
  group.add(strings);

  // グリップ（八角形）と、グリップエンドのキャップ
  const handleLength = RACKET.handleTop - RACKET.butt;
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.0145, 0.0135, handleLength, 8), gripMaterial);
  handle.position.y = (RACKET.handleTop + RACKET.butt) / 2;
  handle.castShadow = true;
  group.add(handle);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.0165, 0.0165, 0.012, 8), capMaterial);
  cap.position.y = RACKET.butt;
  group.add(cap);

  group.userData = {
    grabbable: true,
    racket: true,
    label: 'ラケット',
    home: new THREE.Vector3(),
    homeQuaternion: new THREE.Quaternion(),
    // 床や机に置いたときの厚み（半分）。簡易物理はこれを球の半径として扱う
    halfSize: 0.0145,
    laysFlat: true,
    velocity: new THREE.Vector3(),
    spin: new THREE.Vector3(),
    held: false,
    heldBy: null,
    hoverMaterial: frameMaterial,
    baseColor: new THREE.Color(color),
    baseEmissive: new THREE.Color(0x000000),
  };
  return group;
}

/**
 * VR のコントローラーで握ったときのラケットの置き方（コントローラーのローカル）。
 * シャフトはレーザーの向き（-Z）から 15° 上へ、面はコントローラーの左右（±X）を向く。
 * 握手するように持つと手のひらと面がそろう（イースタングリップ）。
 */
export const VR_GRIP = (() => {
  const tilt = THREE.MathUtils.degToRad(15);
  const shaft = new THREE.Vector3(0, Math.sin(tilt), -Math.cos(tilt));
  const normal = new THREE.Vector3(1, 0, 0);
  const side = new THREE.Vector3().crossVectors(shaft, normal);
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(side, shaft, normal));
  // 手の中心がグリップの 6cm 上に来るように
  const position = shaft.clone().multiplyScalar(-0.06);
  return { position, quaternion };
})();

/** テニスボール */
export function createTennisBall() {
  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(TENNIS_BALL_RADIUS, 32, 24),
    new THREE.MeshPhysicalMaterial({
      map: createTennisBallTexture(),
      roughness: 0.95,
      metalness: 0,
      sheen: 1,
      sheenColor: new THREE.Color(0xeaf59a),
      sheenRoughness: 0.7,
    }),
  );
  ball.name = 'tennisBall';
  ball.castShadow = true;
  ball.receiveShadow = true;
  ball.userData = {
    grabbable: true,
    tennis: true,
    label: 'テニスボール',
    home: new THREE.Vector3(),
    halfSize: TENNIS_BALL_RADIUS,
    // 58g・直径 6.6cm・Cd 0.55 で c = 0.5ρCdA/m ≈ 0.02。フェルトで毛羽立って
    // いるぶん野球ボール（0.006）より 3 倍ほど空気抵抗が効く
    drag: 0.021,
    // マグヌス効果（回転で曲がる）。加速度 = magnus * (ω × v)。
    // 0.5ρAr/m ≈ 0.0012（揚力係数がスピン比にほぼ比例する範囲）
    magnus: 0.0012,
    // ハードコートに 2.54m から落として 1.35〜1.47m 弾む（規格）。空気抵抗で
    // 落ちる速さが減るぶん、反発は 0.77 にしてちょうど 1.37m ほどになる
    restitution: 0.77,
    // 弾んだときに、回転と地面との摩擦で向きと速さが変わる
    spinBounce: true,
    bounceFriction: 0.6,
    // 空中での回転の減り（1/s）。フェルトの球でも 1 秒で 1 割ほど
    spinDecay: 0.1,
    rolls: true,
    rollFriction: 0.8,
    velocity: new THREE.Vector3(),
    spin: new THREE.Vector3(),
    held: false,
    heldBy: null,
    baseColor: new THREE.Color(0xcfe03a),
    baseEmissive: new THREE.Color(0x000000),
  };
  return ball;
}

/**
 * ラケット面で球を打つ判定。毎フレーム、球の物理を進めたあとに呼ぶ。
 *
 * 振ったラケットの面は 1 フレームで 10cm 以上動くので、点どうしの距離では
 * すり抜ける。前のフレームのラケットの姿勢から見た球の位置と、今のフレームの
 * 姿勢から見た球の位置を比べ、面の厚みの板をまたいだかで判定する
 * （ラケットに乗って見た、球の相対的な通り道で見る）。大きく動いたフレームは
 * 何回かに分けて調べる。
 *
 * @param {{ rackets: THREE.Object3D[], balls: THREE.Object3D[], onHit?: Function }} options
 */
export function createRacketPhysics({ rackets, balls, onHit }) {
  const state = new Map();
  for (const racket of rackets) {
    state.set(racket, {
      prev: new THREE.Matrix4(),
      hasPrev: false,
      cooldown: 0,
    });
  }
  const lastBall = new Map(balls.map((ball) => [ball, ball.position.clone()]));

  const local0 = new THREE.Vector3();
  const local1 = new THREE.Vector3();
  const contact = new THREE.Vector3();
  const contactNow = new THREE.Vector3();
  const contactPrev = new THREE.Vector3();
  const racketVelocity = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const relative = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const spinAxis = new THREE.Vector3();

  // 1 フレームのあいだのラケットを、何回かに分けて動かして調べる（サブステップ）。
  // フレームが落ちて 1 フレームに 30° も回ると、前と今の姿勢だけで見た球の通り道は
  // 実際の通り道から大きくずれて、面を素通りしてしまう
  const p0 = new THREE.Vector3();
  const p1 = new THREE.Vector3();
  const q0 = new THREE.Quaternion();
  const q1 = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const stepPosition = new THREE.Vector3();
  const stepQuaternion = new THREE.Quaternion();
  const matrixA = new THREE.Matrix4();
  const matrixB = new THREE.Matrix4();
  const inverseA = new THREE.Matrix4();
  const inverseB = new THREE.Matrix4();
  const ballA = new THREE.Vector3();
  const ballB = new THREE.Vector3();
  const faceCenter = new THREE.Vector3(0, RACKET.face.y, 0);
  const center0 = new THREE.Vector3();
  const center1 = new THREE.Vector3();
  /** サブステップ 1 回で面の中心が動いてよい距離（m）と、回ってよい角度（rad） */
  const STEP_DISTANCE = 0.04;
  const STEP_ANGLE = 0.1;
  const MAX_STEPS = 12;

  function interpolate(k, out) {
    stepPosition.lerpVectors(p0, p1, k);
    stepQuaternion.slerpQuaternions(q0, q1, k);
    return out.compose(stepPosition, stepQuaternion, scale.set(1, 1, 1));
  }

  function update(dt) {
    for (const racket of rackets) {
      const s = state.get(racket);
      s.cooldown = Math.max(0, s.cooldown - dt);
      racket.updateWorldMatrix(true, false);
      if (!racket.userData.held || dt <= 0) {
        s.hasPrev = false;
        continue;
      }
      if (s.hasPrev && s.cooldown === 0) {
        s.prev.decompose(p0, q0, scale);
        racket.matrixWorld.decompose(p1, q1, scale);
        center0.copy(faceCenter).applyMatrix4(s.prev);
        center1.copy(faceCenter).applyMatrix4(racket.matrixWorld);
        const angle = q0.angleTo(q1);
        const steps = Math.min(MAX_STEPS, Math.max(1,
          Math.ceil(center0.distanceTo(center1) / STEP_DISTANCE), Math.ceil(angle / STEP_ANGLE)));
        search: for (let i = 1; i <= steps; i++) {
          interpolate((i - 1) / steps, matrixA);
          interpolate(i / steps, matrixB);
          inverseA.copy(matrixA).invert();
          inverseB.copy(matrixB).invert();
          for (const ball of balls) {
            if (ball.userData.held) continue;
            ballA.lerpVectors(lastBall.get(ball), ball.position, (i - 1) / steps);
            ballB.lerpVectors(lastBall.get(ball), ball.position, i / steps);
            if (hitTest(racket, s, ball, dt / steps)) break search;
          }
        }
      }
      s.prev.copy(racket.matrixWorld);
      s.hasPrev = true;
    }
    for (const ball of balls) lastBall.get(ball).copy(ball.position);
  }

  /** サブステップ 1 回ぶん（matrixA → matrixB、球は ballA → ballB）で当たったか */
  function hitTest(racket, s, ball, dt) {
    const data = ball.userData;
    const r = data.halfSize;
    const limit = r + RACKET.thickness;
    const { y: cy, a, b } = RACKET.face;

    // 球の通り道を、前と今のラケットから見た座標に直す
    local0.copy(ballA).applyMatrix4(inverseA);
    local1.copy(ballB).applyMatrix4(inverseB);
    local0.y -= cy;
    local1.y -= cy;
    // 面から遠いものは見ない（速い球でも 1 フレームでここまでは動かない）
    if (Math.min(Math.abs(local0.z), Math.abs(local1.z)) > 0.6) return false;

    const side = local0.z >= 0 ? 1 : -1;
    const z0 = side * local0.z;
    const z1 = side * local1.z;
    if (z1 >= limit) return false;           // 板まで来ていない
    // 板に入った瞬間（はじめから板の中なら前のサブステップの位置）
    const t = z0 > limit ? (z0 - limit) / (z0 - z1) : 0;
    contact.lerpVectors(local0, local1, t);
    // 楕円の内側か（球の半径の半分だけ甘くする。フレームに当たった球も返す）
    const ex = contact.x / (a + r * 0.5);
    const ey = contact.y / (b + r * 0.5);
    const radial = ex * ex + ey * ey;
    if (radial > 1) return false;

    // 当たった点のラケットの速度（振りの回転も入る）
    contact.set(contact.x, contact.y + cy, side * limit);
    contactNow.copy(contact).applyMatrix4(matrixB);
    contactPrev.copy(contact).applyMatrix4(matrixA);
    racketVelocity.subVectors(contactNow, contactPrev).divideScalar(dt);
    normal.setFromMatrixColumn(matrixB, 2).normalize().multiplyScalar(side);

    relative.subVectors(data.velocity, racketVelocity);
    const approach = relative.dot(normal);
    if (approach >= 0) return false;        // 離れていく向き（すでに打ち返した）

    // 面に垂直な成分は反発で返し、面に沿った成分は弦の摩擦で減らす。
    // 面の端で打つほど反発が落ちる（スイートスポットを外した感じ）
    const e = RACKET_RESTITUTION * (1 - 0.45 * radial);
    tangent.copy(relative).addScaledVector(normal, -approach).multiplyScalar(1 - RACKET_GRIP_LOSS);
    relative.copy(tangent).addScaledVector(normal, -e * approach);
    data.velocity.copy(racketVelocity).add(relative);
    // 弦の上を転がるように回転がかかる：ω = n × v_t / r（こすり上げればトップスピン）
    spinAxis.crossVectors(normal, tangent).multiplyScalar(RACKET_SPIN / r);
    data.spin.copy(spinAxis);
    // 今のフレームのラケットの面の外へ出しておく（次のフレームにまた板の中から
    // 始まらないように）。当たった点は、フレームの終わりのラケットに置き直す
    contactNow.copy(contact).applyMatrix4(racket.matrixWorld);
    normal.setFromMatrixColumn(racket.matrixWorld, 2).normalize().multiplyScalar(side);
    ball.position.copy(contactNow).addScaledVector(normal, r * 0.1);
    lastBall.get(ball).copy(ball.position);
    s.cooldown = HIT_COOLDOWN;
    onHit?.({
      racket,
      ball,
      speed: data.velocity.length(),
      racketSpeed: racketVelocity.length(),
      by: racket.userData.heldBy,
      position: ball.position,
    });
    return true;
  }

  return { update };
}

// ---------------------------------------------------------------------------
// テニスボールの物理（world.js の簡易物理と、女の子の先読みで共用する）
// ---------------------------------------------------------------------------

const GRAVITY = -9.8;
/** 回転をもつ球が弾んだときの、回転の慣性モーメント（m r^2 の何倍か）。中空のテニスボールで 0.55 ほど */
const BALL_INERTIA = 0.55;

/** テニスコートのネット。中央 0.80m、ポスト 0.86m で、そのあいだはたるむ */
export const NET = {
  z: PARK.court.z,
  halfSpan: PARK.court.width / 2 + 0.3,
  height(x) {
    const u = Math.min(1, Math.abs(x - PARK.court.x) / (PARK.court.width / 2 + 0.3));
    return PARK.court.net + (PARK.court.netPost - PARK.court.net) * u * u;
  },
};

/** 球がネットに掛かったか（前の z から今の位置へ動くあいだに、白帯より下で網をまたいだ） */
export function hitsNet(prevZ, position, radius) {
  if (Math.abs(position.x - PARK.court.x) > NET.halfSpan) return false;
  const before = prevZ - NET.z;
  const after = position.z - NET.z;
  const crossed = (before > radius && after < radius) || (before < -radius && after > -radius);
  return crossed && position.y - radius * 0.3 <= NET.height(position.x);
}

/** コート（外まわりまで）の中か */
export function onCourt(x, z) {
  const c = PARK.court;
  return Math.abs(x - c.x) < c.width / 2 + c.runoffSide && Math.abs(z - c.z) < c.length / 2 + c.runoffEnd;
}

/** 床の場所ごとの弾みやすさ（テニスボール）。芝は弾まず、室内の床は少し弾まない */
export function surfaceBounce(x, z) {
  if (onCourt(x, z)) return 1;
  if (z > ROOM.minZ) return 0.9;
  return 0.72;
}

/**
 * マグヌス効果の加速度を out に足す。回転の軸と進む向きの両方に直角な向きへ
 * 曲がる（トップスピンは落ち、スライスは浮く）。揚力係数には上限があるので、
 * 空気抵抗の 0.65 倍で頭打ちにする
 */
const magnusTmp = new THREE.Vector3();
export function addMagnus(velocity, spin, data, dt) {
  const speed = velocity.length();
  if (!data.magnus || speed <= 0.5) return;
  magnusTmp.crossVectors(spin, velocity).multiplyScalar(data.magnus);
  const cap = 0.65 * (data.drag ?? 0.02) * speed * speed;
  if (magnusTmp.length() > cap) magnusTmp.setLength(cap);
  velocity.addScaledVector(magnusTmp, dt);
}

/**
 * 回転している球が弾む。接地点の滑りを摩擦で打ち消し、そのぶん速さと回転を
 * やりとりする（トップスピンは前へ伸び、バックスピンは止まる）。
 * velocity.y は弾む前（負）の値で呼ぶ。
 */
export function spinBounce(velocity, spin, data, e) {
  const r = data.halfSize;
  const vyIn = velocity.y;
  // 接地点の速さ：v + ω × (0, -r, 0)
  const ux = velocity.x + r * spin.z;
  const uz = velocity.z - r * spin.x;
  const slip = Math.hypot(ux, uz);
  velocity.y = -vyIn * e;
  if (slip < 1e-5) return;
  // 滑りが止まる（転がりになる）のに要る力積。摩擦の上限を超えたら滑ったまま
  let jx = -ux / (1 + 1 / BALL_INERTIA);
  let jz = -uz / (1 + 1 / BALL_INERTIA);
  const limit = (data.bounceFriction ?? 0.5) * (1 + e) * Math.abs(vyIn);
  const j = Math.hypot(jx, jz);
  if (j > limit) { jx *= limit / j; jz *= limit / j; }
  velocity.x += jx;
  velocity.z += jz;
  // 力積が回転を変える：Δω = (r_c × J) / (k r^2)、r_c = (0, -r, 0)
  spin.x += -jz / (BALL_INERTIA * r);
  spin.z += jx / (BALL_INERTIA * r);
}

/**
 * テニスボールの飛び方を先読みする。world.js の物理と同じ式（空気抵抗・マグヌス・
 * 回転のバウンド・床ごとの弾み・ネット）を、止まるかネットに掛かるまで進める。
 * 返すのは 1/60 秒ごとの { t, p, v, bounces }。壁や柵は見ない。
 */
export function predictTennis(position, velocity, spin, data, { step = 1 / 60, maxTime = 3.0 } = {}) {
  const p = position.clone();
  const v = velocity.clone();
  const w = spin.clone();
  const r = data.halfSize;
  const drag = data.drag ?? 0.02;
  const samples = [];
  let bounces = 0;
  let net = false;
  for (let t = step; t <= maxTime; t += step) {
    const speed = v.length();
    if (speed > 0.01) v.multiplyScalar(1 - Math.min(0.9, drag * speed * step));
    addMagnus(v, w, data, step);
    v.y += GRAVITY * step;
    const prevZ = p.z;
    p.addScaledVector(v, step);
    if (hitsNet(prevZ, p, r)) { net = true; samples.push({ t, p: p.clone(), v: v.clone(), bounces, net }); break; }
    if (p.y <= r && v.y < 0) {
      p.y = r;
      const e = (data.restitution ?? 0.7) * surfaceBounce(p.x, p.z);
      if (-v.y * e < 0.32) break;
      spinBounce(v, w, data, e);
      bounces++;
    }
    w.multiplyScalar(Math.max(0, 1 - step * (data.spinDecay ?? 0.8)));
    samples.push({ t, p: p.clone(), v: v.clone(), bounces, net });
  }
  return samples;
}

/**
 * from から打って、target（地面の点）に落ちる初速を解く。flight は落ちるまでの
 * 時間の目安（秒）。トップスピン（rad/s）をかけ、ネットの白帯を clearance だけ
 * 越えるように、足りなければ山なりにする。
 * 空気抵抗とマグヌスがあるので、先読みで落ちた点のずれを見て 5 回まで直す。
 * @returns {{ velocity: THREE.Vector3, spin: THREE.Vector3, landing: THREE.Vector3 }}
 */
export function solveShot(from, target, data, { flight = 1.2, topspin = 40, clearance = 0.25 } = {}) {
  const dir = new THREE.Vector3(target.x - from.x, 0, target.z - from.z);
  const distance = dir.length() || 1;
  dir.divideScalar(distance);
  const spin = new THREE.Vector3(0, 1, 0).cross(dir).multiplyScalar(topspin);
  const aim = new THREE.Vector3(target.x, 0, target.z);
  const velocity = new THREE.Vector3();
  let landing = null;
  let t = flight;
  for (let pass = 0; pass < 8; pass++) {
    velocity.set((aim.x - from.x) / t, (data.halfSize - from.y - 0.5 * GRAVITY * t * t) / t, (aim.z - from.z) / t);
    const samples = predictTennis(from, velocity, spin, data, { maxTime: t + 1.5 });
    // ネットを越えるところの高さ
    let netOk = true;
    let prevZ = from.z;
    landing = null;
    for (const s of samples) {
      if (s.net) { netOk = false; break; }
      const crossed = (prevZ - NET.z) * (s.p.z - NET.z) <= 0;
      if (crossed && Math.abs(s.p.x - PARK.court.x) < NET.halfSpan && s.p.y < NET.height(s.p.x) + clearance) netOk = false;
      prevZ = s.p.z;
      if (s.bounces > 0) { landing = s.p.clone(); break; }
    }
    if (!netOk) { t *= 1.12; continue; }       // 山なりにして越えさせる
    if (!landing) break;
    // 落ちた点のずれぶん、狙う点を先へ動かす
    const ex = target.x - landing.x;
    const ez = target.z - landing.z;
    if (Math.hypot(ex, ez) < 0.08) break;
    aim.x += ex;
    aim.z += ez;
  }
  return { velocity, spin, landing: landing ?? aim.clone() };
}
