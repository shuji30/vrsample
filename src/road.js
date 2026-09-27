import * as THREE from 'three';
import { SEA_LEVEL, hillHeight } from './hill.js';
import { routeCurve } from './cruiser.js';
import {
  HWY_Y, HWY_HALF, ACCESS_HALF, GARAGE, F40_PARK, ROAD_SAMPLES, ACCESS_LENGTH, LOOP_LENGTH,
  accessNearest, loopNearest, rampNearest, roadFrame, accessHalf, RAMP_HALF, RAMP_GRADE_X,
} from './roaddata.js';

/**
 * 高速道路・取り付け道路・ガレージの見た目と、車（gt3.js の createGT3 に track として渡す）の走れる所。
 *
 * 走れる所は、3 本の道（取り付け道路・高速道路・ループ橋）の路面を合わせたもの。車がいちばん「中に入っている」道を選んで、
 * その道の縁の壁（路面の端から 1m 内）で止める。合流の所では 2 本の路面が重なっているので、行き来できる。
 * ループ橋は高速道路の上をまたぐので、上から見ると重なる所がある。車の高さから 2.5m 以上離れた道は選ばない。
 * s は、取り付け道路なら 0〜、高速道路なら LOOP_OFS、ループ橋なら RAMP_OFS を足した値（gt3.js の state.s にそのまま入る）。
 *
 * 高架の橋脚は、クルーザーの航路（cruiser.js）から 14m 以内には立てない。ジェットスキーは橋脚にぶつかる（pierBlocked）。
 */
export const LOOP_OFS = 10000;
/** ループ橋の s に足す値 */
export const RAMP_OFS = 20000;
const { accessPts, accessTan, loopPts, loopTan, NA, NL, rampPts, rampTan, NR } = ROAD_SAMPLES;

/** 路面の模様（アスファルト・両わきの白線・真ん中の破線）。v は 12m で 1 回 */
function roadTexture(lanes) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = '#44474d';
  x.fillRect(0, 0, 256, 256);
  // 細かいざらつき
  for (let i = 0; i < 1400; i++) {
    const g = 60 + Math.floor(Math.random() * 30);
    x.fillStyle = `rgb(${g},${g + 2},${g + 6})`;
    x.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  x.fillStyle = '#f2f2ee';
  x.fillRect(8, 0, 5, 256);
  x.fillRect(243, 0, 5, 256);
  // 車線の境（破線）。高速道路は真ん中に 2 本（上り・下り）と、片側 2 車線の破線
  const dash = (u) => x.fillRect(u - 2, 0, 4, 128);
  if (lanes === 4) {
    x.fillStyle = '#e8c547';
    x.fillRect(124, 0, 3, 256);
    x.fillRect(130, 0, 3, 256);
    x.fillStyle = '#f2f2ee';
    dash(68);
    dash(188);
  } else {
    dash(128);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** 中心線の点から、半幅 half の帯（路面）を作る。closed は輪。skip(i) が真の点は作らない */
function ribbon(pts, tans, halfAt, closed, mat, lift = 0.02) {
  const pos = [];
  const uv = [];
  const idx = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const t = tans[i];
    const h = halfAt(i);
    const nx = t.z;
    const nz = -t.x;
    pos.push(p.x + nx * h, p.y + lift, p.z + nz * h, p.x - nx * h, p.y + lift, p.z - nz * h);
    uv.push(0, i / 12, 1, i / 12);
  }
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = i * 2;
    const b = ((i + 1) % n) * 2;
    // 上から見て左回り（表が上）になる向きに
    idx.push(a, a + 1, b, a + 1, b + 1, b);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat);
  m.receiveShadow = true;
  return m;
}

