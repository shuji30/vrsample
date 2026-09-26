import * as THREE from 'three';
import { SEA_LEVEL, hillHeight } from './hill.js';
import { PIER, makeWake } from './cruiser.js';

/**
 * ジェットスキー。桟橋の本体の西の横に、西（沖）を向けてつないである。
 *
 * 乗り物の窓口（kartdrive.js）。桟橋の西の縁で E / ジェットスキーへトリガーで乗る。自分で運転する：
 * PC は W / S / A / D（ゲームパッド・ハンコンも）、VR は右トリガーでアクセル・左トリガーで減速（後ろへ）、
 * ハンドルバーを両手で握って回す（握っていないときは左スティック）。
 * 女の子は後ろの席に横乗り（両脚を左へそろえる。乗馬と同じくスカートの中が見えないように）。女の子が乗るまでは
 * 動かない（来ないときは 40 秒で動けるようにする）。
 *
 * 海の上だけを走る：浅瀬（水深 0.35m より浅い）・岩場・桟橋・クルーザー・灯台の岩・島にはぶつかって跳ね返る。
 * 沖は灯台と島のまわりまで（中心から 800m）。
 *
 * VR 酔いにくいように、リグは向きだけ回す（曲がるときの車体の傾き・波の上下は、目には入れない）。
 * PC は C で後ろからの視点。
 */
const DOCK = { x: 25.0, z: -106, yaw: -Math.PI / 2 };
const MAX = 20;           // 最高速（m/s。72km/h）
const ACC = 9;
const REVERSE = 2.5;
const SEAT_TOP = 0.84;    // 席の上の高さ（喫水線から）
/** 灯台の岩（hill.js）と島（hill.js の円すい。すそは 1.35 倍に広がり、南北は 0.7 倍） */
const ROCKS = [{ x: 150, z: -230, r: 12 }];
const ISLANDS = [[-260, -520, 70], [340, -760, 110], [-60, -900, 50]].map(([x, z, r]) => ({ x, z, rx: r * 1.35 + 3, rz: r * 1.35 * 0.7 + 3 }));
const AREA = { x: 0, z: -450, r: 800 };

/** 海の上で、走れない所か（陸・浅瀬・桟橋・灯台の岩・島・沖の果て） */
export function seaBlocked(x, z) {
  if (hillHeight(x, z) > SEA_LEVEL - 0.35) return true;
  const P = PIER;
  const m = 0.45;
  if (Math.abs(x - P.x) < P.width / 2 + m && z < P.fromZ + 1 && z > P.toZ - m) return true;
  if (x > P.headMinX - m && x < P.headMaxX + m && z < P.headZ + m && z > P.toZ - m) return true;
  for (const r of ROCKS) if (Math.hypot(x - r.x, z - r.z) < r.r) return true;
  for (const i of ISLANDS) if (((x - i.x) / i.rx) ** 2 + ((z - i.z) / i.rz) ** 2 < 1) return true;
  return Math.hypot(x - AREA.x, z - AREA.z) > AREA.r;
}

