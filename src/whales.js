import * as THREE from 'three';
import { SEA_LEVEL } from './hill.js';
import { createSpine } from './spine.js';

/**
 * ホエールウォッチング：沖のマッコウクジラ（親 18m と子 11m。クルーザーは 12.7m）。
 *
 * いる所は、灯台の南の沖（WHALE_AREA。桟橋から 195m、島巡りの道のすぐ内側）。
 * クルーザー・ジェットスキーで近くへ行くと見られる。1 頭ずつ、次をくり返す（本物は 1 時間近く潜るが、縮めてある）：
 *   1. 浮かぶ（rise、4 秒）：深い所から斜めに上がってきて、頭が水面に出たところで大きく潮を吹く。
 *      2 回に 1 回くらいは、深い所からそのまま跳ぶ（ブリーチング）
 *   2. 水面で休む（surface、約 60 秒）：背と頭のてっぺんを水面に出して、ゆっくり（1.1 m/s）泳ぐ。
 *      9〜13 秒ごとに潮を真上へ吹く（5〜7 回）。ときどき、息をしたあとに潜って跳ぶ
 *   3. 跳ぶ（breach）：深く潜って勢いをつけ、頭を上げて水から跳び出す。弧に沿って向きを変え、背を弓なりに丸めて、
 *      頭から水に落ちる。跳び出す所・落ちる所に大きなしぶきと泡の輪
 *   4. 潜る（dive、12 秒）：頭を下げて背を丸め、尾の付け根を支点に起き上がるように尾びれを水の上へ高く上げて、
 *      少し止まり（尾びれの下のふちから水が滝のようにしたたる）、そのまま真下へ沈む（フルークアップ）
 *   5. 深く潜る（deep、15〜25 秒）：見えない。次に浮かぶ所を、いる所の中から選ぶ（船から 40m 以上離れた所）
 * 子は親の横（16m）について泳ぎ、親が潜ると 2.5 秒あとに潜り、親が浮かぶと 1.5 秒あとに浮かぶ。
 * 走っている船が 20m（親は 28m）以内へ来たら、驚いて早めに潜る（船とぶつからない）。
 *
 * 体は背骨に沿って曲げる（spine.js）。形は長さ 13m で作って、大きさ（scale）で伸ばす。
 * 頭は体の 1/3 の、縦に長く横に細い頭（断面は角の丸い縦長）、頭の後ろの小さなくびれ、細い下あご、
 * 低いこぶの背びれと、その後ろのでこぼこ（ナックル）、しわのある濡れた皮膚（頂点の色のむら、つや）、幅 5.5m の厚い尾びれ。前は +Z
 */
// 灯台の南の沖（桟橋から 195m、島巡りの道の最初の曲がり角から 35m）。以前の島の南西の外（桟橋から 830m）は、
// 遠くて、そこまで行かないと会えなかった
export const WHALE_AREA = { x: 80, z: -300, r: 40 };
const LENGTH = 13;
const RINGS = 80;
const SEG = 28;
const G = 9.8;

