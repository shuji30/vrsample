import * as THREE from 'three';

/**
 * 高速道路と、家の横のガレージからの取り付け道路の形（road.js が道を作り、hill.js が道の下の地形をならす）。
 * three.js のほかは読まない（hill.js から読むので、hill.js を読むと輪になる）。
 *
 * - 取り付け道路：家の東の芝生の東の端のガレージ（F40 ふうの車を東向きに止めてある）から東へ、丘の上の東の縁
 *   （x 35）を越えて、ふもとへ下りながら南へ曲がり、高速道路の東の直線に西から合流する（幅 7m、対面通行）
 * - 高速道路：丘・飛行場・北の海の上を大きく回る輪（角を半径 120m で丸めた長方形、約 2.1km、幅 14m）。
 *   高さは y -8 で一定（海の上は高架、東の直線はサーキットの平らな所（y -10）のすぐ西の地面の少し上）
 */
export const HWY_Y = -8;
export const HWY_HALF = 7;
export const ACCESS_HALF = 3.5;
/** ガレージ（家の東の芝生の東の端。東が車の出入り口、西の南寄りが人の出入り口） */
export const GARAGE = { minX: 18.6, maxX: 24.8, minZ: 0.8, maxZ: 6.0, height: 2.6, westWallTo: 2.2 };
/** 車を止めておく所（ガレージの中、東向き） */
export const F40_PARK = { x: 21.6, z: 3.4, yaw: Math.PI / 2, y: 0 };
/** ガレージの中の道の半幅（車の中心が壁に当たらないところまで。外は ACCESS_HALF） */
const GARAGE_HALF = (GARAGE.maxZ - GARAGE.minZ) / 2;
/** 高速道路の輪（上から見た、角を丸めた長方形） */
const LOOP = { minX: -520, maxX: 80, minZ: -250, maxZ: 320, r: 120 };

// --- 取り付け道路 ------------------------------------------------------------------
const ACCESS_POINTS = [[F40_PARK.x, F40_PARK.z], [26, 3.4], [34, 3.4], [46, 5.5], [57, 13], [64, 26], [67.5, 44], [70, 64], [74, 84], [78.5, 102], [80, 116], [80, 130]];
const accessCurve = new THREE.CatmullRomCurve3(ACCESS_POINTS.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
export const ACCESS_LENGTH = accessCurve.getLength();
const NA = Math.round(ACCESS_LENGTH);
const accessPts = accessCurve.getSpacedPoints(NA);
const accessTan = accessPts.map((_, i) => accessCurve.getTangentAt(Math.min(1, i / NA)).setY(0).normalize());
const smooth = (t) => { const c = Math.min(1, Math.max(0, t)); return c * c * (3 - 2 * c); };
// 高さ：丘の上（x 34 まで）は 0、そこから、高速道路の路面に重なり始める所（中心どうしが 11m）までで y -8 へ
const sTop = accessPts.findIndex((p) => p.x > 34);
const sLow = accessPts.findIndex((p) => Math.abs(p.x - LOOP.maxX) < HWY_HALF + ACCESS_HALF + 0.5);
// 下り坂は、始めと終わりの 25% だけなめらかに曲げ、あいだはまっすぐ（smoothstep だと真ん中が 17% と急だった）
const ramp = (t) => {
  const c = Math.min(1, Math.max(0, t));
  const a = 0.25;
  if (c < a) return (c * c) / (2 * a * (1 - a));
  if (c > 1 - a) return 1 - ((1 - c) ** 2) / (2 * a * (1 - a));
  return (c - a / 2) / (1 - a);
};
accessPts.forEach((p, i) => { p.y = HWY_Y * ramp((i - sTop) / (sLow - sTop)); });
/** 取り付け道路の s（m）での半幅 */
export function accessHalf(s) {
  const p = accessPts[Math.max(0, Math.min(NA, Math.round(s)))];
  // ガレージの中は壁まで、出口から 3m で道の幅へ
  return p.x < GARAGE.maxX ? GARAGE_HALF : THREE.MathUtils.lerp(GARAGE_HALF, ACCESS_HALF, smooth((p.x - GARAGE.maxX) / 3));
}

// --- 高速道路の輪（1m ごとに点を作る） ------------------------------------------------
const loopPts = [];
const loopTan = [];
{
  const { minX, maxX, minZ, maxZ, r } = LOOP;
  // 東の直線（南へ）→ 南東の角 → 南の直線（西へ）→ 南西 → 西（北へ）→ 北西 → 北（東へ）→ 北東 → 東へ戻る
  const parts = [
    ['line', [maxX, minZ + r], [maxX, maxZ - r]],
    ['arc', [maxX - r, maxZ - r], 0, Math.PI / 2],
    ['line', [maxX - r, maxZ], [minX + r, maxZ]],
    ['arc', [minX + r, maxZ - r], Math.PI / 2, Math.PI],
    ['line', [minX, maxZ - r], [minX, minZ + r]],
    ['arc', [minX + r, minZ + r], Math.PI, Math.PI * 1.5],
    ['line', [minX + r, minZ], [maxX - r, minZ]],
    ['arc', [maxX - r, minZ + r], Math.PI * 1.5, Math.PI * 2],
  ];
  for (const part of parts) {
    if (part[0] === 'line') {
      const [, a, b] = part;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const n = Math.round(len);
      for (let i = 0; i < n; i++) {
        const k = i / n;
        loopPts.push(new THREE.Vector3(a[0] + (b[0] - a[0]) * k, HWY_Y, a[1] + (b[1] - a[1]) * k));
        loopTan.push(new THREE.Vector3((b[0] - a[0]) / len, 0, (b[1] - a[1]) / len));
      }
    } else {
      const [, c, a0, a1] = part;
      const n = Math.round(r * (a1 - a0));
      for (let i = 0; i < n; i++) {
        const a = a0 + (a1 - a0) * (i / n);
        // 角度 a の点は (cos a, sin a)。進む向きは a が増える向き
        loopPts.push(new THREE.Vector3(c[0] + Math.cos(a) * r, HWY_Y, c[1] + Math.sin(a) * r));
        loopTan.push(new THREE.Vector3(-Math.sin(a), 0, Math.cos(a)));
      }
    }
  }
}
export const LOOP_LENGTH = loopPts.length;
const NL = LOOP_LENGTH;
const wrapL = (s) => ((s % NL) + NL) % NL;

/** 道の中心線の点・向き・左向き（road: 'access' | 'loop'） */
export function roadFrame(road, s, out = { p: new THREE.Vector3(), t: new THREE.Vector3(), n: new THREE.Vector3() }) {
  if (road === 'loop') {
    const u = wrapL(s);
    const i = Math.floor(u) % NL;
    const j = (i + 1) % NL;
    const f = u - Math.floor(u);
    out.p.lerpVectors(loopPts[i], loopPts[j], f);
    out.t.lerpVectors(loopTan[i], loopTan[j], f).normalize();
  } else {
    const u = THREE.MathUtils.clamp(s, 0, NA);
    const i = Math.min(NA - 1, Math.floor(u));
    const f = u - i;
    out.p.lerpVectors(accessPts[i], accessPts[i + 1], f);
    out.t.lerpVectors(accessTan[i], accessTan[i + 1], f).normalize();
  }
  out.n.set(out.t.z, 0, -out.t.x);
  return out;
}

/** 取り付け道路でいちばん近い所 { s, lateral, y, along（始まりより手前なら負） } */
export function accessNearest(x, z, sHint = null) {
  let best = 0;
  let bestD = Infinity;
  const check = (i) => { const p = accessPts[i]; const d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < bestD) { bestD = d; best = i; } };
  if (sHint === null) for (let i = 0; i <= NA; i++) check(i);
  else for (let i = Math.max(0, Math.floor(sHint) - 60); i <= Math.min(NA, Math.floor(sHint) + 60); i++) check(i);
  const t = accessTan[best];
  const dx = x - accessPts[best].x;
  const dz = z - accessPts[best].z;
  const along = best + dx * t.x + dz * t.z;
  const s = THREE.MathUtils.clamp(along, 0, NA);
  const i = Math.min(NA - 1, Math.floor(s));
  const y = THREE.MathUtils.lerp(accessPts[i].y, accessPts[i + 1].y, s - i);
  return { s, lateral: dx * t.z - dz * t.x, y, along };
}

