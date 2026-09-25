import * as THREE from 'three';

/**
 * 庭の左の池と釣り。
 *
 * 池は楕円（10m × 7.2m）。まわりに石、水面に睡蓮の葉。手前（家の側）から桟橋が水の上へ
 * 出ていて、先にベンチがある。プレイヤーはベンチの右に座って釣る（乗り物の窓口。
 * kartdrive.js の乗り降り・VR の目線合わせ・視点をそのまま使う）。女の子は左に座って、
 * 自分の竿で釣る（fishinggame.js が座らせ、ここの updateGirl が竿と浮きを動かす）。
 *
 * 釣り方（アクセル＝W / ↑、RT、VR の右トリガー）
 *   1. アクセルで投げる（浮きが前へ 3〜5m 飛ぶ）
 *   2. 待つ（3〜8 秒）。浮きがしずんだら（1.2 秒のあいだに）アクセルで合わせる
 *   3. アクセルを押したまま巻く（1.6 秒。離しすぎると逃げられる）
 *   4. 釣れた魚を竿の先に 3 秒見せて、池へ返す。数と、いちばん大きい魚を看板に出す
 * VR では竿を右手のコントローラーに持つ（竿先はコントローラーの前へ伸びる）。PC では
 * 座った目の前の右に構える。
 */
export const POND = { cx: -24.5, cz: -12.2, rx: 5.0, rz: 3.6 };
/** 桟橋（歩ける）。池の手前の縁から水の上へ。上面は 6cm と低くして、歩く高さは地面のまま（段差を足元の計算に入れずに済む） */
export const DECK = { minX: -25.3, maxX: -23.7, minZ: -11.0, maxZ: -7.9 };
const BENCH = { x: -24.5, z: -10.55, top: 0.46 };
const WATER_Y = 0.03;

const FISH = [
  { name: 'コイ', color: 0xe08a2e, min: 28, max: 55 },
  { name: 'フナ', color: 0x9aa4a8, min: 12, max: 28 },
  { name: 'キンギョ', color: 0xff5a36, min: 6, max: 14 },
  { name: 'ニジマス', color: 0x8fb7a0, min: 20, max: 40 },
];

/** 楕円の池の中か（桟橋の上は除く）。margin だけ広く見る */
export function inPond(x, z, margin = 0) {
  const onDeck = x > DECK.minX && x < DECK.maxX && z > DECK.minZ && z < DECK.maxZ;
  if (onDeck) return false;
  const dx = (x - POND.cx) / (POND.rx + margin);
  const dz = (z - POND.cz) / (POND.rz + margin);
  return dx * dx + dz * dz < 1;
}
/** 池の外（縁の外側）へ出す */
export function outOfPond(x, z, margin = 0) {
  const dx = x - POND.cx;
  const dz = z - POND.cz;
  const k = Math.sqrt((dx / (POND.rx + margin)) ** 2 + (dz / (POND.rz + margin)) ** 2) || 1;
  return { x: POND.cx + dx / k * 1.001, z: POND.cz + dz / k * 1.001 };
}

/**
 * 釣れた魚。口に針が掛かって、頭を上・尾を下にぶら下がる形（原点が口）。
 * 胴は横から平たい紡錘形（旋盤の回転体を横に押しつぶす）、尾びれは二股の平たい板、
 * 背びれ・胸びれ・目・白い腹。以前は球と円すいで、吊るとイカのように見えた。
 */
