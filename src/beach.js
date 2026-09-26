import * as THREE from 'three';
import { BEACH, SEA_LEVEL, hillHeight } from './hill.js';

/**
 * 北の崖の下の砂浜。丘の上の柵のところ（厩の東）から崖に沿って木の階段が下りていて、上と下の看板で
 * 行き来する（E / トリガー / クリック。暗くしてから移る。30m の崖を歩いて下りると、VR では酔うため）。
 *
 * 砂浜には、パラソルとレジャーシート、クーラーボックス、バケツ、小さな砂の城。波打ちぎわには
 * 寄せては返す泡（7 秒ごと）と波の音。
 *
 * 遊べるもの：
 * - ビーチボール（軽くてふわっと飛ぶ。重力 4m/s²）。VR は手ではたく、PC は近くで F かクリックで
 *   見ている方（女の子が前にいれば女の子）へ打ち上げる。女の子が打ち返す（beachgame.js）
 * - 貝がら（10 個）。VR はトリガーで拾う（向けて押す）、PC はクリックか近くで F。拾うとバケツに入る。
 *   ぜんぶ拾うと、しばらくしてまた打ち上げられる
 *
 * 座標は丘の地形（hill.js の hillHeight / BEACH）の上。
 */
export const STAIRS = { x: -19, topZ: -40.8, bottomZ: -77.2 };
/** 砂浜の歩ける範囲（world.js）。沖は水深 0.6m くらいまで入れる */
export const BEACH_AREA = { minX: -40, maxX: 30, minZ: -95, maxZ: -76.6 };
/** 丘の上の、階段の上の看板の前の歩ける所 */
export const STAIRS_TOP_AREA = { minX: -21.5, maxX: -16.5, minZ: -40.1, maxZ: -33.0 };
const BALL_R = 0.26;
const G = 4.0;
const WAVE_PERIOD = 7;
const PARASOL = { x: 6, z: -80.8 };
/**
 * ビーチバレーのコート（階段の下のすぐ東）。ネットは南北に張り、西（階段の側）がプレイヤー、東が女の子。
 * 子ども向けに小さめ（片側 6.5m × 8m）で、ネットも低め（1.8m）
 */
export const COURT = { netX: -11, minX: -17.5, maxX: -4.5, minZ: -86.3, maxZ: -78.3, net: 1.8 };

export function inBeach(x, z) {
  return x > BEACH_AREA.minX - 2 && x < BEACH_AREA.maxX + 2 && z > BEACH_AREA.minZ - 2 && z < BEACH_AREA.maxZ + 1.5;
}
export const beachGround = (x, z) => hillHeight(x, z);
/** 波打ちぎわ（泡の先）の z。寄せると浜の奥（+z）へ上がってくる */
export function swashZ(t) {
  const k = 0.5 + 0.5 * Math.sin((t / WAVE_PERIOD) * Math.PI * 2);
  return BEACH.shoreZ + 0.6 + k * k * 2.4;
}