/** 高速道路でいちばん近い所 { s, lateral, y } */
export function loopNearest(x, z, sHint = null) {
  let best = 0;
  let bestD = Infinity;
  const check = (i) => { const p = loopPts[i]; const d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < bestD) { bestD = d; best = i; } };
  if (sHint === null) for (let i = 0; i < NL; i += 2) check(i);
  else for (let k = -80; k <= 80; k += 2) check(Math.floor(wrapL(sHint + k)) % NL);
  for (let k = -3; k <= 3; k++) check((best + k + NL) % NL);
  const t = loopTan[best];
  const dx = x - loopPts[best].x;
  const dz = z - loopPts[best].z;
  return { s: wrapL(best + dx * t.x + dz * t.z), lateral: dx * t.z - dz * t.x, y: HWY_Y };
}

/**
 * 地形をならす所（hill.js）：取り付け道路の丘の外の部分のまわり。{ w（1 = 道の下、0 = 12m 外）, y } か null。
 * 道の下は路面より 5cm 下に、まわりはなめらかに（切り通し・盛り土）
 */
export function roadCorridor(x, z) {
  if (x < 30 || x > 96 || z < -6 || z > 142) return null;
  let best = 0;
  let bestD = Infinity;
  for (let i = Math.max(0, sTop - 6); i <= NA; i++) { const p = accessPts[i]; const d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < bestD) { bestD = d; best = i; } }
  const d = Math.sqrt(bestD) - ACCESS_HALF - 2;
  if (d > 12) return null;
  return { w: 1 - smooth(d / 12), y: accessPts[best].y - 0.05 };
}

/** 道（取り付け道路・高速道路）から margin 以内か（木を生やさないため。hill.js） */
export function nearRoad(x, z, margin = 15) {
  const m2 = (HWY_HALF + margin) ** 2;
  for (let i = 0; i < NL; i += 4) { const p = loopPts[i]; if ((p.x - x) ** 2 + (p.z - z) ** 2 < m2) return true; }
  const a2 = (ACCESS_HALF + margin) ** 2;
  for (let i = 0; i <= NA; i += 2) { const p = accessPts[i]; if ((p.x - x) ** 2 + (p.z - z) ** 2 < a2) return true; }
  return false;
}

/** road.js が道の形を作るための点（そのまま渡す。書き換えない） */
export const ROAD_SAMPLES = { accessPts, accessTan, loopPts, loopTan, NA, NL };
