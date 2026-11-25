import * as THREE from 'three';
import { ROOM, ANNEX } from './room.js';

/**
 * 家の外装：外壁の板張り・基礎・窓まわりの枠と水切り・外灯・雨どい。
 *
 * 壁（room.js・billiards.js）は内と外が同じしっくいで、外から見ると白い箱だった。壁の外の面に、厚さ 2cm の
 * 板張りを貼る。窓と出入り口は、壁と同じ位置に穴をあける。本の部屋の東の壁は、ビリヤードの部屋に隠れない所
 * （南北の端）だけに貼る（ビリヤードの部屋の中から見えないように）。
 *
 * 面は、外向きの向き n（水平）と、面の中心のワールド位置で決める。穴の位置もワールドで書き、面に沿った位置へ
 * 直してから穴をあける（壁ごとの回転の向きを間違えないように）。
 */

const T = 0.02;          // 板張りの厚さ
const BASE = 0.3;        // 基礎の高さ（地面から）
const W = ROOM.wall;

/** 外壁の面の一覧。cx・cz は壁の外の面の中心（ワールド）、n は外向き、width は面の幅、holes は穴（at はワールドの中心） */
function faces() {
  const acx = (ANNEX.minX + ANNEX.maxX) / 2;
  const acz = (ANNEX.minZ + ANNEX.maxZ) / 2;
  const aW = ANNEX.wall;
  const annexX0 = ROOM.maxX + W;                 // 別棟の北と南の板張りは、本の部屋の東の外面から始める
  const annexX1 = ANNEX.maxX + aW + T;
  const northZ = ANNEX.minZ - aW;
  const southZ = ANNEX.maxZ + aW;
  return [
    // 本の部屋
    { name: 'front', cx: 0, cz: ROOM.minZ - W, n: [0, -1], width: ROOM.width + 2 * W + 2 * T, height: ROOM.height,
      holes: [{ at: [0, ROOM.minZ - W], w: 3.2, sill: 0, head: 2.32 }] },
    { name: 'back', cx: 0, cz: ROOM.maxZ + W, n: [0, 1], width: ROOM.width + 2 * W + 2 * T, height: ROOM.height,
      holes: [{ at: [1.05, ROOM.maxZ + W], w: 0.92, sill: 0, head: 2.04 }] },
    { name: 'west', cx: ROOM.minX - W, cz: 0, n: [-1, 0], width: ROOM.depth + 2 * W, height: ROOM.height,
      holes: [{ at: [ROOM.minX - W, -0.7], w: 1.8, sill: 0.42, head: 2.32 }] },
    // 本の部屋の東の壁：別棟に隠れない南北の端だけ
    { name: 'eastN', cx: ROOM.maxX + W, cz: (ROOM.minZ - W + northZ) / 2, n: [1, 0], width: northZ - (ROOM.minZ - W), height: ROOM.height, holes: [] },
    { name: 'eastS', cx: ROOM.maxX + W, cz: (southZ + ROOM.maxZ + W) / 2, n: [1, 0], width: ROOM.maxZ + W - southZ, height: ROOM.height, holes: [] },
    // 別棟（ビリヤードの部屋）
    { name: 'annexN', cx: (annexX0 + annexX1) / 2, cz: northZ, n: [0, -1], width: annexX1 - annexX0, height: ANNEX.height,
      holes: [{ at: [acx + 0.4, northZ], w: 1.8, sill: 0.9, head: 2.15 }] },
    { name: 'annexS', cx: (annexX0 + annexX1) / 2, cz: southZ, n: [0, 1], width: annexX1 - annexX0, height: ANNEX.height, holes: [] },
    { name: 'annexE', cx: ANNEX.maxX + aW, cz: acz, n: [1, 0], width: ANNEX.maxZ - ANNEX.minZ + 2 * aW + 2 * T, height: ANNEX.height,
      holes: [{ at: [ANNEX.maxX + aW, acz], w: 1.6, sill: 0.9, head: 2.15 }] },
  ];
}

