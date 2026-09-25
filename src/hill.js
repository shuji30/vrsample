import * as THREE from 'three';

/**
 * 海の見える丘。家・庭・公園は丘の上の平らな所（PLATEAU）にあり、まわりの土地が下っていく。
 *
 * 北（テニスコートの奥、-Z）は、平らな所の端から 40m ほどで急に下って、30m 下の海岸へ落ちる。
 * 砂浜のあとに海が地平線まで広がる。ほかの三方はなだらかな丘になって、遠くでやはり海へ下る。
 * 夜の花火は、この海の上に上がる。
 *
 * 地形は 1 枚のメッシュ。格子は、平らな所のまわり（北の斜面を含む）だけ 2.5m 間隔と細かく、
 * 外へ行くほど粗くする（遠くは霧に溶けるので粗くて足りる）。平らな所の中は芝生（park.js）の
 * すぐ下（-2cm）に置き、芝生の端とぴったり合うよう、端の座標を格子の線に入れる。
 * 色は芝生と同じ草の模様に、急な斜面は岩、海の近くは砂を混ぜる（onBeforeCompile で高さから）。
 *
 * 海は大きな円盤。波の凹凸（法線の模様）を流して、きらきらさせる。遠くの丘には木を点々と植える。
 */
export const PLATEAU = { minX: -35, maxX: 35, minZ: -41, maxZ: 15 };
export const SEA_LEVEL = -26;

const smooth = (t) => { const c = Math.min(1, Math.max(0, t)); return c * c * (3 - 2 * c); };

/** 丘の地面の高さ（平らな所の中は 0） */
export function hillHeight(x, z) {
  const P = PLATEAU;
  const dN = Math.max(0, P.minZ - z);
  const dS = Math.max(0, z - P.maxZ);
  const dW = Math.max(0, P.minX - x);
  const dE = Math.max(0, x - P.maxX);
  if (dN + dS + dW + dE === 0) return 0;
  // 北は急（60m で 34m 下がる）、ほかはなだらか（260m で下がりきる）。方角ごとの下がり方を重ねる
  const keep = (1 - smooth(dN / 60)) * (1 - smooth(dW / 260)) * (1 - smooth(dE / 260)) * (1 - smooth(dS / 260));
  let h = -34 * (1 - keep);
  // なだらかな起伏（平らな所の近くでは小さく）
  const d = Math.hypot(dN + dS, dW + dE);
  const wobble = Math.sin(x * 0.021) * Math.cos(z * 0.017) * 5 + Math.sin((x + z) * 0.043) * 2 + Math.sin(x * 0.11 + z * 0.07) * 0.6;
  h += wobble * smooth(d / 40) * (dN > 0 ? 0.35 : 1);
  // 平らな所の端は、ひとつ段を付けずになめらかに下り始める
  return h;
}

/** 格子の座標：dense の範囲は step 間隔、その外は ratio 倍ずつ広げて limit まで。must は必ず入れる */
function axis(denseMin, denseMax, step, limit, ratio, must) {
  const out = new Set();
  for (let v = denseMin; v <= denseMax + 1e-6; v += step) out.add(Math.round(v * 1000) / 1000);
  let s = step;
  let v = denseMax;
  while (v < limit) { s *= ratio; v += s; out.add(Math.round(Math.min(v, limit))); }
  s = step;
  v = denseMin;
  while (v > -limit) { s *= ratio; v -= s; out.add(Math.round(Math.max(v, -limit))); }
  for (const m of must) out.add(m);
  return [...out].sort((a, b) => a - b);
}