function signTexture(lines, bg = '#2f6f8f') {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = bg;
  x.fillRect(0, 0, 256, 128);
  x.strokeStyle = '#f4efe2';
  x.lineWidth = 6;
  x.strokeRect(6, 6, 244, 116);
  x.fillStyle = '#fff';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.font = 'bold 40px sans-serif';
  x.fillText(lines[0], 128, lines[1] ? 48 : 64);
  if (lines[1]) { x.font = '22px sans-serif'; x.fillText(lines[1], 128, 94); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function beachBallTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const x = c.getContext('2d');
  const colors = ['#e8403a', '#ffffff', '#2f7fe0', '#ffd23a', '#ffffff', '#3ab86a'];
  for (let i = 0; i < 6; i++) { x.fillStyle = colors[i]; x.fillRect((i * 256) / 6, 0, 256 / 6 + 1, 128); }
  x.fillStyle = '#ffffff';
  x.fillRect(0, 0, 256, 10);
  x.fillRect(0, 118, 256, 10);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createBeach() {
  const group = new THREE.Group();
  group.name = 'beach';
  const shade = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };
  const wood = new THREE.MeshStandardMaterial({ color: 0x9a7650, roughness: 0.85 });
  const darkWood = new THREE.MeshStandardMaterial({ color: 0x6d5236, roughness: 0.9 });
  const interactables = [];

  // --- 崖の階段 ------------------------------------------------------------------
  {
    const steps = [];
    for (let z = STAIRS.topZ - 0.3; z > STAIRS.bottomZ; z -= 0.55) {
      const y = Math.max(hillHeight(STAIRS.x - 0.7, z), hillHeight(STAIRS.x + 0.7, z), hillHeight(STAIRS.x, z)) + 0.12;
      steps.push([z, y]);
    }
    const stepMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1.5, 0.12, 0.6), wood, steps.length);
    const postMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.08, 1.0, 0.08), darkWood, Math.ceil(steps.length / 5) * 2 + 2);
    const m4 = new THREE.Matrix4();
    steps.forEach(([z, y], i) => { m4.makeTranslation(STAIRS.x, y, z); stepMesh.setMatrixAt(i, m4); });
    let posts = 0;
    const railPts = { l: [], r: [] };
    for (let i = 0; i < steps.length; i += 5) {
      const [z, y] = steps[i];
      for (const side of [-1, 1]) {
        m4.makeTranslation(STAIRS.x + side * 0.72, y + 0.5, z);
        postMesh.setMatrixAt(posts++, m4);
        railPts[side < 0 ? 'l' : 'r'].push(new THREE.Vector3(STAIRS.x + side * 0.72, y + 0.95, z));
      }
    }
    postMesh.count = posts;
    stepMesh.castShadow = true;
    stepMesh.receiveShadow = true;
    postMesh.castShadow = true;
    group.add(stepMesh, postMesh);
    for (const pts of Object.values(railPts)) {
      const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), pts.length * 4, 0.03, 6), darkWood);
      tube.castShadow = true;
      group.add(tube);
    }
    // 上の門（柵の切れ目の代わり）
    for (const side of [-1, 1]) {
      const p = shade(new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.2, 0.14), darkWood));
      p.position.set(STAIRS.x + side * 0.85, 1.1, STAIRS.topZ + 0.5);
      group.add(p);
    }
    const lintel = shade(new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.16, 0.18), darkWood));
    lintel.position.set(STAIRS.x, 2.2, STAIRS.topZ + 0.5);
    group.add(lintel);
  }

  // --- 看板（上：海辺へ / 下：丘の上へ） ----------------------------------------------
  function sign(lines, x, y, z, yaw, onSelect, bg) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.y = yaw;
    const post = shade(new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.4, 0.08), darkWood));
    post.position.y = 0.7;
    g.add(post);
    const board = shade(new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.46, 0.04), wood));
    board.position.y = 1.35;
    g.add(board);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.84, 0.42), new THREE.MeshStandardMaterial({ map: signTexture(lines, bg), roughness: 0.7 }));
    face.position.set(0, 1.35, 0.022);
    g.add(face);
    const hit = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.8, 0.6), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.y = 1.0;
    hit.userData.interactive = true;
    hit.userData.onSelect = onSelect;
    g.add(hit);
    interactables.push(hit);
    group.add(g);
    return g;
  }
  let onTravel = null;
  const topSign = sign(['海辺へ', '崖の階段で砂浜へ'], STAIRS.x + 1.3, 0, STAIRS.topZ + 1.2, 0, () => onTravel?.('beach'));
  const bottomY = hillHeight(STAIRS.x + 1.6, STAIRS.bottomZ - 1.2);
  const bottomSign = sign(['丘の上へ', '家と公園に戻る'], STAIRS.x + 1.6, bottomY, STAIRS.bottomZ - 1.2, Math.PI, () => onTravel?.('hill'), '#6f7a3a');
  void topSign;
  void bottomSign;

  // --- パラソル・シート・クーラー・バケツ・砂の城 -------------------------------------
  const gy = (x, z) => hillHeight(x, z);
  {
    const px = PARASOL.x;
    const pz = PARASOL.z;
    const pole = shade(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.4, 8), new THREE.MeshStandardMaterial({ color: 0xf4f4f4, roughness: 0.4 })));
    pole.position.set(px, gy(px, pz) + 1.1, pz);
    pole.rotation.z = 0.12;
    group.add(pole);
    const canopyGeo = new THREE.ConeGeometry(1.5, 0.45, 12, 1, true);
    const cols = [];
    const col = new THREE.Color();
    const pos = canopyGeo.attributes.position;
    for (let k = 0; k < pos.count; k++) {
      const a = Math.atan2(pos.getZ(k), pos.getX(k));
      const seg = Math.floor(((a + Math.PI) / (Math.PI * 2)) * 12 + 0.001) % 2;
      col.set(seg ? 0xffffff : 0xe8403a);
      cols.push(col.r, col.g, col.b);
    }
    canopyGeo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    const canopy = shade(new THREE.Mesh(canopyGeo.toNonIndexed(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide, flatShading: true })));
    canopy.position.set(px + 0.14, gy(px, pz) + 2.35, pz);
    canopy.rotation.z = 0.12;
    group.add(canopy);
    // レジャーシート（青と白の格子）
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const x = c.getContext('2d');
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { x.fillStyle = (i + j) % 2 ? '#ffffff' : '#3a8ad8'; x.fillRect(i * 16, j * 16, 16, 16); }
    const mt = new THREE.CanvasTexture(c);
    mt.colorSpace = THREE.SRGBColorSpace;
    mt.magFilter = THREE.NearestFilter;
    const mat = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.4), new THREE.MeshStandardMaterial({ map: mt, roughness: 0.95 }));
    mat.rotation.x = -Math.PI / 2;
    mat.position.set(px + 0.3, gy(px, pz + 0.3) + 0.015, pz + 0.3);
    mat.receiveShadow = true;
    group.add(mat);
    const cooler = shade(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.36, 0.34), new THREE.MeshStandardMaterial({ color: 0x2f7fe0, roughness: 0.5 })));
    cooler.position.set(px + 1.6, gy(px + 1.6, pz + 0.6) + 0.18, pz + 0.6);
    group.add(cooler);
    const lid = shade(new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.06, 0.36), new THREE.MeshStandardMaterial({ color: 0xf4f4f4, roughness: 0.5 })));
    lid.position.copy(cooler.position).setY(cooler.position.y + 0.2);
    group.add(lid);
    // 砂の城
    const sandMat = new THREE.MeshStandardMaterial({ color: 0xd9c38e, roughness: 1 });
    const cx = 11.5;
    const cz = -84.0;
    const base = gy(cx, cz);
    const tower = (dx, dz, r, h) => {
      const m = shade(new THREE.Mesh(new THREE.CylinderGeometry(r * 0.85, r, h, 10), sandMat));
      m.position.set(cx + dx, base + h / 2 - 0.02, cz + dz);
      group.add(m);
      const top = shade(new THREE.Mesh(new THREE.ConeGeometry(r * 0.9, h * 0.5, 10), sandMat));
      top.position.set(cx + dx, base + h + h * 0.25 - 0.02, cz + dz);
      group.add(top);
    };
    const keep = shade(new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.3, 0.6), sandMat));
    keep.position.set(cx, base + 0.13, cz);
    group.add(keep);
    tower(0, 0, 0.16, 0.5);
    for (const [dx, dz] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) tower(dx, dz, 0.1, 0.34);
  }

  // --- ビーチバレーのコート（ロープの線・ネット・点数板） -----------------------------
  const scoreCanvas = document.createElement('canvas');
  scoreCanvas.width = 256;
  scoreCanvas.height = 128;
  const scoreTex = new THREE.CanvasTexture(scoreCanvas);
  scoreTex.colorSpace = THREE.SRGBColorSpace;
  {
    const rope = new THREE.MeshStandardMaterial({ color: 0x2f6fd0, roughness: 0.7 });
    const lines = [
      [COURT.minX, COURT.minZ, COURT.maxX, COURT.minZ], [COURT.minX, COURT.maxZ, COURT.maxX, COURT.maxZ],
      [COURT.minX, COURT.minZ, COURT.minX, COURT.maxZ], [COURT.maxX, COURT.minZ, COURT.maxX, COURT.maxZ],
    ];
    for (const [x0, z0, x1, z1] of lines) {
      const n = Math.max(2, Math.round(Math.hypot(x1 - x0, z1 - z0) / 0.5));
      for (let i = 0; i < n; i++) {
        const a = i / n;
        const b = (i + 1) / n;
        const xa = x0 + (x1 - x0) * a; const za = z0 + (z1 - z0) * a;
        const xb = x0 + (x1 - x0) * b; const zb = z0 + (z1 - z0) * b;
        const len = Math.hypot(xb - xa, zb - za);
        const m = new THREE.Mesh(new THREE.BoxGeometry(len + 0.02, 0.025, 0.05), rope);
        m.position.set((xa + xb) / 2, (gy(xa, za) + gy(xb, zb)) / 2 + 0.012, (za + zb) / 2);
        m.rotation.y = -Math.atan2(zb - za, xb - xa);
        m.receiveShadow = true;
        group.add(m);
      }
    }
    // ネット：2 本の柱と、網（格子の透けるテクスチャ）と、上の白い帯
    const netZ0 = COURT.minZ - 0.5;
    const netZ1 = COURT.maxZ + 0.5;
    const base = gy(COURT.netX, (netZ0 + netZ1) / 2);
    for (const z of [netZ0, netZ1]) {
      const post = shade(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, COURT.net + 0.1, 10), new THREE.MeshStandardMaterial({ color: 0xe8e8e8, metalness: 0.5, roughness: 0.4 })));
      post.position.set(COURT.netX, gy(COURT.netX, z) + (COURT.net + 0.1) / 2, z);
      group.add(post);
    }
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const x = c.getContext('2d');
    x.strokeStyle = 'rgba(20,20,24,0.9)';
    x.lineWidth = 6;
    for (let i = 0; i <= 64; i += 16) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 64); x.stroke(); x.beginPath(); x.moveTo(0, i); x.lineTo(64, i); x.stroke(); }
    const netTex = new THREE.CanvasTexture(c);
    netTex.wrapS = netTex.wrapT = THREE.RepeatWrapping;
    // ミップマップを使うと、遠くで網目がつぶれて半透明の灰色の板に見えた
    netTex.generateMipmaps = false;
    netTex.minFilter = THREE.LinearFilter;
    const netH = 0.8;
    netTex.repeat.set((netZ1 - netZ0) / 0.15, netH / 0.15);
    const net = new THREE.Mesh(new THREE.PlaneGeometry(netZ1 - netZ0, netH), new THREE.MeshStandardMaterial({ map: netTex, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9 }));
    net.rotation.y = Math.PI / 2;
    net.position.set(COURT.netX, base + COURT.net - netH / 2, (netZ0 + netZ1) / 2);
    net.castShadow = true;
    group.add(net);
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.06, netZ1 - netZ0), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }));
    band.position.set(COURT.netX, base + COURT.net - 0.03, (netZ0 + netZ1) / 2);
    group.add(band);
    // 点数板（ネットの南の柱の横。両方の陣地から読めるように、東西の両面）
    for (const side of [-1, 1]) {
      const board = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.45), new THREE.MeshBasicMaterial({ map: scoreTex, toneMapped: false }));
      board.position.set(COURT.netX + side * 0.03, gy(COURT.netX, COURT.maxZ + 1.2) + 1.5, COURT.maxZ + 1.2);
      board.rotation.y = side < 0 ? -Math.PI / 2 : Math.PI / 2;
      group.add(board);
    }
    const stand = shade(new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.3, 0.06), darkWood));
    stand.position.set(COURT.netX, gy(COURT.netX, COURT.maxZ + 1.2) + 0.65, COURT.maxZ + 1.2);
    group.add(stand);
  }
  const score = { player: 0, girl: 0 };
  function drawScore(note = '') {
    const x = scoreCanvas.getContext('2d');
    x.fillStyle = '#1d2a3a';
    x.fillRect(0, 0, 256, 128);
    x.fillStyle = '#fff';
    x.textAlign = 'center';
    x.font = '18px sans-serif';
    x.fillText('あなた', 64, 28);
    x.fillText('女の子', 192, 28);
    x.font = 'bold 56px sans-serif';
    x.fillStyle = '#7fc8ff';
    x.fillText(String(score.player), 64, 86);
    x.fillStyle = '#ff9ac8';
    x.fillText(String(score.girl), 192, 86);
    x.fillStyle = '#fff';
    x.fillText('-', 128, 84);
    x.font = '16px sans-serif';
    x.fillText(note || `${WIN} 点先取`, 128, 116);
    scoreTex.needsUpdate = true;
  }
  const WIN = 7;
  drawScore();
  let onPoint = null;
  /** 落ちた所で点を決める：相手のコートの中に入れたら、打った人の点。外・自分の側・ネットにかかったら相手の点 */
  function judge(x, z, by) {
    const inCourt = x > COURT.minX && x < COURT.maxX && z > COURT.minZ && z < COURT.maxZ;
    const girlSide = x > COURT.netX;
    let winner;
    if (by === 'player') winner = inCourt && girlSide ? 'player' : 'girl';
    else if (by === 'girl') winner = inCourt && !girlSide ? 'girl' : 'player';
    else return;
    score[winner] += 1;
    let note = '';
    let game = null;
    if (score[winner] >= WIN) { game = winner; note = winner === 'player' ? 'あなたの勝ち！' : '女の子の勝ち！'; }
    drawScore(note);
    onPoint?.(winner, { ...score }, game, inCourt);
    if (game) { score.player = 0; score.girl = 0; setTimeout(() => drawScore(), 4000); }
  }

  // --- バケツ（拾った貝がらが入る） ---------------------------------------------------
  const pail = new THREE.Group();
  {
    const px = PARASOL.x - 1.3;
    const pz = PARASOL.z + 0.9;
    pail.position.set(px, gy(px, pz), pz);
    const body = shade(new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.12, 0.24, 14, 1, true), new THREE.MeshStandardMaterial({ color: 0xffc830, roughness: 0.5, side: THREE.DoubleSide })));
    body.position.y = 0.12;
    pail.add(body);
    const bottom = new THREE.Mesh(new THREE.CircleGeometry(0.12, 14), new THREE.MeshStandardMaterial({ color: 0xe0a820 }));
    bottom.rotation.x = -Math.PI / 2;
    bottom.position.y = 0.005;
    pail.add(bottom);
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.008, 6, 20, Math.PI), new THREE.MeshStandardMaterial({ color: 0x777777 }));
    handle.position.y = 0.24;
    pail.add(handle);
  }
  group.add(pail);

  // --- 貝がら ----------------------------------------------------------------------
  const shellMats = [0xf6e3d0, 0xf2c6c0, 0xfff4e6, 0xe8d0f0].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.55 }));
  function shellGeometry(kind) {
    if (kind === 0) {
      // ほたて貝の形（扇）
      const g = new THREE.CylinderGeometry(0.06, 0.012, 0.012, 12, 1, false, -1.1, 2.2);
      g.rotateZ(Math.PI / 2);
      g.rotateY(Math.PI / 2);
      return g;
    }
    // 巻き貝（円すい）
    const g = new THREE.ConeGeometry(0.025, 0.08, 8);
    g.rotateZ(Math.PI / 2 - 0.2);
    return g;
  }
  const shells = [];
  let seed = 11;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  function placeShell(sh) {
    for (let n = 0; n < 40; n++) {
      const x = BEACH_AREA.minX + 4 + rand() * (BEACH_AREA.maxX - BEACH_AREA.minX - 8);
      const z = -87.2 + rand() * 7.5;
      if (Math.hypot(x - PARASOL.x, z - PARASOL.z) < 2.5 || Math.abs(x - STAIRS.x) < 2.5 || (x > COURT.minX - 1 && x < COURT.maxX + 1)) continue;
      sh.mesh.position.set(x, gy(x, z) + 0.012, z);
      sh.mesh.rotation.y = rand() * Math.PI * 2;
      break;
    }
    sh.mesh.visible = true;
    sh.taken = false;
  }
  for (let i = 0; i < 10; i++) {
    const mesh = shade(new THREE.Mesh(shellGeometry(i % 2), shellMats[i % shellMats.length]));
    mesh.scale.setScalar(1.6);
    const hit = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
    mesh.add(hit);
    const sh = { mesh, hit, taken: false };
    hit.userData.interactive = true;
    hit.userData.onSelect = () => take(sh);
    interactables.push(hit);
    group.add(mesh);
    shells.push(sh);
    placeShell(sh);
  }
  // バケツの中に並べる貝がら（拾った数だけ見せる）
  const inPail = shells.map((sh, i) => {
    const m = new THREE.Mesh(sh.mesh.geometry, sh.mesh.material);
    const a = i * 2.4;
    m.position.set(Math.cos(a) * 0.06, 0.03 + (i % 3) * 0.02, Math.sin(a) * 0.06);
    m.rotation.y = a;
    m.visible = false;
    pail.add(m);
    return m;
  });
  let collected = 0;
  let respawnIn = 0;
  let onShell = null;
  function take(sh) {
    if (sh.taken) return false;
    sh.taken = true;
    sh.mesh.visible = false;
    inPail[collected % inPail.length].visible = true;
    collected += 1;
    chime(900 + collected * 60);
    onShell?.(collected, collected === shells.length);
    if (shells.every((s) => s.taken)) respawnIn = 25;
    return true;
  }

  // --- ビーチボール -------------------------------------------------------------------
  const ball = shade(new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 24, 16), new THREE.MeshStandardMaterial({ map: beachBallTexture(), roughness: 0.35 })));
  ball.userData.velocity = new THREE.Vector3();
  ball.userData.spin = new THREE.Vector3();
  const ballHit = new THREE.Mesh(new THREE.SphereGeometry(BALL_R * 1.8, 10, 8), new THREE.MeshBasicMaterial({ visible: false }));
  ballHit.userData.interactive = true;
  ball.add(ballHit);
  interactables.push(ballHit);
  group.add(ball);
  const BALL_HOME = new THREE.Vector3(COURT.netX - 3.5, 0, (COURT.minZ + COURT.maxZ) / 2);
  function resetBall() {
    ball.position.set(BALL_HOME.x, gy(BALL_HOME.x, BALL_HOME.z) + BALL_R, BALL_HOME.z);
    ball.userData.velocity.set(0, 0, 0);
  }
  resetBall();
  let lastTouch = 'none';        // 最後にさわったのは 'player' / 'girl'
  let touchCooldown = 0;
  let onBallEvent = null;         // (kind: 'hit' | 'land' | 'water', by) => void
  let airborne = false;
  let served = false;           // 打ってから、まだ落ちていない（落ちたら点を決める）

  /** 飛ばす：to へ、T 秒で着く放物線（空気の抵抗は小さいので無視） */
  function launchTo(to, T, by) {
    const v = ball.userData.velocity;
    v.set((to.x - ball.position.x) / T, 0, (to.z - ball.position.z) / T);
    v.y = (to.y - ball.position.y + 0.5 * G * T * T) / T;
    lastTouch = by;
    airborne = true;
    served = true;
    touchCooldown = 0.25;
    pon();
    onBallEvent?.('hit', by);
  }
  /** 自分のコートで止まったボールを、プレイヤーの前へ軽く上げる（サーブを打ちやすいように）。点にはしない */
  function tossUp(at) {
    ball.position.copy(at);
    ball.userData.velocity.set(0, 2.6, 0);
    lastTouch = 'toss';
    airborne = true;
    served = false;
  }
  /** 手ではたいた（VR）。手の速さに合わせ、少し上へ */
  function slap(handVelocity, by = 'player') {
    if (touchCooldown > 0) return false;
    const v = ball.userData.velocity;
    v.copy(handVelocity).multiplyScalar(1.1);
    v.y = Math.max(v.y, 0) + 2.8;
    const sp = v.length();
    if (sp > 9) v.multiplyScalar(9 / sp);
    lastTouch = by;
    airborne = true;
    served = true;
    touchCooldown = 0.3;
    pon();
    onBallEvent?.('hit', by);
    return true;
  }
  /** ボールが高さ h まで下りてくる点（放物線、t 秒後）。上がりきって下りてくるときだけ */
  function predictAt(h, out = new THREE.Vector3()) {
    const v = ball.userData.velocity;
    const dy = ball.position.y - h;
    const disc = v.y * v.y + 2 * G * dy;
    if (disc < 0) return null;
    const t = (v.y + Math.sqrt(disc)) / G;
    out.set(ball.position.x + v.x * t, h, ball.position.z + v.z * t);
    out.userData = t;
    return { point: out, t };
  }

  function updateBall(dt) {
    touchCooldown = Math.max(0, touchCooldown - dt);
    const v = ball.userData.velocity;
    const p = ball.position;
    const ground = gy(p.x, p.z);
    const water = ground < SEA_LEVEL + 0.02;
    const floor = water ? SEA_LEVEL + BALL_R * 0.55 : ground + BALL_R;
    if (p.y > floor + 0.005 || v.y > 0.01) {
      // 空中
      v.y -= G * dt;
      v.multiplyScalar(1 - 0.12 * dt);
      const prevX = p.x - v.x * dt;
      p.addScaledVector(v, dt);
      // ネット：柱のあいだで、網の高さより下を横切ったら跳ね返って落ちる
      if ((prevX - COURT.netX) * (p.x - COURT.netX) < 0 && p.z > COURT.minZ - 0.5 && p.z < COURT.maxZ + 0.5
        && p.y - BALL_R < gy(COURT.netX, p.z) + COURT.net) {
        p.x = COURT.netX + Math.sign(prevX - COURT.netX) * (BALL_R + 0.02);
        v.x = -v.x * 0.25;
        v.z *= 0.5;
        v.y = Math.min(v.y, 0);
      }
      if (p.y <= floor) {
        p.y = floor;
        if (airborne) {
          airborne = false;
          if (served) judge(p.x, p.z, lastTouch);
          served = false;
          onBallEvent?.(water ? 'water' : 'land', lastTouch);
        }
        if (water) { v.y = 0; v.multiplyScalar(0.4); splash(); } else { v.y = Math.abs(v.y) > 1.2 ? -v.y * 0.35 : 0; v.x *= 0.6; v.z *= 0.6; thud(); }
      }
    } else {
      p.y = floor;
      v.y = 0;
      if (water) {
        // 浮いて、波で浜のほうへ寄ってくる
        v.x *= 1 - 1.5 * dt;
        v.z += (0.35 + 0.25 * Math.sin((clock / WAVE_PERIOD) * Math.PI * 2)) * dt;
        v.z *= 1 - 0.8 * dt;
      } else {
        // 砂の上：転がって止まる（坂で少し海へ）
        v.z -= 0.25 * dt;
        v.multiplyScalar(1 - 3.0 * dt);
        if (v.lengthSq() < 0.0004) v.set(0, 0, 0);
      }
      p.x += v.x * dt;
      p.z += v.z * dt;
    }
    // 砂浜の外へは出さない（崖・沖）
    if (p.x < BEACH_AREA.minX) { p.x = BEACH_AREA.minX; v.x = Math.abs(v.x) * 0.3; }
    if (p.x > BEACH_AREA.maxX) { p.x = BEACH_AREA.maxX; v.x = -Math.abs(v.x) * 0.3; }
    if (p.z > BEACH_AREA.maxZ - 0.3) { p.z = BEACH_AREA.maxZ - 0.3; v.z = -Math.abs(v.z) * 0.3; }
    if (p.z < BEACH_AREA.minZ - 3) { p.z = BEACH_AREA.minZ - 3; v.z = Math.abs(v.z); }
    // 転がる向きに回す
    const sp = Math.hypot(v.x, v.z);
    if (sp > 0.01) {
      const axis = tmpA.set(v.z, 0, -v.x).normalize();
      ball.rotateOnWorldAxis(axis, (sp * dt) / BALL_R);
    }
  }
  const tmpA = new THREE.Vector3();

  // --- 波打ちぎわの泡（寄せては返す） ---------------------------------------------------
  const foamUniforms = { uEdge: { value: BEACH.shoreZ }, uTime: { value: 0 } };
  {
    const geo = new THREE.PlaneGeometry(BEACH.maxX - BEACH.minX + 60, 14, 90, 28);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const cx = (BEACH.minX + BEACH.maxX) / 2;
    const cz = BEACH.shoreZ + 1;
    for (let k = 0; k < pos.count; k++) {
      const x = pos.getX(k) + cx;
      const z = pos.getZ(k) + cz;
      pos.setXYZ(k, x, Math.max(hillHeight(x, z), SEA_LEVEL) + 0.02, z);
    }
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, transparent: true, depthWrite: false });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uEdge = foamUniforms.uEdge;
      shader.uniforms.uTime = foamUniforms.uTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWorldPos;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uEdge;\nuniform float uTime;\nvarying vec3 vWorldPos;')
        .replace('#include <color_fragment>', `#include <color_fragment>
          // 泡の先（edge）のぎざぎざ。先は白い泡、その後ろ（沖）は薄い泡、先より浜の側は濡れた砂の影
          float wob = sin(vWorldPos.x * 0.9 + uTime * 0.7) * 0.25 + sin(vWorldPos.x * 2.3 - uTime * 1.1) * 0.12;
          float d = vWorldPos.z - (uEdge + wob);
          float front = smoothstep(-0.9, -0.05, d) * (1.0 - smoothstep(-0.05, 0.12, d));
          float lace = (1.0 - smoothstep(-4.0, -0.6, d)) * smoothstep(-6.0, -3.5, d) * 0.35
            * (0.5 + 0.5 * sin(vWorldPos.x * 3.1 + vWorldPos.z * 2.7 + uTime));
          float wet = smoothstep(0.1, 0.3, d) * (1.0 - smoothstep(0.3, 2.2, d));
          diffuseColor.rgb = mix(vec3(0.42, 0.35, 0.22), vec3(1.0), step(d, 0.12));
          diffuseColor.a = max(max(front * 0.95, lace), wet * 0.28);`);
    };
    const foam = new THREE.Mesh(geo, mat);
    foam.renderOrder = 2;
    foam.receiveShadow = true;
    group.add(foam);
  }

  // --- 音（波・ボール・貝がら） ---------------------------------------------------------
  let ctx = null;
  let waveGain = null;
  let waveFilter = null;
  function ensureAudio() {
    if (ctx) return ctx;
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return null;
    const AC = window.AudioContext ?? window.webkitAudioContext;
    if (!AC) return null;
    try { ctx = new AC(); } catch { return null; }
    // 波：ずっと鳴っているノイズを、寄せるときに大きく・明るく
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { last = last * 0.97 + (Math.random() * 2 - 1) * 0.03; d[i] = last * 6 + (Math.random() * 2 - 1) * 0.15; }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    waveFilter = ctx.createBiquadFilter();
    waveFilter.type = 'lowpass';
    waveFilter.frequency.value = 600;
    waveGain = ctx.createGain();
    waveGain.gain.value = 0;
    src.connect(waveFilter).connect(waveGain).connect(ctx.destination);
    src.start();
    return ctx;
  }
  function blip(freq, dur, gain, type = 'sine', drop = 0.6) {
    const c = ensureAudio();
    if (!c || !hearing) return;
    const t = c.currentTime;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * drop, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(c.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
  const pon = () => blip(420, 0.16, 0.25, 'triangle', 0.7);
  const thud = () => blip(160, 0.12, 0.12, 'sine', 0.6);
  const splash = () => blip(900, 0.25, 0.05, 'sawtooth', 0.3);
  const chime = (f) => { blip(f, 0.25, 0.12, 'sine', 1.02); blip(f * 1.5, 0.3, 0.06, 'sine', 1.0); };
  let hearing = false;

  // --- 毎フレーム ------------------------------------------------------------------
  let clock = 0;
  const handPrev = new Map();
  const handPos = new THREE.Vector3();
  const handVel = new THREE.Vector3();
  let hands = null;
  function update(dt, { listener = null, playerHere = false } = {}) {
    clock += dt;
    foamUniforms.uEdge.value = swashZ(clock);
    foamUniforms.uTime.value = clock;
    updateBall(dt);
    // VR の手ではたく
    for (const c of (hands?.() ?? [])) {
      if (!c?.visible) { handPrev.delete(c); continue; }
      c.getWorldPosition(handPos);
      const prev = handPrev.get(c);
      if (prev) {
        handVel.subVectors(handPos, prev).divideScalar(Math.max(dt, 1e-3));
        if (handPos.distanceTo(ball.position) < BALL_R + 0.12 && handVel.length() > 0.8) {
          if (slap(handVel)) c.userData?.gamepad?.hapticActuators?.[0]?.pulse?.(0.5, 60);
        }
        prev.copy(handPos);
      } else handPrev.set(c, handPos.clone());
    }
    if (respawnIn > 0) {
      respawnIn -= dt;
      if (respawnIn <= 0) { for (const sh of shells) placeShell(sh); for (const m of inPail) m.visible = false; collected = 0; }
    }
    // 波の音：聞いている人が砂浜にいるときだけ。寄せる音（泡が上がってくるとき）を大きく
    hearing = playerHere;
    if (listener && ensureAudio() && waveGain) {
      const k = 0.5 + 0.5 * Math.sin((clock / WAVE_PERIOD) * Math.PI * 2 + 0.6);
      const dz = Math.max(0, listener.z - BEACH.shoreZ);
      const near = playerHere ? THREE.MathUtils.clamp(8 / (dz + 4), 0.25, 1) : 0;
      waveGain.gain.setTargetAtTime(near * (0.08 + 0.22 * k), ctx.currentTime, 0.3);
      waveFilter.frequency.setTargetAtTime(400 + 900 * k, ctx.currentTime, 0.3);
    }
  }

  /** PC：F かクリックで、近く（2.6m）のボールか貝がらを。使ったら true */
  function use(eye, forward, girlPos) {
    const d = Math.hypot(ball.position.x - eye.x, ball.position.z - eye.z);
    if (d < 2.6 && ball.position.y < eye.y + 1.2) {
      hitFrom(eye, forward, girlPos);
      return true;
    }
    let best = null;
    let bestD = 2.2;
    for (const sh of shells) {
      if (sh.taken) continue;
      const e = Math.hypot(sh.mesh.position.x - eye.x, sh.mesh.position.z - eye.z);
      if (e < bestD) { bestD = e; best = sh; }
    }
    if (best) return take(best);
    return false;
  }
  /** PC：見ている方（女の子が前 40° 以内にいれば女の子）へ、ふわっと打ち上げる */
  function hitFrom(eye, forward, girlPos) {
    const to = new THREE.Vector3();
    const fx = forward.x;
    const fz = forward.z;
    const fl = Math.hypot(fx, fz) || 1;
    if (girlPos) {
      const gx = girlPos.x - ball.position.x;
      const gz = girlPos.z - ball.position.z;
      const gl = Math.hypot(gx, gz) || 1;
      if ((gx * fx + gz * fz) / (gl * fl) > Math.cos(0.7) && gl < 14) {
        to.set(girlPos.x, girlPos.y + 1.3, girlPos.z);
        launchTo(to, 1.7, 'player');
        return;
      }
    }
    to.set(ball.position.x + (fx / fl) * 6, ball.position.y + 0.8, ball.position.z + (fz / fl) * 6);
    launchTo(to, 1.6, 'player');
  }
  // VR のトリガー（向けて押す）/ PC のクリックで打つ。打つ人の目と向きは world.js が渡す
  let selectBall = null;
  ballHit.userData.onSelect = () => selectBall?.();

  return {
    group,
    interactables,
    update,
    use,
    hitFrom,
    ball,
    launchTo,
    tossUp,
    predictAt,
    resetBall,
    get airborne() { return airborne; },
    get lastTouch() { return lastTouch; },
    get ballResting() { return !airborne && ball.userData.velocity.lengthSq() < 0.01; },
    get inWater() { return gy(ball.position.x, ball.position.z) < SEA_LEVEL; },
    get collected() { return collected; },
    get clock() { return clock; },
    set onTravel(fn) { onTravel = fn; },
    set onShell(fn) { onShell = fn; },
    set onBall(fn) { onBallEvent = fn; },
    set onBallSelect(fn) { selectBall = fn; },
    set onPoint(fn) { onPoint = fn; },
    get score() { return { ...score }; },
    court: COURT,
    setHands(fn) { hands = fn; },
    /** 丘の上の、階段の上の看板の前（戻ってきたときに立つ所）と、砂浜の階段の下 */
    topPoint(out = new THREE.Vector3()) { return out.set(STAIRS.x + 0.2, 0, STAIRS.topZ + 3.0); },
    bottomPoint(out = new THREE.Vector3()) { const z = STAIRS.bottomZ - 2.6; return out.set(STAIRS.x + 0.4, gy(STAIRS.x + 0.4, z), z); },
    parasol: PARASOL,
  };
}
