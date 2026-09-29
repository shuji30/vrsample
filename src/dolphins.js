import * as THREE from 'three';
import { SEA_LEVEL } from './hill.js';
import { routeCurve, PIER } from './cruiser.js';
import { createSpine } from './spine.js';

/**
 * 海のイルカの群れ（4 頭）。クルーザーで周遊していると会える。
 *
 * - ふだんは、周遊の道（cruiser.js の routeCurve。船体の四隅が浅瀬にかからない深い所を通る）に沿って、
 *   ゆっくり（4m/s）群れで泳ぐ。ときどき水面に背を出して息をする（背びれが見える）
 * - ときどき水から跳び上がる（5〜14 秒ごと。高さ 1.6〜2.6m、8〜12m 先へ。となりの 1 頭がつられて跳ぶこともある）。
 *   体は弧に沿って向きを変え（頭を上げて出て、頭から入る）、背を弓なりに丸める。跳び出す所と落ちる所に、しぶき
 * - 群れがいるのは、桟橋から 160m より遠い沖（島巡りの道の遠い所）だけ。道が桟橋へ近づく所は、次の沖まで飛ばす
 *   （そのときは 1 頭ずつも持ち場へ移す。桟橋の近くでは見えない）
 * - 船（クルーザー・ジェットスキー）が 90m 以内で走っていると、寄ってきて船の横に並んで泳ぐ（跳ぶのも 3〜8 秒ごとに）。
 *   並ぶのは、船が桟橋から 140m より遠いときだけ。船が桟橋の 120m 以内へ戻ってきたら、沖へ帰る
 *   船が 10 秒止まっている・離れすぎると、周遊の道へ戻る
 * - 浅瀬・岩場・島・桟橋・橋脚（blocked）へは入らない（手前で向きを変える）
 *
 * 体は鼻先から尾まで断面を変えて作る（口先・おでこ・太い胴・細い尾の付け根。背は濃く腹は白い）。
 * 背びれ・胸びれ・尾びれを付ける（長さ 2.5m）。前は +Z。
 * 体は 1 本の背骨に沿って毎フレーム曲げる（spine.js）：泳ぐときは尾へ向かって大きくなる波が頭から尾へ伝わり、
 * 跳ぶ・息をするときは背を丸める。以前は尾の付け根の 1 か所だけで硬い尾を振っていて、尾がまっすぐすぎた
 */
const G = 9.8;
const LENGTH = 2.5;
const SLOTS = [[0, 0], [-4.5, -3], [-4, 3.2], [-9, 0.5], [-12, -3.5]];

// 体の形（鼻先 t=0 → 尾の付け根 t=1）。上・下の半径、横の半幅、中心の高さ（m）。
// 口先（くちばし）は細く低く、そのすぐ後ろでおでこ（メロン）が段になって盛り上がり、胴の前 1/3 がいちばん太く、
// 尾の付け根は細く縦長（横につぶれる）になる
const PROFILE = {
  t:     [0,     0.03,  0.07,  0.10,  0.14,  0.22, 0.34, 0.48, 0.62, 0.76, 0.88,  0.96,  1.0],
  top:   [0.028, 0.048, 0.058, 0.125, 0.205, 0.27, 0.30, 0.28, 0.22, 0.14, 0.085, 0.06,  0.045],
  bot:   [0.028, 0.044, 0.052, 0.085, 0.15,  0.22, 0.27, 0.26, 0.19, 0.10, 0.06,  0.045, 0.035],
  halfW: [0.028, 0.048, 0.056, 0.11,  0.17,  0.23, 0.26, 0.24, 0.17, 0.085, 0.045, 0.03, 0.025],
  cy:    [-0.085, -0.085, -0.075, -0.045, -0.015, 0, 0, 0, 0.01, 0.02, 0.025, 0.025, 0.025],
};
// 背骨の曲げ：体を輪切り RINGS 本で作り、毎フレーム背骨に沿って曲げる（上下の曲げ。横は曲げない）
const RINGS = 44;
const SEG = 22;
const BEND_CENTER = 0.42;   // 曲げの中心（胴のいちばん太い所の少し後ろ）。ここは動かない
const BACK_COLOR = new THREE.Color(0x55697c);
const CAPE_COLOR = new THREE.Color(0x44576a);
const BELLY_COLOR = new THREE.Color(0xe2e6ea);

