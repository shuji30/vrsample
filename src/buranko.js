import * as THREE from 'three';

/**
 * 二人乗りのブランコ（席が 2 つ並んだブランコ台）。庭の左の芝生（シーソーの左）に置く。
 * ローカル +X の席にプレイヤー、-X の席に女の子（burankogame.js）。乗った人から見ると、
 * 女の子は右隣（カートと同じく、前を向いたときローカル +X が左）。
 *
 * プレイヤーの席は、カートやポケバイと同じ乗り物の窓口（kartdrive.js の乗り降り・VR の目線
 * 合わせ・視点をそのまま使う）。
 *   こぐ：アクセル（W / ↑、RT、VR の右トリガー）を押しているあいだ、揺れの向きに合わせて勢いを足す
 *   止める：ブレーキ（S / ↓、LT、VR の左トリガー）
 *
 * 動き：ふりこ。φ'' = -(g/L) sin φ - 減衰 φ' + こぐ力。揺れは 55° まで（それより上ではこいでも
 * 増えない）。女の子の席も同じふりこで、女の子がこぐ力は burankogame.js が決める（揺れの大きさと
 * 向きをプレイヤーに合わせる）。
 *
 * VR では、目の位置が席といっしょに弧を描いて動く。頭は傾けない（リグは向きしか回せず、
 * 傾けないほうが酔いにくい）。
 */
export const BURANKO = {
  pivotHeight: 2.35,
  rope: 1.9,
  seatGap: 0.95,       // 2 つの席の間
  damping: 0.09,
  pump: 1.0,           // こぐ力（rad/s²）
  maxAngle: 0.96,      // 55°
  brake: 1.6,
};
const OMEGA2 = 9.8 / BURANKO.rope;

function createPendulum() {
  return {
    angle: 0,
    omega: 0,
    /** 揺れの大きさ（位置と速さから見積もる） */
    get amplitude() { return Math.sqrt(this.angle ** 2 + (this.omega ** 2) / OMEGA2); },
    step(dt, pump, brake, extra = 0) {
      let a = -OMEGA2 * Math.sin(this.angle) - (BURANKO.damping + BURANKO.brake * brake) * this.omega + extra;
      // こぐ：揺れの向きに合わせて足す（揺れが大きすぎるときは足さない）
      if (Math.abs(this.angle) < BURANKO.maxAngle && this.amplitude < BURANKO.maxAngle) {
        a += BURANKO.pump * pump * (this.omega >= 0 ? 1 : -1);
      }
      this.omega += a * dt;
      this.angle += this.omega * dt;
    },
  };
}

