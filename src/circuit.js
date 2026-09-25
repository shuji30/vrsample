import * as THREE from 'three';
import { asphaltTexture } from './karttrack.js';

/**
 * 広いサーキット。丘の東のふもとの平らな所（y -10）にある、立体交差の 8 の字コース（1 周約 2.1km、幅 12m）。
 * 形は日本の有名な 8 の字のコースを参考にした（名前やロゴは使わない）：
 *   メインストレート → 1・2 コーナー（右）→ S 字 → デグナー（右）→ 立体交差の下をくぐる →
 *   ヘアピン（左）→ 右の長いカーブ → スプーン（左 2 つ）→ バックストレートで橋を渡る → シケイン → メインストレート
 *
 * 中心線は閉じた曲線（centripetal Catmull-Rom）。交差の上を通る側（s = 0 のまわり）は、前後 150m かけて
 * 8m まで上がる（橋）。下をくぐる側は地面の高さのまま（橋の下の空きは 7m）。
 * コース上の位置は、前の位置（sHint）のまわり ±80m だけを探す（交差の所で、上と下を取り違えないように）。
 */
export const CIRCUIT = {
  origin: new THREE.Vector3(470, -10, -8),
  width: 12,
  curb: 1.2,
  /** 外側の防護壁までの距離（中心線から） */
  wall: 16,
  bridgeHeight: 8,
  bridgeRamp: 150,
  /** スタートの線（中心線の長さの位置、m） */
  startAt: 250,
  laps: 3,
};

// 中心線の点（ローカル、m）。上から見た図を描いて形を詰めた
const POINTS = [[0, 0], [60, -38], [98, -56], [122, -76], [146, -84], [172, -96], [210, -100], [300, -106], [380, -110], [430, -95],
  [450, -60], [440, -25], [410, -5], [375, 10], [350, 40], [335, 75], [300, 95], [240, 100], [160, 95], [110, 70],
  [60, 40], [-60, -40], [-110, -70], [-170, -95], [-230, -110], [-270, -100], [-285, -70], [-270, -45], [-235, -35],
  [-205, -10], [-200, 25], [-225, 55], [-265, 62], [-310, 70], [-338, 98], [-318, 132], [-270, 138], [-190, 125],
  [-120, 95], [-60, 40]];

const curve = new THREE.CatmullRomCurve3(POINTS.map(([x, z]) => new THREE.Vector3(x, 0, z)), true, 'centripetal');
export const CIRCUIT_LENGTH = curve.getLength();
const N = Math.round(CIRCUIT_LENGTH);          // 1m ごと
const samples = curve.getSpacedPoints(N).slice(0, N);
const tangents = samples.map((_, i) => curve.getTangentAt(i / N).setY(0).normalize());

const wrap = (s) => ((s % CIRCUIT_LENGTH) + CIRCUIT_LENGTH) % CIRCUIT_LENGTH;
const smooth = (t) => { const c = Math.min(1, Math.max(0, t)); return c * c * (3 - 2 * c); };

/** 路面の高さ（橋のぶん。ワールドの y は origin.y を足す） */
export function circuitElevation(s) {
  const d = Math.abs(((wrap(s) + CIRCUIT_LENGTH / 2) % CIRCUIT_LENGTH) - CIRCUIT_LENGTH / 2);
  if (d >= CIRCUIT.bridgeRamp) return 0;
  return CIRCUIT.bridgeHeight * (0.5 + 0.5 * Math.cos((Math.PI * d) / CIRCUIT.bridgeRamp));
}

/** 中心線の点（ワールド）と、進む向き・左向き */
export function circuitFrame(s, out = { p: new THREE.Vector3(), t: new THREE.Vector3(), n: new THREE.Vector3() }) {
  const u = wrap(s);
  const i = Math.floor(u) % N;
  const j = (i + 1) % N;
  const f = u - Math.floor(u);
  out.p.lerpVectors(samples[i], samples[j], f).add(CIRCUIT.origin);
  out.p.y = CIRCUIT.origin.y + circuitElevation(u);
  out.t.lerpVectors(tangents[i], tangents[j], f).normalize();
  out.n.set(out.t.z, 0, -out.t.x);   // 左（進む向きを上から見て左回りに 90°）
  return out;
}

/**
 * いちばん近いコース上の位置。sHint を渡すと、そのまわり ±range だけを探す（交差の所で上と下を
 * 取り違えないように）。{ s, lateral（左が +）, y（その位置の路面の高さ） }
 */