function profileAt(key, t) {
  const T = PROFILE.t;
  const v = PROFILE[key];
  let k = 1;
  while (k < T.length - 1 && T[k] < t) k++;
  const u = THREE.MathUtils.clamp((t - T[k - 1]) / (T[k] - T[k - 1]), 0, 1);
  const e = u * u * (3 - 2 * u);
  return v[k - 1] + (v[k] - v[k - 1]) * e;
}

/**
 * 体（鼻先 t=0 → 尾の付け根 t=1）を 1 つの形で。背は濃く、腹は白く（頂点の色）。
 * 曲げるために、頂点ごとに何本目の輪か（ringOf）を持つ。位置の y は背骨（y=0）からの高さ
 */
function bodyGeometry() {
  const pos = [];
  const col = [];
  const idx = [];
  const ringOf = [];
  const c = new THREE.Color();
  for (let r = 0; r <= RINGS; r++) {
    const t = r / RINGS;
    const top = profileAt('top', t);
    const bot = profileAt('bot', t);
    const hw = profileAt('halfW', t);
    const cy = profileAt('cy', t);
    const z = LENGTH / 2 - t * LENGTH;
    for (let k = 0; k <= SEG; k++) {
      const a = (k / SEG) * Math.PI * 2;
      const sa = Math.sin(a);
      pos.push(Math.cos(a) * hw, cy + sa * (sa > 0 ? top : bot), z);
      ringOf.push(r);
      // 背と腹の境目は、わき腹の少し下。背のまん中はもう一段濃く（ケープ）
      const m = THREE.MathUtils.smoothstep(sa, -0.45, 0.05);
      c.copy(BELLY_COLOR).lerp(BACK_COLOR, m);
      if (sa > 0.75) c.lerp(CAPE_COLOR, (sa - 0.75) * 3);
      col.push(c.r, c.g, c.b);
    }
  }
  const row = SEG + 1;
  for (let r = 0; r < RINGS; r++) {
    for (let k = 0; k < SEG; k++) {
      const a = r * row + k;
      const b = a + row;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  // 両端をふさぐ（鼻先と尾の先）
  const cap = (r, flip) => {
    const t = r / RINGS;
    const center = pos.length / 3;
    pos.push(0, profileAt('cy', t), LENGTH / 2 - t * LENGTH);
    ringOf.push(r);
    const base = r * row;
    col.push(col[base * 3], col[base * 3 + 1], col[base * 3 + 2]);
    for (let k = 0; k < SEG; k++) {
      if (flip) idx.push(center, base + k + 1, base + k);
      else idx.push(center, base + k, base + k + 1);
    }
  };
  cap(0, true);
  cap(RINGS, false);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return { geometry: g, ringOf: Int16Array.from(ringOf) };
}

function finGeometry(points, depth) {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i += 2) shape.quadraticCurveTo(points[i][0], points[i][1], points[i + 1][0], points[i + 1][1]);
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: depth * 0.4, bevelSize: depth * 0.5, bevelSegments: 2, curveSegments: 10 });
  g.translate(0, 0, -depth / 2);
  return g;
}

