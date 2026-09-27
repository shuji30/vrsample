import * as THREE from 'three';
import { SEA_LEVEL, hillHeight } from './hill.js';

/**
 * カモメ（7 羽）。海辺・桟橋・丘の北の崖の縁・沖の上を、輪を描いて飛ぶ。
 *
 * - 1 羽ずつ、輪の中心・半径（8〜22m）・高さ・回る向きを持ち、翼を M の字に曲げて滑空する。
 *   ときどき（3〜7 秒ごと）1〜2 秒羽ばたいて上がり、滑空しながらゆっくり下りる。曲がる内側へ体を傾ける
 * - 輪の中心はゆっくりさまよう（決まった場所の上に、ずっと同じ輪を描かないように）
 * - 船（クルーザー・ジェットスキー）に乗っているあいだは、3 羽が船の後ろの上について飛ぶ
 * - 近くを飛ぶと、ときどき「ミャー」と鳴く（合成音。聞く人からの距離で小さく）
 *
 * 模型は +Z が前（くちばし）、翼を広げた幅 1.3m。白い体と頭、灰色の翼に黒い翼の先、黄色いくちばし
 */

const FLOCK = [
  // 砂浜の上
  { cx: -8, cz: -88, r: 14, h: 9, base: 'sea' },
  { cx: 4, cz: -92, r: 10, h: 13, base: 'sea' },
  // 桟橋の上
  { cx: 28, cz: -104, r: 12, h: 8, base: 'sea' },
  // 丘の北の崖の縁（家の庭・テニスコートの奥から見える）
  { cx: -6, cz: -62, r: 18, h: 6, base: 'hill' },
  { cx: 12, cz: -66, r: 12, h: 9, base: 'hill' },
  // 沖（島巡りの道の上）
  { cx: 60, cz: -210, r: 22, h: 11, base: 'sea' },
  { cx: -120, cz: -300, r: 20, h: 12, base: 'sea' },
];
const FOLLOWERS = 3;          // 船について飛ぶ数（FLOCK の後ろから順に）
const HILL_TOP = 0;           // 丘の上の高さ（崖の縁のカモメの高さの基準）

/**
 * 上から見た形（Shape の x = 左右、y = 前後）を、厚み depth の水平な板にする。
 * dark(x) が true の頂点は黒く（翼の先）、ほかは白（材質の色がそのまま出る）
 */
function planform(shape, depth, dark) {
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 6 });
  geo.translate(0, 0, -depth / 2);
  geo.rotateX(Math.PI / 2);          // 形の y を体の前後（z）へ、厚みを上下へ
  if (dark) {
    const pos = geo.attributes.position;
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const k = dark(pos.getX(i)) ? 0.12 : 1;
      col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = k;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  return geo;
}

function makeGull(mats) {
  const g = new THREE.Group();
  const sphere = new THREE.SphereGeometry(1, 14, 10);
  const body = new THREE.Mesh(sphere, mats.white);
  body.scale.set(0.075, 0.07, 0.2);
  g.add(body);
  const head = new THREE.Mesh(sphere, mats.white);
  head.scale.set(0.055, 0.055, 0.06);
  head.position.set(0, 0.035, 0.2);
  g.add(head);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.07, 6), mats.beak);
  beak.rotation.x = Math.PI / 2;
  beak.position.set(0, 0.025, 0.28);
  g.add(beak);
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.008, 6, 4), mats.eye);
    eye.position.set(side * 0.04, 0.05, 0.22);
    g.add(eye);
  }
  // 尾：白い扇（後ろが少し広がる）
  const tailShape = new THREE.Shape();
  tailShape.moveTo(-0.03, 0);
  tailShape.lineTo(0.03, 0);
  tailShape.lineTo(0.055, -0.11);
  tailShape.quadraticCurveTo(0, -0.125, -0.055, -0.11);
  tailShape.lineTo(-0.03, 0);
  const tail = new THREE.Mesh(planform(tailShape, 0.01, null), mats.white);
  tail.position.set(0, 0.01, -0.17);
  g.add(tail);
  // 翼：付け根（肩）で上下に振り、ひじで先を折る（滑空のときは M の字）。
  // 上から見た形：内側は幅広（前縁が少し後ろへ流れる）、外側は細く尖って後ろへ流れ、先の 1/3 が黒い
  const wings = [];
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.05, 0.03, 0.03);
    g.add(shoulder);
    const inner = new THREE.Shape();
    inner.moveTo(0, 0.075);
    inner.lineTo(side * 0.31, 0.06);
    inner.lineTo(side * 0.31, -0.085);
    inner.quadraticCurveTo(side * 0.15, -0.115, 0, -0.1);
    inner.lineTo(0, 0.075);
    shoulder.add(new THREE.Mesh(planform(inner, 0.014, null), mats.wing));
    const elbow = new THREE.Group();
    elbow.position.set(side * 0.3, 0, 0);
    shoulder.add(elbow);
    const outer = new THREE.Shape();
    outer.moveTo(0, 0.06);
    outer.quadraticCurveTo(side * 0.2, 0.04, side * 0.36, -0.08);
    outer.quadraticCurveTo(side * 0.2, -0.1, 0, -0.085);
    outer.lineTo(0, 0.06);
    elbow.add(new THREE.Mesh(planform(outer, 0.012, (x) => Math.abs(x) > 0.23), mats.wingTip));
    wings.push({ side, shoulder, elbow });
  }
  return { group: g, wings };
}

