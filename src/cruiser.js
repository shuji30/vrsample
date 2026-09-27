import * as THREE from 'three';
import { SEA_LEVEL, hillHeight } from './hill.js';

/**
 * 船着き場とクルーザー。砂浜の東寄り（パラソルから 20m ほど東）から、北の沖へ桟橋が延びる。
 * 桟橋の先の T 字の所に、白いクルーザー「しおかぜ号」がつないである。
 *
 * 乗り物の窓口（kartdrive.js）。桟橋の先で E / 船へトリガーで、操縦席の右に座り、自分で操縦する：
 * PC は W / S / A / D（ゲームパッド・ハンコンも）、VR は右トリガーで前へ・左トリガーで減速と後退、舵輪を両手で握って回す
 * （握っていないときは左スティック）。最高 11m/s。大きな船なので、ゆっくり速くなり、ゆっくり曲がり、水の上で少し横へ流れる。
 * 女の子が左に座るまでは動かない（来ないなら 3 秒、向かっているなら 60 秒まで待つ）。
 * 浅瀬・岩場・桟橋・島・灯台の岩・高架の橋脚・ジェットスキーにはぶつかる（world.js が blocked で渡す）。
 * 桟橋のそばで止まって E で降りる。沖で降りると、暗くしてから桟橋へ戻す（女の子も）。
 *
 * VR 酔いにくいように、リグは向きだけ回す（船の傾き・揺れは目に入れず、上下の揺れを半分だけ）。
 * PC は C で後ろの斜め上からの視点。
 */
export const PIER = {
  x: 28.1,
  width: 1.9,
  fromZ: -85.5,      // 砂浜の上の付け根
  toZ: -113.9,       // 先の T 字の北の縁
  headZ: -112.1,     // T 字の南の縁
  headMinX: 22.2,
  headMaxX: 33.8,
  y: SEA_LEVEL + 1.45,
};
/** 桟橋の上の高さ（付け根は砂浜の高さから、4m かけて板の高さへ） */
export function pierDeckY(x, z) {
  const sand = hillHeight(x, PIER.fromZ);
  const k = THREE.MathUtils.clamp((PIER.fromZ - z) / 4, 0, 1);
  return THREE.MathUtils.lerp(Math.max(sand, PIER.y - 0.4), PIER.y, k);
}
/** 桟橋の上か（本体と先の T 字） */
export function onPier(x, z) {
  const P = PIER;
  if (Math.abs(x - P.x) < P.width / 2 + 0.05 && z < P.fromZ + 0.3 && z > P.toZ) return true;
  return x > P.headMinX && x < P.headMaxX && z < P.headZ + 0.05 && z > P.toZ;
}
/** 船をつないでおく所（T 字の北の縁ぞい、東向き） */
const DOCK = { x: 28.0, z: PIER.toZ - 2.1, yaw: Math.PI / 2 };
const CRUISE = 11;       // 最高速（m/s。40km/h）
const ACCEL = 2.2;
const REVERSE = 2;
const DECK = 1.0;        // 甲板の高さ（喫水線から）

/**
 * 周遊の道（とじた曲線。s = 0 が桟橋の前）。桟橋の東はすぐ岩場なので、出たらすぐ左（北）へ曲がって
 * 岬の西の水路を北へ抜け、灯台の南を回って、西の島を右に見ながら一回りし、西から桟橋へ戻る。
 * 船体の四隅が浅瀬にかからない（水深 1m 以上）ことを確かめてある。
 */
export function routeCurve() {
  const pts = [
    [DOCK.x, DOCK.z], [34.5, -118.6], [37, -125], [37, -140], [37, -172], [60, -215], [110, -245], [145, -262],
    [135, -300], [80, -345], [10, -400], [-100, -455], [-180, -625], [-300, -660], [-430, -560], [-420, -440],
    [-300, -370], [-170, -290], [-80, -190], [-40, -124], [4, -116.3], [18, -116],
  ].map(([x, z]) => new THREE.Vector3(x, 0, z));
  return new THREE.CatmullRomCurve3(pts, true, 'centripetal', 0.5);
}

