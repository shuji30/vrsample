import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { hillHeight } from './hill.js';

/**
 * ジェットコースター。家の南の芝生に駅があり、コースは丘の南の斜面へ張り出す。
 *
 * 駅（東向き）→ 右へ曲がって南へ → リフト（チェーンで頂上 27m、海が見える）→ 最初の落下 → 宙返り →
 * 大きな U ターン → 起伏を 3 つ越えて北へ → 丘の上へ戻って駅。1 周およそ 1 分。
 *
 * 乗り物の窓口（kartdrive.js）。駅のホームで E / 車両へトリガーで、先頭の車両の右の席に乗る。
 * 女の子が左の席（ホームの側）に乗ったら（来ないなら 25 秒で）安全バーが下りて出発する。
 * 駅へ戻って止まると、E で降りる。降りずにいると、10 秒でもう 1 周。途中で降りたときは、暗くして駅へ戻す。
 *
 * 車両の向き：ローカル +Z が前、+Y が上、+X が左。seatQuaternion で、宙返りでは VR のリグも車両ごと回る。
 * VR 酔いが心配なら ?coaster=gentle（宙返りなし・最高 13m/s）。
 *
 * 走り：リフトはチェーンで 3.2m/s、ほかは重力（接線の傾き）と、転がりの抵抗・空気の抵抗。
 * 駅の手前でブレーキ、駅の決まった所で止まる。
 */
export const COASTER = {
  /** 駅（線路は東向き。ホームは北側） */
  station: { x: 11, z: 11, y: 0.55 },
  cars: 3,
  carGap: 2.7,
  lift: 3.2,
};
const G = 9.8;
const STEP = 0.5;             // 線路をたどる間隔（m）
const GENTLE = typeof location !== 'undefined' && new URLSearchParams(location.search).get('coaster') === 'gentle';

/** 宙返り（進む向き dir、中心の高さ、半径、横へのずれ）の点 */
function loopPoints(at, dir, radius, shift, n = 20) {
  const out = [];
  const side = new THREE.Vector3(dir.z, 0, -dir.x);   // 進む向きの左
  for (let i = 1; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const p = at.clone()
      .addScaledVector(dir, Math.sin(a) * radius)
      .add(new THREE.Vector3(0, radius - Math.cos(a) * radius, 0))
      .addScaledVector(side, shift * (i / n));
    out.push(p);
  }
  return out;
}

/** コースの制御点（とじた曲線）と、宙返りの区間（制御点の番号） */
function layout() {
  const S = COASTER.station;
  const v = (x, y, z) => new THREE.Vector3(x, y, z);
  const pts = [
    v(1, S.y, S.z), v(6, S.y, S.z), v(11, S.y, S.z), v(15.5, S.y, S.z),   // 駅（東向き）
    v(20, 0.9, 12.2), v(23.2, 1.6, 15.5), v(24.4, 2.6, 20.5),             // 右へ曲がって南へ
    v(24.5, 5.5, 25), v(24.5, 13.5, 32.5), v(24.5, 21.5, 40), v(24.5, 26.2, 45.5), // リフト
    v(24.5, 27.3, 49), v(24.5, 26.2, 52),                                  // 頂上
    v(24.5, 18, 58), v(24.5, 7, 64.5), v(24.5, 0.8, 70),                    // 最初の落下
  ];
  let loop = null;
  if (!GENTLE) {
    // 宙返り：南向きに入って、左（東）へ 3m ずれて抜ける
    const entry = v(24.5, -1.2, 76);
    const start = pts.length;
    pts.push(entry);
    pts.push(...loopPoints(entry, new THREE.Vector3(0, 0, 1), 7.5, -3));
    pts.push(v(27.5, -1.2, 77.2));
    loop = { from: start, to: pts.length - 1 };
    pts.push(v(27.8, -0.8, 84));
  } else {
    pts.push(v(25, -0.6, 78), v(26.5, -0.4, 85));
  }
  pts.push(
    v(28.5, 1.0, 93), v(27.5, 3.5, 101), v(22, 5.5, 107.5), v(13, 6.5, 110), v(5, 6.0, 105.5), v(2, 4.2, 97),  // U ターン（西へ、北へ）
    v(1.5, 0.5, 88), v(1.5, 5.5, 79), v(1.5, 0.0, 70), v(1.5, 4.0, 61), v(1.5, 0.5, 52), v(1.5, 3.0, 43),     // 起伏
    v(0.5, 2.2, 34), v(-3.5, 2.0, 26), v(-7.0, 1.6, 19.5), v(-6.5, 1.0, 14.0), v(-3.0, S.y + 0.1, 11.3),     // 丘の上へ戻って駅へ
  );
  // 地面から 1.2m は離す（駅のまわりは除く）
  for (const p of pts) {
    const g = hillHeight(p.x, p.z);
    const nearStation = Math.abs(p.z - S.z) < 1.5 && p.x > -4 && p.x < 17;
    if (!nearStation) p.y = Math.max(p.y, g + 1.2);
  }
  return { pts, loop };
}