/** 「ミャー」：高い音から下がる 2 声（のこぎり波を帯域で細くする） */
function createCall() {
  let ctx = null;
  function ensure() {
    if (ctx) return ctx;
    if (typeof navigator !== 'undefined' && navigator.userActivation && !navigator.userActivation.hasBeenActive) return null;
    const AC = window.AudioContext ?? window.webkitAudioContext;
    if (!AC) return null;
    try { ctx = new AC(); } catch { return null; }
    return ctx;
  }
  function note(t, f0, f1, dur, vol) {
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.linearRampToValueAtTime(f0 * 1.08, t + dur * 0.25);
    osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 2200;
    band.Q.value = 2.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(band).connect(g).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }
  return {
    play(volume) {
      if (volume < 0.01 || !ensure()) return false;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      if (ctx.state !== 'running') return false;
      const t = ctx.currentTime;
      const v = Math.min(0.3, volume);
      const f = 1500 + Math.random() * 400;
      note(t, f, f * 0.62, 0.32, v);
      if (Math.random() < 0.7) note(t + 0.4, f * 0.95, f * 0.6, 0.28, v * 0.8);
      return true;
    },
  };
}

/**
 * @param {object} o
 * @param {boolean} [o.sound]
 */
export function createSeagulls({ sound = true } = {}) {
  // 地面の高さは丘の地形（海の上は海底で、SEA_LEVEL より下）。world.js の groundHeight は海の上で 0 を返すので使わない
  const groundHeight = (x, z) => hillHeight(x, z);
  const group = new THREE.Group();
  group.name = 'seagulls';
  const mats = {
    white: new THREE.MeshStandardMaterial({ color: 0xf4f5f2, roughness: 0.7 }),
    // 下から見上げると翼の裏が影で黒くなるので、少し自分で光らせる（本物の翼の裏は白っぽい）
    wing: new THREE.MeshStandardMaterial({ color: 0xa9b0b8, roughness: 0.7, emissive: 0x3a3f45 }),
    wingTip: new THREE.MeshStandardMaterial({ color: 0xa9b0b8, roughness: 0.7, vertexColors: true, emissive: 0x2a2e33 }),
    beak: new THREE.MeshStandardMaterial({ color: 0xf0c030, roughness: 0.5 }),
    eye: new THREE.MeshStandardMaterial({ color: 0x0c0c0c, roughness: 0.3 }),
  };
  const call = sound ? createCall() : null;
  const rand = (a, b) => a + Math.random() * (b - a);
  const list = FLOCK.map((f, i) => {
    const { group: g, wings } = makeGull(mats);
    group.add(g);
    const base = f.base === 'hill' ? HILL_TOP : SEA_LEVEL;
    return {
      g, wings, home: { x: f.cx, z: f.cz }, cx: f.cx, cz: f.cz, r: f.r, dir: i % 2 ? 1 : -1,
      a: Math.random() * Math.PI * 2, speed: rand(7, 9), y: base + f.h, hBase: base + f.h,
      flap: 0, flapFor: 0, nextFlap: rand(1, 5), phase: Math.random() * 6, climb: 0,
      wander: Math.random() * 6, nextCall: rand(4, 20), follow: -1,
      x: f.cx, z: f.cz, yaw: 0, bank: 0,
    };
  });
  const tmp = new THREE.Vector3();

  /**
   * @param {number} dt
   * @param {THREE.Vector3} listener 聞く人（カメラ）の位置
   * @param {{ x, z, yaw, speed } | null} boat 乗っている船
   */
  function update(dt, listener, boat = null) {
    dt = Math.min(dt, 0.05);
    list.forEach((b, i) => {
      // 船について飛ぶ（後ろの 3 羽）：輪の中心を船の少し後ろへ
      const follower = boat && i >= list.length - FOLLOWERS;
      if (follower) {
        const k = i - (list.length - FOLLOWERS);
        const back = 10 + k * 5;
        const tx = boat.x - Math.sin(boat.yaw) * back;
        const tz = boat.z - Math.cos(boat.yaw) * back;
        b.cx += (tx - b.cx) * Math.min(1, dt * 1.5);
        b.cz += (tz - b.cz) * Math.min(1, dt * 1.5);
        b.r = 6 + k * 2;
        b.hBase = SEA_LEVEL + 7 + k * 2;
        b.speed = Math.max(7, Math.abs(boat.speed) + 3);
      } else {
        // 輪の中心は、持ち場のまわりをゆっくりさまよう
        b.wander += dt * 0.05;
        const f = FLOCK[i];
        const tx = f.cx + Math.sin(b.wander * 1.3 + i) * 10;
        const tz = f.cz + Math.cos(b.wander + i * 2) * 8;
        b.cx += (tx - b.cx) * Math.min(1, dt * 0.2);
        b.cz += (tz - b.cz) * Math.min(1, dt * 0.2);
        b.r += (f.r - b.r) * Math.min(1, dt * 0.2);
        b.hBase += ((f.base === 'hill' ? HILL_TOP : SEA_LEVEL) + f.h - b.hBase) * Math.min(1, dt * 0.2);
        b.speed += (8 - b.speed) * Math.min(1, dt * 0.2);
      }
      // 羽ばたき：数秒ごとに 1〜2 秒。羽ばたいているあいだは上へ、滑空は少しずつ下りる
      b.nextFlap -= dt;
      if (b.nextFlap <= 0 && b.flapFor <= 0) { b.flapFor = rand(1, 2); b.nextFlap = rand(3, 7); }
      const flapping = b.flapFor > 0;
      if (flapping) b.flapFor -= dt;
      b.climb += ((flapping ? 0.9 : -0.25) - b.climb) * Math.min(1, dt * 2);
      b.y += b.climb * dt;
      b.y += (b.hBase - b.y) * Math.min(1, dt * 0.3);
      const ground = groundHeight(b.x, b.z);
      if (b.y < Math.max(ground, SEA_LEVEL) + 2.5) b.y = Math.max(ground, SEA_LEVEL) + 2.5;
      // 輪を回る
      const w = (b.speed / b.r) * b.dir;
      b.a += w * dt;
      const nx = b.cx + Math.cos(b.a) * b.r;
      const nz = b.cz + Math.sin(b.a) * b.r;
      const yaw = Math.atan2(nx - b.x, nz - b.z);
      b.x = nx;
      b.z = nz;
      b.yaw = yaw;
      // 曲がる内側へ傾ける（速さ² / 半径 / g）
      const wantBank = Math.atan2((b.speed * b.speed) / b.r, 9.8) * -b.dir;
      b.bank += (wantBank - b.bank) * Math.min(1, dt * 2);
      b.g.position.set(b.x, b.y, b.z);
      b.g.rotation.set(-b.climb * 0.12, yaw, b.bank, 'YXZ');
      // 翼：羽ばたき（肩を上下に、ひじは遅れて）／滑空（M の字：肩を少し上げ、先を下げる）
      b.flap += ((flapping ? 1 : 0) - b.flap) * Math.min(1, dt * 4);
      b.phase += dt * 9;
      const beat = Math.sin(b.phase);
      for (const wg of b.wings) {
        const glideShoulder = 0.16;
        const glideElbow = -0.32;
        const sh = glideShoulder * (1 - b.flap) + beat * 0.7 * b.flap;
        const el = glideElbow * (1 - b.flap) + Math.sin(b.phase - 0.8) * 0.35 * b.flap;
        wg.shoulder.rotation.z = sh * wg.side;
        wg.elbow.rotation.z = el * wg.side;
      }
      // 鳴く（近いときだけ）
      b.nextCall -= dt;
      if (b.nextCall <= 0) {
        b.nextCall = rand(6, 22);
        if (call && listener) {
          const d = tmp.set(b.x, b.y, b.z).distanceTo(listener);
          if (d < 60) call.play(0.25 / (1 + d / 8));
        }
      }
    });
  }

  return {
    group,
    update,
    get list() { return list; },
    /** 検証用：i 番目を (x, y, z) の中心で回らせる */
    debugPlace(i, x, y, z) { const b = list[i]; if (!b) return; b.cx = x; b.cz = z; b.hBase = y; b.y = y; b.x = x + b.r; b.z = z; },
  };
}
