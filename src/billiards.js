import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { ROOM, ANNEX, EAST_DOOR } from './room.js';

/**
 * ビリヤードの部屋（本の部屋の東へ建て増し）と、ビリヤード台・球・球の動き。
 *
 * - 部屋：床はオーク、壁はしっくい、北と東に窓。天井・陸屋根（深い庇）。本の部屋の東の壁の出入り口（EAST_DOOR）から入る
 * - 台：8 フィート（盤面 2.24 × 1.12m、高さ 0.78m）。緑の羅紗、クルミの木枠、6 つのポケット。台の上に長いランプ
 * - 球：ナインボール（1〜9 と手球）。半径 28.6mm。番号の入った模様を貼る
 * - 動き（step）：台のローカル（x は長い向き、z は短い向き、中心が 0）の 2 次元で、1 フレームを 8 回に刻んで進める。
 *   球どうしは弾性衝突（はね返り 0.95）、クッションは 0.75、転がり抵抗で減速、ポケットの口に入ると落ちる。
 *   球の模様は、転がった距離だけ回す
 *
 * 台のローカル ↔ ワールドは tableToWorld / worldToTable（台は x 方向に長く、回さない）。
 */

// --- 大きさ ------------------------------------------------------------------------
export const BALL_R = 0.028575;
export const TABLE = {
  x: 5.92,             // 台の中心（ワールド）
  z: 0.45,
  halfL: 1.12,         // 盤面の半分（クッションの先まで）
  halfW: 0.56,
  height: 0.78,        // 盤面の高さ
  rail: 0.16,          // クッション＋木枠の幅
};
const SURFACE_Y = TABLE.height;
/** ポケット（台のローカル）。corner は角の口、side は長いほうの真ん中 */
export const POCKETS = [
  { x: -TABLE.halfL, z: -TABLE.halfW, corner: true }, { x: TABLE.halfL, z: -TABLE.halfW, corner: true },
  { x: -TABLE.halfL, z: TABLE.halfW, corner: true }, { x: TABLE.halfL, z: TABLE.halfW, corner: true },
  { x: 0, z: -TABLE.halfW, corner: false }, { x: 0, z: TABLE.halfW, corner: false },
];
const CORNER_MOUTH = 0.085;   // 角の口：角から両方のクッションに沿ってこの長さはクッションが無い
const SIDE_MOUTH = 0.062;     // 真ん中の口の半分の幅
/** 手球を置く所（ヘッドスポット）と、ラックの先頭（フットスポット） */
export const HEAD_SPOT = { x: -TABLE.halfL / 2, z: 0 };
export const FOOT_SPOT = { x: TABLE.halfL / 2, z: 0 };

export function tableToWorld(x, z, out = new THREE.Vector3()) { return out.set(TABLE.x + x, SURFACE_Y + BALL_R, TABLE.z + z); }
export function worldToTable(x, z) { return { x: x - TABLE.x, z: z - TABLE.z }; }

// --- 部屋の壁（歩けない所）・道順 ------------------------------------------------------
const W = ANNEX.wall;
/** ビリヤードの部屋の外壁（北・南・東）。本の部屋の東の壁は、本の部屋の範囲の外なので要らない */
export function annexBlocks(x, z, inset = 0) {
  const m = inset + 0.05;
  const inX = x > ANNEX.minX - W - m && x < ANNEX.maxX + W + m;
  if (inX && z > ANNEX.minZ - W - m && z < ANNEX.minZ + m) return true;          // 北
  if (inX && z > ANNEX.maxZ - m && z < ANNEX.maxZ + W + m) return true;          // 南
  if (x > ANNEX.maxX - m && x < ANNEX.maxX + W + m && z > ANNEX.minZ - W - m && z < ANNEX.maxZ + W + m) return true;   // 東
  return false;
}
/** ビリヤード台（歩いて通り抜けない） */
export function tableBlocks(x, z, inset = 0) {
  return Math.abs(x - TABLE.x) < TABLE.halfL + TABLE.rail + inset && Math.abs(z - TABLE.z) < TABLE.halfW + TABLE.rail + inset;
}
/** 家（本の部屋＋ビリヤードの部屋）の外まわり */
export const HOUSE_EAST = ANNEX.maxX + W;