/** 線路を STEP ごとにたどった表（位置・向き・上・宙返りか） */
function buildPath() {
  const { pts, loop } = layout();
  const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal', 0.5);
  const segs = pts.length;
  const fine = [];
  const per = 24;
  let len = 0;
  let prev = null;
  for (let i = 0; i <= segs * per; i++) {
    const t = i / (segs * per);
    const p = curve.getPoint(t % 1);
    if (prev) len += p.distanceTo(prev);
    const seg = Math.floor(t * segs) % segs;
    fine.push({ p, s: len, inLoop: Boolean(loop && seg >= loop.from - 1 && seg < loop.to + 1) });
    prev = p;
  }
  const total = len;
  const n = Math.floor(total / STEP);
  const P = [];
  const T = [];
  const U = [];
  const L = [];
  let j = 0;
  for (let i = 0; i < n; i++) {
    const s = i * STEP;
    while (j < fine.length - 2 && fine[j + 1].s < s) j++;
    const a = fine[j];
    const b = fine[j + 1];
    const k = (s - a.s) / Math.max(1e-6, b.s - a.s);
    P.push(a.p.clone().lerp(b.p, k));
    L.push(a.inLoop || b.inLoop);
  }
  for (let i = 0; i < n; i++) T.push(P[(i + 1) % n].clone().sub(P[(i - 1 + n) % n]).normalize());
  // 上の向き：宙返りの中は前の点から平行に運ぶ（内側を向き続ける）。ほかは真上から、曲がる向きに傾ける
  const up = new THREE.Vector3(0, 1, 0);
  const heading = (t) => Math.atan2(t.x, t.z);
  const bankRaw = [];
  for (let i = 0; i < n; i++) {
    const a = heading(T[(i - 4 + n) % n]);
    const b = heading(T[(i + 4) % n]);
    let d = b - a;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    const curvature = d / (STEP * 8);
    const vv = Math.max(9, 2 * G * (27.5 - P[i].y));
    const flat = 1 - Math.min(1, Math.abs(T[i].y) * 1.5);
    bankRaw.push(THREE.MathUtils.clamp(Math.atan(vv * curvature / G), -1.0, 1.0) * flat);
  }
  const S0 = COASTER.station;
  const atStation = (p) => Math.abs(p.z - S0.z) < 1.2 && p.x > -2 && p.x < 16;
  const bank = bankRaw.map((_, i) => {
    // 駅では傾けない（先のカーブの傾きが、ならしで駅まで広がっていた）
    if (atStation(P[i])) return 0;
    let sum = 0;
    for (let k = -12; k <= 12; k++) sum += bankRaw[(i + k + n) % n];
    return sum / 25;
  });
  for (let i = 0; i < n; i++) {
    const t = T[i];
    let u;
    if (L[i] && i > 0) {
      u = U[i - 1].clone().addScaledVector(t, -t.dot(U[i - 1])).normalize();
    } else {
      u = up.clone().addScaledVector(t, -t.dot(up));
      if (u.lengthSq() < 1e-4) u = U[i - 1].clone();
      u.normalize();
      // 曲がる内側へ傾ける（左へ曲がる = 見出しが増える → 上を左（+X）へ倒す）
      u.applyAxisAngle(t, -bank[i]);
    }
    U.push(u);
  }
  // 宙返りの出口で、真上からの向きへつなぐ（運んだ向きのずれをならす）
  const Q = [];
  const m = new THREE.Matrix4();
  const x = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    x.crossVectors(U[i], T[i]).normalize();
    const y = new THREE.Vector3().crossVectors(T[i], x).normalize();
    m.makeBasis(x, y, T[i]);
    Q.push(new THREE.Quaternion().setFromRotationMatrix(m));
  }
  // リフト・駅の区間（s）
  const nearest = (q) => { let best = 0; let bd = Infinity; P.forEach((p, i) => { const d = p.distanceToSquared(q); if (d < bd) { bd = d; best = i; } }); return best * STEP; };
  const S = COASTER.station;
  const zones = {
    stop: nearest(new THREE.Vector3(S.x, S.y, S.z)),
    brake: nearest(new THREE.Vector3(-6.5, 1.0, 14.0)),
    liftFrom: nearest(new THREE.Vector3(24.4, 2.6, 20.5)),
    liftTo: nearest(new THREE.Vector3(24.5, 27.3, 49)),
  };
  return { P, T, U, Q, L, total: n * STEP, n, zones };
}

