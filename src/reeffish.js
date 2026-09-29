import * as THREE from 'three';
import { SEA_LEVEL } from './hill.js';

/**
 * サンゴ礁の熱帯魚（reef.js の根のまわり）。種類ごとに 1 つの形（頂点の色で模様）を、インスタンスで何匹も描く。
 *
 *   クマノミ（オレンジに白い帯 3 本）……イソギンチャクのすぐ上で、2〜3 匹ずつ
 *   デバスズメダイ（青緑の小さな魚）……根の上に群れ（50 匹）
 *   ナンヨウハギ（青に黒い模様、黄色い尾）・キイロハギ（まっ黄色、円い体）・
 *   チョウチョウウオ（白と黄に黒い目の帯）・ツノダシ（白と黒の帯、長い背びれ）……根から根へゆっくり
 *   ブダイ（青緑にピンク、大きい）……礁の中を大きく回る
 * 泳ぎ方：それぞれの「家」（イソギンチャク・根）のまわりの行き先へ向かい、着いたら次の行き先へ。
 * 群れは互いに離れすぎず・近すぎず。ダイバー（プレイヤー・女の子）が 1.5m より近づくと逃げる。
 * 海の底・根の上・水面より出ない。尾はシェーダーで振る（インスタンスごとに位相をずらす）
 */
// 見えやすいように、本物より 1.6 倍大きく（10cm の魚は、2m 先では点にしか見えない）
const FISH_SCALE = 1.6;
const SPECIES = [
  { key: 'clown', count: 18, len: 0.11, height: 0.42, width: 0.35, speed: 0.35, home: 'anemone', roam: 0.45, color: clownColor, tail: 'round' },
  { key: 'chromis', count: 90, len: 0.08, height: 0.4, width: 0.28, speed: 0.6, home: 'school', roam: 2.2, color: (u, v) => mix(0x6fe0d8, 0x3a9bd8, v * 0.5 + 0.5), tail: 'fork' },
  { key: 'bluetang', count: 14, len: 0.26, height: 0.55, width: 0.2, speed: 0.55, home: 'head', roam: 4, color: blueTangColor, tail: 'fork' },
  { key: 'yellowtang', count: 18, len: 0.2, height: 0.78, width: 0.18, speed: 0.45, home: 'head', roam: 3, color: () => 0xffd21a, tail: 'fork' },
  { key: 'butterfly', count: 12, len: 0.16, height: 0.8, width: 0.16, speed: 0.4, home: 'head', roam: 3, color: butterflyColor, tail: 'round' },
  { key: 'idol', count: 8, len: 0.2, height: 0.85, width: 0.16, speed: 0.45, home: 'head', roam: 4, color: idolColor, tail: 'fork', crest: true },
  { key: 'parrot', count: 5, len: 0.55, height: 0.42, width: 0.28, speed: 0.8, home: 'reef', roam: 14, color: parrotColor, tail: 'fork' },
];

function mix(a, b, k) {
  const ca = new THREE.Color(a);
  const cb = new THREE.Color(b);
  return ca.lerp(cb, THREE.MathUtils.clamp(k, 0, 1)).getHex();
}
/** 模様：u は前（0 = 口）→ 後ろ（1 = 尾の付け根）、v は腹（-1）→ 背（1） */
function clownColor(u) {
  const bands = [0.18, 0.5, 0.86];
  for (const b of bands) {
    const d = Math.abs(u - b);
    if (d < 0.05) return 0xffffff;
    if (d < 0.065) return 0x111111;
  }
  return 0xff6a10;
}
function blueTangColor(u, v) {
  if (u > 0.92) return 0xffd21a;
  // 背の黒い「パレット」模様
  if (v > 0.05 && u > 0.2 && u < 0.85 && Math.abs(v - 0.45 + (u - 0.5) * 0.4) < 0.18) return 0x10142a;
  return 0x2a4fe0;
}
function butterflyColor(u, v) {
  if (Math.abs(u - 0.17) < 0.045) return 0x111111;      // 目を通る黒い帯
  return v > -0.1 && u > 0.35 ? 0xffd84a : 0xf4f2ea;
}
function idolColor(u) {
  if (Math.abs(u - 0.2) < 0.08 || Math.abs(u - 0.62) < 0.1) return 0x111111;
  if (u > 0.8) return 0xf6d14a;
  return 0xf8f6ee;
}
function parrotColor(u, v) {
  const k = Math.sin(u * 22 + v * 3) * 0.5 + 0.5;
  return mix(mix(0x2fc4a8, 0x3d8ae0, v * 0.5 + 0.5), 0xf07ab8, k * 0.25 + (u > 0.9 ? 0.6 : 0));
}

