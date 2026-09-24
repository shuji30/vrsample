import * as THREE from 'three';

/**
 * 馬（乗り物の窓口）。馬場（stable.js の PADDOCK）の中を歩く・走る。
 *
 * 模型は箱・球・円柱の組み合わせ（+Z が前、原点は鞍の真下の地面）。脚は肩・腰と膝の
 * 2 か所で曲がり、歩様ごとに脚の順番を変える。
 *   常歩（なみあし）1.5m/s：4 拍子（左後 → 左前 → 右後 → 右前）
 *   速歩（はやあし）3.0m/s：2 拍子（対角の脚がいっしょ）。体が上下にはずむ
 *   駈歩（かけあし）4.2m/s：3 拍子。体が前後に揺れる
 *
 * 乗り方（kartdrive.js の乗り降り・視点・VR の目線合わせをそのまま使う）
 *   W / ↑ / RT / 右トリガー：押すたびに 1 段速く（止まる → 常歩 → 速歩 → 駈歩）
 *   S / ↓ / LT / 左トリガー：押すたびに 1 段遅く。押し続けると止まる
 *   A D / スティック / ハンドル：曲がる（VR は両手で手綱を持って、左手を引くと左へ、右手を引くと右へ）
 * 柵に向かうと、馬が自分で柵に沿って曲がる（本物の馬も、馬場では柵に沿って走る）。
 *
 * 引き馬（lead = true）のあいだは、乗り手の操作を聞かずに、馬場の内側の道を常歩で回る
 * （速さは horsegame.js が、手綱を引く女の子に合わせて決める）。
 *
 * VR では、目の位置だけが鞍といっしょに動く（上下は半分。頭は傾けない。酔いにくいように）。
 */

export const HORSE = {
  gaits: [0, 1.5, 3.0, 4.2],
  gaitNames: ['とまる', 'なみあし', 'はやあし', 'かけあし'],
  accel: 1.6,
  decel: 2.4,
};
const STRIDE = [1.6, 1.6, 2.4, 3.1];
const DUTY = [0.65, 0.65, 0.48, 0.42];
// 脚の位相のずれ（左前・右前・左後・右後）
const OFFSETS = [
  [0, 0.5, 0.75, 0.25],
  [0, 0.5, 0.75, 0.25],
  [0, 0.5, 0.5, 0],
  [0.55, 0.3, 0, 0.3],
];

/** 蹄の音（短い、こもった「パカ」）。ユーザーの操作があるまでは鳴らさない */
function createHoofSound() {
  let context = null;
  let noise = null;
  function ensure() {
    if (context) return context;
    if (typeof navigator !== 'undefined' && navigator.userActivation && !navigator.userActivation.hasBeenActive) return null;
    const AudioContextClass = window.AudioContext ?? window.webkitAudioContext;
    if (!AudioContextClass) return null;
    try { context = new AudioContextClass(); } catch { return null; }
    noise = context.createBuffer(1, Math.floor(context.sampleRate * 0.08), context.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (context.sampleRate * 0.012));
    return context;
  }
  return {
    play(volume) {
      if (volume <= 0 || !ensure()) return;
      if (context.state === 'suspended') context.resume().catch(() => {});
      const src = context.createBufferSource();
      src.buffer = noise;
      src.playbackRate.value = 0.8 + Math.random() * 0.4;
      const filter = context.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 700 + Math.random() * 500;
      filter.Q.value = 1.2;
      const gain = context.createGain();
      gain.gain.value = volume;
      src.connect(filter).connect(gain).connect(context.destination);
      src.start();
    },
  };
}

/**
 * 馬の模型だけ（厩の飾りの馬にも使う）。
 * @returns {{ root: THREE.Group, pivot: THREE.Group, legs: object[], neck: THREE.Group, head: THREE.Group, tail: THREE.Group, halter: THREE.Object3D, bit: THREE.Object3D }}
 */