function makeTrack(path) {
  const group = new THREE.Group();
  const railMat = new THREE.MeshStandardMaterial({ color: 0xd8342c, roughness: 0.4, metalness: 0.5 });
  const spineMat = new THREE.MeshStandardMaterial({ color: 0xe8e2d4, roughness: 0.5, metalness: 0.3 });
  const postMat = new THREE.MeshStandardMaterial({ color: 0xf1ede4, roughness: 0.6, metalness: 0.2 });
  const { P, U, Q, n } = path;
  const x = new THREE.Vector3();
  const offsetCurve = (dx, dy) => {
    const pts = [];
    for (let i = 0; i < n; i += 2) {
      x.set(1, 0, 0).applyQuaternion(Q[i]);
      pts.push(P[i].clone().addScaledVector(x, dx).addScaledVector(U[i], dy));
    }
    return new THREE.CatmullRomCurve3(pts, true);
  };
  const seg = Math.floor(n / 2);
  for (const dx of [-0.42, 0.42]) {
    const rail = new THREE.Mesh(new THREE.TubeGeometry(offsetCurve(dx, -0.04), seg, 0.055, 6, true), railMat);
    rail.castShadow = true;
    group.add(rail);
  }
  const spine = new THREE.Mesh(new THREE.TubeGeometry(offsetCurve(0, -0.42), seg, 0.14, 8, true), spineMat);
  spine.castShadow = true;
  group.add(spine);
  // まくら木（1.5m ごと）
  const ties = [];
  for (let i = 0; i < n; i += 3) ties.push(i);
  const tieMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.95, 0.07, 0.1), spineMat, ties.length);
  const m = new THREE.Matrix4();
  const one = new THREE.Vector3(1, 1, 1);
  ties.forEach((i, k) => {
    const p = P[i].clone().addScaledVector(U[i], -0.14);
    tieMesh.setMatrixAt(k, m.compose(p, Q[i], one));
  });
  group.add(tieMesh);
  // 支柱（6m ごと。上を向いているところだけ、地面まで）
  const posts = [];
  for (let i = 0; i < n; i += 12) {
    if (U[i].y < 0.6 || path.L[i]) continue;
    const top = P[i].clone().addScaledVector(U[i], -0.5);
    const g = hillHeight(top.x, top.z);
    const h = top.y - g;
    if (h < 0.4) continue;
    posts.push({ x: top.x, z: top.z, y: g + h / 2, h });
  }
  // 宙返りは下の 2 か所から
  const postMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 0.2, 1, 8), postMat, posts.length);
  const q0 = new THREE.Quaternion();
  posts.forEach((p, k) => postMesh.setMatrixAt(k, m.compose(new THREE.Vector3(p.x, p.y, p.z), q0, new THREE.Vector3(1, p.h, 1))));
  postMesh.castShadow = true;
  group.add(postMesh);
  return group;
}

function makeCar(color, front) {
  const g = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.3, metalness: 0.4 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1d1f26, roughness: 0.6 });
  const metal = new THREE.MeshStandardMaterial({ color: 0xc9ccd2, roughness: 0.3, metalness: 0.9 });
  const shade = (o) => { o.castShadow = true; return o; };
  const shell = shade(new THREE.Mesh(new RoundedBoxGeometry(1.35, 0.4, 2.1, 3, 0.12), paint));
  shell.position.set(0, 0.3, 0);
  g.add(shell);
  if (front) {
    // 鼻先は低く、前へ下がる形（高いと、乗った目から前の線路が隠れた）
    const nose = shade(new THREE.Mesh(new RoundedBoxGeometry(1.25, 0.28, 0.75, 3, 0.12), paint));
    nose.position.set(0, 0.26, 1.2);
    nose.rotation.x = 0.22;
    g.add(nose);
  }
  for (const sx of [-0.3, 0.3]) {
    const seat = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.1, 0.5, 2, 0.04), dark);
    seat.position.set(sx, 0.48, -0.15);
    g.add(seat);
    const back = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.75, 0.12, 2, 0.05), dark);
    back.position.set(sx, 0.85, -0.45);
    back.rotation.x = -0.12;
    g.add(back);
  }
  // 安全バー（前に倒して下ろす）
  const bar = new THREE.Group();
  bar.position.set(0, 0.62, 0.35);
  const barTube = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.15, 10), metal);
  barTube.rotation.z = Math.PI / 2;
  barTube.position.set(0, 0.28, 0);
  bar.add(barTube);
  for (const sx of [-0.55, 0.55]) {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.3, 8), metal);
    arm.position.set(sx, 0.14, 0);
    bar.add(arm);
  }
  g.add(bar);
  g.userData.bar = bar;
  // 車輪
  for (const sx of [-0.45, 0.45]) {
    for (const sz of [-0.7, 0.7]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.08, 10), metal);
      w.rotation.z = Math.PI / 2;
      w.position.set(sx, 0.02, sz);
      g.add(w);
    }
  }
  return g;
}

