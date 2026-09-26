import * as THREE from 'three';
import { createHorseModel, poseHorse } from './horse.js';

/**
 * 厩（うまごや）と馬場。公園の左奥（池の奥、ポケバイのコースの左）。
 *
 * 馬場は楕円（10m × 8.4m）の白い柵で囲み、手前の右に入口（幅 1.4m）がある。
 * 厩は馬場の奥に 3 つの馬房が並ぶ小屋（前が開いていて、屋根は後ろへ下がる片流れ）。
 * 左の馬房には白い馬がいて、戸の上から顔を出す（飾り）。真ん中は乗れる馬の部屋。
 * 横に干し草と水おけ。
 *
 * 歩ける範囲から、厩の建物と柵を外す（入口は通れる）。stableBlocks が判定する。
 */
export const PADDOCK = { cx: -25.0, cz: -24.0, rx: 5.0, rz: 4.2 };
/** 入口（柵の楕円の角度。手前の右） */
const GATE_THETA = Math.acos(2.5 / 5.0);
// 馬に乗ったまま出入りできるよう、幅はおよそ 2m（以前は 1.3m）
const GATE_HALF = 0.23;
export const GATE = {
  x: PADDOCK.cx + PADDOCK.rx * Math.cos(GATE_THETA),
  z: PADDOCK.cz + PADDOCK.rz * Math.sin(GATE_THETA),
};
export const STABLE = { minX: -30.2, maxX: -22.2, minZ: -33.1, maxZ: -29.5 };
/** 乗れる馬を置いておく所（馬場の手前、入口の左。右（+X）を向く） */
export const HORSE_PARK = { x: PADDOCK.cx, z: PADDOCK.cz + (PADDOCK.rz - 0.75), yaw: Math.PI / 2 };

const angleDelta = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

/** 歩けない所か（厩の建物・柵。margin は体の半径ぶん） */
export function stableBlocks(x, z, margin = 0) {
  if (x > STABLE.minX - 0.15 - margin && x < STABLE.maxX + 0.15 + margin && z > STABLE.minZ - 0.15 - margin && z < STABLE.maxZ + 0.15 + margin) return true;
  const nx = (x - PADDOCK.cx) / PADDOCK.rx;
  const nz = (z - PADDOCK.cz) / PADDOCK.rz;
  const r = Math.hypot(nx, nz);
  const band = (margin + 0.1) / 4.4;
  if (Math.abs(r - 1) > band) return false;
  const theta = Math.atan2(nz, nx);
  return Math.abs(angleDelta(theta, GATE_THETA)) > GATE_HALF - 0.02;
}

