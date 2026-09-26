import * as THREE from 'three';
import { GOLF_ZONE } from './hill.js';

/**
 * パットパットゴルフ（コースと球）。観覧車の南の芝地に 6 ホール。女の子と交互に打つ（golfgame.js）。
 *
 * ホールは軸にそろった長方形のつなぎ合わせ（レーン）。まわりは木の縁（球が跳ね返る）。
 * 1 まっすぐ・小さなこぶ / 2 L 字（曲がり角で縁に当てる）/ 3 風車（回る羽根のあいだのトンネルを抜ける）/
 * 4 ポールのあいだを抜ける / 5 橋（高いこぶ）/ 6 上り坂の上のカップ（弱いと戻ってくる）。
 *
 * 球の転がり：レーンの高さ h(x, z) の傾きで加速（転がる球なので 5/7）、芝の抵抗で止まる。
 * 縁・ポール・風車の羽根では跳ね返る。カップの上を 1.3m/s より遅く通れば入る（速いと縁で跳ねる）。
 *
 * 打ち方：VR は右手のパターを振る（ヘッドが球に当たった速さで打つ）。PC は自分の番になると
 * 球の後ろへ視点が移る。ドラッグで狙い、スペースを押している長さで強さ、離して打つ（右下に強さの表示）。
 */
export const GOLF = { ...GOLF_ZONE, ballR: 0.03, cupR: 0.055, maxStrokes: 7 };
const DECEL = 0.62;      // 芝の転がりの抵抗（m/s²）
const GRAV = 9.8 * (5 / 7);
const REST = 0.72;       // 縁で跳ね返る速さの割合
const LANE_Y = 0.03;     // レーンの面（地面からの高さ）

const R = (x0, x1, z0, z1) => ({ x0, x1, z0, z1 });
const bump = (z, width, height) => (x, zz) => height * Math.exp(-(((zz - z) / width) ** 2));

/** ホールの表。rects はレーン、walls は縁（線分）、aim は女の子が狙う点（曲がり角） */
function holeDefs() {
  const H = [];
  // 1：まっすぐ・小さなこぶ
  H.push({
    name: 'まっすぐ', par: 2, rects: [R(-35.5, -34.4, 17, 24)], tee: [-34.95, 17.6], cup: [-34.95, 23.3],
    h: bump(20.5, 0.45, 0.07),
  });
  // 2：L 字（南へ行って東へ曲がる）
  H.push({
    name: 'L 字', par: 3, rects: [R(-32.8, -31.7, 17, 23.5), R(-31.7, -28.2, 22.4, 23.5)], tee: [-32.25, 17.6], cup: [-28.8, 22.95],
    aim: [[-32.25, 22.9]],
  });
  // 3：風車（z 21 の壁のまん中に 0.28m のトンネル。前を羽根が回る）
  H.push({
    name: '風車', par: 3, rects: [R(-26.6, -25.5, 17, 25)], tee: [-26.05, 17.6], cup: [-26.05, 24.3],
    windmill: { x: -26.05, z: 21, gap: 0.28 },
  });
  // 4：ポールのあいだを抜ける
  H.push({
    name: 'ポール', par: 2, rects: [R(-23.8, -22.7, 17, 25)], tee: [-23.25, 17.6], cup: [-23.25, 24.4],
    posts: [[-23.45, 19.6], [-23.05, 21.2], [-23.45, 22.8]],
  });
  // 5：橋（高いこぶ）
  H.push({
    name: '橋', par: 2, rects: [R(-20.8, -19.7, 17, 25)], tee: [-20.25, 17.6], cup: [-20.25, 24.3],
    h: bump(21, 1.1, 0.22), bridge: true,
  });
  // 6：上り坂の上のカップ（西へ打つ）
  H.push({
    name: '上り坂', par: 3, rects: [R(-27.5, -18.5, 28, 29.1)], tee: [-19.1, 28.55], cup: [-26.6, 28.55],
    h: (x) => 0.13 * THREE.MathUtils.smoothstep(-x, 21.5, 23.5),
  });
  for (const hole of H) {
    hole.h ??= () => 0;
    hole.walls = outline(hole.rects);
  }
  return H;
}

/**
 * 長方形のつなぎ合わせの外周（縁の線分）。格子に切って、となりが外なら辺を縁にする（L 字の内側の角も出る）
 */
