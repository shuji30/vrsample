import * as THREE from 'three';
import { SEA_LEVEL } from './hill.js';

/**
 * トビウオ。クルーザー・ジェットスキーで沖を走っていると、船の前や横の海面から群れ（1〜4 匹）で飛び出し、
 * 胸びれを翼のように広げて水面すれすれを滑空する。
 *
 * - 飛び出す：2〜7 秒ごと。船の前 10〜30m・横 4〜16m の海（浅瀬・岩場・桟橋でない所）から、
 *   船から離れる向き（前へ・斜め外へ）に 12〜16 m/s、上へ 2.4〜3.2 m/s
 * - 滑空：揚力で重力をほとんど打ち消して、高さ 0.5〜1.5m を 20〜40m（2〜3 秒）。胸びれは広げたまま、
 *   はじめの 0.3 秒と、水に触れて跳び直すときは尾を速く振る（本物は尾の下の長い所で水をけって、また飛ぶ）
 * - 水に触れたら、40% で跳び直し（1 回だけ）、それ以外はしぶきを上げて水に入る
 * - 桟橋の近く（100m 以内）では出ない
 *
 * 模型は +Z が前、長さ 37cm（本物より少し大きく）。背は濃い青、腹は銀、胸びれは透ける青、尾びれは下が長い二又
 */

const G = 9.8;
const POOL = 14;

function makeFish(mats) {
  const g = new THREE.Group();
  // 胴：紡錘形 1 つ（長さ 30cm）。背は濃い青、腹は銀（頂点の色で塗り分け）
  const bodyGeo = new THREE.SphereGeometry(1, 16, 12);
  const pos = bodyGeo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const backC = new THREE.Color(0x1d3d7a);
  const bellyC = new THREE.Color(0xd4dbe2);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    // 後ろ（-z）ほど細く（尾の付け根）
    const z = pos.getZ(i);
    const taper = z < 0 ? 1 - 0.55 * (-z) ** 1.5 : 1;
    pos.setX(i, pos.getX(i) * taper);
    pos.setY(i, y * taper);
    c.copy(bellyC).lerp(backC, THREE.MathUtils.smoothstep(y, -0.25, 0.2));
    col.set([c.r, c.g, c.b], i * 3);
  }
  bodyGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  bodyGeo.scale(0.027, 0.029, 0.15);
  bodyGeo.computeVertexNormals();
  g.add(new THREE.Mesh(bodyGeo, mats.body));
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.0075, 6, 4), mats.eye);
  for (const side of [-1, 1]) {
    const e = eye.clone();
    e.position.set(side * 0.02, 0.006, 0.108);
    g.add(e);
  }
  // 胸びれ：翼のように大きく（片側 0.17m）、後ろへ流れる
  const finShape = new THREE.Shape();
  finShape.moveTo(0, 0.025);
  finShape.quadraticCurveTo(0.12, 0.035, 0.2, -0.05);
  finShape.quadraticCurveTo(0.11, -0.12, 0, -0.06);
  finShape.lineTo(0, 0.025);
  const finGeo = new THREE.ShapeGeometry(finShape, 6);
  finGeo.rotateX(Math.PI / 2);                // 形の y を前後（z）へ、面を水平に
  const fins = [];
  for (const side of [-1, 1]) {
    const fin = new THREE.Mesh(finGeo, mats.fin);
    fin.scale.x = side;
    fin.position.set(side * 0.02, 0.01, 0.05);
    fin.userData.side = side;
    g.add(fin);
    fins.push(fin);
  }
  // 腹びれ（小さい）
  for (const side of [-1, 1]) {
    const pelvic = new THREE.Mesh(finGeo, mats.fin);
    pelvic.scale.set(side * 0.45, 1, 0.45);
    pelvic.position.set(side * 0.015, -0.01, -0.06);
    g.add(pelvic);
  }
  // 尾びれ：二又、下が長い（縦の面）
  const tail = new THREE.Group();
  tail.position.set(0, 0, -0.14);
  g.add(tail);
  const tailShape = new THREE.Shape();
  tailShape.moveTo(0, 0);
  tailShape.lineTo(-0.07, 0.05);
  tailShape.lineTo(-0.045, 0.004);
  tailShape.lineTo(-0.1, -0.075);
  tailShape.lineTo(0, 0);
  const tailGeo = new THREE.ShapeGeometry(tailShape);
  tailGeo.rotateY(Math.PI / 2);               // 形の -x を後ろ（-z）へ、面を縦に
  tail.add(new THREE.Mesh(tailGeo, mats.fin));
  // 本物（25〜35cm）より少し大きく。船から 20m 先だと点にしか見えなかった
  g.scale.setScalar(1.25);
  g.visible = false;
  return { g, tail, fins };
}