function makeDolphin() {
  const g = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.05 });
  const fins = new THREE.MeshStandardMaterial({ color: BACK_COLOR, roughness: 0.35, metalness: 0.05 });
  const shade = (m) => { m.castShadow = true; return m; };
  const { geometry, ringOf } = bodyGeometry();
  g.add(shade(new THREE.Mesh(geometry, skin)));
  // ひれ・目は、背骨の t の所に付けた台（anchor）に載せる。台は背骨といっしょに動いて傾く
  const spine = createSpine(geometry, ringOf, { rings: RINGS, length: LENGTH, center: BEND_CENTER });
  const anchor = (t, gain) => { const a = spine.anchor(t, gain); g.add(a); return a; };
  // 目（おでこの下、口の端の少し後ろ）
  const head = anchor(0.125);
  for (const side of [-1, 1]) {
    const t = 0.125;
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), new THREE.MeshStandardMaterial({ color: 0x0c0f12, roughness: 0.15 }));
    eye.position.set(side * profileAt('halfW', t) * 0.93, profileAt('cy', t) - 0.01, 0);
    head.add(eye);
  }
  // 背びれ：後ろへ反った鎌の形（胴のまん中より少し後ろ）
  const dorsal = shade(new THREE.Mesh(finGeometry([[0.2, 0], [0.02, 0.12], [-0.12, 0.34], [-0.1, 0.16], [-0.2, 0.0], [0, -0.03], [0.2, 0]], 0.035), fins));
  dorsal.rotation.y = -Math.PI / 2;      // 形の +X を体の +Z（前）へ
  dorsal.position.set(0, profileAt('cy', 0.46) + profileAt('top', 0.46) - 0.03, 0);
  anchor(0.46).add(dorsal);
  // 胸びれ：葉の形。体のわきの低い所から、後ろ・下・少し外へ（先の向きを setFromUnitVectors で決める）
  const pecGeo = finGeometry([[0, 0.05], [0.18, 0.06], [0.3, -0.04], [0.14, -0.04], [0, -0.04], [-0.02, 0], [0, 0.05]], 0.02);
  const chest = anchor(0.25);
  for (const side of [-1, 1]) {
    const pec = shade(new THREE.Mesh(pecGeo, fins));
    pec.position.set(side * profileAt('halfW', 0.25) * 0.8, profileAt('cy', 0.25) - profileAt('bot', 0.25) * 0.6, 0);
    const dir = new THREE.Vector3(side * 0.55, -0.55, -0.62).normalize();
    pec.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
    // 平らな面を、体の外へ向ける（先の向きのまわりに回す）
    pec.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), side * 1.1));
    chest.add(pec);
  }
  // 尾びれ：切れ込みのある三日月（幅 0.64m）。平らな面を水平に。尾の先の台に載せて、背骨の曲げより少し強く反らせる
  const flukeBase = anchor(1, 1.35);
  const fluke = shade(new THREE.Mesh(finGeometry([[0, 0.03], [0.14, 0.02], [0.32, -0.2], [0.18, -0.14], [0.05, -0.12], [0, -0.08], [0, -0.08]], 0.03), fins));
  const flukeL = fluke.clone();
  flukeL.scale.x = -1;
  for (const f of [fluke, flukeL]) {
    f.rotation.x = Math.PI / 2;          // 形の -Y を体の後ろ（-Z）へ
    f.position.set(0, profileAt('cy', 1), 0.04);
    flukeBase.add(f);
  }

  spine.bend(0, 0, 0);
  return { group: g, bend: spine.bend };
}