function makeStation() {
  const S = COASTER.station;
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0xcaa77a, roughness: 0.8 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.6 });
  const red = new THREE.MeshStandardMaterial({ color: 0xd8342c, roughness: 0.5 });
  const shade = (o) => { o.castShadow = true; o.receiveShadow = true; return o; };
  // ホーム（線路の北側。高さ 15cm）
  const deck = shade(new THREE.Mesh(new THREE.BoxGeometry(14, 0.15, 2.2), wood));
  deck.position.set(S.x - 3, 0.075, S.z - 1.75);
  g.add(deck);
  // 屋根と柱
  const roof = shade(new THREE.Mesh(new THREE.BoxGeometry(15, 0.18, 5.2), red));
  roof.position.set(S.x - 3, 3.2, S.z - 0.5);
  g.add(roof);
  for (const dx of [-9.5, -3, 3.5]) {
    for (const dz of [-2.7, 1.9]) {
      const post = shade(new THREE.Mesh(new THREE.BoxGeometry(0.16, 3.1, 0.16), white));
      post.position.set(S.x + dx, 1.55, S.z + dz);
      g.add(post);
    }
  }
  // 看板
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = '#d8342c'; x.fillRect(0, 0, 512, 128);
  x.fillStyle = '#fff'; x.font = 'bold 64px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText('ジェットコースター', 256, 68);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(4, 1), new THREE.MeshBasicMaterial({ map: tex }));
  sign.position.set(S.x - 3, 3.75, S.z - 3.05);
  sign.rotation.y = Math.PI;
  g.add(sign);
  const sign2 = sign.clone();
  sign2.rotation.y = 0;
  sign2.position.z = S.z - 3.07;
  g.add(sign2);
  return g;
}

/** 走る音：チェーンのカタカタ（リフト）と、風（速いほど大きく） */
function createCoasterSound() {
  let ctx = null;
  let wind = null;
  let windGain = null;
  let clickAt = 0;
  function ensure() {
    if (ctx) return ctx;
    if (typeof window === 'undefined') return null;
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return null;
    const AC = window.AudioContext ?? window.webkitAudioContext;
    if (!AC) return null;
    try { ctx = new AC(); } catch { return null; }
    return ctx;
  }
  function noiseBuffer(sec) {
    const b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * sec), ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  return {
    update(dt, { riding, speed, lifting }) {
      if (!riding) { if (windGain) windGain.gain.value = 0; return; }
      if (!ensure()) return;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      if (!wind) {
        wind = ctx.createBufferSource();
        wind.buffer = noiseBuffer(2);
        wind.loop = true;
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = 700;
        windGain = ctx.createGain();
        windGain.gain.value = 0;
        wind.connect(f).connect(windGain).connect(ctx.destination);
        wind.start();
      }
      windGain.gain.value = Math.min(0.35, (speed / 22) ** 2 * 0.35);
      if (lifting) {
        clickAt -= dt;
        if (clickAt <= 0) {
          clickAt = 0.16;
          const o = ctx.createBufferSource();
          o.buffer = noiseBuffer(0.03);
          const f = ctx.createBiquadFilter();
          f.type = 'bandpass';
          f.frequency.value = 1800;
          const gn = ctx.createGain();
          gn.gain.value = 0.25;
          o.connect(f).connect(gn).connect(ctx.destination);
          o.start();
        }
      }
    },
  };
}