function makeModel() {
  const g = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.35 });
  const red = new THREE.MeshStandardMaterial({ color: 0xd8322c, roughness: 0.4 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x23272e, roughness: 0.6 });
  const seatMat = new THREE.MeshStandardMaterial({ color: 0x2b2f38, roughness: 0.8 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xc8ccd2, roughness: 0.3, metalness: 0.85 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x33414f, roughness: 0.05, transparent: true, opacity: 0.5, depthWrite: false });
  const shade = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };
  // 船体（上から見た形を押し出す。とがった先は +Z）
  const outline = new THREE.Shape();
  outline.moveTo(-0.5, -1.6);
  outline.lineTo(0.5, -1.6);
  outline.lineTo(0.6, -0.4);
  outline.quadraticCurveTo(0.58, 0.9, 0, 1.65);
  outline.quadraticCurveTo(-0.58, 0.9, -0.6, -0.4);
  outline.lineTo(-0.5, -1.6);
  const hullGeo = (from, to, scale = 1) => {
    const geo = new THREE.ExtrudeGeometry(outline, { depth: to - from, bevelEnabled: false, curveSegments: 10 });
    geo.rotateX(Math.PI / 2);
    geo.translate(0, to, 0);
    geo.scale(scale, 1, scale);
    return geo;
  };
  g.add(shade(new THREE.Mesh(hullGeo(-0.2, 0.2, 0.92), dark)));
  g.add(shade(new THREE.Mesh(hullGeo(0.2, 0.34), red)));
  g.add(shade(new THREE.Mesh(hullGeo(0.34, 0.5, 0.97), white)));
  // 足を置く所（船体の上の両わきの低い床）
  const deckGeo = new THREE.ShapeGeometry(outline, 8);
  deckGeo.rotateX(Math.PI / 2);
  const deck = new THREE.Mesh(deckGeo, new THREE.MeshStandardMaterial({ color: 0x3a3f48, roughness: 0.9, side: THREE.DoubleSide }));
  deck.position.y = 0.505;
  deck.scale.set(0.9, 1, 0.9);
  g.add(deck);
  // 席（前後に長い一本の席。前がプレイヤー、後ろが女の子）
  const pedestal = shade(new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.28, 1.45), white));
  pedestal.position.set(0, 0.64, -0.6);
  g.add(pedestal);
  const cushion = shade(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 1.5), seatMat));
  cushion.position.set(0, SEAT_TOP - 0.04, -0.6);
  g.add(cushion);
  // 後ろの持ち手
  const grab = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.018, 6, 16, Math.PI), chrome);
  grab.position.set(0, SEAT_TOP - 0.02, -1.38);
  grab.rotation.x = -Math.PI / 2;
  g.add(grab);
  // 前の覆い（ハンドルの前）と小さな風よけ
  const cowl = shade(new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.32, 0.95), red));
  cowl.position.set(0, 0.66, 0.72);
  cowl.rotation.x = 0.12;
  g.add(cowl);
  const nose = shade(new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.18, 0.5), white));
  nose.position.set(0, 0.58, 1.25);
  nose.rotation.x = 0.3;
  g.add(nose);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.18), glass);
  screen.position.set(0, 0.9, 0.62);
  screen.rotation.x = -0.9;
  g.add(screen);
  const gauge = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.02, 0.12), dark);
  gauge.position.set(0, 0.85, 0.42);
  gauge.rotation.x = -0.5;
  g.add(gauge);
  // 後ろの噴き出し口
  const jet = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.2, 10), dark);
  jet.rotation.x = Math.PI / 2;
  jet.position.set(0, 0.05, -1.62);
  g.add(jet);
  return { g, chrome, dark };
}