/**
 * 引き波（後ろへ V 字に広がって消えていく泡）。長さ 1・幅 1 の板なので、scale で大きさを入れ、
 * 船の子にはせず海面の高さに置く（船の上下・前上がりごと傾くと、遠い端が海面の下に沈むため）。
 * 板の +Y（テクスチャの上）が遠い端。rotation.set(-π/2, yaw, 0, 'YXZ') で yaw の後ろへ延びる
 */
export function makeWake() {
  const wc = document.createElement('canvas');
  wc.width = 128; wc.height = 256;
  const wx = wc.getContext('2d');
  for (let y = 0; y < 256; y++) {
    const k = y / 255;                 // 0 = 船尾、1 = 遠く
    const a = (1 - k) ** 1.6;
    const half = 18 + k * 44;          // V の開き（泡の筋の位置）
    const g2 = wx.createLinearGradient(0, 0, 128, 0);
    g2.addColorStop(0, 'rgba(255,255,255,0)');
    g2.addColorStop(Math.max(0, (64 - half - 6) / 128), 'rgba(255,255,255,0)');
    g2.addColorStop((64 - half) / 128, `rgba(255,255,255,${0.62 * a})`);
    g2.addColorStop(Math.min(0.5, (64 - half + 10 + k * 8) / 128), `rgba(255,255,255,${0.14 * a})`);
    g2.addColorStop(0.5, `rgba(255,255,255,${(0.32 - 0.25 * k) * a})`);
    g2.addColorStop(Math.max(0.5, (64 + half - 10 - k * 8) / 128), `rgba(255,255,255,${0.14 * a})`);
    g2.addColorStop((64 + half) / 128, `rgba(255,255,255,${0.62 * a})`);
    g2.addColorStop(Math.min(1, (64 + half + 6) / 128), 'rgba(255,255,255,0)');
    g2.addColorStop(1, 'rgba(255,255,255,0)');
    wx.fillStyle = g2;
    wx.fillRect(0, 255 - y, 128, 1);
  }
  const wakeTex = new THREE.CanvasTexture(wc);
  wakeTex.colorSpace = THREE.SRGBColorSpace;
  const wakeMat = new THREE.MeshBasicMaterial({ map: wakeTex, transparent: true, depthWrite: false, fog: true });
  const wake = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), wakeMat);
  wake.renderOrder = 2;
  wake.frustumCulled = false;
  return wake;
}