/** 路面の縁のコンクリートの壁（高さ 0.9m）。keep(i, side) が偽の所は作らない（合流の所の切れ目） */
function barriers(pts, tans, halfAt, closed, keep, mat) {
  const pos = [];
  const n = pts.length;
  const quad = (a, b, c, d) => pos.push(...a, ...b, ...c, ...a, ...c, ...d);
  for (const side of [-1, 1]) {
    const segs = closed ? n : n - 1;
    for (let i = 0; i < segs; i += 2) {
      const j = Math.min(closed ? (i + 2) % n : i + 2, n - 1);
      if (!keep(i, side) || !keep(j, side)) continue;
      const P = (k, off, y) => {
        const p = pts[k];
        const t = tans[k];
        const h = halfAt(k) + off;
        return [p.x + t.z * h * side, p.y + y, p.z - t.x * h * side];
      };
      // 内側の面・上の面・外側の面
      quad(P(i, 0, 0), P(j, 0, 0), P(j, 0, 0.9), P(i, 0, 0.9));
      quad(P(i, 0, 0.9), P(j, 0, 0.9), P(j, 0.35, 0.9), P(i, 0.35, 0.9));
      quad(P(i, 0.35, 0.9), P(j, 0.35, 0.9), P(j, 0.35, -0.9), P(i, 0.35, -0.9));
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: mat, roughness: 0.85, side: THREE.DoubleSide }));
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function signTexture(lines, bg = '#1f7a45') {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 192;
  const x = c.getContext('2d');
  x.fillStyle = bg;
  x.fillRect(0, 0, 512, 192);
  x.strokeStyle = '#fff';
  x.lineWidth = 6;
  x.strokeRect(8, 8, 496, 176);
  x.fillStyle = '#fff';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.font = 'bold 64px sans-serif';
  x.fillText(lines[0], 256, 74);
  x.font = 'bold 36px sans-serif';
  x.fillText(lines[1] ?? '', 256, 148);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** ガレージ（床・北と南の壁・西の壁の北寄り・屋根・東の上のシャッターの箱・天井の灯） */
function makeGarage() {
  const g = new THREE.Group();
  const G = GARAGE;
  const wall = new THREE.MeshStandardMaterial({ color: 0xe6e1d6, roughness: 0.85 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x6c6f75, roughness: 0.6, metalness: 0.3 });
  const floor = new THREE.MeshStandardMaterial({ color: 0x9a9a98, roughness: 0.9 });
  const shade = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };
  const box = (w, h, d, mat, x, y, z) => { const m = shade(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)); m.position.set(x, y, z); g.add(m); return m; };
  const cx = (G.minX + G.maxX) / 2;
  const cz = (G.minZ + G.maxZ) / 2;
  const W = G.maxX - G.minX;
  const D = G.maxZ - G.minZ;
  box(W, 0.04, D, floor, cx, 0.02, cz);
  box(W, G.height, 0.14, wall, cx, G.height / 2, G.minZ - 0.07);
  box(W, G.height, 0.14, wall, cx, G.height / 2, G.maxZ + 0.07);
  box(0.14, G.height, G.westWallTo - G.minZ, wall, G.minX - 0.07, G.height / 2, (G.minZ + G.westWallTo) / 2);
  box(0.14, 0.5, G.maxZ - G.westWallTo, wall, G.minX - 0.07, G.height - 0.25, (G.maxZ + G.westWallTo) / 2);
  box(W + 0.4, 0.14, D + 0.5, wall, cx, G.height + 0.07, cz);
  // 東の出入り口の上：巻き上げたシャッターの箱
  box(0.4, 0.4, D, trim, G.maxX - 0.2, G.height - 0.2, cz);
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.05, 0.12), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4dc, emissiveIntensity: 1.2 }));
  lamp.position.set(cx, G.height - 0.05, cz);
  g.add(lamp);
  // 奥の棚とタイヤ（飾り）
  box(0.4, 1.4, 2.0, trim, G.minX + 0.3, 0.7, G.minZ + 1.2).visible = true;
  const tire = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 });
  for (let i = 0; i < 3; i++) {
    const t = shade(new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.25, 16), tire));
    t.position.set(G.minX + 0.4, 0.13 + i * 0.26, G.maxZ - 0.5);
    g.add(t);
  }
  return g;
}

