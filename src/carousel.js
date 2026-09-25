import * as THREE from 'three';
import { createHorseModel, poseHorse } from './horse.js';

/**
 * メリーゴーランド。家の左の芝生に置く。
 *
 * 回転台（半径 3.2m、高さ 0.25m）に、支柱ごとに上下する木馬が 6 頭と、二人がけの馬車が 1 台。
 * 真ん中の柱と、紅白の縞の屋根、屋根のふちの電球（夜は光る）。回るあいだは、手回しオルガン風の
 * ワルツを WebAudio で合成して鳴らす（外の音源は使わない）。
 *
 * 乗り物の窓口（kartdrive.js の乗り降り・VR の目線合わせ・視点をそのまま使う）。プレイヤーは
 * 馬車の外側の木馬に乗る。女の子はスカートなので木馬にはまたがらず、すぐ内側の馬車に座る
 * （carouselgame.js）。前に目隠しの板がある。
 *
 * 回り方：乗って、女の子が座ったら（来なければ 8 秒たったら）ゆっくり回りはじめ、1 周 14 秒で回る。
 * 降りると、ゆっくり止まる。VR で酔いにくいよう、速くしすぎず、加速も減速もゆるやかにする。
 * 回る向きは上から見て反時計まわり。木馬は進む向き（円の接線）を向く。
 */
export const CAROUSEL = {
  x: -11.5,
  z: 0.5,
  radius: 3.2,
  height: 0.25,
  horseRadius: 2.45,
  carriageRadius: 1.55,
  omega: (Math.PI * 2) / 14,
  accel: 0.08,     // rad/s²
};
const HORSES = 6;
const HORSE_BACK = 0.3;
const COLORS = [
  { coat: 0xf5f1ea, dark: 0xd9b24a },   // 白に金のたてがみ
  { coat: 0xf2b8c8, dark: 0xb05078 },
  { coat: 0xd9a441, dark: 0x7a4a1a },
  { coat: 0xa9c8f0, dark: 0x3a5a9a },
  { coat: 0xf5f1ea, dark: 0x8a6ad0 },
  { coat: 0x7a4a2a, dark: 0x2a1d16 },
];

/** 歩けない所か（回転台と、そのまわり。margin は体の半径ぶん） */
export function carouselBlocks(x, z, margin = 0) {
  return Math.hypot(x - CAROUSEL.x, z - CAROUSEL.z) < CAROUSEL.radius + 0.15 + margin;
}

/** 手回しオルガン風のワルツ（3 拍子、ブンチャッチャ）。start / stop で鳴らす・止める */
function createWaltz() {
  let ctx = null;
  let master = null;
  let playing = false;
  let nextTime = 0;
  let step = 0;
  let timer = null;
  // へ長調。メロディは 1 小節 3 拍を 6 つの 8 分音符で（null は休み）
  const MELODY = [
    72, null, 77, 77, 76, 77, 79, null, 77, null, 74, null,
    72, null, 76, 76, 74, 76, 77, null, 72, null, 69, null,
    70, null, 74, 74, 72, 74, 76, null, 74, 72, 70, null,
    69, null, 72, 72, 70, 69, 67, 69, 72, null, null, null,
  ];
  const BASS = [53, 60, 60, 53, 60, 60, 48, 55, 55, 48, 55, 55, 46, 53, 53, 48, 55, 55, 53, 60, 60, 53, 57, 60];
  const freq = (m) => 440 * 2 ** ((m - 69) / 12);
  const EIGHTH = 0.2;     // 1 拍 0.4 秒（150 拍/分の 3 拍子）
  function ensure() {
    if (ctx) return ctx;
    if (typeof navigator !== 'undefined' && navigator.userActivation && !navigator.userActivation.hasBeenActive) return null;
    const AudioContextClass = window.AudioContext ?? window.webkitAudioContext;
    if (!AudioContextClass) return null;
    try { ctx = new AudioContextClass(); } catch { return null; }
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    return ctx;
  }
  function note(m, at, length, type, level) {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq(m);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(level, at + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, at + length);
    osc.connect(g).connect(master);
    osc.start(at);
    osc.stop(at + length + 0.02);
  }
  function schedule() {
    if (!playing) return;
    while (nextTime < ctx.currentTime + 0.5) {
      const m = MELODY[step % MELODY.length];
      // オルガンの笛の音：矩形波をオクターブ上の三角波と重ねる
      if (m !== null) {
        note(m, nextTime, EIGHTH * 1.6, 'square', 0.05);
        note(m + 12, nextTime, EIGHTH * 1.2, 'triangle', 0.05);
      }
      if (step % 2 === 0) {
        const b = BASS[(step / 2) % BASS.length];
        note(b, nextTime, EIGHTH * 1.7, (step / 2) % 3 === 0 ? 'triangle' : 'square', (step / 2) % 3 === 0 ? 0.16 : 0.035);
      }
      nextTime += EIGHTH;
      step++;
    }
  }
  return {
    start() {
      if (playing || !ensure()) return;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      playing = true;
      nextTime = ctx.currentTime + 0.1;
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setTargetAtTime(0.5, ctx.currentTime, 0.4);
      schedule();
      timer = setInterval(schedule, 120);
    },
    stop() {
      if (!playing) return;
      playing = false;
      clearInterval(timer);
      master.gain.setTargetAtTime(0, ctx.currentTime, 0.5);
    },
    /** 聞く人との距離で音量を変える（0〜1） */
    set level(v) { if (ctx && playing) master.gain.setTargetAtTime(0.5 * v, ctx.currentTime, 0.2); },
    get playing() { return playing; },
  };
}

