import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { CIRCUIT, circuitNearest, circuitFrame, CIRCUIT_LENGTH } from './circuit.js';
import { createCircuitMap } from './circuitmap.js';

/**
 * GT3 のレースカー（乗り物の窓口。kartdrive.js の乗り降り・VR の目線合わせ・視点・ハンコン・FFB を使う）。
 *
 * 6 速のシーケンシャル。AT（自動で変速）と MT（手動）を切り替えられる（Q・パッドの十字キー上・
 * VR の右スティックの押し込み・ハンコンに割り当てたボタン。選んだほうは localStorage に覚える）。
 * AT のままシフト（パドル・X / Z・パッドの RB / LB・VR の A / B）を使うと MT になる。
 * R（バック）は、止まって 1 速からシフトダウン。R ではアクセルで後ろへ、シフトアップで 1 速へ。エンジンは回転数からトルクを出し、ギア比で駆動力にする。
 * 空気の抵抗とダウンフォース（速いほど曲がれる・止まれる）、縁石・芝（はみ出すとすべる）、外の防護壁。
 * 路面の高さはコース上の位置から（立体交差の橋）。
 *
 * 屋根のある車なので、女の子も乗って運転できる（スカートが見えない）。女の子の車は、同じ模型を
 * gt3race.js がコースの上に置いて動かす（followTrack）。
 *
 * 模型は +Z が前、原点は車の真ん中の地面。左ハンドル（運転席はローカル +X の側）。
 */
export const GT3 = {
  mass: 1300,
  wheelBase: 2.7,
  wheelRadius: 0.34,
  // 6 速のレッドラインで 250km/h（1 速 84・2 速 115・3 速 146・4 速 177・5 速 212 km/h）。コースの直線で 5・6 速まで使う
  ratios: [3.9, 2.85, 2.25, 1.85, 1.55, 1.32],
  finalDrive: 3.45,
  idle: 1100,
  redline: 8800,
  maxSpeed: 75,
  mu: 1.45,
};
const SEAT = new THREE.Vector3(0.38, 0.3, -0.3);
/**
 * ルームミラー（車のローカル）。運転席の目（SEAT.x, 1.12, SEAT.z - 0.05）から左へ 22°・上へ 10° ほど。
 * 屋根の前の端（z 0.075）より前で、フロントガラス（z 0.725）より内側。道の見える所（水平線より下）にはかからない
 */
const MIRROR = { x: 0.02, y: 1.29, z: 0.56, w: 0.27, h: 0.078 };