/** しぶき：広がる輪と、飛び散る水玉（まとめて使い回す） */
function makeSplashes(group) {
  const ringGeo = new THREE.RingGeometry(0.55, 0.8, 28);
  ringGeo.rotateX(-Math.PI / 2);
  const rings = [];
  for (let i = 0; i < 8; i++) {
    const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
    m.visible = false;
    group.add(m);
    rings.push({ m, t: 1 });
  }
  const DROPS = 160;
  const pos = new Float32Array(DROPS * 3);
  const vel = new Float32Array(DROPS * 3);
  const life = new Float32Array(DROPS);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  // 水玉は丸く（そのままだと四角い点になる）
  const dot = document.createElement('canvas');
  dot.width = dot.height = 32;
  const dc = dot.getContext('2d');
  const grad = dc.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.8)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  dc.fillStyle = grad;
  dc.fillRect(0, 0, 32, 32);
  const dotTex = new THREE.CanvasTexture(dot);
  const points = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xf2f8ff, size: 0.2, map: dotTex, transparent: true, opacity: 0.9, depthWrite: false }));
  points.frustumCulled = false;
  group.add(points);
  let next = 0;
  let ring = 0;
  for (let i = 0; i < DROPS; i++) pos[i * 3 + 1] = -1000;
  function burst(x, z, strength = 1) {
    const r = rings[ring];
    ring = (ring + 1) % rings.length;
    r.t = 0;
    r.m.position.set(x, SEA_LEVEL + 0.04, z);
    r.m.visible = true;
    r.strength = strength;
    for (let k = 0; k < 22; k++) {
      const i = next;
      next = (next + 1) % DROPS;
      const a = Math.random() * Math.PI * 2;
      const h = (0.6 + Math.random() * 2.2) * strength;
      pos[i * 3] = x + Math.cos(a) * 0.3;
      pos[i * 3 + 1] = SEA_LEVEL + 0.05;
      pos[i * 3 + 2] = z + Math.sin(a) * 0.3;
      vel[i * 3] = Math.cos(a) * h * 0.6;
      vel[i * 3 + 1] = 2.5 + Math.random() * 3.5 * strength;
      vel[i * 3 + 2] = Math.sin(a) * h * 0.6;
      life[i] = 1.4;
    }
  }
  function update(dt) {
    for (const r of rings) {
      if (!r.m.visible) continue;
      r.t += dt / 1.3;
      const s = (1 + r.t * 4.5) * (r.strength ?? 1);
      r.m.scale.set(s, 1, s);
      r.m.material.opacity = Math.max(0, 0.75 * (1 - r.t));
      if (r.t >= 1) r.m.visible = false;
    }
    for (let i = 0; i < DROPS; i++) {
      if (life[i] <= 0) continue;
      life[i] -= dt;
      vel[i * 3 + 1] -= G * dt;
      pos[i * 3] += vel[i * 3] * dt;
      pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
      pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      if (pos[i * 3 + 1] < SEA_LEVEL || life[i] <= 0) { life[i] = 0; pos[i * 3 + 1] = -1000; }
    }
    geo.attributes.position.needsUpdate = true;
  }
  return { burst, update };
}

/**
 * @param {{ count?: number, blocked?: (x: number, z: number) => boolean }} options
 */