/**
 * 外を歩く道順が、ビリヤードの部屋（外壁から 0.7m）を突き抜けないように、角を回る点を足す。
 * points は THREE.Vector2（x, y = z）の並び。そのまま返すか、角の点を足した新しい並びを返す
 */
export function detourAnnex(points) {
  if (points.length < 2) return points;
  const m = 0.7;
  const R = { x0: ANNEX.minX - W - m, x1: ANNEX.maxX + W + m, z0: ANNEX.minZ - W - m, z1: ANNEX.maxZ + W + m };
  const inner = { x0: R.x0 + 0.1, x1: R.x1 - 0.1, z0: R.z0 + 0.1, z1: R.z1 - 0.1 };
  const hits = (a, b, r) => {
    // 線分と矩形（Liang–Barsky）
    let t0 = 0;
    let t1 = 1;
    const dx = b.x - a.x;
    const dz = b.y - a.y;
    for (const [p, q] of [[-dx, a.x - r.x0], [dx, r.x1 - a.x], [-dz, a.y - r.z0], [dz, r.z1 - a.y]]) {
      if (Math.abs(p) < 1e-9) { if (q < 0) return false; continue; }
      const t = q / p;
      if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
    }
    return t1 - t0 > 1e-6;
  };
  // 本の部屋の中（西の壁より西）から入る・出る道はそのまま（部屋の中の道は character.js が決める）
  const indoor = (p) => p.x < ROOM.maxX + 0.3 && p.x > ROOM.minX - 0.3 && p.y > ROOM.minZ - 0.3 && p.y < ROOM.maxZ + 0.3;
  const corners = [new THREE.Vector2(R.x0, R.z0), new THREE.Vector2(R.x1, R.z0), new THREE.Vector2(R.x1, R.z1), new THREE.Vector2(R.x0, R.z1)];
  const out = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const a = out[out.length - 1];
    const b = points[i];
    if (indoor(a) || indoor(b) || !hits(a, b, inner)) { out.push(b); continue; }
    let best = null;
    let bestLen = Infinity;
    const len = (list) => { let s = 0; let p = a; for (const q of list) { s += p.distanceTo(q); p = q; } return s + p.distanceTo(b); };
    const clear = (list) => { let p = a; for (const q of [...list, b]) { if (hits(p, q, inner)) return false; p = q; } return true; };
    for (let k = 0; k < 4; k++) {
      for (const list of [[corners[k]], [corners[k], corners[(k + 1) % 4]], [corners[k], corners[(k + 3) % 4]]]) {
        if (!clear(list)) continue;
        const l = len(list);
        if (l < bestLen) { bestLen = l; best = list; }
      }
    }
    if (best) out.push(...best.map((c) => c.clone()));
    out.push(b);
  }
  return out;
}