function fishMesh(kind, lengthCm) {
  const g = new THREE.Group();
  const L = lengthCm / 100;
  const color = new THREE.Color(kind.color);
  const skin = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.3 });
  const belly = new THREE.MeshStandardMaterial({ color: color.clone().lerp(new THREE.Color(0xf4f1e8), 0.75), roughness: 0.4, metalness: 0.15 });
  const fin = new THREE.MeshStandardMaterial({ color: color.clone().multiplyScalar(0.8), roughness: 0.5, side: THREE.DoubleSide, transparent: true, opacity: 0.9 });
  // 胴：口（y = 0）から尾の付け根（y = -0.8L）まで。いちばん太いのは頭寄り
  const profile = [];
  const N = 14;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const r = 0.5 * Math.sin(Math.PI * Math.pow(t, 0.75)) * (1 - 0.35 * t) + (i === N ? 0.04 : 0);
    profile.push(new THREE.Vector2(Math.max(0.001, r * 0.28 * L), -t * 0.8 * L));
  }
  const bodyGeo = new THREE.LatheGeometry(profile, 18);
  const bodyMesh = new THREE.Mesh(bodyGeo, skin);
  bodyMesh.scale.set(0.55, 1, 1);          // 横（x）に押しつぶして平たく
  bodyMesh.castShadow = true;
  g.add(bodyMesh);
  // 腹（手前 -z の下側を白く）：少し小さい同じ形を前へずらして重ねる
  const bellyMesh = new THREE.Mesh(bodyGeo, belly);
  bellyMesh.scale.set(0.5, 0.92, 0.8);
  bellyMesh.position.set(0, -0.03 * L, -0.03 * L);
  g.add(bellyMesh);
  // 尾びれ（二股）：尾の付け根から下へ
  const tail = new THREE.Shape();
  const w = 0.2 * L;
  tail.moveTo(0, 0);
  tail.lineTo(-w, -0.22 * L);
  tail.quadraticCurveTo(0, -0.12 * L, w, -0.22 * L);
  tail.lineTo(0, 0);
  const tailMesh = new THREE.Mesh(new THREE.ShapeGeometry(tail), fin);
  tailMesh.rotation.y = Math.PI / 2;        // 板を体の縦の面（y-z）に
  tailMesh.position.y = -0.78 * L;
  g.add(tailMesh);
  // 背びれ（+z 側）・腹びれ（-z 側）
  const tri = (h, len) => { const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.lineTo(h, -len * 0.3); sh.lineTo(0, -len); sh.lineTo(0, 0); return new THREE.ShapeGeometry(sh); };
  const dorsal = new THREE.Mesh(tri(0.1 * L, 0.3 * L), fin);
  dorsal.rotation.y = -Math.PI / 2;
  dorsal.position.set(0, -0.25 * L, 0.11 * L);
  g.add(dorsal);
  const anal = new THREE.Mesh(tri(0.06 * L, 0.16 * L), fin);
  anal.rotation.y = Math.PI / 2;
  anal.position.set(0, -0.55 * L, -0.07 * L);
  g.add(anal);
  // 胸びれ（左右）と目
  for (const side of [-1, 1]) {
    const pec = new THREE.Mesh(tri(0.07 * L, 0.12 * L), fin);
    pec.rotation.set(0, side * 0.5, side * 0.3);
    pec.position.set(side * 0.06 * L, -0.2 * L, -0.02 * L);
    g.add(pec);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.022 * L + 0.003, 10, 8), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.15 }));
    eye.position.set(side * 0.072 * L, -0.07 * L, 0.02 * L);
    g.add(eye);
    const ring = new THREE.Mesh(new THREE.SphereGeometry(0.03 * L + 0.003, 10, 8), new THREE.MeshStandardMaterial({ color: 0xe8d9a0, roughness: 0.3 }));
    ring.scale.set(0.4, 1, 1);
    ring.position.set(side * 0.066 * L, -0.07 * L, 0.02 * L);
    g.add(ring);
  }
  g.userData.length = 0.8 * L + 0.2 * L;
  return g;
}

function makeRod(color = 0x2b3a55) {
  const rod = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.3 });
  // 竿はローカル -Z へ 1.7m 伸びる（持つ所が原点）
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.012, 1.7, 8), mat);
  stick.rotation.x = -Math.PI / 2;
  stick.position.z = -0.85;
  stick.castShadow = true;
  rod.add(stick);
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.24, 10), new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 0.8 }));
  grip.rotation.x = -Math.PI / 2;
  grip.position.z = 0.05;
  rod.add(grip);
  const reel = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.03, 12), new THREE.MeshStandardMaterial({ color: 0xc8ccd2, metalness: 0.8, roughness: 0.3 }));
  reel.rotation.z = Math.PI / 2;
  reel.position.set(0, -0.04, -0.05);
  rod.add(reel);
  rod.userData.tip = new THREE.Vector3(0, 0, -1.7);
  return rod;
}

