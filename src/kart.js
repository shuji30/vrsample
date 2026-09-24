import * as THREE from 'three';
import { KART_TRACK, TRACK_LENGTH, nearestOnTrack, trackPoint, trackTangent } from './karttrack.js';

/**
 * カート（子ども用のゴーカート）。見た目と、走りの物理。
 *
 * 物理は「自転車モデル」を簡単にしたもの。前輪の切れ角と速さから曲がる速さ
 * （ヨーレート）を決め、タイヤが横へ出せる力の上限（横の加速度 7m/s²）で頭打ちに
 * する。上限を超えるほど切ると、曲がりきれずに外へふくらむ（ドリフトはしない）。
 * 芝生へ出ると転がり抵抗が大きく、最高速も落ちる。
 *
 * カートのローカル座標は、前が +Z、左が +X、上が +Y。原点は後輪の車軸の真ん中の地面。
 */
export const KART = {
  length: 1.6,
  width: 1.1,
  /** 前後の車軸のあいだ（m） */
  wheelBase: 1.05,
  wheelRadius: 0.14,
  /** 座った目の高さ（m）と、座席の位置（ローカル z） */
  eyeHeight: 0.85,
  seatZ: 0.25,
  /** アスファルトでの最高速（m/s、時速 29km） */
  maxSpeed: 8.0,
  grassMaxSpeed: 3.5,
  reverseMax: 2.0,
  accel: 3.6,
  brake: 7.5,
  /** アクセルを離したときの減速（m/s²）。芝生はもっと効く */
  coast: 0.7,
  grassDrag: 3.0,
  /** ハンドルいっぱいの前輪の切れ角（rad）。速いほど小さくする */
  steerMax: 0.5,
  steerMaxFast: 0.2,
  /** タイヤの横の力の上限（横の加速度、m/s²） */
  grip: 7.0,
  /** ハンドルの戻り・切る速さ（1/s） */
  steerRate: 3.5,
};

function checkerDecal(color) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 128, 64);
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.font = 'bold 44px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  return { canvas, ctx };
}

/**
 * カートを 1 台作る。
 * @param {{ color?: number, number?: string, name?: string }} options
 */