// --- 見た目 ---------------------------------------------------------------------------
const BALL_COLORS = { 1: '#f2c21b', 2: '#1d4fbf', 3: '#d22b25', 4: '#6a2c91', 5: '#ef7a1a', 6: '#11834a', 7: '#7a1e1e', 8: '#141414', 9: '#f2c21b' };
function ballTexture(n) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const x = c.getContext('2d');
  if (n === 0) {
    x.fillStyle = '#f7f4ea';
    x.fillRect(0, 0, 256, 128);
    // 手球の赤い点（回っているのが分かるように）
    x.fillStyle = '#c8322a';
    for (const [u, v] of [[64, 64], [192, 64]]) { x.beginPath(); x.arc(u, v, 7, 0, Math.PI * 2); x.fill(); }
  } else {
    const stripe = n > 8;
    x.fillStyle = stripe ? '#f7f4ea' : BALL_COLORS[n];
    x.fillRect(0, 0, 256, 128);
    if (stripe) { x.fillStyle = BALL_COLORS[n]; x.fillRect(0, 34, 256, 60); }
    for (const u of [64, 192]) {
      x.fillStyle = '#f7f4ea';
      x.beginPath();
      x.ellipse(u, 64, 20, 22, 0, 0, Math.PI * 2);
      x.fill();
      x.fillStyle = '#111';
      x.font = 'bold 26px sans-serif';
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      x.fillText(String(n), u, 65);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeRoom(group, tex) {
  const w = ANNEX.maxX - ANNEX.minX;
  const d = ANNEX.maxZ - ANNEX.minZ;
  const cx = (ANNEX.minX + ANNEX.maxX) / 2;
  const cz = (ANNEX.minZ + ANNEX.maxZ) / 2;
  const H = ANNEX.height;
  const wallMat = tex.material('plaster', { uvInMeters: true, color: 0xe4dccd, normalScale: new THREE.Vector2(0.18, 0.18) });
  const floorMat = tex.material('oakFloor', { sizeX: w, sizeY: d, color: 0xd9c3a3, normalScale: new THREE.Vector2(0.7, 0.7) });
  const ceilMat = tex.material('plaster', { sizeX: w, sizeY: d, color: 0xf1ede6, normalScale: new THREE.Vector2(0.14, 0.14) });
  const trimMat = tex.material('walnut', { sizeX: 1.2, sizeY: 1.2, color: 0x7a5c44, roughness: 0.55, normalScale: new THREE.Vector2(0.12, 0.12) });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w + 0.02, d), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(cx - 0.01, 0.001, cz);
  floor.receiveShadow = true;
  group.add(floor);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(w, d), ceilMat);
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(cx, H, cz);
  group.add(ceil);
  // 壁（厚み 14cm の押し出し。窓は穴）。shape は壁のローカル x（壁の中心が 0）・y（床から）
  const wallPiece = (width, holes) => {
    const shape = new THREE.Shape();
    shape.moveTo(-width / 2, 0);
    shape.lineTo(width / 2, 0);
    shape.lineTo(width / 2, H);
    shape.lineTo(-width / 2, H);
    shape.closePath();
    for (const o of holes) {
      const h = new THREE.Path();
      h.moveTo(o.x - o.w / 2, o.sill);
      h.lineTo(o.x + o.w / 2, o.sill);
      h.lineTo(o.x + o.w / 2, o.head);
      h.lineTo(o.x - o.w / 2, o.head);
      h.closePath();
      shape.holes.push(h);
    }
    const geo = new THREE.ExtrudeGeometry(shape, { depth: W, bevelEnabled: false, curveSegments: 1 });
    const m = new THREE.Mesh(geo, wallMat);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  };
  const northWin = { x: 0.4, w: 1.8, sill: 0.9, head: 2.15 };
  const eastWin = { x: 0, w: 1.6, sill: 0.9, head: 2.15 };
  // 北（-Z）：外面が z = minZ - W、押し出しは +Z（室内へ）
  const north = wallPiece(w + W * 2, [northWin]);
  north.position.set(cx + 0 * W, 0, ANNEX.minZ - W);
  group.add(north);
  // 南（+Z）：Y で半回転（押し出しが -Z へ）
  const south = wallPiece(w + W * 2, []);
  south.position.set(cx, 0, ANNEX.maxZ + W);
  south.rotation.y = Math.PI;
  group.add(south);
  // 東（+X）：Y で -90°（押し出しが -X、ローカル x はワールドの +Z）
  const east = wallPiece(d, [eastWin]);
  east.position.set(ANNEX.maxX + W, 0, cz);
  east.rotation.y = -Math.PI / 2;
  group.add(east);
  // 窓：ガラスと枠
  const glass = new THREE.MeshPhysicalMaterial({ color: 0xdfeef7, roughness: 0.05, transmission: 0.0, transparent: true, opacity: 0.18, depthWrite: false });
  const frame = (x, z, width, sill, head, rotY) => {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = rotY;
    const hh = head - sill;
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(width, hh), glass);
    pane.position.set(0, sill + hh / 2, 0);
    g.add(pane);
    for (const [bw, bh, px, py] of [[width + 0.1, 0.05, 0, head + 0.025], [width + 0.1, 0.05, 0, sill - 0.025], [0.05, hh, -width / 2 - 0.025, sill + hh / 2], [0.05, hh, width / 2 + 0.025, sill + hh / 2], [0.04, hh, 0, sill + hh / 2]]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 0.06), trimMat);
      b.position.set(px, py, 0);
      g.add(b);
    }
    group.add(g);
  };
  frame(cx + northWin.x, ANNEX.minZ - W / 2, northWin.w, northWin.sill, northWin.head, 0);
  frame(ANNEX.maxX + W / 2, cz + eastWin.x, eastWin.w, eastWin.sill, eastWin.head, Math.PI / 2);
  // 幅木
  for (const [len, x, z, ry] of [[w, cx, ANNEX.minZ + 0.006, 0], [w, cx, ANNEX.maxZ - 0.006, Math.PI], [d, ANNEX.maxX - 0.006, cz, -Math.PI / 2]]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(len, 0.09, 0.012), trimMat);
    b.position.set(x, 0.045, z);
    b.rotation.y = ry;
    group.add(b);
  }
  // 出入り口の枠（本の部屋の東の壁の穴の縁）
  {
    const x = ROOM.maxX + W / 2;
    const z0 = EAST_DOOR.z - EAST_DOOR.width / 2;
    const z1 = EAST_DOOR.z + EAST_DOOR.width / 2;
    for (const [bw, bh, bd, py, pz] of [[W + 0.04, 0.05, EAST_DOOR.width + 0.1, EAST_DOOR.head + 0.025, EAST_DOOR.z], [W + 0.04, EAST_DOOR.head, 0.05, EAST_DOOR.head / 2, z0 - 0.025], [W + 0.04, EAST_DOOR.head, 0.05, EAST_DOOR.head / 2, z1 + 0.025]]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), trimMat);
      b.position.set(x, py, pz);
      group.add(b);
    }
  }
  // 陸屋根（本の部屋の屋根より少し低く、深い庇）
  const EAVE = 0.45;
  const roofMat = tex.material('plaster', { sizeX: w + 1, sizeY: d + 1, color: 0xb3ada2, roughness: 0.95, normalScale: new THREE.Vector2(0.25, 0.25) });
  const roof = new THREE.Mesh(new THREE.BoxGeometry(w + W + EAVE, 0.18, d + W * 2 + EAVE * 2), roofMat);
  roof.position.set(cx + (W + EAVE) / 2, H + 0.09, cz);
  roof.castShadow = true;
  roof.receiveShadow = true;
  group.add(roof);
  // 壁ぎわの小物：キュー立て（北の壁）と、スコアの板（東の壁の南寄り）
  const rack = new THREE.Group();
  rack.position.set(cx - 1.6, 0, ANNEX.minZ + 0.06);
  const board = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.08, 0.05), trimMat);
  board.position.y = 1.35;
  rack.add(board);
  const foot = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.06, 0.12), trimMat);
  foot.position.set(0, 0.03, 0.03);
  rack.add(foot);
  group.add(rack);
  return { floor, rack };
}

