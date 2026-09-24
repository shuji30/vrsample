import * as THREE from 'three';

/**
 * シーソー。庭の左の芝生（ポケバイのコースの手前）に置く。プレイヤーは片方の席に乗り、
 * もう片方に女の子が座る（seesawgame.js）。
 *
 * カートやポケバイと同じ乗り物の窓口（group / body / state / steering / place / update /
 * eye / side / speed）にして、kartdrive.js の乗り降り・VR の目線合わせ・視点をそのまま使う。
 *   乗る：席に向けてトリガー（VR）、近くで E（PC）　降りる：左グリップ 0.5 秒、E
 *   ける：自分の側が下にあるとき、アクセル（W / ↑、RT、VR の右トリガー）
 *
 * 動き：板の角度 angle（プレイヤーの側が上がると +）。けると勢い（角速度）が付き、
 * 少しずつ弱まりながら反対の端まで行って、地面に着く（ゴトン）。女の子は、自分の側が
 * 下りると少し待ってからけり返す（kickFromGirl）。
 *
 * 高さ：支点 0.62m、支点から席まで 1.2m、端は地面の 0.12m 上まで下がる。女の子はソファと
 * 同じふつうの座り方で座るので、いちばん下で足がちょうど地面に届く高さにしてある
 * （もっと低いと足が地面にめり込み、高いと足が浮いたままになる）。
 */
export const SEESAW = {
  pivotHeight: 0.62,
  halfLength: 1.3,
  seatAt: 1.2,
  seatTop: 0.14,       // 板の上面から席の上面まで
  endClearance: 0.12,  // いちばん下がったときの、端の下面の地面からの高さ
  kick: 1.35,          // けったときの角速度（rad/s）
  damping: 0.8,
};
const MAX_ANGLE = Math.asin((SEESAW.pivotHeight - SEESAW.endClearance - 0.05) / SEESAW.halfLength);

