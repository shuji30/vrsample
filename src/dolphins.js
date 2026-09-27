import * as THREE from 'three';
import { SEA_LEVEL } from './hill.js';
import { routeCurve } from './cruiser.js';

/**
 * 海のイルカの群れ（4 頭）。クルーザーで周遊していると会える。
 *
 * - ふだんは、周遊の道（cruiser.js の routeCurve。船体の四隅が浅瀬にかからない深い所を通る）に沿って、
 *   ゆっくり（4m/s）群れで泳ぐ。ときどき水面に背を出して息をする（背びれが見える）
 * - ときどき水から跳び上がる（5〜14 秒ごと。高さ 2〜3.5m。となりの 1 頭がつられて跳ぶこともある）。
 *   跳び出す所と落ちる所に、しぶきの輪と水しぶき
 * - 船（クルーザー・ジェットスキー）が 90m 以内で走っていると、寄ってきて船の横に並んで泳ぐ（跳ぶのも 3〜8 秒ごとに）。
 *   船が 10 秒止まっている・離れすぎると、周遊の道へ戻る
 * - 浅瀬・岩場・島・桟橋・橋脚（blocked）へは入らない（手前で向きを変える）
 *
 * 体は胴・腹・口先・背びれ・胸びれ・尾びれを組み合わせる（長さ 2.5m）。前は +Z
 */
const G = 9.8;
const LENGTH = 2.5;
const SLOTS = [[0, 0], [-4.5, -3], [-4, 3.2], [-9, 0.5], [-12, -3.5]];