export function createFlyingFish({ blocked = () => false, pier = null } = {}) {
  const group = new THREE.Group();
  group.name = 'flyingFish';
  const mats = {
    body: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.28, metalness: 0.35 }),
    eye: new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.2 }),
    fin: new THREE.MeshStandardMaterial({ color: 0x6f9ad0, roughness: 0.4, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }),
  };
  const rand = (a, b) => a + Math.random() * (b - a);
  const fish = [];
  for (let i = 0; i < POOL; i++) {
    const f = makeFish(mats);
    group.add(f.g);
    fish.push({ ...f, active: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, t: 0, skips: 0, flutter: 0, phase: 0 });
  }
  // しぶき：広がる輪（使い回す）
  const ringGeo = new THREE.RingGeometry(0.18, 0.28, 20);
  ringGeo.rotateX(-Math.PI / 2);
  const rings = [];
  for (let i = 0; i < 10; i++) {
    const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
    m.visible = false;
    group.add(m);
    rings.push({ m, t: 1 });
  }
  let ringNext = 0;
  function splash(x, z, size = 1) {
    const r = rings[ringNext];
    ringNext = (ringNext + 1) % rings.length;
    r.t = 0;
    r.size = size;
    r.m.position.set(x, SEA_LEVEL + 0.03, z);
    r.m.visible = true;
  }

  let nextSchool = rand(1.5, 4);
  let onLaunch = null;
  let launched = 0;

  function launch(boat, forced = false) {
    const fx = Math.sin(boat.yaw);
    const fz = Math.cos(boat.yaw);
    const rx = Math.cos(boat.yaw);
    const rz = -Math.sin(boat.yaw);
    const side = Math.random() < 0.5 ? -1 : 1;
    const ahead = rand(10, 30);
    const off = rand(4, 16) * side;
    const cx = boat.x + fx * ahead + rx * off;
    const cz = boat.z + fz * ahead + rz * off;
    if (!forced && blocked(cx, cz)) return 0;
    // 船から離れる向き：前へ、少し外へ
    const heading = boat.yaw + side * rand(0.2, 0.9);
    const n = 1 + Math.floor(Math.random() * 4);
    let count = 0;
    for (const f of fish) {
      if (count >= n) break;
      if (f.active) continue;
      const h = heading + rand(-0.15, 0.15);
      const sp = rand(12, 16);
      f.x = cx + rand(-1.5, 1.5);
      f.z = cz + rand(-1.5, 1.5);
      f.y = SEA_LEVEL - 0.05;
      f.vx = Math.sin(h) * sp;
      f.vz = Math.cos(h) * sp;
      f.vy = rand(2.4, 3.2);
      f.t = -count * rand(0.1, 0.25);     // 少しずつずれて飛び出す
      f.skips = 0;
      f.flutter = 0.3;
      f.active = true;
      f.g.visible = false;
      count++;
    }
    if (count) { launched += count; onLaunch?.(cx, cz, count); }
    return count;
  }

  /**
   * @param {number} dt
   * @param {{ x, z, yaw, speed } | null} boat 乗っている船（無ければ飛ばない。飛んでいるものは最後まで飛ぶ）
   */
  function update(dt, boat = null) {
    dt = Math.min(dt, 0.05);
    const offshore = boat && (!pier || Math.hypot(boat.x - pier.x, boat.z - pier.z) > 100);
    if (boat && offshore && Math.abs(boat.speed) > 3) {
      nextSchool -= dt;
      if (nextSchool <= 0) { nextSchool = rand(2, 7); launch(boat); }
    }
    for (const f of fish) {
      if (!f.active) continue;
      f.t += dt;
      if (f.t < 0) continue;
      if (!f.g.visible) { f.g.visible = true; splash(f.x, f.z, 0.7); }
      // 揚力：速いほど重力を打ち消す（滑空）。水平はゆっくり遅くなる
      const sp = Math.hypot(f.vx, f.vz);
      const lift = Math.min(0.92, (sp / 14) ** 2 * 0.92);
      f.vy += (-G + G * lift) * dt;
      f.vy *= 1 - 0.8 * dt;
      const slow = 1 - 0.12 * dt;
      f.vx *= slow;
      f.vz *= slow;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.z += f.vz * dt;
      f.flutter = Math.max(0, f.flutter - dt);
      // 水に触れた
      if (f.y <= SEA_LEVEL + 0.02 && f.vy < 0 && f.t > 0.5) {
        if (f.skips === 0 && sp > 9 && Math.random() < 0.4) {
          f.skips = 1;
          f.vy = rand(2.2, 3);
          f.flutter = 0.35;
          splash(f.x, f.z, 0.5);
        } else {
          splash(f.x, f.z, 1);
          f.active = false;
          f.g.visible = false;
          continue;
        }
      }
      // 向き：進む向きへ、少し上下（上がるときは頭が上）
      const yaw = Math.atan2(f.vx, f.vz);
      const pitch = -Math.atan2(f.vy, sp) * 0.7;
      f.g.position.set(f.x, Math.max(SEA_LEVEL - 0.05, f.y), f.z);
      f.g.rotation.set(pitch, yaw, Math.sin(f.t * 3 + f.x) * 0.08, 'YXZ');
      // 尾：飛び出す・跳び直すときは速く振る。滑空中はまっすぐ
      f.phase += dt * 60;
      f.tail.rotation.y = f.flutter > 0 ? Math.sin(f.phase) * 0.6 : 0;
      // 胸びれ：広げたまま、少しだけ震える
      // 胸びれ：広げたまま、少し上へ反らせて（横からも見える）、わずかに震える
      for (const fin of f.fins) fin.rotation.z = fin.userData.side * (0.22 + Math.sin(f.phase * 0.5) * 0.04);
    }
    for (const r of rings) {
      if (r.t >= 1) continue;
      r.t = Math.min(1, r.t + dt / 0.9);
      const k = 1 + r.t * 3 * r.size;
      r.m.scale.set(k, 1, k);
      r.m.material.opacity = (1 - r.t) * 0.8;
      if (r.t >= 1) r.m.visible = false;
    }
  }

  return {
    group,
    update,
    /** 飛び出したとき（x, z, 数）。女の子が声をあげる */
    set onLaunch(fn) { onLaunch = fn; },
    get flying() { return fish.filter((f) => f.active && f.t >= 0).length; },
    get launched() { return launched; },
    get list() { return fish; },
    /** 検証用：いますぐ船の前に群れを飛ばす（浅瀬でも） */
    debugLaunch(boat) { return launch(boat, true); },
  };
}