function makeTable(group, tex) {
  const g = new THREE.Group();
  g.position.set(TABLE.x, 0, TABLE.z);
  group.add(g);
  const felt = new THREE.MeshStandardMaterial({ color: 0x1f6b3a, roughness: 0.95 });
  const cushionMat = new THREE.MeshStandardMaterial({ color: 0x1a5c32, roughness: 0.9 });
  const wood = tex.material('walnut', { sizeX: 2.6, sizeY: 1.5, color: 0x9a6a44, roughness: 0.45, normalScale: new THREE.Vector2(0.2, 0.2) });
  const dark = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.7 });
  // ポケットの穴は光を受けない黒（上の面が照らされて灰色に見えないように）
  const holeMat = new THREE.MeshBasicMaterial({ color: 0x040404 });
  const L = TABLE.halfL;
  const Wd = TABLE.halfW;
  const top = SURFACE_Y;
  // 盤面（羅紗）
  const bed = new THREE.Mesh(new THREE.BoxGeometry(L * 2, 0.04, Wd * 2), felt);
  bed.position.y = top - 0.02;
  bed.receiveShadow = true;
  g.add(bed);
  // クッション（口のところは切る）と木枠
  const cushionH = 0.045;
  const cw = 0.045;
  const cush = (len, x, z, alongX) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(alongX ? len : cw, cushionH, alongX ? cw : len), cushionMat);
    m.position.set(x, top + cushionH / 2 - 0.005, z);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  };
  const longLen = L - CORNER_MOUTH - SIDE_MOUTH;
  for (const sz of [-1, 1]) {
    for (const sx of [-1, 1]) cush(longLen, sx * (SIDE_MOUTH + longLen / 2), sz * (Wd + cw / 2), true);
  }
  for (const sx of [-1, 1]) cush(Wd * 2 - CORNER_MOUTH * 2, sx * (L + cw / 2), 0, false);
  const railW = TABLE.rail - cw;
  const railH = 0.06;
  for (const sz of [-1, 1]) {
    const r = new THREE.Mesh(new RoundedBoxGeometry(L * 2 + TABLE.rail * 2, railH, railW, 2, 0.02), wood);
    r.position.set(0, top + 0.012, sz * (Wd + cw + railW / 2));
    r.castShadow = true;
    g.add(r);
  }
  for (const sx of [-1, 1]) {
    const r = new THREE.Mesh(new RoundedBoxGeometry(railW, railH, Wd * 2 + cw * 2, 2, 0.02), wood);
    r.position.set(sx * (L + cw + railW / 2), top + 0.012, 0);
    r.castShadow = true;
    g.add(r);
  }
  // 木枠の上の目印（ダイヤモンド）
  const pearl = new THREE.MeshStandardMaterial({ color: 0xf1ead8, roughness: 0.3 });
  for (let i = 1; i < 8; i++) {
    if (i === 4) continue;
    const x = -L + (i * L * 2) / 8;
    for (const sz of [-1, 1]) {
      const dmd = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.004, 8), pearl);
      dmd.position.set(x, top + 0.043, sz * (Wd + cw + railW / 2));
      g.add(dmd);
    }
  }
  // ポケット（黒い穴）
  for (const p of POCKETS) {
    const hole = new THREE.Mesh(new THREE.CylinderGeometry(p.corner ? 0.062 : 0.058, 0.05, 0.12, 20), holeMat);
    const ox = p.corner ? Math.sign(p.x) * 0.02 : 0;
    const oz = Math.sign(p.z) * (p.corner ? 0.02 : 0.03);
    hole.position.set(p.x + ox, top - 0.058, p.z + oz);
    g.add(hole);
  }
  // 胴と脚
  const apron = new THREE.Mesh(new RoundedBoxGeometry(L * 2 + TABLE.rail * 2 - 0.02, 0.22, Wd * 2 + TABLE.rail * 2 - 0.02, 3, 0.03), wood);
  apron.position.y = top - 0.15;
  apron.castShadow = true;
  apron.receiveShadow = true;
  g.add(apron);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const leg = new THREE.Mesh(new RoundedBoxGeometry(0.14, top - 0.26, 0.14, 2, 0.02), wood);
      leg.position.set(sx * (L - 0.05), (top - 0.26) / 2, sz * (Wd - 0.02));
      leg.castShadow = true;
      g.add(leg);
    }
  }
  // 落ちた球を並べる受け皿（台の東の端の下）
  const tray = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.05, 0.1), dark);
  tray.position.set(L + TABLE.rail - 0.02, top - 0.3, 0);
  tray.rotation.y = Math.PI / 2;
  g.add(tray);
  // 台の上のランプ（長いかさ。下の面が光る）
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x1e3b2a, roughness: 0.4, metalness: 0.3 });
  const glow = new THREE.MeshStandardMaterial({ color: 0xfff4dc, emissive: 0xfff0d0, emissiveIntensity: 1.6 });
  const shade = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.14, 0.34), lampMat);
  shade.position.y = top + 0.95;
  g.add(shade);
  const glowPlane = new THREE.Mesh(new THREE.PlaneGeometry(1.44, 0.28), glow);
  glowPlane.rotation.x = Math.PI / 2;
  glowPlane.position.y = top + 0.879;
  g.add(glowPlane);
  for (const sx of [-0.55, 0.55]) {
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, ANNEX.height - (top + 1.02), 6), dark);
    rod.position.set(sx, (ANNEX.height + top + 1.02) / 2, 0);
    g.add(rod);
  }
  return { group: g, trayX: L + TABLE.rail - 0.02, trayY: top - 0.3 + 0.025 + BALL_R };
}