function makeLine(color = 0xeeeeee) {
  const points = Array.from({ length: 12 }, () => new THREE.Vector3());
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.8 }));
  line.frustumCulled = false;
  return line;
}
function setLine(line, a, b, sag) {
  const pos = line.geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const t = i / (pos.count - 1);
    pos.setXYZ(i, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t - sag * 4 * t * (1 - t), a.z + (b.z - a.z) * t);
  }
  pos.needsUpdate = true;
}
function makeBobber() {
  const g = new THREE.Group();
  const top = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xff3a2a, roughness: 0.4 }));
  const bottom = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.4 }));
  g.add(top, bottom);
  return g;
}

/** 池・石・睡蓮・桟橋・ベンチ */
export function createPond() {
  const group = new THREE.Group();
  group.name = 'pond';
  // 水：縁のほうが浅く明るく見えるよう、少し小さい円を重ねる
  const water = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshStandardMaterial({ color: 0x2f6f8c, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.92 }));
  water.rotation.x = -Math.PI / 2;
  water.scale.set(POND.rx, POND.rz, 1);
  water.position.set(POND.cx, WATER_Y, POND.cz);
  water.receiveShadow = true;
  group.add(water);
  const deep = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshStandardMaterial({ color: 0x1d4a60, roughness: 0.1, transparent: true, opacity: 0.6, depthWrite: false }));
  deep.rotation.x = -Math.PI / 2;
  deep.scale.set(POND.rx * 0.7, POND.rz * 0.65, 1);
  deep.position.set(POND.cx, WATER_Y + 0.002, POND.cz);
  group.add(deep);
  // 縁の石
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x8a8780, roughness: 0.95 });
  const stoneGeo = new THREE.DodecahedronGeometry(0.28, 0);
  for (let i = 0; i < 46; i++) {
    const a = (i / 46) * Math.PI * 2;
    const x = POND.cx + Math.cos(a) * (POND.rx + 0.15);
    const z = POND.cz + Math.sin(a) * (POND.rz + 0.15);
    if (x > DECK.minX - 0.2 && x < DECK.maxX + 0.2 && z > DECK.minZ) continue;   // 桟橋の付け根は空ける
    const stone = new THREE.Mesh(stoneGeo, stoneMat);
    const k = 0.7 + ((i * 37) % 10) / 20;
    stone.scale.set(k, 0.45 * k, k * 0.9);
    stone.position.set(x, 0.08, z);
    stone.rotation.y = i * 1.7;
    stone.castShadow = true;
    stone.receiveShadow = true;
    group.add(stone);
  }
  // 睡蓮の葉
  const padMat = new THREE.MeshStandardMaterial({ color: 0x4f8f3a, roughness: 0.6, side: THREE.DoubleSide });
  for (const [x, z, r] of [[-27.4, -13.4, 0.35], [-27.9, -12.6, 0.28], [-21.6, -14.0, 0.32], [-22.3, -14.6, 0.24], [-26.2, -15.0, 0.3], [-21.0, -11.2, 0.26]]) {
    const pad = new THREE.Mesh(new THREE.CircleGeometry(r, 16, 0.3, Math.PI * 2 - 0.6), padMat);
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(x, WATER_Y + 0.006, z);
    group.add(pad);
  }
  // 桟橋とベンチ
  const wood = new THREE.MeshStandardMaterial({ color: 0x9a7248, roughness: 0.85 });
  const deck = new THREE.Mesh(new THREE.BoxGeometry(DECK.maxX - DECK.minX, 0.08, DECK.maxZ - DECK.minZ), wood);
  deck.position.set((DECK.minX + DECK.maxX) / 2, 0.02, (DECK.minZ + DECK.maxZ) / 2);
  deck.castShadow = true;
  deck.receiveShadow = true;
  group.add(deck);
  for (const x of [DECK.minX + 0.1, DECK.maxX - 0.1]) {
    for (const z of [DECK.minZ + 0.1, DECK.minZ + 1.5]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 8), wood);
      post.position.set(x, -0.1, z);
      group.add(post);
    }
  }
  // 桟橋の先の手すり（下は腰板）。向こう岸から、座った二人の膝の奥が見えないように。
  // 座った目（1.2m）からは、3m 先の水面までさえぎらない高さ（0.6m）にしてある
  const rail = new THREE.Mesh(new THREE.BoxGeometry(DECK.maxX - DECK.minX, 0.36, 0.04), wood);
  rail.position.set((DECK.minX + DECK.maxX) / 2, 0.06 + 0.2, DECK.minZ + 0.04);
  rail.castShadow = true;
  group.add(rail);
  const handrail = new THREE.Mesh(new THREE.BoxGeometry(DECK.maxX - DECK.minX + 0.08, 0.05, 0.09), wood);
  handrail.position.set((DECK.minX + DECK.maxX) / 2, 0.62, DECK.minZ + 0.04);
  group.add(handrail);
  for (const x of [DECK.minX + 0.04, (DECK.minX + DECK.maxX) / 2, DECK.maxX - 0.04]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.6, 0.06), wood);
    post.position.set(x, 0.33, DECK.minZ + 0.04);
    group.add(post);
  }
  const bench = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.06, 0.36), wood);
  bench.position.set(BENCH.x, BENCH.top - 0.03, BENCH.z);
  bench.castShadow = true;
  group.add(bench);
  for (const side of [-0.6, 0.6]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, BENCH.top - 0.06, 0.3), wood);
    leg.position.set(BENCH.x + side, 0.06 + (BENCH.top - 0.06) / 2, BENCH.z);
    group.add(leg);
  }
  return group;
}