function makePier() {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0xa27b52, roughness: 0.85 });
  const post = new THREE.MeshStandardMaterial({ color: 0x6d5236, roughness: 0.9 });
  const P = PIER;
  const shade = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };
  // 本体（付け根の坂は、短い板を並べる）
  for (let z = P.fromZ; z > P.headZ; z -= 1) {
    const zc = z - 0.5;
    const y = pierDeckY(P.x, zc);
    const plank = shade(new THREE.Mesh(new THREE.BoxGeometry(P.width, 0.1, 0.96), wood));
    plank.position.set(P.x, y - 0.05, zc);
    g.add(plank);
  }
  const head = shade(new THREE.Mesh(new THREE.BoxGeometry(P.headMaxX - P.headMinX, 0.1, P.headZ - P.toZ), wood));
  head.position.set((P.headMinX + P.headMaxX) / 2, P.y - 0.05, (P.headZ + P.toZ) / 2);
  g.add(head);
  // 杭（海の底まで）
  const pile = new THREE.CylinderGeometry(0.12, 0.12, 1, 8);
  const addPile = (x, z) => {
    const top = pierDeckY(x, z) - 0.1;
    const bottom = Math.min(hillHeight(x, z), SEA_LEVEL - 1.5);
    const m = new THREE.Mesh(pile, post);
    m.scale.y = top - bottom;
    m.position.set(x, (top + bottom) / 2, z);
    g.add(m);
  };
  for (let z = P.fromZ - 4; z > P.headZ; z -= 4) { addPile(P.x - P.width / 2, z); addPile(P.x + P.width / 2, z); }
  for (let x = P.headMinX + 0.3; x < P.headMaxX; x += 2.8) { addPile(x, P.toZ + 0.1); addPile(x, P.headZ - 0.1); }
  // 手すり（本体の両わき。T 字の北の縁は船に乗るので空ける）
  const rail = new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.6 });
  for (const sx of [-1, 1]) {
    const len = P.fromZ - 4 - P.headZ;
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, len), rail);
    bar.position.set(P.x + sx * (P.width / 2 - 0.03), P.y + 0.9, P.headZ + len / 2);
    g.add(bar);
    for (let z = P.fromZ - 4; z >= P.headZ; z -= 2) {
      const pst = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.9, 0.06), rail);
      pst.position.set(P.x + sx * (P.width / 2 - 0.03), P.y + 0.45, z);
      g.add(pst);
    }
  }
  // 看板
  const c = document.createElement('canvas');
  c.width = 256; c.height = 96;
  const x = c.getContext('2d');
  x.fillStyle = '#1f4f7a'; x.fillRect(0, 0, 256, 96);
  x.fillStyle = '#fff'; x.font = 'bold 34px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText('しまめぐり', 128, 36);
  x.font = '20px sans-serif';
  x.fillText('クルーザー のりば', 128, 72);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.6), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
  const sy = pierDeckY(P.x, P.fromZ);
  sign.position.set(P.x + 1.6, sy + 1.6, P.fromZ + 0.6);
  g.add(sign);
  const sp = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.4, 0.08), post);
  sp.position.set(P.x + 1.6, sy + 0.7, P.fromZ + 0.6);
  g.add(sp);
  return g;
}

