import * as THREE from 'three';
import { SEA_LEVEL, hillHeight, AIRFIELD_ZONE, COASTER_ZONE, PLATEAU } from './hill.js';
import { FERRIS } from './ferriswheel.js';

/**
 * 飛行場とセスナ（高翼の 4 人乗りの軽飛行機ふう。実在の会社の塗装・登録記号は付けない）。
 *
 * 飛行場は丘の南西のふもと（hill.js の AIRFIELD_ZONE、高さ -20）。東西の滑走路（350m）の西の端に、東を向けて
 * セスナを止めてある。北の駐機場に格納庫と吹き流し。丘の上の家の南の芝生の看板「飛行場へ」と、駐機場の看板
 * 「丘の上へ」で行き来する（world.js の travel。暗くしてから移す）。
 *
 * 乗り物の窓口（kartdrive.js）。左のドアの横で E / 機体へトリガーで、左の操縦席に座る。女の子は右の席。
 * かんたんな操縦にしてある（ピッチの軸を持たない入力でも飛べるように）：
 * - 地上：W（右トリガー）で加速、S（左トリガー）でブレーキ、A / D（操縦かん・左スティック）で向きを変える。
 *   24m/s を超えて W を押していると浮き上がる
 * - 空：W で上昇（エンジン全開・機首上げ）、S で降下（エンジンをしぼって機首下げ）、何も押さなければ水平飛行。
 *   A / D で機体を傾けて旋回する。遅すぎる（21m/s より下）と機首が下がる
 * - 着陸：飛行場の平らな所へ、ゆるく降りてくる（降下 5m/s まで・傾き 17° まで）と接地する。S でブレーキ
 * - 地面・海・観覧車・ジェットコースター・家・島にぶつかると、暗くしてから駐機場へ戻す
 *
 * VR 酔いにくいように、ふだんはリグ（とカメラ）を機体の向きだけ回し、機内も水平のまま見せる
 * （機体の傾き・機首の上げ下げは、PC の後ろからの視点 C でだけ見える）。?flight=real にすると、
 * 目も機体ごと傾く（ジェットコースターと同じく seatQuaternion）。
 */
export const RUNWAY = { x0: -405, x1: -55, z: 215, width: 22, y: AIRFIELD_ZONE.y + 0.03 };
export const APRON = { minX: -415, maxX: -345, minZ: 226, maxZ: 250 };
/** 止めておく所（滑走路の西の端、東向き） */
const PARK = { x: -388, z: RUNWAY.z, yaw: Math.PI / 2 };
/** 看板で着く所（駐機場） */
export const HILL_RETURN = { x: -1.6, z: 5.6 };
export const AIRFIELD_ARRIVAL = { x: -372, z: 234 };
/** 丘の上の看板（家の南の芝生、コースターの駅の西） */
const HILL_SIGN = { x: -3.0, z: 7.0 };
const SEAT_TOP = 1.35;
const FLOOR = 0.92;
const ROTATE = 24;        // 浮き上がる速さ（m/s）
const STALL = 21;

/** 飛行場の平らな所（着陸できる所。まわりの坂は含めない） */
export function inAirfield(x, z, inset = 0) {
  const A = AIRFIELD_ZONE;
  return x > A.minX + inset && x < A.maxX - inset && z > A.minZ + inset && z < A.maxZ - inset;
}