function numberTexture(text, color) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = '#ffffff';
  x.beginPath(); x.arc(64, 64, 58, 0, Math.PI * 2); x.fill();
  x.fillStyle = color;
  x.font = 'bold 76px sans-serif';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText(text, 64, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 車の模型（プレイヤーの車・女の子の車で共通） */
const AUTO_KEY = 'vrsample.gt3.gearbox';
/** 前に選んだ AT / MT（はじめは AT） */
function savedAuto() {
  try { return localStorage.getItem(AUTO_KEY) !== 'mt'; } catch { return true; }
}

export function createGT3Model({ color = 0x2a5ad8, accent = 0xffffff, number = '7' } = {}) {
  const root = new THREE.Group();
  const body = new THREE.Group();   // 揺れ（前後・左右の傾き）はここ
  root.add(body);
  const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.25, metalness: 0.5 });
  const stripe = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.3, metalness: 0.3 });
  const carbon = new THREE.MeshStandardMaterial({ color: 0x1b1c20, roughness: 0.5, metalness: 0.3 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x223040, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.35, depthWrite: false });
  const shade = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };

  const lower = shade(new THREE.Mesh(new RoundedBoxGeometry(2.0, 0.62, 4.6, 3, 0.22), paint));
  lower.position.set(0, 0.5, 0);
  body.add(lower);
  // ボンネットの段（前へ下がる）とトランク
  const hood = shade(new THREE.Mesh(new RoundedBoxGeometry(1.8, 0.25, 1.5, 3, 0.1), paint));
  hood.position.set(0, 0.78, 1.35);
  hood.rotation.x = 0.08;
  body.add(hood);
  const deck = shade(new THREE.Mesh(new RoundedBoxGeometry(1.85, 0.25, 1.1, 3, 0.1), paint));
  deck.position.set(0, 0.82, -1.65);
  body.add(deck);
  // 室内：床・シート・ハンドル
  const floor = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.05, 2.0), carbon);
  floor.position.set(0, 0.32, -0.2);
  body.add(floor);
  const seat = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.7, 0.55, 2, 0.08), carbon);
  seat.position.set(SEAT.x, 0.62, SEAT.z - 0.25);
  seat.rotation.x = -0.25;
  body.add(seat);
  const steering = new THREE.Group();
  steering.position.set(SEAT.x, 0.92, 0.25);
  steering.rotation.x = -1.0;
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.022, 8, 24), carbon);
  steering.add(wheel);
  const hub = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.08, 0.04), carbon);
  steering.add(hub);
  body.add(steering);
  // 屋根の枠（A ピラー・屋根・B ピラー）と、ガラスの箱
  const cabin = new THREE.Mesh(new RoundedBoxGeometry(1.55, 0.6, 2.05, 3, 0.18), glass);
  cabin.position.set(0, 1.08, -0.3);
  body.add(cabin);
  const roof = shade(new THREE.Mesh(new RoundedBoxGeometry(1.35, 0.06, 1.05, 2, 0.03), paint));
  roof.position.set(0, 1.38, -0.45);
  body.add(roof);
  for (const side of [-1, 1]) {
    // A ピラーは細く、ガラスの箱の角に（太いと運転席から視界の真ん中へ入ってきた）
    const aPillar = shade(new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, 0.72), paint));
    aPillar.position.set(side * 0.76, 1.1, 0.5);
    aPillar.rotation.x = 0.78;
    body.add(aPillar);
    const cPillar = shade(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.55, 0.5), paint));
    cPillar.position.set(side * 0.72, 1.08, -1.12);
    cPillar.rotation.x = -0.5;
    body.add(cPillar);
    // 屋根の上の白いライン・ドアのゼッケン
    const num = new THREE.Mesh(new THREE.CircleGeometry(0.28, 20), new THREE.MeshStandardMaterial({ map: numberTexture(number, '#1a1a22'), roughness: 0.5 }));
    num.position.set(side * 1.005, 0.55, -0.1);
    num.rotation.y = side * Math.PI / 2;
    body.add(num);
  }
  const hoodStripe = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.01, 1.45), stripe);
  hoodStripe.position.set(0, 0.915, 1.36);
  hoodStripe.rotation.x = 0.08;
  body.add(hoodStripe);
  // 前のスプリッターと、後ろのウイング
  const splitter = shade(new THREE.Mesh(new THREE.BoxGeometry(2.05, 0.05, 0.4), carbon));
  splitter.position.set(0, 0.2, 2.25);
  body.add(splitter);
  const wing = shade(new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.05, 0.38), carbon));
  wing.position.set(0, 1.3, -2.15);
  wing.rotation.x = -0.12;
  body.add(wing);
  for (const side of [-1, 1]) {
    const stay = shade(new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.4, 0.2), carbon));
    stay.position.set(side * 0.55, 1.1, -2.1);
    body.add(stay);
    const plate = shade(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.3, 0.45), carbon));
    plate.position.set(side * 0.95, 1.28, -2.15);
    body.add(plate);
  }
  // 灯火
  const lightMat = new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xfff0c0, emissiveIntensity: 0.8 });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0xff3020, emissive: 0xff2010, emissiveIntensity: 0.4 });
  for (const side of [-1, 1]) {
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.1, 0.05), lightMat);
    head.position.set(side * 0.62, 0.72, 2.3);
    head.rotation.x = 0.3;
    body.add(head);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.04), tailMat);
    tail.position.set(side * 0.62, 0.78, -2.31);
    body.add(tail);
  }
  // 車輪（前の 2 つはハンドルで切れる）
  const tire = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.85 });
  const rim = new THREE.MeshStandardMaterial({ color: 0xb8bcc4, roughness: 0.3, metalness: 0.9 });
  const wheels = [];
  for (const [x, z] of [[0.88, 1.45], [-0.88, 1.45], [0.88, -1.45], [-0.88, -1.45]]) {
    const hold = new THREE.Group();
    hold.position.set(x, GT3.wheelRadius, z);
    root.add(hold);
    const spin = new THREE.Group();
    hold.add(spin);
    const t = shade(new THREE.Mesh(new THREE.CylinderGeometry(GT3.wheelRadius, GT3.wheelRadius, 0.3, 20), tire));
    t.rotation.z = Math.PI / 2;
    spin.add(t);
    const r = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.31, 10), rim);
    r.rotation.z = Math.PI / 2;
    spin.add(r);
    wheels.push({ hold, spin, front: z > 0 });
  }
  // ルームミラーの枠（屋根の前の端、フロントガラスの上の真ん中）。映るのはプレイヤーの車だけ（createGT3）
  const mirrorFrame = new THREE.Mesh(new RoundedBoxGeometry(MIRROR.w + 0.03, MIRROR.h + 0.03, 0.03, 2, 0.012), carbon);
  mirrorFrame.position.set(MIRROR.x, MIRROR.y, MIRROR.z + 0.02);
  mirrorFrame.lookAt(SEAT.x, 1.12, SEAT.z - 0.05);
  body.add(mirrorFrame);
  const mirrorStay = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.07, 0.02), carbon);
  mirrorStay.position.set(MIRROR.x, MIRROR.y + 0.06, MIRROR.z + 0.03);
  body.add(mirrorStay);
  // メーター（ハンドルの奥）。gt3.js の update が描く
  const dashCanvas = document.createElement('canvas');
  dashCanvas.width = 256;
  dashCanvas.height = 128;
  const dashTex = new THREE.CanvasTexture(dashCanvas);
  dashTex.colorSpace = THREE.SRGBColorSpace;
  const dash = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.12), new THREE.MeshBasicMaterial({ map: dashTex, toneMapped: false }));
  // 車の真ん中（センターコンソール）の上段。運転席から見た前の道の外で、ボンネットの線より下。
  // ハンドルの奥に置くと、目の 6cm 下・85cm 先で道の真ん中が隠れ、下げるとハンドルの輪と車体に隠れた
  dash.position.set(SEAT.x - 0.34, 0.945, 0.45);
  body.add(dash);
  dash.lookAt(SEAT.x, 1.12, SEAT.z - 0.05);
  // コースの地図（メーターの下）。VR でも目を少し左下へ向ければ見える
  const mapCanvas = document.createElement('canvas');
  mapCanvas.width = 256;
  mapCanvas.height = 192;
  const mapTex = new THREE.CanvasTexture(mapCanvas);
  mapTex.colorSpace = THREE.SRGBColorSpace;
  // ミップマップを使うと、少し離れただけで細い線がにじんで消える
  mapTex.generateMipmaps = false;
  mapTex.minFilter = THREE.LinearFilter;
  const mapPlane = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.15), new THREE.MeshBasicMaterial({ map: mapTex, toneMapped: false }));
  // その下（センターコンソールの下段）
  mapPlane.position.set(SEAT.x - 0.36, 0.83, 0.41);
  body.add(mapPlane);
  mapPlane.lookAt(SEAT.x, 1.12, SEAT.z - 0.05);
  return { root, body, steering, wheels, dash, dashCanvas, dashTex, tailMat, mapPlane, mapCanvas, mapTex, mirrorFrame };
}