function makeBoat() {
  const g = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xf6f6f2, roughness: 0.35 });
  const navy = new THREE.MeshStandardMaterial({ color: 0x1f3f73, roughness: 0.4 });
  const cushion = new THREE.MeshStandardMaterial({ color: 0xe9e2d0, roughness: 0.9 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x3a4a5a, roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.35, depthWrite: false });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xd0d4da, roughness: 0.25, metalness: 0.9 });
  const shade = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };
  // 船体（上から見た形を押し出す。とがった船首は +Z）
  const outline = new THREE.Shape();
  // 船首はとがらせる（両わきの線が先で鋭く出会う。以前は丸い船首だった）
  outline.moveTo(-1.8, -5.5);
  outline.lineTo(1.8, -5.5);
  outline.lineTo(1.85, 1.0);
  outline.quadraticCurveTo(1.75, 4.2, 0, 7.4);
  outline.quadraticCurveTo(-1.75, 4.2, -1.85, 1.0);
  outline.lineTo(-1.8, -5.5);
  const hullGeo = (from, to) => {
    const geo = new THREE.ExtrudeGeometry(outline, { depth: to - from, bevelEnabled: false, curveSegments: 10 });
    geo.rotateX(Math.PI / 2);
    geo.translate(0, to, 0);
    return geo;
  };
  const top = shade(new THREE.Mesh(hullGeo(0.25, DECK), white));
  g.add(top);
  const bottom = shade(new THREE.Mesh(hullGeo(-0.45, 0.25), navy));
  g.add(bottom);
  // 甲板（チーク）
  const deckGeo = new THREE.ShapeGeometry(outline, 10);
  deckGeo.rotateX(Math.PI / 2);
  // ShapeGeometry を X で +90° 回すと表が下を向くので、両面にする
  const deck = new THREE.Mesh(deckGeo, new THREE.MeshStandardMaterial({ color: 0xb58a5a, roughness: 0.7, side: THREE.DoubleSide }));
  deck.position.y = DECK + 0.005;
  deck.scale.set(0.96, 1, 0.97);
  deck.receiveShadow = true;
  g.add(deck);
  // 船室（前。低くして、座った目から船首と海が見えるように）と風防（目より下まで）
  const cabin = shade(new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.55, 3.6), white));
  cabin.position.set(0, DECK + 0.275, 2.8);
  g.add(cabin);
  const cabinTop = shade(new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.06, 3.8), white));
  cabinTop.position.set(0, DECK + 0.57, 2.75);
  g.add(cabinTop);
  for (const sx of [-1, 1]) {
    const port = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.18), new THREE.MeshStandardMaterial({ color: 0x223040, roughness: 0.1 }));
    port.position.set(sx * 1.405, DECK + 0.32, 2.8);
    port.rotation.y = sx * Math.PI / 2;
    g.add(port);
  }
  // 風防：船室の後ろの縁（高さ 0.6）から、後ろへ傾けて 1.0 まで
  const windshield = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 0.54), glass);
  windshield.position.set(0, DECK + 0.8, 0.83);
  windshield.rotation.x = -0.59;
  g.add(windshield);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(2.85, 0.04, 0.04), chrome);
  frame.position.set(0, DECK + 1.02, 0.68);
  g.add(frame);
  for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.54, 0.03), chrome);
    post.position.set(sx * 1.41, DECK + 0.8, 0.83);
    post.rotation.x = -0.59;
    g.add(post);
  }
  // 操縦席（ベンチ 2 人ぶん、前を向く）と舵輪
  const bench = shade(new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.45, 0.6), white));
  bench.position.set(0, DECK + 0.225, -1.25);
  g.add(bench);
  const seat = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.1, 0.55), cushion);
  seat.position.set(0, DECK + 0.5, -1.25);
  g.add(seat);
  const back = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.55, 0.12), cushion);
  back.position.set(0, DECK + 0.78, -1.55);
  back.rotation.x = -0.15;
  g.add(back);
  // 操縦台（プレイヤーの前だけ。低くして、前が見えるように）と舵輪
  const console_ = shade(new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.62, 0.4), white));
  console_.position.set(-0.5, DECK + 0.31, -0.3);
  g.add(console_);
  const dash = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.02, 0.28), new THREE.MeshStandardMaterial({ color: 0x20262e, roughness: 0.5 }));
  dash.position.set(-0.5, DECK + 0.63, -0.3);
  g.add(dash);
  const wheel = new THREE.Group();
  // 舵輪の面（輪のローカル +Z）を操縦席の目のほうへ向ける（目は 0.6m 後ろ・0.5m 上なので、面を 0.68rad 上へ起こす）。
  // 前は面が船の前（プレイヤーから遠いほう）へ傾いていた。GT3 のハンドルと同じく Y で半回転してから X で起こす
  wheel.position.set(-0.5, DECK + 0.78, -0.55);
  wheel.rotation.set(0.68, Math.PI, 0);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.015, 8, 24), chrome);
  wheel.add(rim);
  for (let i = 0; i < 3; i++) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.015, 0.015), chrome);
    spoke.rotation.z = (i * Math.PI) / 3;
    wheel.add(spoke);
  }
  g.add(wheel);
  g.userData.wheel = wheel;
  // 手すり（両舷）
  for (const sx of [-1, 1]) {
    // 船首は細くなるので、手すりは船室の横まで（先まで伸ばすと船体からはみ出す）
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 7.4, 6), chrome);
    bar.rotation.x = Math.PI / 2;
    bar.position.set(sx * 1.72, DECK + 0.55, -1.15);
    g.add(bar);
    for (let z = -4.8; z <= 2.5; z += 1.46) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.55, 6), chrome);
      p.position.set(sx * 1.72, DECK + 0.27, z);
      g.add(p);
    }
  }
  // 名前
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = '#1f3f73'; x.font = 'bold 40px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText('しおかぜ号', 128, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  for (const sx of [-1, 1]) {
    const name = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.45), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
    name.position.set(sx * 1.86, 0.62, 1.0);
    name.rotation.y = sx * Math.PI / 2;
    g.add(name);
  }
  const wake = makeWake();
  // 船の子にはしない（船の上下・前上がりごと傾くと、遠い端が海面の下に沈むため）。createCruiser が海面に置く
  g.userData.wake = wake;
  return g;
}