export function circuitNearest(x, z, sHint = null, range = 80) {
  const lx = x - CIRCUIT.origin.x;
  const lz = z - CIRCUIT.origin.z;
  let best = 0;
  let bestD = Infinity;
  const check = (i) => {
    const p = samples[i];
    const d = (p.x - lx) ** 2 + (p.z - lz) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  };
  if (sHint === null) for (let i = 0; i < N; i += 2) check(i);
  else for (let k = -range; k <= range; k += 2) check(Math.floor(wrap(sHint + k)) % N);
  // 前後 3m を 1m ごとに詰めて、線分に落とす
  for (let k = -3; k <= 3; k++) check((best + k + N) % N);
  const i = best;
  const t = tangents[i];
  const dx = lx - samples[i].x;
  const dz = lz - samples[i].z;
  const along = dx * t.x + dz * t.z;
  const s = wrap(i + along);
  const lateral = dx * t.z - dz * t.x;
  return { s, lateral, y: CIRCUIT.origin.y + circuitElevation(s) };
}

/** 曲がり具合（1/半径、左が +）。s のまわり ±span で見る */
export function circuitCurvature(s, span = 6) {
  const a = tangents[Math.floor(wrap(s - span)) % N];
  const b = tangents[Math.floor(wrap(s + span)) % N];
  const d = Math.atan2(a.x * b.z - a.z * b.x, a.x * b.x + a.z * b.z);
  return -d / (2 * span);
}

/** 平らな所（地形を y -10 にそろえる範囲、ワールド）。hill.js が読む */
export const CIRCUIT_ZONE = { minX: CIRCUIT.origin.x - 380, maxX: CIRCUIT.origin.x + 490, minZ: CIRCUIT.origin.z - 150, maxZ: CIRCUIT.origin.z + 175, y: CIRCUIT.origin.y };

