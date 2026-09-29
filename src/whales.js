import * as THREE from 'three';
import { SEA_LEVEL } from './hill.js';
import { createSpine } from './spine.js';

/**
 * ホエールウォッチング：沖のマッコウクジラ（親 13m と子 9m）。
 *
 * いる所は、島巡りの道のいちばん沖（島の南西の外、WHALE_AREA。周遊の道から 40〜80m）。
 * クルーザー・ジェットスキーで近くへ行くと見られる。1 頭ずつ、次をくり返す（本物は 1 時間近く潜るが、縮めてある）：
 *   1. 浮かぶ（rise、4 秒）：深い所から斜めに上がってきて、頭が水面に出たところで大きく潮を吹く
 *   2. 水面で休む（surface、約 60 秒）：背と頭のてっぺんを水面に出して、ゆっくり（1.1 m/s）泳ぐ。
 *      9〜13 秒ごとに潮を吹く（5〜7 回）。潮は頭の前の左の噴気孔から、斜め前・左へ（マッコウクジラだけの形）
 *   3. 潜る（dive、10 秒）：頭を下げて背を丸め、尾の付け根を支点に起き上がるように尾びれを水の上へ高く上げて、
 *      そのまま真下へ沈む（フルークアップ）
 *   4. 深く潜る（deep、30〜45 秒）：見えない。次に浮かぶ所を、いる所の中から選ぶ（船から 40m 以上離れた所）
 * 子は親の横（12m）について泳ぎ、親が潜ると 2.5 秒あとに潜り、親が浮かぶと 1.5 秒あとに浮かぶ。
 * 走っている船が 20m 以内へ来たら、驚いて早めに潜る（船とぶつからない）。
 *
 * 体は背骨に沿って曲げる（spine.js）。頭は体の 1/3 の四角い箱（断面を丸い四角に）、細い下あご、
 * 低いこぶの背びれと、その後ろのでこぼこ（ナックル）、しわのある皮膚（頂点の色のむら）、幅 4m の尾びれ。前は +Z
 */
export const WHALE_AREA = { x: -318, z: -698, r: 45 };
const LENGTH = 13;
const RINGS = 80;
const SEG = 28;
const G = 9.8;

// 体の形（鼻先 t=0 → 尾の付け根 t=1）。上・下の半径、横の半幅、中心の高さ（m）、断面の角ばり（2 = 楕円、大きいほど四角）
const PROFILE = {
  t:     [0,    0.015, 0.05, 0.12, 0.22, 0.30, 0.36, 0.45, 0.55, 0.62, 0.70, 0.80, 0.88, 0.95, 1],
  top:   [0.5,  0.95,  1.15, 1.22, 1.2,  1.1,  1.05, 1.05, 0.95, 0.85, 0.65, 0.45, 0.32, 0.22, 0.16],
  bot:   [0.35, 0.75,  1.0,  1.18, 1.28, 1.34, 1.35, 1.3,  1.15, 0.95, 0.7,  0.45, 0.32, 0.22, 0.16],
  halfW: [0.4,  0.72,  0.9,  1.0,  1.04, 1.05, 1.12, 1.2,  1.1,  0.95, 0.7,  0.42, 0.22, 0.14, 0.11],
  cy:    [0.25, 0.25,  0.22, 0.18, 0.12, 0.06, 0.03, 0,    0,    0.02, 0.05, 0.1,  0.12, 0.12, 0.12],
  n:     [3.6,  3.8,   3.6,  3.3,  2.9,  2.5,  2.2,  2.1,  2.0,  2.0,  2.0,  2.2,  2.4,  2.2,  2.0],
};
const BACK = new THREE.Color(0x4b4744);
const BELLY = new THREE.Color(0x67625e);