/**
 * プレイヤーの GT3。
 * @param {{ park: { x: number, z: number, yaw: number } }} options park は丘の上に飾っておく所
 */
export function createGT3({ park, color = 0x2a5ad8, number = '7' } = {}) {
  const group = new THREE.Group();
  group.name = 'gt3';
  const model = createGT3Model({ color, number });
  group.add(model.root);
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.1, 1.4, 4.7), new THREE.MeshBasicMaterial({ visible: false }));
  body.position.y = 0.7;
  group.add(body);

  const state = {
    speed: 0, yaw: park.yaw, travelYaw: park.yaw, steer: 0, onGrass: false, lateral: 0, u: 0,
    gear: 1, rpm: GT3.idle, auto: savedAuto(), s: 0, atCircuit: false, reverse: false,
  };
  let shiftCut = 0;
  let pitch = 0;
  let roll = 0;
  let dashIn = 0;
  let mapIn = 0;
  let mapCars = [];
  const circuitMap = createCircuitMap();
  let lastLateralAcc = 0;
  const hud = { lap: '', pos: '' };

  function place(x, z, yaw, y = 0) {
    group.position.set(x, y, z);
    state.yaw = state.travelYaw = yaw;
    state.speed = 0;
    state.gear = 1;
    state.rpm = GT3.idle;
    group.rotation.set(0, yaw, 0);
  }
  place(park.x, park.z, park.yaw, park.y ?? 0);

  /** サーキットのグリッドへ（s の位置、横 lateral） */
  function placeOnCircuit(s, lateral) {
    const f = circuitFrame(s);
    place(f.p.x + f.n.x * lateral, f.p.z + f.n.z * lateral, Math.atan2(f.t.x, f.t.z), f.p.y);
    state.s = s;
    state.atCircuit = true;
  }
  function parkAtHome() {
    place(park.x, park.z, park.yaw, park.y ?? 0);
    state.atCircuit = false;
  }

  const torque = (rpm) => 470 * Math.max(0.5, 1 - ((rpm - 6600) / 6000) ** 2);
  const wheelRpm = (v, gear) => (Math.abs(v) / GT3.wheelRadius) * GT3.ratios[gear - 1] * GT3.finalDrive * (60 / (Math.PI * 2));

  function shift(dir) {
    const next = THREE.MathUtils.clamp(state.gear + dir, 1, 6);
    if (next === state.gear) return;
    // シフトダウンで回りすぎるなら入れない（エンジンを守る）
    if (dir < 0 && wheelRpm(state.speed, next) > GT3.redline + 200) return;
    state.gear = next;
    shiftCut = 0.12;
  }

  let locked = false;
  function update(dt, input = {}) {
    if (!state.atCircuit) return;
    // スタートの合図のあいだは動かない（ブレーキを踏んだまま）
    const { steer = 0, shift: shiftReq = 0 } = input;
    const throttle = locked ? 0 : input.throttle ?? 0;
    const brake = locked ? 1 : input.brake ?? 0;
    const m = GT3.mass;
    let v = state.speed;
    // シフト
    // AT / MT の切り替え（選んだほうを覚えておき、次に乗ったときもそのまま）
    if (input.toggleAuto) {
      state.auto = !state.auto;
      try { localStorage.setItem(AUTO_KEY, state.auto ? 'at' : 'mt'); } catch { /* 保存できなくても遊べる */ }
    }
    // R（バック）：止まっているときに 1 速からシフトダウンで入り、シフトアップで 1 速へ戻る。
    // （「止まってブレーキを 0.8 秒踏み続けても R」にしていたら、スタートの合図のあいだブレーキを
    // 踏んでいたハンコンの人が、合図のあと R に入っていて、アクセルを踏んでも前へ出なかった。やめた）
    const stopped = Math.abs(v) < 0.4;
    if (shiftReq < 0 && !locked && stopped && state.gear === 1 && !state.reverse) state.reverse = true;
    else if (shiftReq > 0 && state.reverse) { if (stopped) state.reverse = false; }
    // AT のままパドルを使うと MT になる（AT に戻すのは切り替えのボタン）
    else if (shiftReq) { state.auto = false; shift(Math.sign(shiftReq)); }
    if (state.auto && !state.reverse) {
      if (state.rpm > 8300 && state.gear < 6) shift(1);
      else if (state.rpm < 3900 && state.gear > 1) shift(-1);
    }
    shiftCut = Math.max(0, shiftCut - dt);
    // スタートの合図のあいだはブレーキを踏んだことにしているので、バックには入れない
    if (locked) state.reverse = false;

    // エンジンの回転数（1 速の発進は半クラッチで回しておく）
    const fromWheels = wheelRpm(v, state.gear);
    state.rpm = Math.max(fromWheels, state.gear === 1 && !state.reverse ? GT3.idle + throttle * 3800 * Math.max(0, 1 - v / 12) : GT3.idle);
    state.rpm = Math.min(state.rpm, GT3.redline + 100);
    const limiter = state.rpm >= GT3.redline;

    // 前へ押す力：タイヤが空回りしない上限（後ろのタイヤの荷重ぶん）
    const downforce = 0.5 * 1.2 * 2.4 * v * v;
    const grip = GT3.mu * (m * 9.8 + downforce);
    let drive = 0;
    // R ではアクセルで後ろへ（前は、アクセルを踏むと R が抜けて前へ出てしまい、バックできなかった）
    if (state.reverse) drive = -throttle * 5200;
    else if (!limiter && shiftCut <= 0) drive = (throttle * torque(state.rpm) * GT3.ratios[state.gear - 1] * GT3.finalDrive * 0.9) / GT3.wheelRadius;
    drive = THREE.MathUtils.clamp(drive, -grip * 0.3, grip * 0.55);
    const drag = 0.5 * 1.2 * 0.9 * v * Math.abs(v) + 180 * Math.sign(v);
    const braking = brake * grip * 0.95 * Math.sign(v);
    let a = (drive - drag - braking) / m;

    // 芝に出るとすべって遅くなる
    const near = circuitNearest(group.position.x, group.position.z, state.s);
    state.s = near.s;
    state.u = near.s / CIRCUIT_LENGTH;
    state.lateral = near.lateral;
    const W = CIRCUIT.width / 2;
    state.onGrass = Math.abs(near.lateral) > W + CIRCUIT.curb;
    if (state.onGrass) a -= 0.9 * v * 0.25 + Math.sign(v) * 1.5;
    v += a * dt;
    // 前進のギアでは後ろへ、R では前へは転がらない（ブレーキや抵抗で 0 を越えないように）
    if (!state.reverse && v < 0) v = Math.max(v, 0);
    if (state.reverse) v = THREE.MathUtils.clamp(v, -8, 0);

    // 曲がる：ハンドルの切れ角は速いほど小さく（ハンコンでは切った角度そのまま）
    const maxSteer = input.kind === 'wheel' ? 0.42 : 0.5 / (1 + Math.abs(v) / 18);
    const delta = steer * maxSteer;
    let yawRate = (v * Math.tan(delta)) / GT3.wheelBase;
    const latMax = (grip / m) * (state.onGrass ? 0.55 : 1);
    if (Math.abs(v * yawRate) > latMax) yawRate = (Math.sign(yawRate) * latMax) / Math.max(1, Math.abs(v));
    lastLateralAcc = v * yawRate;
    state.steer = steer;
    state.yaw += yawRate * dt;
    state.travelYaw = state.yaw;
    group.position.x += Math.sin(state.yaw) * v * dt;
    group.position.z += Math.cos(state.yaw) * v * dt;

    // 防護壁（橋の上は、路面の縁の壁）
    const after = circuitNearest(group.position.x, group.position.z, state.s);
    const onBridge = after.y - CIRCUIT.origin.y > 0.3;
    const limit = onBridge ? W + 0.6 : CIRCUIT.wall - 1.2;
    if (Math.abs(after.lateral) > limit) {
      const f = circuitFrame(after.s);
      const back = Math.abs(after.lateral) - limit;
      group.position.x -= f.n.x * Math.sign(after.lateral) * back;
      group.position.z -= f.n.z * Math.sign(after.lateral) * back;
      // 壁に沿う向きへ少し寄せ、速さを落とす
      const along = Math.atan2(f.t.x, f.t.z);
      state.yaw += Math.atan2(Math.sin(along - state.yaw), Math.cos(along - state.yaw)) * 0.3;
      v *= 0.55;
    }
    state.speed = v;
    // 高さ：コースの上は路面、外は平らな地面（橋の上からは外へ出られない）
    const targetY = Math.abs(after.lateral) < W + CIRCUIT.curb + 0.5 || onBridge ? after.y : CIRCUIT.origin.y;
    const prevY = group.position.y;
    group.position.y += (targetY - group.position.y) * Math.min(1, dt * 12);
    // 傾き：坂の前後・加減速で前後、曲がるときに外へ
    const slope = Math.abs(v) > 0.5 ? Math.atan2(group.position.y - prevY, Math.abs(v) * dt) : 0;
    pitch += ((-slope - a * 0.004) - pitch) * Math.min(1, dt * 6);
    roll += ((-lastLateralAcc * 0.004) - roll) * Math.min(1, dt * 6);
    group.rotation.set(0, state.yaw, 0);
    model.body.rotation.set(pitch, 0, roll);
    // 車輪
    for (const w of model.wheels) {
      w.spin.rotation.x += (v / GT3.wheelRadius) * dt;
      if (w.front) w.hold.rotation.y = delta;
    }
    model.steering.rotation.z = -steer * (input.kind === 'wheel' ? 1.6 : 1.2);
    model.tailMat.emissiveIntensity = brake > 0.1 ? 2.5 : 0.4;
    dashIn -= dt;
    if (dashIn < 0) { drawDash(); dashIn = 0.1; }
    mapIn -= dt;
    if (mapIn < 0 && state.atCircuit) { drawMap(); mapIn = 0.2; }
  }

  /** 車内のコースの地図。自分は青、ほかの車（レースの相手）は setMapCars で */
  function drawMap() {
    const c = model.mapCanvas.getContext('2d');
    c.fillStyle = '#0b0d12';
    c.fillRect(0, 0, 256, 192);
    circuitMap.draw(c, 0, 0, 256, 192, [...mapCars, { s: state.s, color: '#3a8aff', me: true }]);
    model.mapTex.needsUpdate = true;
  }

  function drawDash() {
    const c = model.dashCanvas.getContext('2d');
    c.fillStyle = '#0b0d12';
    c.fillRect(0, 0, 256, 128);
    // 回転数の LED（8000 を超えたら赤）
    const k = (state.rpm - GT3.idle) / (GT3.redline - GT3.idle);
    for (let i = 0; i < 12; i++) {
      const on = k > i / 12;
      c.fillStyle = on ? (i < 7 ? '#3fdc5a' : i < 10 ? '#ffc830' : '#ff3a2a') : '#242833';
      c.fillRect(10 + i * 20, 6, 16, 12);
    }
    c.fillStyle = '#fff';
    c.textAlign = 'center';
    c.font = 'bold 64px sans-serif';
    c.fillText(state.reverse ? 'R' : String(state.gear), 128, 86);
    c.font = 'bold 26px sans-serif';
    c.textAlign = 'left';
    c.fillText(`${Math.round(Math.abs(state.speed) * 3.6)}`, 12, 70);
    c.font = '14px sans-serif';
    c.fillText('km/h', 12, 88);
    c.fillText(state.auto ? 'AT' : 'MT', 12, 116);
    c.textAlign = 'right';
    c.font = 'bold 18px sans-serif';
    c.fillText(hud.lap, 248, 62);
    c.fillText(hud.pos, 248, 88);
    model.dashTex.needsUpdate = true;
  }
  drawDash();

  const eyeLocal = new THREE.Vector3(SEAT.x, 1.12, SEAT.z - 0.05);
  const tmp = new THREE.Vector3();

  // --- ルームミラー ---
  // 後ろ向きのカメラで小さな画面に描いて、ミラーの面に左右を反転して貼る（鏡に映ったように）。
  // 自分の車は描かない（ウイングが真ん中を横切って、後ろの車が隠れる）。後ろを映すカメラのようなもの
  const mirrorTarget = new THREE.WebGLRenderTarget(384, 112, { samples: 0 });
  mirrorTarget.texture.colorSpace = THREE.LinearSRGBColorSpace;
  mirrorTarget.texture.wrapS = THREE.RepeatWrapping;
  mirrorTarget.texture.repeat.x = -1;
  mirrorTarget.texture.offset.x = 1;
  const mirror = new THREE.Mesh(new THREE.PlaneGeometry(MIRROR.w, MIRROR.h), new THREE.MeshBasicMaterial({ map: mirrorTarget.texture, color: 0xd8dde4 }));
  mirror.name = 'gt3-mirror';
  mirror.position.set(MIRROR.x, MIRROR.y, MIRROR.z);
  model.body.add(mirror);
  // 向きは枠と同じに（lookAt はワールドの点を取るので、置き場所へ動かした後の車では使えない）
  mirror.quaternion.copy(model.mirrorFrame.quaternion);
  mirror.visible = false;   // 乗って運転席から見ているときだけ（renderMirror）
  // far は天球（半径 2600）より外。手前で切ると空が真っ黒になる
  const mirrorCam = new THREE.PerspectiveCamera(13, MIRROR.w / MIRROR.h, 0.3, 3000);
  mirrorCam.position.set(MIRROR.x, MIRROR.y, MIRROR.z);
  // 真後ろの少し下を見る（車のローカルで向きを決める）
  mirrorCam.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(mirrorCam.position, new THREE.Vector3(MIRROR.x, 0.95, -15), new THREE.Vector3(0, 1, 0)));
  model.body.add(mirrorCam);
  let mirrorFrame = 0;

  /**
   * ミラーを描く（main.js の描画の前。運転席から見ているときだけ呼ぶ）。重いので 2 フレームに 1 回。
   * three.js の Reflector と同じく、VR（xr.enabled）と影の更新を一時的に止めて、別の描き先へ描く
   */
  function renderMirror(renderer, scene) {
    mirror.visible = true;
    if ((mirrorFrame++ & 1) === 1) return;
    const prevTarget = renderer.getRenderTarget();
    const prevXr = renderer.xr.enabled;
    const prevShadow = renderer.shadowMap.autoUpdate;
    renderer.xr.enabled = false;
    renderer.shadowMap.autoUpdate = false;
    group.visible = false;
    group.updateMatrixWorld(true);
    renderer.setRenderTarget(mirrorTarget);
    renderer.state.buffers.depth.setMask(true);
    if (renderer.autoClear === false) renderer.clear();
    renderer.render(scene, mirrorCam);
    group.visible = true;
    renderer.xr.enabled = prevXr;
    renderer.shadowMap.autoUpdate = prevShadow;
    renderer.setRenderTarget(prevTarget);
  }
  /** 運転席から見ていないとき（降りた・追いかけ視点）は、ミラーの面を隠す（古い絵が残らないように） */
  function hideMirror() { mirror.visible = false; }
  return {
    group,
    body,
    state,
    steering: model.steering,
    model,
    kind: 'gt3',
    place,
    placeOnCircuit,
    parkAtHome,
    update,
    /** 追いかける視点は、長い車なので遠めに */
    chaseBack: 7.5,
    chaseUp: 2.6,
    eye(out = new THREE.Vector3()) {
      group.updateMatrixWorld(true);
      return group.localToWorld(out.copy(eyeLocal));
    },
    /** 降りる所：サーキットからは丘の上の、飾っておく所の横へ戻る（world.js が車も戻す） */
    side(out = new THREE.Vector3()) {
      return out.set(park.x + Math.cos(park.yaw) * 1.8, 0, park.z - Math.sin(park.yaw) * 1.8);
    },
    get speed() { return state.speed; },
    /** エンジンの音の高さ（0〜1） */
    get rpm01() { return THREE.MathUtils.clamp((state.rpm - GT3.idle) / (GT3.redline - GT3.idle), 0, 1); },
    setAuto(v) { state.auto = Boolean(v); },
    set locked(v) { locked = Boolean(v); },
    get locked() { return locked; },
    /** メーターの周回・順位（gt3race.js から） */
    setHud(lap, pos) { hud.lap = lap; hud.pos = pos; },
    /** 地図に出すほかの車 [{ s, color }] */
    setMapCars(list) { mapCars = list ?? []; },
    /** コースの地図（PC の画面の表示でも同じものを使う） */
    circuitMap,
    renderMirror,
    /** ミラーの描き先（テスト用） */
    mirrorTarget,
    hideMirror,
    mirror,
  };
}

export { SEAT as GT3_SEAT };