export function createBuranko({ x = -13.2, z = -9.0, yaw = 0 } = {}) {
  const group = new THREE.Group();
  group.name = 'buranko';
  group.position.set(x, 0, z);
  group.rotation.y = yaw;   // ローカルの +Z が前（こいで前へ出る向き）。+X がプレイヤーの席の側

  const frameMat = new THREE.MeshStandardMaterial({ color: 0x3a8f5c, roughness: 0.5, metalness: 0.3 });
  const metal = new THREE.MeshStandardMaterial({ color: 0xc8ccd2, roughness: 0.35, metalness: 0.8 });
  const seatMat = new THREE.MeshStandardMaterial({ color: 0xf2c14e, roughness: 0.6 });
  const add = (mesh, parent) => { mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh; };

  // 台：A 字の脚を左右に、上に横棒
  const halfW = BURANKO.seatGap + 0.55;
  for (const side of [-1, 1]) {
    for (const lean of [-1, 1]) {
      const leg = add(new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 2.5, 10), frameMat), group);
      leg.position.set(side * halfW, BURANKO.pivotHeight / 2, lean * 0.42);
      leg.rotation.x = -lean * 0.36;
    }
  }
  const top = add(new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, halfW * 2 + 0.2, 12), frameMat), group);
  top.rotation.z = Math.PI / 2;
  top.position.y = BURANKO.pivotHeight;

  // 席（ふりこ）。0 が女の子（-X）、1 がプレイヤー（+X）
  const seats = [];
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(side * BURANKO.seatGap / 2, BURANKO.pivotHeight, 0);
    group.add(pivot);
    const board = add(new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.04, 0.2), seatMat), pivot);
    board.position.y = -BURANKO.rope;
    for (const s of [-1, 1]) {
      const chain = add(new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, BURANKO.rope, 6), metal), pivot);
      chain.position.set(s * 0.21, -BURANKO.rope / 2, 0);
    }
    seats.push({ pivot, board, pendulum: createPendulum() });
  }
  const [girlSeat, playerSeat] = seats;
  const body = playerSeat.pivot;   // 乗るときにつかめる所（プレイヤーの席と鎖）

  const state = {
    speed: 0, yaw, travelYaw: yaw, steer: 0, onGrass: false, lateral: 0, u: 0,
    get angle() { return playerSeat.pendulum.angle; },
  };
  let girlPump = 0;
  let girlBrake = 0;
  let girlSeated = false;

  function pose() {
    for (const s of seats) s.pivot.rotation.x = s.pendulum.angle;
    group.updateMatrixWorld(true);
  }
  pose();

  /** 席の上面（ワールド） */
  const seatTop = (seat, out) => seat.pivot.localToWorld(out.set(0, -BURANKO.rope + 0.02, 0));

  return {
    group,
    body,
    state,
    steering: playerSeat.pivot,
    kind: 'buranko',
    silent: true,
    place() {},
    update(dt, { throttle = 0, brake = 0 } = {}) {
      playerSeat.pendulum.step(dt, throttle, brake);
      state.speed = playerSeat.pendulum.omega * BURANKO.rope;
      pose();
    },
    /** 女の子の席を動かす（プレイヤーが乗っていないときも呼ぶ） */
    updateGirl(dt) {
      // 乗っているあいだは、プレイヤーの揺れに少しずつ寄せる（体の使い方で合わせる、のつもり。
      // こぐ力だけでは向きのずれが残り、隣から見ると前や後ろにずれて見えた）
      const p = playerSeat.pendulum;
      const g = girlSeat.pendulum;
      const pull = girlSeated && girlPump > 0 ? 2.6 * (p.angle - g.angle) + 0.9 * (p.omega - g.omega) : 0;
      g.step(dt, girlSeated ? girlPump : 0, girlSeated ? girlBrake : 0.6, pull);
      pose();
    },
    /** 乗っていないプレイヤーの席を、ゆっくり止める */
    settle(dt) {
      playerSeat.pendulum.step(dt, 0, 0.6);
      pose();
    },
    eye(out = new THREE.Vector3()) {
      return playerSeat.pivot.localToWorld(out.set(0, -BURANKO.rope + 0.78, -0.02));
    },
    side(out = new THREE.Vector3()) {
      group.updateMatrixWorld(true);
      return group.localToWorld(out.set(BURANKO.seatGap / 2 + 0.2, 0, 1.1));
    },
    girlSeat(out = new THREE.Vector3()) { return seatTop(girlSeat, out); },
    girlYaw() { return yaw; },
    /**
     * 女の子が握る鎖の点（左右）。席の 0.32m 上（胸の下）。以前の 0.52m は肩と同じ高さで
     * （肩から 0.10m）、腕を曲げきれずに手が鎖から 11cm 離れていた
     */
    girlChain(side, out = new THREE.Vector3()) {
      return girlSeat.pivot.localToWorld(out.set(side * 0.21, -BURANKO.rope + 0.32, 0));
    },
    /** 女の子の席の鎖の向き（ワールド、上向き）。握る手の親指の側 */
    girlChainAxis(out = new THREE.Vector3()) {
      girlSeat.pivot.updateMatrixWorld(true);
      return out.set(0, 1, 0).transformDirection(girlSeat.pivot.matrixWorld);
    },
    girlSide(out = new THREE.Vector3()) {
      group.updateMatrixWorld(true);
      return group.localToWorld(out.set(-BURANKO.seatGap / 2 - 0.2, 0, 1.1));
    },
    set girlPump(v) { girlPump = THREE.MathUtils.clamp(v, 0, 1); },
    set girlBrake(v) { girlBrake = THREE.MathUtils.clamp(v, 0, 1); },
    set girlSeated(v) { girlSeated = Boolean(v); },
    get girlSeated() { return girlSeated; },
    get player() { return playerSeat.pendulum; },
    get girl() { return girlSeat.pendulum; },
    get speed() { return state.speed; },
  };
}
