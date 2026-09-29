import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SEA_LEVEL, hillHeight } from './hill.js';

/**
 * 浜の沖のサンゴ礁（スキューバダイビングで潜って見る）。
 *
 * 砂浜の西の沖（REEF、水深 6〜7.5m）に、岩の上に育ったサンゴの山（根）が 10 か所ほどと、そのあいだの砂地。
 *   - 岩（根の土台）：でこぼこの岩をいくつか重ねる
 *   - サンゴ：枝サンゴ（ミドリイシ）・テーブルサンゴ・脳サンゴ・柱のサンゴ（筒の海綿）・ソフトコーラル
 *   - ウミウチワ（扇の形。波でゆれる）・イソギンチャク（触手がゆれる。クマノミの家）・海草（砂地でゆれる）
 *   - 砂地のヒトデ・ウニ・シャコガイ（青い外套膜）
 *   - 砂地にゆれる光の網（コースティクス）と、水面から差しこむ光の筋
 * 形はインスタンス（同じ形を色と大きさを変えて何度も）で描く。潜っているあいだだけ見せる（visible）。
 * 揺れはシェーダー（onBeforeCompile で頂点を時間でずらす）なので、毎フレームの計算は時間を進めるだけ
 */
export const REEF = { x: -52, z: -155, r: 26 };

const rand = mulberry(20260929);
function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const R = (a, b) => a + rand() * (b - a);
const pick = (list) => list[Math.floor(rand() * list.length)];