function signTexture(lines, bg) {
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
  x.fillText(lines[0], 128, 48);
  x.font = '22px sans-serif';
  x.fillText(lines[1], 128, 94);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function textTexture(text, { w = 128, h = 128, font = 'bold 90px sans-serif', color = '#fff', bg = null } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const x = c.getContext('2d');
  if (bg) { x.fillStyle = bg; x.fillRect(0, 0, w, h); }
  x.fillStyle = color;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.font = font;
  x.fillText(text, w / 2, h / 2 + 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 飛行場（滑走路・駐機場・格納庫・吹き流し）と、行き来の看板 2 つ */
function makeField(interactables, onTravel) {
  const g = new THREE.Group();
  g.name = 'airfield';
  const Y = AIRFIELD_ZONE.y;
  const R = RUNWAY;
  const len = R.x1 - R.x0;
  const flat = (w, d, mat, x, y, z) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y, z);
    m.receiveShadow = true;
    g.add(m);
    return m;
  };
  const asphalt = new THREE.MeshStandardMaterial({ color: 0x3c3f45, roughness: 0.92 });
  const concrete = new THREE.MeshStandardMaterial({ color: 0x8a8c8f, roughness: 0.9 });
  const paint = new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.7 });
  flat(len, R.width, asphalt, (R.x0 + R.x1) / 2, Y + 0.03, R.z);
  flat(APRON.maxX - APRON.minX, APRON.maxZ - APRON.minZ, concrete, (APRON.minX + APRON.maxX) / 2, Y + 0.025, (APRON.minZ + APRON.maxZ) / 2);
  // 中心線（破線）・両わきの線・端のしま
  for (let x = R.x0 + 40; x < R.x1 - 40; x += 24) flat(12, 0.45, paint, x + 6, Y + 0.04, R.z);
  for (const sz of [-1, 1]) flat(len - 4, 0.3, paint, (R.x0 + R.x1) / 2, Y + 0.04, R.z + sz * (R.width / 2 - 0.8));
  for (const [x, dir] of [[R.x0 + 4, 1], [R.x1 - 4, -1]]) {
    for (let i = 0; i < 8; i++) {
      const z = R.z - R.width / 2 + 2.2 + i * ((R.width - 4.4) / 7);
      flat(16, 1.1, paint, x + dir * 8, Y + 0.04, z);
    }
  }
  // 数字（西の端は東向き 09、東の端は西向き 27。降りてくる向きから読める向き）
  for (const [text, x, yaw] of [['09', R.x0 + 26, -Math.PI / 2], ['27', R.x1 - 26, Math.PI / 2]]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), new THREE.MeshStandardMaterial({ map: textTexture(text), transparent: true, roughness: 0.7 }));
    m.rotation.set(-Math.PI / 2, 0, yaw);
    m.position.set(x, Y + 0.045, R.z);
    g.add(m);
  }
  // 格納庫（半円の屋根、南が開いている）
  const hangar = new THREE.Group();
  hangar.position.set(-395, Y, 244.5);
  const shell = new THREE.MeshStandardMaterial({ color: 0xb9c3cc, roughness: 0.6, metalness: 0.2, side: THREE.DoubleSide });
  const roof = new THREE.Mesh(new THREE.CylinderGeometry(8, 8, 12, 20, 1, true, -Math.PI / 2, Math.PI), shell);
  roof.rotation.z = Math.PI / 2;
  roof.rotation.y = Math.PI / 2;
  roof.castShadow = true;
  roof.receiveShadow = true;
  hangar.add(roof);
  const back = new THREE.Mesh(new THREE.CircleGeometry(8, 20, 0, Math.PI), shell);
  back.position.z = 6;
  hangar.add(back);
  const hangarName = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.2), new THREE.MeshBasicMaterial({ map: textTexture('おかの ひこうじょう', { w: 512, h: 96, font: 'bold 56px sans-serif', color: '#234', bg: '#e9eef2' }) }));
  hangarName.position.set(0, 6.6, -6.05);
  hangarName.rotation.y = Math.PI;
  hangar.add(hangarName);
  g.add(hangar);
  // 吹き流し
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 6, 8), new THREE.MeshStandardMaterial({ color: 0xdddddd }));
  pole.position.set(-350, Y + 3, 232);
  g.add(pole);
  const sock = new THREE.Group();
  sock.position.set(-350, Y + 5.8, 232);
  for (let i = 0; i < 4; i++) {
    const r0 = 0.38 - i * 0.07;
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(r0 - 0.07, r0, 0.6, 12, 1, true), new THREE.MeshStandardMaterial({ color: i % 2 ? 0xffffff : 0xff6a1a, side: THREE.DoubleSide }));
    cone.rotation.z = Math.PI / 2;
    cone.position.x = 0.3 + i * 0.6;
    sock.add(cone);
  }
  sock.rotation.y = 0.6;
  g.add(sock);
  // 看板
  const wood = new THREE.MeshStandardMaterial({ color: 0x9a7650, roughness: 0.85 });
  const darkWood = new THREE.MeshStandardMaterial({ color: 0x6d5236, roughness: 0.9 });
  const sign = (lines, x, y, z, yaw, dest, bg) => {
    const s = new THREE.Group();
    s.position.set(x, y, z);
    s.rotation.y = yaw;
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.4, 0.08), darkWood);
    post.position.y = 0.7;
    s.add(post);
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.46, 0.04), wood);
    board.position.y = 1.35;
    s.add(board);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.84, 0.42), new THREE.MeshStandardMaterial({ map: signTexture(lines, bg), roughness: 0.7 }));
    face.position.set(0, 1.35, 0.022);
    s.add(face);
    const hit = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.8, 0.6), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.y = 1.0;
    hit.userData.interactive = true;
    hit.userData.onSelect = () => onTravel(dest);
    s.add(hit);
    interactables.push(hit);
    g.add(s);
    return s;
  };
  sign(['飛行場へ', 'セスナで空を飛ぶ'], HILL_SIGN.x, 0, HILL_SIGN.z, Math.PI, 'airfield', '#2f5f8f');
  sign(['丘の上へ', '家と公園に戻る'], AIRFIELD_ARRIVAL.x + 2.2, Y, AIRFIELD_ARRIVAL.z + 1.6, Math.PI, 'hillFromAirfield', '#6f7a3a');
  return g;
}