export function createStable() {
  const group = new THREE.Group();
  group.name = 'stable';
  const shade = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };

  // --- 馬場：土の地面と柵 -----------------------------------------------------
  const dirt = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshStandardMaterial({ color: 0xa88a62, roughness: 1 }));
  dirt.rotation.x = -Math.PI / 2;
  dirt.scale.set(PADDOCK.rx - 0.05, PADDOCK.rz - 0.05, 1);
  dirt.position.set(PADDOCK.cx, 0.004, PADDOCK.cz);
  dirt.receiveShadow = true;
  group.add(dirt);
  const white = new THREE.MeshStandardMaterial({ color: 0xf0ede4, roughness: 0.7 });
  const postGeo = new THREE.BoxGeometry(0.09, 1.2, 0.09);
  const at = (t) => new THREE.Vector3(PADDOCK.cx + PADDOCK.rx * Math.cos(t), 0, PADDOCK.cz + PADDOCK.rz * Math.sin(t));
  const N = 26;
  const start = GATE_THETA + GATE_HALF;
  const span = Math.PI * 2 - GATE_HALF * 2;
  let prev = null;
  for (let i = 0; i <= N; i++) {
    const t = start + (span * i) / N;
    const p = at(t);
    const post = shade(new THREE.Mesh(postGeo, white));
    post.position.set(p.x, 0.6, p.z);
    group.add(post);
    if (prev) {
      const d = p.distanceTo(prev);
      for (const y of [0.55, 1.05]) {
        const rail = shade(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.1, d), white));
        rail.position.set((p.x + prev.x) / 2, y, (p.z + prev.z) / 2);
        rail.lookAt(p.x, y, p.z);
        group.add(rail);
      }
    }
    prev = p;
  }
  // 入口の柱（少し高く、上に横木）
  const gateL = at(GATE_THETA - GATE_HALF);
  const gateR = at(GATE_THETA + GATE_HALF);
  const wood = new THREE.MeshStandardMaterial({ color: 0x8a6440, roughness: 0.85 });
  for (const g of [gateL, gateR]) {
    const post = shade(new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.1, 0.12), wood));
    post.position.set(g.x, 1.05, g.z);
    group.add(post);
  }
  const beam = shade(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, gateL.distanceTo(gateR) + 0.3), wood));
  beam.position.set((gateL.x + gateR.x) / 2, 2.05, (gateL.z + gateR.z) / 2);
  beam.lookAt(gateR.x, 2.05, gateR.z);
  group.add(beam);

  // --- 厩 ---------------------------------------------------------------------
  const S = STABLE;
  const w = S.maxX - S.minX;
  const d = S.maxZ - S.minZ;
  const plank = new THREE.MeshStandardMaterial({ color: 0x9a6a3e, roughness: 0.9 });
  const trim = new THREE.MeshStandardMaterial({ color: 0xf0ede4, roughness: 0.7 });
  const back = shade(new THREE.Mesh(new THREE.BoxGeometry(w, 2.4, 0.12), plank));
  back.position.set((S.minX + S.maxX) / 2, 1.2, S.minZ + 0.06);
  group.add(back);
  for (const x of [S.minX + 0.06, S.maxX - 0.06]) {
    const side = shade(new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.6, d), plank));
    side.position.set(x, 1.3, (S.minZ + S.maxZ) / 2);
    group.add(side);
  }
  const stallW = w / 3;
  for (let i = 1; i < 3; i++) {
    const wall = shade(new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.2, d - 0.1), plank));
    wall.position.set(S.minX + stallW * i, 1.1, (S.minZ + S.maxZ) / 2);
    group.add(wall);
  }
  // 床（わら）
  const straw = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.2, d - 0.1), new THREE.MeshStandardMaterial({ color: 0xd8c27a, roughness: 1 }));
  straw.rotation.x = -Math.PI / 2;
  straw.position.set((S.minX + S.maxX) / 2, 0.01, (S.minZ + S.maxZ) / 2);
  straw.receiveShadow = true;
  group.add(straw);
  // 前の柱と梁
  for (let i = 0; i <= 3; i++) {
    const post = shade(new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.8, 0.14), trim));
    post.position.set(S.minX + 0.07 + (w - 0.14) * (i / 3), 1.4, S.maxZ - 0.07);
    group.add(post);
  }
  const lintel = shade(new THREE.Mesh(new THREE.BoxGeometry(w, 0.22, 0.16), trim));
  lintel.position.set((S.minX + S.maxX) / 2, 2.7, S.maxZ - 0.07);
  group.add(lintel);
  // 片流れの屋根（前 3.0m → 後ろ 2.5m、前へ 0.6m 張り出す）
  const roofD = d + 0.9;
  const roof = shade(new THREE.Mesh(new THREE.BoxGeometry(w + 0.5, 0.1, Math.hypot(roofD, 0.5)), new THREE.MeshStandardMaterial({ color: 0x6e3b32, roughness: 0.8 })));
  roof.position.set((S.minX + S.maxX) / 2, 2.85, (S.minZ + S.maxZ) / 2 + 0.3);
  roof.rotation.x = -Math.atan2(0.5, roofD);
  group.add(roof);
  // 戸（左と右の馬房。真ん中は開いている）
  for (const i of [0, 2]) {
    const door = shade(new THREE.Mesh(new THREE.BoxGeometry(stallW - 0.3, 1.2, 0.06), plank));
    door.position.set(S.minX + stallW * (i + 0.5), 0.62, S.maxZ + 0.02);
    group.add(door);
    const cross = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.45, 0.02), trim);
    cross.position.set(S.minX + stallW * (i + 0.5), 0.62, S.maxZ + 0.06);
    cross.rotation.z = Math.atan2(1.2, stallW - 0.3);
    group.add(cross);
    const top = new THREE.Mesh(new THREE.BoxGeometry(stallW - 0.3, 0.08, 0.1), trim);
    top.position.set(S.minX + stallW * (i + 0.5), 1.24, S.maxZ + 0.02);
    group.add(top);
  }
  // 看板「うまごや」
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f7f1e2';
  ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = '#6e3b32';
  ctx.font = 'bold 40px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('うまごや', 128, 34);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.3), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }));
  sign.position.set((S.minX + S.maxX) / 2, 2.7, S.maxZ + 0.02);
  group.add(sign);

  // 干し草・水おけ
  const hay = new THREE.MeshStandardMaterial({ color: 0xd9bf6a, roughness: 1 });
  for (const [x, y, z, ry] of [[-21.3, 0.25, -30.2, 0.1], [-21.2, 0.25, -31.2, -0.05], [-21.25, 0.75, -30.7, 0.3]]) {
    const bale = shade(new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.55), hay));
    bale.position.set(x, y, z);
    bale.rotation.y = ry;
    group.add(bale);
  }
  const trough = shade(new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.45, 0.5), new THREE.MeshStandardMaterial({ color: 0x7c8388, metalness: 0.5, roughness: 0.4 })));
  trough.position.set(-28.6, 0.23, -20.9);
  trough.rotation.y = 0.5;
  group.add(trough);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.4), new THREE.MeshStandardMaterial({ color: 0x3f7fa0, roughness: 0.1 }));
  water.rotation.set(-Math.PI / 2, 0, 0.5);
  water.position.set(-28.6, 0.44, -20.9);
  group.add(water);

  // 左の馬房の白い馬（戸の上から顔を出す）
  const pony = createHorseModel({ coat: 0xdcd8d0, dark: 0x8d8780, blaze: false, saddle: false });
  pony.root.position.set(S.minX + stallW * 0.5, 0, S.maxZ - 1.8);
  group.add(pony.root);
  let time = 0;

  return {
    group,
    update(dt) {
      time += dt;
      poseHorse(pony, { phase: 0, gait: 1, amount: 0, time, headDown: 0 });
      // ときどき首を振る
      pony.neck.rotation.y = 0.25 * Math.sin(time * 0.4) * Math.max(0, Math.sin(time * 0.13));
      pony.neck.rotation.x = -0.05 + 0.06 * Math.sin(time * 0.9);
    },
  };
}