/** リボン（中心線に沿った帯）。from〜to は中心線からの横の位置、ds は区切り、filter で作る所を選ぶ */
function ribbon({ from, to, lift = 0.04, cols = 1, step = 2, filter = null, uvScale = 1, lengthUv = false }) {
  const pos = [];
  const uv = [];
  const idx = [];
  const f = { p: new THREE.Vector3(), t: new THREE.Vector3(), n: new THREE.Vector3() };
  let run = -1;
  for (let s = 0; s <= CIRCUIT_LENGTH + 0.01; s += step) {
    const keep = !filter || filter(s);
    if (!keep) { run = -1; continue; }
    circuitFrame(s, f);
    const base = pos.length / 3;
    for (let c = 0; c <= cols; c++) {
      const w = from + ((to - from) * c) / cols;
      pos.push(f.p.x + f.n.x * w, f.p.y + lift, f.p.z + f.n.z * w);
      uv.push(lengthUv ? (c / cols) : (w * uvScale), (lengthUv ? s : s) * uvScale);
    }
    if (run >= 0) {
      for (let c = 0; c < cols; c++) {
        const a = run + c;
        const b = base + c;
        idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    run = base;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function stripes(a, b, n) {
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16 * n;
  const ctx = canvas.getContext('2d');
  for (let i = 0; i < n; i++) { ctx.fillStyle = i % 2 ? b : a; ctx.fillRect(0, i * 16, 16, 16); }
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function textPlane(lines, { w = 8, h = 2, bg = '#1c2436', fg = '#fff', font = 'bold 64px sans-serif' } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = Math.round(512 * (h / w));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = fg;
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  lines.forEach((line, i) => ctx.fillText(line, canvas.width / 2, (canvas.height * (i + 0.5)) / lines.length));
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: t, roughness: 0.7 }));
}

export function createCircuit() {
  const group = new THREE.Group();
  group.name = 'circuit';
  const W = CIRCUIT.width / 2;
  const shade = (m) => { m.receiveShadow = true; return m; };

  // 路面
  // 路面の模様はカートコースと同じ（UV はメートル。4m で 1 枚）
  const asphaltMap = asphaltTexture();
  asphaltMap.wrapS = asphaltMap.wrapT = THREE.RepeatWrapping;
  asphaltMap.repeat.set(0.25, 0.25);
  const asphalt = new THREE.MeshStandardMaterial({ map: asphaltMap, roughness: 0.92, metalness: 0 });
  const road = shade(new THREE.Mesh(ribbon({ from: -W, to: W, cols: 6, step: 2 }), asphalt));
  road.name = 'circuitRoad';
  group.add(road);
  // 白線（両端）
  const white = new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.6 });
  for (const side of [-1, 1]) {
    group.add(shade(new THREE.Mesh(ribbon({ from: side * (W - 0.55), to: side * (W - 0.3), lift: 0.05, step: 2 }), white)));
  }
  // 縁石（曲がっている所の両側。赤白）
  const curbTex = stripes('#d2352e', '#f4f4f0', 2);
  const curbMat = new THREE.MeshStandardMaterial({ map: curbTex, roughness: 0.7 });
  const bendy = (s) => Math.abs(circuitCurvature(s, 10)) > 1 / 140;
  for (const side of [-1, 1]) {
    const a = side * W;
    const b = side * (W + CIRCUIT.curb);
    const g = ribbon({ from: Math.min(a, b), to: Math.max(a, b), lift: 0.06, step: 1, filter: bendy, uvScale: 0.5, lengthUv: true });
    group.add(shade(new THREE.Mesh(g, curbMat)));
  }
  // スタートの線（白黒の市松）と、グリッドの枠
  const checker = (() => {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 32;
    const x = c.getContext('2d');
    for (let i = 0; i < 16; i++) for (let j = 0; j < 4; j++) { x.fillStyle = (i + j) % 2 ? '#111' : '#f4f4f4'; x.fillRect(i * 8, j * 8, 8, 8); }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const f = { p: new THREE.Vector3(), t: new THREE.Vector3(), n: new THREE.Vector3() };
  circuitFrame(CIRCUIT.startAt, f);
  const lineHolder = new THREE.Group();
  lineHolder.position.copy(f.p).setY(f.p.y + 0.065);
  lineHolder.rotation.y = Math.atan2(f.t.x, f.t.z);
  const lineMesh = new THREE.Mesh(new THREE.PlaneGeometry(CIRCUIT.width, 1.6), new THREE.MeshStandardMaterial({ map: checker, roughness: 0.7 }));
  lineMesh.rotation.x = -Math.PI / 2;
  lineHolder.add(lineMesh);
  group.add(lineHolder);
  for (let k = 0; k < 4; k++) {
    for (const side of [-1, 1]) {
      circuitFrame(CIRCUIT.startAt - 8 - k * 8 - (side > 0 ? 4 : 0), f);
      const box = new THREE.Group();
      box.position.copy(f.p).setY(f.p.y + 0.065).addScaledVector(f.n, side * 3);
      box.rotation.y = Math.atan2(f.t.x, f.t.z);
      const bar = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.25), white);
      bar.rotation.x = -Math.PI / 2;
      box.add(bar);
      group.add(box);
    }
  }

  // 橋：上を通る側の、高い所の両脇の壁と、交差の所の橋げた・柱
  const concrete = new THREE.MeshStandardMaterial({ color: 0xb8b4ac, roughness: 0.9 });
  const high = (s) => circuitElevation(s) > 0.3;
  for (const side of [-1, 1]) {
    // 路面の縁から地面までの壁（盛り土の側面）。交差のすぐ上（±9m）は開けて、下の道を通す
    const pos = [];
    const idx = [];
    let run = -1;
    for (let s = -CIRCUIT.bridgeRamp; s <= CIRCUIT.bridgeRamp; s += 2) {
      const open = Math.abs(s) < 9;
      if (!high(s) || open) { run = -1; continue; }
      circuitFrame(s, f);
      const x = f.p.x + f.n.x * side * (W + 1.5);
      const z = f.p.z + f.n.z * side * (W + 1.5);
      const base = pos.length / 3;
      pos.push(x, f.p.y + 0.9, z, x, CIRCUIT.origin.y - 0.2, z);
      if (run >= 0) idx.push(run, base, run + 1, run + 1, base, base + 1);
      run = base;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const wallMesh = new THREE.Mesh(g, concrete);
    wallMesh.material = concrete.clone();
    wallMesh.material.side = THREE.DoubleSide;
    group.add(wallMesh);
  }
  // 橋の下の側（交差の ±9m）は、路面の下に厚みと、その下の柱
  group.add(new THREE.Mesh(ribbon({ from: -W - 1.5, to: W + 1.5, lift: -0.6, step: 1, filter: (s) => { const d = Math.abs(((s + CIRCUIT_LENGTH / 2) % CIRCUIT_LENGTH) - CIRCUIT_LENGTH / 2); return d < 11; } }), concrete));
  for (const s of [-10, 10]) {
    circuitFrame(s, f);
    for (const side of [-1, 1]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(1.2, CIRCUIT.bridgeHeight, 1.2), concrete);
      pillar.position.copy(f.p).addScaledVector(f.n, side * (W - 1)).setY(CIRCUIT.origin.y + (f.p.y - CIRCUIT.origin.y) / 2);
      pillar.castShadow = true;
      group.add(pillar);
    }
  }

  // 外側の防護壁（低いガードレール。1 つの InstancedMesh）
  const railMat = new THREE.MeshStandardMaterial({ color: 0xc8ccd2, metalness: 0.6, roughness: 0.4 });
  const railGeo = new THREE.BoxGeometry(0.15, 0.8, 4.1);
  const railCount = Math.floor(CIRCUIT_LENGTH / 4) * 2;
  const rails = new THREE.InstancedMesh(railGeo, railMat, railCount);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  let ri = 0;
  for (let s = 0; s < CIRCUIT_LENGTH - 2; s += 4) {
    circuitFrame(s + 2, f);
    for (const side of [-1, 1]) {
      // 交差のところでは、下を通る側の壁が上の側の路面を突き抜けないように、橋の区間の外だけ
      const p = f.p.clone().addScaledVector(f.n, side * CIRCUIT.wall);
      p.y = f.p.y + 0.4;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(f.t.x, f.t.z));
      m4.compose(p, q, new THREE.Vector3(1, 1, 1));
      rails.setMatrixAt(ri++, m4);
    }
  }
  rails.count = ri;
  group.add(rails);

  // スタンド・ピットの建物・スタートの信号（メインストレートの脇）
  circuitFrame(CIRCUIT.startAt, f);
  const yaw = Math.atan2(f.t.x, f.t.z);
  const stand = new THREE.Group();
  stand.position.copy(f.p).addScaledVector(f.n, -(CIRCUIT.wall + 6)).setY(CIRCUIT.origin.y);
  stand.rotation.y = yaw;
  const seatMat = new THREE.MeshStandardMaterial({ color: 0x2f5aa8, roughness: 0.7 });
  for (let k = 0; k < 6; k++) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.6, 80), k % 2 ? seatMat : concrete);
    step.position.set(-k * 2.2, 0.3 + k * 0.6, 0);
    step.scale.y = 1 + k * 1.0;
    step.position.y = (0.6 * (1 + k)) / 2;
    stand.add(step);
  }
  const roof = new THREE.Mesh(new THREE.BoxGeometry(14, 0.4, 82), new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.6 }));
  roof.position.set(-5.5, 7, 0);
  stand.add(roof);
  group.add(stand);
  const pits = new THREE.Group();
  pits.position.copy(f.p).addScaledVector(f.n, CIRCUIT.wall + 8).setY(CIRCUIT.origin.y);
  pits.rotation.y = yaw;
  const pitBody = new THREE.Mesh(new THREE.BoxGeometry(10, 6, 90), new THREE.MeshStandardMaterial({ color: 0xf0f0ec, roughness: 0.7 }));
  pitBody.position.set(4, 3, -10);
  pitBody.castShadow = true;
  pits.add(pitBody);
  const sign = textPlane(['GT サーキット'], { w: 16, h: 3 });
  sign.position.set(-1.05, 7.8, -10);
  sign.rotation.y = -Math.PI / 2;
  pits.add(sign);
  group.add(pits);
  // スタートの信号（5 つの赤いランプ。race.js が点ける）
  const gantry = new THREE.Group();
  gantry.position.copy(f.p).setY(f.p.y);
  gantry.rotation.y = yaw;
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, 7, 0.4), concrete);
    post.position.set(side * (W + 1), 3.5, 0);
    gantry.add(post);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(CIRCUIT.width + 2.4, 1.2, 0.5), new THREE.MeshStandardMaterial({ color: 0x1e1e22, roughness: 0.6 }));
  beam.position.set(0, 6.6, 0);
  gantry.add(beam);
  const lamps = [];
  for (let k = 0; k < 5; k++) {
    const mat = new THREE.MeshStandardMaterial({ color: 0x331010, emissive: 0x000000, roughness: 0.4 });
    const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.32, 16), mat);
    lamp.position.set((k - 2) * 1.2, 6.6, -0.26);
    lamp.rotation.y = Math.PI;
    gantry.add(lamp);
    lamps.push(mat);
  }
  group.add(gantry);

  return {
    group,
    /** スタートの信号：n 個赤く点ける（0 で消す）。green で緑 */
    setLights(n, green = false) {
      lamps.forEach((m, k) => {
        const on = green || k < n;
        m.color.setHex(on ? (green ? 0x14c850 : 0xff2a1a) : 0x331010);
        m.emissive.setHex(on ? (green ? 0x10a040 : 0xff2010) : 0x000000);
        m.emissiveIntensity = on ? 1.5 : 0;
      });
    },
  };
}