function outline(rects) {
  const xs = [...new Set(rects.flatMap((r) => [r.x0, r.x1]))].sort((a, b) => a - b);
  const zs = [...new Set(rects.flatMap((r) => [r.z0, r.z1]))].sort((a, b) => a - b);
  const inside = (x, z) => rects.some((r) => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1);
  const segs = [];
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < zs.length - 1; j++) {
      const cx = (xs[i] + xs[i + 1]) / 2;
      const cz = (zs[j] + zs[j + 1]) / 2;
      if (!inside(cx, cz)) continue;
      const dx = (xs[i + 1] - xs[i]) / 2 + 0.01;
      const dz = (zs[j + 1] - zs[j]) / 2 + 0.01;
      if (!inside(cx - dx, cz)) segs.push([xs[i], zs[j], xs[i], zs[j + 1]]);
      if (!inside(cx + dx, cz)) segs.push([xs[i + 1], zs[j], xs[i + 1], zs[j + 1]]);
      if (!inside(cx, cz - dz)) segs.push([xs[i], zs[j], xs[i + 1], zs[j]]);
      if (!inside(cx, cz + dz)) segs.push([xs[i], zs[j + 1], xs[i + 1], zs[j + 1]]);
    }
  }
  return segs;
}

function makeHoleMesh(hole, mats, index) {
  const g = new THREE.Group();
  for (const r of hole.rects) {
    const w = r.x1 - r.x0;
    const d = r.z1 - r.z0;
    const nx = Math.max(2, Math.ceil(w / 0.12));
    const nz = Math.max(2, Math.ceil(d / 0.12));
    const geo = new THREE.PlaneGeometry(w, d, nx, nz);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + (r.x0 + r.x1) / 2;
      const z = pos.getZ(i) + (r.z0 + r.z1) / 2;
      pos.setY(i, LANE_Y + hole.h(x, z));
    }
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mats.felt);
    m.position.set((r.x0 + r.x1) / 2, 0, (r.z0 + r.z1) / 2);
    m.receiveShadow = true;
    g.add(m);
    // 台（レーンの下の木の箱）
    const base = new THREE.Mesh(new THREE.BoxGeometry(w + 0.1, LANE_Y, d + 0.1), mats.wood);
    base.position.set((r.x0 + r.x1) / 2, LANE_Y / 2 - 0.005, (r.z0 + r.z1) / 2);
    g.add(base);
  }
  // 縁（高さはその辺りのレーンの高さに合わせる）
  for (const [x0, z0, x1, z1] of hole.walls) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const hy = Math.max(hole.h(x0, z0), hole.h(x1, z1), hole.h((x0 + x1) / 2, (z0 + z1) / 2));
    const rail = new THREE.Mesh(new THREE.BoxGeometry(len + 0.06, 0.09 + hy, 0.06), mats.rail);
    rail.position.set((x0 + x1) / 2, LANE_Y + (0.09 + hy) / 2, (z0 + z1) / 2);
    rail.rotation.y = Math.atan2(-(z1 - z0), x1 - x0);
    rail.castShadow = true;
    g.add(rail);
  }
  // ティーのマットとカップ・旗
  const tee = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.35), mats.tee);
  tee.rotation.x = -Math.PI / 2;
  tee.position.set(hole.tee[0], LANE_Y + hole.h(...hole.tee) + 0.003, hole.tee[1]);
  g.add(tee);
  const cupY = LANE_Y + hole.h(...hole.cup);
  const cup = new THREE.Mesh(new THREE.CircleGeometry(GOLF.cupR, 20), mats.cup);
  cup.rotation.x = -Math.PI / 2;
  cup.position.set(hole.cup[0], cupY + 0.003, hole.cup[1]);
  g.add(cup);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.8, 6), mats.pole);
  pole.position.set(hole.cup[0], cupY + 0.4, hole.cup[1]);
  g.add(pole);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.14), mats.flag);
  flag.position.set(hole.cup[0] + 0.11, cupY + 0.72, hole.cup[1]);
  g.add(flag);
  // 番号の札
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = '#1f6b3a'; x.fillRect(0, 0, 128, 128);
  x.fillStyle = '#fff'; x.font = 'bold 72px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(String(index + 1), 64, 56);
  x.font = 'bold 22px sans-serif';
  x.fillText(`パー ${hole.par}`, 64, 108);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.4), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
  sign.position.set(hole.tee[0] - 0.75, 0.75, hole.tee[1] - 0.2);
  sign.rotation.y = Math.PI;
  g.add(sign);
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.55, 0.05), mats.wood);
  post.position.set(hole.tee[0] - 0.75, 0.28, hole.tee[1] - 0.2);
  g.add(post);
  // ポール
  for (const [px, pz] of hole.posts ?? []) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.3, 12), mats.post);
    p.position.set(px, LANE_Y + 0.15, pz);
    p.castShadow = true;
    g.add(p);
  }
  // 橋の両わきの水
  if (hole.bridge) {
    const water = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.4), mats.water);
    water.rotation.x = -Math.PI / 2;
    water.position.set(-20.25, 0.01, 21);
    g.add(water);
  }
  // 風車
  if (hole.windmill) {
    const W = hole.windmill;
    const house = new THREE.Group();
    house.position.set(W.x, 0, W.z);
    const side = (1.1 - W.gap) / 2;
    for (const sx of [-1, 1]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(side, 0.55, 0.5), mats.mill);
      wall.position.set(sx * (W.gap / 2 + side / 2), LANE_Y + 0.275, 0.1);
      wall.castShadow = true;
      house.add(wall);
    }
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.5, 0.5), mats.mill);
    top.position.set(0, LANE_Y + 0.8, 0.1);
    house.add(top);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(0.72, 0.6, 4), mats.roof);
    roof.position.set(0, LANE_Y + 1.35, 0.1);
    roof.rotation.y = Math.PI / 4;
    house.add(roof);
    const hub = new THREE.Group();
    hub.position.set(0, LANE_Y + 0.8, -0.18);
    for (let i = 0; i < 4; i++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.75, 0.02), mats.blade);
      blade.position.set(0, 0.42, 0);
      const arm = new THREE.Group();
      arm.rotation.z = (i * Math.PI) / 2;
      arm.add(blade);
      hub.add(arm);
    }
    house.add(hub);
    g.add(house);
    g.userData.windmillHub = hub;
  }
  return g;
}