/** 断面（z, 半幅, 下, 上）をつないだ胴体（とがった先へ細くなる筒）。sidesOnly は横の面だけ（胴体の線） */
function loft(sections, mat, sidesOnly = false) {
  const pos = [];
  const quad = (a, b, c, d) => pos.push(...a, ...b, ...c, ...a, ...c, ...d);
  for (let i = 0; i < sections.length - 1; i++) {
    const [z0, w0, b0, t0] = sections[i];
    const [z1, w1, b1, t1] = sections[i + 1];
    quad([w0, t0, z0], [w1, t1, z1], [w1, b1, z1], [w0, b0, z0]);        // +X の横
    quad([-w0, b0, z0], [-w1, b1, z1], [-w1, t1, z1], [-w0, t0, z0]);    // -X の横
    if (sidesOnly) continue;
    quad([-w0, t0, z0], [-w1, t1, z1], [w1, t1, z1], [w0, t0, z0]);      // 上
    quad([w0, b0, z0], [w1, b1, z1], [-w1, b1, z1], [-w0, b0, z0]);      // 下
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function makePlane() {
  const g = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xf5f5f2, roughness: 0.4, side: THREE.DoubleSide });
  const blue = new THREE.MeshStandardMaterial({ color: 0x2456a6, roughness: 0.45, side: THREE.DoubleSide });
  const red = new THREE.MeshStandardMaterial({ color: 0xc8322c, roughness: 0.45 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x24282f, roughness: 0.6 });
  const grey = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.5, metalness: 0.4 });
  const interior = new THREE.MeshStandardMaterial({ color: 0x5b5f66, roughness: 0.85 });
  const seatMat = new THREE.MeshStandardMaterial({ color: 0x6b4a3a, roughness: 0.9 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x9fc4dc, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide });
  const shade = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };
  const box = (w, h, d, mat, x, y, z) => { const m = shade(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)); m.position.set(x, y, z); g.add(m); return m; };
  // 胴体：前（エンジンの覆い）と後ろ（尾へ細くなる）。あいだの客室は窓を空けて組む
  g.add(loft([[2.5, 0.3, 1.2, 1.6], [2.2, 0.5, 1.02, 1.78], [1.25, 0.58, 0.92, 1.86]], white));
  g.add(loft([[-1.0, 0.58, 0.92, 2.36], [-1.9, 0.46, 1.08, 2.2], [-5.1, 0.12, 1.62, 1.98]], white));
  // 胴体の青い線
  // （上と下の面を作ると、客室の中を横切る板になるので、横の面だけ）
  g.add(loft([[2.2, 0.505, 1.3, 1.42], [1.25, 0.585, 1.3, 1.42], [-1.0, 0.585, 1.3, 1.42], [-1.9, 0.465, 1.4, 1.52], [-5.1, 0.125, 1.72, 1.8]], blue, true));
  // 客室：床・下の壁・屋根・柱
  box(1.14, 0.04, 2.25, interior, 0, FLOOR, 0.13);
  for (const sx of [-1, 1]) {
    box(0.03, 0.56, 2.25, white, sx * 0.575, FLOOR + 0.27, 0.13);          // 下の壁（窓の下まで）
    box(0.04, 0.9, 0.06, white, sx * 0.575, 1.9, -0.98);                   // 後ろの柱
    box(0.04, 0.9, 0.06, white, sx * 0.575, 1.9, 0.02);                    // ドアの間の柱
  }
  box(1.18, 0.05, 1.25, white, 0, 2.36, -0.38);                             // 屋根
  // 前の柱（風防の両わき）
  for (const sx of [-1, 1]) {
    const a = shade(new THREE.Mesh(new THREE.BoxGeometry(0.03, 1.12, 0.03), white));
    a.position.set(sx * 0.56, 2.1, 0.72);
    a.rotation.x = -Math.atan2(1.05, 0.5);
    g.add(a);
  }
  // 窓（風防・横・後ろ）
  const ws = new THREE.Mesh(new THREE.PlaneGeometry(1.12, Math.hypot(1.05, 0.5)), glass);
  ws.position.set(0, 2.11, 0.725);
  ws.rotation.x = -Math.atan2(1.05, 0.5);
  g.add(ws);
  for (const sx of [-1, 1]) {
    const side = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 0.86), glass);
    side.position.set(sx * 0.58, 1.9, 0.05);
    side.rotation.y = Math.PI / 2;
    g.add(side);
  }
  // 計器盤（左半分に計器の絵。速さ・高さは canvas に描く）
  box(1.1, 0.34, 0.12, dark, 0, 1.55, 1.0);
  const panelCanvas = document.createElement('canvas');
  panelCanvas.width = 256;
  panelCanvas.height = 128;
  const panelTex = new THREE.CanvasTexture(panelCanvas);
  panelTex.colorSpace = THREE.SRGBColorSpace;
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.28), new THREE.MeshBasicMaterial({ map: panelTex }));
  panel.position.set(0.26, 1.56, 0.935);
  panel.rotation.y = Math.PI;
  panel.rotation.x = -0.12;
  g.add(panel);
  const glare = box(1.1, 0.04, 0.3, dark, 0, 1.74, 0.95);
  void glare;
  // 席（左が操縦席、右が女の子）
  for (const sx of [-1, 1]) {
    box(0.46, 0.1, 0.48, seatMat, sx * 0.28, SEAT_TOP - 0.05, -0.2);
    const back = box(0.46, 0.6, 0.08, seatMat, sx * 0.28, SEAT_TOP + 0.3, -0.47);
    back.rotation.x = -0.18;
    box(0.36, SEAT_TOP - 0.1 - FLOOR, 0.36, interior, sx * 0.28, (SEAT_TOP - 0.1 + FLOOR) / 2, -0.2);
  }
  // 操縦かん（2 つ。左がプレイヤーの。steering はこちら）
  const yokes = [];
  for (const sx of [1, -1]) {
    const yoke = new THREE.Group();
    yoke.position.set(sx * 0.28, 1.55, 0.72);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.26, 8), grey);
    shaft.rotation.x = Math.PI / 2;
    shaft.position.z = 0.13;
    yoke.add(shaft);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.03, 0.03), dark);
    yoke.add(bar);
    for (const hx of [-1, 1]) {
      const horn = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.12, 0.035), dark);
      horn.position.set(hx * 0.15, 0.045, 0);
      yoke.add(horn);
    }
    g.add(yoke);
    yokes.push(yoke);
  }
  // 翼（胴体の上。先は赤）と支柱
  box(10.2, 0.12, 1.5, white, 0, 2.44, 0.1);
  for (const sx of [-1, 1]) {
    box(0.6, 0.12, 1.5, red, sx * 5.4, 2.44, 0.1);
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 2.4, 6), grey);
    strut.position.set(sx * 1.6, 1.72, 0.2);
    strut.rotation.z = sx * Math.atan2(2.0, 1.3);
    g.add(strut);
  }
  // 尾翼
  box(3.4, 0.06, 0.95, white, 0, 1.86, -4.7);
  const fin = new THREE.Shape();
  fin.moveTo(0, 0);
  fin.lineTo(1.25, 0);
  fin.lineTo(0.55, 1.35);
  fin.lineTo(0.05, 1.35);
  fin.lineTo(0, 0);
  const finGeo = new THREE.ExtrudeGeometry(fin, { depth: 0.06, bevelEnabled: false });
  finGeo.translate(0, 0, -0.03);
  const finMesh = shade(new THREE.Mesh(finGeo, white));
  finMesh.rotation.y = Math.PI / 2;
  finMesh.position.set(0, 1.96, -3.9);
  g.add(finMesh);
  box(0.07, 0.3, 0.9, red, 0, 2.95, -4.8);
  // 車輪（前 1・後ろ 2）
  const wheelGeo = new THREE.CylinderGeometry(0.28, 0.28, 0.16, 16);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheels = [];
  for (const [x, z] of [[1.2, -0.15], [-1.2, -0.15], [0, 1.95]]) {
    const w = shade(new THREE.Mesh(wheelGeo, dark));
    w.position.set(x, 0.28, z);
    g.add(w);
    wheels.push(w);
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.8, 0.08), grey);
    leg.position.set(x * 0.7, 0.66, z);
    leg.rotation.z = x ? -Math.sign(x) * 0.75 : 0;
    g.add(leg);
  }
  // プロペラ（回る。速いときは薄い円盤も出す）
  const prop = new THREE.Group();
  prop.position.set(0, 1.4, 2.55);
  const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.32, 12), grey);
  spinner.rotation.x = Math.PI / 2;
  spinner.position.z = 0.1;
  prop.add(spinner);
  const blades = new THREE.Group();
  const blade = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.13, 0.03), dark);
  blades.add(blade);
  prop.add(blades);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.95, 24), new THREE.MeshBasicMaterial({ color: 0xb8bcc2, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
  prop.add(disc);
  g.add(prop);
  return { g, yokes, blades, disc, panelCanvas, panelTex };
}

export function createCessna({ onTravel = () => {} } = {}) {
  const interactables = [];
  const field = makeField(interactables, (dest) => onTravel(dest));
  const group = new THREE.Group();
  group.name = 'cessna';
  const { g: model, yokes, blades, disc, panelCanvas, panelTex } = makePlane();
  group.add(model);
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.6, 7.6), new THREE.MeshBasicMaterial({ visible: false }));
  body.geometry.translate(0, 1.3, -1.2);
  body.userData.interactive = true;
  group.add(body);
  // steering：左の操縦かん（VR の両手の傾きで旋回。kartdrive.js がワールドの位置を見る）
  const steering = yokes[0];
  // 女の子の席の台（右の席の上）
  const girlPivot = new THREE.Object3D();
  girlPivot.position.set(-0.28, SEAT_TOP, -0.22);
  model.add(girlPivot);
  const real = typeof location !== 'undefined' && new URLSearchParams(location.search).get('flight') === 'real';

  const state = { speed: 0, yaw: PARK.yaw, travelYaw: PARK.yaw, steer: 0, onGrass: false, lateral: 0, u: 0 };
  const pos = new THREE.Vector3(PARK.x, RUNWAY.y, PARK.z);
  let v = 0;
  let pitch = 0;          // 進む向きの上下（上が正）
  let bank = 0;           // 傾き（左が正）
  let throttle = 0;
  let onGround = true;
  let airTime = 0;        // 浮いてからの時間（浮いた直後に「接地」と見ないように）
  let riding = false;
  let hold = false;
  let held = 0;
  let propAngle = 0;
  let firstPerson = () => false;
  let onEvent = null;     // 'liftoff' / 'touchdown' / 'crash'
  let panelIn = 0;
  const eyeLocal = new THREE.Vector3(0.28, SEAT_TOP + 0.75, -0.18);
  const tmp = new THREE.Vector3();
  const q = new THREE.Quaternion();

  /** ぶつかる物（地面・海のほか）：観覧車・コースター・家・島・灯台 */
  function hitsSomething(x, y, z) {
    const g = Math.max(hillHeight(x, z), SEA_LEVEL);
    if (y < g + 0.05) return 'ground';
    if (Math.hypot(x - FERRIS.x, z - FERRIS.z) < FERRIS.radius + 3 && y < FERRIS.hub + FERRIS.radius + 2) return 'ferris';
    const C = COASTER_ZONE;
    if (x > C.minX && x < C.maxX && z > C.minZ && z < C.maxZ && y < 29) return 'coaster';
    const P = PLATEAU;
    if (x > P.minX && x < P.maxX && z > P.minZ && z < P.maxZ && y < 7) return 'hill';
    if (Math.hypot(x - 150, z + 230) < 12 && y < SEA_LEVEL + 22) return 'lighthouse';
    for (const [ix, iz, r, h] of [[-260, -520, 70, 36], [340, -760, 110, 55], [-60, -900, 50, 22]]) {
      const d = Math.hypot((x - ix) / 1.35, (z - iz) / (1.35 * 0.7));
      if (d < r && y < SEA_LEVEL + h * (1 - d / r) - 2) return 'island';
    }
    return null;
  }

  function place() {
    group.position.copy(pos);
    group.rotation.set(0, state.yaw, 0);
    // 機内から見ているあいだは、機体を水平のまま（酔いにくいように）。後ろからの視点では傾ける
    const tilt = real || !firstPerson();
    model.rotation.set(tilt ? -pitch : 0, 0, tilt ? -bank : 0, 'YXZ');
    group.updateMatrixWorld(true);
  }

  function drawPanel() {
    const c = panelCanvas.getContext('2d');
    c.fillStyle = '#15191e';
    c.fillRect(0, 0, 256, 128);
    c.fillStyle = '#9fe8a0';
    c.font = 'bold 26px sans-serif';
    c.textAlign = 'left';
    c.fillText(`${Math.round(v * 3.6)} km/h`, 12, 34);
    const alt = pos.y - Math.max(hillHeight(pos.x, pos.z), SEA_LEVEL);
    c.fillText(`${Math.max(0, Math.round(alt))} m`, 140, 34);
    c.fillStyle = '#ffd27a';
    c.font = '17px sans-serif';
    c.fillText('速さ', 12, 58);
    c.fillText('高さ', 140, 58);
    c.fillStyle = '#cfd6de';
    c.font = '16px sans-serif';
    c.fillText(onGround ? '右トリガー/W：加速→離陸' : '右トリガー/W：上昇', 12, 86);
    c.fillText(onGround ? '左トリガー/S：ブレーキ' : '左トリガー/S：降下', 12, 110);
    panelTex.needsUpdate = true;
  }
  drawPanel();
  place();

  function reset() {
    pos.set(PARK.x, RUNWAY.y, PARK.z);
    state.yaw = state.travelYaw = PARK.yaw;
    v = 0; pitch = 0; bank = 0; throttle = 0; onGround = true;
    state.speed = 0; state.steer = 0;
    place();
    drawPanel();
  }

  // PC の表示（速さ・高さ・操作）。VR では計器盤の canvas に同じことを描く
  let hud = null;
  function showHud(on) {
    if (typeof document === 'undefined') return;
    if (!hud && on) {
      hud = document.createElement('div');
      hud.style.cssText = 'position:fixed;left:14px;bottom:14px;padding:8px 12px;background:rgba(20,24,36,.78);color:#fff;font:600 14px/1.5 sans-serif;border-radius:8px;z-index:20;pointer-events:none;white-space:pre';
      document.body.appendChild(hud);
    }
    if (!hud) return;
    hud.style.display = on ? '' : 'none';
    if (!on) return;
    const alt = Math.max(0, Math.round(pos.y - Math.max(hillHeight(pos.x, pos.z), SEA_LEVEL)));
    hud.textContent = `速さ ${Math.round(v * 3.6)} km/h　高さ ${alt} m${hold ? '　（女の子を待っています）' : ''}\n`
      + (onGround ? 'W 加速（86km/h を超えると離陸）/ S ブレーキ / A・D 向き / C 視点 / E 降りる' : 'W 上昇 / S 降下 / A・D 旋回 / C 視点 / E 降りる（暗くして戻る）');
  }

  function update(dt, input, clamp, ctx) {
    showHud(riding && !ctx?.xr);
    if (hold) { held += dt; if (held > 30) hold = false; }
    const up = hold ? 0 : input?.throttle ?? 0;
    const down = hold ? 0 : input?.brake ?? 0;
    const steer = input?.steer ?? 0;
    state.steer += (steer - state.steer) * Math.min(1, dt * 6);
    if (onGround) {
      throttle += (up - throttle) * Math.min(1, dt * 2);
      v += (3.6 * throttle - down * 5 - 0.02 * v - (v > 0 ? 0.25 : 0)) * dt;
      v = Math.max(0, v);
      state.yaw += state.steer * 0.55 * Math.min(1, v / 4) * (1 - 0.7 * Math.min(1, v / 30)) * dt;
      pitch += (0 - pitch) * Math.min(1, dt * 3);
      bank += (0 - bank) * Math.min(1, dt * 3);
      pos.x += Math.sin(state.yaw) * v * dt;
      pos.z += Math.cos(state.yaw) * v * dt;
      pos.y = RUNWAY.y;
      // 平らな所の外へは出ない（坂へ転がり落ちないように）
      if (!inAirfield(pos.x, pos.z, 6)) {
        const A = AIRFIELD_ZONE;
        pos.x = THREE.MathUtils.clamp(pos.x, A.minX + 6, A.maxX - 6);
        pos.z = THREE.MathUtils.clamp(pos.z, A.minZ + 6, A.maxZ - 6);
        v *= 0.5;
      }
      if (v > ROTATE && up > 0.5) { onGround = false; pitch = 0.06; airTime = 0; onEvent?.('liftoff'); }
    } else {
      const climb = up;
      const descend = down;
      let pitchTarget = climb * 0.17 - descend * 0.12;
      throttle += ((descend > 0.05 ? 0.12 : 0.62 + climb * 0.38) - throttle) * Math.min(1, dt * 1.5);
      if (v < STALL) pitchTarget = Math.min(pitchTarget, -0.1);
      if (pos.y > 520) pitchTarget = Math.min(pitchTarget, 0);
      pitch += (pitchTarget - pitch) * Math.min(1, dt * 1.1);
      v += (throttle * 6 - 0.002 * v * v - 9.8 * Math.sin(pitch)) * dt;
      v = Math.max(12, v);
      // 遠くへ行きすぎたら、ひとりでに戻る向きへ旋回する
      let bankIn = state.steer;
      const away = Math.hypot(pos.x, pos.z + 150);
      if (away > 1400) {
        const home = Math.atan2(-pos.x, -150 - pos.z);
        const d = Math.atan2(Math.sin(home - state.yaw), Math.cos(home - state.yaw));
        bankIn = THREE.MathUtils.clamp(d * 2, -1, 1);
      }
      bank += (bankIn * 0.6 - bank) * Math.min(1, dt * 1.4);
      state.yaw += (9.8 * Math.tan(bank) / Math.max(v, 15)) * dt;
      pos.x += Math.sin(state.yaw) * Math.cos(pitch) * v * dt;
      pos.z += Math.cos(state.yaw) * Math.cos(pitch) * v * dt;
      pos.y += Math.sin(pitch) * v * dt;
      // 接地：飛行場の平らな所へ、ゆるく降りてきたとき
      airTime += dt;
      const g = Math.max(hillHeight(pos.x, pos.z), SEA_LEVEL);
      if (pos.y < g + 0.3 && inAirfield(pos.x, pos.z, 4)) {
        if (airTime < 1.5 || pitch >= 0.03) {
          // 浮いた直後・上昇中：地面の上に保つ（滑走路は地面より 3cm 高いだけなので、すぐ「ぶつかった」にしない）
          pos.y = Math.max(pos.y, RUNWAY.y);
        } else if (Math.sin(pitch) * v > -5 && Math.abs(bank) < 0.3) {
          // 接地：ゆるく降りてきたとき（降下 5m/s まで・傾き 17° まで）
          onGround = true;
          pos.y = RUNWAY.y;
          onEvent?.('touchdown');
        } else {
          onEvent?.('crash', 'ground'); reset(); return;
        }
      } else {
        const hit = hitsSomething(pos.x, pos.y, pos.z);
        if (hit) { onEvent?.('crash', hit); reset(); return; }
      }
    }
    state.speed = v;
    state.travelYaw = state.yaw;
    // プロペラ・操縦かん
    const rpm = 0.25 + throttle * 0.75;
    propAngle += dt * (hold && !riding ? 0 : rpm * 55);
    blades.rotation.z = propAngle;
    disc.material.opacity = Math.min(0.1, Math.max(0, rpm - 0.35) * 0.25);
    blades.visible = rpm < 0.8;
    for (const y of yokes) { y.rotation.z = -state.steer * 0.7; y.position.z = 0.72 - (onGround ? 0 : pitch * 0.4); }
    panelIn -= dt;
    if (panelIn < 0) { drawPanel(); panelIn = 0.25; }
    place();
  }

  return {
    group,
    field,
    body,
    state,
    steering,
    kind: 'cessna',
    silent: false,
    chaseBack: 12,
    chaseUp: 4,
    place() {},
    update,
    /** 乗っていないとき（world.js から）：止めたまま */
    idle(dt) {
      if (riding) return;
      propAngle += 0;
      void dt;
    },
    board() { riding = true; hold = true; held = 0; throttle = 0; },
    leave() { riding = false; hold = false; throttle = 0; v = 0; state.speed = 0; showHud(false); },
    reset,
    /** 目（左の操縦席） */
    eye(out = new THREE.Vector3()) {
      group.updateMatrixWorld(true);
      if (real) return model.localToWorld(out.copy(eyeLocal));
      return group.localToWorld(out.copy(eyeLocal));
    },
    /** ?flight=real のときだけ：目も機体ごと傾ける */
    seatQuaternion: real ? (out) => { model.getWorldQuaternion(out); return out; } : undefined,
    /** 乗り口（kartdrive.js の E）：左のドアの外（止まっているときだけ） */
    enterPoint(from, out = new THREE.Vector3()) {
      if (riding || !onGround || v > 0.5) return out.set(1e6, 0, 1e6);
      return group.localToWorld(out.set(1.3, 0, -0.1));
    },
    /** 降りる所（左のドアの外）。空にいるとき（world.js が暗くして戻す）は、止めておく所の横 */
    side(out = new THREE.Vector3()) {
      if (!onGround || v > 1) return out.set(PARK.x - 0.1, AIRFIELD_ZONE.y, PARK.z - 1.6);
      group.updateMatrixWorld(true);
      group.localToWorld(out.set(1.5, 0, -0.2));
      out.y = AIRFIELD_ZONE.y;
      return out;
    },
    /** 女の子が乗り込む所（右のドアの外） */
    girlDoor(out = new THREE.Vector3()) {
      group.updateMatrixWorld(true);
      group.localToWorld(out.set(-1.5, 0, -0.2));
      out.y = AIRFIELD_ZONE.y;
      return out;
    },
    /** PC の後ろからの視点（C） */
    chase(camera) {
      const fx = Math.sin(state.yaw);
      const fz = Math.cos(state.yaw);
      camera.position.set(pos.x - fx * 13, pos.y + 4.2 - Math.sin(pitch) * 6, pos.z - fz * 13);
      camera.lookAt(pos.x + fx * 4, pos.y + 1.6, pos.z + fz * 4);
    },
    girlPivot,
    model,
    interactables,
    set firstPerson(fn) { firstPerson = fn; },
    set onEvent(fn) { onEvent = fn; },
    set hold(x) { hold = Boolean(x); held = 0; },
    get hold() { return hold; },
    get rpm01() { return 0.2 + throttle * 0.75; },
    get speed() { return v; },
    get onGround() { return onGround; },
    get altitude() { return pos.y - Math.max(hillHeight(pos.x, pos.z), SEA_LEVEL); },
    get position() { return pos; },
    get bank() { return bank; },
    get pitch() { return pitch; },
    get riding() { return riding; },
    /** 止めておく所のそばか（降りても暗くしなくてよい） */
    get parked() { return onGround && v < 1; },
    /** 試験用：空の (x, y, z) に、yaw 向き・速さ speed で置く */
    debugAir(x, y, z, yaw, speed = 45) { pos.set(x, y, z); state.yaw = yaw; v = speed; onGround = false; airTime = 5; pitch = 0; bank = 0; throttle = 0.62; place(); },
  };
}
