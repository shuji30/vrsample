import * as THREE from 'three';

/**
 * 庭の右側（テニスコートの横）のカートコース。
 *
 * コースの中心線を閉じた曲線（Catmull-Rom）で決め、そこから路面・縁石・
 * スタート / ゴールを作る。中心線はカートの走り（コースの外に出たか）、
 * 女の子のカートのコース取り、周回と順位の計算にも使う。
 *
 * 大きさは子どものカート（時速 20km ほど）で 1 周 15 秒くらい。幅 3.4m の
 * 路面に、ホームストレート・ヘアピン・S 字・バックストレートを入れる。
 * 走る向きは点の順（家の側のホームストレートを +X へ、右奥へ回って、左側を戻る）。
 */

/** 中心線の点（ワールドの x, z）。P0 → P1 がホームストレート（スタート / ゴールがある） */
const CENTER = [
  [11.0, -7.6], [20.0, -7.6], [24.0, -9.6], [24.6, -14.0], [21.6, -17.2],
  [17.6, -17.8], [16.4, -21.2], [19.8, -24.2], [24.0, -26.2], [23.6, -30.6],
  [18.0, -31.6], [11.0, -30.6], [8.6, -26.0], [9.6, -20.0], [8.6, -14.0], [8.8, -9.6],
];

export const KART_TRACK = {
  /** 路面の幅（m） */
  width: 3.4,
  /** 縁石の幅（路面の外側に、左右とも） */
  curb: 0.32,
  /** スタート / ゴールの位置（中心線の長さに対する割合） */
  startAt: 0.035,
  /** 走れる範囲（庭とつながる、ワールドの矩形） */
  area: { minX: 5.0, maxX: 27.0, minZ: -33.2, maxZ: -5.0 },
};

/**
 * 中心線の点ごとの高さ（m）。少しだけ上り下りを入れる。スタート / ゴールの前後
 * （ホームストレートと最終コーナー）は平らにして、スタートの枠とゲートは地面の高さのまま。
 * 右奥のコーナーへ上って（最大 1.0m）、S 字で下り、奥の右でもう一度小さく上る。
 * 勾配は 10% ほどまで（子どものカートで、上りで少し遅くなる程度）。
 */
const HEIGHTS = [0, 0, 0.25, 0.7, 1.0, 0.75, 0.35, 0.15, 0.4, 0.65, 0.45, 0.15, 0, 0.2, 0.1, 0];

const curve = new THREE.CatmullRomCurve3(
  CENTER.map(([x, z], i) => new THREE.Vector3(x, HEIGHTS[i], z)), true, 'centripetal',
);
const SAMPLES = 600;
/** 中心線を等間隔（長さで）に並べた点。探すのはこの点列で行う */
const points = curve.getSpacedPoints(SAMPLES).slice(0, SAMPLES);
const tangents = points.map((_, i) => curve.getTangentAt(i / SAMPLES).setY(0).normalize());
export const TRACK_LENGTH = curve.getLength();

// ---------------------------------------------------------------------------
// 地面の高さ
// ---------------------------------------------------------------------------
//
// 路面の高さは中心線の高さ。路面の外は、端から SLOPE だけかけて地面（0）へなだらかに下ろす
// （土手）。コースの別の区間が近くを通るところで段差ができないよう、中心線の各点が作る
// 「山」の高いほう（max）を取る。毎フレーム探すと重いので、走れる範囲に 0.25m ごとの表を
// 作っておき、そこから読む（まわりの 4 つの値の間を取る）。

const EDGE = KART_TRACK.width / 2 + KART_TRACK.curb + 0.25;
const SLOPE = 3.0;
const CELL = 0.25;
const { minX: GX0, minZ: GZ0 } = KART_TRACK.area;
const GW = Math.ceil((KART_TRACK.area.maxX - GX0) / CELL) + 1;
const GH = Math.ceil((KART_TRACK.area.maxZ - GZ0) / CELL) + 1;
const heightGrid = new Float32Array(GW * GH);
{
  const raised = points.filter((q) => q.y > 1e-3);
  for (let j = 0; j < GH; j++) {
    for (let i = 0; i < GW; i++) {
      const x = GX0 + i * CELL;
      const z = GZ0 + j * CELL;
      let h = 0;
      for (const q of raised) {
        if (q.y <= h) continue;
        const d = Math.hypot(q.x - x, q.z - z);
        if (d >= EDGE + SLOPE) continue;
        const t = d <= EDGE ? 1 : 1 - (d - EDGE) / SLOPE;
        const w = t * t * (3 - 2 * t);
        h = Math.max(h, q.y * w);
      }
      heightGrid[j * GW + i] = h;
    }
  }
}