// 体の形（鼻先 t=0 → 尾の付け根 t=1）。上・下の半径、横の半幅、中心の高さ（m）、断面の角ばり（2 = 楕円、大きいほど四角）
// 頭は体の 1/3 の、縦に長く横に細い大きな頭（断面は角の丸い縦長。前は丸く、てっぺんは平ら）。頭の後ろで少しくびれ、
// 四角い箱にすると角ばりすぎて見えたので、角ばり（n）は 2.3〜2.8、横幅は高さの 6 割くらいにした。
// 胴（胸びれの後ろ）がいちばん太く、そこから尾の付け根へ細くなる（尾の付け根は縦長）
const PROFILE = {
  t:     [0,    0.03, 0.1,  0.2,  0.3,  0.34, 0.42, 0.52, 0.6,  0.68, 0.76, 0.84, 0.91, 0.96, 1],
  top:   [0.72, 1.02, 1.22, 1.3,  1.25, 1.12, 1.18, 1.1,  0.98, 0.84, 0.7,  0.58, 0.48, 0.38, 0.26],
  bot:   [0.35, 0.62, 0.95, 1.25, 1.38, 1.42, 1.45, 1.35, 1.15, 0.94, 0.76, 0.62, 0.52, 0.42, 0.3],
  halfW: [0.36, 0.56, 0.7,  0.78, 0.88, 1.0,  1.18, 1.15, 1.0,  0.8,  0.6,  0.44, 0.33, 0.27, 0.22],
  cy:    [0.32, 0.32, 0.28, 0.2,  0.1,  0.05, 0,    0,    0.02, 0.05, 0.08, 0.12, 0.14, 0.15, 0.15],
  n:     [2.8,  2.8,  2.6,  2.45, 2.3,  2.2,  2.1,  2.1,  2.0,  2.0,  2.1,  2.3,  2.4,  2.2,  2.0],
};
const BACK = new THREE.Color(0x4c4f55);
const BELLY = new THREE.Color(0x707278);

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
    pos.push(0, profileAt('cy', t), LENGTH / 2 - t * LENGTH + (r === 0 ? 0.32 : 0));
    ringOf.push(r);
    const base = r * row;
    col.push(col[base * 3], col[base * 3 + 1], col[base * 3 + 2]);
    for (let k = 0; k < SEG; k++) {
      if (flip) idx.push(center, base + k + 1, base + k);
      else idx.push(center, base + k, base + k + 1);
    }
  };
  // 鼻先は +Z、尾の先は -Z を表に（逆だと、表が内を向いて裏が消され、前から見ると穴が開いて見えた）
  cap(0, false);
  cap(RINGS, true);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return { geometry: g, ringOf: Int16Array.from(ringOf) };
}