/** 魚の形：左右に平たい紡錘の胴と尾びれ（背びれ・しりびれ）。+Z が前、長さ len。頂点の色で模様 */
function fishGeometry(sp) {
  const L = sp.len;
  const H = L * sp.height;
  const W = L * sp.width;
  const body = new THREE.SphereGeometry(1, 18, 12);
  const p = body.attributes.position;
  const col = new Float32Array(p.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    // 後ろ（-z）ほど細く、尾の付け根で絞る
    const taper = z < 0 ? 1 - 0.55 * (-z) ** 1.3 : 1 - 0.15 * z * z;
    p.setXYZ(i, x * W * 0.5 * taper, y * H * 0.5 * taper, z * L * 0.5);
    const u = 0.5 - z * 0.5;
    c.setHex(sp.color(u, y));
    // 腹は少し明るく、背は少し暗く
    c.multiplyScalar(1 + (y < 0 ? 0.08 : -0.08) * Math.abs(y));
    col.set([c.r, c.g, c.b], i * 3);
  }
  body.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const parts = [body];
  // 尾びれ（縦の板）
  const tail = new THREE.Shape();
  if (sp.tail === 'fork') {
    tail.moveTo(0, 0); tail.lineTo(-L * 0.3, H * 0.42); tail.lineTo(-L * 0.2, 0); tail.lineTo(-L * 0.3, -H * 0.42); tail.lineTo(0, 0);
  } else {
    tail.moveTo(0, 0); tail.quadraticCurveTo(-L * 0.28, H * 0.4, -L * 0.26, 0); tail.quadraticCurveTo(-L * 0.28, -H * 0.4, 0, 0);
  }
  const tailGeo = new THREE.ShapeGeometry(tail);
  tailGeo.rotateY(-Math.PI / 2);           // 形の -x を後ろ（-z）へ（+π/2 だと前を向く）
  tailGeo.translate(0, 0, -L * 0.42);
  // 背びれ・しりびれ
  const fin = new THREE.Shape();
  const fh = sp.crest ? H * 1.3 : H * 0.28;
  fin.moveTo(L * 0.18, 0); fin.quadraticCurveTo(L * 0.05, fh, sp.crest ? -L * 0.35 : -L * 0.28, fh * (sp.crest ? 1 : 0.4)); fin.lineTo(-L * 0.3, 0); fin.lineTo(L * 0.18, 0);
  const dorsal = new THREE.ShapeGeometry(fin);
  dorsal.rotateY(-Math.PI / 2);
  dorsal.translate(0, H * 0.4, 0);
  const anal = new THREE.ShapeGeometry(fin);
  anal.rotateY(-Math.PI / 2);
  anal.scale(1, -0.6, 1);
  anal.translate(0, -H * 0.38, -L * 0.05);
  const finColor = new THREE.Color(sp.key === 'bluetang' ? 0x10142a : sp.key === 'clown' ? 0xff7a20 : sp.color(0.95, 0));
  for (const g of [tailGeo, dorsal, anal]) {
    const n = g.attributes.position.count;
    const fc = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) fc.set([finColor.r, finColor.g, finColor.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(fc, 3));
    g.deleteAttribute('uv');
    parts.push(g);
  }
  body.deleteAttribute('uv');
  const geos = parts.map((g) => (g.index ? g.toNonIndexed() : g));
  const merged = new THREE.BufferGeometry();
  // まとめる（mergeGeometries を使わず、位置・法線・色だけ）
  const total = geos.reduce((a, g) => a + g.attributes.position.count, 0);
  const pos = new Float32Array(total * 3);
  const colr = new Float32Array(total * 3);
  let o = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, o * 3);
    colr.set(g.attributes.color.array, o * 3);
    o += g.attributes.position.count;
  }
  merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  merged.setAttribute('color', new THREE.BufferAttribute(colr, 3));
  merged.computeVertexNormals();
  return merged;
}