export function createRoad() {
  const group = new THREE.Group();
  group.name = 'road';
  const accessMat = new THREE.MeshStandardMaterial({ map: roadTexture(2), roughness: 0.9 });
  const hwyMat = new THREE.MeshStandardMaterial({ map: roadTexture(4), roughness: 0.9 });
  const halfA = (i) => accessHalf(i);
  group.add(ribbon(accessPts, accessTan, halfA, false, accessMat, 0.03));
  group.add(ribbon(loopPts, loopTan, () => HWY_HALF, true, hwyMat, 0.02));
  // ループ橋（1 車線。白線は取り付け道路と同じ模様）。高速道路と重なる分かれ目では、高速道路より少し上に
  group.add(ribbon(rampPts, rampTan, () => RAMP_HALF, false, accessMat, 0.035));
  // 高架の床版（路面の下の厚み。横から見て板に見えるように）
  {
    const pos = [];
    const quad = (a, b, c, d) => pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    for (let i = 0; i < NL; i += 2) {
      const j = (i + 2) % NL;
      for (const side of [-1, 1]) {
        const P = (k, y) => { const p = loopPts[k]; const t = loopTan[k]; const h = HWY_HALF + 0.35; return [p.x + t.z * h * side, p.y + y, p.z - t.x * h * side]; };
        quad(P(i, -0.9), P(j, -0.9), P(j, 0), P(i, 0));
      }
      const B = (k, side) => { const p = loopPts[k]; const t = loopTan[k]; const h = HWY_HALF + 0.35; return [p.x + t.z * h * side, p.y - 0.9, p.z - t.x * h * side]; };
      quad(B(i, 1), B(j, 1), B(j, -1), B(i, -1));
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    const deck = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xb4b2ab, roughness: 0.9, side: THREE.DoubleSide }));
    deck.receiveShadow = true;
    group.add(deck);
  }
  // ループ橋の床版（橋のところ。丘の側の地面すれすれの所と、高速道路の路面に重なる分かれ目は作らない）
  {
    const pos = [];
    const quad = (a, b, c, d) => pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    const onBridge = (k) => rampPts[k].x > RAMP_GRADE_X && rampPts[k].y > HWY_Y + 0.6;
    for (let i = 0; i < NR - 1; i += 2) {
      const j = Math.min(NR, i + 2);
      if (!onBridge(i) || !onBridge(j)) continue;
      const P = (k, y, side) => { const p = rampPts[k]; const t = rampTan[k]; const h = RAMP_HALF + 0.35; return [p.x + t.z * h * side, p.y + y, p.z - t.x * h * side]; };
      for (const side of [-1, 1]) quad(P(i, -0.8, side), P(j, -0.8, side), P(j, 0, side), P(i, 0, side));
      quad(P(i, -0.8, 1), P(j, -0.8, 1), P(j, -0.8, -1), P(i, -0.8, -1));
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    const rampDeck = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xb4b2ab, roughness: 0.9, side: THREE.DoubleSide }));
    rampDeck.receiveShadow = true;
    rampDeck.castShadow = true;
    group.add(rampDeck);
  }
  // 壁。合流の所では、もう一方の道の路面の中に入る部分を作らない
  // y を渡すと、その高さから 2m 以内の路面だけを見る（ループ橋と、その下の高速道路を取り違えない）
  const insideLoop = (x, z, y = null) => (y === null || Math.abs(y - HWY_Y) < 2) && Math.abs(loopNearest(x, z).lateral) < HWY_HALF - 0.2;
  const insideAccess = (x, z, y = null) => { const a = accessNearest(x, z); return a.along > 0 && a.along < NA && Math.abs(a.lateral) < accessHalf(a.s) - 0.2 && (y === null || Math.abs(y - a.y) < 2); };
  const insideRamp = (x, z, y = null, margin = 0.2) => { const r = rampNearest(x, z); return r.along > 0 && r.along < NR && Math.abs(r.lateral) < RAMP_HALF - margin && (y === null || Math.abs(y - r.y) < 2); };
  const edge = (pts, tans, halfAt, i, side) => { const p = pts[i]; const t = tans[i]; const h = halfAt(i) + 0.2; return [p.x + t.z * h * side, p.z - t.x * h * side]; };
  const accessKeep = (i, side) => {
    const p = accessPts[i];
    if (p.x < GARAGE.maxX + 0.2) return false;              // ガレージの中は壁がある
    const [x, z] = edge(accessPts, accessTan, halfA, i, side);
    return !insideLoop(x, z, p.y) && !insideRamp(x, z, p.y);
  };
  const loopKeep = (i, side) => {
    const [x, z] = edge(loopPts, loopTan, () => HWY_HALF, i, side);
    return !insideAccess(x, z, HWY_Y) && !insideRamp(x, z, HWY_Y);
  };
  const rampKeep = (i, side) => {
    const p = rampPts[i];
    const [x, z] = edge(rampPts, rampTan, () => RAMP_HALF, i, side);
    return !insideLoop(x, z, p.y) && !insideAccess(x, z, p.y);
  };
  group.add(barriers(accessPts, accessTan, halfA, false, accessKeep, 0xc9c6bd));
  group.add(barriers(loopPts, loopTan, () => HWY_HALF, true, loopKeep, 0xd4d1c8));
  group.add(barriers(rampPts, rampTan, () => RAMP_HALF, false, rampKeep, 0xc9c6bd));
  // 橋脚（36m ごと。路面の下が 1m より高いところ。クルーザーの航路の近くは立てない）
  const route = routeCurve().getSpacedPoints(600);
  const nearRoute = (x, z) => route.some((p) => Math.hypot(p.x - x, p.z - z) < 14);
  const piers = [];
  {
    const pierMat = new THREE.MeshStandardMaterial({ color: 0xa9a7a0, roughness: 0.9 });
    const colGeo = new THREE.CylinderGeometry(0.9, 1.1, 1, 12);
    const capGeo = new THREE.BoxGeometry(HWY_HALF * 2 - 1, 0.8, 1.6);
    for (let i = 0; i < NL; i += 36) {
      const p = loopPts[i];
      const ground = hillHeight(p.x, p.z);
      const bottom = ground < SEA_LEVEL ? SEA_LEVEL - 6 : ground;
      const top = HWY_Y - 0.9;
      if (top - bottom < 1 || nearRoute(p.x, p.z)) continue;
      const yaw = Math.atan2(loopTan[i].x, loopTan[i].z);
      const cap = new THREE.Mesh(capGeo, pierMat);
      cap.position.set(p.x, top - 0.4, p.z);
      cap.rotation.y = yaw + Math.PI / 2;
      cap.castShadow = true;
      group.add(cap);
      for (const side of [-1, 1]) {
        const x = p.x + loopTan[i].z * 3.8 * side;
        const z = p.z - loopTan[i].x * 3.8 * side;
        const col = new THREE.Mesh(colGeo, pierMat);
        col.scale.y = top - 0.8 - bottom;
        col.position.set(x, (top - 0.8 + bottom) / 2, z);
        col.castShadow = true;
        group.add(col);
        piers.push({ x, z });
      }
    }
  }
  // ループ橋の橋脚（18m ごと、真ん中に 1 本。下の道の路面の上には立てない）
  {
    const pierMat = new THREE.MeshStandardMaterial({ color: 0xa9a7a0, roughness: 0.9 });
    const colGeo = new THREE.CylinderGeometry(0.7, 0.85, 1, 12);
    const capGeo = new THREE.BoxGeometry(RAMP_HALF * 2 - 0.6, 0.6, 1.2);
    for (let i = 8; i < NR - 4; i += 18) {
      const p = rampPts[i];
      if (p.x < RAMP_GRADE_X) continue;
      const top = p.y - 0.8;
      const bottom = hillHeight(p.x, p.z);
      if (top - bottom < 1.2) continue;
      // 下の道（高速道路・取り付け道路・ループ橋の低い所）の路面の上なら、少しずらして立てる。ずらしても重なれば立てない
      const t = rampTan[i];
      let x = p.x;
      let z = p.z;
      const blocked = (px, pz) => insideLoop(px, pz, null) || insideAccess(px, pz, null) || (rampNearest(px, pz).y < p.y - 2 && insideRamp(px, pz, null, -1.5));
      if (blocked(x, z)) {
        const alt = [[t.z, -t.x], [-t.z, t.x]].map(([nx, nz]) => [p.x + nx * (RAMP_HALF + 0.9), p.z + nz * (RAMP_HALF + 0.9)]).find(([ax, az]) => !blocked(ax, az));
        if (!alt) continue;
        [x, z] = alt;
      }
      const yaw = Math.atan2(t.x, t.z);
      const cap = new THREE.Mesh(capGeo, pierMat);
      cap.position.set(p.x, top - 0.3, p.z);
      cap.rotation.y = yaw + Math.PI / 2;
      cap.castShadow = true;
      group.add(cap);
      const col = new THREE.Mesh(colGeo, pierMat);
      col.scale.y = top - 0.6 - bottom;
      col.position.set(x, (top - 0.6 + bottom) / 2, z);
      col.castShadow = true;
      group.add(col);
    }
  }
  // 案内の標識（緑の板）：取り付け道路の丘の縁と、高速道路の合流の手前（北から・南から）
  const signMat = (lines) => new THREE.MeshBasicMaterial({ map: signTexture(lines), side: THREE.DoubleSide });
  const post = new THREE.MeshStandardMaterial({ color: 0x8b8f96, roughness: 0.5, metalness: 0.5 });
  const gantry = (x, z, yaw, lines, span, h = 5.6) => {
    const s = new THREE.Group();
    s.position.set(x, hillHeight(x, z) > HWY_Y + 0.5 ? 0 : HWY_Y, z);
    s.rotation.y = yaw;
    for (const side of [-1, 1]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, h, 8), post);
      pole.position.set(side * span, h / 2, 0);
      s.add(pole);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(span * 2, 0.25, 0.25), post);
    beam.position.y = h;
    s.add(beam);
    const board = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 1.6), signMat(lines));
    board.position.set(0, h - 1.0, 0.15);
    s.add(board);
    group.add(s);
    return s;
  };
  // 取り付け道路の東の縁（西から来る車に見える）
  const signA = gantry(36, 3.4, -Math.PI / 2, ['高速道路', 'この先 合流'], ACCESS_HALF + 0.6);
  signA.position.y = 0;
  // 高速道路：南へ走る車（北から来る）には、左の車線からループ橋へ。北へ走る車（南から来る）には、左の取り付け道路へ
  // （前は南へ走る車にも右の取り付け道路を案内していて、ほぼ U ターンだった）
  gantry(80, -120, Math.PI, ['出口 おかのうえ', '← 左車線 ループ橋'], HWY_HALF + 0.6);
  gantry(80, 175, 0, ['出口 おかのうえ', '家・ガレージ ←'], HWY_HALF + 0.6);
  group.add(makeGarage());

  // --- 街灯（夜のドライブ用） -----------------------------------------------------------
  // 高速道路は 40m ごとに左右交互（片側 80m ごと）、取り付け道路は 30m ごと。支柱は壁の外、腕を道の上へ伸ばす。
  // 数十本の本物の光源は重いので、灯具を光らせ、真下の路面に加算の「光だまり」を置いて照らして見せる
  // （光だまりは夜・夕方だけ。灯具は霧に埋もれないように fog を切る。遠くまで灯の列が見える）
  const lamps = [];
  const addLamp = (p, t, half, side) => {
    const nx = t.z * side;
    const nz = -t.x * side;
    const px = p.x + nx * (half + 0.9);
    const pz = p.z + nz * (half + 0.9);
    const hx = p.x + nx * Math.max(0, half - 2.6);
    const hz = p.z + nz * Math.max(0, half - 2.6);
    lamps.push({ px, pz, hx, hz, y: p.y, yaw: Math.atan2(hx - px, hz - pz) });
  };
  for (let i = 0, k = 0; i < NL; i += 40, k++) {
    const side = k % 2 ? 1 : -1;
    const p = loopPts[i];
    const t = loopTan[i];
    const lx = p.x + t.z * side * (HWY_HALF + 0.9);
    const lz = p.z - t.x * side * (HWY_HALF + 0.9);
    if (insideAccess(lx, lz)) continue;
    // ループ橋の路面の上や、橋の下（支柱が橋を突き抜ける）には立てない
    if (insideRamp(lx, lz, null, -3) || insideRamp(p.x, p.z, null, -3)) continue;
    addLamp(p, t, HWY_HALF, side);
  }
  // ループ橋も 30m ごと（ループの外側・橋の両わき）。下の道の路面の上には立てない
  for (let i = 10, k = 0; i < NR - 10; i += 30, k++) {
    const p = rampPts[i];
    const t = rampTan[i];
    const side = k % 2 ? 1 : -1;
    const lx = p.x + t.z * side * (RAMP_HALF + 0.9);
    const lz = p.z - t.x * side * (RAMP_HALF + 0.9);
    if (insideLoop(lx, lz) || insideAccess(lx, lz)) continue;
    addLamp(p, t, RAMP_HALF, side);
  }
  for (let i = 12, k = 0; i < NA - 24; i += 30, k++) {
    const p = accessPts[i];
    if (p.x < GARAGE.maxX + 3) continue;
    addLamp(p, accessTan[i], ACCESS_HALF, k % 2 ? 1 : -1);
  }
  const LAMP_H = 9;
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x8d9197, roughness: 0.5, metalness: 0.6 });
  const headMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, emissive: 0xffd9a0, emissiveIntensity: 0.05, roughness: 0.4, fog: false });
  const poolTex = (() => {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  })();
  const poolMat = new THREE.MeshBasicMaterial({ map: poolTex, color: 0xffc98a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.1, 0.15, LAMP_H, 8), poleMat, lamps.length);
  const arms = new THREE.InstancedMesh(new THREE.BoxGeometry(0.08, 0.08, 1), poleMat, lamps.length);
  const heads = new THREE.InstancedMesh(new THREE.BoxGeometry(0.42, 0.14, 0.9), headMat, lamps.length);
  const poolGeo = new THREE.PlaneGeometry(18, 18);
  poolGeo.rotateX(-Math.PI / 2);
  const pools = new THREE.InstancedMesh(poolGeo, poolMat, lamps.length);
  pools.renderOrder = 3;
  {
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const sc = new THREE.Vector3();
    lamps.forEach((l, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), l.yaw);
      poles.setMatrixAt(i, m4.compose(v.set(l.px, l.y + LAMP_H / 2, l.pz), new THREE.Quaternion(), sc.set(1, 1, 1)));
      const len = Math.hypot(l.hx - l.px, l.hz - l.pz);
      arms.setMatrixAt(i, m4.compose(v.set((l.px + l.hx) / 2, l.y + LAMP_H - 0.05, (l.pz + l.hz) / 2), q, sc.set(1, 1, len)));
      heads.setMatrixAt(i, m4.compose(v.set(l.hx, l.y + LAMP_H - 0.12, l.hz), q, sc.set(1, 1, 1)));
      pools.setMatrixAt(i, m4.compose(v.set(l.hx, l.y + 0.06, l.hz), q, sc.set(1, 1, 1)));
    });
    for (const m of [poles, arms, heads]) { m.castShadow = true; m.instanceMatrix.needsUpdate = true; }
    pools.instanceMatrix.needsUpdate = true;
    pools.visible = false;
    group.add(poles, arms, heads, pools);
  }
  /** 夜の明るさ（0 = 昼、0.5 = 夕方、1 = 夜）：街灯を灯して、路面に光だまりを出す */
  function setNight(level) {
    headMat.emissiveIntensity = level > 0 ? 2.2 + level * 2 : 0.05;
    pools.visible = level > 0;
    poolMat.opacity = 0.6 * level;
  }

  // --- 走れる所（gt3.js の track） -------------------------------------------------
  const fa = { p: new THREE.Vector3(), t: new THREE.Vector3(), n: new THREE.Vector3() };
  const fl = { p: new THREE.Vector3(), t: new THREE.Vector3(), n: new THREE.Vector3() };
  const track = {
    length: LOOP_LENGTH,
    /** y（車の高さ）を渡すと、そこから 2.5m 以上上や下の道は選ばない（橋と、その下の道） */
    nearest(x, z, sHint = null, y = null) {
      const onRamp = sHint !== null && sHint >= RAMP_OFS;
      const onLoop = sHint !== null && sHint >= LOOP_OFS && !onRamp;
      const onAccess = sHint !== null && sHint < LOOP_OFS;
      const a = accessNearest(x, z, onAccess ? sHint : null);
      const l = loopNearest(x, z, onLoop ? sHint - LOOP_OFS : null);
      const r = rampNearest(x, z, onRamp ? sHint - RAMP_OFS : null);
      const ha = accessHalf(a.s);
      // どの道にどれだけ入っているか（負ほど内側）。取り付け道路・ループ橋の端より先は、その道の外
      const inA = a.along < -0.01 && a.s <= 0 ? Math.abs(a.lateral) - ha + 0.5 : a.along > NA ? 99 : Math.abs(a.lateral) - ha;
      const inL = Math.abs(l.lateral) - HWY_HALF;
      const inR = r.along < 0 || r.along > NR ? 99 : Math.abs(r.lateral) - RAMP_HALF;
      const cands = [
        { in: inA, y: a.y, hit: () => ({ s: a.s, lateral: a.lateral, y: a.y, road: 'access', half: ha, along: a.along }) },
        { in: inL, y: l.y, hit: () => ({ s: l.s + LOOP_OFS, lateral: l.lateral, y: l.y, road: 'loop', half: HWY_HALF }) },
        { in: inR, y: r.y, hit: () => ({ s: r.s + RAMP_OFS, lateral: r.lateral, y: r.y, road: 'ramp', half: RAMP_HALF, along: r.along }) },
      ];
      const ok = y === null ? cands : cands.filter((c) => Math.abs(c.y - y) < 2.5);
      const pool = ok.length ? ok : cands;
      let best = pool[0];
      for (const c of pool) if (c.in < best.in) best = c;
      return best.hit();
    },
    frame(s) {
      if (s >= RAMP_OFS) return roadFrame('ramp', s - RAMP_OFS, fl);
      return s >= LOOP_OFS ? roadFrame('loop', s - LOOP_OFS, fl) : roadFrame('access', s, fa);
    },
    onGrass: () => false,
    // 路面の端から 1m 内（車の半幅ぶん）で止める
    limit: (after) => after.half - 1.0,
    targetY: (after) => after.y,
    /** ガレージの奥の壁（取り付け道路の始まりより後ろへは下がれない） */
    constrain(pos, after) {
      if (after.road !== 'access' || after.along > -0.2) return false;
      roadFrame('access', 0, fa);
      const back = -0.2 - after.along;
      pos.x += fa.t.x * back;
      pos.z += fa.t.z * back;
      return true;
    },
  };

  return {
    group,
    track,
    setNight,
    lamps,
    /** 高架の橋脚にぶつかるか（ジェットスキー） */
    pierBlocked(x, z) { return piers.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < 2.2 * 2.2); },
    /** ガレージの壁（歩いて通り抜けない。world.js の clampToBounds） */
    garageBlocks(x, z, inset = 0) {
      const G = GARAGE;
      const m = 0.1 + inset;
      if (x > G.minX - m && x < G.maxX + m && Math.abs(z - (G.minZ - 0.07)) < 0.07 + m) return true;
      if (x > G.minX - m && x < G.maxX + m && Math.abs(z - (G.maxZ + 0.07)) < 0.07 + m) return true;
      return Math.abs(x - (G.minX - 0.07)) < 0.07 + m && z > G.minZ - m && z < G.westWallTo + m;
    },
    piers,
    accessLength: ACCESS_LENGTH,
    park: F40_PARK,
  };
}
