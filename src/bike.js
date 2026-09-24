import * as THREE from 'three';
import { BIKE_TRACK, nearestOnBikeTrack } from './biketrack.js';

/**
 * ポケバイ（小さなバイク）。カート（kart.js）と同じ窓口（group / body / state / steering /
 * place / update / eye / side / speed）にして、kartdrive.js の乗り降り・入力・視点をそのまま使う。
 *
 * 走り：前輪の切れ角で曲がる（ヨーレート = v tanδ / L）。横の加速度はグリップを超えない。
 * 見た目は、曲がるときの横の加速度に合わせて内側へ傾ける（atan(a / g)、最大 40°）。
 * 乗っている人の目もいっしょに傾くが、VR ではリグは傾けない（酔いやすいので、目の位置だけ動く）。
 *
 * バックは歩くくらい（ブレーキを踏み続けて止まってから）。
 */
export const BIKE = {
  length: 1.1,
  wheelBase: 0.78,
  wheelRadius: 0.13,
  eyeHeight: 0.95,
  seatZ: -0.05,
  maxSpeed: 7.0,
  grassMaxSpeed: 2.5,
  reverseMax: 1.0,
  accel: 3.2,
  brake: 6.5,
  coast: 0.8,
  grassDrag: 3.5,
  steerMax: 0.5,
  steerMaxFast: 0.16,
  grip: 6.5,
  steerRate: 4,
  maxLean: 0.7,
};