/** 下あご：t 0.045〜0.33 の頭の下に沿う、下が丸い細長い形（anchorT の所から見た位置） */
function jawGeometry(anchorT) {
  const pos = [];
  const idx = [];
  const N = 18;          // 前後
  const M = 10;          // 断面（半分の輪）
  const z0 = LENGTH / 2 - anchorT * LENGTH;
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    const t = 0.045 + u * (0.33 - 0.045);
    const z = LENGTH / 2 - t * LENGTH - z0;
    // 頭の下の面（下あごの上は頭の中へ 12cm 埋める）
    const top = profileAt('cy', t) - profileAt('bot', t) * 0.97 + 0.12;
    // 先は細く・薄く、付け根へ広く・厚く。いちばん後ろは喉へ溶け込むように薄く
    const k = Math.sin(Math.PI * Math.min(1, u / 0.9) * 0.5);
    const tail = 1 - THREE.MathUtils.smoothstep(u, 0.8, 1);
    const hw = (0.12 + 0.2 * k) * (0.4 + 0.6 * tail);
    const d = (0.14 + 0.18 * k) * tail + 0.12;
    for (let j = 0; j <= M; j++) {
      const ph = (j / M) * Math.PI;
      pos.push(Math.cos(ph) * hw, top - Math.sin(ph) * d, z);
    }
  }
  const row = M + 1;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < M; j++) {
      const a = i * row + j;
      const b = a + row;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  // 先をふさぐ
  const tip = pos.length / 3;
  const zt = LENGTH / 2 - 0.035 * LENGTH - z0;
  pos.push(0, profileAt('cy', 0.045) - profileAt('bot', 0.045) * 0.97 + 0.05, zt);
  for (let j = 0; j < M; j++) idx.push(tip, j + 1, j);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function makeWhale() {
  const g = new THREE.Group();
  // 濡れてつやのある肌（日の光が白く光る）
  const skin = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.08 });
  const dark = new THREE.MeshStandardMaterial({ color: BACK, roughness: 0.3, metalness: 0.12 });
  const shade = (m) => { m.castShadow = true; return m; };
  const { geometry, ringOf } = bodyGeometry();
  g.add(shade(new THREE.Mesh(geometry, skin)));
  const spine = createSpine(geometry, ringOf, { rings: RINGS, length: LENGTH, center: 0.4, headRigid: 0.3, waveStart: 0.45, waveK: 3.5 });
  const anchor = (t, gain) => { const a = spine.anchor(t, gain); g.add(a); return a; };
  // 下あご：頭の下にはめ込んだ細長いあご（先は細く低く、付け根は広い）。頭の下の面に沿って、上半分は頭の中に埋める。
  // 口のふちは白っぽい。以前は丸い棒を頭の下に付けていて、棒が突き出して見えた
  const jawAt = anchor(0.17);
  jawAt.add(new THREE.Mesh(jawGeometry(0.17), new THREE.MeshStandardMaterial({ color: 0xcbc4bb, roughness: 0.6 })));
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
  // 尾びれ：幅の広い三角の左右の葉（幅 5.5m）。前のふちはふくらみ、先は丸く、後ろのふちのまん中に深い切れ込み。
  // 付け根は厚く（25cm）、先へ薄く。平らな面を水平に
  const half = new THREE.Shape();
  half.moveTo(0, 0.38);
  half.quadraticCurveTo(1.25, 0.34, 2.3, -0.32);
  half.quadraticCurveTo(2.55, -0.58, 2.2, -0.76);
  half.quadraticCurveTo(1.25, -1.0, 0.22, -0.98);
  half.quadraticCurveTo(0.08, -0.9, 0, -0.72);
  half.lineTo(0, 0.38);
  const flukeGeo = new THREE.ExtrudeGeometry(half, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.07, bevelSize: 0.08, bevelSegments: 3, curveSegments: 16 });
  flukeGeo.translate(0, 0, -0.06);
  {
    const fp = flukeGeo.attributes.position;
    for (let i = 0; i < fp.count; i++) fp.setZ(i, fp.getZ(i) * (1 - 0.65 * Math.min(1, Math.abs(fp.getX(i)) / 2.4)));
    flukeGeo.computeVertexNormals();
  }
  const flukeAt = anchor(1, 1.25);
  for (const side of [-1, 1]) {
    const f = shade(new THREE.Mesh(flukeGeo, dark));
    f.scale.set(side * 1.15, 1.15, 1);
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

/** 潮としぶき：霧・水の粒（大きさと濃さを粒ごとに変える点。霧（フォグ）もかかる）。粒ごとに重さと抵抗が違う */
function makeSpout() {
  const N = 5000;
  const pos = new Float32Array(N * 3);
  const vel = new Float32Array(N * 3);
  const age = new Float32Array(N).fill(99);
  const life = new Float32Array(N).fill(1);
  const size0 = new Float32Array(N);
  const size = new Float32Array(N);
  const alpha = new Float32Array(N);
  const grav = new Float32Array(N);
  const dragK = new Float32Array(N);
  const alpha0 = new Float32Array(N);
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
  /** 潮：噴気孔から (dx, dy, dz) へ。軽い霧（重さ 1.1、抵抗 1.7） */
  function emit(x, y, z, dx, dy, dz, n, strength) {
    for (let k = 0; k < n; k++) {
      const i = next;
      next = (next + 1) % N;
      grav[i] = 1.1;
      dragK[i] = 1.7;
      alpha0[i] = 0.2;
      // 速さはばらばら（速い芯と、遅くて横へ広がる霧）。先ほど横へ散る
      const sp = (5 + Math.random() ** 0.6 * 9) * strength;
      const spread = 0.6 + Math.random() * 1.6;
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
  /** しぶき：(x, z) のまわり半径 r から、上と外へ飛び散る水（重い。水面より下へ落ちたら消える） */
  function splash(x, z, r, n, strength) {
    for (let k = 0; k < n; k++) {
      const i = next;
      next = (next + 1) % N;
      grav[i] = 9.8;
      dragK[i] = 0.35;
      alpha0[i] = 0.6;
      const a = Math.random() * Math.PI * 2;
      const rr = Math.sqrt(Math.random()) * r;
      const out = (1.5 + Math.random() * 5) * strength;
      pos[i * 3] = x + Math.cos(a) * rr;
      pos[i * 3 + 1] = SEA_LEVEL + 0.1;
      pos[i * 3 + 2] = z + Math.sin(a) * rr;
      vel[i * 3] = Math.cos(a) * out;
      vel[i * 3 + 1] = (4 + Math.random() ** 0.7 * 9) * strength;
      vel[i * 3 + 2] = Math.sin(a) * out;
      age[i] = 0;
      life[i] = 1.1 + Math.random() * 1.1;
      size0[i] = 0.22 + Math.random() * 0.4;
    }
    alive = 4;
  }
  /** したたる水：(x, y, z) から、ほぼ真下へ落ちる細かい粒（尾びれのふちから） */
  function drip(x, y, z, a = 0.65) {
    const i = next;
    next = (next + 1) % N;
    grav[i] = 9.8;
    dragK[i] = 0.2;
    alpha0[i] = a;
    pos[i * 3] = x;
    pos[i * 3 + 1] = y;
    pos[i * 3 + 2] = z;
    vel[i * 3] = (Math.random() - 0.5) * 0.5;
    vel[i * 3 + 1] = -Math.random() * 0.8;
    vel[i * 3 + 2] = (Math.random() - 0.5) * 0.5;
    age[i] = 0;
    life[i] = 1.6;
    size0[i] = 0.06 + Math.random() * 0.12;
    alive = 4;
  }
  function update(dt) {
    if (alive <= 0) return;
    alive -= dt;
    for (let i = 0; i < N; i++) {
      if (age[i] >= life[i]) { alpha[i] = 0; size[i] = 0; continue; }
      age[i] += dt;
      const drag = Math.exp(-dragK[i] * dt);
      vel[i * 3] *= drag;
      vel[i * 3 + 1] = vel[i * 3 + 1] * drag - grav[i] * dt;
      vel[i * 3 + 2] *= drag;
      pos[i * 3] += (vel[i * 3] + 0.7) * dt;        // 風で少し流れる
      pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
      pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      if (pos[i * 3 + 1] < SEA_LEVEL - 0.2) { age[i] = life[i]; alpha[i] = 0; size[i] = 0; continue; }
      const k = age[i] / life[i];
      size[i] = size0[i] * (1 + age[i] * 1.8);
      alpha[i] = alpha0[i] * Math.min(1, age[i] / 0.06) * (1 - k) ** 1.8;
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.aSize.needsUpdate = true;
    geo.attributes.aAlpha.needsUpdate = true;
  }
  return { points, emit, splash, drip, update };
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

  // 水面で休むときの高さ：背（胸びれの後ろのいちばん太い所）の上が水面から 55cm 出る
  const surfaceY = (scale) => SEA_LEVEL - (topAt(0.42) + profileAt('cy', 0.42)) * scale + 0.55;
  const HINGE_T = 0.78;       // 潜るときの支点（尾の付け根の少し前）

  const list = [];
  // 親 18m、子 11m（クルーザーは 12.7m）
  for (const [i, scale] of [18 / LENGTH, 11 / LENGTH].entries()) {
    const m = makeWhale();
    m.group.scale.setScalar(scale);
    group.add(m.group);
    const a = rand(0, Math.PI * 2);
    list.push({
      ...m, g: m.group, scale, leader: null, i,
      x: A.x + Math.cos(a) * A.r * 0.4 + i * 16, z: A.z + Math.sin(a) * A.r * 0.4, yaw: rand(0, Math.PI * 2),
      y: surfaceY(scale), pitch: 0, speed: 1.1, yawRate: 0,
      state: 'surface', t: 0, blows: 0, nextBlow: rand(1, 4) + i * 2.5, blowT: 9, blowStrong: 1,
      arch: 0, amp: 0.06, phase: rand(0, 6), delay: -1, fluked: false,
      hinge: new THREE.Vector3(), dive0Y: 0, riseFrom: 0, breach: null,
    });
  }
  list[1].leader = list[0];
  list[0].blows = 6;
  list[1].blows = 5;

  let onBlow = null;
  let onFluke = null;
  let onBreach = null;
  let onSplash = null;
  // しぶきの泡の輪（広がって消える）
  const ringGeo = new THREE.RingGeometry(0.7, 1, 40);
  ringGeo.rotateX(-Math.PI / 2);
  const rings = [];
  for (let k = 0; k < 6; k++) {
    const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
    m.visible = false;
    group.add(m);
    rings.push({ m, t: 1, r: 1 });
  }
  let ringNext = 0;
  function splashAt(x, z, r, strength) {
    spout.splash(x, z, r, Math.round(900 * strength), 0.8 + 0.4 * strength);
    const ring = rings[ringNext];
    ringNext = (ringNext + 1) % rings.length;
    ring.t = 0;
    ring.r = r;
    ring.m.position.set(x, SEA_LEVEL + 0.05, z);
    ring.m.visible = true;
    onSplash?.(x, SEA_LEVEL, z, strength);
  }
  const _p = new THREE.Vector3();
  const _d = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  const _e = new THREE.Euler();

  /**
   * 尾びれから水がしたたる：尾びれが水面より上にあるあいだ、下になる前のふち（付け根から先まで）と面の上の点から
   * 細かい粒を落とす。尾びれが水から出る・入るときは、小さなしぶき
   */
  const _fp = new THREE.Vector3();
  function drips(w, dt, k) {
    w.fluke.updateMatrixWorld(true);
    w.fluke.localToWorld(_fp.set(0, profileAt('cy', 1), 0.1 - 0.6));
    const above = _fp.y > SEA_LEVEL + 0.3;
    if (above !== Boolean(w.flukeOut)) {
      w.flukeOut = above;
      w.fluke.localToWorld(_fp.set(0, 0, 0));
      splashAt(_fp.x, _fp.z, 1.2 * w.scale, 0.35 * w.scale);
    }
    if (!above) return;
    const n = Math.round(1800 * dt * w.scale + Math.random());
    for (let j = 0; j < n; j++) {
      const side = Math.random() < 0.5 ? -1 : 1;
      const sx = 0.2 + Math.random() * 2.1;
      const edge = Math.random() < 0.94;
      // 前のふち（頭を下にして尾びれを立てると、前のふちが下になる。付け根は 0.38、先へ -0.32）か、面の上のどこか。
      // 後ろのふちから落とすと、上から面をつたって白い点々に見えた
      const sy = edge ? 0.38 - 0.7 * (sx / 2.3) ** 2 : -0.9 + Math.random() * (0.2 + 0.9 * (1 - sx / 2.4));
      w.fluke.localToWorld(_fp.set(side * sx * 1.15, profileAt('cy', 1), 0.1 + sy * 1.15));
      if (_fp.y > SEA_LEVEL + 0.1) spout.drip(_fp.x, _fp.y, _fp.z, edge ? 0.65 : 0.25);
    }
  }
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
  /**
   * 跳ぶ（ブリーチング）：深く潜って勢いをつけ、頭を上げて水から跳び出す。弧（放物線）に沿って向きを変え、
   * 背を弓なりに丸めて（頂上でいちばん丸い）、頭から水に落ちる。跳び出す所・落ちる所に大きなしぶき。
   * 前 6 m/s、上 14〜16 m/s（体の中心が水面の上 4〜5m まで）。落ちる所が浅瀬なら跳ばない。
   * 2 回に 1 回くらいは「背中から」：ほぼ真上へ跳び出し（体の 2/3 が水の上）、頂上から後ろへ倒れながら
   * 体をひねって仰向けになり、背中から水に落ちる（大きなしぶき）
   */
  function startBreach(w, type = Math.random() < 0.5 ? 'back' : 'front') {
    const back = type === 'back';
    const vx = back ? 2 : 6;
    const apex = SEA_LEVEL + (back ? 6 : 4.5) * Math.sqrt(w.scale);
    const pitch0 = back ? 1.35 : 1.1;
    // 頭の先が水面のすぐ下にある深さから跳び出す
    const yStart = SEA_LEVEL - (LENGTH / 2) * w.scale * Math.sin(pitch0) - 0.4;
    const vy = Math.sqrt(2 * G * (apex - yStart));
    const dist = vx * (2 * vy) / G + 10 * w.scale;
    if (blocked(w.x + Math.sin(w.yaw) * dist, w.z + Math.cos(w.yaw) * dist)) return false;
    w.state = 'breach';
    w.t = 0;
    w.breach = { phase: 'sink', type, y0: w.y, p0: w.pitch, yStart, vx, vy, pitch0: Math.atan2(vy, vx), out: false, down: false, apex: false };
    return true;
  }
  function pickSpot(w, boat) {
    if (w.leader) {
      // 子：親の横
      const L = w.leader;
      const rx = Math.cos(L.yaw);
      const rz = -Math.sin(L.yaw);
      w.x = L.x + rx * 16 - Math.sin(L.yaw) * 4;
      w.z = L.z + rz * 16 - Math.cos(L.yaw) * 4;
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
    w.y = w.riseFrom = surfaceY(w.scale) - 7 * w.scale;
    w.pitch = -0.28;
    // 2 回に 1 回くらいは、深い所からそのまま跳ぶ
    if (Math.random() < 0.45 && startBreach(w)) { w.blows = w.leader ? 4 : 6; return; }
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
          const tx = L.x + Math.cos(L.yaw) * 16;
          const tz = L.z - Math.sin(L.yaw) * 16;
          want = Math.atan2(tx - w.x + Math.sin(L.yaw) * 8, tz - w.z + Math.cos(L.yaw) * 8);
        } else if (Math.hypot(w.x - A.x, w.z - A.z) > A.r * 0.55) {
          // いる所の外へ出そうなら中へ（跳ぶ・潜るたびに前へ進むので、早めに向きを変える）
          want = Math.atan2(A.x - w.x, A.z - w.z);
        }
        if (blocked(w.x + Math.sin(w.yaw) * 15, w.z + Math.cos(w.yaw) * 15)) want = w.yaw + 1.5;
        const turn = Math.atan2(Math.sin(want - w.yaw), Math.cos(want - w.yaw));
        w.yawRate += (THREE.MathUtils.clamp(turn * 0.4, -0.15, 0.15) - w.yawRate) * Math.min(1, dt * 1.5);
        w.yaw += w.yawRate * dt;
        w.speed += (1.1 - w.speed) * Math.min(1, dt * 0.5);
        w.x += Math.sin(w.yaw) * w.speed * dt;
        w.z += Math.cos(w.yaw) * w.speed * dt;
        w.y += (surfaceY(w.scale) + Math.sin(w.t * 0.45 + w.i) * 0.07 - w.y) * Math.min(1, dt * 1.5);
        w.pitch += (Math.sin(w.t * 0.3 + w.i) * 0.012 - w.pitch) * Math.min(1, dt * 1.5);
        // 潮を吹く
        w.nextBlow -= dt;
        if (w.nextBlow <= 0 && w.blows > 0) {
          blow(w, 1);
          w.blows--;
          w.nextBlow = rand(9, 13);
          // ときどき、息をしたあとに潜って跳ぶ（1 回の浮上で 4 割くらい）
          if (w.t > 12 && w.blows > 0 && Math.random() < 0.16) { w.nextBlow = 99; w.breachIn = 2.5; }
        }
        if (w.breachIn !== undefined) { w.breachIn -= dt; if (w.breachIn < 0) { w.breachIn = undefined; w.nextBlow = rand(6, 10); if (startBreach(w)) continue; } }
        // 吹き終わって少ししたら潜る（子は親が潜ったら）。走っている船が 20m 以内に来たら早めに潜る
        const near = boat && Math.abs(boat.speed) > 0.8 && Math.hypot(boat.x - w.x, boat.z - w.z) < 20 * Math.max(1, w.scale);
        if (w.delay >= 0) { w.delay -= dt; if (w.delay < 0) startDive(w); }
        else if (near || (!w.leader && w.blows <= 0 && w.nextBlow < 13 - 6)) startDive(w);
      } else if (w.state === 'dive') {
        // 潜る：頭を下げて背を丸め、支点（尾の付け根の少し前）で起き上がるように尾びれを水の上へ上げて、真下へ沈む
        // 尾びれを高く上げたところ（k 0.5〜0.68）で少し止まる。尾びれの下のふちから水がしたたり落ちる
        const k = Math.min(1, w.t / 12);
        w.pitch = 1.38 * THREE.MathUtils.smoothstep(k, 0.08, 0.6);
        archWant = 0.55 * Math.sin(Math.PI * Math.min(1, k / 0.55));
        ampWant = 0.02;
        // 支点は水面の少し下（尾の付け根は短く見え、尾びれの下のふちが水面の 1〜2m 上）
        const top = SEA_LEVEL - 0.9 * w.scale;
        w.hinge.y = k < 0.5
          ? w.dive0Y + (top - w.dive0Y) * THREE.MathUtils.smoothstep(k, 0.1, 0.5)
          : k < 0.68 ? top - 0.4 * w.scale * ((k - 0.5) / 0.18)
            : top - 0.4 * w.scale - 10 * w.scale * ((k - 0.68) / 0.32) ** 2;
        drips(w, dt, k);
        const fwd = 1.1 * (1 - k);
        w.hinge.x += Math.sin(w.yaw) * fwd * dt;
        w.hinge.z += Math.cos(w.yaw) * fwd * dt;
        if (!w.fluked && k > 0.5) { w.fluked = true; onFluke?.(w.hinge.x, w.hinge.z, w); }
        if (k >= 1) { w.state = 'deep'; w.t = 0; w.g.visible = false; w.deepFor = w.leader ? Infinity : rand(15, 25); }
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
      } else if (w.state === 'breach') {
        const b = w.breach;
        if (b.phase === 'sink') {
          // 潜って勢いをつける：頭を下げて深く潜り、終わりに頭を上へ向けて跳び出す深さへ
          const SINK = 4;
          const k = Math.min(1, w.t / SINK);
          const low = b.yStart - 2.5 * w.scale;
          if (k < 0.6) {
            const e = THREE.MathUtils.smoothstep(k, 0, 0.6);
            w.y = b.y0 + (low - b.y0) * e;
            w.pitch = b.p0 + (0.45 * Math.sin(Math.PI * Math.min(1, k / 0.6)) - b.p0) * Math.min(1, k * 5);
          } else {
            const e = THREE.MathUtils.smoothstep(k, 0.6, 1);
            w.y = low + (b.yStart - low) * e;
            w.pitch = -b.pitch0 * e;
          }
          w.speed += (4 - w.speed) * Math.min(1, dt);
          // 潜っているあいだに、いる所のまん中の方へ向き直る（跳ぶと 30m ほど前へ進むので）
          if (Math.hypot(w.x - A.x, w.z - A.z) > A.r * 0.3) {
            const want = Math.atan2(A.x - w.x, A.z - w.z);
            w.yaw += THREE.MathUtils.clamp(Math.atan2(Math.sin(want - w.yaw), Math.cos(want - w.yaw)), -0.5 * dt, 0.5 * dt);
          }
          w.x += Math.sin(w.yaw) * w.speed * dt;
          w.z += Math.cos(w.yaw) * w.speed * dt;
          ampWant = 0.35;
          if (k >= 1) { b.phase = 'leap'; w.t = 0; }
        } else {
          // 空へ：弧に沿って向きを変え、弧の曲がり具合 G·vx / v³ に合わせて背を丸める
          const t = w.t;
          const vy = b.vy - G * t;
          w.y = b.yStart + b.vy * t - 0.5 * G * t * t;
          w.x += Math.sin(w.yaw) * b.vx * dt;
          w.z += Math.cos(w.yaw) * b.vx * dt;
          if (b.type === 'back') {
            // 背中から：頂上の少し前から、後ろへ倒れていき（頭が上 → 後ろ → 下）、仰向けで落ちる。
            // 倒れながら体を半分ひねる（背中が下を向くまで）。背はほとんど丸めない
            const T = (2 * b.vy) / G;
            const k = THREE.MathUtils.smoothstep(t / T, 0.3, 0.8);
            w.pitch = -b.pitch0 + (-(Math.PI - 0.25) + b.pitch0) * k;
            w.roll = Math.sin(Math.PI * k) * 0.6;
            w.arch = 0.15;
          } else {
            w.pitch = -Math.atan2(vy, b.vx);
            const v = Math.hypot(b.vx, vy);
            w.arch = THREE.MathUtils.clamp((G * b.vx) / (v * v * v) * LENGTH * w.scale * 1.2, 0, 0.6);
          }
          archWant = w.arch;
          ampWant = t < 0.4 ? 0.4 : 0.03;
          if (!b.out && w.y > SEA_LEVEL - 1.5 * w.scale) { b.out = true; splashAt(w.x, w.z, 2 * w.scale, 0.8 * w.scale); }
          if (!b.apex && vy < 0) { b.apex = true; onBreach?.(w.x, w.y, w.z, w); }
          // 背中から落ちると、体ぜんぶが水面をたたくので、しぶきがもっと大きい
          if (!b.down && vy < 0 && w.y < SEA_LEVEL + (b.type === 'back' ? 1 : 0)) { b.down = true; splashAt(w.x, w.z, (b.type === 'back' ? 4.5 : 3) * w.scale, (b.type === 'back' ? 1.9 : 1.3) * w.scale); }
          if (vy < 0 && w.y <= b.yStart) {
            // 水の中から、また浮かんでくる（すぐには潮を吹かない）
            w.state = 'rise';
            w.t = 0;
            w.riseFrom = w.y;
            w.risenBlow = true;
            w.arch = 0;
          }
        }
      } else if (w.state === 'rise') {
        // 浮かぶ：深い所から斜めに上がってくる。頭が水面に出たところで、大きく潮を吹く
        const k = Math.min(1, w.t / 4);
        w.y = w.riseFrom + (surfaceY(w.scale) - w.riseFrom) * THREE.MathUtils.smoothstep(k, 0, 1);
        w.pitch += (-0.28 * (1 - THREE.MathUtils.smoothstep(k, 0.4, 1)) - w.pitch) * Math.min(1, dt * 2.5);
        w.x += Math.sin(w.yaw) * 1.5 * dt;
        w.z += Math.cos(w.yaw) * 1.5 * dt;
        ampWant = 0.12;
        if (k >= 0.72 && w.blowT > 5 && w.state === 'rise' && !w.risenBlow) { w.risenBlow = true; blow(w, 1.2); w.blows--; }
        if (k >= 1) { w.state = 'surface'; w.t = 0; w.nextBlow = w.risenBlow ? rand(3, 6) : rand(8, 12); w.risenBlow = false; w.delay = -1; }
      }
      if (!w.g.visible) continue;
      w.arch += (archWant - w.arch) * Math.min(1, dt * 2);
      w.amp += (ampWant - w.amp) * Math.min(1, dt * 1.5);
      if (!viewer || w.state === 'dive' || Math.hypot(viewer.x - w.x, viewer.z - w.z) < 500) w.spine.bend(w.arch, w.amp, w.phase);
      // 背中から落ちたあとは、水の中でひねりを戻す
      if (w.state !== 'breach') w.roll = (w.roll ?? 0) * Math.max(0, 1 - dt * 1.5);
      w.g.rotation.set(w.pitch, w.yaw, w.roll ?? 0, 'YXZ');
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
        // 真上へ（体が傾いていても、潮は上へ）。ほんの少し前へ
        _d.set(Math.sin(w.yaw) * 0.08, 1, Math.cos(w.yaw) * 0.08).normalize();
        const n = Math.round((650 * dt) / 0.9 * w.blowStrong * w.scale + Math.random());
        spout.emit(_p.x, Math.max(_p.y, SEA_LEVEL + 0.1), _p.z, _d.x, _d.y, _d.z, n, (0.75 + 0.25 * w.scale) * w.blowStrong * (1 - w.blowT * 0.35));
      } else {
        w.blowT += dt;
      }
    }
    spout.update(dt);
    for (const r of rings) {
      if (!r.m.visible) continue;
      r.t += dt / 1.6;
      const k = r.r * (1 + r.t * 2.5);
      r.m.scale.set(k, 1, k);
      r.m.material.opacity = Math.max(0, 0.8 * (1 - r.t));
      if (r.t >= 1) r.m.visible = false;
    }
  }

  return {
    group,
    update,
    /** 潮を吹いたとき（噴気孔の x, y, z、強さ、そのクジラ） */
    set onBlow(fn) { onBlow = fn; },
    /** 尾びれを上げて潜ったとき（x, z、そのクジラ） */
    set onFluke(fn) { onFluke = fn; },
    /** 跳んだとき（いちばん高い所で。x, y, z、そのクジラ） */
    set onBreach(fn) { onBreach = fn; },
    /** 大きなしぶき（x, y, z、強さ） */
    set onSplash(fn) { onSplash = fn; },
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
    debugBreach(i = 0, type) { const w = list[i]; return Boolean(w && w.state === 'surface' && startBreach(w, type)); },
    debugPlace(x, z, yaw = 0) {
      for (const w of list) {
        w.x = x + w.i * 16 * Math.cos(yaw); w.z = z - w.i * 16 * Math.sin(yaw); w.yaw = yaw;
        w.state = 'surface'; w.t = 0; w.g.visible = true; w.y = surfaceY(w.scale); w.delay = -1; w.blows = 6; w.nextBlow = 99;
      }
    },
  };
}
