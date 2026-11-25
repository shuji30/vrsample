import * as THREE from 'three';
import { lawnPatch } from './lawn.js';

/**
 * 芝の草の束。庭の芝生（丘の上の平らな所）に、細い葉を数本ずつ束にして生やす。
 *
 * 芝の地面は 1 枚の板にテクスチャを貼っただけなので、足もとを見ると平らな絵に見える。近くの草に立体の葉があると、
 * 地面に厚みが出る。
 *
 * どこに生やすか：起動時に、庭を真上から 1 回だけ描いて「芝の板が見えている所」の地図を作り、そこだけに生やす。
 * 芝の板は白、ほかの物（コート・テラス・カートのコース・砂場・池・家・遊具・木の葉）は黒で描くので、
 * 物が置いてある所と、その下には生えない。場所の一覧を手で持たないので、あとから物が増えても、そのまま避ける。
 *
 * 軽さ：透ける板（アルファ）は使わず、細い三角の葉そのものを InstancedMesh 1 つで描く（描画命令 1 回。重なっても
 * 透明の描き重ねが起きないので、Quest 単体でも負担が小さい）。影は落とさない（受けるだけ）。
 */

/** 葉を揺らす時刻（秒）。update が入れる */
const grassTime = { value: 0 };

/** 1 束ぶんの形：根もとから外へ少し倒れた細い葉を 8 本（1 本＝三角 1 枚）。高さ 1・根もとが原点。頂点色で、根もとを暗く・先を明るく */
function tuftGeometry() {
  const pos = [];
  const col = [];
  // 色は芝の地面に合わせる（明るい黄緑にすると、芝の上に別の草が生えたように浮く）
  const base = new THREE.Color(0x2b4519);
  const tip = new THREE.Color(0x5d8632);
  const c = new THREE.Color();
  const BLADES = 8;
  for (let i = 0; i < BLADES; i++) {
    const a = (i / BLADES) * Math.PI * 2 + i * 0.9;
    const lean = 0.2 + (i % 3) * 0.16;           // 外への倒れ
    const h = 0.7 + ((i * 37) % 5) * 0.075;      // 葉ごとの高さ
    const w = 0.085;
    const r0 = 0.04 + (i % 4) * 0.07;            // 根もとを束の中でばらつかせる
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    // 葉 1 本＝三角 1 枚（根もとの 2 点と先）。幅の向きは、倒れる向きと直角
    const p = [
      [dx * r0 + dz * w, 0, dz * r0 - dx * w], [dx * r0 - dz * w, 0, dz * r0 + dx * w],
      [dx * (r0 + lean), h, dz * (r0 + lean)],
    ];
    for (const v of p) {
      pos.push(...v);
      c.copy(base).lerp(tip, Math.min(1, v[1] / h));
      col.push(c.r, c.g, c.b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  // 法線はすべて上向き：葉の向きで明るさがばらつかず、芝の地面と同じように照らされる（裏を向いた葉が黒くならない）
  const nor = new Float32Array(pos.length);
  for (let i = 1; i < nor.length; i += 3) nor[i] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return g;
}

/**
 * @param {THREE.WebGLRenderer} renderer
 * @param {THREE.Scene} scene ほかの物をすべて置いたあとで呼ぶ
 * @param {object} options
 * @param {THREE.Material} options.lawnMaterial 芝の板の素材（これを使っている板を「芝」とみなす）
 * @param {{minX:number,maxX:number,minZ:number,maxZ:number}} options.bounds 生やす範囲
 * @param {number} [options.count] 束の数
 * @param {(x:number,z:number)=>number} [options.height] 地面の高さ
 */
export function createGrass(renderer, scene, { lawnMaterial, bounds, count = 30000, height = () => 0 }) {
  const W = bounds.maxX - bounds.minX;
  const D = bounds.maxZ - bounds.minZ;
  // --- 芝の見えている所の地図（真上から、0.2m ごと） ---
  const RES = 5;                                  // 1m あたりの画素
  const mw = Math.round(W * RES);
  const mh = Math.round(D * RES);
  const target = new THREE.WebGLRenderTarget(mw, mh, { depthBuffer: true });
  const camera = new THREE.OrthographicCamera(-W / 2, W / 2, D / 2, -D / 2, 0.1, 120);
  camera.position.set((bounds.minX + bounds.maxX) / 2, 60, (bounds.minZ + bounds.maxZ) / 2);
  camera.up.set(0, 0, -1);                        // 画面の上が -Z（北）
  camera.lookAt(camera.position.x, 0, camera.position.z);
  camera.updateMatrixWorld(true);
  const white = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, fog: false });
  const black = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide, fog: false });
  const restore = [];
  scene.traverse((o) => {
    if (o.isMesh) {
      restore.push([o, 'material', o.material]);
      o.material = o.material === lawnMaterial ? white : black;
    } else if (o.isPoints || o.isLine || o.isSprite) {
      if (o.visible) { restore.push([o, 'visible', true]); o.visible = false; }
    }
  });
  const saved = { target: renderer.getRenderTarget(), background: scene.background, fog: scene.fog, xr: renderer.xr.enabled, shadow: renderer.shadowMap.autoUpdate };
  const pixels = new Uint8Array(mw * mh * 4);
  try {
    scene.background = null;
    scene.fog = null;
    renderer.xr.enabled = false;
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 1);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.readRenderTargetPixels(target, 0, 0, mw, mh, pixels);
  } finally {
    for (const [o, key, value] of restore) o[key] = value;
    scene.background = saved.background;
    scene.fog = saved.fog;
    renderer.xr.enabled = saved.xr;
    renderer.shadowMap.autoUpdate = saved.shadow;
    renderer.setRenderTarget(saved.target);
    target.dispose();
    white.dispose();
    black.dispose();
  }
  /** (x, z) とそのまわり 0.2m が、すべて芝か（物のふちぎりぎりには生やさない） */
  const isLawn = (x, z) => {
    const px = Math.floor((x - bounds.minX) * RES);
    const py = Math.floor((bounds.maxZ - z) * RES);   // 読み出した画像は下の行から。画面の下が +Z
    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) {
        const qx = px + i;
        const qy = py + j;
        if (qx < 0 || qy < 0 || qx >= mw || qy >= mh) return false;
        if (pixels[(qy * mw + qx) * 4] < 128) return false;
      }
    }
    return true;
  };

  // --- 束を置く（毎回同じ場所になるよう、決まった乱数で） ---
  let seed = 20261120;
  const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const spots = [];
  let lawnHits = 0;
  for (let tries = 0; tries < count * 6 && spots.length < count; tries++) {
    const x = bounds.minX + rand() * W;
    const z = bounds.minZ + rand() * D;
    const s = 0.055 + rand() * 0.055;               // 束の高さ（m）。刈った芝より少し伸びた草
    const yaw = rand() * Math.PI * 2;
    const shade = 0.82 + rand() * 0.36;
    if (!isLawn(x, z)) continue;
    lawnHits++;
    spots.push([x, z, s, yaw, shade]);
  }

  const material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  material.onBeforeCompile = (shader) => {
    // 風：葉の先ほど大きく、束ごとにずらして揺らす
    shader.uniforms.grassTime = grassTime;
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'uniform float grassTime;\nvoid main() {')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
        float grassPhase = instanceMatrix[3].x * 1.31 + instanceMatrix[3].z * 0.87;
      #else
        float grassPhase = 0.0;
      #endif
      float grassBend = position.y * position.y;
      transformed.x += sin( grassTime * 1.7 + grassPhase ) * 0.16 * grassBend;
      transformed.z += cos( grassTime * 1.3 + grassPhase * 1.4 ) * 0.1 * grassBend;`);
  };
  material.customProgramCacheKey = () => 'grassTufts';
  const mesh = new THREE.InstancedMesh(tuftGeometry(), material, spots.length);
  mesh.name = 'grassTufts';
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.frustumCulled = false;
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const tint = new THREE.Color();
  spots.forEach(([x, z, s, yaw, shade], i) => {
    m4.compose(new THREE.Vector3(x, height(x, z), z), q.setFromAxisAngle(up, yaw), new THREE.Vector3(s * 1.7, s, s * 1.7));
    mesh.setMatrixAt(i, m4);
    // 束ごとに、明るさと黄みを少しずらす（芝の地面の色むらに合わせる）
    // 地面の大きな色むら（lawn.js）にも合わせる：黄ばんだ所の束は黄色く、濃い所は濃く
    const pc = lawnPatch(x, z);
    const dry = Math.max(0, Math.min(1, (pc - 0.1) / 0.6)) * 0.6;
    const k = shade * (1 + pc * 0.2);
    mesh.setColorAt(i, tint.setRGB(k * 1.04 * (1 + 0.14 * dry), k * (1 + 0.03 * dry), k * 0.9 * (1 - 0.32 * dry)));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  scene.add(mesh);

  return {
    mesh,
    update(dt) { grassTime.value += dt; },
    /** 検証用：置いた束の数と、芝だった割合 */
    get stats() { return { tufts: spots.length, map: [mw, mh], lawnShare: +(lawnHits / Math.max(1, count)).toFixed(2) }; },
    isLawn,
  };
}