/** 尾を振る材料：後ろ（z < 0）ほど左右にずらす。位相は instanceMatrix の位置から */
function fishMaterial(time, len, freq) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.1, side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          float ph = instanceMatrix[3].x * 3.1 + instanceMatrix[3].z * 2.3;
          float back = clamp(-position.z / ${(len * 0.7).toFixed(4)}, 0.0, 1.2);
          transformed.x += sin(uTime * ${freq.toFixed(2)} + ph) * ${(len * 0.12).toFixed(4)} * back * back;
        }`);
  };
  mat.customProgramCacheKey = () => `fish${len}${freq}`;
  return mat;
}

/**
 * @param {{ reef: ReturnType<import('./reef.js').createReef> }} options
 */
export function createReefFish({ reef }) {
  const group = new THREE.Group();
  group.name = 'reefFish';
  group.visible = false;
  const time = { value: 0 };
  const rand = (a, b) => a + Math.random() * (b - a);
  const heads = reef.heads;
  const schools = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const one = new THREE.Vector3(1, 1, 1);
  const _p = new THREE.Vector3();

  for (const sp of SPECIES) {
    const mesh = new THREE.InstancedMesh(fishGeometry(sp), fishMaterial(time, sp.len, 9 / Math.sqrt(sp.len / 0.1)), sp.count);
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    group.add(mesh);
    const fish = [];
    for (let i = 0; i < sp.count; i++) {
      let home;
      if (sp.home === 'anemone') home = reef.anemones[i % reef.anemones.length].clone();
      else if (sp.home === 'school') { const h = heads[Math.floor(i / 30) % heads.length]; home = new THREE.Vector3(h.x, h.y + h.size * 0.9 + 0.8, h.z); }  // 30 匹ずつの群れ
      else if (sp.home === 'head') { const h = heads[Math.floor(Math.random() * heads.length)]; home = new THREE.Vector3(h.x, h.y + h.size * 0.7, h.z); }
      else home = new THREE.Vector3(reef.heads[0].x, reef.heads[0].y + 2, reef.heads[0].z);
      const f = {
        home, pos: home.clone().add(new THREE.Vector3(rand(-1, 1), rand(-0.3, 0.3), rand(-1, 1)).multiplyScalar(sp.roam * 0.5)),
        vel: new THREE.Vector3(rand(-1, 1), 0, rand(-1, 1)).multiplyScalar(sp.speed * 0.3),
        target: new THREE.Vector3(), next: 0, yaw: rand(0, 6), pitch: 0, scale: rand(0.85, 1.2) * FISH_SCALE,
      };
      fish.push(f);
    }
    schools.push({ sp, mesh, fish });
  }

  function pickTarget(sp, f) {
    if (sp.home === 'reef') {
      // ブダイ：礁の中のどこかの根の上へ
      const h = heads[Math.floor(Math.random() * heads.length)];
      f.target.set(h.x + rand(-2, 2), h.y + h.size * 0.8 + rand(0.2, 1.2), h.z + rand(-2, 2));
    } else if (sp.home === 'head' && Math.random() < 0.25) {
      // 根から根へ引っ越し
      const h = heads[Math.floor(Math.random() * heads.length)];
      f.home.set(h.x, h.y + h.size * 0.7, h.z);
      f.target.copy(f.home);
    } else {
      f.target.copy(f.home).add(new THREE.Vector3(rand(-1, 1), rand(-0.4, 0.5), rand(-1, 1)).multiplyScalar(sp.roam));
    }
    f.next = sp.home === 'anemone' ? rand(0.8, 2) : rand(2.5, 6);
  }

  /**
   * @param {number} dt
   * @param {THREE.Vector3[]} divers 逃げる相手（プレイヤーの目・女の子）
   */
  function update(dt, divers = []) {
    if (!group.visible) return;
    dt = Math.min(dt, 0.05);
    time.value += dt;
    for (const { sp, mesh, fish } of schools) {
      for (let i = 0; i < fish.length; i++) {
        const f = fish[i];
        f.next -= dt;
        if (f.next <= 0 || f.pos.distanceToSquared(f.target) < 0.04) pickTarget(sp, f);
        // 行き先へ
        _p.subVectors(f.target, f.pos);
        const d = _p.length();
        const want = _p.multiplyScalar(Math.min(1, d) * sp.speed / Math.max(d, 1e-3));
        // 群れ：近すぎる仲間から離れる（同じ種類だけ、近い何匹か）
        if (sp.home === 'school' || sp.home === 'head') {
          for (let k = Math.max(0, i - 6); k < Math.min(fish.length, i + 6); k++) {
            if (k === i) continue;
            const o = fish[k];
            const dx = f.pos.x - o.pos.x;
            const dy = f.pos.y - o.pos.y;
            const dz = f.pos.z - o.pos.z;
            const dd = dx * dx + dy * dy + dz * dz;
            const min = sp.len * 3;
            if (dd < min * min && dd > 1e-6) { const s = (min - Math.sqrt(dd)) / min * sp.speed * 2; want.x += dx * s; want.y += dy * s; want.z += dz * s; }
          }
          // デバスズメダイ：群れの真ん中へも少し寄る
          if (sp.home === 'school') { want.x += (f.home.x - f.pos.x) * 0.15; want.z += (f.home.z - f.pos.z) * 0.15; }
        }
        // ダイバーから逃げる
        for (const dv of divers) {
          const dx = f.pos.x - dv.x;
          const dy = f.pos.y - dv.y;
          const dz = f.pos.z - dv.z;
          const dd = dx * dx + dy * dy + dz * dz;
          const R = sp.home === 'anemone' ? 0.7 : 1.5;
          if (dd < R * R) {
            const s = (R - Math.sqrt(dd)) / R * sp.speed * 4 / Math.max(0.2, Math.sqrt(dd));
            want.x += dx * s; want.y += dy * s * 0.5; want.z += dz * s;
          }
        }
        f.vel.lerp(want, Math.min(1, dt * 2.5));
        const sp2 = f.vel.length();
        const max = sp.speed * 2.2;
        if (sp2 > max) f.vel.multiplyScalar(max / sp2);
        f.pos.addScaledVector(f.vel, dt);
        // 海の底・根の上・水面より出ない
        const floor = reef.floorAt(f.pos.x, f.pos.z) + sp.len * 1.2;
        if (f.pos.y < floor) { f.pos.y = floor; f.vel.y = Math.abs(f.vel.y) * 0.5; }
        if (f.pos.y > SEA_LEVEL - 0.6) { f.pos.y = SEA_LEVEL - 0.6; f.vel.y = -Math.abs(f.vel.y); }
        // 向き：進む向きへ（ゆっくり回る）
        if (sp2 > 0.02) {
          const yw = Math.atan2(f.vel.x, f.vel.z);
          let dy = yw - f.yaw;
          dy = Math.atan2(Math.sin(dy), Math.cos(dy));
          f.yaw += dy * Math.min(1, dt * 6);
          const pw = -Math.atan2(f.vel.y, Math.hypot(f.vel.x, f.vel.z)) * 0.6;
          f.pitch += (pw - f.pitch) * Math.min(1, dt * 4);
        }
        e.set(f.pitch, f.yaw, 0, 'YXZ');
        q.setFromEuler(e);
        m.compose(f.pos, q, one.set(f.scale, f.scale, f.scale));
        mesh.setMatrixAt(i, m);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  return {
    group,
    update,
    get count() { return schools.reduce((a, s) => a + s.fish.length, 0); },
    /** (x, y, z) にいちばん近い魚の位置（女の子が指さす・見る） */
    nearest(p, out = new THREE.Vector3()) {
      let bd = Infinity;
      for (const { fish } of schools) for (const f of fish) { const d = f.pos.distanceToSquared(p); if (d < bd) { bd = d; out.copy(f.pos); } }
      return Math.sqrt(bd);
    },
    schools,
  };
}
