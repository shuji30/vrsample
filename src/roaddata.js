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

// --- ループ橋（高速道路の東の直線を南へ走ってきて、ガレージへ戻る出口） ------------------------------
// 取り付け道路は高速道路に西から南向きに合流するので、一周して南向きに戻ってくると、取り付け道路へは
// ほぼ U ターン（鋭角）になっていた。左（東）の車線から分かれ、左回りに 270° 回りながら上がって西向きになり、
// 高速道路（と、分かれた車線）の上を橋でまたいで西へ進み、丘の上でガレージの手前の取り付け道路に合流する。
// 東の直線の東は、サーキットの平らな所（y -10）の西の端で、サーキットの路面（x 132 より東）とは離れている
export const RAMP_HALF = 4;
const RAMP_LOOP = { x: 117, z: 14, r: 25 };
const RAMP_POINTS = (() => {
  const pts = [
    // 分かれる：高速道路の東の車線（中心の 3m 東）から、少しずつ東へ
    [83, -92, HWY_Y], [83.2, -78, HWY_Y], [84.6, -62, HWY_Y], [87.4, -46, HWY_Y + 0.05], [90.4, -30, HWY_Y + 0.2],
    [92.1, -14, HWY_Y + 0.5], [92.3, 2, HWY_Y + 0.85],
  ];
  // ループ（西の点で南向き → 南 → 東 → 北の点で西向き。左回り 270°）。上がりながら
  const { x, z, r } = RAMP_LOOP;
  const n = 12;
  for (let k = 0; k <= n; k++) {
    const a = Math.PI - (1.5 * Math.PI * k) / n;
    pts.push([x + Math.cos(a) * r, z + Math.sin(a) * r, HWY_Y + 1.1 + (5.4 * k) / n]);
  }
  // 橋：高速道路の上を西へ（路面 y -1.5。高速道路の路面から 6.5m 上）。そのあと丘の上へゆるく上がって合流。
  // ループの半径は 25m（22m では 54km/h で外の壁に当たった）
  pts.push(
    [103, -11, -1.5], [90, -11, -1.5], [77, -10.6, -1.5], [65, -9.6, -1.45], [54.5, -8.4, -1.3], [45, -7, -1.0],
    [38.5, -5.2, -0.55], [33.5, -2.1, -0.2], [30.2, 0.7, -0.03], [27.4, 2.7, 0],
  );
  return pts;
})();
const rampCurve = new THREE.CatmullRomCurve3(RAMP_POINTS.map(([x, z, y]) => new THREE.Vector3(x, y, z)), false, 'centripetal');
export const RAMP_LENGTH = rampCurve.getLength();
const NR = Math.round(RAMP_LENGTH);
const rampPts = rampCurve.getSpacedPoints(NR);
const rampTan = rampPts.map((_, i) => rampCurve.getTangentAt(Math.min(1, i / NR)).setY(0).normalize());
/** 道の上で、下の道とまたいでいる所より高い（橋）か。橋脚・地形のならしに使う */
export const RAMP_GRADE_X = 48;   // これより西（丘の側）は地面すれすれ（地形をならす）。東は橋（橋脚で支える）

/** ループ橋でいちばん近い所 { s, lateral, y, along } */
export function rampNearest(x, z, sHint = null) {
  let best = 0;
  let bestD = Infinity;
  const check = (i) => { const p = rampPts[i]; const d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < bestD) { bestD = d; best = i; } };
  if (sHint === null) for (let i = 0; i <= NR; i++) check(i);
  else for (let i = Math.max(0, Math.floor(sHint) - 60); i <= Math.min(NR, Math.floor(sHint) + 60); i++) check(i);
  const t = rampTan[best];
  const dx = x - rampPts[best].x;
  const dz = z - rampPts[best].z;
  const along = best + dx * t.x + dz * t.z;
  const sc = THREE.MathUtils.clamp(along, 0, NR);
  const i = Math.min(NR - 1, Math.floor(sc));
  const y = THREE.MathUtils.lerp(rampPts[i].y, rampPts[i + 1].y, sc - i);
  return { s: sc, lateral: dx * t.z - dz * t.x, y, along };
}