export function createSeesaw({ x = -9.6, z = -9.4, yaw = Math.PI / 2, color = 0xe8573a } = {}) {
  const group = new THREE.Group();
  group.name = 'seesaw';
  group.position.set(x, 0, z);
  // ローカルの +X が板の向き。+X の端がプレイヤー、-X の端が女の子
  group.rotation.y = yaw - Math.PI / 2;

  const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.2 });
  const seatPaint = new THREE.MeshStandardMaterial({ color: 0x2f6fd8, roughness: 0.6 });
  const metal = new THREE.MeshStandardMaterial({ color: 0xc8ccd2, roughness: 0.35, metalness: 0.8 });
  const add = (mesh, parent) => { mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh; };

  // 支点の台
  for (const side of [-1, 1]) {
    const leg = add(new THREE.Mesh(new THREE.BoxGeometry(0.08, SEESAW.pivotHeight + 0.1, 0.08), metal), group);
    leg.position.set(0, (SEESAW.pivotHeight + 0.1) / 2 - 0.05, side * 0.2);
    leg.rotation.x = side * 0.18;
  }
  const axle = add(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.48, 12), metal), group);
  axle.rotation.x = Math.PI / 2;
  axle.position.y = SEESAW.pivotHeight;

  // 板（支点で回る）
  const beam = new THREE.Group();
  beam.position.y = SEESAW.pivotHeight;
  group.add(beam);
  const plank = add(new THREE.Mesh(new THREE.BoxGeometry(SEESAW.halfLength * 2, 0.07, 0.22), paint), beam);
  plank.position.y = 0.045;
  // 席と取っ手（両端）。body（乗るときにつかめる所）はプレイヤーの側の席
  const body = new THREE.Group();
  beam.add(body);
  const handles = [];
  for (const end of [1, -1]) {
    const seat = add(new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.07, 0.3), seatPaint), end > 0 ? body : beam);
    seat.position.set(end * SEESAW.seatAt, 0.08 + 0.035, 0);
    const handle = new THREE.Group();
    handle.position.set(end * (SEESAW.seatAt - 0.34), 0.08, 0);
    (end > 0 ? body : beam).add(handle);
    const post = add(new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.36, 8), metal), handle);
    post.position.y = 0.18;
    const bar = add(new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.34, 8), metal), handle);
    bar.rotation.x = Math.PI / 2;
    bar.position.y = 0.36;
    handles.push(handle);
    // 端の下のゴム（地面に着くところ）
    const bumper = add(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.05, 12), new THREE.MeshStandardMaterial({ color: 0x1a1b1d, roughness: 0.9 })), beam);
    bumper.position.set(end * (SEESAW.halfLength - 0.1), -0.035, 0);
  }

  const state = {
    angle: -MAX_ANGLE,   // はじめはプレイヤーの側が下
    omega: 0,
    // 乗り物の窓口（kartdrive.js が読む）
    speed: 0, yaw: yaw + Math.PI, travelYaw: yaw + Math.PI, steer: 0, onGrass: false, lateral: 0, u: 0,
    landed: 0,           // 端が地面に着いた（+1 プレイヤーの側、-1 女の子の側）。着いたフレームだけ
    girlDownFor: 0,
  };
  let kickHeld = false;
  let girlSeated = false;

  function pose() {
    beam.rotation.z = state.angle;
    beam.updateMatrixWorld(true);
  }
  pose();

  const tmp = new THREE.Vector3();
  return {
    group,
    body,
    state,
    steering: handles[0],
    kind: 'seesaw',
    silent: true,
    /** 地面に固定。place は何もしない（乗り物の窓口をそろえるため） */
    place() {},
    update(dt, { throttle = 0 } = {}) {
      state.landed = 0;
      const atPlayerDown = state.angle <= -MAX_ANGLE + 1e-3;
      const atGirlDown = state.angle >= MAX_ANGLE - 1e-3;
      // プレイヤーがける（アクセルを踏んだ瞬間）
      const kick = throttle > 0.5;
      if (kick && !kickHeld && atPlayerDown) state.omega = SEESAW.kick;
      kickHeld = kick;
      // 女の子がける：自分の側が下りて 0.35 秒たったら
      state.girlDownFor = atGirlDown ? state.girlDownFor + dt : 0;
      if (girlSeated && state.girlDownFor > 0.35) state.omega = -SEESAW.kick;
      // 女の子が乗っていないときは、重いプレイヤーの側へゆっくり下がる
      const bias = girlSeated ? 0 : -1.2;
      state.omega += (bias - SEESAW.damping * state.omega) * dt;
      state.angle += state.omega * dt;
      if (state.angle > MAX_ANGLE) { state.angle = MAX_ANGLE; if (state.omega > 0.05) state.landed = -1; state.omega = 0; }
      if (state.angle < -MAX_ANGLE) { state.angle = -MAX_ANGLE; if (state.omega < -0.05) state.landed = 1; state.omega = 0; }
      state.speed = state.omega;
      pose();
    },
    /** プレイヤーの目の位置（席の上に座った高さ）。向きは支点のほう */
    eye(out = new THREE.Vector3()) {
      return beam.localToWorld(out.set(SEESAW.seatAt + 0.02, 0.08 + SEESAW.seatTop + 0.72, 0));
    },
    /** 乗り降りする所（プレイヤーの席の横） */
    side(out = new THREE.Vector3()) {
      group.updateMatrixWorld(true);
      return group.localToWorld(out.set(SEESAW.seatAt + 0.1, 0, 0.75));
    },
    /** 女の子の席の上面（ワールド）と、座ったときに向く向き（yaw） */
    girlSeat(out = new THREE.Vector3()) {
      return beam.localToWorld(out.set(-SEESAW.seatAt, 0.08 + 0.07, 0));
    },
    girlYaw() { return yaw; },
    /** 女の子の取っ手の握る所（左右） */
    girlHandle(side, out = new THREE.Vector3()) {
      handles[1].updateMatrixWorld(true);
      return handles[1].localToWorld(out.set(0, 0.36, side * 0.12));
    },
    /** 女の子の乗り降りする所 */
    girlSide(out = new THREE.Vector3()) {
      group.updateMatrixWorld(true);
      return group.localToWorld(out.set(-SEESAW.seatAt - 0.1, 0, -0.75));
    },
    set girlSeated(v) { girlSeated = Boolean(v); },
    get girlSeated() { return girlSeated; },
    get maxAngle() { return MAX_ANGLE; },
    get speed() { return state.omega; },
  };
}