export function createBike({ color = 0xf2a31b, name = 'bike' } = {}) {
  const group = new THREE.Group();
  group.name = name;
  // 傾け（ロール）用に 1 段はさむ。group は向き（ヨー）だけ、lean を傾ける
  const lean = new THREE.Group();
  group.add(lean);
  const body = new THREE.Group();   // 乗るときにつかめる所
  lean.add(body);

  const paint = new THREE.MeshPhysicalMaterial({ color, roughness: 0.35, metalness: 0.1, clearcoat: 0.8, clearcoatRoughness: 0.25 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x23252a, roughness: 0.7, metalness: 0.3 });
  const metal = new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.35, metalness: 0.9 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x151618, roughness: 0.9 });
  const add = (mesh, parent = body) => { mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh; };

  // フレーム・タンク・シート・前のカウル・テールカウル
  const frame = add(new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.7), metal));
  frame.position.set(0, 0.2, 0.36);
  const tank = add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.14, 0.3), paint));
  tank.position.set(0, 0.36, 0.42);
  const seat = add(new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.06, 0.3), dark));
  seat.position.set(0, 0.35, 0.12);
  const tail = add(new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 0.2), paint));
  tail.position.set(0, 0.36, -0.06);
  tail.rotation.x = -0.25;
  const cowl = add(new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.26, 0.2), paint));
  cowl.position.set(0, 0.36, 0.72);
  cowl.rotation.x = -0.45;
  const screen = add(new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 0.02), new THREE.MeshStandardMaterial({ color: 0x9fd0ff, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.55 })));
  screen.position.set(0, 0.52, 0.76);
  screen.rotation.x = -0.6;
  const engine = add(new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.14, 0.2), dark));
  engine.position.set(0, 0.16, 0.28);
  // ステップ（足を載せる所）
  for (const side of [-1, 1]) {
    const peg = add(new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.12, 6), metal));
    peg.rotation.z = Math.PI / 2;
    peg.position.set(side * 0.12, 0.14, 0.16);
  }

  // ハンドル（フォークの上。steering を回すと前輪も切れる）
  const steering = new THREE.Group();
  steering.position.set(0, 0.5, 0.6);
  body.add(steering);
  const bar = add(new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.46, 8), metal), steering);
  bar.rotation.z = Math.PI / 2;
  for (const side of [-1, 1]) {
    const grip = add(new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.1, 8), rubber), steering);
    grip.rotation.z = Math.PI / 2;
    grip.position.x = side * 0.2;
  }
  const fork = add(new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.42, 8), metal), steering);
  fork.position.set(0, -0.2, 0.08);
  fork.rotation.x = 0.35;

  // 車輪
  const tire = new THREE.CylinderGeometry(BIKE.wheelRadius, BIKE.wheelRadius, 0.08, 18);
  tire.rotateZ(Math.PI / 2);
  const wheels = [];
  for (const [z, front] of [[BIKE.wheelBase, true], [0, false]]) {
    const knuckle = new THREE.Group();
    knuckle.position.set(0, BIKE.wheelRadius, z);
    lean.add(knuckle);
    const w = add(new THREE.Mesh(tire, rubber), knuckle);
    const hub = add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.09, 10).rotateZ(Math.PI / 2), metal), knuckle);
    wheels.push({ knuckle, wheel: w, hub, front });
  }

  const state = {
    speed: 0, steer: 0, yaw: 0, lean: 0, onGrass: false, trackIndex: -1, u: 0, lateral: 0,
    brakeHeld: 0, hit: 0, travelYaw: 0, slip: 0, pitch: 0, roll: 0, boost: 1,
    perf: { top: 1, accel: 1, grip: 1 },
  };
  let spin = 0;

  function steerLimit() {
    const k = Math.min(1, Math.abs(state.speed) / BIKE.maxSpeed);
    return BIKE.steerMax + (BIKE.steerMaxFast - BIKE.steerMax) * k;
  }

  function pose() {
    group.rotation.set(0, state.yaw, 0);
    // 内側へ傾ける。ローカル +X は左（カートと同じ。yaw が増えると +X の側へ曲がる）なので、
    // 左へ曲がる（lean > 0）ときは +Z まわりに負へ回して +X（左）を下げる
    lean.rotation.z = -state.lean;
    const angle = state.steer * steerLimit();
    steering.rotation.y = angle;
    for (const w of wheels) {
      if (w.front) w.knuckle.rotation.y = angle;
      w.wheel.rotation.x = spin;
      w.hub.rotation.x = spin;
    }
  }

  return {
    group,
    body,
    state,
    steering,
    kind: 'bike',
    place(x, z, yaw) {
      group.position.set(x, 0, z);
      state.yaw = yaw;
      state.travelYaw = yaw;
      state.speed = 0;
      state.steer = 0;
      state.lean = 0;
      state.trackIndex = -1;
      pose();
    },
    update(dt, { throttle = 0, brake = 0, steer = 0, handbrake = 0 }, clamp = null) {
      const ds = steer - state.steer;
      state.steer += Math.sign(ds) * Math.min(Math.abs(ds), BIKE.steerRate * dt);

      const near = nearestOnBikeTrack(group.position.x, group.position.z, state.trackIndex);
      state.trackIndex = near.index;
      state.u = near.u;
      state.lateral = near.lateral;
      state.onGrass = Math.abs(near.lateral) > BIKE_TRACK.width / 2 + BIKE_TRACK.curb;

      const top = state.onGrass ? BIKE.grassMaxSpeed : BIKE.maxSpeed;
      let a = 0;
      if (throttle > 0.01) a += BIKE.accel * throttle * Math.max(0, 1 - state.speed / top);
      const stop = Math.max(brake, handbrake);
      if (stop > 0.01 && state.speed <= 0.2) state.brakeHeld += dt;
      else if (stop <= 0.01) state.brakeHeld = 0;
      if (stop > 0.01) {
        if (state.speed > 0.2) a -= BIKE.brake * stop;
        else if (state.brakeHeld > 0.4 || state.speed < -0.05) a -= BIKE.accel * 0.4 * brake * Math.max(0, 1 + state.speed / BIKE.reverseMax);
        else if (state.speed > 0) state.speed = Math.max(0, state.speed - BIKE.brake * stop * dt);
      }
      const drag = (state.onGrass ? BIKE.grassDrag : BIKE.coast) + (state.speed > top ? 4 : 0);
      state.speed += a * dt;
      if (Math.abs(state.speed) > 1e-3 && throttle < 0.01 && (stop < 0.01 || state.speed > 0)) {
        state.speed -= Math.sign(state.speed) * Math.min(Math.abs(state.speed), drag * dt);
      }
      state.speed = Math.max(-BIKE.reverseMax, state.speed);

      const delta = state.steer * steerLimit();
      const turnSpeed = Math.sign(state.speed || 1) * Math.max(Math.abs(state.speed), throttle * 0.8, brake * 0.5);
      let yawRate = (turnSpeed * Math.tan(delta)) / BIKE.wheelBase;
      const speed = Math.abs(state.speed);
      if (speed > 0.5) {
        const limit = BIKE.grip / speed;
        yawRate = Math.max(-limit, Math.min(limit, yawRate));
      }
      state.yaw += yawRate * dt;
      state.travelYaw = state.yaw;
      // 傾き：横の加速度（v × ヨーレート）に合わせる。ゆっくり追う
      const want = THREE.MathUtils.clamp(Math.atan((state.speed * yawRate) / 9.8), -BIKE.maxLean, BIKE.maxLean);
      state.lean += (want - state.lean) * Math.min(1, 6 * dt);

      const from = { x: group.position.x, z: group.position.z };
      let nx = from.x + Math.sin(state.yaw) * state.speed * dt;
      let nz = from.z + Math.cos(state.yaw) * state.speed * dt;
      state.hit = 0;
      if (clamp) {
        const c = clamp(nx, nz, from);
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
      spin += (state.speed / BIKE.wheelRadius) * dt;
      pose();
    },
    /** 乗っている人の目の位置（ワールド）。傾くといっしょに動く */
    eye(out = new THREE.Vector3()) {
      lean.updateMatrixWorld(true);
      return lean.localToWorld(out.set(0, BIKE.eyeHeight, BIKE.seatZ + 0.1));
    },
    /** 乗り降りする所（左） */
    side(out = new THREE.Vector3()) {
      group.updateMatrixWorld(true);
      return group.localToWorld(out.set(0.9, 0, BIKE.seatZ + 0.2));
    },
    /**
     * VR：両手（バイクのローカル）でハンドルバーを握っているとき、手を結ぶ線の向きから
     * ハンドルの切れ具合（-1 右 〜 1 左）を出す。バーの近くに両手が無ければ null
     */
    steerFromHands(a, b) {
      const cx = 0;
      const cy = steering.position.y;
      const cz = steering.position.z;
      const near = (p) => Math.hypot(p.x - cx, p.y - cy, p.z - cz) < 0.4;
      if (!near(a) || !near(b)) return null;
      const [l, r] = a.x > b.x ? [a, b] : [b, a];
      // 左手が前へ出る（右手が手前へ引かれる）と右へ切る
      const angle = Math.atan2(l.z - r.z, l.x - r.x);
      return { steer: THREE.MathUtils.clamp(-angle / 0.5, -1, 1), angle: THREE.MathUtils.radToDeg(-angle) };
    },
    get speed() { return state.speed; },
  };
}