export function createHorseModel({ coat = 0x7a4a2a, dark = 0x2a1d16, blaze = true, saddle = true } = {}) {
  const root = new THREE.Group();
  const pivot = new THREE.Group();       // 体（上下・前後の揺れはここ）
  root.add(pivot);
  const coatMat = new THREE.MeshStandardMaterial({ color: coat, roughness: 0.6 });
  const darkMat = new THREE.MeshStandardMaterial({ color: dark, roughness: 0.8 });
  const hoofMat = new THREE.MeshStandardMaterial({ color: 0x1a1512, roughness: 0.6 });
  const shade = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };
  const sphere = new THREE.SphereGeometry(1, 20, 14);

  // 胴（胸・腹・尻）
  const barrel = shade(new THREE.Mesh(sphere, coatMat));
  barrel.scale.set(0.3, 0.36, 0.78);
  barrel.position.set(0, 1.14, 0);
  pivot.add(barrel);
  const chest = shade(new THREE.Mesh(sphere, coatMat));
  chest.scale.set(0.29, 0.38, 0.36);
  chest.position.set(0, 1.18, 0.55);
  pivot.add(chest);
  const rump = shade(new THREE.Mesh(sphere, coatMat));
  rump.scale.set(0.31, 0.37, 0.4);
  rump.position.set(0, 1.2, -0.52);
  pivot.add(rump);

  // 首と頭。首は付け根（肩の上）で回る
  const neck = new THREE.Group();
  neck.position.set(0, 1.35, 0.72);
  pivot.add(neck);
  const neckMesh = shade(new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.22, 0.8, 14), coatMat));
  neckMesh.position.set(0, 0.3, 0.2);
  neckMesh.rotation.x = 0.6;
  neck.add(neckMesh);
  // たてがみ：首の上の線に沿った細い帯（首は根元が太いので、先ほど首の軸へ寄せる）
  const mane = shade(new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.07, 0.72), darkMat));
  mane.position.set(0, 0.395, 0.115);
  mane.rotation.x = 0.6 - Math.PI / 2;
  neck.add(mane);
  const head = new THREE.Group();
  head.position.set(0, 0.62, 0.42);
  neck.add(head);
  const skull = shade(new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.13, 0.58, 12), coatMat));
  skull.rotation.x = Math.PI / 2 + 0.9;
  skull.position.set(0, -0.1, 0.2);
  head.add(skull);
  const muzzle = shade(new THREE.Mesh(sphere, darkMat));
  muzzle.scale.set(0.08, 0.07, 0.09);
  muzzle.position.set(0, -0.3, 0.38);
  head.add(muzzle);
  if (blaze) {
    // 額から鼻への白い筋：頭の骨の前の面（軸に直角で上前向き）に沿わせる
    const white = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.02, 0.34), new THREE.MeshStandardMaterial({ color: 0xf2eee8, roughness: 0.7 }));
    white.position.set(0, -0.045, 0.27);
    white.rotation.x = 0.9;
    head.add(white);
  }
  for (const side of [-1, 1]) {
    const ear = shade(new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.13, 6), coatMat));
    ear.position.set(side * 0.06, 0.1, 0.02);
    ear.rotation.z = -side * 0.2;
    head.add(ear);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), new THREE.MeshStandardMaterial({ color: 0x0c0806, roughness: 0.2 }));
    eye.position.set(side * 0.1, -0.02, 0.12);
    head.add(eye);
  }
  // 頭絡（無口）の輪と、口の横（手綱・引き綱をつなぐ所）
  const halterMat = new THREE.MeshStandardMaterial({ color: 0xb8322a, roughness: 0.6 });
  const noseband = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.012, 6, 18), halterMat);
  noseband.position.set(0, -0.2, 0.3);
  noseband.rotation.x = 0.9;
  head.add(noseband);
  const halter = new THREE.Object3D();
  halter.position.set(0, -0.3, 0.34);
  head.add(halter);
  const bit = new THREE.Object3D();
  bit.position.set(0, -0.27, 0.34);
  head.add(bit);

  // 尾
  const tail = new THREE.Group();
  tail.position.set(0, 1.4, -0.86);
  pivot.add(tail);
  const tailMesh = shade(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.1, 0.75, 8), darkMat));
  tailMesh.position.set(0, -0.36, -0.08);
  tailMesh.rotation.x = -0.2;
  tail.add(tailMesh);

  // 鞍・ゼッケン・あぶみ
  if (saddle) {
    const pad = shade(new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.04, 0.62), new THREE.MeshStandardMaterial({ color: 0x2f5aa8, roughness: 0.8 })));
    pad.position.set(0, 1.49, -0.02);
    pivot.add(pad);
    const leather = new THREE.MeshStandardMaterial({ color: 0x5a3418, roughness: 0.55 });
    const seat = shade(new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.07, 0.5), leather));
    seat.position.set(0, 1.535, -0.02);
    pivot.add(seat);
    const flap = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.05, 0.34), leather);
    flap.position.set(0, 1.505, 0.0);
    pivot.add(flap);
    const pommel = shade(new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.09, 0.07), leather));
    pommel.position.set(0, 1.6, 0.21);
    pivot.add(pommel);
    const cantle = shade(new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.07), leather));
    cantle.position.set(0, 1.6, -0.25);
    pivot.add(cantle);
    for (const side of [-1, 1]) {
      const strap = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.5, 0.03), darkMat);
      strap.position.set(side * 0.3, 1.26, 0.02);
      pivot.add(strap);
      const iron = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.01, 6, 12), new THREE.MeshStandardMaterial({ color: 0xc0c4c8, metalness: 0.8, roughness: 0.3 }));
      iron.position.set(side * 0.3, 0.99, 0.02);
      iron.rotation.y = Math.PI / 2;
      pivot.add(iron);
    }
  }

  // 脚：肩・腰（上）と膝（下）で回る。長さの合計 1.0m（腰の高さ 1.0m）
  const legs = [];
  for (const [x, z, front] of [[0.16, 0.56, true], [-0.16, 0.56, true], [0.16, -0.58, false], [-0.16, -0.58, false]]) {
    const hip = new THREE.Group();
    hip.position.set(x, 1.02, z);
    pivot.add(hip);
    const upper = shade(new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.065, 0.5, 10), coatMat));
    upper.position.y = -0.25;
    hip.add(upper);
    const knee = new THREE.Group();
    knee.position.y = -0.5;
    hip.add(knee);
    const lower = shade(new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.042, 0.44, 8), darkMat));
    lower.position.y = -0.22;
    knee.add(lower);
    const hoof = shade(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.07, 10), hoofMat));
    hoof.position.y = -0.475;
    knee.add(hoof);
    legs.push({ hip, knee, front });
  }
  return { root, pivot, legs, neck, head, tail, halter, bit };
}