function makeBoard() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 1.0), new THREE.MeshBasicMaterial({ map: tex }));
  return { canvas, tex, mesh };
}

export function createGolf() {
  const group = new THREE.Group();
  group.name = 'golf';
  const mats = {
    felt: new THREE.MeshStandardMaterial({ color: 0x2f9a4a, roughness: 0.95 }),
    wood: new THREE.MeshStandardMaterial({ color: 0x9c7446, roughness: 0.85 }),
    rail: new THREE.MeshStandardMaterial({ color: 0xe8e0cc, roughness: 0.7 }),
    tee: new THREE.MeshStandardMaterial({ color: 0x1f5f33, roughness: 1 }),
    cup: new THREE.MeshBasicMaterial({ color: 0x111111 }),
    pole: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 }),
    flag: new THREE.MeshStandardMaterial({ color: 0xe8403a, roughness: 0.7, side: THREE.DoubleSide }),
    post: new THREE.MeshStandardMaterial({ color: 0xf2c230, roughness: 0.5 }),
    water: new THREE.MeshStandardMaterial({ color: 0x3a8ad8, roughness: 0.15, metalness: 0.2 }),
    mill: new THREE.MeshStandardMaterial({ color: 0xf4efe2, roughness: 0.7 }),
    roof: new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.6 }),
    blade: new THREE.MeshStandardMaterial({ color: 0x8a5a33, roughness: 0.7 }),
  };
  const holes = holeDefs();
  const hubs = [];
  holes.forEach((hole, i) => {
    const m = makeHoleMesh(hole, mats, i);
    group.add(m);
    hubs.push(m.userData.windmillHub ?? null);
  });
  // 入口の掲示板（北向き、観覧車の側から見える）
  const board = makeBoard();
  board.mesh.position.set(-26.5, 1.4, 15.2);
  board.mesh.rotation.y = Math.PI;
  group.add(board.mesh);
  for (const sx of [-0.9, 0.9]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.4, 0.07), mats.wood);
    leg.position.set(-26.5 + sx, 0.7, 15.25);
    group.add(leg);
  }

  // 球（プレイヤー白・女の子ピンク）
  const ballMat = [new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35 }), new THREE.MeshStandardMaterial({ color: 0xff7eb6, roughness: 0.35 })];
  const balls = ballMat.map((mat) => {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(GOLF.ballR, 16, 12), mat);
    mesh.castShadow = true;
    mesh.visible = false;
    group.add(mesh);
    return { mesh, x: 0, z: 0, vx: 0, vz: 0, moving: false, inCup: false, sink: 0, strokes: 0 };
  });

  // パター（プレイヤー用：VR は右手、PC は球の後ろ。女の子用：golfgame.js が置く）
  function putterModel() {
    const g = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.86, 6), new THREE.MeshStandardMaterial({ color: 0xc9ccd2, metalness: 0.9, roughness: 0.3 }));
    shaft.position.y = 0.43;
    g.add(shaft);
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.22, 8), new THREE.MeshStandardMaterial({ color: 0x1b1c20, roughness: 0.8 }));
    grip.position.y = 0.76;
    g.add(grip);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.03, 0.035), new THREE.MeshStandardMaterial({ color: 0x3a3d44, metalness: 0.8, roughness: 0.35 }));
    head.position.set(0.035, 0.015, 0);
    g.add(head);
    g.userData.head = head;
    return g;
  }
  const playerPutter = putterModel();
  playerPutter.visible = false;
  group.add(playerPutter);
  const girlPutter = putterModel();
  girlPutter.visible = false;
  group.add(girlPutter);

  let current = 0;
  let millAngle = 0;
  const tmp = new THREE.Vector3();

  const hole = () => holes[current];
  const laneH = (x, z) => hole().h(x, z);
  function gradient(x, z) {
    const e = 0.02;
    return [(laneH(x + e, z) - laneH(x - e, z)) / (2 * e), (laneH(x, z + e) - laneH(x, z - e)) / (2 * e)];
  }
  /** いまの縁の線分（風車の羽根がトンネルの前にあるときは、トンネルもふさぐ） */
  function walls() {
    const H = hole();
    const list = [...H.walls];
    if (H.windmill) {
      const W = H.windmill;
      const side = (1.1 - W.gap) / 2;
      const zf = W.z - 0.15;
      const zb = W.z + 0.35;
      // 壁の前面・背面・トンネルの両わき
      list.push([W.x - 0.55, zf, W.x - W.gap / 2, zf], [W.x + W.gap / 2, zf, W.x + 0.55, zf]);
      list.push([W.x - 0.55, zb, W.x - W.gap / 2, zb], [W.x + W.gap / 2, zb, W.x + 0.55, zb]);
      list.push([W.x - W.gap / 2, zf, W.x - W.gap / 2, zb], [W.x + W.gap / 2, zf, W.x + W.gap / 2, zb]);
      void side;
      if (millBlocking()) list.push([W.x - W.gap / 2, zf - 0.02, W.x + W.gap / 2, zf - 0.02]);
    }
    return list;
  }
  /** 羽根（4 枚）のどれかが真下を向いてトンネルをふさいでいるか */
  function millBlocking() {
    const a = ((millAngle % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2);
    return Math.abs(a - Math.PI / 4) > Math.PI / 4 - 0.28;
  }

  function collide(b) {
    const r = GOLF.ballR;
    for (const [x0, z0, x1, z1] of walls()) {
      const dx = x1 - x0;
      const dz = z1 - z0;
      const L2 = dx * dx + dz * dz;
      let t = ((b.x - x0) * dx + (b.z - z0) * dz) / L2;
      t = Math.max(0, Math.min(1, t));
      const cx = x0 + dx * t;
      const cz = z0 + dz * t;
      let nx = b.x - cx;
      let nz = b.z - cz;
      const d = Math.hypot(nx, nz);
      if (d >= r || d < 1e-9) continue;
      nx /= d; nz /= d;
      b.x = cx + nx * r;
      b.z = cz + nz * r;
      const vn = b.vx * nx + b.vz * nz;
      if (vn < 0) { b.vx -= (1 + REST) * vn * nx; b.vz -= (1 + REST) * vn * nz; }
    }
    for (const [px, pz] of hole().posts ?? []) {
      let nx = b.x - px;
      let nz = b.z - pz;
      const d = Math.hypot(nx, nz);
      const m = 0.07 + r;
      if (d >= m) continue;
      nx /= d; nz /= d;
      b.x = px + nx * m;
      b.z = pz + nz * m;
      const vn = b.vx * nx + b.vz * nz;
      if (vn < 0) { b.vx -= (1 + REST) * vn * nx; b.vz -= (1 + REST) * vn * nz; }
    }
  }

  function stepBall(b, dt) {
    if (!b.moving) return null;
    const [cx, cz] = hole().cup;
    let event = null;
    const n = 6;
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      const [gx, gz] = gradient(b.x, b.z);
      b.vx -= GRAV * gx * h;
      b.vz -= GRAV * gz * h;
      const sp = Math.hypot(b.vx, b.vz);
      if (sp > 1e-6) {
        const k = Math.max(0, sp - DECEL * h) / sp;
        b.vx *= k; b.vz *= k;
      }
      b.x += b.vx * h;
      b.z += b.vz * h;
      collide(b);
      // カップ
      const dc = Math.hypot(b.x - cx, b.z - cz);
      if (dc < GOLF.cupR - 0.012) {
        const s = Math.hypot(b.vx, b.vz);
        if (s < 1.3) { b.inCup = true; b.moving = false; b.vx = b.vz = 0; b.x = cx; b.z = cz; b.sink = 0; return 'cup'; }
        // 速すぎ：縁で跳ねて弱まる
        b.vx *= 0.7; b.vz *= 0.7;
        const ax = (b.x - cx) / Math.max(dc, 1e-4);
        const az = (b.z - cz) / Math.max(dc, 1e-4);
        b.vx += ax * 0.15; b.vz += az * 0.15;
        event = 'lip';
      }
    }
    const [gx, gz] = gradient(b.x, b.z);
    if (Math.hypot(b.vx, b.vz) < 0.04 && Math.hypot(gx, gz) < 0.03) { b.vx = b.vz = 0; b.moving = false; return 'stop'; }
    return event;
  }

  function placeMesh(b) {
    const y = LANE_Y + laneH(b.x, b.z) + GOLF.ballR - (b.inCup ? Math.min(0.06, b.sink) : 0);
    b.mesh.position.set(b.x, y, b.z);
    // 転がり（見た目）
    const sp = Math.hypot(b.vx, b.vz);
    if (sp > 0.01) {
      tmp.set(b.vz, 0, -b.vx).normalize();
      b.mesh.rotateOnWorldAxis(tmp, (sp / GOLF.ballR) * (1 / 60));
    }
  }

  function drawBoard(scores, total) {
    const c = board.canvas.getContext('2d');
    c.fillStyle = '#1d4d2c';
    c.fillRect(0, 0, 512, 256);
    c.fillStyle = '#fff';
    c.font = 'bold 30px sans-serif';
    c.textAlign = 'center';
    c.fillText('パットパットゴルフ', 256, 36);
    c.font = 'bold 20px sans-serif';
    const x0 = 118;
    const w = 50;
    c.textAlign = 'center';
    holes.forEach((h, i) => c.fillText(String(i + 1), x0 + w * i, 80));
    c.fillText('計', x0 + w * 6 + 12, 80);
    c.textAlign = 'left';
    c.fillText('パー', 14, 112);
    c.fillText('あなた', 14, 158);
    c.fillText('女の子', 14, 204);
    c.textAlign = 'center';
    holes.forEach((h, i) => c.fillText(String(h.par), x0 + w * i, 112));
    c.fillText(String(holes.reduce((a, h) => a + h.par, 0)), x0 + w * 6 + 12, 112);
    for (const [row, list] of [[158, scores[0]], [204, scores[1]]]) {
      list.forEach((v, i) => { if (v != null) c.fillText(String(v), x0 + w * i, row); });
    }
    c.fillText(String(total[0] || '-'), x0 + w * 6 + 12, 158);
    c.fillText(String(total[1] || '-'), x0 + w * 6 + 12, 204);
    c.fillStyle = 'rgba(255,255,255,0.35)';
    c.fillRect(x0 + w * current - 22, 60, 44, 4);
    board.tex.needsUpdate = true;
  }

  // PC の強さの表示（右下）と、狙いの線
  let hud = null;
  function pcHud() {
    if (hud || typeof document === 'undefined') return hud;
    hud = document.createElement('div');
    hud.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:24;display:none;width:220px;padding:8px 10px;background:rgba(18,22,34,.78);color:#fff;border-radius:10px;font:600 13px/1.45 sans-serif';
    document.body.appendChild(hud);
    return hud;
  }
  const aimLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, 1)]), new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.06, gapSize: 0.05 }));
  aimLine.visible = false;
  group.add(aimLine);

  return {
    group,
    holes,
    balls,
    playerPutter,
    girlPutter,
    board,
    get current() { return current; },
    set current(i) { current = i; },
    get hole() { return hole(); },
    laneY(x, z) { return LANE_Y + laneH(x, z); },
    /** 球をティーに置く */
    resetBalls() {
      const [tx, tz] = hole().tee;
      balls.forEach((b, i) => {
        b.x = tx + (i === 0 ? -0.12 : 0.12);
        b.z = tz;
        b.vx = b.vz = 0;
        b.moving = false;
        b.inCup = false;
        b.strokes = 0;
        b.mesh.visible = true;
        b.mesh.rotation.set(0, 0, 0);
        placeMesh(b);
      });
    },
    hideBalls() { balls.forEach((b) => { b.mesh.visible = false; }); },
    /** 打つ（速さ vx, vz） */
    strike(i, vx, vz) {
      const b = balls[i];
      const sp = Math.hypot(vx, vz);
      const k = sp > 5 ? 5 / sp : 1;
      b.vx = vx * k;
      b.vz = vz * k;
      b.moving = true;
      b.strokes++;
    },
    /** 1 フレーム進める。球ごとの出来事（'cup' / 'stop' / 'lip'）を返す */
    update(dt) {
      millAngle += dt * 1.6;
      hubs.forEach((h) => { if (h) h.rotation.z = -millAngle; });
      const events = balls.map((b) => stepBall(b, dt));
      for (const b of balls) {
        if (b.inCup) b.sink += dt * 0.25;
        if (b.mesh.visible) placeMesh(b);
      }
      return events;
    },
    /** 2 つの点のあいだが縁にさえぎられていないか（女の子の狙い） */
    clear(ax, az, bx, bz) {
      const cross = (px, pz, qx, qz, rx, rz) => (qx - px) * (rz - pz) - (qz - pz) * (rx - px);
      for (const [x0, z0, x1, z1] of hole().walls) {
        const d1 = cross(ax, az, bx, bz, x0, z0);
        const d2 = cross(ax, az, bx, bz, x1, z1);
        const d3 = cross(x0, z0, x1, z1, ax, az);
        const d4 = cross(x0, z0, x1, z1, bx, bz);
        if (d1 * d2 < 0 && d3 * d4 < 0) return false;
      }
      return true;
    },
    /** 平らなところで距離 d を転がすのに要る速さ（上りは足す） */
    speedFor(d, dh = 0) { return Math.sqrt(2 * DECEL * Math.max(0, d) + 2 * GRAV * Math.max(0, dh)); },
    drawBoard,
    get millOpen() { return !millBlocking(); },
    /** PC：強さ（0..1）と狙いを表示する。null で消す */
    showAim(from, dir, power, text) {
      const el = pcHud();
      if (!from) { aimLine.visible = false; if (el) el.style.display = 'none'; return; }
      aimLine.visible = true;
      // 球の少し先から（球とパターのヘッドに隠れないように）
      const pts = [from.clone().addScaledVector(dir, 0.08), from.clone().addScaledVector(dir, 0.6 + power * 1.8)];
      aimLine.geometry.setFromPoints(pts);
      aimLine.computeLineDistances();
      if (el) {
        el.style.display = '';
        el.innerHTML = `${text}<div style="margin-top:6px;height:10px;background:#333a4a;border-radius:5px;overflow:hidden"><div style="height:100%;width:${Math.round(power * 100)}%;background:${power > 0.8 ? '#e8403a' : '#46c46a'}"></div></div>`
          + '<div style="opacity:.6;font-size:11px;margin-top:4px">ドラッグで狙う／スペース長押しで強さ・離して打つ</div>';
      }
    },
    showText(text) {
      const el = pcHud();
      if (!el) return;
      aimLine.visible = false;
      if (!text) { el.style.display = 'none'; return; }
      el.style.display = '';
      el.innerHTML = text;
    },
    zone: GOLF_ZONE,
    inZone(x, z) { const Z = GOLF_ZONE; return x > Z.minX && x < Z.maxX && z > Z.minZ + 1.5 && z < Z.maxZ; },
  };
}