export function createCarousel() {
  const C = CAROUSEL;
  const group = new THREE.Group();
  group.name = 'carousel';
  group.position.set(C.x, 0, C.z);
  const shade = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };
  const gold = new THREE.MeshStandardMaterial({ color: 0xe0b44a, roughness: 0.3, metalness: 0.8 });
  const red = new THREE.MeshStandardMaterial({ color: 0xc8323a, roughness: 0.5 });
  const cream = new THREE.MeshStandardMaterial({ color: 0xf6ecd8, roughness: 0.6 });

  // 動かない土台
  const base = shade(new THREE.Mesh(new THREE.CylinderGeometry(C.radius + 0.1, C.radius + 0.2, 0.1, 48), new THREE.MeshStandardMaterial({ color: 0x8a8580, roughness: 0.9 })));
  base.position.y = 0.05;
  group.add(base);

  // 回る部分
  const rotor = new THREE.Group();
  group.add(rotor);
  const deck = shade(new THREE.Mesh(new THREE.CylinderGeometry(C.radius, C.radius, C.height - 0.1, 48), new THREE.MeshStandardMaterial({ color: 0x9a6a3e, roughness: 0.8 })));
  deck.position.y = 0.1 + (C.height - 0.1) / 2;
  rotor.add(deck);
  const rim = shade(new THREE.Mesh(new THREE.TorusGeometry(C.radius, 0.04, 8, 64), gold));
  rim.rotation.x = Math.PI / 2;
  rim.position.y = C.height;
  rotor.add(rim);
  // 真ん中の柱（鏡張りの筒）と、屋根
  const column = shade(new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 2.7, 16), new THREE.MeshStandardMaterial({ color: 0xd8e4f0, roughness: 0.1, metalness: 0.9 })));
  column.position.y = C.height + 1.35;
  rotor.add(column);
  for (const y of [C.height + 0.05, C.height + 2.65]) {
    const band = shade(new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 0.12, 16), gold));
    band.position.y = y;
    rotor.add(band);
  }
  const roofY = C.height + 2.9;
  // 紅白の縞の屋根：12 枚の三角を交互の色で
  const roofH = 1.3;
  const segs = 12;
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI * 2;
    const a1 = ((i + 1) / segs) * Math.PI * 2;
    const r = C.radius + 0.3;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([
      0, roofH, 0,
      Math.cos(a1) * r, 0, Math.sin(a1) * r,
      Math.cos(a0) * r, 0, Math.sin(a0) * r,
    ], 3));
    geo.computeVertexNormals();
    const tri = shade(new THREE.Mesh(geo, i % 2 ? red : cream));
    tri.position.y = roofY;
    rotor.add(tri);
  }
  const finial = shade(new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), gold));
  finial.position.y = roofY + roofH + 0.1;
  rotor.add(finial);
  // 屋根のふちの帯と電球
  const valance = shade(new THREE.Mesh(new THREE.CylinderGeometry(C.radius + 0.3, C.radius + 0.3, 0.35, 48, 1, true), red));
  valance.material = red.clone();
  valance.material.side = THREE.DoubleSide;
  valance.position.y = roofY - 0.17;
  rotor.add(valance);
  const bulbMat = new THREE.MeshStandardMaterial({ color: 0xfff2c0, emissive: 0xffd070, emissiveIntensity: 0.6, roughness: 0.3 });
  const bulbGeo = new THREE.SphereGeometry(0.045, 8, 6);
  const bulbs = new THREE.InstancedMesh(bulbGeo, bulbMat, 40);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    m4.makeTranslation(Math.cos(a) * (C.radius + 0.34), roofY - 0.17, Math.sin(a) * (C.radius + 0.34));
    bulbs.setMatrixAt(i, m4);
  }
  rotor.add(bulbs);

  // 木馬（支柱ごとに上下）。0 番がプレイヤーの馬
  const horses = [];
  for (let i = 0; i < HORSES; i++) {
    const a = (i / HORSES) * Math.PI * 2;
    const holder = new THREE.Group();     // 円の上の位置・向き（接線）
    holder.position.set(Math.cos(a) * C.horseRadius, C.height, Math.sin(a) * C.horseRadius);
    // 反時計まわりに回るので、進む向きは (-sin a, cos a)
    holder.rotation.y = Math.atan2(-Math.sin(a), Math.cos(a));
    rotor.add(holder);
    const pole = shade(new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, roofY - C.height, 8), gold));
    pole.position.y = (roofY - C.height) / 2;
    holder.add(pole);
    const bob = new THREE.Group();
    holder.add(bob);
    const model = createHorseModel({ ...COLORS[i], blaze: false, saddle: true });
    model.root.scale.setScalar(0.62);
    // 脚は地面に着かない（浮いて走る形）。支柱が乗り手のすぐ前（首の付け根）を通るよう、
    // 馬を 0.3m 後ろへずらす（真ん中だと、VR で支柱が頭の中を通った）
    model.root.position.set(0, 0.3, -HORSE_BACK);
    bob.add(model.root);
    horses.push({ holder, bob, model, phase: i * 1.7 });
  }
  // 馬車（プレイヤーの馬の内側、少し後ろ）
  const carriageAngle = -0.18;
  const carriage = new THREE.Group();
  carriage.position.set(Math.cos(carriageAngle) * C.carriageRadius, C.height, Math.sin(carriageAngle) * C.carriageRadius);
  carriage.rotation.y = Math.atan2(-Math.sin(carriageAngle), Math.cos(carriageAngle));
  rotor.add(carriage);
  const cartMat = new THREE.MeshStandardMaterial({ color: 0x3a78c8, roughness: 0.45, metalness: 0.2 });
  // 床は低い板（足を置く所）、座面は台の上。以前は床の箱が座面のすぐ下まであって、脚が埋まった
  const cartFloor = shade(new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.06, 1.0), cartMat));
  cartFloor.position.set(0, 0.03, 0);
  carriage.add(cartFloor);
  const pedestal = shade(new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.37, 0.4), cartMat));
  pedestal.position.set(0, 0.06 + 0.185, -0.24);
  carriage.add(pedestal);
  const seat = shade(new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.06, 0.42), cream));
  seat.position.set(0, 0.46, -0.23);
  carriage.add(seat);
  for (const s of [-1, 1]) {
    const wall = shade(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.5, 1.0), cartMat));
    wall.position.set(s * 0.43, 0.3, 0);
    carriage.add(wall);
  }
  const backrest = shade(new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.55, 0.08), cartMat));
  backrest.position.set(0, 0.62, -0.44);
  carriage.add(backrest);
  const swirl = shade(new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.035, 8, 20, Math.PI), gold));
  swirl.position.set(0, 0.9, -0.44);
  carriage.add(swirl);
  // 前の目隠しの板（外から見て、座った膝の奥が見えないように）と、握る手すり
  const front = shade(new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.62, 0.08), cartMat));
  front.position.set(0, 0.31, 0.46);
  carriage.add(front);
  const rail = shade(new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.7, 10), gold));
  rail.rotation.z = Math.PI / 2;
  rail.position.set(0, 0.72, 0.36);
  carriage.add(rail);
  for (const s of [-1, 1]) {
    const post = shade(new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.18, 8), gold));
    post.position.set(s * 0.33, 0.63, 0.4);
    carriage.add(post);
  }

  // 乗るときにつかめる所：プレイヤーの馬のまわりの見えない箱
  const player = horses[0];
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.2, 1.4), new THREE.MeshBasicMaterial({ visible: false }));
  body.position.set(0, 0.8, -HORSE_BACK);
  player.bob.add(body);
  const steering = new THREE.Object3D();
  steering.position.set(0, 1.25, 0.05);
  player.bob.add(steering);

  const music = createWaltz();
  const state = {
    speed: 0, yaw: 0, travelYaw: 0, steer: 0, onGrass: false, lateral: 0, u: 0,
    angle: 0,      // 回転台の角度
    omega: 0,      // 回る速さ（rad/s）
  };
  let running = false;
  let time = 0;
  let girlSeated = false;
  let riderOn = false;
  let waitFor = 0;
  let girlComing = false;
  let laps = 0;
  let lastAngle = 0;

  function pose(dt) {
    time += dt;
    rotor.rotation.y = -state.angle;    // 上から見て反時計まわり（y 軸の回転の向きに注意）
    horses.forEach((h) => {
      // 回っているときだけ上下（止まると真ん中の高さに戻る）
      const k = Math.min(1, state.omega / C.omega);
      h.bob.position.y = 0.14 * Math.sin(state.angle * 3 + h.phase) * k;
      poseHorse(h.model, { phase: 0.15, gait: 3, amount: 0.7, time, headDown: 0 });
    });
    const lit = 0.5 + 0.5 * Math.max(0, Math.sin(time * 6));
    bulbMat.emissiveIntensity = running ? 0.8 + 0.6 * lit : 0.5;
    group.updateMatrixWorld(true);
    // 木馬の向き（ワールド）：回転台の角度の分だけ回る
    const w = new THREE.Vector3();
    player.bob.getWorldDirection(w);
    state.yaw = state.travelYaw = Math.atan2(w.x, w.z);
  }

  function spin(dt, want) {
    state.omega += THREE.MathUtils.clamp(want - state.omega, -C.accel * dt, C.accel * dt);
    state.angle += state.omega * dt;
    state.speed = state.omega * C.horseRadius;
    if (state.angle - lastAngle > Math.PI * 2) { laps++; lastAngle += Math.PI * 2; }
    pose(dt);
  }

  pose(0);
  const tmp = new THREE.Vector3();
  const eyeOffset = new THREE.Vector3(0, 0.3 + 1.52 * 0.62 + 0.78, -HORSE_BACK - 0.05);
  return {
    group,
    body,
    state,
    steering,
    kind: 'carousel',
    silent: true,
    place() {},
    /** プレイヤーが乗っているあいだ（kartdrive.js から） */
    update(dt) {
      riderOn = true;
      waitFor += dt;
      // 女の子が向かっているあいだは待つ（乗り込む前に回りはじめないように）。来ないなら 3 秒で
      if (!running && (girlSeated || (!girlComing && waitFor > 3))) { running = true; music.start(); }
      spin(dt, running ? C.omega : 0);
    },
    /** 乗っていないとき（world.js から）：止まるまでゆるめる */
    idle(dt) {
      if (riderOn) { riderOn = false; waitFor = 0; }
      if (running) { running = false; music.stop(); }
      spin(dt, 0);
    },
    /** 音楽の大きさを、聞く人との距離で変える */
    listen(pos) {
      const d = Math.hypot(pos.x - C.x, pos.z - C.z);
      music.level = THREE.MathUtils.clamp(6 / Math.max(d, 1), 0.08, 1);
    },
    /** プレイヤーの目（木馬の鞍の上） */
    eye(out = new THREE.Vector3()) {
      player.bob.updateMatrixWorld(true);
      return player.bob.localToWorld(out.copy(eyeOffset));
    },
    /** 降りる所（プレイヤーの馬の外側、台の外） */
    side(out = new THREE.Vector3()) {
      player.holder.getWorldPosition(tmp);
      const dx = tmp.x - C.x;
      const dz = tmp.z - C.z;
      const d = Math.hypot(dx, dz) || 1;
      return out.set(C.x + (dx / d) * (C.radius + 0.7), 0, C.z + (dz / d) * (C.radius + 0.7));
    },
    /** 女の子の座る所（馬車の座面の上面）と向き */
    girlSeat(out = new THREE.Vector3()) {
      carriage.updateMatrixWorld(true);
      return carriage.localToWorld(out.set(0.18, 0.49, -0.2));
    },
    /** 馬車の床（足を置く所）の高さ（ワールド） */
    girlFloorY() { carriage.updateMatrixWorld(true); return carriage.localToWorld(tmp.set(0, 0.06, 0)).y; },
    girlYaw() {
      carriage.getWorldDirection(tmp);
      return Math.atan2(tmp.x, tmp.z);
    },
    /** 女の子が乗り込む所（馬車の外側の、台の外） */
    girlBoard(out = new THREE.Vector3()) {
      carriage.getWorldPosition(tmp);
      const dx = tmp.x - C.x;
      const dz = tmp.z - C.z;
      const d = Math.hypot(dx, dz) || 1;
      return out.set(C.x + (dx / d) * (C.radius + 0.6), 0, C.z + (dz / d) * (C.radius + 0.6));
    },
    /** 女の子の握る手すり（左右）と、その向き */
    girlRail(side, out = new THREE.Vector3()) {
      carriage.updateMatrixWorld(true);
      return carriage.localToWorld(out.set(0.18 + side * 0.17, 0.72, 0.36));
    },
    girlRailAxis(out = new THREE.Vector3()) {
      carriage.updateMatrixWorld(true);
      return out.set(1, 0, 0).transformDirection(carriage.matrixWorld);
    },
    set girlSeated(v) { girlSeated = Boolean(v); },
    /** 女の子が乗りに向かっている（回りはじめるのを待つ） */
    set girlComing(v) { girlComing = Boolean(v); },
    get girlSeated() { return girlSeated; },
    get running() { return running; },
    get laps() { return laps; },
    get musicPlaying() { return music.playing; },
    get speed() { return state.speed; },
    /** 検証用 */
    debugStart() { running = true; },
  };
}