/**
 * 脚と体を歩様に合わせて動かす（馬の模型を共通で動かす）。
 * phase は 0〜1 の完歩の位相、gait は 0〜3、amount は歩きの度合い（0 で脚をそろえる）
 */
export function poseHorse(model, { phase, gait, amount, time = 0, headDown = 0 }) {
  const g = Math.max(1, gait);
  const duty = DUTY[g];
  const swingA = [0, 0.32, 0.42, 0.55][g] * amount;
  const strikes = [];
  model.legs.forEach((leg, i) => {
    const p = (((phase + OFFSETS[g][i]) % 1) + 1) % 1;
    let hip;
    let knee = 0;
    if (p < duty) {
      // 地面についている：前から後ろへ
      hip = THREE.MathUtils.lerp(-swingA, swingA, p / duty);
    } else {
      // 浮いている：後ろから前へ、膝を曲げて
      const s = (p - duty) / (1 - duty);
      hip = THREE.MathUtils.lerp(swingA, -swingA, 0.5 - 0.5 * Math.cos(s * Math.PI));
      knee = Math.sin(s * Math.PI) * (leg.front ? 1.1 : 0.9) * amount;
    }
    // 後ろ脚は膝（飛節）が逆に曲がって見えるように、少し前へ倒す
    leg.hip.rotation.x = hip + (leg.front ? 0 : 0.08 * amount);
    leg.knee.rotation.x = knee * (leg.front ? 1 : 0.7);
    strikes.push(p);
  });
  // 体のはずみ・揺れ
  const w = Math.PI * 2 * phase;
  let bob = 0;
  let pitch = 0;
  if (gait === 1) { bob = 0.012 * Math.cos(2 * w); pitch = 0.012 * Math.sin(2 * w); }
  else if (gait === 2) bob = 0.035 * Math.abs(Math.cos(2 * w)) - 0.018;
  else if (gait === 3) { bob = 0.04 * Math.sin(w); pitch = 0.06 * Math.sin(w + 0.8); }
  bob *= amount;
  pitch *= amount;
  model.pivot.position.y = bob;
  model.pivot.rotation.x = pitch;
  // 首：常歩ではうなずく。止まっているときは、ときどき下げたり尾を振ったり
  const nod = gait === 1 ? 0.06 * Math.sin(2 * w) : gait === 3 ? 0.1 * Math.sin(w) : 0;
  model.neck.rotation.x = nod * amount + headDown * 0.7 + (1 - amount) * 0.03 * Math.sin(time * 0.7);
  model.tail.rotation.z = 0.25 * Math.sin(time * 1.3) * (1 - amount * 0.6);
  model.tail.rotation.x = -0.25 * amount * (gait >= 2 ? 1 : 0.3);
  return { bob, pitch, strikes };
}

