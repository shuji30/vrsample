import * as THREE from 'three';
import { SOFA, TABLE } from './furniture.js';
import { PARK } from './park.js';
import { beachGround } from './beach.js';

/**
 * 座れる所（家のソファー・食卓の椅子・庭のベンチ・砂浜のパラソルの下）。
 *
 * どれも乗り物の窓口（kartdrive.js）に乗せる。近くで E（VR はその席へトリガー）で座り、E（VR はグリップ 0.5 秒）で立つ。
 * 座ると、女の子が歩いてきて隣か向かいに座り、会話ができる（seatgame.js・talk.js）。
 *
 * 1 つの席が 1 つの「乗り物」。席ごとに、プレイヤーの座る所・向き（yaw。体の前 = (sin, cos)）と、
 * 女の子の座る所・向き・座る前に立つ所（approach）を持つ。
 * - ソファー：クッション 2 枚。女の子はもう一方のクッションへ（並んで座る）
 * - 食卓の椅子：3 脚。女の子は別の椅子へ（テーブルをはさんで向かい合う）
 * - 庭のベンチ：左右の 2 席。女の子はもう一方へ（並んで、庭とテニスコートを眺める）
 * - パラソル：ビーチチェア 2 脚（ここで作る）。並んで海（北）を眺める
 *
 * PC の視点は、座ったとき女の子のほうへ少し向け、A / D（←→）で見まわせる。
 */

/** ソファのローカル座標をワールドの XZ に（character.js と同じ） */
function sofaToWorld(localX, localZ) {
  const c = Math.cos(SOFA.yaw);
  const s = Math.sin(SOFA.yaw);
  return new THREE.Vector2(SOFA.center.x + localX * c + localZ * s, SOFA.center.z - localX * s + localZ * c);
}

/** 食卓の椅子の角度（furniture.js と同じ）。椅子はテーブルの中心から 0.96m、テーブルのほうを向く */
const CHAIR_ANGLES = [Math.PI * 0.18, Math.PI * 0.82, Math.PI * 1.5];
const CHAIR_TOP = 0.47;
/** 女の子がどの椅子へ行くか（プレイヤーの椅子 → 女の子の椅子） */
const CHAIR_PARTNER = [2, 2, 0];
/** 椅子の前（テーブルの反対側）に立つ所まで、部屋の経路（character.js の ROUTE）のどの節点から、どこを通って行くか */
const CHAIR_WAY = [
  { node: 6, via: [] },
  { node: 6, via: [[1.35, -1.4], [1.25, -2.9]] },
  { node: 0, via: [] },
];

const BENCH_TOP = 0.46;
/** ビーチチェア（パラソルの下、レジャーシートの上。海のほう = 北を向く） */
// パラソルの柱（x 6, z -80.8）の少し前（海の側）。柱が座った目の前に来ないよう、柱は背中の後ろ
export const BEACH_CHAIRS = { x: 6.05, z: -81.35, gap: 0.82, top: 0.36 };

function hitBox(w, h, d) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ visible: false }));
  m.userData.interactive = true;
  return m;
}

function beachChairModel() {
  const g = new THREE.Group();
  const frame = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.45, metalness: 0.3 });
  const c = document.createElement('canvas');
  c.width = 64; c.height = 8;
  const x = c.getContext('2d');
  for (let i = 0; i < 8; i++) { x.fillStyle = i % 2 ? '#ffffff' : '#2f9fd8'; x.fillRect(i * 8, 0, 8, 8); }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const cloth = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, side: THREE.DoubleSide });
  const T = BEACH_CHAIRS.top;
  // 座面（ローカル -Z が前）と、後ろへ倒れた背もたれ
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.03, 0.46), cloth);
  seat.position.set(0, T - 0.015, 0);
  seat.castShadow = true;
  g.add(seat);
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.62, 0.03), cloth);
  back.position.set(0, T + 0.27, 0.3);
  back.rotation.x = -0.45;
  back.castShadow = true;
  g.add(back);
  for (const sx of [-0.26, 0.26]) {
    const legF = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, T + 0.05, 6), frame);
    legF.position.set(sx, (T + 0.05) / 2 - 0.03, -0.2);
    legF.rotation.x = 0.25;
    g.add(legF);
    const legB = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.95, 6), frame);
    legB.position.set(sx, 0.4, 0.26);
    legB.rotation.x = -0.45;
    g.add(legB);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.03, 0.46), frame);
    arm.position.set(sx, T + 0.16, 0.02);
    g.add(arm);
  }
  return g;
}