export function createJetski({ blocked = () => false } = {}) {
  const group = new THREE.Group();
  group.name = 'jetski';
  // craft：位置と向きだけ（目と当たりの箱はこちら）。model：傾き・上下の揺れ
  const craft = new THREE.Group();
  group.add(craft);
  const { g: model, chrome, dark } = makeModel();
  craft.add(model);
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.3, 3.3), new THREE.MeshBasicMaterial({ visible: false }));
  body.geometry.translate(0, 0.55, 0);
  body.userData.interactive = true;
  craft.add(body);
  // ハンドルバー（VR の両手で握る。kartdrive.js の steerFromHands）
  const steering = new THREE.Group();
  steering.position.set(0, 1.02, 0.3);
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.72, 8), chrome);
  bar.rotation.z = Math.PI / 2;
  steering.add(bar);
  for (const sx of [-1, 1]) {
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.14, 8), dark);
    handle.rotation.z = Math.PI / 2;
    handle.position.x = sx * 0.3;
    steering.add(handle);
  }
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.2, 8), dark);
  post.position.set(0, -0.1, 0.03);
  steering.add(post);
  model.add(steering);
  // 女の子の席の台（後ろの席の上）
  const girlPivot = new THREE.Object3D();
  girlPivot.position.set(0, SEAT_TOP, -1.0);
  model.add(girlPivot);
  const wake = makeWake();
  group.add(wake);

  const state = { speed: 0, yaw: DOCK.yaw, travelYaw: DOCK.yaw, steer: 0, onGrass: false, lateral: 0, u: 0 };
  const pos = new THREE.Vector2(DOCK.x, DOCK.z);
  let v = 0;
  let rate = 0;
  let roll = 0;
  let pitch = 0;
  let time = 0;
  let riding = false;
  let hold = false;
  let held = 0;
  let onBump = null;
  let bumpCool = 0;
  let bob = 0;
  const eyeLocal = new THREE.Vector3(0, SEAT_TOP + 0.78, -0.3);
  const hull = [[0, 1.55], [0.5, 0.6], [-0.5, 0.6], [0, 0], [0.45, -1.5], [-0.45, -1.5]];
  const free = (x, z, yaw) => {
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    return hull.every(([r, f]) => { const px = x + fx * f + fz * r; const pz = z + fz * f - fx * r; return !seaBlocked(px, pz) && !blocked(px, pz); });
  };

  function placeModel(dt) {
    time += dt;
    const speed01 = Math.min(1, Math.abs(v) / MAX);
    bob = Math.sin(time * 2.1) * 0.035 * (1 + speed01) + Math.sin(time * 5.3 + 1) * 0.012 * speed01;
    craft.position.set(pos.x, SEA_LEVEL - 0.06 + speed01 * 0.06, pos.y);
    craft.rotation.set(0, state.yaw, 0);
    // 曲がると内へ傾き、速いと先が少し上がる
    roll += (THREE.MathUtils.clamp(-rate * v * 0.03, -0.42, 0.42) - roll) * Math.min(1, dt * 4);
    pitch += (-0.06 * speed01 - pitch) * Math.min(1, dt * 2);
    model.position.y = bob;
    model.rotation.set(pitch + Math.sin(time * 1.7) * 0.015, 0, roll + Math.sin(time * 1.3) * 0.02, 'YXZ');
    steering.rotation.y = state.steer * 0.35;
    const len = Math.min(24, Math.abs(v) * 1.5);
    wake.visible = v > 0.8;
    wake.scale.set(2.2 + v * 0.35, len, 1);
    const back = 1.6 + len / 2;
    wake.position.set(pos.x - Math.sin(state.travelYaw) * back, SEA_LEVEL + 0.03, pos.y - Math.cos(state.travelYaw) * back);
    wake.rotation.set(-Math.PI / 2, state.travelYaw, 0, 'YXZ');
    craft.updateMatrixWorld(true);
  }
  placeModel(0);

  function update(dt, input) {
    bumpCool -= dt;
    if (hold) { held += dt; if (held > 40) hold = false; }
    const throttle = hold ? 0 : input?.throttle ?? 0;
    const brake = hold ? 0 : input?.brake ?? 0;
    state.steer += ((input?.steer ?? 0) - state.steer) * Math.min(1, dt * 8);
    if (throttle > 0.02) v += throttle * ACC * (1 - Math.max(0, v) / MAX) * dt;
    if (brake > 0.02) v = Math.max(-REVERSE, v - brake * 6 * dt);
    v -= v * 0.05 * dt;
    if (throttle < 0.02 && brake < 0.02) v -= Math.sign(v) * Math.min(Math.abs(v), 1.4 * dt);
    // 向き：速いほどよく曲がる（止まっていても少しは回る）。後ろへ進むときは逆
    const grip = 0.3 + 0.7 * Math.min(1, Math.abs(v) / 4);
    rate = state.steer * (0.45 + 0.75 * Math.min(1, Math.abs(v) / 8)) * grip * (v < -0.1 ? -1 : 1);
    state.yaw += rate * dt;
    // 進む向きは少し遅れてついてくる（水の上で横へ流れる）
    let slip = state.yaw - state.travelYaw;
    slip = Math.atan2(Math.sin(slip), Math.cos(slip));
    state.travelYaw += slip * Math.min(1, dt * (1.8 + 2 * (1 - Math.min(1, Math.abs(v) / MAX))));
    const nx = pos.x + Math.sin(state.travelYaw) * v * dt;
    const nz = pos.y + Math.cos(state.travelYaw) * v * dt;
    if (free(nx, nz, state.yaw) || !free(pos.x, pos.y, state.yaw)) {
      pos.set(nx, nz);
    } else if (free(nx, pos.y, state.yaw) && Math.abs(nx - pos.x) > 1e-4) {
      // 岸や桟橋に斜めに当たったときは、沿って滑る（遅くなる）
      pos.x = nx;
      v *= 1 - Math.min(1, dt * 2.5);
    } else if (free(pos.x, nz, state.yaw) && Math.abs(nz - pos.y) > 1e-4) {
      pos.y = nz;
      v *= 1 - Math.min(1, dt * 2.5);
    } else {
      // ぶつかった：止めて、少し跳ね返す
      if (Math.abs(v) > 2 && bumpCool < 0) { onBump?.(Math.abs(v)); bumpCool = 1.5; }
      v = -v * 0.25;
      state.travelYaw = state.yaw;
    }
    state.speed = v;
    state.lateral = 0;
    placeModel(dt);
  }

  function toDock() {
    pos.set(DOCK.x, DOCK.z);
    state.yaw = state.travelYaw = DOCK.yaw;
    v = 0; rate = 0; state.steer = 0; state.speed = 0;
    placeModel(0);
  }

  return {
    group,
    body,
    state,
    steering,
    kind: 'jetski',
    silent: false,
    chaseBack: 5.5,
    chaseUp: 2.3,
    place() {},
    update,
    /** 乗っていないとき（world.js から）：つないでおく所で、ゆらゆら */
    idle(dt) { if (!riding) { v = 0; rate = 0; placeModel(dt); } },
    board() { riding = true; toDock(); hold = true; held = 0; },
    leave() { riding = false; hold = false; toDock(); },
    /** 目（前の席。車体の傾き・上下は入れない） */
    eye(out = new THREE.Vector3()) {
      craft.updateMatrixWorld(true);
      const e = craft.localToWorld(out.copy(eyeLocal));
      e.y += bob * 0.3;
      return e;
    },
    /** 乗り口（kartdrive.js の E）：桟橋の西の縁のうち、from にいちばん近い所（つないであるときだけ） */
    enterPoint(from, out = new THREE.Vector3()) {
      if (riding || pos.distanceTo(new THREE.Vector2(DOCK.x, DOCK.z)) > 1) return out.set(1e6, 0, 1e6);
      return out.set(PIER.x - PIER.width / 2 + 0.2, PIER.y, THREE.MathUtils.clamp(from.z, DOCK.z - 1.6, DOCK.z + 1.6));
    },
    /** 降りる所（桟橋の上、ジェットスキーの横） */
    side(out = new THREE.Vector3()) { return out.set(PIER.x - 0.4, PIER.y, DOCK.z + 1.4); },
    /** PC の後ろからの視点（C）：進む向きの後ろから */
    chase(camera) {
      const ty = state.travelYaw;
      const tx = Math.sin(ty);
      const tz = Math.cos(ty);
      camera.position.set(pos.x - tx * 5.5, SEA_LEVEL + 2.4, pos.y - tz * 5.5);
      camera.lookAt(pos.x + tx * 3, SEA_LEVEL + 0.8, pos.y + tz * 3);
    },
    /** VR：ハンドルバーを両手で握って回す（a, b は body のローカル。左手が前へ出ると右へ切る） */
    steerFromHands(a, b) {
      const c = steering.position;
      const near = (p) => Math.hypot(p.x - c.x, p.y - c.y, p.z - c.z) < 0.42;
      if (!near(a) || !near(b)) return null;
      const [l, r] = a.x > b.x ? [a, b] : [b, a];
      const angle = Math.atan2(l.z - r.z, l.x - r.x);
      return { steer: THREE.MathUtils.clamp(-angle / 0.5, -1, 1), angle: THREE.MathUtils.radToDeg(-angle) };
    },
    girlPivot,
    /** 女の子が乗り込む所（桟橋の上、後ろの席の横） */
    girlBoard(out = new THREE.Vector3()) { return out.set(PIER.x - 0.55, PIER.y, DOCK.z - 0.6); },
    /** 桟橋のそば（降りても暗くしなくてよい所）にいるか */
    get atDock() { return pos.distanceTo(new THREE.Vector2(DOCK.x, DOCK.z)) < 3 && Math.abs(v) < 1.5; },
    set hold(x) { hold = Boolean(x); held = 0; },
    get hold() { return hold; },
    set onBump(fn) { onBump = fn; },
    get rpm01() { return 0.2 + Math.min(1, Math.abs(v) / MAX) * 0.7; },
    get speed() { return v; },
    get turnRate() { return rate; },
    get riding() { return riding; },
    get position() { return craft.position; },
    craft,
    model,
    /** 試験用：いる所と向きを入れる */
    debugPlace(x, z, yaw) { pos.set(x, z); state.yaw = state.travelYaw = yaw; placeModel(0); },
  };
}