/** 地面の高さ（m）。カートコースの起伏。コースの外（走れる範囲の外）は 0 */
export function groundHeight(x, z) {
  const fx = (x - GX0) / CELL;
  const fz = (z - GZ0) / CELL;
  if (fx < 0 || fz < 0 || fx >= GW - 1 || fz >= GH - 1) return 0;
  const i = Math.floor(fx);
  const j = Math.floor(fz);
  const tx = fx - i;
  const tz = fz - j;
  const a = heightGrid[j * GW + i];
  const b = heightGrid[j * GW + i + 1];
  const c = heightGrid[(j + 1) * GW + i];
  const d = heightGrid[(j + 1) * GW + i + 1];
  return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
}

/** 中心線の u（0..1、1 周）での点と接線 */
export function trackPoint(u, out = new THREE.Vector3()) {
  return out.copy(curve.getPointAt(((u % 1) + 1) % 1));
}
export function trackTangent(u, out = new THREE.Vector3()) {
  return out.copy(curve.getTangentAt(((u % 1) + 1) % 1)).setY(0).normalize();
}

/**
 * いちばん近い中心線の点を探す。
 * @returns {{ u: number, lateral: number, distance: number, index: number }}
 *   u は 1 周を 0..1 にした位置、lateral は中心線から右（+）/ 左（-）へのずれ（m）
 * hint（前の index）を渡すと、その近くだけ探す（毎フレーム呼ぶ用）
 */
export function nearestOnTrack(x, z, hint = -1) {
  let best = 0;
  let bestD = Infinity;
  const scan = (i) => {
    const p = points[(i + SAMPLES) % SAMPLES];
    const d = (p.x - x) ** 2 + (p.z - z) ** 2;
    if (d < bestD) { bestD = d; best = (i + SAMPLES) % SAMPLES; }
  };
  if (hint >= 0) for (let k = -40; k <= 40; k++) scan(hint + k);
  else for (let i = 0; i < SAMPLES; i++) scan(i);
  const p = points[best];
  const t = tangents[best];
  // 右向き（進行方向に対して右）は (-t.z, 0, t.x) … 上から見て時計回りなので外側がどちらかは場所しだい
  const lateral = (x - p.x) * -t.z + (z - p.z) * t.x;
  return { u: best / SAMPLES, lateral, distance: Math.sqrt(bestD), index: best };
}

// ---------------------------------------------------------------------------
// 見た目
// ---------------------------------------------------------------------------

function asphaltTexture(size = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#4a4d52';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 5000; i++) {
    const v = 50 + Math.floor(Math.random() * 60);
    ctx.fillStyle = `rgba(${v},${v},${v + 4},${0.25 + Math.random() * 0.4})`;
    ctx.fillRect(Math.random() * size, Math.random() * size, 1.5, 1.5);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
}

function stripeTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#d8342c';
  ctx.fillRect(0, 0, 64, 32);
  ctx.fillStyle = '#f2f2ee';
  ctx.fillRect(0, 32, 64, 32);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

function checkerTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 32;
  const ctx = canvas.getContext('2d');
  for (let i = 0; i < 16; i++) {
    for (let j = 0; j < 4; j++) {
      ctx.fillStyle = (i + j) % 2 ? '#111' : '#f4f4f4';
      ctx.fillRect(i * 8, j * 8, 8, 8);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  return texture;
}

function bannerTexture(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 160;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#1d4f9c';
  ctx.fillRect(0, 0, 1024, 160);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 96px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 512, 84);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * 中心線に沿った帯（リボン）。from..to は中心線からの横のずれ（m、右が +）。
 * v は長さ方向の m、u は横方向の 0..1
 */
function ribbon(from, to, y, segments = SAMPLES, cols = 1) {
  // 横（幅の向き）も cols に分ける。両端だけだと、起伏のある地面の上で路面の真ん中が
  // 地面より低くなり、芝生が路面を突き抜けていた
  const positions = [];
  const uvs = [];
  const indices = [];
  const row = cols + 1;
  let along = 0;
  for (let i = 0; i <= segments; i++) {
    const k = i % segments;
    const p = points[k];
    const t = tangents[k];
    if (i > 0) along += points[k].distanceTo(points[(i - 1) % segments]);
    const rx = -t.z;
    const rz = t.x;
    for (let c = 0; c <= cols; c++) {
      const off = from + ((to - from) * c) / cols;
      const x = p.x + rx * off;
      const z = p.z + rz * off;
      positions.push(x, groundHeight(x, z) + y, z);
      uvs.push(c / cols, along);
    }
    if (i < segments) {
      const a = i * row;
      for (let c = 0; c < cols; c++) {
        indices.push(a + c, a + row + c, a + c + 1, a + c + 1, a + row + c, a + row + c + 1);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  // 巻き方向でうら返っていたら上へ向け直す
  const normal = geometry.attributes.normal;
  if (normal.getY(0) < 0) {
    for (let i = 0; i < indices.length; i += 3) [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]];
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
  }
  return geometry;
}

/** コース一式（路面・縁石・白線・スタート / ゴールのゲート）を作る */
export function createKartCourse({ grass = null } = {}) {
  const group = new THREE.Group();
  group.name = 'kartCourse';
  const half = KART_TRACK.width / 2;
  if (grass) group.add(createTerrain(grass));

  const asphalt = asphaltTexture();
  asphalt.repeat.set(1, 0.25);
  const road = new THREE.Mesh(
    ribbon(-half, half, 0.016, SAMPLES, 8),
    new THREE.MeshStandardMaterial({ map: asphalt, roughness: 0.92, metalness: 0 }),
  );
  road.receiveShadow = true;
  group.add(road);

  // 縁石（赤白）と、路面の端の白線
  const stripes = stripeTexture();
  stripes.repeat.set(1, 1);   // 1m ごとに赤と白
  const curbMaterial = new THREE.MeshStandardMaterial({ map: stripes, roughness: 0.7 });
  for (const side of [-1, 1]) {
    const a = side * half;
    const b = side * (half + KART_TRACK.curb);
    const curb = new THREE.Mesh(ribbon(Math.min(a, b), Math.max(a, b), 0.024), curbMaterial);
    curb.receiveShadow = true;
    group.add(curb);
    const line = new THREE.Mesh(
      ribbon(side * (half - 0.14), side * (half - 0.06), 0.021),
      new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.8 }),
    );
    group.add(line);
  }

  // スタート / ゴール：市松模様の線と、ゲート
  const at = trackPoint(KART_TRACK.startAt);
  const dir = trackTangent(KART_TRACK.startAt);
  const yaw = Math.atan2(dir.x, dir.z);
  const finish = new THREE.Mesh(
    new THREE.PlaneGeometry(KART_TRACK.width, 0.6),
    new THREE.MeshStandardMaterial({ map: checkerTexture(), roughness: 0.8 }),
  );
  // 寝かせた板の横（ローカル X）が、コースを横切る向きになるように
  finish.rotation.set(-Math.PI / 2, yaw, 0, 'YXZ');
  finish.position.set(at.x, groundHeight(at.x, at.z) + 0.027, at.z);
  group.add(finish);

  const gate = new THREE.Group();
  const poleMaterial = new THREE.MeshStandardMaterial({ color: 0xe8e8e2, roughness: 0.5, metalness: 0.3 });
  for (const side of [-1, 1]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 3.0, 12), poleMaterial);
    pole.position.set(side * (half + 0.6), 1.5, 0);
    pole.castShadow = true;
    gate.add(pole);
  }
  const banner = new THREE.Mesh(
    new THREE.BoxGeometry(KART_TRACK.width + 1.4, 0.55, 0.06),
    [poleMaterial, poleMaterial, poleMaterial, poleMaterial,
      new THREE.MeshStandardMaterial({ map: bannerTexture('スタート / ゴール'), roughness: 0.6 }),
      new THREE.MeshStandardMaterial({ map: bannerTexture('スタート / ゴール'), roughness: 0.6 })],
  );
  banner.position.set(0, 2.8, 0);
  banner.castShadow = true;
  gate.add(banner);
  gate.position.set(at.x, groundHeight(at.x, at.z), at.z);
  gate.rotation.y = yaw;   // ゲートの横（ローカル X）がコースを横切る
  group.add(gate);

  // スタートの枠（2 台ぶん、線の後ろに左右ずらして）
  const gridMaterial = new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.8 });
  for (const [back, side] of [[2.2, -0.8], [3.8, 0.8]]) {
    const p = trackPoint(KART_TRACK.startAt - back / TRACK_LENGTH);
    const t = trackTangent(KART_TRACK.startAt - back / TRACK_LENGTH);
    const box = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.08), gridMaterial);
    box.rotation.set(-Math.PI / 2, Math.atan2(t.x, t.z), 0, 'YXZ');
    const bx = p.x - t.z * side;
    const bz = p.z + t.x * side;
    box.position.set(bx, groundHeight(bx, bz) + 0.027, bz);
    group.add(box);
  }

  // ヘアピンの外側のタイヤの壁（見た目だけ）
  const tireMaterial = new THREE.MeshStandardMaterial({ color: 0x1b1c1e, roughness: 0.9 });
  const tire = new THREE.TorusGeometry(0.26, 0.11, 8, 16);
  for (const u of [0.13, 0.17, 0.58, 0.62, 0.66]) {
    const p = trackPoint(u);
    const t = trackTangent(u);
    // 曲がりの外側へ。接線の変わる向き（next - t）が曲がりの内側を指すので、その反対
    const next = trackTangent(u + 0.01);
    const inward = (next.x - t.x) * -t.z + (next.z - t.z) * t.x;   // 右向き成分
    const out = inward > 0 ? -1 : 1;
    for (let k = -2; k <= 2; k++) {
      for (let level = 0; level < 2; level++) {
        const m = new THREE.Mesh(tire, tireMaterial);
        m.rotation.x = Math.PI / 2;
        const off = half + KART_TRACK.curb + 0.7;
        const mx = p.x - t.z * out * off + t.x * k * 0.62;
        const mz = p.z + t.x * out * off + t.z * k * 0.62;
        m.position.set(mx, groundHeight(mx, mz) + 0.11 + level * 0.2, mz);
        m.castShadow = true;
        group.add(m);
      }
    }
  }

  return group;
}