/**
 * 釣り（プレイヤーの席と、女の子の竿）。乗り物の窓口。
 * @param {{ scene: THREE.Scene, onEvent?: (kind: string, info?: object) => void }} options
 *   onEvent：'bite'（プレイヤーの浮きがしずんだ）/ 'caught' / 'escaped' / 'girlCaught'
 */
export function createFishing({ scene, onEvent = null } = {}) {
  const group = new THREE.Group();   // プレイヤーの席（右）の目の高さの下
  group.name = 'fishingSeat';
  group.position.set(BENCH.x + 0.42, 0, BENCH.z);
  scene.add(group);
  // 乗るときにつかめる所：ベンチの右半分の見えない箱
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 0.5), new THREE.MeshBasicMaterial({ visible: false }));
  body.position.set(0, BENCH.top, 0);
  group.add(body);

  const rod = makeRod();
  const line = makeLine();
  const bobber = makeBobber();
  scene.add(rod, line, bobber);
  bobber.visible = false;
  line.visible = false;
  const girlRod = makeRod(0xd05a8a);
  const girlLine = makeLine();
  const girlBobber = makeBobber();
  scene.add(girlRod, girlLine, girlBobber);
  girlRod.visible = girlLine.visible = girlBobber.visible = false;

  // 竿を置いておく所（座っていないとき、ベンチに立てかける）
  function restRod(r, x) {
    r.position.set(x, 0.5, BENCH.z + 0.18);
    r.rotation.set(0.9, 0, 0);
  }
  restRod(rod, BENCH.x + 0.7);

  // 看板（釣れた数・いちばん大きい魚）
  const boardCanvas = document.createElement('canvas');
  boardCanvas.width = 256;
  boardCanvas.height = 128;
  const boardTex = new THREE.CanvasTexture(boardCanvas);
  boardTex.colorSpace = THREE.SRGBColorSpace;
  const board = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.45), new THREE.MeshBasicMaterial({ map: boardTex, toneMapped: false }));
  // 座った目の前の右 30° ほど、2.6m 先の水の中に立てる（PC の固定の視点でも見える）
  board.position.set(BENCH.x + 1.7, 0.95, BENCH.z - 2.25);
  board.rotation.y = -0.52;   // 表（+Z）をプレイヤーの席へ
  const boardBack = new THREE.Mesh(new THREE.PlaneGeometry(0.94, 0.49), new THREE.MeshStandardMaterial({ color: 0x5a4028, roughness: 0.8 }));
  boardBack.rotation.y = Math.PI;
  boardBack.position.z = -0.01;
  board.add(boardBack);
  const boardPost = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.8, 8), new THREE.MeshStandardMaterial({ color: 0x5a4028, roughness: 0.8 }));
  boardPost.position.set(BENCH.x + 1.7, 0.4, BENCH.z - 2.25);
  scene.add(board, boardPost);

  const state = {
    speed: 0, yaw: Math.PI, travelYaw: Math.PI, steer: 0, onGrass: false, lateral: 0, u: 0,
    phase: 'idle',     // idle / cast / wait / bite / hooked / caught
    timer: 0,
    catches: 0,
    best: null,        // { name, cm }
    last: null,
  };
  const target = new THREE.Vector3();
  const castFrom = new THREE.Vector3();
  const tip = new THREE.Vector3();
  let throttleHeld = false;
  let reel = 0;          // 巻いた時間
  let slack = 0;         // 巻かずにいた時間
  let biteIn = 5;
  let fish = null;       // 釣れた魚（表示中）
  let riding = false;

  function drawBoard() {
    const ctx = boardCanvas.getContext('2d');
    ctx.fillStyle = '#1b2a1f';
    ctx.fillRect(0, 0, 256, 128);
    ctx.fillStyle = '#bfe8a0';
    ctx.font = 'bold 22px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('つりの きろく', 128, 28);
    ctx.fillStyle = '#fff';
    ctx.fillText(`つれた数 ${state.catches}`, 128, 62);
    ctx.fillText(state.best ? `いちばん ${state.best.name} ${state.best.cm}cm` : 'いちばん --', 128, 94);
    boardTex.needsUpdate = true;
  }
  drawBoard();

  const eyeOffset = new THREE.Vector3(0, BENCH.top + 0.72, 0.05);
  function eye(out = new THREE.Vector3()) {
    group.updateMatrixWorld(true);
    return group.localToWorld(out.copy(eyeOffset));
  }

  /** 竿を持つ（VR は右手のコントローラー、PC は目の前の右） */
  const _q = new THREE.Quaternion();
  const _tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.5);
  function holdRod(ctx) {
    const hand = ctx?.xr ? ctx.controllers?.[1] : null;
    if (hand?.visible) {
      hand.getWorldPosition(rod.position);
      hand.getWorldQuaternion(_q);
      rod.quaternion.copy(_q).multiply(_tilt);
    } else {
      eye(rod.position);
      rod.position.x += 0.28;   // 右（向きが -Z なので、ワールドの +X が右。左には女の子）
      rod.position.y -= 0.42;
      rod.position.z -= 0.25;
      // 竿先は前（-Z）の少し上。合わせ・巻くときは起こす
      const lift = state.phase === 'hooked' ? 0.95 : state.phase === 'caught' ? 0.6 : state.phase === 'cast' ? 0.2 : 0.5;
      rod.rotation.set(lift, -0.08, 0);
    }
    rod.updateMatrixWorld(true);
    rod.localToWorld(tip.copy(rod.userData.tip));
  }

  function landAhead(out) {
    // 竿先の向きの 3〜5m 先。池の中に収める
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(rod.getWorldQuaternion(new THREE.Quaternion()));
    dir.y = 0;
    if (dir.lengthSq() < 1e-4) dir.set(0, 0, -1);
    dir.normalize();
    const d = 3 + Math.random() * 2;
    out.set(tip.x + dir.x * d, WATER_Y + 0.02, tip.z + dir.z * d);
    if (!inPond(out.x, out.z, -0.6)) {
      const p = outOfPond(out.x, out.z, -0.8);
      out.x = p.x;
      out.z = p.z;
    }
    return out;
  }

  function update(dt, { throttle = 0 } = {}, _clamp = null, ctx = null) {
    riding = true;
    holdRod(ctx);
    const press = throttle > 0.5 && !throttleHeld;
    throttleHeld = throttle > 0.5;
    state.timer += dt;
    switch (state.phase) {
      case 'idle':
        bobber.visible = false;
        line.visible = false;
        if (press) {
          state.phase = 'cast';
          state.timer = 0;
          castFrom.copy(tip);
          landAhead(target);
          bobber.visible = true;
          line.visible = true;
        }
        break;
      case 'cast': {
        const k = Math.min(1, state.timer / 0.6);
        bobber.position.lerpVectors(castFrom, target, k);
        bobber.position.y += Math.sin(k * Math.PI) * 1.2;
        if (k >= 1) { state.phase = 'wait'; state.timer = 0; biteIn = 3 + Math.random() * 5; }
        break;
      }
      case 'wait':
        bobber.position.copy(target);
        bobber.position.y = WATER_Y + 0.02 + Math.sin(state.timer * 3) * 0.006;
        if (press) { state.phase = 'idle'; break; }   // 早すぎた：巻き取ってやり直し
        if (state.timer > biteIn) { state.phase = 'bite'; state.timer = 0; onEvent?.('bite'); }
        break;
      case 'bite':
        // 浮きがしずむ（ぴくぴく → ずぼっ）
        bobber.position.copy(target);
        bobber.position.y = WATER_Y - 0.03 - Math.abs(Math.sin(state.timer * 18)) * 0.03;
        if (press) { state.phase = 'hooked'; state.timer = 0; reel = 0; slack = 0; }
        else if (state.timer > 1.2) { state.phase = 'wait'; state.timer = 0; biteIn = 2 + Math.random() * 4; onEvent?.('escaped'); }
        break;
      case 'hooked': {
        // 押したまま巻く。浮き（魚）が竿先へ近づく
        if (throttleHeld) { reel += dt; slack = 0; } else slack += dt;
        if (slack > 1.5) { state.phase = 'idle'; onEvent?.('escaped'); break; }
        const k = Math.min(1, reel / 1.6);
        bobber.position.lerpVectors(target, tip, k * 0.9);
        bobber.position.x += Math.sin(state.timer * 9) * 0.08 * (1 - k);
        bobber.position.y = WATER_Y + k * (tip.y - WATER_Y) * 0.6;
        if (k >= 1) {
          const kind = FISH[Math.floor(Math.random() * FISH.length)];
          const cm = Math.round(kind.min + Math.random() * (kind.max - kind.min));
          state.last = { name: kind.name, cm };
          state.catches += 1;
          if (!state.best || cm > state.best.cm) state.best = { name: kind.name, cm };
          drawBoard();
          fish = fishMesh(kind, cm);
          scene.add(fish);
          state.phase = 'caught';
          state.timer = 0;
          onEvent?.('caught', state.last);
        }
        break;
      }
      case 'caught':
        // 竿先から 40cm 下に魚をぶら下げて見せる
        bobber.position.set(tip.x, tip.y - 0.45, tip.z);
        if (fish) {
          fish.position.set(tip.x, tip.y - 0.52, tip.z);   // 口（原点）を浮きの少し下の針の所に
          fish.rotation.y = Math.sin(state.timer * 6) * 0.5;
        }
        if (state.timer > 3 || (press && state.timer > 0.6)) {
          if (fish) { scene.remove(fish); fish = null; }
          state.phase = 'idle';
        }
        break;
      default:
        break;
    }
    if (line.visible) setLine(line, tip, bobber.position, state.phase === 'wait' ? 0.25 : 0.05);
  }

  // --- 女の子の竿 ---------------------------------------------------------------
  const girl = { phase: 'off', timer: 0, next: 10, fish: null, bobberAt: new THREE.Vector3(BENCH.x - 1.4, WATER_Y + 0.02, BENCH.z - 3.4) };
  const girlTip = new THREE.Vector3();
  const girlHold = new THREE.Vector3(BENCH.x - 0.42, BENCH.top + 0.32, BENCH.z - 0.22);
  function updateGirl(dt, seated) {
    if (!seated) {
      if (girl.fish) { scene.remove(girl.fish); girl.fish = null; }
      girl.phase = 'off';
      girlRod.visible = girlLine.visible = girlBobber.visible = false;
      return;
    }
    if (girl.phase === 'off') { girl.phase = 'wait'; girl.timer = 0; girl.next = 12 + Math.random() * 12; }
    girl.timer += dt;
    girlRod.visible = girlLine.visible = true;
    const up = girl.phase === 'reel' || girl.phase === 'show' ? 1.0 : 0.45;
    girlRod.position.copy(girlHold);
    girlRod.rotation.set(up, 0.3, 0);   // 竿先は少し左（自分の浮きのほう。プレイヤーの竿と交差しないように）
    girlRod.updateMatrixWorld(true);
    girlRod.localToWorld(girlTip.copy(girlRod.userData.tip));
    girlBobber.visible = girl.phase !== 'show';
    if (girl.phase === 'wait') {
      girlBobber.position.copy(girl.bobberAt);
      girlBobber.position.y += Math.sin(girl.timer * 2.6) * 0.006;
      if (girl.timer > girl.next) { girl.phase = 'bite'; girl.timer = 0; }
    } else if (girl.phase === 'bite') {
      girlBobber.position.copy(girl.bobberAt);
      girlBobber.position.y = WATER_Y - 0.03 - Math.abs(Math.sin(girl.timer * 18)) * 0.03;
      if (girl.timer > 0.6) { girl.phase = 'reel'; girl.timer = 0; }
    } else if (girl.phase === 'reel') {
      const k = Math.min(1, girl.timer / 1.4);
      girlBobber.position.lerpVectors(girl.bobberAt, girlTip, k * 0.9);
      if (k >= 1) {
        const kind = FISH[Math.floor(Math.random() * FISH.length)];
        const cm = Math.round(kind.min + Math.random() * (kind.max - kind.min));
        girl.fish = fishMesh(kind, cm);
        scene.add(girl.fish);
        girl.phase = 'show';
        girl.timer = 0;
        onEvent?.('girlCaught', { name: kind.name, cm });
      }
    } else if (girl.phase === 'show') {
      if (girl.fish) {
        girl.fish.position.set(girlTip.x, girlTip.y - 0.52, girlTip.z);
        girl.fish.rotation.y = Math.sin(girl.timer * 6) * 0.5;
      }
      if (girl.timer > 2.8) {
        if (girl.fish) { scene.remove(girl.fish); girl.fish = null; }
        girl.phase = 'wait';
        girl.timer = 0;
        girl.next = 15 + Math.random() * 18;
      }
    }
    setLine(girlLine, girlTip, girl.phase === 'show' && girl.fish ? girl.fish.position : girlBobber.position, girl.phase === 'wait' ? 0.25 : 0.05);
  }

  return {
    group,
    body,
    state,
    steering: rod,
    kind: 'fishing',
    silent: true,
    place() {},
    update,
    eye,
    side(out = new THREE.Vector3()) { return out.set(BENCH.x + 0.4, 0, BENCH.z + 0.9); },
    /** プレイヤーが立ち上がった：竿をベンチへ戻し、浮きと魚を片づける */
    leave() {
      riding = false;
      state.phase = 'idle';
      bobber.visible = false;
      line.visible = false;
      if (fish) { scene.remove(fish); fish = null; }
      restRod(rod, BENCH.x + 0.7);
    },
    updateGirl,
    girlSeat(out = new THREE.Vector3()) { return out.set(BENCH.x - 0.42, BENCH.top, BENCH.z + 0.04); },
    girlYaw() { return Math.PI; },
    girlSide(out = new THREE.Vector3()) { return out.set(BENCH.x - 0.42, 0, BENCH.z + 0.9); },
    /** 女の子の手の置き所（竿の持つ所の左右） */
    girlHands(left, right) {
      girlRod.updateMatrixWorld(true);
      girlRod.localToWorld(left.set(0.02, 0, 0.12));
      girlRod.localToWorld(right.set(-0.02, 0, -0.06));
    },
    /** 女の子が見る所：プレイヤーの浮きがしずんだ・かかった・釣れたらそちら、ふだんは自分の浮き */
    gazeTarget(out = new THREE.Vector3()) {
      if (['bite', 'hooked', 'caught'].includes(state.phase)) return out.copy(state.phase === 'caught' && fish ? fish.position : bobber.position);
      if (girl.phase === 'show' && girl.fish) return out.copy(girl.fish.position);
      return out.copy(girlBobber.visible ? girlBobber.position : girl.bobberAt);
    },
    get riding() { return riding; },
    get speed() { return 0; },
  };
}