function profileAt(key, t) {
  const T = PROFILE.t;
  const v = PROFILE[key];
  let k = 1;
  while (k < T.length - 1 && T[k] < t) k++;
  const u = THREE.MathUtils.clamp((t - T[k - 1]) / (T[k] - T[k - 1]), 0, 1);
  const e = u * u * (3 - 2 * u);
  return v[k - 1] + (v[k] - v[k - 1]) * e;
}
/** 背の上のでこぼこ：低いこぶ（背びれ）と、その後ろのナックル */
function backBumps(t) {
  let b = 0.2 * Math.exp(-(((t - 0.62) / 0.028) ** 2));
  for (const k of [0.69, 0.73, 0.77, 0.81, 0.85]) b += 0.06 * Math.exp(-(((t - k) / 0.014) ** 2));
  return b;
}
const topAt = (t) => profileAt('top', t) + backBumps(t);

function bodyGeometry() {
  const pos = [];
  const col = [];
  const idx = [];
  const ringOf = [];
  const c = new THREE.Color();
  const pw = (v, e) => Math.sign(v) * Math.abs(v) ** e;
  for (let r = 0; r <= RINGS; r++) {
    const t = r / RINGS;
    const top = topAt(t);
    const bot = profileAt('bot', t);
    const hw = profileAt('halfW', t);
    const cy = profileAt('cy', t);
    const e = 2 / profileAt('n', t);
    const z = LENGTH / 2 - t * LENGTH;
    for (let k = 0; k <= SEG; k++) {
      const a = (k / SEG) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      // 丸い四角（スーパー楕円）の断面
      pos.push(pw(ca, e) * hw, cy + pw(sa, e) * (sa > 0 ? top : bot), z);
      ringOf.push(r);
      // 背は濃く、腹は少し明るく。頭の後ろから尾までは、しわのむら（細かい横じわ）
      c.copy(BELLY).lerp(BACK, THREE.MathUtils.smoothstep(sa, -0.7, 0.2));
      const wr = THREE.MathUtils.smoothstep(t, 0.28, 0.36);
      const shade = 1 + wr * (0.07 * Math.sin(t * LENGTH * 11 + Math.sin(a * 3) * 1.6) + 0.04 * Math.sin(t * LENGTH * 29 + a * 5));
      // 頭の前（おでこ）は、傷あとで少し白っぽい
      const scar = (1 - THREE.MathUtils.smoothstep(t, 0.0, 0.1)) * 0.12 * Math.max(0, sa);
      c.multiplyScalar(shade).lerp(new THREE.Color(0x9a948e), scar);
      col.push(c.r, c.g, c.b);
    }
  }
  const row = SEG + 1;
  for (let r = 0; r < RINGS; r++) {
    for (let k = 0; k < SEG; k++) {
      const a = r * row + k;
      const b = a + row;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const cap = (r, flip) => {
    const t = r / RINGS;
    const center = pos.length / 3;
    pos.push(0, profileAt('cy', t), LENGTH / 2 - t * LENGTH + (r === 0 ? 0.06 : 0));
    ringOf.push(r);
    const base = r * row;
    col.push(col[base * 3], col[base * 3 + 1], col[base * 3 + 2]);
    for (let k = 0; k < SEG; k++) {
      if (flip) idx.push(center, base + k + 1, base + k);
      else idx.push(center, base + k, base + k + 1);
    }
  };
  cap(0, true);
  cap(RINGS, false);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return { geometry: g, ringOf: Int16Array.from(ringOf) };
}

function makeWhale() {
  const g = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.02 });
  const dark = new THREE.MeshStandardMaterial({ color: BACK, roughness: 0.55 });
  const shade = (m) => { m.castShadow = true; return m; };
  const { geometry, ringOf } = bodyGeometry();
  g.add(shade(new THREE.Mesh(geometry, skin)));
  const spine = createSpine(geometry, ringOf, { rings: RINGS, length: LENGTH, center: 0.4, headRigid: 0.3, waveStart: 0.45, waveK: 3.5 });
  const anchor = (t, gain) => { const a = spine.anchor(t, gain); g.add(a); return a; };
  // 下あご：頭の下の細い棒（先は頭の前より少し後ろ）。口のふちは白っぽい
  const jawAt = anchor(0.17);
  const jaw = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 3.3, 4, 10), new THREE.MeshStandardMaterial({ color: 0x8c8781, roughness: 0.6 }));
  jaw.rotation.x = Math.PI / 2;
  jaw.scale.set(1.2, 1, 0.75);
  jaw.position.set(0, profileAt('cy', 0.17) - profileAt('bot', 0.17) + 0.08, 0.1);
  jawAt.add(jaw);
  // 目：頭の後ろの低い所（あごの付け根の上）
  const eyeAt = anchor(0.3);
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.2 }));
    eye.position.set(side * profileAt('halfW', 0.3) * 0.97, profileAt('cy', 0.3) - profileAt('bot', 0.3) * 0.45, 0);
    eyeAt.add(eye);
  }
  // 胸びれ：小さなへら（長さ 1.1m）。体のわきの低い所から、後ろ・下・外へ
  const flipGeo = new THREE.SphereGeometry(1, 14, 8);
  flipGeo.scale(0.55, 0.07, 0.26);
  flipGeo.translate(0.5, 0, 0);
  const flipAt = anchor(0.34);
  for (const side of [-1, 1]) {
    const f = shade(new THREE.Mesh(flipGeo, dark));
    f.position.set(side * profileAt('halfW', 0.34) * 0.85, profileAt('cy', 0.34) - profileAt('bot', 0.34) * 0.7, 0);
    f.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), new THREE.Vector3(side * 0.62, -0.5, -0.6).normalize());
    flipAt.add(f);
  }
  // 尾びれ：幅 4m の三角、まん中に切れ込み。平らな面を水平に
  const half = new THREE.Shape();
  half.moveTo(0, 0.15);
  half.quadraticCurveTo(0.9, 0.2, 2.0, -0.75);
  half.quadraticCurveTo(1.6, -0.97, 1.1, -0.92);
  half.quadraticCurveTo(0.45, -0.86, 0, -0.6);
  half.lineTo(0, 0.15);
  const flukeGeo = new THREE.ExtrudeGeometry(half, { depth: 0.1, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.05, bevelSegments: 2, curveSegments: 12 });
  flukeGeo.translate(0, 0, -0.05);
  const flukeAt = anchor(1, 1.25);
  for (const side of [-1, 1]) {
    const f = shade(new THREE.Mesh(flukeGeo, dark));
    f.scale.x = side;
    f.rotation.x = Math.PI / 2;          // 形の -Y を体の後ろ（-Z）へ
    f.position.set(0, profileAt('cy', 1), 0.1);
    flukeAt.add(f);
  }
  // 噴気孔：頭の前の、左（+X）に寄ったところ
  const blowhole = anchor(0.02);
  blowhole.add(new THREE.Object3D());
  blowhole.children[0].position.set(0.38, profileAt('cy', 0.02) + topAt(0.02) - 0.05, 0);
  spine.bend(0, 0, 0);
  return { group: g, spine, blowhole: blowhole.children[0], fluke: flukeAt };
}