// --- 球と動き ----------------------------------------------------------------------------
/**
 * @param {THREE.Group} group
 */
function makeBalls(group) {
  const geo = new THREE.SphereGeometry(BALL_R, 24, 16);
  const shadowTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const x = c.getContext('2d');
    const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(0,0,0,0.55)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = gr;
    x.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const shadowGeo = new THREE.PlaneGeometry(BALL_R * 3.2, BALL_R * 3.2);
  shadowGeo.rotateX(-Math.PI / 2);
  const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false });
  const balls = [];
  for (let n = 0; n <= 9; n++) {
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: ballTexture(n), roughness: 0.18, metalness: 0.0 }));
    mesh.castShadow = true;
    group.add(mesh);
    const shadow = new THREE.Mesh(shadowGeo, shadowMat);
    shadow.renderOrder = 2;
    group.add(shadow);
    balls.push({ n, mesh, shadow, x: 0, z: 0, vx: 0, vz: 0, pocketed: false, drop: 0, pocket: null });
  }
  return balls;
}

export function createBilliards({ scene, tex }) {
  const group = new THREE.Group();
  group.name = 'billiards';
  scene.add(group);
  const room = makeRoom(group, tex);
  const table = makeTable(group, tex);
  const balls = makeBalls(group);
  const cue = balls[0];
  // 台の上のランプの光（影は付けない。球の下に影の円を置く）と、部屋の天井の明かり
  const lamp = new THREE.SpotLight(0xfff1dc, 14, 0, 1.05, 0.6, 2);
  lamp.position.set(TABLE.x, SURFACE_Y + 0.86, TABLE.z);
  lamp.target.position.set(TABLE.x, 0, TABLE.z);
  group.add(lamp, lamp.target);
  const fill = new THREE.PointLight(0xffe6c8, 2.5, 0, 2);
  fill.position.set((ANNEX.minX + ANNEX.maxX) / 2, ANNEX.height - 0.25, (ANNEX.minZ + ANNEX.maxZ) / 2);
  group.add(fill);

  // --- 並べる ---------------------------------------------------------------
  /** ナインボールのひし形（1 が先頭、9 が真ん中）。手球はヘッドスポット */
  function rack() {
    const d = BALL_R * 2 + 0.0004;
    const rowX = (r) => FOOT_SPOT.x + r * d * Math.cos(Math.PI / 6);
    const spots = [];
    const rows = [1, 2, 3, 2, 1];
    rows.forEach((count, r) => { for (let k = 0; k < count; k++) spots.push({ x: rowX(r), z: (k - (count - 1) / 2) * d }); });
    // 1 は先頭、9 は真ん中（3 列目の真ん中）。ほかは順不同
    const order = [1, 2, 3, 4, 9, 5, 6, 7, 8];
    const others = [2, 3, 4, 5, 6, 7, 8].sort(() => Math.random() - 0.5);
    spots.forEach((sp, i) => {
      const n = i === 0 ? 1 : i === 4 ? 9 : others.shift();
      const b = balls[n];
      Object.assign(b, { x: sp.x, z: sp.z, vx: 0, vz: 0, pocketed: false, drop: 0, pocket: null });
    });
    void order;
    Object.assign(cue, { x: HEAD_SPOT.x, z: HEAD_SPOT.z, vx: 0, vz: 0, pocketed: false, drop: 0, pocket: null });
    for (const b of balls) b.mesh.quaternion.identity();
    placeAll();
  }

  // --- 動き -----------------------------------------------------------------
  const ROLL = 0.14;        // 転がり抵抗（m/s²）
  const DRAG = 0.1;         // 速さに比例する減速（/s）
  const CUSHION = 0.75;
  const BALL_E = 0.95;
  let events = [];          // この 1 回の突きで起きたこと（billiardgame.js が読む）
  const axis = new THREE.Vector3();
  const spin = new THREE.Quaternion();

  function pocketCheck(b) {
    for (const p of POCKETS) {
      const px = p.x + (p.corner ? Math.sign(p.x) * 0.02 : 0);
      const pz = p.z + Math.sign(p.z) * (p.corner ? 0.02 : 0.03);
      const r = p.corner ? 0.062 : 0.058;
      if ((b.x - px) ** 2 + (b.z - pz) ** 2 < r * r) {
        b.pocketed = true;
        b.pocket = p;
        b.drop = 0;
        b.vx = b.vz = 0;
        events.push({ type: 'pocket', n: b.n });
        return true;
      }
    }
    return false;
  }

  function cushions(b) {
    const L = TABLE.halfL - BALL_R;
    const Wd = TABLE.halfW - BALL_R;
    const ax = Math.abs(b.x);
    const az = Math.abs(b.z);
    // 口のところ（角の口・真ん中の口）はクッションが無い
    const nearCornerX = ax > TABLE.halfL - CORNER_MOUTH;
    const nearCornerZ = az > TABLE.halfW - CORNER_MOUTH;
    const inSideMouth = ax < SIDE_MOUTH;
    if (b.x > L && !nearCornerZ) { b.x = L - (b.x - L); if (b.vx > 0) { b.vx *= -CUSHION; b.vz *= 0.92; events.push({ type: 'rail', n: b.n }); } }
    if (b.x < -L && !nearCornerZ) { b.x = -L - (b.x + L); if (b.vx < 0) { b.vx *= -CUSHION; b.vz *= 0.92; events.push({ type: 'rail', n: b.n }); } }
    if (b.z > Wd && !nearCornerX && !inSideMouth) { b.z = Wd - (b.z - Wd); if (b.vz > 0) { b.vz *= -CUSHION; b.vx *= 0.92; events.push({ type: 'rail', n: b.n }); } }
    if (b.z < -Wd && !nearCornerX && !inSideMouth) { b.z = -Wd - (b.z + Wd); if (b.vz < 0) { b.vz *= -CUSHION; b.vx *= 0.92; events.push({ type: 'rail', n: b.n }); } }
    // 口の奥の壁（ポケットを外れて口の中で跳ねる）：台の外へは出さない
    const outL = TABLE.halfL + 0.04;
    const outW = TABLE.halfW + 0.045;
    if (Math.abs(b.x) > outL) { b.x = Math.sign(b.x) * outL; b.vx *= -0.5; }
    if (Math.abs(b.z) > outW) { b.z = Math.sign(b.z) * outW; b.vz *= -0.5; }
  }

  function substep(h) {
    const live = balls.filter((b) => !b.pocketed);
    for (const b of live) {
      const v = Math.hypot(b.vx, b.vz);
      if (v > 0) {
        const nv = Math.max(0, v - (ROLL + DRAG * v) * h);
        const k = nv / v;
        b.vx *= k;
        b.vz *= k;
        if (nv < 0.004) { b.vx = 0; b.vz = 0; }
      }
      b.x += b.vx * h;
      b.z += b.vz * h;
    }
    // 球どうし
    const D = BALL_R * 2;
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const a = live[i];
        const b = live[j];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const dd = dx * dx + dz * dz;
        if (dd >= D * D || dd < 1e-12) continue;
        const d = Math.sqrt(dd);
        const nx = dx / d;
        const nz = dz / d;
        // 重なりを半分ずつ戻す
        const push = (D - d) / 2;
        a.x -= nx * push; a.z -= nz * push;
        b.x += nx * push; b.z += nz * push;
        const rel = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
        if (rel <= 0) continue;
        const j2 = rel * (1 + BALL_E) / 2;
        a.vx -= j2 * nx; a.vz -= j2 * nz;
        b.vx += j2 * nx; b.vz += j2 * nz;
        events.push({ type: 'hit', a: a.n, b: b.n, speed: rel });
      }
    }
    for (const b of live) { if (!pocketCheck(b)) cushions(b); }
  }

  function placeAll(dt = 0) {
    for (const b of balls) {
      if (b.pocketed) {
        // 落ちる（0.25 秒）→ 受け皿に並ぶ
        b.drop = Math.min(1, b.drop + dt / 0.25);
        const inTray = balls.filter((o) => o.pocketed && o.n !== 0 && o.drop >= 1).indexOf(b);
        if (b.drop < 1 || b.n === 0) {
          const p = b.pocket ?? { x: 0, z: 0 };
          tableToWorld(p.x, p.z, b.mesh.position);
          b.mesh.position.y -= b.drop * 0.08;
          b.mesh.visible = b.drop < 1;
        } else {
          b.mesh.visible = true;
          b.mesh.position.set(TABLE.x + table.trayX, table.trayY, TABLE.z - 0.25 + inTray * (BALL_R * 2 + 0.002));
        }
        b.shadow.visible = false;
        continue;
      }
      tableToWorld(b.x, b.z, b.mesh.position);
      b.mesh.visible = true;
      b.shadow.visible = true;
      b.shadow.position.set(b.mesh.position.x + 0.006, SURFACE_Y + 0.0015, b.mesh.position.z + 0.004);
      // 転がった向きへ回す
      const v = Math.hypot(b.vx, b.vz);
      if (v > 1e-4 && dt > 0) {
        axis.set(b.vz, 0, -b.vx).normalize();
        spin.setFromAxisAngle(axis, (v * dt) / BALL_R);
        b.mesh.quaternion.premultiply(spin);
      }
    }
  }

  /** 進める（dt 秒）。動いている球があれば true */
  function step(dt) {
    const n = 8;
    const h = Math.min(dt, 0.05) / n;
    for (let i = 0; i < n; i++) substep(h);
    placeAll(Math.min(dt, 0.05));
    return moving();
  }
  const moving = () => balls.some((b) => !b.pocketed && (b.vx !== 0 || b.vz !== 0));

  /** 手球を突く（台のローカルの向き dirX, dirZ、速さ m/s） */
  function shoot(dirX, dirZ, speed) {
    const l = Math.hypot(dirX, dirZ) || 1;
    cue.vx = (dirX / l) * speed;
    cue.vz = (dirZ / l) * speed;
    events = [];
  }
  /** 手球を置き直す（落ちたとき）。ほかの球と重なる所は避ける */
  function spotCue(x = HEAD_SPOT.x, z = HEAD_SPOT.z) {
    let px = x;
    for (let k = 0; k < 40; k++) {
      if (!balls.some((b) => b !== cue && !b.pocketed && Math.hypot(b.x - px, b.z - z) < BALL_R * 2.1)) break;
      px -= BALL_R * 2.2;
    }
    Object.assign(cue, { x: px, z, vx: 0, vz: 0, pocketed: false, drop: 0, pocket: null });
    placeAll();
  }
  /** 9 番を戻す（フットスポット） */
  function spotBall(n) {
    const b = balls[n];
    let px = FOOT_SPOT.x;
    for (let k = 0; k < 40; k++) {
      if (!balls.some((o) => o !== b && !o.pocketed && Math.hypot(o.x - px, o.z - FOOT_SPOT.z) < BALL_R * 2.1)) break;
      px += BALL_R * 2.2;
    }
    Object.assign(b, { x: px, z: FOOT_SPOT.z, vx: 0, vz: 0, pocketed: false, drop: 0, pocket: null });
    placeAll();
  }

  rack();

  return {
    group,
    room,
    balls,
    cue,
    rack,
    step,
    shoot,
    spotCue,
    spotBall,
    get moving() { return moving(); },
    /** 最後に突いてから起きたこと（pocket / rail / hit） */
    get events() { return events; },
    lamp,
    fill,
  };
}