/** 揺れる材料：y が高いほど（根元から離れるほど）、時間と場所で左右にゆれる */
function swayMaterial(mat, time, { amp = 0.08, freq = 1.3, height = 1 } = {}) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          vec4 wp = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            wp = instanceMatrix * wp;
            vec3 base = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          #else
            vec3 base = vec3(0.0);
          #endif
          float h = clamp(position.y / ${height.toFixed(3)}, 0.0, 1.5);
          float ph = base.x * 0.7 + base.z * 0.9;
          transformed.x += sin(uTime * ${freq.toFixed(3)} + ph) * ${amp.toFixed(3)} * h * h;
          transformed.z += cos(uTime * ${(freq * 0.8).toFixed(3)} + ph * 1.3) * ${(amp * 0.6).toFixed(3)} * h * h;
        }`);
  };
  mat.customProgramCacheKey = () => `sway${amp}${freq}${height}`;
  return mat;
}

/** インスタンスを並べる。items は { x, y, z, s, sy?, yaw?, tilt?, color } */
function instanced(geo, mat, items) {
  const mesh = new THREE.InstancedMesh(geo, mat, items.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const c = new THREE.Color();
  items.forEach((it, i) => {
    e.set(it.tilt ?? 0, it.yaw ?? 0, it.roll ?? 0, 'YXZ');
    q.setFromEuler(e);
    m.compose(new THREE.Vector3(it.x, it.y, it.z), q, new THREE.Vector3(it.s * (it.sx ?? 1), it.s * (it.sy ?? 1), it.s * (it.sz ?? 1)));
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, c.set(it.color ?? 0xffffff));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return mesh;
}

/** でこぼこの岩（単位の大きさ） */
function rockGeometry() {
  const g = new THREE.IcosahedronGeometry(1, 2);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = 1 + 0.22 * Math.sin(v.x * 3.1 + v.y * 1.7) * Math.cos(v.z * 2.3) + 0.1 * Math.sin(v.x * 7 + v.z * 5);
    v.multiplyScalar(n);
    if (v.y < -0.3) v.y = -0.3 + (v.y + 0.3) * 0.3;     // 底は平ら（砂に埋まる）
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

/** 脳サンゴ：丸い塊に、うねった溝 */
function brainGeometry() {
  const g = new THREE.SphereGeometry(1, 36, 24, 0, Math.PI * 2, 0, Math.PI * 0.62);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const groove = Math.sin(v.x * 14 + Math.sin(v.z * 9) * 2.2) * Math.sin(v.z * 13 + Math.sin(v.x * 8) * 2);
    v.multiplyScalar(1 + 0.045 * groove);
    p.setXYZ(i, v.x, v.y - 0.3, v.z);
  }
  g.computeVertexNormals();
  return g;
}

/** 枝サンゴ（ミドリイシ）：根元から枝分かれする細い枝（高さ約 1） */
function branchGeometry(seed) {
  const parts = [];
  const rng = mulberry(seed);
  const up = new THREE.Vector3(0, 1, 0);
  const grow = (from, dir, len, r, depth) => {
    const to = from.clone().addScaledVector(dir, len);
    const cyl = new THREE.CylinderGeometry(r * 0.7, r, len, 6, 1, true);
    cyl.translate(0, len / 2, 0);
    cyl.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, dir));
    cyl.translate(from.x, from.y, from.z);
    parts.push(cyl);
    if (depth === 0) {
      const tip = new THREE.SphereGeometry(r * 0.75, 6, 4);
      tip.translate(to.x, to.y, to.z);
      parts.push(tip);
      return;
    }
    const n = depth > 1 ? 3 : 2;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + rng() * 1.5;
      const d = dir.clone().add(new THREE.Vector3(Math.cos(a) * 0.55, 0.25 + rng() * 0.3, Math.sin(a) * 0.55)).normalize();
      grow(to, d, len * (0.72 + rng() * 0.15), r * 0.72, depth - 1);
    }
  };
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + rng();
    grow(new THREE.Vector3(Math.cos(a) * 0.08, 0, Math.sin(a) * 0.08), new THREE.Vector3(Math.cos(a) * 0.35, 1, Math.sin(a) * 0.35).normalize(), 0.3, 0.05, 3);
  }
  const g = mergeGeometries(parts.map((q) => q.toNonIndexed()));
  g.computeVertexNormals();
  return g;
}

/** テーブルサンゴ：短い柄の上の、ふちの波打つ平らな板（直径 1） */
function tableGeometry() {
  const top = new THREE.CylinderGeometry(0.5, 0.42, 0.06, 28, 1);
  const p = top.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const z = p.getZ(i);
    const a = Math.atan2(z, x);
    const r = Math.hypot(x, z);
    p.setY(i, p.getY(i) + 0.35 + Math.sin(a * 5) * 0.03 * r + r * r * 0.12);
  }
  const stalk = new THREE.CylinderGeometry(0.06, 0.1, 0.36, 8);
  stalk.translate(0, 0.18, 0);
  const g = mergeGeometries([top.toNonIndexed(), stalk.toNonIndexed()]);
  g.computeVertexNormals();
  return g;
}

/** 柱のサンゴ・筒の海綿：根元から立つ何本かの筒（高さ約 1） */
function tubeGeometry(seed) {
  const rng = mulberry(seed);
  const parts = [];
  const n = 3 + Math.floor(rng() * 3);
  for (let k = 0; k < n; k++) {
    const h = 0.5 + rng() * 0.5;
    const r = 0.07 + rng() * 0.05;
    const c = new THREE.CylinderGeometry(r * 1.15, r, h, 10, 1, true);
    c.translate(Math.cos(k * 2.1) * 0.12 * rng(), h / 2, Math.sin(k * 2.1) * 0.12 * rng());
    parts.push(c.toNonIndexed());
  }
  const g = mergeGeometries(parts);
  g.computeVertexNormals();
  return g;
}

/** イソギンチャク：短い太い胴と、上へのびる何十本もの触手（高さ約 0.5） */
function anemoneGeometry() {
  const parts = [];
  const body = new THREE.CylinderGeometry(0.16, 0.18, 0.12, 14);
  body.translate(0, 0.06, 0);
  parts.push(body.toNonIndexed());
  const up = new THREE.Vector3(0, 1, 0);
  for (let k = 0; k < 46; k++) {
    const a = k * 2.39996;
    const r = 0.03 + Math.sqrt(k / 46) * 0.13;
    const len = 0.22 + (1 - r / 0.16) * 0.16;
    const t = new THREE.CylinderGeometry(0.006, 0.014, len, 4, 3, true);
    t.translate(0, len / 2, 0);
    t.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, new THREE.Vector3(Math.cos(a) * r * 2.2, 1, Math.sin(a) * r * 2.2).normalize()));
    t.translate(Math.cos(a) * r, 0.11, Math.sin(a) * r);
    parts.push(t.toNonIndexed());
  }
  const g = mergeGeometries(parts);
  g.computeVertexNormals();
  return g;
}

/** ウミウチワ：扇の形の網（テクスチャを透かした板。高さ 1） */
function fanTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d');
  x.strokeStyle = '#fff';
  x.lineCap = 'round';
  const rng = mulberry(77);
  const branch = (px, py, a, len, w, d) => {
    const qx = px + Math.cos(a) * len;
    const qy = py - Math.sin(a) * len;
    x.lineWidth = w;
    x.beginPath(); x.moveTo(px, py); x.lineTo(qx, qy); x.stroke();
    if (d <= 0) return;
    branch(qx, qy, a + 0.28 + rng() * 0.2, len * 0.78, w * 0.75, d - 1);
    branch(qx, qy, a - 0.28 - rng() * 0.2, len * 0.78, w * 0.75, d - 1);
  };
  branch(128, 250, Math.PI / 2, 52, 7, 6);
  // 枝のあいだの細かい網
  x.globalAlpha = 0.5;
  x.lineWidth = 1;
  for (let k = 0; k < 90; k++) {
    const a = rng() * Math.PI;
    const r = 30 + rng() * 190;
    x.beginPath();
    x.arc(128, 250, r, Math.PI + 0.35, Math.PI * 2 - 0.35);
    if (k % 3 === 0) x.stroke();
    x.beginPath();
    x.moveTo(128, 250);
    x.lineTo(128 + Math.cos(a + Math.PI) * -r, 250 - Math.sin(a) * r);
    if (k % 2 === 0) x.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 砂地のゆれる光の網（コースティクス）のテクスチャ */
function causticTexture() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const x = c.getContext('2d');
  const img = x.createImageData(S, S);
  // いくつかの点のまわりの、ボロノイの境目を明るく
  const rng = mulberry(5);
  const pts = Array.from({ length: 26 }, () => [rng() * S, rng() * S]);
  for (let j = 0; j < S; j++) {
    for (let i = 0; i < S; i++) {
      let d1 = 1e9;
      let d2 = 1e9;
      for (const [px, py] of pts) {
        for (const ox of [-S, 0, S]) {
          for (const oy of [-S, 0, S]) {
            const d = Math.hypot(i - px - ox, j - py - oy);
            if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
          }
        }
      }
      const edge = Math.max(0, 1 - (d2 - d1) / 7);
      const v = Math.round(255 * edge ** 1.6);
      const k = (j * S + i) * 4;
      img.data[k] = v;
      img.data[k + 1] = v;
      img.data[k + 2] = v;
      img.data[k + 3] = 255;
    }
  }
  x.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function createReef() {
  const group = new THREE.Group();
  group.name = 'reef';
  group.visible = false;
  const time = { value: 0 };
  const groundAt = (x, z) => hillHeight(x, z);
  const C = REEF;

  // --- 根（岩の上のサンゴの山）の場所 -------------------------------------------
  const heads = [];
  for (let k = 0; k < 15; k++) {
    for (let tries = 0; tries < 60; tries++) {
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(rand()) * C.r * 0.92;
      const x = C.x + Math.cos(a) * r;
      const z = C.z + Math.sin(a) * r;
      if (heads.some((h) => Math.hypot(h.x - x, h.z - z) < 6.5)) continue;
      heads.push({ x, z, y: groundAt(x, z), size: R(1.8, 3.2) });
      break;
    }
  }

  // --- 岩 --------------------------------------------------------------------------
  const rocks = [];
  const ROCK = [0x6d6358, 0x7a6f66, 0x5f5a5f, 0x7b6a70, 0x86796a];
  for (const h of heads) {
    const n = 3 + Math.floor(rand() * 3);
    for (let k = 0; k < n; k++) {
      const a = rand() * Math.PI * 2;
      const d = rand() * h.size * 0.6;
      const x = h.x + Math.cos(a) * d;
      const z = h.z + Math.sin(a) * d;
      const s = h.size * R(0.45, 0.8) * (1 - d / (h.size * 1.4));
      rocks.push({ x, y: groundAt(x, z) + s * 0.25, z, s, sy: R(0.55, 0.85), yaw: rand() * 6, color: pick(ROCK) });
    }
  }
  // 砂地の小さな石
  for (let k = 0; k < 30; k++) {
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand()) * C.r;
    const x = C.x + Math.cos(a) * r;
    const z = C.z + Math.sin(a) * r;
    rocks.push({ x, y: groundAt(x, z) + 0.05, z, s: R(0.15, 0.4), sy: 0.6, yaw: rand() * 6, color: pick(ROCK) });
  }
  group.add(instanced(rockGeometry(), new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: false }), rocks));

  // 根の上の置き場所（岩の上面のあたり）
  const onHead = (h, spread = 0.9) => {
    const a = rand() * Math.PI * 2;
    const d = Math.sqrt(rand()) * h.size * spread;
    const x = h.x + Math.cos(a) * d;
    const z = h.z + Math.sin(a) * d;
    const top = h.size * 0.55 * (1 - (d / (h.size * 1.1)) ** 2);
    return { x, z, y: groundAt(x, z) + Math.max(0.05, top) };
  };
  const onSand = () => {
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand()) * C.r;
    const x = C.x + Math.cos(a) * r;
    const z = C.z + Math.sin(a) * r;
    return { x, z, y: groundAt(x, z) };
  };

  // --- 脳サンゴ -----------------------------------------------------------------------
  const BRAIN = [0xe0c848, 0xa6e05a, 0xf09a58, 0xc89af0, 0x5fe0a8, 0xf0d070];
  const brains = [];
  for (const h of heads) for (let k = 0; k < 5; k++) { const p = onHead(h); brains.push({ ...p, s: R(0.25, 0.55), sy: R(0.7, 1), yaw: rand() * 6, color: pick(BRAIN) }); }
  group.add(instanced(brainGeometry(), new THREE.MeshStandardMaterial({ roughness: 0.8 }), brains));

  // --- 枝サンゴ（3 つの形） -----------------------------------------------------------
  const BRANCH = [0xff6f91, 0xb366ff, 0x33d6e0, 0xffc233, 0x7dff5c, 0xff7a3d, 0xff9ad0];
  for (let v = 0; v < 3; v++) {
    const items = [];
    for (const h of heads) for (let k = 0; k < 4; k++) { const p = onHead(h, 0.85); items.push({ ...p, s: R(0.5, 1.1), yaw: rand() * 6, color: pick(BRANCH) }); }
    group.add(instanced(branchGeometry(100 + v), new THREE.MeshStandardMaterial({ roughness: 0.7 }), items));
  }

  // 砂地にも小さなサンゴを散らす（根と根のあいだが、ただの砂にならないように）
  {
    const small = [];
    for (let k = 0; k < 70; k++) { const p = onSand(); small.push({ ...p, s: R(0.15, 0.35), sy: R(0.6, 1), yaw: rand() * 6, color: pick(BRAIN) }); }
    group.add(instanced(brainGeometry(), new THREE.MeshStandardMaterial({ roughness: 0.8 }), small));
    const twigs = [];
    for (let k = 0; k < 50; k++) { const p = onSand(); twigs.push({ ...p, s: R(0.25, 0.5), yaw: rand() * 6, color: pick(BRANCH) }); }
    group.add(instanced(branchGeometry(300), new THREE.MeshStandardMaterial({ roughness: 0.7 }), twigs));
  }

  // --- テーブルサンゴ -------------------------------------------------------------------
  const tables = [];
  for (const h of heads) for (let k = 0; k < 2; k++) if (rand() < 0.75) { const p = onHead(h, 0.7); tables.push({ ...p, s: R(0.9, 1.7), yaw: rand() * 6, tilt: R(-0.12, 0.12), color: pick([0xd8b86a, 0x9fd67a, 0xe0a070, 0x7fc8d8]) }); }
  group.add(instanced(tableGeometry(), new THREE.MeshStandardMaterial({ roughness: 0.75 }), tables));

  // --- 柱のサンゴ・筒の海綿 -----------------------------------------------------------
  const TUBE = [0xff8a30, 0xb05cf0, 0xf0da40, 0xf05080, 0x40b0ff];
  for (let v = 0; v < 2; v++) {
    const items = [];
    for (let k = 0; k < 18; k++) { const p = rand() < 0.75 ? onHead(pick(heads), 1) : onSand(); items.push({ ...p, s: R(0.4, 0.9), yaw: rand() * 6, color: pick(TUBE) }); }
    group.add(instanced(tubeGeometry(200 + v), new THREE.MeshStandardMaterial({ roughness: 0.85, side: THREE.DoubleSide }), items));
  }

  // --- ソフトコーラル（ゆれる、ふさふさ） --------------------------------------------
  const soft = [];
  for (const h of heads) for (let k = 0; k < 4; k++) { const p = onHead(h); soft.push({ ...p, s: R(0.6, 1.1), yaw: rand() * 6, color: pick([0xff9ad0, 0xfff07a, 0xb8ff8a, 0xffb060, 0xc0a0ff]) }); }
  const softMat = swayMaterial(new THREE.MeshStandardMaterial({ roughness: 0.9, emissive: 0x221018 }), time, { amp: 0.05, freq: 1.1, height: 0.5 });
  group.add(instanced(anemoneGeometry(), softMat, soft));

  // --- イソギンチャク（クマノミの家） -------------------------------------------------
  const anemones = [];
  for (let k = 0; k < 6; k++) {
    const h = heads[k % heads.length];
    const p = onHead(h, 0.7);
    anemones.push({ ...p, s: R(1.3, 1.8), yaw: rand() * 6, color: pick([0xd9e8a0, 0xf0b8d0, 0xb0e0d0]) });
  }
  const anemoneMat = swayMaterial(new THREE.MeshStandardMaterial({ roughness: 0.6, emissive: 0x1a1a10 }), time, { amp: 0.07, freq: 1.6, height: 0.45 });
  group.add(instanced(anemoneGeometry(), anemoneMat, anemones));

  // --- ウミウチワ -----------------------------------------------------------------------
  const fans = [];
  for (const h of heads) for (let k = 0; k < 2; k++) if (rand() < 0.8) { const p = onHead(h, 1); fans.push({ ...p, s: R(0.8, 1.5), yaw: rand() * Math.PI, color: pick([0xb04ad0, 0xe0503a, 0xf0a030, 0xd84890]) }); }
  const fanGeo = new THREE.PlaneGeometry(1, 1, 1, 6);
  fanGeo.translate(0, 0.5, 0);
  const fanMat = swayMaterial(new THREE.MeshStandardMaterial({ map: fanTexture(), alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.9 }), time, { amp: 0.12, freq: 0.9, height: 1 });
  group.add(instanced(fanGeo, fanMat, fans));

  // --- 海草（砂地） -------------------------------------------------------------------
  const blades = [];
  for (let k = 0; k < 7; k++) {
    const c0 = onSand();
    for (let j = 0; j < 40; j++) {
      const x = c0.x + R(-1.6, 1.6);
      const z = c0.z + R(-1.6, 1.6);
      blades.push({ x, y: groundAt(x, z), z, s: R(0.35, 0.8), sx: 0.06, yaw: rand() * 6, color: pick([0x4f8f3a, 0x6aa64a, 0x3d7a3a]) });
    }
  }
  const bladeGeo = new THREE.PlaneGeometry(1, 1, 1, 5);
  bladeGeo.translate(0, 0.5, 0);
  const bladeMat = swayMaterial(new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.8 }), time, { amp: 0.18, freq: 1.2, height: 1 });
  group.add(instanced(bladeGeo, bladeMat, blades));

  // --- ヒトデ・ウニ・シャコガイ --------------------------------------------------------
  const star = new THREE.Shape();
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    const r = k % 2 === 0 ? 1 : 0.38;
    if (k === 0) star.moveTo(Math.cos(a) * r, Math.sin(a) * r); else star.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const starGeo = new THREE.ExtrudeGeometry(star, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.08, bevelSegments: 2 });
  starGeo.rotateX(-Math.PI / 2);
  const stars = [];
  for (let k = 0; k < 14; k++) { const p = onSand(); stars.push({ ...p, y: p.y + 0.02, s: R(0.09, 0.14), yaw: rand() * 6, color: pick([0xe8662a, 0x3a6fd0, 0xd23a3a, 0xf0b040]) }); }
  group.add(instanced(starGeo, new THREE.MeshStandardMaterial({ roughness: 0.7 }), stars));
  // ウニ：黒いとげの玉
  const urchinParts = [new THREE.SphereGeometry(0.35, 10, 8).toNonIndexed()];
  for (let k = 0; k < 60; k++) {
    const v = new THREE.Vector3().randomDirection();
    if (v.y < -0.2) continue;
    const sp = new THREE.ConeGeometry(0.025, 0.7, 4);
    sp.translate(0, 0.35, 0);
    sp.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), v));
    urchinParts.push(sp.toNonIndexed());
  }
  const urchinGeo = mergeGeometries(urchinParts);
  urchinGeo.computeVertexNormals();
  const urchins = [];
  for (let k = 0; k < 12; k++) { const p = rand() < 0.6 ? onHead(pick(heads), 1.1) : onSand(); urchins.push({ ...p, y: p.y + 0.05, s: R(0.12, 0.2), yaw: rand() * 6, color: 0x1a1420 }); }
  group.add(instanced(urchinGeo, new THREE.MeshStandardMaterial({ roughness: 0.5 }), urchins));
  // シャコガイ：波打つ殻と、青緑に光る外套膜
  const clamShell = new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.5);
  {
    const p = clamShell.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const a = Math.atan2(p.getZ(i), p.getX(i));
      p.setY(i, p.getY(i) * 0.55 + Math.sin(a * 6) * 0.06);
      p.setX(i, p.getX(i) * 1.4);
    }
    clamShell.computeVertexNormals();
  }
  const clams = [];
  for (let k = 0; k < 6; k++) { const p = onHead(pick(heads), 0.9); clams.push({ ...p, y: p.y + 0.12, s: R(0.16, 0.26), yaw: rand() * 6, color: 0xcfc6b4 }); }
  group.add(instanced(clamShell, new THREE.MeshStandardMaterial({ roughness: 0.6, side: THREE.DoubleSide }), clams));
  const mantle = new THREE.CircleGeometry(1, 20);
  mantle.rotateX(-Math.PI / 2);
  mantle.scale(1.3, 1, 0.34);
  group.add(instanced(mantle, new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x1f6fa8, emissiveIntensity: 0.6, roughness: 0.3 }), clams.map((c) => ({ ...c, y: c.y + 0.005, color: pick([0x2f8ad8, 0x3ac0b0, 0x6a4ad8]) }))));

  // --- コースティクス（砂地にゆれる光の網）：地形に沿った網目を、足し算の光で2枚重ねる -----------
  const causticTex = causticTexture();
  const N = 48;
  const size = (C.r + 14) * 2;
  const cg = new THREE.PlaneGeometry(size, size, N, N);
  cg.rotateX(-Math.PI / 2);
  {
    const p = cg.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i) + C.x;
      const z = p.getZ(i) + C.z;
      p.setXYZ(i, x, groundAt(x, z) + 0.06, z);
    }
    cg.computeVertexNormals();
  }
  const causticMats = [0, 1].map((k) => {
    const t = causticTex.clone();
    t.needsUpdate = true;
    t.repeat.set(size / (k ? 5.5 : 4), size / (k ? 5.5 : 4));
    return new THREE.MeshBasicMaterial({ map: t, color: k ? 0x7fd6ff : 0xa0f0ff, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, fog: true });
  });
  for (const m of causticMats) {
    const mesh = new THREE.Mesh(cg, m);
    mesh.renderOrder = 1;
    group.add(mesh);
  }

  // --- 水面から差しこむ光の筋 --------------------------------------------------------
  const rayTex = (() => {
    const c = document.createElement('canvas');
    c.width = 32; c.height = 128;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, 128);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 32, 128);
    const h = x.createLinearGradient(0, 0, 32, 0);
    h.addColorStop(0, 'rgba(0,0,0,1)');
    h.addColorStop(0.5, 'rgba(0,0,0,0)');
    h.addColorStop(1, 'rgba(0,0,0,1)');
    x.globalCompositeOperation = 'destination-out';
    x.fillStyle = h;
    x.fillRect(0, 0, 32, 128);
    return new THREE.CanvasTexture(c);
  })();
  const rays = [];
  const rayMat = new THREE.MeshBasicMaterial({ map: rayTex, color: 0xcff6ff, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  for (let k = 0; k < 14; k++) {
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand()) * C.r;
    const x = C.x + Math.cos(a) * r;
    const z = C.z + Math.sin(a) * r;
    const len = SEA_LEVEL - groundAt(x, z);
    const w = R(0.8, 2.2);
    const ray = new THREE.Group();
    for (const yaw of [0, Math.PI / 2]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, len), rayMat);
      m.position.y = -len / 2;
      m.rotation.y = yaw;
      ray.add(m);
    }
    ray.position.set(x, SEA_LEVEL, z);
    ray.rotation.z = 0.18;           // 日の差す向きへ少し傾ける
    ray.userData.phase = rand() * 6;
    group.add(ray);
    rays.push(ray);
  }

  function update(dt, eye = null) {
    time.value += dt;
    causticMats[0].map.offset.set(time.value * 0.03, time.value * 0.018);
    causticMats[1].map.offset.set(-time.value * 0.022, time.value * 0.027);
    for (const ray of rays) {
      ray.rotation.z = 0.18 + Math.sin(time.value * 0.4 + ray.userData.phase) * 0.05;
      // 近づくと薄く（筋の中に入ると板が見えてしまう）
      if (eye) ray.visible = Math.hypot(eye.x - ray.position.x, eye.z - ray.position.z) > 2.5;
    }
  }

  return {
    group,
    update,
    heads,
    /** イソギンチャクの場所（クマノミの家）。y は触手の上のあたり */
    anemones: anemones.map((a) => new THREE.Vector3(a.x, a.y + 0.25 * a.s, a.z)),
    /** 海の底の高さ */
    groundAt,
    /** 根（岩とサンゴ）の上の高さ。根の外は砂地 */
    floorAt(x, z) {
      let y = groundAt(x, z);
      for (const h of heads) {
        const d = Math.hypot(x - h.x, z - h.z);
        if (d < h.size * 1.1) y = Math.max(y, h.y + h.size * 0.75 * (1 - (d / (h.size * 1.1)) ** 2));
      }
      return y;
    },
    time,
  };
}