export function createCoaster() {
  const group = new THREE.Group();
  group.name = 'coaster';
  const path = buildPath();
  group.add(makeTrack(path));
  group.add(makeStation());
  const cars = [];
  for (let i = 0; i < COASTER.cars; i++) {
    const car = makeCar([0xf2c230, 0x2a8ad8, 0xf2c230][i], i === 0);
    group.add(car);
    cars.push(car);
  }
  const front = cars[0];
  // 女の子の席の台（ここに女の子の体を付けて、車両ごと回す）
  const girlPivot = new THREE.Object3D();
  girlPivot.position.set(0.3, 0.53, -0.15);
  front.add(girlPivot);
  // 当たりの箱（VR のトリガー・PC のクリックで乗る）
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.2, 2.3), new THREE.MeshBasicMaterial({ visible: false }));
  body.position.set(0, 0.6, 0);
  body.userData.interactive = true;
  front.add(body);
  // kartdrive.js は両手がハンドルの近くにあるかを見る。遠くへ
  const steering = new THREE.Object3D();
  steering.position.y = -80;
  front.add(steering);

  const Z = path.zones;
  const state = { speed: 0, yaw: Math.PI / 2, travelYaw: Math.PI / 2, steer: 0, onGrass: false, lateral: 0, u: 0 };
  let s = Z.stop;             // 先頭の車両の位置（線路の上の長さ）
  let v = 0;
  let phase = 'parked';       // parked / boarding / running / arrived
  let wait = 0;
  let laps = 0;
  let girlSeated = false;
  let girlComing = false;
  let riding = false;
  let bar = 0;                // 安全バーの下り具合（0 上 / 1 下）
  let look = 0;
  let turned = 0;             // 出発してから進んだ長さ
  const sound = createCoasterSound();
  const tmpQ = new THREE.Quaternion();
  const tmpV = new THREE.Vector3();

  const wrap = (x) => ((x % path.total) + path.total) % path.total;
  function poseAt(sAt, outP, outQ) {
    const f = wrap(sAt) / STEP;
    const i = Math.floor(f) % path.n;
    const j = (i + 1) % path.n;
    const k = f - Math.floor(f);
    outP.lerpVectors(path.P[i], path.P[j], k);
    outQ.slerpQuaternions(path.Q[i], path.Q[j], k);
  }
  function place() {
    for (let i = 0; i < cars.length; i++) {
      poseAt(s - i * COASTER.carGap, cars[i].position, cars[i].quaternion);
      cars[i].userData.bar.rotation.x = (1 - bar) * -1.2;
    }
    const t = tmpV.set(0, 0, 1).applyQuaternion(front.quaternion);
    state.yaw = state.travelYaw = Math.atan2(t.x, t.z);
    group.updateMatrixWorld(true);
  }
  place();

  const tangentY = () => { const i = Math.floor(wrap(s) / STEP) % path.n; return path.T[i].y; };
  const inLift = () => { const w = wrap(s); return w > Z.liftFrom && w < Z.liftTo; };
  /** 駅を出てリフトまで（タイヤで押し出す） */
  const inBooster = () => { const w = wrap(s); return w >= Z.stop && w <= Z.liftFrom; };
  /** 駅までの残り（前へ進んで） */
  const toStop = () => wrap(Z.stop - s);

  function run(dt) {
    const lifting = inLift();
    if (lifting) {
      v = Math.max(COASTER.lift, v - 2 * dt);
    } else if (inBooster() && turned < 60) {
      v = Math.min(3.5, v + dt * 1.2);
    } else {
      const a = -G * tangentY() - (0.12 + 0.0009 * v * v);
      v = Math.max(1.5, v + a * dt);
      // ゆるやか（?coaster=gentle）は 13m/s で頭打ち（落下の加速はブレーキより強いので、速さを直接おさえる）
      if (GENTLE) v = Math.min(v, 13);
      // 駅の手前：ブレーキで 2m/s、決まった所で止まる
      const left = toStop();
      if (turned > 30 && left < 25) {
        if (left < 5) v = Math.max(0.35, Math.min(v, left * 0.7));
        else v = Math.min(v, Math.max(3.5, left * 0.5));
        if (left < 0.08) {
          v = 0;
          s = Z.stop;
          phase = 'arrived';
          wait = 0;
          laps++;
        }
      }
    }
    if (phase === 'running') {
      s = wrap(s + v * dt);
      turned += v * dt;
    }
    sound.update(dt, { riding, speed: v, lifting });
  }

  function update(dt, input) {
    look = THREE.MathUtils.clamp(look - (input?.steer ?? 0) * dt * 1.0, -1.4, 1.4);
    switch (phase) {
      case 'boarding':
        wait += dt;
        if ((girlSeated && wait > 2.5) || (!girlComing && wait > 3) || wait > 25) {
          phase = 'running';
          turned = 0;
          v = 0.8;
        }
        break;
      case 'running':
          run(dt);
        break;
      case 'arrived':
        wait += dt;
        sound.update(dt, { riding, speed: 0, lifting: false });
        // 降りずにいれば、もう 1 周
        if (wait > 10) { phase = 'running'; turned = 0; v = 0.8; }
        break;
      default:
        break;
    }
    const barWant = phase === 'running' || (phase === 'boarding' && wait > 1.5) ? 1 : 0;
    bar += (barWant - bar) * Math.min(1, dt * 3);
    state.speed = v;
    place();
  }

  return {
    group,
    body,
    state,
    steering,
    kind: 'coaster',
    silent: true,
    place() {},
    update,
    /** 乗っていないとき（world.js から）：駅に止めておく */
    idle(dt) {
      if (riding) return;
      if (phase !== 'parked') { phase = 'parked'; s = Z.stop; v = 0; }
      bar += (0 - bar) * Math.min(1, dt * 3);
      sound.update(dt, { riding: false, speed: 0, lifting: false });
      place();
    },
    /** 乗った（world.js から） */
    board() {
      riding = true;
      s = Z.stop;
      v = 0;
      phase = 'boarding';
      wait = 0;
      laps = 0;
      look = 0;
      place();
    },
    /** 降りた（world.js から）。途中なら駅へ戻す */
    leave() {
      riding = false;
      phase = 'parked';
      s = Z.stop;
      v = 0;
      place();
    },
    /** プレイヤーの目（先頭の車両の右の席） */
    eye(out = new THREE.Vector3()) {
      front.updateMatrixWorld(true);
      return front.localToWorld(out.set(-0.3, 1.25, -0.12));
    },
    /** 車両の向き（VR のリグ・PC の視点を、宙返りでも車両ごと回す） */
    seatQuaternion(out = new THREE.Quaternion()) { return out.copy(front.quaternion); },
    get lookYawOffset() { return look; },
    /** PC の後ろからの視点（C）：列車の後ろの斜め上から */
    chase(camera) {
      // 車両の上の向きで（宙返りでは、いっしょに逆さまになって追う）
      const last = cars[cars.length - 1];
      tmpV.set(0, 0, 1).applyQuaternion(front.quaternion);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(front.quaternion);
      camera.position.copy(last.position).addScaledVector(tmpV, -7).addScaledVector(up, 3.2);
      camera.up.copy(up);
      camera.lookAt(front.position.x + tmpV.x * 6 + up.x * 0.8, front.position.y + tmpV.y * 6 + up.y * 0.8, front.position.z + tmpV.z * 6 + up.z * 0.8);
      camera.up.set(0, 1, 0);
    },
    /** 降りる所（ホームの上） */
    side(out = new THREE.Vector3()) { const S = COASTER.station; return out.set(S.x - 0.3, 0, S.z - 1.8); },
    /** 女の子の席の台（体をここに付ける）と、乗り込む所（ホームの上） */
    girlPivot,
    girlBoard(out = new THREE.Vector3()) { const S = COASTER.station; return out.set(S.x - 0.1, 0, S.z - 1.2); },
    /** 安全バーの握る所（ワールド。女の子の手） */
    barPoints(left, right) {
      front.updateMatrixWorld(true);
      front.localToWorld(left.set(0.42, 0.9, 0.36));
      front.localToWorld(right.set(0.18, 0.9, 0.36));
    },
    /** いまの区間（女の子の声に使う） */
    get section() {
      if (phase !== 'running') return phase;
      const w = wrap(s);
      if (inLift()) return w > Z.liftTo - 8 ? 'top' : 'lift';
      if (w >= Z.liftTo && w < Z.liftTo + 30) return 'drop';
      const i = Math.floor(w / STEP) % path.n;
      if (path.L[i]) return 'loop';
      if (toStop() < 25 && turned > 30) return 'brake';
      return 'ride';
    },
    get phase() { return phase; },
    get laps() { return laps; },
    get riding() { return riding; },
    get speed() { return v; },
    get upsideDown() { return front.quaternion && tmpV.set(0, 1, 0).applyQuaternion(front.quaternion).y < 0; },
    set girlSeated(x) { girlSeated = Boolean(x); },
    set girlComing(x) { girlComing = Boolean(x); },
    path,
    cars,
    gentle: GENTLE,
  };
}