function makeDolphin() {
  const g = new THREE.Group();
  const back = new THREE.MeshStandardMaterial({ color: 0x66788a, roughness: 0.35, metalness: 0.05 });
  const belly = new THREE.MeshStandardMaterial({ color: 0xd9dee3, roughness: 0.45 });
  const shade = (m) => { m.castShadow = true; return m; };
  const body = shade(new THREE.Mesh(new THREE.SphereGeometry(0.5, 18, 12), back));
  body.scale.set(0.74, 0.7, LENGTH);
  g.add(body);
  const under = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 10), belly);
  under.scale.set(0.64, 0.5, LENGTH * 0.88);
  under.position.set(0, -0.08, 0.05);
  g.add(under);
  // 口先（くちばし）とおでこ
  const beak = shade(new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.38, 10), back));
  beak.rotation.x = Math.PI / 2;
  beak.position.set(0, -0.05, LENGTH / 2 + 0.1);
  g.add(beak);
  const melon = shade(new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8), back));
  melon.scale.set(1, 0.9, 1.3);
  melon.position.set(0, 0.04, LENGTH / 2 - 0.2);
  g.add(melon);
  // 目
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), new THREE.MeshStandardMaterial({ color: 0x111418, roughness: 0.2 }));
    eye.position.set(side * 0.2, 0.02, LENGTH / 2 - 0.3);
    g.add(eye);
  }
  // 背びれ（後ろへ反った三角）
  const fin = new THREE.Shape();
  fin.moveTo(0.18, 0);
  fin.quadraticCurveTo(-0.02, 0.2, -0.2, 0.42);
  fin.quadraticCurveTo(-0.16, 0.18, -0.3, 0);
  fin.lineTo(0.18, 0);
  const finGeo = new THREE.ExtrudeGeometry(fin, { depth: 0.04, bevelEnabled: false });
  finGeo.translate(0, 0, -0.02);
  const dorsal = shade(new THREE.Mesh(finGeo, back));
  dorsal.rotation.y = -Math.PI / 2;     // 形の +X を体の +Z（前）へ
  dorsal.position.set(0, 0.28, -0.1);
  g.add(dorsal);
  // 胸びれ
  for (const side of [-1, 1]) {
    const pec = shade(new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.025, 0.14), back));
    pec.position.set(side * 0.28, -0.14, 0.45);
    pec.rotation.set(0, side * 0.5, side * -0.5);
    g.add(pec);
  }
  // 尾（付け根で上下に振る）と尾びれ
  const tail = new THREE.Group();
  tail.position.set(0, 0, -LENGTH / 2 + 0.25);
  g.add(tail);
  const stock = shade(new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 8), back));
  stock.scale.set(0.24, 0.26, 0.7);
  stock.position.z = -0.25;
  tail.add(stock);
  const fluke = new THREE.Shape();
  fluke.moveTo(0, 0.02);
  fluke.quadraticCurveTo(0.3, 0.02, 0.46, -0.24);
  fluke.quadraticCurveTo(0.22, -0.16, 0, -0.1);
  fluke.quadraticCurveTo(-0.22, -0.16, -0.46, -0.24);
  fluke.quadraticCurveTo(-0.3, 0.02, 0, 0.02);
  const flukeGeo = new THREE.ExtrudeGeometry(fluke, { depth: 0.03, bevelEnabled: false });
  const flukes = shade(new THREE.Mesh(flukeGeo, back));
  flukes.rotation.x = Math.PI / 2;      // 形の -Y を体の後ろ（-Z）へ、平らな面を水平に
  flukes.position.set(0, 0.015, -0.52);
  tail.add(flukes);
  return { group: g, tail };
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
  routeAt(u);
  let mode = 'route';       // route（周遊の道） / boat（船の横）
  let boatSide = 1;
  let boatStill = 0;
  let joinCool = 0;

  const list = [];
  for (let i = 0; i < count; i++) {
    const { group: g, tail } = makeDolphin();
    group.add(g);
    const [along, side] = SLOTS[i % SLOTS.length];
    const d = {
      g, tail, along, side,
      x: pod.x + Math.sin(pod.yaw) * along + Math.cos(pod.yaw) * side,
      z: pod.z + Math.cos(pod.yaw) * along - Math.sin(pod.yaw) * side,
      yaw: pod.yaw, speed: 4, yawRate: 0,
      phase: Math.random() * 6, y: SEA_LEVEL - 0.5, pitch: 0,
      jump: null, nextJump: rand(3, 12), breath: rand(0, 4), breathT: -1,
      wobble: rand(0, 6),
    };
    list.push(d);
  }

  let onJump = null;
  let lastJump = null;
  const nearestRouteU = (x, z) => {
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < ROUTE_N; i += 3) { const p = routePts[i]; const dd = (p.x - x) ** 2 + (p.z - z) ** 2; if (dd < bd) { bd = dd; best = i; } }
    return best / ROUTE_N;
  };

  function startJump(d, strength = 1) {
    const vy = rand(6.2, 8.2) * strength;
    d.jump = { t: 0, vy, dur: (2 * vy) / G };
    d.y = SEA_LEVEL;
    splashes.burst(d.x, d.z, 0.8);
    lastJump = { x: d.x, z: d.z, time: performance.now() };
    onJump?.(d.x, d.z);
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
      routeAt(u);
      pod.speed = 4;
      if (boat && joinCool < 0 && Math.abs(boat.speed) > 2 && Math.hypot(boat.x - pod.x, boat.z - pod.z) < 90) {
        mode = 'boat';
        boatStill = 0;
        // 船のどちら側に並ぶか：いまいる側
        const rx = Math.cos(boat.yaw);
        const rz = -Math.sin(boat.yaw);
        boatSide = (pod.x - boat.x) * rx + (pod.z - boat.z) * rz > 0 ? 1 : -1;
      }
    } else {
      if (!boat) { mode = 'route'; u = nearestRouteU(pod.x, pod.z); joinCool = 20; }
      else {
        boatStill = Math.abs(boat.speed) < 1 ? boatStill + dt : 0;
        const far = Math.hypot(boat.x - pod.x, boat.z - pod.z) > 160;
        if (boatStill > 10 || far) { mode = 'route'; u = nearestRouteU(pod.x, pod.z); joinCool = 30; }
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
        d.pitch = -Math.atan2(vy, Math.max(2, d.speed));
        if (j.t >= j.dur) {
          d.jump = null;
          d.y = SEA_LEVEL - 0.3;
          splashes.burst(d.x, d.z, 1.1);
          d.nextJump = mode === 'boat' ? rand(3, 8) : rand(5, 14);
        }
      } else {
        d.nextJump -= dt;
        if (d.nextJump <= 0) {
          startJump(d);
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
          dlift = Math.cos(Math.PI * d.breathT) * 0.75 * Math.PI / 1.3;
          if (d.breathT >= 1) d.breathT = -1;
        }
        d.y = SEA_LEVEL - 0.55 + lift;
        d.pitch += (-Math.atan2(dlift, Math.max(1.5, d.speed)) - d.pitch) * Math.min(1, dt * 6);
      }
      d.phase += dt * (2.6 + d.speed * 0.45);
      d.tail.rotation.x = Math.sin(d.phase) * (d.jump ? 0.15 : 0.38);
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
    debugJump(i = 0) { const d = list[i]; if (d && !d.jump) startJump(d); },
  };
}