/**
 * 起伏のある芝生（土手）。庭の芝生（高さ 0 の板）の上に張る。材質は庭の芝生と同じものを
 * 使い、UV も庭の芝生の板（70m 四方、中心 (0, -20)）に合わせて、つなぎ目で模様がずれないようにする。
 */
function createTerrain(grass) {
  const step = 0.5;
  const nx = Math.ceil((KART_TRACK.area.maxX - GX0) / step) + 1;
  const nz = Math.ceil((KART_TRACK.area.maxZ - GZ0) / step) + 1;
  const positions = [];
  const uvs = [];
  const heights = [];
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = GX0 + i * step;
      const z = GZ0 + j * step;
      // 路面・縁石の下になるところは少し下げる（芝生が路面から顔を出さないように）
      const under = nearestOnTrack(x, z).distance < KART_TRACK.width / 2 + KART_TRACK.curb + 0.1;
      const h = groundHeight(x, z) - (under ? 0.06 : 0);
      heights.push(h);
      positions.push(x, h, z);
      uvs.push((x + 35) / 70, (-(z + 20) + 35) / 70);
    }
  }
  const indices = [];
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      const b = a + 1;
      const c = a + nx;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  // 走れる範囲をまるごとおおう（高さ 0 のところは庭の芝生の 5mm 上。同じ模様なので、
  // 重なってもちらつきは見えない）。手前に描く設定（polygonOffset）を使うと、路面（地面の
  // 1.6cm 上）より芝生が手前に出て、路面が隠れてしまった
  const mesh = new THREE.Mesh(geometry, grass);
  mesh.name = 'kartTerrain';
  mesh.receiveShadow = true;
  return mesh;
}