/**
 * 乗れる馬。
 * @param {{ paddock: { cx: number, cz: number, rx: number, rz: number }, park: { x: number, z: number, yaw: number }, onGait?: (gait: number) => void }} options
 */
export function createHorse({ paddock, park, onGait = null }) {
  const group = new THREE.Group();
  group.name = 'horse';
  const model = createHorseModel();
  group.add(model.root);
  // 乗るときにつかめる所（鞍のまわりの見えない箱）
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.2, 1.8), new THREE.MeshBasicMaterial({ visible: false }));
  body.position.set(0, 1.1, 0);
  group.add(body);
  // 手綱（はみから鞍の前へ）。乗っているあいだだけ見せる
  const reinGeo = new THREE.BufferGeometry().setFromPoints(Array.from({ length: 10 }, () => new THREE.Vector3()));
  const reins = new THREE.Line(reinGeo, new THREE.LineBasicMaterial({ color: 0x3a2412 }));
  reins.frustumCulled = false;
  reins.visible = false;
  // 引き綱（無口から女の子の手へ）
  const leadGeo = new THREE.BufferGeometry().setFromPoints(Array.from({ length: 12 }, () => new THREE.Vector3()));
  const leadRope = new THREE.Line(leadGeo, new THREE.LineBasicMaterial({ color: 0xe0c060 }));
  leadRope.frustumCulled = false;
  leadRope.visible = false;
  const steering = new THREE.Object3D();   // ハンドルの代わり（鞍の前）
  steering.position.set(0, 1.75, 0.35);
  group.add(steering);

  const state = {
    speed: 0, yaw: park.yaw, travelYaw: park.yaw, steer: 0, onGrass: false, lateral: 0, u: 0,
    gait: 0, phase: 0, amount: 0, bob: 0,
  };
  const hoof = createHoofSound();
  let time = 0;
  let throttleHeld = false;
  let brakeHeld = false;
  let brakeFor = 0;
  let pushFor = 0;
  let ridden = false;
  let lead = false;
  let leadSpeed = 0;
  let skip = false;
  let lastStrikes = [1, 1, 1, 1];
  let lapAngle = 0;
  let lastTheta = null;
  let headDown = 0;
  let grazeIn = 6;

  function place(x, z, yaw) {
    group.position.set(x, 0, z);
    state.yaw = state.travelYaw = yaw;
    group.rotation.y = yaw;
  }
  place(park.x, park.z, park.yaw);

  // 馬場の内側の道（柵から 0.75m 内側）
  const track = { rx: paddock.rx - 0.75, rz: paddock.rz - 0.75 };
  const limit = { rx: paddock.rx - 0.6, rz: paddock.rz - 0.6 };
  function thetaOf(x, z) { return Math.atan2((z - paddock.cz) / track.rz, (x - paddock.cx) / track.rx); }
  function trackPoint(theta, out = new THREE.Vector3()) {
    return out.set(paddock.cx + track.rx * Math.cos(theta), 0, paddock.cz + track.rz * Math.sin(theta));
  }
  const angleDelta = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
  const aim = new THREE.Vector3();

  function setGait(g) {
    const next = THREE.MathUtils.clamp(g, 0, 3);
    if (next === state.gait) return;
    const prev = state.gait;
    state.gait = next;
    onGait?.(next, prev);
  }

  function update(dt, input = {}) {
    const { throttle = 0, brake = 0, steer = 0 } = input;
    ridden = true;
    time += dt;
    let turn = 0;
    const p = group.position;
    if (lead) {
      // 引き馬：内側の道を回る。乗り手が急かし続けたら（1 秒）、ひとりで乗る合図
      pushFor = throttle > 0.5 ? pushFor + dt : 0;
      if (pushFor > 1) skip = true;
      const target = leadSpeed;
      state.speed += THREE.MathUtils.clamp(target - state.speed, -HORSE.decel * dt, HORSE.accel * dt);
      const theta = thetaOf(p.x, p.z);
      trackPoint(theta - 0.4, aim);
      const want = Math.atan2(aim.x - p.x, aim.z - p.z);
      turn = THREE.MathUtils.clamp(angleDelta(want, state.yaw) * 2, -1.2, 1.2);
      state.gait = state.speed > 0.1 ? 1 : 0;
    } else {
      // 1 段ずつ（押した瞬間）。ブレーキは押し続けると止まる
      const up = throttle > 0.5;
      const down = brake > 0.5;
      if (up && !throttleHeld) setGait(state.gait + 1);
      if (down && !brakeHeld) setGait(state.gait - 1);
      brakeFor = down ? brakeFor + dt : 0;
      if (brakeFor > 0.6) setGait(0);
      throttleHeld = up;
      brakeHeld = down;
      const target = HORSE.gaits[state.gait];
      state.speed += THREE.MathUtils.clamp(target - state.speed, -HORSE.decel * dt, HORSE.accel * dt);
      // 曲がる。速いほど、曲がれる速さは少し落ちる（止まっていても、その場で向きを変えられる）
      const rate = state.speed < 0.2 ? 0.9 : 1.6 - 0.12 * state.speed;
      turn = steer * rate;
      // 柵に向かっていたら、柵に沿うように曲げる
      const nx = (p.x - paddock.cx) / limit.rx;
      const nz = (p.z - paddock.cz) / limit.rz;
      const r = Math.hypot(nx, nz);
      if (r > 0.82 && state.speed > 0.1) {
        const gx = nx / limit.rx;
        const gz = nz / limit.rz;
        const gl = Math.hypot(gx, gz) || 1;
        const fx = Math.sin(state.yaw);
        const fz = Math.cos(state.yaw);
        const outward = (fx * gx + fz * gz) / gl;
        if (outward > -0.1) {
          // 接線のうち、いまの向きに近いほう。柵は内へ曲がっているので、接線のままだと
          // すぐまた柵にかかる。柵に近いほど内側（-g）へ向ける
          const sx = -gz / gl;
          const sz = gx / gl;
          const sign = sx * fx + sz * fz >= 0 ? 1 : -1;
          const bias = THREE.MathUtils.clamp((r - 0.85) * 4, 0, 0.8);
          const vx = sign * sx - (gx / gl) * bias;
          const vz = sign * sz - (gz / gl) * bias;
          const want = Math.atan2(vx, vz);
          const k = THREE.MathUtils.clamp((r - 0.82) / 0.12, 0, 1);
          turn += THREE.MathUtils.clamp(angleDelta(want, state.yaw) * 4, -2.2, 2.2) * k;
        }
      }
    }
    state.steer = THREE.MathUtils.clamp(turn, -1, 1);
    state.yaw += turn * dt;
    state.travelYaw = state.yaw;
    p.x += Math.sin(state.yaw) * state.speed * dt;
    p.z += Math.cos(state.yaw) * state.speed * dt;
    // 柵の中に収める
    const nx = (p.x - paddock.cx) / limit.rx;
    const nz = (p.z - paddock.cz) / limit.rz;
    const r = Math.hypot(nx, nz);
    if (r > 1) {
      p.x = paddock.cx + (nx / r) * limit.rx;
      p.z = paddock.cz + (nz / r) * limit.rz;
      // まっすぐ柵へ向かっていたら、足をゆるめる（沿って走っているぶんには落とさない）
      const out = (Math.sin(state.yaw) * nx / limit.rx + Math.cos(state.yaw) * nz / limit.rz) / (Math.hypot(nx / limit.rx, nz / limit.rz) || 1);
      if (out > 0.5) state.speed *= 1 - 2 * dt;
    }
    group.rotation.y = state.yaw;
    // 周回（引き馬の 1 周を数える）。道を回る向きは θ が減る向き
    const theta = thetaOf(p.x, p.z);
    if (lastTheta !== null) lapAngle += -angleDelta(theta, lastTheta);
    lastTheta = theta;
    animate(dt, true);
  }

  function animate(dt, riding) {
    const moving = state.speed > 0.05;
    state.amount += ((moving ? 1 : 0) - state.amount) * Math.min(1, dt * 5);
    const shown = state.speed < 2.2 ? 1 : state.speed < 3.7 ? 2 : 3;
    state.phase = (state.phase + (state.speed / STRIDE[shown]) * dt) % 1;
    // 止まっているときは、ときどき首を下げて草を食む
    if (!moving && !riding) {
      grazeIn -= dt;
      if (grazeIn < 0) { headDown = headDown > 0.5 ? 0 : 1; grazeIn = headDown ? 4 + Math.random() * 3 : 6 + Math.random() * 6; }
    } else headDown = 0;
    state.headDown = (state.headDown ?? 0) + (headDown - (state.headDown ?? 0)) * Math.min(1, dt * 1.5);
    const pose = poseHorse(model, { phase: state.phase, gait: shown, amount: state.amount, time, headDown: state.headDown });
    state.bob = pose.bob;
    // 蹄が地面についた瞬間に鳴らす（乗っているか、引いているあいだだけ）
    pose.strikes.forEach((ph, i) => {
      if (moving && ridden && ph < lastStrikes[i] - 0.5) hoof.play(0.05 + 0.035 * shown);
      lastStrikes[i] = ph;
    });
    group.updateMatrixWorld(true);
    // 手綱
    reins.visible = ridden;
    if (ridden) {
      const a = model.bit.getWorldPosition(new THREE.Vector3());
      const b = steering.getWorldPosition(new THREE.Vector3());
      const pos = reinGeo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const t = i / (pos.count - 1);
        pos.setXYZ(i, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t - 0.12 * 4 * t * (1 - t), a.z + (b.z - a.z) * t);
      }
      pos.needsUpdate = true;
    }
  }

  const eyeOffset = new THREE.Vector3(0, 2.28, -0.12);
  const tmp = new THREE.Vector3();
  return {
    group,
    body,
    state,
    steering,
    model,
    reins,
    leadRope,
    kind: 'horse',
    silent: true,
    place,
    update,
    /**
     * VR：両手で手綱を持って、引いたほうへ曲がる（a, b は body（鞍のまわりの箱）から見た両手の位置。
     * +Z が前、+X が左）。両手が鞍の前・上に無ければ null（スティックで曲がる）
     */
    steerFromHands(a, b) {
      const near = (h) => h.z > -0.25 && h.z < 0.9 && h.y > 0.15 && h.y < 1.0 && Math.abs(h.x) < 0.6;
      if (!near(a) || !near(b)) return null;
      const [left, right] = a.x > b.x ? [a, b] : [b, a];
      const pull = right.z - left.z;   // 左手を手前へ引くと正（左へ）
      const steer = Math.abs(pull) < 0.04 ? 0 : THREE.MathUtils.clamp((pull - Math.sign(pull) * 0.04) / 0.2, -1, 1);
      return { steer, angle: steer * 90 };
    },
    /** 乗っていないとき（world.js から）：その場で立って、ときどき草を食む */
    idle(dt) {
      ridden = false;
      time += dt;
      state.speed = Math.max(0, state.speed - HORSE.decel * dt);
      const p = group.position;
      p.x += Math.sin(state.yaw) * state.speed * dt;
      p.z += Math.cos(state.yaw) * state.speed * dt;
      animate(dt, false);
    },
    /** プレイヤーの目の位置（鞍の上。上下のはずみは半分だけ） */
    eye(out = new THREE.Vector3()) {
      group.updateMatrixWorld(true);
      tmp.copy(eyeOffset);
      tmp.y += (state.bob ?? 0) * 0.5;
      return group.localToWorld(out.copy(tmp));
    },
    /** 降りる所（馬の左） */
    side(out = new THREE.Vector3()) {
      const y = state.yaw;
      return out.set(group.position.x + Math.cos(y) * 0.95, 0, group.position.z - Math.sin(y) * 0.95);
    },
    /** 引き馬で女の子が歩く所（馬の頭の左、0.8m） */
    leadPoint(out = new THREE.Vector3()) {
      const y = state.yaw;
      return out.set(group.position.x + Math.sin(y) * 1.0 + Math.cos(y) * 0.8, 0, group.position.z + Math.cos(y) * 1.0 - Math.sin(y) * 0.8);
    },
    /** 引き綱の、馬の側のはし */
    halterPoint(out = new THREE.Vector3()) { group.updateMatrixWorld(true); return model.halter.getWorldPosition(out); },
    /** 引き綱を張る（to は女の子の手。null で隠す） */
    setLeadRope(to) {
      leadRope.visible = Boolean(to);
      if (!to) return;
      const a = model.halter.getWorldPosition(tmp);
      const pos = leadGeo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const t = i / (pos.count - 1);
        pos.setXYZ(i, a.x + (to.x - a.x) * t, a.y + (to.y - a.y) * t - 0.15 * 4 * t * (1 - t), a.z + (to.z - a.z) * t);
      }
      pos.needsUpdate = true;
    },
    /** 引き馬にする / やめる。やめると止まった状態から、乗り手が操る */
    set lead(v) {
      lead = Boolean(v);
      skip = false;
      pushFor = 0;
      if (lead) { lapAngle = 0; lastTheta = null; } else { state.gait = 0; }
    },
    get lead() { return lead; },
    set leadSpeed(v) { leadSpeed = v; },
    /** 引き馬のあいだに、乗り手が急かした（ひとりで乗りたい） */
    get skipRequested() { return skip; },
    /** 引き馬を始めてから回った角度（ラジアン） */
    get lapAngle() { return lapAngle; },
    /** 乗り手が降りた */
    leave() { ridden = false; reins.visible = false; throttleHeld = brakeHeld = false; state.gait = 0; },
    get speed() { return state.speed; },
    get gaitName() { return HORSE.gaitNames[state.gait]; },
  };
}