/** 横張りの板（羽目板）の模様。1 枚 0.15m、板の下のふちに影の溝。木目は細い横縞。画像は横 1.2m・縦 0.6m（4 枚）ぶん */
function sidingTextures() {
  const Wpx = 512;
  const Hpx = 256;
  const color = document.createElement('canvas');
  color.width = Wpx;
  color.height = Hpx;
  const bump = document.createElement('canvas');
  bump.width = Wpx;
  bump.height = Hpx;
  const c = color.getContext('2d');
  const b = bump.getContext('2d');
  let seed = 7;
  const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const board = Hpx / 4;
  for (let i = 0; i < 4; i++) {
    const y0 = i * board;
    // 板ごとに少しだけ明るさを変える
    const k = 0.94 + rand() * 0.1;
    c.fillStyle = `rgb(${Math.round(255 * k)},${Math.round(255 * k)},${Math.round(255 * k)})`;
    c.fillRect(0, y0, Wpx, board);
    // 木目：細い横縞（ゆらぐ）
    for (let g = 0; g < 26; g++) {
      const y = y0 + 3 + rand() * (board - 8);
      c.strokeStyle = `rgba(90,70,50,${0.05 + rand() * 0.08})`;
      c.lineWidth = 0.6 + rand() * 1.2;
      c.beginPath();
      c.moveTo(0, y);
      for (let x = 0; x <= Wpx; x += 32) c.lineTo(x, y + Math.sin(x * 0.02 + g) * 1.2);
      c.stroke();
    }
    // 板の継ぎ目（縦）を、板ごとにずらして 1 本
    const jx = Math.floor(rand() * Wpx);
    c.fillStyle = 'rgba(60,45,35,0.35)';
    c.fillRect(jx, y0, 2, board);
    // 重なり：板の上は前の板の下に入るので、上が少し暗く（影）、下のふちは明るく
    const grad = c.createLinearGradient(0, y0, 0, y0 + board);
    grad.addColorStop(0, 'rgba(0,0,0,0.28)');
    grad.addColorStop(0.18, 'rgba(0,0,0,0.0)');
    grad.addColorStop(0.92, 'rgba(255,255,255,0.0)');
    grad.addColorStop(1, 'rgba(255,255,255,0.12)');
    c.fillStyle = grad;
    c.fillRect(0, y0, Wpx, board);
    // 凹凸：板は下へ向かって手前へ出る（羽目板の段）。上のふちが溝
    const bg = b.createLinearGradient(0, y0, 0, y0 + board);
    bg.addColorStop(0, '#000');
    bg.addColorStop(0.06, '#555');
    bg.addColorStop(1, '#fff');
    b.fillStyle = bg;
    b.fillRect(0, y0, Wpx, board);
  }
  const make = (canvas, srgb) => {
    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.repeat.set(1 / 1.2, 1 / 0.6);
    t.anisotropy = 8;
    return t;
  };
  return { map: make(color, true), bump: make(bump, false) };
}

/** 外形が rect で、holes の穴をあけた厚さ depth の板（ローカル XY：x は面の中心が 0、y は地面から） */
function panel(width, y0, y1, holes, depth) {
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, y0);
  shape.lineTo(width / 2, y0);
  shape.lineTo(width / 2, y1);
  shape.lineTo(-width / 2, y1);
  shape.closePath();
  for (const h of holes) {
    const p = new THREE.Path();
    const s = Math.max(h.sill, y0);
    p.moveTo(h.x - h.w / 2, s);
    p.lineTo(h.x + h.w / 2, s);
    p.lineTo(h.x + h.w / 2, h.head);
    p.lineTo(h.x - h.w / 2, h.head);
    p.closePath();
    shape.holes.push(p);
  }
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 1 });
  g.computeVertexNormals();
  return g;
}

/**
 * @param {THREE.Object3D} parent 外装を入れる所（本の部屋のグループ。屋外用の環境マップを焼くとき、家といっしょに隠れる）
 */