export function createDolphins({ count = 4, blocked = () => false } = {}) {
  const group = new THREE.Group();
  group.name = 'dolphins';
  const splashes = makeSplashes(group);
  const route = routeCurve();
  const ROUTE_N = 900;
  const routePts = route.getSpacedPoints(ROUTE_N);
  const routeLen = route.getLength();
  const rand = (a, b) => a + Math.random() * (b - a);

  // 群れの中心（周遊の道の上）。灯台の南あたりから
  let u = 0.3;
  const pod = { x: 0, z: 0, yaw: 0, speed: 4 };
  const routeAt = (uu, out = pod) => {
    const k = (((uu % 1) + 1) % 1) * ROUTE_N;
    const i = Math.floor(k) % ROUTE_N;
    const a = routePts[i];
    const b = routePts[(i + 1) % ROUTE_N];
    out.x = a.x + (b.x - a.x) * (k - Math.floor(k));
    out.z = a.z + (b.z - a.z) * (k - Math.floor(k));
    out.yaw = Math.atan2(b.x - a.x, b.z - a.z);
    return out;
  };
  // 桟橋からの距離。沖（160m より遠い）の所だけ、群れが泳ぐ
  const pierDist = (x, z) => Math.hypot(x - PIER.x, z - PIER.headZ);
  const offshore = routePts.map((p) => pierDist(p.x, p.z) > 160);
  const idxOf = (uu) => Math.floor((((uu % 1) + 1) % 1) * ROUTE_N) % ROUTE_N;
  /** uu から先へ、次の沖の所（uu が沖ならそのまま） */
  const nextOffshore = (uu) => {
    let i = idxOf(uu);
    for (let k = 0; k < ROUTE_N && !offshore[i]; k++) i = (i + 1) % ROUTE_N;
    return offshore[idxOf(uu)] ? uu : i / ROUTE_N;
  };
  u = nextOffshore(u);
  routeAt(u);
  let mode = 'route';       // route（周遊の道） / boat（船の横）
  let boatSide = 1;
  let boatStill = 0;
  let joinCool = 0;

  const list = [];
  for (let i = 0; i < count; i++) {
    const { group: g, bend } = makeDolphin();
    group.add(g);
    const [along, side] = SLOTS[i % SLOTS.length];
    const d = {
      g, bend, along, side, arch: 0, amp: 0.42,
      x: pod.x + Math.sin(pod.yaw) * along + Math.cos(pod.yaw) * side,
      z: pod.z + Math.cos(pod.yaw) * along - Math.sin(pod.yaw) * side,
      yaw: pod.yaw, speed: 4, yawRate: 0,
      phase: Math.random() * 6, y: SEA_LEVEL - 0.5, pitch: 0,
      jump: null, nextJump: rand(3, 12), breath: rand(0, 4), breathT: -1,
      wobble: rand(0, 6),
    };
    list.push(d);
  }

  /** 1 頭ずつを、いまの群れの持ち場へ（水の中に） */
  function placeAll() {
    for (const d of list) {
      d.x = pod.x + Math.sin(pod.yaw) * d.along + Math.cos(pod.yaw) * d.side;
      d.z = pod.z + Math.cos(pod.yaw) * d.along - Math.sin(pod.yaw) * d.side;
      d.yaw = pod.yaw;
      d.jump = null;
      d.y = SEA_LEVEL - 0.55;
    }
  }

  let onJump = null;
  let lastJump = null;
  const nearestRouteU = (x, z) => {
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < ROUTE_N; i += 3) { const p = routePts[i]; const dd = (p.x - x) ** 2 + (p.z - z) ** 2; if (dd < bd) { bd = dd; best = i; } }
    return best / ROUTE_N;
  };

  /**
   * 跳ぶ：前へ 7〜8.5 m/s、上へ 5.6〜7.2 m/s（高さ 1.6〜2.6m、8〜12m 先へ落ちる）。体は弧に沿って向きを変える
   * （頭を上げて出て、頭から入る）。落ちる所が浅瀬・岩場なら跳ばない（false）
   */
  function startJump(d, strength = 1) {
    const vy = rand(5.6, 7.2) * strength;
    const vx = Math.max(d.speed, rand(7, 8.5));
    const dur = (2 * vy) / G;
    if (blocked(d.x + Math.sin(d.yaw) * vx * dur, d.z + Math.cos(d.yaw) * vx * dur)) return false;
    d.jump = { t: 0, vy, vx, dur };
    d.speed = vx;
    d.y = SEA_LEVEL;
    splashes.burst(d.x, d.z, 0.8);
    lastJump = { x: d.x, z: d.z, time: performance.now() };
    onJump?.(d.x, d.z);
    return true;
  }

  /**
   * @param {number} dt
   * @param {{ x: number, z: number, yaw: number, speed: number } | null} boat 走っている船（クルーザー・ジェットスキー）。無ければ null
   */
  function update(dt, boat = null) {
    dt = Math.min(dt, 0.05);
    joinCool -= dt;
    // --- 群れの中心 -------------------------------------------------------------
    if (mode === 'route') {
      u = (u + (4 / routeLen) * dt) % 1;
      // 桟橋に近い所へ入ったら、次の沖まで飛ばす（1 頭ずつも持ち場へ移す）
      if (!offshore[idxOf(u)]) { u = nextOffshore(u); routeAt(u); placeAll(); }
      routeAt(u);
      pod.speed = 4;
      if (boat && joinCool < 0 && Math.abs(boat.speed) > 2 && pierDist(boat.x, boat.z) > 140 && Math.hypot(boat.x - pod.x, boat.z - pod.z) < 90) {
        mode = 'boat';
        boatStill = 0;
        // 船のどちら側に並ぶか：いまいる側
        const rx = Math.cos(boat.yaw);
        const rz = -Math.sin(boat.yaw);
        boatSide = (pod.x - boat.x) * rx + (pod.z - boat.z) * rz > 0 ? 1 : -1;
      }
    } else {
      if (!boat) { mode = 'route'; u = nextOffshore(nearestRouteU(pod.x, pod.z)); joinCool = 20; }
      else {
        boatStill = Math.abs(boat.speed) < 1 ? boatStill + dt : 0;
        const far = Math.hypot(boat.x - pod.x, boat.z - pod.z) > 160;
        const home = pierDist(boat.x, boat.z) < 120;     // 桟橋へ帰ってきた：沖へ帰る
        if (boatStill > 10 || far || home) { mode = 'route'; u = nextOffshore(nearestRouteU(pod.x, pod.z)); joinCool = home ? 60 : 30; }
        else {
          // 船の少し前・横（右 +X 側は boatSide = 1）に並ぶ。そこが浅瀬なら反対側へ
          const fx = Math.sin(boat.yaw);
          const fz = Math.cos(boat.yaw);
          const rx = Math.cos(boat.yaw);
          const rz = -Math.sin(boat.yaw);
          const at = (side) => [boat.x + fx * 6 + rx * 8 * side, boat.z + fz * 6 + rz * 8 * side];
          let [tx, tz] = at(boatSide);
          if (blocked(tx, tz)) { boatSide = -boatSide; [tx, tz] = at(boatSide); }
          pod.x = tx;
          pod.z = tz;
          pod.yaw = boat.yaw;
          pod.speed = Math.max(2.5, Math.abs(boat.speed));
        }
      }
    }
    // --- 1 頭ずつ -----------------------------------------------------------------
    const s = Math.sin(pod.yaw);
    const c = Math.cos(pod.yaw);
    for (const d of list) {
      // 体の曲げの目標：ふだんは弓なりなし、尾の波は速いほど少し大きく
      let archWant = 0;
      let ampWant = THREE.MathUtils.clamp(0.3 + d.speed * 0.025, 0.3, 0.5);
      d.wobble += dt * 0.4;
      const along = d.along + Math.sin(d.wobble) * 1.2;
      const side = d.side + Math.cos(d.wobble * 1.3) * 0.8;
      const slotX = pod.x + s * along + c * side;
      const slotZ = pod.z + c * along - s * side;
      // 持ち場の少し先へ向かう
      const aimX = slotX + s * 6;
      const aimZ = slotZ + c * 6;
      let want = Math.atan2(aimX - d.x, aimZ - d.z);
      const behind = (slotX - d.x) * s + (slotZ - d.z) * c;   // 持ち場より後ろなら +
      let speed = THREE.MathUtils.clamp(pod.speed + behind * 0.6, 1.2, 17);
      // 浅瀬の手前で向きを変える
      const lookX = d.x + Math.sin(d.yaw) * 5;
      const lookZ = d.z + Math.cos(d.yaw) * 5;
      if (!d.jump && blocked(lookX, lookZ)) { want = d.yaw + 1.2; speed = Math.min(speed, 2); }
      const turn = Math.atan2(Math.sin(want - d.yaw), Math.cos(want - d.yaw));
      const rate = THREE.MathUtils.clamp(turn * 1.6, -1.1, 1.1);
      if (!d.jump) {
        d.yawRate += (rate - d.yawRate) * Math.min(1, dt * 4);
        d.yaw += d.yawRate * dt;
        d.speed += (speed - d.speed) * Math.min(1, dt * 1.5);
      }
      const nx = d.x + Math.sin(d.yaw) * d.speed * dt;
      const nz = d.z + Math.cos(d.yaw) * d.speed * dt;
      if (d.jump || !blocked(nx, nz)) { d.x = nx; d.z = nz; }
      // 上下：跳ぶ / 息をする（背を出す） / ふだんは水面のすぐ下
      if (d.jump) {
        const j = d.jump;
        j.t += dt;
        const vy = j.vy - G * j.t;
        d.y = SEA_LEVEL + j.vy * j.t - 0.5 * G * j.t * j.t;
        d.pitch = -Math.atan2(vy, j.vx);
        // 弓なり：弧（放物線）の曲がり具合 G·vx / v³ に合わせて背を丸める（見えるように 1.8 倍）。頂上でいちばん丸い
        const v = Math.hypot(j.vx, vy);
        archWant = THREE.MathUtils.clamp((G * j.vx) / (v * v * v) * LENGTH * 1.8, 0, 0.8);
        // 尾は、水を蹴って出た直後だけ強く振り、空中ではほとんど止める
        ampWant = j.t < 0.2 ? 0.5 : 0.06;
        if (j.t >= j.dur) {
          d.jump = null;
          d.y = SEA_LEVEL - 0.3;
          splashes.burst(d.x, d.z, 1.1);
          d.nextJump = mode === 'boat' ? rand(3, 8) : rand(5, 14);
        }
      } else {
        d.nextJump -= dt;
        if (d.nextJump <= 0 && !startJump(d)) d.nextJump = rand(1, 3);
        if (d.jump) {
          // となりの 1 頭がつられて跳ぶ
          if (Math.random() < 0.45) {
            const buddy = list.find((o) => o !== d && !o.jump && Math.hypot(o.x - d.x, o.z - d.z) < 7);
            if (buddy) buddy.nextJump = 0.35;
          }
          continue;
        }
        d.breath -= dt;
        if (d.breath <= 0 && d.breathT < 0) { d.breathT = 0; d.breath = rand(3, 6); }
        let lift = 0;
        let dlift = 0;
        if (d.breathT >= 0) {
          d.breathT += dt / 1.3;
          lift = Math.sin(Math.PI * d.breathT) * 0.75;
          // 息をするときも、背を丸めて水面を転がるように（頭が出て、背びれ、尾の順に）
          archWant = Math.sin(Math.PI * d.breathT) * 0.3;
          dlift = Math.cos(Math.PI * d.breathT) * 0.75 * Math.PI / 1.3;
          if (d.breathT >= 1) d.breathT = -1;
        }
        d.y = SEA_LEVEL - 0.55 + lift;
        d.pitch += (-Math.atan2(dlift, Math.max(1.5, d.speed)) - d.pitch) * Math.min(1, dt * 6);
      }
      d.phase += dt * (2.6 + d.speed * 0.45);
      d.arch += (archWant - d.arch) * Math.min(1, dt * 8);
      d.amp += (ampWant - d.amp) * Math.min(1, dt * 6);
      d.bend(d.arch, d.amp, d.phase);
      d.g.position.set(d.x, d.y, d.z);
      d.g.rotation.set(d.pitch + Math.sin(d.phase) * 0.03, d.yaw, -d.yawRate * 0.35, 'YXZ');
    }
    splashes.update(dt);
  }

  return {
    group,
    update,
    /** 跳んだとき（x, z）。女の子が声をあげる・見る（cruisergame.js） */
    set onJump(fn) { onJump = fn; },
    /** 群れの中心 */
    get center() { return { x: pod.x, z: pod.z }; },
    /** 船の横で泳いでいるか */
    get withBoat() { return mode === 'boat'; },
    /** (x, z) からいちばん近いイルカまでの距離と、その位置（女の子の目の向け先） */
    nearest(x, z, out = new THREE.Vector3()) {
      let best = null;
      let bd = Infinity;
      for (const d of list) { const dd = Math.hypot(d.x - x, d.z - z); if (dd < bd) { bd = dd; best = d; } }
      if (best) out.set(best.x, Math.max(best.y, SEA_LEVEL), best.z);
      return { distance: bd, point: out };
    },
    get lastJump() { return lastJump; },
    get list() { return list; },
    /** 検証用：群れを (x, z) へ移す */
    debugPlace(x, z) {
      u = nearestRouteU(x, z);
      routeAt(u);
      for (const d of list) {
        d.x = pod.x + Math.sin(pod.yaw) * d.along + Math.cos(pod.yaw) * d.side;
        d.z = pod.z + Math.cos(pod.yaw) * d.along - Math.sin(pod.yaw) * d.side;
        d.yaw = pod.yaw;
      }
    },
    /** 検証用：いますぐ i 番目を跳ばせる */
    debugJump(i = 0) { const d = list[i]; return !!(d && !d.jump && startJump(d)); },
  };
}