export function createKart({ color = 0x2b6fd6, number = '1', name = 'kart' } = {}) {
  const group = new THREE.Group();
  group.name = name;
  const body = new THREE.Group();   // ハンドルと車輪以外（乗るときにつかめる所）
  group.add(body);

  const paint = new THREE.MeshPhysicalMaterial({ color, roughness: 0.35, metalness: 0.1, clearcoat: 0.8, clearcoatRoughness: 0.25 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x24262b, roughness: 0.7, metalness: 0.3 });
  const metal = new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.35, metalness: 0.9 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x16171a, roughness: 0.9 });
  const add = (mesh, parent = body) => { mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh; };

  // 車台（パイプフレームの上の床板）
  const floor = add(new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.04, 1.35), dark));
  floor.position.set(0, 0.1, 0.5);
  // フロントのカウル（色つき）と、サイドポッド、リアバンパー
  const nose = add(new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.16, 0.42), paint));
  nose.position.set(0, 0.2, 1.12);
  nose.rotation.x = -0.18;
  for (const side of [-1, 1]) {
    const pod = add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.14, 0.62), paint));
    pod.position.set(side * 0.44, 0.17, 0.42);
  }
  const bumper = add(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.95, 10), metal));
  bumper.rotation.z = Math.PI / 2;
  bumper.position.set(0, 0.16, -0.2);
  // ゼッケン
  const { canvas, ctx } = checkerDecal(`#${new THREE.Color(color).getHexString()}`);
  ctx.fillText(number, 64, 34);
  const decal = new THREE.CanvasTexture(canvas);
  decal.colorSpace = THREE.SRGBColorSpace;
  const plate = add(new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.17), new THREE.MeshStandardMaterial({ map: decal, roughness: 0.5 })));
  plate.position.set(0, 0.29, 1.3);
  plate.rotation.x = -0.35;
  // 座席（背もたれつき）とエンジン
  const seat = add(new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.08, 0.4), dark));
  seat.position.set(0, 0.16, KART.seatZ);
  const back = add(new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.06), dark));
  back.position.set(0, 0.36, KART.seatZ - 0.22);
  back.rotation.x = -0.25;
  const engine = add(new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.22, 0.26), metal));
  engine.position.set(0.3, 0.22, -0.02);

  // ハンドル（ステアリングコラムの先に、丸いハンドル）
  const column = add(new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.5, 8), metal));
  column.position.set(0, 0.34, 0.78);
  column.rotation.x = 0.95;
  // ハンドルの前の、脚を覆う板（ナッソーパネル）。コラムはこの板を抜けて前へ伸びる
  const panel = add(new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.24, 0.03), paint));
  panel.position.set(0, 0.29, 0.88);
  panel.rotation.x = -0.45;
  const wheelPivot = new THREE.Group();
  wheelPivot.position.set(0, 0.52, 0.62);
  wheelPivot.rotation.x = -0.62;    // ハンドルの面を運転する人へ傾ける
  body.add(wheelPivot);
  const steering = new THREE.Group();
  wheelPivot.add(steering);
  add(new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.018, 8, 28), rubber), steering);
  const spoke = add(new THREE.Mesh(new THREE.BoxGeometry(0.29, 0.03, 0.012), metal), steering);
  spoke.position.y = -0.02;

  // 車輪（前 2 つは切れる）
  const wheels = [];
  const tire = new THREE.CylinderGeometry(KART.wheelRadius, KART.wheelRadius, 0.14, 18);
  tire.rotateZ(Math.PI / 2);
  for (const [z, front] of [[KART.wheelBase, true], [0, false]]) {
    for (const side of [-1, 1]) {
      const knuckle = new THREE.Group();
      knuckle.position.set(side * (KART.width / 2 - 0.07), KART.wheelRadius, z);
      group.add(knuckle);
      const w = add(new THREE.Mesh(tire, rubber), knuckle);
      const hub = add(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.145, 12).rotateZ(Math.PI / 2), metal), knuckle);
      hub.position.x = 0;
      wheels.push({ knuckle, wheel: w, hub, front });
    }
  }

  const state = {
    speed: 0,        // 前向きの速さ（m/s、バックは負）
    steer: 0,        // ハンドルの位置 -1（右）〜 1（左）
    yaw: 0,          // 進む向き（ワールド、+Z が 0）
    onGrass: false,
    trackIndex: -1,  // コースのいちばん近い点（探すときのあたり）
    u: 0,            // コースの上の位置（0..1）
    lateral: 0,      // 中心線からのずれ（m）
    brakeHeld: 0,    // 止まってからブレーキを踏み続けている時間（バックに入るまで）
    hit: 0,
  };
  let spin = 0;

  /** 見た目を state に合わせる */
  function pose() {
    group.rotation.y = state.yaw;
    const angle = state.steer * steerLimit();
    for (const w of wheels) {
      if (w.front) w.knuckle.rotation.y = angle;
      w.wheel.rotation.x = spin;
      w.hub.rotation.x = spin;
    }
    steering.rotation.z = -state.steer * 1.6;   // ハンドルは前輪の 3 倍ほど回す
  }

  function steerLimit() {
    const k = Math.min(1, Math.abs(state.speed) / KART.maxSpeed);
    return KART.steerMax + (KART.steerMaxFast - KART.steerMax) * k;
  }

  return {
    group,
    body,
    state,
    steering,
    /** 置く（位置と向き） */
    place(x, z, yaw) {
      group.position.set(x, 0, z);
      state.yaw = yaw;
      state.speed = 0;
      state.steer = 0;
      state.trackIndex = -1;
      pose();
    },
    /**
     * 1 フレームぶん走らせる。
     * @param {number} dt
     * @param {{ throttle: number, brake: number, steer: number }} input
     *   throttle / brake は 0..1、steer は -1（右）〜 1（左）
     * @param {(x: number, z: number, from: {x: number, z: number}) => {x: number, z: number}} [clamp]
     *   走れる範囲に収める関数（壁に当たると止まる）
     */
    update(dt, { throttle = 0, brake = 0, steer = 0 }, clamp = null) {
      // ハンドルは一定の速さで追いかける（キーボードでもガクッと切れない）
      const ds = steer - state.steer;
      state.steer += Math.sign(ds) * Math.min(Math.abs(ds), KART.steerRate * dt);

      // 路面：中心線からのずれが路面と縁石の外なら芝生
      const near = nearestOnTrack(group.position.x, group.position.z, state.trackIndex);
      state.trackIndex = near.index;
      state.u = near.u;
      state.lateral = near.lateral;
      state.onGrass = Math.abs(near.lateral) > KART_TRACK.width / 2 + KART_TRACK.curb;

      // 前後の加速
      const top = state.onGrass ? KART.grassMaxSpeed : KART.maxSpeed;
      let a = 0;
      if (throttle > 0.01) {
        // 速さが上限に近いほど伸びなくなる
        a += KART.accel * throttle * Math.max(0, 1 - state.speed / top);
      }
      // ブレーキ：走っていれば止まる。止まってからも踏み続けると（0.4 秒）バックする。
      // 止まった瞬間にバックへ移ると、止まりたいだけのときにも下がってしまう
      if (brake > 0.01 && state.speed <= 0.2) state.brakeHeld += dt;
      else if (brake <= 0.01) state.brakeHeld = 0;
      if (brake > 0.01) {
        if (state.speed > 0.2) a -= KART.brake * brake;
        else if (state.brakeHeld > 0.4 || state.speed < -0.05) a -= KART.accel * 0.6 * brake * Math.max(0, 1 + state.speed / KART.reverseMax);
        else if (state.speed > 0) state.speed = Math.max(0, state.speed - KART.brake * brake * dt);
      }
      const drag = (state.onGrass ? KART.grassDrag : KART.coast) + (state.speed > top ? 4 : 0);
      state.speed += a * dt;
      if (Math.abs(state.speed) > 1e-3 && throttle < 0.01 && (brake < 0.01 || state.speed > 0)) {
        const d = Math.min(Math.abs(state.speed), drag * dt);
        state.speed -= Math.sign(state.speed) * d;
      }
      state.speed = Math.max(-KART.reverseMax, state.speed);

      // 曲がる：ヨーレート = v tanδ / L。横の加速度（v × ヨーレート）がグリップを超えないように
      const delta = state.steer * steerLimit();
      // 止まりかけでもアクセルを踏んでいれば、少しは向きを変えられる（壁に正面から当たって
      // 止まると、止まったままではハンドルを切っても向きが変わらず、抜け出せなかった）
      const turnSpeed = Math.sign(state.speed || 1) * Math.max(Math.abs(state.speed), throttle * 0.9, brake * 0.6);
      let yawRate = (turnSpeed * Math.tan(delta)) / KART.wheelBase;
      const speed = Math.abs(state.speed);
      if (speed > 0.5) {
        const limit = KART.grip / speed;
        yawRate = Math.max(-limit, Math.min(limit, yawRate));
      }
      state.yaw += yawRate * dt;

      const from = { x: group.position.x, z: group.position.z };
      let nx = from.x + Math.sin(state.yaw) * state.speed * dt;
      let nz = from.z + Math.cos(state.yaw) * state.speed * dt;
      state.hit = 0;
      if (clamp) {
        const c = clamp(nx, nz, from);
        // 壁に当たった：正面から当たるほど止まり、斜めに当たれば壁に沿って滑る
        const px = c.x - nx;
        const pz = c.z - nz;
        const push = Math.hypot(px, pz);
        if (push > 1e-4) {
          const facing = Math.abs(Math.sin(state.yaw) * px + Math.cos(state.yaw) * pz) / push;
          state.hit = Math.abs(state.speed) * facing;
          state.speed *= 1 - 0.75 * facing;
        }
        nx = c.x;
        nz = c.z;
      }
      group.position.x = nx;
      group.position.z = nz;
      spin += (state.speed / KART.wheelRadius) * dt;
      pose();
    },
    /** 座った目の位置（ワールド） */
    eye(out = new THREE.Vector3()) {
      return group.localToWorld(out.set(0, KART.eyeHeight, KART.seatZ));
    },
    /** 乗り降りするときに立つ所（左の横、ワールド） */
    side(out = new THREE.Vector3()) {
      return group.localToWorld(out.set(1.1, 0, KART.seatZ));
    },
    get speed() { return state.speed; },
  };
}

/** スタートの枠 slot（0 = 前、1 = 後ろ）の位置と向き */
export function gridSlot(slot) {
  const back = slot === 0 ? 2.2 : 3.8;
  const side = slot === 0 ? -0.8 : 0.8;
  const u = KART_TRACK.startAt - back / TRACK_LENGTH;
  const p = trackPoint(u);
  const t = trackTangent(u);
  // 枠の線（前端）より少し後ろに、後輪の車軸を置く
  return {
    x: p.x - t.z * side - t.x * (KART.wheelBase * 0.6),
    z: p.z + t.x * side - t.z * (KART.wheelBase * 0.6),
    yaw: Math.atan2(t.x, t.z),
  };
}