/** 波の凹凸（法線の模様）。いくつかの向きの正弦波を重ねて、つなぎ目の無い模様にする */
function waveNormalTexture(size = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const waves = [[1, 2, 0.6], [3, -1, 0.4], [-2, 3, 0.35], [5, 4, 0.2], [-6, 1, 0.15], [7, -5, 0.1]];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let dx = 0;
      let dy = 0;
      for (const [kx, ky, a] of waves) {
        const p = ((kx * x + ky * y) / size) * Math.PI * 2;
        const c = Math.cos(p) * a;
        dx += c * kx;
        dy += c * ky;
      }
      const n = new THREE.Vector3(-dx * 0.08, -dy * 0.08, 1).normalize();
      const i = (y * size + x) * 4;
      img.data[i] = (n.x * 0.5 + 0.5) * 255;
      img.data[i + 1] = (n.y * 0.5 + 0.5) * 255;
      img.data[i + 2] = (n.z * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function createHill(tex) {
  const group = new THREE.Group();
  group.name = 'hill';
  const P = PLATEAU;

  // --- 地形 --------------------------------------------------------------------
  const xs = axis(-130, 130, 2.5, 1800, 1.14, [P.minX, P.maxX]);
  const zs = axis(-150, 80, 2.5, 1800, 1.14, [P.minZ, P.maxZ]);
  const nx = xs.length;
  const nz = zs.length;
  const pos = new Float32Array(nx * nz * 3);
  const uv = new Float32Array(nx * nz * 2);
  const sand = new Float32Array(nx * nz);
  const rock = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const x = xs[i];
      const z = zs[j];
      const inside = x >= P.minX && x <= P.maxX && z >= P.minZ && z <= P.maxZ;
      const y = inside ? -0.02 : hillHeight(x, z);
      pos[k * 3] = x;
      pos[k * 3 + 1] = y;
      pos[k * 3 + 2] = z;
      uv[k * 2] = x;
      uv[k * 2 + 1] = -z;
      sand[k] = 1 - smooth((y - (SEA_LEVEL + 1.2)) / 2.2);
    }
  }
  const index = [];
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      const b = a + 1;
      const c = a + nx;
      const d = c + 1;
      // 平らな所の中（芝生の下）の四角は作らない（見えないし、芝生と重なって影がちらつく）
      const cx = (xs[i] + xs[i + 1]) / 2;
      const cz = (zs[j] + zs[j + 1]) / 2;
      if (cx > P.minX && cx < P.maxX && cz > P.minZ && cz < P.maxZ) continue;
      index.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  // 急な斜面は岩
  const normals = geo.attributes.normal;
  for (let k = 0; k < nx * nz; k++) rock[k] = 1 - smooth((normals.getY(k) - 0.62) / 0.18);
  geo.setAttribute('sand', new THREE.BufferAttribute(sand, 1));
  geo.setAttribute('rock', new THREE.BufferAttribute(rock, 1));
  const ground = tex.material('grass', { uvInMeters: true, normalScale: new THREE.Vector2(0.6, 0.6) });
  ground.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float sand;\nattribute float rock;\nvarying float vSand;\nvarying float vRock;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSand = sand;\nvRock = rock;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vSand;\nvarying float vRock;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.40, 0.36) * (0.8 + 0.4 * diffuseColor.g), vRock);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.78, 0.58) * (0.85 + 0.3 * diffuseColor.r), vSand);`);
  };
  const terrain = new THREE.Mesh(geo, ground);
  terrain.name = 'hillTerrain';
  terrain.receiveShadow = true;
  group.add(terrain);

  // --- 遠くの丘の木（円すいの葉と幹。1 つの InstancedMesh ずつ） ---------------------
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x3f6b35, roughness: 0.9, flatShading: true });
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 0.95 });
  const spots = [];
  let seed = 7;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let n = 0; spots.length < 260 && n < 6000; n++) {
    const a = rand() * Math.PI * 2;
    const r = 50 + rand() * 420;
    const x = Math.cos(a) * r;
    const z = -13 + Math.sin(a) * r;
    if (x > P.minX - 4 && x < P.maxX + 4 && z > P.minZ - 4 && z < P.maxZ + 4) continue;
    if (z < P.minZ - 10 && Math.abs(x) < 140) continue;     // 北の海への眺めを空けておく
    const y = hillHeight(x, z);
    if (y < SEA_LEVEL + 2.5) continue;
    spots.push([x, y, z, 5 + rand() * 6]);
  }
  const leaves = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 7), leafMat, spots.length);
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.15, 0.2, 1, 6), trunkMat, spots.length);
  const m4 = new THREE.Matrix4();
  spots.forEach(([x, y, z, h], i) => {
    m4.compose(new THREE.Vector3(x, y + h * 0.62, z), new THREE.Quaternion(), new THREE.Vector3(h * 0.32, h * 0.8, h * 0.32));
    leaves.setMatrixAt(i, m4);
    m4.compose(new THREE.Vector3(x, y + h * 0.12, z), new THREE.Quaternion(), new THREE.Vector3(h * 0.5, h * 0.3, h * 0.5));
    trunks.setMatrixAt(i, m4);
  });
  group.add(leaves, trunks);

  // --- 海 ------------------------------------------------------------------------
  const normalMap = waveNormalTexture();
  normalMap.repeat.set(220, 220);
  const seaMat = new THREE.MeshStandardMaterial({
    color: 0x1d6690, roughness: 0.08, metalness: 0.15,
    normalMap, normalScale: new THREE.Vector2(0.45, 0.45),
  });
  const sea = new THREE.Mesh(new THREE.CircleGeometry(1900, 96), seaMat);
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = SEA_LEVEL;
  sea.name = 'sea';
  group.add(sea);
  // --- 沖の景色：島・灯台・ヨット ------------------------------------------------
  const islandMat = new THREE.MeshStandardMaterial({ color: 0x4f7a42, roughness: 0.95, flatShading: true });
  for (const [x, z, r, h] of [[-260, -520, 70, 36], [340, -760, 110, 55], [-60, -900, 50, 22]]) {
    // 円すいに凹凸を付けて、ピラミッドに見えないように（頂上は丸め、すそは広げる）
    const g = new THREE.ConeGeometry(r, h, 28, 6);
    const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const vx = p.getX(k);
      const vy = p.getY(k);
      const vz = p.getZ(k);
      const t = (vy + h / 2) / h;                    // 0 = すそ、1 = 頂上
      const bump = 1 + 0.18 * Math.sin(vx * 0.09 + vz * 0.05) * Math.cos(vz * 0.07);
      const flare = 1 + 0.35 * (1 - t) ** 2;
      p.setXYZ(k, vx * bump * flare, (vy + h / 2) * (0.75 + 0.25 * Math.sqrt(t)) - h / 2, vz * bump * flare);
    }
    g.computeVertexNormals();
    const island = new THREE.Mesh(g, islandMat);
    island.position.set(x, SEA_LEVEL + h / 2 - 3, z);
    island.scale.z = 0.7;
    group.add(island);
  }
  const lighthouse = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.6 });
  const redMat = new THREE.MeshStandardMaterial({ color: 0xc83a32, roughness: 0.6 });
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2.4, 16, 12), white);
  tower.position.y = 8;
  lighthouse.add(tower);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 2.1, 2.2, 12), redMat);
  band.position.y = 9;
  lighthouse.add(band);
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xfff4c0, emissive: 0xffe08a, emissiveIntensity: 0.4 });
  const lamp = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 2, 12), lampMat);
  lamp.position.y = 17;
  lighthouse.add(lamp);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(1.8, 2, 12), redMat);
  cap.position.y = 19;
  lighthouse.add(cap);
  const rockBase = new THREE.Mesh(new THREE.DodecahedronGeometry(9, 0), new THREE.MeshStandardMaterial({ color: 0x6e6a62, roughness: 1, flatShading: true }));
  rockBase.scale.y = 0.5;
  lighthouse.add(rockBase);
  lighthouse.position.set(150, SEA_LEVEL + 1, -230);
  group.add(lighthouse);
  const boats = [];
  const sailMat = new THREE.MeshStandardMaterial({ color: 0xfafafa, roughness: 0.7, side: THREE.DoubleSide });
  const hullMat = new THREE.MeshStandardMaterial({ color: 0x2c3e66, roughness: 0.6 });
  for (const [x, z, s] of [[-120, -300, 1], [60, -420, 1.3]]) {
    const boat = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.8, 5), hullMat);
    hull.position.y = 0.3;
    boat.add(hull);
    const sail = new THREE.Mesh(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.8, -1.8), new THREE.Vector3(0, 7, 0.2), new THREE.Vector3(0, 0.8, 1.8)]), sailMat);
    sail.geometry.computeVertexNormals();
    boat.add(sail);
    boat.scale.setScalar(s * 1.6);
    boat.position.set(x, SEA_LEVEL, z);
    boat.rotation.y = 0.9;
    group.add(boat);
    boats.push({ boat, x, z, phase: Math.random() * 6 });
  }

  let time = 0;
  return {
    group,
    sea,
    lighthouseLamp: lampMat,
    update(dt) {
      time += dt;
      // 波を流す
      normalMap.offset.set(time * 0.012, time * 0.007);
      for (const b of boats) {
        b.boat.position.x = b.x + Math.sin(time * 0.02 + b.phase) * 40;
        b.boat.rotation.z = Math.sin(time * 0.8 + b.phase) * 0.05;
      }
    },
    /** 夜は灯台が光る */
    setNight(on) { lampMat.emissiveIntensity = on ? 2.5 : 0.4; },
  };
}