export function createCruiser({ blocked = () => false } = {}) {
  const group = new THREE.Group();
  group.name = 'cruiser';
  group.add(makePier());
  const boat = new THREE.Group();
  const model = makeBoat();
  boat.add(model);
  group.add(boat);
  group.add(model.userData.wake);
  const body = new THREE.Mesh(new THREE.BoxGeometry(3.6, 1.8, 12.6), new THREE.MeshBasicMaterial({ visible: false }));
  body.position.set(0, 1.0, 0.8);
  body.userData.interactive = true;
  boat.add(body);
  // steering：舵輪（VR の両手で回す。kartdrive.js の steerFromHands）
  const wheel = model.userData.wheel;
  const steering = wheel;
  // 女の子の席の台（操縦席のベンチの左）
  const girlPivot = new THREE.Object3D();
  girlPivot.position.set(0.5, DECK + 0.55, -1.2);
  model.add(girlPivot);

  const state = { speed: 0, yaw: DOCK.yaw, travelYaw: DOCK.yaw, steer: 0, onGrass: false, lateral: 0, u: 0 };
  const pos = new THREE.Vector2(DOCK.x, DOCK.z);
  let v = 0;
  let rate = 0;
  let roll = 0;
  let phase = 'docked';   // docked（つないである）/ boarding（乗って女の子を待つ）/ cruising（自分で走る）
  let wait = 0;
  let riding = false;
  let girlSeated = false;
  let girlComing = false;
  let time = 0;
  let bob = 0;
  let onBump = null;
  let bumpCool = 0;
  // 船体の当たり（船のローカル：横 x・前 z）。とがった船首から船尾の角まで
  const hull = [[0, 7.2], [1.3, 4.6], [-1.3, 4.6], [1.8, 1.2], [-1.8, 1.2], [1.8, -2.5], [-1.8, -2.5], [1.75, -5.4], [-1.75, -5.4]];
  const free = (x, z, yaw) => {
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    return hull.every(([r, f]) => { const px = x + fx * f + fz * r; const pz = z + fz * f - fx * r; return !blocked(px, pz); });
  };

  function placeModel(dt) {
    time += dt;
    const speed01 = Math.min(1, Math.abs(v) / CRUISE);
    bob = Math.sin(time * 1.3) * 0.05 + Math.sin(time * 0.7 + 1) * 0.03;
    boat.position.set(pos.x, SEA_LEVEL + bob, pos.y);
    // 曲がると外へ少し傾き、速いと船首が少し上がる。波で少し揺れる（VR の目には上下を半分だけ出す）
    roll += (THREE.MathUtils.clamp(-rate * v * 0.012, -0.07, 0.07) - roll) * Math.min(1, dt * 2);
    boat.rotation.set(Math.sin(time * 0.9) * 0.012 - speed01 * 0.03, state.yaw, roll + Math.sin(time * 1.1) * 0.01, 'YXZ');
    state.bob = bob;
    // 引き波
    const wake = model.userData.wake;
    const len = Math.min(40, Math.abs(v) * 3);
    wake.visible = v > 0.5;
    wake.scale.set(8 + v * 0.8, len, 1);
    const back = 5.5 + len / 2;
    wake.position.set(pos.x - Math.sin(state.travelYaw) * back, SEA_LEVEL + 0.03, pos.y - Math.cos(state.travelYaw) * back);
    wake.rotation.set(-Math.PI / 2, state.travelYaw, 0, 'YXZ');
    // 舵輪：左へ切ると（運転席から見て）左回り
    // 面がこちらを向いたので、左へ切る（steer > 0）と、こちらから見て左回り（+Z まわり）
    wheel.rotation.z = state.steer * 1.5;
    boat.updateMatrixWorld(true);
  }
  placeModel(0);

  function toDock() {
    pos.set(DOCK.x, DOCK.z);
    state.yaw = state.travelYaw = DOCK.yaw;
    v = 0; rate = 0; roll = 0; state.steer = 0; state.speed = 0;
    placeModel(0);
  }

  function update(dt, input) {
    bumpCool -= dt;
    if (phase === 'boarding') {
      wait += dt;
      if (girlSeated || (!girlComing && wait > 3) || wait > 60) phase = 'cruising';
    }
    const go = phase === 'cruising';
    const throttle = go ? input?.throttle ?? 0 : 0;
    const brake = go ? input?.brake ?? 0 : 0;
    state.steer += ((input?.steer ?? 0) - state.steer) * Math.min(1, dt * 3);
    // 大きな船なので、ゆっくり速くなり、ゆっくり止まる（最高 11m/s）
    if (throttle > 0.02) v += throttle * ACCEL * (1 - Math.max(0, v) / CRUISE) * dt;
    if (brake > 0.02) v = Math.max(-REVERSE, v - brake * 2.2 * dt);
    v -= v * 0.015 * dt;
    if (throttle < 0.02 && brake < 0.02) v -= Math.sign(v) * Math.min(Math.abs(v), 0.35 * dt);
    // 向き：速いほどよく曲がる（止まっていても、船首の小さなスクリューで少しは回る）。後ろへ進むときは逆
    const k = Math.min(1, Math.abs(v) / 4);
    rate = state.steer * (0.06 + 0.24 * k) * (v < -0.1 ? -1 : 1);
    state.yaw += rate * dt;
    // 進む向きは少し遅れてついてくる（水の上で横へ流れる）
    let slip = state.yaw - state.travelYaw;
    slip = Math.atan2(Math.sin(slip), Math.cos(slip));
    state.travelYaw += slip * Math.min(1, dt * 1.2);
    const nx = pos.x + Math.sin(state.travelYaw) * v * dt;
    const nz = pos.y + Math.cos(state.travelYaw) * v * dt;
    // ぶつかる（浅瀬・岩場・桟橋・島・橋脚）：止めて少し跳ね返す。斜めなら沿って滑る。
    // つないである所は桟橋の縁に近いので、はじめから当たっているときは、抜ける向きへは動ける
    if (free(nx, nz, state.yaw) || !free(pos.x, pos.y, state.yaw)) {
      pos.set(nx, nz);
    } else if (free(nx, pos.y, state.yaw) && Math.abs(nx - pos.x) > 1e-4) {
      pos.x = nx;
      v *= 1 - Math.min(1, dt * 2);
    } else if (free(pos.x, nz, state.yaw) && Math.abs(nz - pos.y) > 1e-4) {
      pos.y = nz;
      v *= 1 - Math.min(1, dt * 2);
    } else {
      if (Math.abs(v) > 1.5 && bumpCool < 0) { onBump?.(Math.abs(v)); bumpCool = 2; }
      v = -v * 0.2;
      state.travelYaw = state.yaw;
    }
    state.speed = v;
    placeModel(dt);
  }

  const eyeLocal = new THREE.Vector3(-0.5, DECK + 0.55 + 0.72, -1.15);
  const dockDist = () => Math.hypot(pos.x - DOCK.x, pos.y - DOCK.z);
  return {
    group,
    body,
    state,
    steering,
    kind: 'cruiser',
    silent: false,
    place() {},
    update,
    /** 乗っていないとき（world.js から）：つないでおく所で、ゆらゆら */
    idle(dt) {
      if (riding) return;
      if (phase !== 'docked') { phase = 'docked'; toDock(); }
      placeModel(dt);
    },
    board() { riding = true; toDock(); phase = 'boarding'; wait = 0; },
    leave() { riding = false; phase = 'docked'; toDock(); },
    /** 目（操縦席の右。船の上下の揺れは半分だけ。傾きは入れない） */
    eye(out = new THREE.Vector3()) {
      const yaw = state.yaw;
      const c = Math.cos(yaw);
      const sn = Math.sin(yaw);
      // 船のローカル（横 x・前 z）を、向きだけ回してワールドへ
      out.set(pos.x + eyeLocal.x * c + eyeLocal.z * sn, SEA_LEVEL + eyeLocal.y + bob * 0.5, pos.y - eyeLocal.x * sn + eyeLocal.z * c);
      return out;
    },
    /** PC の後ろからの視点（C） */
    chase(camera) {
      const fx = Math.sin(state.travelYaw);
      const fz = Math.cos(state.travelYaw);
      camera.position.set(pos.x - fx * 15, SEA_LEVEL + 6.5, pos.y - fz * 15);
      camera.lookAt(pos.x + fx * 6, SEA_LEVEL + 1.5, pos.y + fz * 6);
    },
    /** VR：舵輪を両手で握って回す（a, b は body のローカル。右手が下がると右へ切る） */
    steerFromHands(a, b) {
      const c = wheel.position;
      // body は船のローカルの (0, 1.0, 0.8) にある
      const cx = c.x;
      const cy = c.y - 1.0;
      const cz = c.z - 0.8;
      const near = (p) => Math.hypot(p.x - cx, p.y - cy, p.z - cz) < 0.45;
      if (!near(a) || !near(b)) return null;
      const [l, r] = a.x > b.x ? [a, b] : [b, a];
      const angle = Math.atan2(r.y - l.y, l.x - r.x);
      return { steer: THREE.MathUtils.clamp(angle / (Math.PI / 2), -1, 1), angle: THREE.MathUtils.radToDeg(angle) };
    },
    /** 乗り口（kartdrive.js の E）：つないであるとき、T 字の北の縁のうち from にいちばん近い所 */
    enterPoint(from, out = new THREE.Vector3()) {
      if (phase !== 'docked') return out.set(1e6, 0, 1e6);
      return out.set(THREE.MathUtils.clamp(from.x, DOCK.x - 4.5, DOCK.x + 4.5), PIER.y, PIER.toZ + 0.3);
    },
    /** 降りる所（T 字の上、船の横） */
    side(out = new THREE.Vector3()) { return out.set(DOCK.x - 2.2, PIER.y, PIER.toZ + 0.7); },
    girlPivot,
    /** 女の子が乗り込む所（T 字の上） */
    girlBoard(out = new THREE.Vector3()) { return out.set(DOCK.x - 0.9, PIER.y, PIER.toZ + 0.5); },
    get rpm01() { return 0.18 + Math.min(1, Math.abs(v) / CRUISE) * 0.45; },
    get speed() { return v; },
    get turnRate() { return rate; },
    get phase() { return phase; },
    get riding() { return riding; },
    /** 桟橋のそば（降りても暗くしなくてよい所）にいるか */
    get atDock() { return dockDist() < 12 && Math.abs(v) < 1.5; },
    /** 桟橋からの距離（m） */
    get dockDistance() { return dockDist(); },
    set girlSeated(x) { girlSeated = Boolean(x); },
    set girlComing(x) { girlComing = Boolean(x); },
    set onBump(fn) { onBump = fn; },
    /** 近いもの（女の子の声）：灯台・島までの距離 */
    get nearLighthouse() { return Math.hypot(pos.x - 150, pos.y + 230) < 70; },
    get nearIsland() { return Math.hypot(pos.x + 260, pos.y + 520) < 230; },
    boat,
    /** 試験用：いる所と向きを入れる */
    debugPlace(x, z, yaw) { pos.set(x, z); state.yaw = state.travelYaw = yaw; v = 0; state.speed = 0; placeModel(0); },
  };
}