export function createSeats() {
  const group = new THREE.Group();
  group.name = 'seats';
  const list = [];

  /**
   * 席を 1 つ作る。
   * @param {object} o
   * @param {string} o.name 席の名前（テスト・表示用）
   * @param {'house'|'garden'|'beach'} o.where
   * @param {THREE.Vector2} o.seat プレイヤーの腰の位置（XZ）
   * @param {number} o.top 座面の高さ（その場の地面から）
   * @param {number} o.yaw プレイヤーの向き
   * @param {() => { seat: THREE.Vector2, top: number, yaw: number, approach: THREE.Vector2 }} o.girl 女の子の席（ソファーは読み込み後に決まるので関数）
   * @param {boolean} o.facing 向かい合わせか（スカートを腿に沿わせる）
   */
  function addSeat(o) {
    const ground = o.where === 'beach' ? (x, z) => beachGround(x, z) : () => 0;
    const gy = ground(o.seat.x, o.seat.y);
    const holder = new THREE.Group();
    holder.position.set(o.seat.x, gy, o.seat.y);
    holder.rotation.y = o.yaw;
    group.add(holder);
    // 当たりの箱（座面の上。VR のトリガー・PC のクリックで座る）。小さめにして、机の上の物を拾う邪魔をしない
    const body = hitBox(o.hitW ?? 0.46, 0.3, o.hitD ?? 0.42);
    body.position.y = o.top + 0.12;
    holder.add(body);
    // kartdrive.js は、両手がハンドルの近くにあるかを見る。遠くへ置いておく
    const steering = new THREE.Object3D();
    steering.position.y = -50;
    holder.add(steering);
    const fx = Math.sin(o.yaw);
    const fz = Math.cos(o.yaw);
    const state = { speed: 0, yaw: o.yaw, travelYaw: o.yaw, steer: 0, onGrass: false, lateral: 0, u: 0 };
    let look = 0;          // A / D で見まわした分
    let baseLook = 0;      // 座ったとき、女の子のほうへ向けた分
    const seat = {
      group: holder,
      body,
      state,
      steering,
      kind: 'seat',
      silent: true,
      name: o.name,
      where: o.where,
      facing: Boolean(o.facing),
      ground,
      place() {},
      update(dt, input) {
        look = THREE.MathUtils.clamp(look - (input?.steer ?? 0) * dt * 1.0, -1.4, 1.4);
      },
      /** 座った目の高さ（腰から 0.72m 上、少し前） */
      eye(out = new THREE.Vector3()) {
        return out.set(o.seat.x + fx * 0.06, gy + o.top + 0.72, o.seat.y + fz * 0.06);
      },
      /** 立つ所（席の前） */
      side(out = new THREE.Vector3()) {
        const d = o.standOut ?? 0.7;
        const x = o.seat.x + fx * d;
        const z = o.seat.y + fz * d;
        return out.set(x, ground(x, z), z);
      },
      /** PC の後ろからの視点（C）：前の斜め上から、二人を見る */
      chase(camera) {
        const g = o.girl();
        const mx = (o.seat.x + g.seat.x) / 2;
        const mz = (o.seat.y + g.seat.y) / 2;
        const ay = Math.atan2(mx - o.seat.x, mz - o.seat.y);
        const dirX = o.facing ? Math.sin(o.yaw + Math.PI / 2) : fx;
        const dirZ = o.facing ? Math.cos(o.yaw + Math.PI / 2) : fz;
        camera.position.set(mx + dirX * 2.3, gy + 1.6, mz + dirZ * 2.3);
        camera.lookAt(mx, gy + o.top + 0.35, mz);
        void ay;
      },
      /** 座ったとき：女の子のほうへ少し向ける（向かいなら女の子へ、並びなら半分） */
      aimAtGirl() {
        const g = o.girl();
        const a = Math.atan2(g.seat.x - o.seat.x, g.seat.y - o.seat.y);
        let d = a - o.yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        // 砂浜は海を眺めたいので、女の子へは少しだけ
        baseLook = THREE.MathUtils.clamp(d * (o.facing ? 0.85 : o.where === 'beach' ? 0.3 : 0.7), -1.2, 1.2);
        look = 0;
      },
      get lookYawOffset() { return baseLook + look; },
      girlSeat(out = new THREE.Vector3()) {
        const g = o.girl();
        return out.set(g.seat.x, ground(g.seat.x, g.seat.y) + g.top, g.seat.y);
      },
      girlYaw() { return o.girl().yaw; },
      girlApproach(out = new THREE.Vector2()) { return out.copy(o.girl().approach); },
      /** 部屋の中の道順（経路の節点と、そこから通る点）。家の席だけ */
      girlWay() { return o.girl().way ?? null; },
      girlFloorY() { const g = o.girl(); return ground(g.seat.x, g.seat.y); },
      get speed() { return 0; },
    };
    list.push(seat);
    return seat;
  }

  // --- ソファー（クッション 2 枚。女の子は character.js の座る所の表 seats を読み込み後に使う） ---
  let bodySeats = null;
  const sofaGirl = (i) => () => {
    const other = bodySeats?.[1 - i];
    const localX = SOFA.cushions[1 - i];
    return {
      seat: other ? other.seat : sofaToWorld(localX, SOFA.seatZ),
      approach: other ? other.approach : sofaToWorld(localX, SOFA.frontZ + 0.3),
      top: SOFA.top,
      yaw: SOFA.yaw,
      way: { node: other ? other.via : 5, via: [] },
    };
  };
  SOFA.cushions.forEach((localX, i) => {
    addSeat({ name: `sofa${i}`, where: 'house', seat: sofaToWorld(localX, SOFA.seatZ + 0.04), top: SOFA.top, yaw: SOFA.yaw, girl: sofaGirl(i), hitW: 0.7, hitD: 0.5, standOut: 0.75 });
  });

  // --- 食卓の椅子（テーブルをはさんで向かい合う） ---
  const chairs = CHAIR_ANGLES.map((a, i) => {
    const seat = new THREE.Vector2(TABLE.center.x + Math.sin(a) * 0.96, TABLE.center.z + Math.cos(a) * 0.96);
    const approach = new THREE.Vector2(TABLE.center.x + Math.sin(a) * 1.5, TABLE.center.z + Math.cos(a) * 1.5);
    return { seat, approach, top: CHAIR_TOP, yaw: a + Math.PI, way: { node: CHAIR_WAY[i].node, via: CHAIR_WAY[i].via.map(([x, z]) => new THREE.Vector2(x, z)) } };
  });
  chairs.forEach((c, i) => {
    addSeat({ name: `chair${i}`, where: 'house', seat: c.seat, top: c.top, yaw: c.yaw, girl: () => chairs[CHAIR_PARTNER[i]], facing: true, standOut: 0.6 });
  });

  // --- 庭のベンチ（左右の 2 席。背もたれはベンチのローカル +Z、座る人はその反対を向く） ---
  {
    const b = PARK.bench;
    const yaw = b.yaw + Math.PI;
    const at = (lx, lz = 0) => new THREE.Vector2(b.x + lx * Math.cos(b.yaw) + lz * Math.sin(b.yaw), b.z - lx * Math.sin(b.yaw) + lz * Math.cos(b.yaw));
    const benchSeats = [-0.4, 0.4].map((lx) => ({ seat: at(lx, 0.0), approach: at(lx, -0.62), top: BENCH_TOP, yaw }));
    benchSeats.forEach((s, i) => addSeat({ name: `bench${i}`, where: 'garden', seat: s.seat, top: s.top, yaw, girl: () => benchSeats[1 - i], hitW: 0.7, hitD: 0.36 }));
  }

  // --- パラソルの下のビーチチェア（並んで海を眺める） ---
  {
    const B = BEACH_CHAIRS;
    const beachSeats = [-1, 1].map((sx) => {
      const x = B.x + sx * B.gap / 2;
      const chair = beachChairModel();
      chair.position.set(x, beachGround(x, B.z), B.z);
      group.add(chair);
      return { seat: new THREE.Vector2(x, B.z + 0.02), approach: new THREE.Vector2(x, B.z - 0.62), top: B.top, yaw: Math.PI };
    });
    beachSeats.forEach((s, i) => addSeat({ name: `beach${i}`, where: 'beach', seat: s.seat, top: s.top, yaw: Math.PI, girl: () => beachSeats[1 - i], hitW: 0.5, hitD: 0.46 }));
  }

  return {
    group,
    list,
    /** 当たりの箱（world.interactables に入れる） */
    bodies: list.map((s) => s.body),
    /** 女の子が読み込まれたら、ソファの座る所（腿の長さで決まる）を使う */
    useBodySeats(seats) { bodySeats = seats; },
  };
}