/** 道の中心線の点・向き・左向き（road: 'access' | 'loop' | 'ramp'） */
export function roadFrame(road, s, out = { p: new THREE.Vector3(), t: new THREE.Vector3(), n: new THREE.Vector3() }) {
  if (road === 'loop') {
    const u = wrapL(s);
    const i = Math.floor(u) % NL;
    const j = (i + 1) % NL;
    const f = u - Math.floor(u);
    out.p.lerpVectors(loopPts[i], loopPts[j], f);
    out.t.lerpVectors(loopTan[i], loopTan[j], f).normalize();
  } else if (road === 'ramp') {
    const u = THREE.MathUtils.clamp(s, 0, NR);
    const i = Math.min(NR - 1, Math.floor(u));
    const f = u - i;
    out.p.lerpVectors(rampPts[i], rampPts[i + 1], f);
    out.t.lerpVectors(rampTan[i], rampTan[i + 1], f).normalize();
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
  // ループ橋の丘の側（地面すれすれの所）。道の下は路面の 5cm 下に、まわり 8m でなめらかに
  let ramp = null;
  if (x > 22 && x < RAMP_GRADE_X + 10 && z > -22 && z < 10) {
    let best = -1;
    let bestD = Infinity;
    for (let i = rampGradeFrom; i <= NR; i++) { const p = rampPts[i]; const d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < bestD) { bestD = d; best = i; } }
    const d = Math.sqrt(bestD) - RAMP_HALF - 1.5;
    if (best >= 0 && d < 8) ramp = { w: (1 - smooth(d / 8)) * smooth((RAMP_GRADE_X - rampPts[best].x) / 6 + 1), y: rampPts[best].y - 0.05 };
  }
  if (x < 30 || x > 96 || z < -6 || z > 142) return ramp;
  let best = 0;
  let bestD = Infinity;
  for (let i = Math.max(0, sTop - 6); i <= NA; i++) { const p = accessPts[i]; const d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < bestD) { bestD = d; best = i; } }
  const d = Math.sqrt(bestD) - ACCESS_HALF - 2;
  if (d > 12) return ramp;
  const acc = { w: 1 - smooth(d / 12), y: accessPts[best].y - 0.05 };
  return ramp && ramp.w > acc.w ? ramp : acc;
}
/** ループ橋の、地形をならす所の始まり（x が RAMP_GRADE_X + 10 より西） */
const rampGradeFrom = rampPts.findIndex((p, i) => i > NR / 2 && p.x < RAMP_GRADE_X + 10);

/** 道（取り付け道路・高速道路）から margin 以内か（木を生やさないため。hill.js） */
export function nearRoad(x, z, margin = 15) {
  const m2 = (HWY_HALF + margin) ** 2;
  for (let i = 0; i < NL; i += 4) { const p = loopPts[i]; if ((p.x - x) ** 2 + (p.z - z) ** 2 < m2) return true; }
  const a2 = (ACCESS_HALF + margin) ** 2;
  for (let i = 0; i <= NA; i += 2) { const p = accessPts[i]; if ((p.x - x) ** 2 + (p.z - z) ** 2 < a2) return true; }
  const r2 = (RAMP_HALF + margin) ** 2;
  for (let i = 0; i <= NR; i += 2) { const p = rampPts[i]; if ((p.x - x) ** 2 + (p.z - z) ** 2 < r2) return true; }
  return false;
}

/** road.js が道の形を作るための点（そのまま渡す。書き換えない） */
export const ROAD_SAMPLES = { accessPts, accessTan, loopPts, loopTan, NA, NL, rampPts, rampTan, NR };