export function createHouseExterior(parent) {
  const group = new THREE.Group();
  group.name = 'houseExterior';
  parent.add(group);

  const tex = sidingTextures();
  // 板張りは、明るい杉の色。窓の枠と鼻隠しは白、基礎はコンクリート
  const siding = new THREE.MeshStandardMaterial({ color: 0xc8a982, map: tex.map, bumpMap: tex.bump, bumpScale: 1.2, roughness: 0.78 });
  const trim = new THREE.MeshStandardMaterial({ color: 0xf1eee7, roughness: 0.5 });
  const concrete = new THREE.MeshStandardMaterial({ color: 0x9d9a94, roughness: 0.92 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x4a4b4e, roughness: 0.45, metalness: 0.6 });
  const lampGlass = new THREE.MeshStandardMaterial({ color: 0xfff2d6, emissive: 0xffd9a0, emissiveIntensity: 0.15, roughness: 0.3 });

  const up = new THREE.Vector3(0, 1, 0);
  const tmp = new THREE.Vector3();
  /** 面の向き：ローカル +X が面に沿う向き、ローカル -Z が外向き（押し出しは壁の側へ） */
  const frameOf = (f) => {
    const n = new THREE.Vector3(f.n[0], 0, f.n[1]);
    const u = new THREE.Vector3().crossVectors(n, up);
    const m = new THREE.Matrix4().makeBasis(u, up, n.clone().negate());
    return { n, u, m };
  };
  const localX = (f, u, at) => tmp.set(at[0] - f.cx, 0, at[1] - f.cz).dot(u);

  const add = (geometry, material, f, out, { shadow = false } = {}) => {
    const { n, m } = frameOf(f);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.quaternion.setFromRotationMatrix(m);
    mesh.position.set(f.cx + n.x * out, 0, f.cz + n.z * out);
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  /** 面の上に、面に沿った位置 x・高さ y・外へ out の所に箱を置く */
  const box = (f, x, y, out, sx, sy, sz, material) => {
    const { n, u, m } = frameOf(f);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), material);
    mesh.quaternion.setFromRotationMatrix(m);
    mesh.position.set(f.cx + u.x * x + n.x * out, y, f.cz + u.z * x + n.z * out);
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };

  const lamps = [];
  // 光だまりの絵：中心があたたかい色で、まわりへ消える円（加算で重ねる。暗いほどよく見える）
  const glowMaterial = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    r.addColorStop(0, 'rgba(255,200,130,1)');
    r.addColorStop(0.35, 'rgba(255,180,110,0.45)');
    r.addColorStop(1, 'rgba(255,170,100,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  })();
  for (const f of faces()) {
    const { u } = frameOf(f);
    const holes = f.holes.map((h) => ({ x: localX(f, u, h.at), w: h.w, sill: h.sill, head: h.head }));
    // 板張り（基礎の上から軒まで）
    add(panel(f.width, BASE, f.height, holes, T), siding, f, T);
    // 基礎：地面に少し埋め、板張りより 1cm 引っ込める。床までの出入り口の前は切る
    const doorways = holes.filter((h) => h.sill < 0.05).map((h) => ({ ...h, sill: -1, head: BASE + 0.01 }));
    add(panel(f.width, -0.05, BASE, doorways, T * 0.5), concrete, f, T * 0.5);
    // 板張りのいちばん下の水切り（細い金物）
    box(f, 0, BASE + 0.008, T + 0.006, f.width, 0.016, 0.014, metal);
    // 窓と出入り口の枠（外へ 2.5cm 出る）。窓には水切り（窓台）
    for (const h of holes) {
      const C = 0.07;
      const out = T + 0.0125;
      const doorway = h.sill < 0.05;
      // 出入り口の枠は床まで下ろす（基礎の高さで止めると、足もとに黒いすき間が見える）
      const sill = doorway ? 0 : Math.max(h.sill, BASE);
      const hh = h.head - sill;
      box(f, h.x, h.head + C / 2, out, h.w + 2 * C, C, 0.025, trim);
      box(f, h.x - h.w / 2 - C / 2, sill + hh / 2, out, C, hh, 0.025, trim);
      box(f, h.x + h.w / 2 + C / 2, sill + hh / 2, out, C, hh, 0.025, trim);
      if (h.sill > 0.05) box(f, h.x, h.sill - 0.02, T + 0.03, h.w + 2 * C + 0.06, 0.04, 0.06, trim);
    }
    // 出入り口の前の踏み段（正面の掃き出し窓は、外にテラスがあるので要らない）
    for (const h of holes.filter((q) => q.sill < 0.05 && f.name !== 'front')) {
      box(f, h.x, 0.06, T + 0.3, h.w + 0.5, 0.12, 0.6, concrete);
    }
    // 外灯：出入り口の横（取っ手と反対の側）に 1 つ
    for (const h of holes.filter((q) => q.sill < 0.05)) {
      const x = h.x + h.w / 2 + 0.38;
      const y = Math.min(h.head + 0.02, 2.05) - 0.18;
      box(f, x, y + 0.02, T + 0.04, 0.08, 0.2, 0.04, metal);           // 壁の台
      box(f, x, y + 0.1, T + 0.1, 0.15, 0.025, 0.14, metal);           // 笠（上だけ。ガラスが外から見えるように）
      const glass = box(f, x, y, T + 0.1, 0.11, 0.15, 0.1, lampGlass);
      box(f, x, y - 0.085, T + 0.1, 0.12, 0.02, 0.11, metal);          // 底
      lamps.push(glass);
      // 光だまり：本物の光源は重いので、壁（灯りの下）と足もと（出入り口の前）に、あたたかい色の円をうすく重ねる
      const { n, u, m } = frameOf(f);
      const wallGlow = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.8), glowMaterial);
      wallGlow.quaternion.setFromRotationMatrix(m);
      wallGlow.rotateY(Math.PI);
      wallGlow.position.set(f.cx + u.x * x + n.x * (T + 0.004), y - 0.45, f.cz + u.z * x + n.z * (T + 0.004));
      wallGlow.renderOrder = 3;
      group.add(wallGlow);
      const floorGlow = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.8), glowMaterial);
      floorGlow.rotation.x = -Math.PI / 2;
      floorGlow.rotation.z = Math.atan2(n.x, n.z);
      const cx = h.x + (x - h.x) * 0.4;
      floorGlow.position.set(f.cx + u.x * cx + n.x * 0.75, 0.13, f.cz + u.z * cx + n.z * 0.75);
      floorGlow.renderOrder = 3;
      group.add(floorGlow);
    }
  }

  // 雨どい：本の部屋の屋根の前と後ろの軒に、横の樋。西の前と東の後ろの角に、縦の樋
  {
    const EAVE = 0.55;
    const roofW = ROOM.width + W * 2 + EAVE * 2;
    const roofD = ROOM.depth + W * 2 + EAVE * 2;
    const y = ROOM.height - 0.03;
    const gutterGeo = new THREE.CylinderGeometry(0.05, 0.05, roofW, 12, 1, true, 0, Math.PI);
    for (const sz of [-1, 1]) {
      const g = new THREE.Mesh(gutterGeo, metal);
      g.rotation.z = Math.PI / 2;
      g.rotation.x = sz < 0 ? Math.PI : 0;
      g.position.set(0, y, sz * (roofD / 2 + 0.05));
      g.receiveShadow = true;
      group.add(g);
    }
    const pipe = (x, z, toZ) => {
      // 縦の樋：地面から軒下まで。上で軒先の横の樋へ曲がる
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, y - 0.15, 10), metal);
      p.position.set(x, (y - 0.15) / 2, z);
      p.castShadow = true;
      group.add(p);
      const elbow = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, Math.abs(toZ - z), 10), metal);
      elbow.rotation.x = Math.PI / 2;
      elbow.position.set(x, y - 0.1, (z + toZ) / 2);
      group.add(elbow);
      // 足もとの受け（排水の小さな枡）
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.16), concrete);
      foot.position.set(x, 0.02, z);
      group.add(foot);
      // 壁に留める金具
      for (const yy of [0.8, 1.8]) {
        const clip = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.08), metal);
        clip.position.set(x, yy, z - Math.sign(z) * 0.04);
        group.add(clip);
      }
    };
    pipe(ROOM.minX - W + 0.18, ROOM.minZ - W - T - 0.05, -(roofD / 2 + 0.05));
    pipe(ROOM.minX - W + 0.18, ROOM.maxZ + W + T + 0.05, roofD / 2 + 0.05);
  }

  return {
    group,
    /** 夜は外灯をともす（0..1） */
    setNight(level) {
      for (const m of new Set(lamps.map((l) => l.material))) m.emissiveIntensity = 0.1 + level * 6;
      glowMaterial.opacity = level * 0.55;
      glowMaterial.visible = level > 0.01;
    },
  };
}