/** 潮：霧の粒（大きさと濃さを粒ごとに変える点。霧（フォグ）もかかる） */
function makeSpout() {
  const N = 2400;
  const pos = new Float32Array(N * 3);
  const vel = new Float32Array(N * 3);
  const age = new Float32Array(N).fill(99);
  const life = new Float32Array(N).fill(1);
  const size0 = new Float32Array(N);
  const size = new Float32Array(N);
  const alpha = new Float32Array(N);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uScale: { value: 400 }, uColor: { value: new THREE.Color(0xf1f5f8) } }]),
    vertexShader: `
      attribute float aSize;
      attribute float aAlpha;
      uniform float uScale;
      varying float vAlpha;
      #include <fog_pars_vertex>
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = aSize * uScale / max(0.1, -mvPosition.z);
        vAlpha = aAlpha;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      uniform vec3 uColor;
      varying float vAlpha;
      #include <fog_pars_fragment>
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = vAlpha * smoothstep(0.5, 0.12, d);
        if (a < 0.01) discard;
        gl_FragColor = vec4(uColor, a);
        #include <fog_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    fog: true,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  const _vp = new THREE.Vector4();
  // 点の大きさ：いま描いている画面（VR では片目の画面）の高さと画角から、1m が何ピクセルか
  points.onBeforeRender = (renderer, scene, camera) => {
    renderer.getCurrentViewport(_vp);
    mat.uniforms.uScale.value = (_vp.w / 2) * (camera.projectionMatrix.elements[5] || 1);
  };
  let next = 0;
  let alive = 0;
  function emit(x, y, z, dx, dy, dz, n, strength) {
    for (let k = 0; k < n; k++) {
      const i = next;
      next = (next + 1) % N;
      // 速さはばらばら（速い芯と、遅くて横へ広がる霧）。先ほど横へ散る
      const sp = (5 + Math.random() ** 0.6 * 9) * strength;
      const spread = 0.6 + Math.random() * 2.4;
      pos[i * 3] = x + (Math.random() - 0.5) * 0.25;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = z + (Math.random() - 0.5) * 0.25;
      vel[i * 3] = dx * sp + (Math.random() - 0.5) * spread;
      vel[i * 3 + 1] = dy * sp + (Math.random() - 0.5) * spread * 0.6;
      vel[i * 3 + 2] = dz * sp + (Math.random() - 0.5) * spread;
      age[i] = 0;
      life[i] = 1.4 + Math.random() * 1.6;
      size0[i] = 0.18 + Math.random() * 0.32;
    }
    alive = 4;
  }
  function update(dt) {
    if (alive <= 0) return;
    alive -= dt;
    const drag = Math.exp(-1.7 * dt);
    for (let i = 0; i < N; i++) {
      if (age[i] >= life[i]) { alpha[i] = 0; size[i] = 0; continue; }
      age[i] += dt;
      vel[i * 3] *= drag;
      vel[i * 3 + 1] = vel[i * 3 + 1] * drag - 1.1 * dt;
      vel[i * 3 + 2] *= drag;
      pos[i * 3] += (vel[i * 3] + 0.7) * dt;        // 風で少し流れる
      pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
      pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      const k = age[i] / life[i];
      size[i] = size0[i] * (1 + age[i] * 1.8);
      alpha[i] = 0.2 * Math.min(1, age[i] / 0.06) * (1 - k) ** 1.8;
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.aSize.needsUpdate = true;
    geo.attributes.aAlpha.needsUpdate = true;
  }
  return { points, emit, update };
}

/**
 * @param {{ blocked?: (x: number, z: number) => boolean }} options
 */
export function createWhales({ blocked = () => false } = {}) {
  const group = new THREE.Group();
  group.name = 'whales';
  const spout = makeSpout();
  group.add(spout.points);
  const rand = (a, b) => a + Math.random() * (b - a);
  const A = WHALE_AREA;

  // 水面で休むときの高さ：背（頭の後ろ〜こぶ）の上が水面から 35cm 出る
  const surfaceY = (scale) => SEA_LEVEL - (topAt(0.4) + profileAt('cy', 0.4)) * scale + 0.35;
  const HINGE_T = 0.78;       // 潜るときの支点（尾の付け根の少し前）

  const list = [];
  for (const [i, scale] of [1, 0.7].entries()) {
    const m = makeWhale();
    m.group.scale.setScalar(scale);
    group.add(m.group);
    const a = rand(0, Math.PI * 2);
    list.push({
      ...m, g: m.group, scale, leader: null, i,
      x: A.x + Math.cos(a) * A.r * 0.4 + i * 12, z: A.z + Math.sin(a) * A.r * 0.4, yaw: rand(0, Math.PI * 2),
      y: surfaceY(scale), pitch: 0, speed: 1.1, yawRate: 0,
      state: 'surface', t: 0, blows: 0, nextBlow: rand(1, 4) + i * 2.5, blowT: 9, blowStrong: 1,
      arch: 0, amp: 0.06, phase: rand(0, 6), delay: -1, fluked: false,
      hinge: new THREE.Vector3(), dive0Y: 0,
    });
  }
  list[1].leader = list[0];
  list[0].blows = 6;
  list[1].blows = 5;

  let onBlow = null;
  let onFluke = null;
  const _p = new THREE.Vector3();
  const _d = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  const _e = new THREE.Euler();

  function blow(w, strong = 1) {
    w.blowT = 0;
    w.blowStrong = strong;
    w.g.updateMatrixWorld(true);
    w.blowhole.getWorldPosition(_p);
    onBlow?.(_p.x, _p.y, _p.z, strong, w);
  }
  function startDive(w) {
    if (w.state === 'dive' || w.state === 'deep') return;
    w.state = 'dive';
    w.t = 0;
    w.fluked = false;
    // 支点（尾の付け根の少し前）の、いまの位置から始める
    w.g.updateMatrixWorld(true);
    w.spine.pointAt(HINGE_T, _p);
    w.g.localToWorld(w.hinge.copy(_p));
    w.dive0Y = w.hinge.y;
    for (const o of list) if (o.leader === w && o.state === 'surface') o.delay = 2.5;
  }
  function pickSpot(w, boat) {
    if (w.leader) {
      // 子：親の横
      const L = w.leader;
      const rx = Math.cos(L.yaw);
      const rz = -Math.sin(L.yaw);
      w.x = L.x + rx * 12 - Math.sin(L.yaw) * 4;
      w.z = L.z + rz * 12 - Math.cos(L.yaw) * 4;
      w.yaw = L.yaw;
      return;
    }
    for (let k = 0; k < 30; k++) {
      const a = rand(0, Math.PI * 2);
      const r = Math.sqrt(Math.random()) * A.r;
      const x = A.x + Math.cos(a) * r;
      const z = A.z + Math.sin(a) * r;
      if (blocked(x, z)) continue;
      if (boat && Math.hypot(x - boat.x, z - boat.z) < 40) continue;
      w.x = x;
      w.z = z;
      break;
    }
    w.yaw = rand(0, Math.PI * 2);
  }
  function startRise(w) {
    w.state = 'rise';
    w.t = 0;
    w.g.visible = true;
    w.blows = w.leader ? 4 + Math.floor(Math.random() * 2) : 5 + Math.floor(Math.random() * 3);
  }

  /**
   * @param {number} dt
   * @param {{ x, z, yaw, speed } | null} boat 乗っている船
   * @param {THREE.Vector3 | null} viewer 見ている人の位置。500m より遠いときは体を曲げない（動きだけ進める）
   */
  function update(dt, boat = null, viewer = null) {
    dt = Math.min(dt, 0.05);
    for (const w of list) {
      w.t += dt;
      w.phase += dt * (0.7 + w.speed * 0.25);
      let archWant = 0;
      let ampWant = 0.06;
      if (w.state === 'surface') {
        // ゆっくり泳ぐ：いる所の外へ出そうなら中へ向きを変え、浅瀬の手前でも向きを変える。子は親の横へ
        let want = w.yaw + Math.sin(w.t * 0.07 + w.i * 2) * 0.3;
        if (w.leader && w.leader.state === 'surface') {
          const L = w.leader;
          const tx = L.x + Math.cos(L.yaw) * 12;
          const tz = L.z - Math.sin(L.yaw) * 12;
          want = Math.atan2(tx - w.x + Math.sin(L.yaw) * 8, tz - w.z + Math.cos(L.yaw) * 8);
        } else if (Math.hypot(w.x - A.x, w.z - A.z) > A.r * 0.8) {
          want = Math.atan2(A.x - w.x, A.z - w.z);
        }
        if (blocked(w.x + Math.sin(w.yaw) * 15, w.z + Math.cos(w.yaw) * 15)) want = w.yaw + 1.5;
        const turn = Math.atan2(Math.sin(want - w.yaw), Math.cos(want - w.yaw));
        w.yawRate += (THREE.MathUtils.clamp(turn * 0.3, -0.07, 0.07) - w.yawRate) * Math.min(1, dt * 1.5);
        w.yaw += w.yawRate * dt;
        w.speed += (1.1 - w.speed) * Math.min(1, dt * 0.5);
        w.x += Math.sin(w.yaw) * w.speed * dt;
        w.z += Math.cos(w.yaw) * w.speed * dt;
        w.y += (surfaceY(w.scale) + Math.sin(w.t * 0.45 + w.i) * 0.07 - w.y) * Math.min(1, dt * 1.5);
        w.pitch += (Math.sin(w.t * 0.3 + w.i) * 0.012 - w.pitch) * Math.min(1, dt * 1.5);
        // 潮を吹く
        w.nextBlow -= dt;
        if (w.nextBlow <= 0 && w.blows > 0) { blow(w, 1); w.blows--; w.nextBlow = rand(9, 13); }
        // 吹き終わって少ししたら潜る（子は親が潜ったら）。走っている船が 20m 以内に来たら早めに潜る
        const near = boat && Math.abs(boat.speed) > 0.8 && Math.hypot(boat.x - w.x, boat.z - w.z) < 20 * Math.max(1, w.scale);
        if (w.delay >= 0) { w.delay -= dt; if (w.delay < 0) startDive(w); }
        else if (near || (!w.leader && w.blows <= 0 && w.nextBlow < 13 - 6)) startDive(w);
      } else if (w.state === 'dive') {
        // 潜る：頭を下げて背を丸め、支点（尾の付け根の少し前）で起き上がるように尾びれを水の上へ上げて、真下へ沈む
        const k = Math.min(1, w.t / 10);
        w.pitch = 1.35 * THREE.MathUtils.smoothstep(k, 0.08, 0.7);
        archWant = 0.55 * Math.sin(Math.PI * Math.min(1, k / 0.62));
        ampWant = 0.02;
        const top = SEA_LEVEL + 0.15 * w.scale;
        w.hinge.y = k < 0.55
          ? w.dive0Y + (top - w.dive0Y) * THREE.MathUtils.smoothstep(k, 0.1, 0.55)
          : top - 10 * w.scale * ((k - 0.55) / 0.45) ** 2;
        const fwd = 1.1 * (1 - k);
        w.hinge.x += Math.sin(w.yaw) * fwd * dt;
        w.hinge.z += Math.cos(w.yaw) * fwd * dt;
        if (!w.fluked && k > 0.55) { w.fluked = true; onFluke?.(w.hinge.x, w.hinge.z, w); }
        if (k >= 1) { w.state = 'deep'; w.t = 0; w.g.visible = false; w.deepFor = w.leader ? Infinity : rand(30, 45); }
      } else if (w.state === 'deep') {
        if (!w.leader && w.t > w.deepFor) {
          pickSpot(w, boat);
          startRise(w);
          for (const o of list) if (o.leader === w) { o.riseIn = 1.5; }
        }
        if (w.leader && w.riseIn !== undefined && w.riseIn >= 0) {
          w.riseIn -= dt;
          if (w.riseIn < 0) { pickSpot(w, boat); startRise(w); w.riseIn = undefined; }
        }
      } else if (w.state === 'rise') {
        // 浮かぶ：深い所から斜めに上がってくる。頭が水面に出たところで、大きく潮を吹く
        const k = Math.min(1, w.t / 4);
        w.y = surfaceY(w.scale) - 7 * w.scale * (1 - THREE.MathUtils.smoothstep(k, 0, 1));
        w.pitch = -0.28 * (1 - THREE.MathUtils.smoothstep(k, 0.4, 1));
        w.x += Math.sin(w.yaw) * 1.5 * dt;
        w.z += Math.cos(w.yaw) * 1.5 * dt;
        ampWant = 0.12;
        if (k >= 0.72 && w.blowT > 5 && w.state === 'rise' && !w.risenBlow) { w.risenBlow = true; blow(w, 1.2); w.blows--; }
        if (k >= 1) { w.state = 'surface'; w.t = 0; w.risenBlow = false; w.nextBlow = rand(8, 12); w.delay = -1; }
      }
      if (!w.g.visible) continue;
      w.arch += (archWant - w.arch) * Math.min(1, dt * 2);
      w.amp += (ampWant - w.amp) * Math.min(1, dt * 1.5);
      if (!viewer || w.state === 'dive' || Math.hypot(viewer.x - w.x, viewer.z - w.z) < 500) w.spine.bend(w.arch, w.amp, w.phase);
      w.g.rotation.set(w.pitch, w.yaw, 0, 'YXZ');
      if (w.state === 'dive') {
        // 支点がそこへ来るように、体の位置を決める
        w.spine.pointAt(HINGE_T, _p).multiplyScalar(w.scale).applyEuler(_e.set(w.pitch, w.yaw, 0, 'YXZ'));
        w.g.position.copy(w.hinge).sub(_p);
        w.x = w.g.position.x;
        w.z = w.g.position.z;
      } else {
        w.g.position.set(w.x, w.y, w.z);
      }
      // 潮：吹いてから 0.9 秒、噴気孔から斜め前・左・上へ
      if (w.blowT < 0.9) {
        w.blowT += dt;
        w.g.updateMatrixWorld(true);
        w.blowhole.getWorldPosition(_p);
        w.g.getWorldQuaternion(_q);
        _d.set(0.36, 0.82, 0.45).normalize().applyQuaternion(_q);
        const n = Math.round((650 * dt) / 0.9 * w.blowStrong * w.scale + Math.random());
        spout.emit(_p.x, Math.max(_p.y, SEA_LEVEL + 0.1), _p.z, _d.x, _d.y, _d.z, n, (0.75 + 0.25 * w.scale) * w.blowStrong * (1 - w.blowT * 0.35));
      } else {
        w.blowT += dt;
      }
    }
    spout.update(dt);
  }

  return {
    group,
    update,
    /** 潮を吹いたとき（噴気孔の x, y, z、強さ、そのクジラ） */
    set onBlow(fn) { onBlow = fn; },
    /** 尾びれを上げて潜ったとき（x, z、そのクジラ） */
    set onFluke(fn) { onFluke = fn; },
    get list() { return list; },
    /** (x, z) からいちばん近い、見えているクジラまでの距離と位置 */
    nearest(x, z, out = new THREE.Vector3()) {
      let best = null;
      let bd = Infinity;
      for (const w of list) {
        if (!w.g.visible) continue;
        const d = Math.hypot(w.g.position.x - x, w.g.position.z - z);
        if (d < bd) { bd = d; best = w; }
      }
      if (best) out.set(best.g.position.x, SEA_LEVEL + 1, best.g.position.z);
      return { distance: bd, point: out };
    },
    /** 検証用 */
    debugBlow(i = 0) { const w = list[i]; if (w?.g.visible) blow(w, 1); },
    debugDive(i = 0) { const w = list[i]; if (w) startDive(w); },
    debugPlace(x, z, yaw = 0) {
      for (const w of list) {
        w.x = x + w.i * 12 * Math.cos(yaw); w.z = z - w.i * 12 * Math.sin(yaw); w.yaw = yaw;
        w.state = 'surface'; w.t = 0; w.g.visible = true; w.y = surfaceY(w.scale); w.delay = -1; w.blows = 6; w.nextBlow = 99;
      }
    },
  };
}
