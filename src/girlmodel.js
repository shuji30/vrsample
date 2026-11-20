import * as THREE from 'three';

/**
 * コードだけで作る、オリジナルの女の子のモデル。
 *
 * 同梱の VRM（models/character.vrm）は、利用条件が「個人・非営利のみ／再配布不可／改変禁止」で、売り物には使えない。
 * こちらは形・色・顔の絵をすべてこのファイルで作るので、外から持ち込む物が無く、権利の心配が無い。
 *
 * character.js からは VRM と同じ口で使える（three-vrm の VRM の、使っている所だけをまねる）：
 *   scene                          … 足元が原点、+Z が前、T ポーズの Group
 *   humanoid.getNormalizedBoneNode … VRM の人型の骨の名前（hips・leftUpperArm・rightIndexProximal など）
 *   humanoid.getRawBoneNode        … 同じ物を返す（正規化の骨と実体の骨を分けていない）
 *   expressionManager.setValue     … happy・relaxed・surprised・blink・blinkRight・aa・ih・ou・ee・oh（0..1）
 *   lookAt.target                  … 見る相手（Object3D）。目のひとみが追う
 *   update(dt)                     … 顔の描き直し・ひとみ・髪の揺れ
 *   meta                           … 名前と作者（開始画面のクレジット）
 *
 * つくり
 * - 体・髪・服は、部品（だ円体・先細りの筒）を骨ごとに置いて 1 つの SkinnedMesh にまとめる（1 頂点＝1 つの骨。
 *   色は頂点色）。描画命令は体で 1 回。関節は球でつなぐ
 * - 顔は、頭の曲面に沿わせた板に、キャンバスで目・眉・口・ほおを描く。表情が変わったときだけ描き直す
 * - 服はブラウスとショートパンツ。スカートにしないのは、座る・またがる・カートに乗るときに、布の計算なしでは
 *   腿を突き抜けるか、めくれるため
 * - 身長は 1.45m。家具や乗り物の座面は、前のモデル（1.4m）に合わせてあるので、近い背丈にする
 */

// --- 寸法（m。T ポーズ、足元が原点） ----------------------------------------------------
const SKIN = 0xf7d4bf;
const SKIN_SHADE = 0xeab9a2;
const HAIR = 0x6b4630;
const HAIR_LIGHT = 0x8a5c3e;
const BLOUSE = 0xf4f1ea;
const NAVY = 0x2b3a5c;
const RIBBON = 0xd84a4a;
const SOCK = 0xf2f2f2;
const SHOE = 0xe9e4dc;
const SOLE = 0xd9667a;
const PIN = 0xf2c230;

/** 骨：[名前, 親, 親からの位置]。左は +X（VRM と同じ） */
function boneTable() {
  const t = [
    ['hips', null, [0, 0.80, 0]],
    ['spine', 'hips', [0, 0.06, 0]],
    ['chest', 'spine', [0, 0.09, 0]],
    ['upperChest', 'chest', [0, 0.09, 0]],
    ['neck', 'upperChest', [0, 0.11, 0]],
    ['head', 'neck', [0, 0.05, 0]],
    ['hairL', 'head', [0.082 * HEAD_SCALE, 0.105 * HEAD_SCALE, 0.045 * HEAD_SCALE]],
    ['hairR', 'head', [-0.082 * HEAD_SCALE, 0.105 * HEAD_SCALE, 0.045 * HEAD_SCALE]],
  ];
  for (const [side, s] of [['left', 1], ['right', -1]]) {
    t.push(
      [`${side}Shoulder`, 'upperChest', [0.03 * s, 0.075, 0]],
      [`${side}UpperArm`, `${side}Shoulder`, [0.085 * s, 0, 0]],
      [`${side}LowerArm`, `${side}UpperArm`, [0.20 * s, 0, 0]],
      [`${side}Hand`, `${side}LowerArm`, [0.195 * s, 0, 0]],
      [`${side}UpperLeg`, 'hips', [0.07 * s, -0.035, 0]],
      [`${side}LowerLeg`, `${side}UpperLeg`, [0, -0.355, 0]],
      [`${side}Foot`, `${side}LowerLeg`, [0, -0.35, 0]],
      [`${side}Toes`, `${side}Foot`, [0, -0.045, 0.10]],
    );
    // 指：付け根の位置（手の骨から）と 3 節の長さ。親指は手のひらの前（+Z）から斜めに出る
    for (const [finger, z, len] of FINGERS) {
      const L = FINGER_LEN.map((v) => v * len);
      t.push(
        [`${side}${finger}Proximal`, `${side}Hand`, [0.076 * s, 0, z]],
        [`${side}${finger}Intermediate`, `${side}${finger}Proximal`, [L[0] * s, 0, 0]],
        [`${side}${finger}Distal`, `${side}${finger}Intermediate`, [L[1] * s, 0, 0]],
      );
    }
    t.push(
      [`${side}ThumbMetacarpal`, `${side}Hand`, [0.02 * s, -0.004, 0.022]],
      [`${side}ThumbProximal`, `${side}ThumbMetacarpal`, [0.018 * s, 0, 0.018]],
      [`${side}ThumbDistal`, `${side}ThumbProximal`, [0.016 * s, 0, 0.017]],
    );
  }
  return t;
}
const FINGERS = [['Index', 0.022, 1.0], ['Middle', 0.008, 1.08], ['Ring', -0.007, 1.0], ['Little', -0.021, 0.8]];
const FINGER_LEN = [0.026, 0.019, 0.016];

/** 頭の輪郭：頭の骨（首の上）からの高さ y での半径。あごは細く、目の高さでいちばん広い */
const HEAD_TOP = [[0.18, 0.075], [0.197, 0.053], [0.207, 0.031], [0.212, 0.0]];
// 向きごとの輪郭。回転体（どの向きも同じ輪郭）だと、横顔が丸い筒になる。
//   前：あごの先が前へ出て（あごの下は首へ向かって引っ込む）、口もと・ほおがふくらみ、目のあたりが少しくぼんで、おでこが丸い
//   横：あごの線は細く、耳の高さでいちばん広い
//   後ろ：首のつけ根は細く、後頭部が大きく丸く張り出す
const HEAD_FRONT = [[0.0, 0.03], [0.005, 0.05], [0.014, 0.0635], [0.03, 0.0775], [0.05, 0.0875], [0.076, 0.0905], [0.11, 0.099], [0.15, 0.094], ...HEAD_TOP];
const HEAD_SIDE = [[0.0, 0.02], [0.012, 0.038], [0.03, 0.062], [0.055, 0.086], [0.085, 0.097], [0.115, 0.1], [0.15, 0.093], ...HEAD_TOP];
const HEAD_BACK = [[0.0, 0.02], [0.015, 0.04], [0.04, 0.075], [0.07, 0.098], [0.11, 0.108], [0.15, 0.103], [0.18, 0.084], [0.197, 0.059], [0.207, 0.034], [0.212, 0.0]];
const HEAD_X = 0.95;   // 左右は少し細く
/** 頭・髪・顔の拡大率。絵としての頭身（5.5 頭身ほど）にする。頭の部品は等身大で作って、頭の骨を中心に広げる */
const HEAD_SCALE = 1.22;
/**
 * 点の並び [x, 値, 値, …] を、なめらかにつないだ曲線の x での値（col 番目の値）。
 * 点ごとの傾きを前後の点から決める 3 次の補間（Catmull-Rom）。前は点のあいだを smoothstep でつないでいたが、
 * それだと点ごとに傾きが 0 になり、輪郭が段々になる（顔・胴・手足が、がたがたに見えた）
 */
function spline(points, x, col = 1) {
  const n = points.length;
  if (x <= points[0][0]) return points[0][col];
  if (x >= points[n - 1][0]) return points[n - 1][col];
  let i = 1;
  while (i < n - 1 && points[i][0] < x) i++;
  const p0 = points[i - 1];
  const p1 = points[i];
  const h = p1[0] - p0[0];
  const slope = (k) => {
    const a = points[Math.max(0, k - 1)];
    const b = points[Math.min(n - 1, k + 1)];
    return (b[col] - a[col]) / (b[0] - a[0]);
  };
  const t = (x - p0[0]) / h;
  const t2 = t * t;
  const t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * p0[col] + (t3 - 2 * t2 + t) * h * slope(i - 1) + (-2 * t3 + 3 * t2) * p1[col] + (t3 - t2) * h * slope(i);
}
/** 頭の半径：頭の骨からの高さ y、まわりの角度 a（0 が正面、±π/2 が横、π が後ろ）。前・横・後ろの輪郭を、向きでなめらかに混ぜる */
function headR(y, a = 0) {
  if (y >= 0.212) return 0;
  const c = Math.cos(a);
  const wf = c > 0 ? c * c : 0;
  const wb = c < 0 ? c * c : 0;
  const r = spline(HEAD_FRONT, y) * wf + spline(HEAD_BACK, y) * wb + spline(HEAD_SIDE, y) * (1 - wf - wb);
  return Math.max(0, r);
}

// --- 部品を 1 つのジオメトリへ集める -----------------------------------------------------
function createBuilder() {
  const position = [];
  const normal = [];
  const color = [];
  const skinIndex = [];
  const skinWeight = [];
  const c = new THREE.Color();
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  const nm = new THREE.Matrix3();
  const full = new THREE.Matrix4();
  /** このあと足す部品にかける行列（頭の部品を、頭の骨を中心に広げるのに使う） */
  const pre = new THREE.Matrix4();
  /**
   * geometry を matrix で置き、bone に付ける。hex は色、または (置いたあとの位置) => 色。
   *shade を渡すと、下向きの面をその色へ寄せる（服のひだ・あごの下）。
   * skin(位置) を渡すと、頂点ごとに 2 つの骨へ分ける（[骨, 骨, 重み, 重み]。胴をなめらかに曲げる）
   */
  function add(geometry, matrix0, bone, hex, shade = null, skin = null) {
    const matrix = full.multiplyMatrices(pre, matrix0);
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    const p = g.attributes.position;
    const nn = g.attributes.normal;
    nm.getNormalMatrix(matrix);
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(matrix);
      n.fromBufferAttribute(nn, i).applyMatrix3(nm).normalize();
      position.push(v.x, v.y, v.z);
      normal.push(n.x, n.y, n.z);
      c.setHex(typeof hex === 'function' ? hex(v) : hex);
      if (shade !== null) c.lerp(SHADE.setHex(shade), THREE.MathUtils.clamp(-n.y * 0.9, 0, 1));
      color.push(c.r, c.g, c.b);
      if (skin) {
        const w = skin(v);
        skinIndex.push(w[0], w[1], 0, 0);
        skinWeight.push(w[2], w[3], 0, 0);
      } else {
        skinIndex.push(bone, 0, 0, 0);
        skinWeight.push(1, 0, 0, 0);
      }
    }
    if (g !== geometry) g.dispose();
  }
  function build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(color, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
    return g;
  }
  return { add, build, pre };
}
const SHADE = new THREE.Color();

const M = new THREE.Matrix4();
const Q = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);
const sphereGeo = new THREE.SphereGeometry(1, 18, 12);
const sphereLow = new THREE.SphereGeometry(1, 8, 6);

/**
 * @param {object} [options]
 * @param {THREE.Object3D} [options.camera] 最初に見る相手
 */
export function createGirlModel({ camera = null } = {}) {
  const scene = new THREE.Group();
  scene.name = 'girlModel';

  // --- 骨 --------------------------------------------------------------------------
  const table = boneTable();
  const bones = {};
  const list = [];
  const rest = {};   // 休止姿勢でのワールド位置（部品を置くのに使う）
  for (const [name, parent, pos] of table) {
    const bone = new THREE.Bone();
    bone.name = name;
    bone.position.fromArray(pos);
    bones[name] = bone;
    list.push(bone);
    if (parent) bones[parent].add(bone); else scene.add(bone);
    rest[name] = new THREE.Vector3().fromArray(pos).add(parent ? rest[parent] : new THREE.Vector3());
  }
  const index = Object.fromEntries(list.map((b, i) => [b.name, i]));

  // --- 部品 ------------------------------------------------------------------------
  const B = createBuilder();
  /** だ円体 */
  const ball = (bone, center, radii, hex, shade = null, geo = sphereGeo) => {
    M.compose(center, Q.identity(), new THREE.Vector3(radii[0], radii[1], radii[2]));
    B.add(geo, M, index[bone], hex, shade);
  };
  /** 先細りの筒（from → to）。両端は球で閉じる */
  const limb = (bone, from, to, r0, r1, hex, { caps = true, shade = null, seg = 14 } = {}) => {
    const dir = new THREE.Vector3().subVectors(to, from);
    const len = dir.length();
    const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1, true);
    Q.setFromUnitVectors(UP, dir.normalize());
    M.compose(new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5), Q, new THREE.Vector3(1, 1, 1));
    B.add(g, M, index[bone], hex, shade);
    g.dispose();
    if (caps) {
      ball(bone, from, [r0, r0, r0], hex, shade, seg <= 8 ? sphereLow : sphereGeo);
      ball(bone, to, [r1, r1, r1], hex, shade, seg <= 8 ? sphereLow : sphereGeo);
    }
  };
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  /**
   * 関節をまたぐ 1 本の管（腕・脚）。a → b のまっすぐな管で、途中の joint の前後 blend（m）は、上の骨と下の骨で
   * 分け合う（曲げても折れ目ができず、ひじ・ひざが丸く曲がる）。profile は [位置 0..1, 半径] の並び
   */
  const tube = (upper, lower, a, joint, b, profile, hex, { seg = 16, rows = 26, blend = 0.04, shade = null } = {}) => {
    const axis = new THREE.Vector3().subVectors(b, a);
    const len = axis.length();
    axis.normalize();
    const side1 = new THREE.Vector3(0, 0, 1);
    const side2 = new THREE.Vector3().crossVectors(axis, side1).normalize();
    const radius = (t) => spline(profile, t);
    const pos = [];
    const idx = [];
    for (let j = 0; j <= rows; j++) {
      const t = j / rows;
      const r = radius(t);
      for (let i = 0; i <= seg; i++) {
        const ang = (i / seg) * Math.PI * 2;
        const cx = Math.cos(ang) * r;
        const sx = Math.sin(ang) * r;
        pos.push(a.x + axis.x * len * t + side1.x * cx + side2.x * sx, a.y + axis.y * len * t + side1.y * cx + side2.y * sx, a.z + axis.z * len * t + side1.z * cx + side2.z * sx);
      }
    }
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < seg; i++) {
        const k = j * (seg + 1) + i;
        idx.push(k, k + seg + 1, k + 1, k + 1, k + seg + 1, k + seg + 2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const jointAt = new THREE.Vector3().subVectors(joint, a).dot(axis);
    const rel = new THREE.Vector3();
    const skin = (p) => {
      const w = THREE.MathUtils.smoothstep(rel.subVectors(p, a).dot(axis), jointAt - blend, jointAt + blend);
      return [index[upper], index[lower], 1 - w, w];
    };
    B.add(g, new THREE.Matrix4(), 0, hex, shade, skin);
    g.dispose();
    ball(upper, a, [profile[0][1], profile[0][1], profile[0][1]], typeof hex === 'function' ? hex(a) : hex, shade);
    const rEnd = profile[profile.length - 1][1];
    ball(lower, b, [rEnd, rEnd, rEnd], typeof hex === 'function' ? hex(b) : hex, shade);
  };

  // 胴：腰（ショートパンツ）・おなか・胸・肩まわり（ブラウス）
  ball('hips', V(0, 0.785, 0), [0.124, 0.092, 0.098], NAVY, 0x1c2742);
  // ブラウス：すそから えり元まで、1 つのなめらかな形（輪切りはだ円）。骨の境目の上下 3cm は、2 つの骨で分け合う
  {
    // [高さ, 左右の半径, 前後の半径, 前へのずれ]
    const rings = [[0.835, 0.119, 0.097, 0], [0.86, 0.11, 0.088, 0], [0.9, 0.098, 0.077, 0.002], [0.95, 0.102, 0.08, 0.006], [1.0, 0.11, 0.088, 0.012],
      [1.035, 0.114, 0.088, 0.012], [1.075, 0.118, 0.078, 0.004], [1.105, 0.11, 0.067, 0], [1.125, 0.075, 0.052, 0], [1.14, 0.042, 0.04, 0]];
    const SEG = 32;
    const pos = [];
    const idx = [];
    const ROWS = 44;
    const at = (y) => [spline(rings, y, 1), spline(rings, y, 2), spline(rings, y, 3)];
    for (let j = 0; j <= ROWS; j++) {
      const y = THREE.MathUtils.lerp(rings[0][0], rings[rings.length - 1][0], j / ROWS);
      const [rx, rz, oz] = at(y);
      for (let i = 0; i <= SEG; i++) {
        const a = (i / SEG) * Math.PI * 2;
        pos.push(Math.sin(a) * rx, y, Math.cos(a) * rz + oz);
      }
    }
    for (let j = 0; j < ROWS; j++) {
      for (let i = 0; i < SEG; i++) {
        const a = j * (SEG + 1) + i;
        idx.push(a, a + 1, a + SEG + 1, a + 1, a + SEG + 2, a + SEG + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const joints = [[rest.spine.y, 'hips', 'spine'], [rest.chest.y, 'spine', 'chest'], [rest.upperChest.y, 'chest', 'upperChest']];
    const skin = (p) => {
      for (const [jy, lower, upper] of joints) {
        if (p.y < jy + 0.03) {
          const t = THREE.MathUtils.smoothstep(p.y, jy - 0.03, jy + 0.03);
          return [index[lower], index[upper], 1 - t, t];
        }
      }
      return [index.upperChest, 0, 1, 0];
    };
    B.add(g, new THREE.Matrix4(), 0, BLOUSE, 0xcdd2dc, skin);
    g.dispose();
  }
  // えりと、胸のリボン
  limb('upperChest', V(0, 1.118, 0), V(0, 1.146, 0), 0.058, 0.04, NAVY, { caps: false, seg: 16 });
  for (const s of [1, -1]) ball('upperChest', V(0.022 * s, 1.1, 0.07), [0.022, 0.013, 0.009], RIBBON);
  ball('upperChest', V(0, 1.1, 0.074), [0.008, 0.01, 0.008], 0xb53838);
  // 首
  // 首：付け根は太く、上は細く。頭の中まで入れて、あごの下の面とつなぐ。少し前へ傾ける
  limb('neck', V(0, 1.11, -0.004), V(0, 1.16, 0), 0.037, 0.03, SKIN, { caps: false, shade: SKIN_SHADE, seg: 18 });
  limb('neck', V(0, 1.16, 0), V(0, 1.225, 0.004), 0.03, 0.03, SKIN, { caps: false, shade: SKIN_SHADE, seg: 18 });

  for (const [side, s] of [['left', 1], ['right', -1]]) {
    const sh = rest[`${side}UpperArm`];
    const el = rest[`${side}LowerArm`];
    const wr = rest[`${side}Hand`];
    // 肩（ふくらんだ袖）・二の腕・ひじ・前腕
    // 袖：胴の中から肩を通って二の腕の途中まで、1 本のなめらかな形。肩の関節の前後は、肩の骨と腕の骨で分け合う
    // （前は腕の骨に固定した球だったので、腕を下ろすと、胴と別の玉が付いているように見えた）
    tube(`${side}Shoulder`, `${side}UpperArm`, V(0.055 * s, sh.y - 0.004, 0), sh, V(sh.x + 0.085 * s, sh.y, 0),
      [[0, 0.05], [0.35, 0.051], [0.6, 0.049], [0.85, 0.044], [1, 0.041]], BLOUSE, { shade: 0xcdd2dc, seg: 18, rows: 18, blend: 0.035 });
    {
      const a = V(sh.x + 0.06 * s, sh.y, 0);
      const tj = Math.abs(el.x - a.x) / Math.abs(wr.x - a.x);
      tube(`${side}UpperArm`, `${side}LowerArm`, a, el, wr, [[0, 0.036], [0.2, 0.0345], [tj, 0.0295], [tj + 0.16, 0.0305], [1, 0.0215]], SKIN, { shade: SKIN_SHADE, seg: 14, blend: 0.035 });
    }
    // 手のひらと指
    ball(`${side}Hand`, V(wr.x + 0.04 * s, wr.y, 0.001), [0.042, 0.012, 0.031], SKIN, SKIN_SHADE);
    for (const [finger] of FINGERS) {
      const names = ['Proximal', 'Intermediate', 'Distal'].map((j) => `${side}${finger}${j}`);
      names.forEach((name, i) => {
        const a = rest[name];
        const b = i < 2 ? rest[names[i + 1]] : V(a.x + FINGER_LEN[2] * s * (finger === 'Little' ? 0.8 : 1), a.y, a.z);
        limb(name, a, b, 0.0082 - i * 0.0008, 0.0076 - i * 0.0008, SKIN, { seg: 6 });
      });
    }
    {
      const a = rest[`${side}ThumbMetacarpal`];
      const b = rest[`${side}ThumbProximal`];
      const c2 = rest[`${side}ThumbDistal`];
      limb(`${side}ThumbMetacarpal`, a, b, 0.011, 0.0095, SKIN, { seg: 6 });
      limb(`${side}ThumbProximal`, b, c2, 0.0092, 0.0086, SKIN, { seg: 6 });
      limb(`${side}ThumbDistal`, c2, V(c2.x + 0.012 * s, c2.y, c2.z + 0.013), 0.0086, 0.0076, SKIN, { seg: 6 });
    }

    // 脚：ショートパンツのすそ・腿・ひざ・すね・靴下・靴
    const hip = rest[`${side}UpperLeg`];
    const knee = rest[`${side}LowerLeg`];
    const ankle = rest[`${side}Foot`];
    limb(`${side}UpperLeg`, V(hip.x, hip.y + 0.03, 0), V(hip.x, hip.y - 0.14, 0), 0.07, 0.069, NAVY, { caps: false, shade: 0x1c2742, seg: 16 });
    ball(`${side}UpperLeg`, V(hip.x, hip.y + 0.01, 0), [0.07, 0.06, 0.07], NAVY, 0x1c2742);
    {
      // 腿 → ひざ → ふくらはぎ → 足首。足首から 12cm は靴下の色
      const a = V(hip.x, hip.y - 0.02, 0);
      const b = V(ankle.x, ankle.y + 0.005, 0);
      const tj = (a.y - knee.y) / (a.y - b.y);
      const sockTop = ankle.y + 0.12;
      tube(`${side}UpperLeg`, `${side}LowerLeg`, a, knee, b, [[0, 0.061], [0.25, 0.056], [tj, 0.0455], [tj + 0.15, 0.048], [0.86, 0.035], [1, 0.033]],
        (p) => (p.y < sockTop ? SOCK : SKIN), { shade: null, seg: 18, rows: 34, blend: 0.045 });
      // 靴下のふち
      limb(`${side}LowerLeg`, V(ankle.x, sockTop + 0.004, 0), V(ankle.x, sockTop - 0.012, 0), 0.0395, 0.0385, SOCK, { caps: false });
    }
    ball(`${side}Foot`, V(ankle.x, 0.04, 0.035), [0.043, 0.04, 0.095], SHOE, 0xb9b2a8);
    ball(`${side}Foot`, V(ankle.x, 0.014, 0.035), [0.045, 0.014, 0.098], SOLE);
    ball(`${side}Foot`, V(ankle.x, 0.07, 0.0), [0.037, 0.03, 0.045], SHOE);
  }

  // ここから頭・髪：等身大で作り、頭の骨を中心に HEAD_SCALE 倍に広げる
  B.pre.makeTranslation(rest.head.x, rest.head.y, rest.head.z).scale(V(HEAD_SCALE, HEAD_SCALE, HEAD_SCALE)).multiply(new THREE.Matrix4().makeTranslation(-rest.head.x, -rest.head.y, -rest.head.z));
  // 頭：向きごとに輪郭の違う立体（headR）。左右は少し細く
  {
    const SEG = 52;
    const ROWS = 48;
    const pos = [];
    const idx = [];
    for (let j = 0; j <= ROWS; j++) {
      const y = (j / ROWS) * 0.212;
      for (let i = 0; i <= SEG; i++) {
        const a = (i / SEG) * Math.PI * 2 - Math.PI;
        const r = Math.max(0.0005, headR(y, a));
        pos.push(rest.head.x + Math.sin(a) * r * HEAD_X, rest.head.y + y, Math.cos(a) * r);
      }
    }
    for (let j = 0; j < ROWS; j++) {
      for (let i = 0; i < SEG; i++) {
        const k = j * (SEG + 1) + i;
        idx.push(k, k + 1, k + SEG + 1, k + 1, k + SEG + 2, k + SEG + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    B.add(g, new THREE.Matrix4(), index.head, SKIN, SKIN_SHADE);
    g.dispose();
    // 鼻：ごく小さなふくらみ（顔の面から 2mm ほど出るだけ。大きいと、横から見て玉が付いているように見える）
    // 鼻：鼻筋から鼻先へなだらかに出る、しずく形（先は 7mm ほど出る。玉のままだと付け鼻に、小さすぎると平らに見える）
    {
      const g = new THREE.SphereGeometry(1, 14, 12);
      const p = g.attributes.position;
      for (let k = 0; k < p.count; k++) {
        const yy = p.getY(k);
        if (yy > 0) { p.setX(k, p.getX(k) * (1 - yy * 0.55)); p.setZ(k, p.getZ(k) * (1 - yy * 0.8)); }
      }
      g.computeVertexNormals();
      M.compose(V(0, rest.head.y + 0.056, headR(0.056) - 0.0035), Q.identity(), V(0.0062, 0.016, 0.0105));
      B.add(g, M, index.head, SKIN, SKIN_SHADE);
      g.dispose();
    }
    // あごの下の面（あご先から首へ）・耳
    ball('head', V(0, rest.head.y + 0.006, 0.012), [0.034, 0.011, 0.04], SKIN, SKIN_SHADE);
    for (const s of [1, -1]) ball('head', V((headR(0.078, Math.PI / 2) * HEAD_X - 0.003) * s, rest.head.y + 0.078, -0.006), [0.011, 0.021, 0.015], SKIN, SKIN_SHADE);
  }

  // 髪：頭を包むボブ。前は生えぎわまで、横と後ろはあごの下まで下ろす
  {
    const hy = rest.head.y;
    const SEG = 66;
    const ROWS = 14;
    const TOP = 0.218;
    const pos = [];
    const idx = [];
    /** まわりの角度（0 が正面）での、髪のすその高さ */
    const hem = (a) => {
      const f = Math.abs(a);
      const side = THREE.MathUtils.smoothstep(f, 0.95, 1.3);         // 0 = 前髪の生えぎわ、1 = 横・後ろ
      const back = THREE.MathUtils.smoothstep(f, 1.5, 2.6);
      // 横と後ろのすそは、房ごとに少し上下させる（まっすぐ切りそろえると、ヘルメットに見える）
      return THREE.MathUtils.lerp(0.128, THREE.MathUtils.lerp(-0.012, -0.04, back) + Math.sin(a * 11) * 0.006 * side, side);
    };
    for (let i = 0; i <= SEG; i++) {
      const a = (i / SEG) * Math.PI * 2 - Math.PI;
      const bottom = hem(a);
      for (let j = 0; j <= ROWS; j++) {
        const t = j / ROWS;
        const y = THREE.MathUtils.lerp(TOP, bottom, t);
        // 頭より少し外。耳より下は、頭がすぼまっても髪はまっすぐ下ろす（すそは少し内へ）
        // てっぺんは、頭の丸みに沿って閉じる（まっすぐ絞ると、とがる）
        const yy = y * (0.212 / TOP);
        const r = Math.max(0.0005, Math.max(headR(yy, a), y < 0.09 ? 0.097 - Math.max(0, 0.02 - y) * 0.25 : 0) * 1.06
          + 0.007 * (1 - THREE.MathUtils.smoothstep(y, 0.19, TOP)));
        pos.push(Math.sin(a) * r * HEAD_X, hy + y, Math.cos(a) * r);
      }
    }
    for (let i = 0; i < SEG; i++) {
      for (let j = 0; j < ROWS; j++) {
        const a = i * (ROWS + 1) + j;
        const b = a + ROWS + 1;
        idx.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    // 色：縦の筋（房ごとに明るさを変える）と、頭のてっぺんの少し下の明るい輪（つやの帯）。すそは暗く
    const hc = new THREE.Color();
    const hl = new THREE.Color(HAIR_LIGHT);
    const hd = new THREE.Color(0x4f3222);
    const hairColor = (p) => {
      const ang = Math.atan2(p.x - rest.head.x, p.z - rest.head.z);
      const h = (p.y - rest.head.y) / HEAD_SCALE;
      const strand = 0.5 + 0.5 * Math.sin(ang * 11 + Math.sin(ang * 3) * 1.5);
      const ring = Math.exp(-(((h - 0.172) / 0.014) ** 2)) * (0.55 + 0.45 * Math.sin(ang * 23));
      hc.setHex(HAIR).lerp(hl, strand * 0.45 + ring * 0.75).lerp(hd, THREE.MathUtils.clamp((0.03 - h) / 0.07, 0, 0.6));
      return hc.getHex();
    };
    B.add(g, new THREE.Matrix4(), index.head, hairColor, 0x4a2f20);
    g.dispose();
    // 前髪：生えぎわから眉の上へ下がる房。1 つおきに色を明るく
    // 薄く、下がとがった房を、少しずつ重ねて並べる（丸い玉を並べると、ソーセージに見える）
    [-0.98, -0.74, -0.5, -0.27, -0.04, 0.2, 0.44, 0.68, 0.92].forEach((a, i) => {
      const r = headR(0.112, a) + 0.0075;
      const g2 = new THREE.SphereGeometry(1, 10, 10);
      // 下へ行くほど細く（しずくを逆さにした形）
      const p2 = g2.attributes.position;
      for (let k = 0; k < p2.count; k++) {
        const yy = p2.getY(k);
        const taper = yy < 0 ? 1 + yy * 0.72 : 1;
        p2.setX(k, p2.getX(k) * taper);
      }
      g2.computeVertexNormals();
      // 眉のすぐ上で止める（目にかけない）。こめかみの房だけ少し長く
      const len = 0.027 + (i % 3 === 1 ? 0.004 : 0) + (Math.abs(a) > 0.8 ? 0.012 : 0);
      const e = new THREE.Euler(0.1, a, (i % 2 ? 0.2 : -0.16) + a * 0.12);
      M.compose(V(Math.sin(a) * r * HEAD_X, hy + 0.114 + len - (Math.abs(a) > 0.8 ? 0.02 : 0), Math.cos(a) * r), Q.setFromEuler(e), V(0.021, len, 0.0085));
      B.add(g2, M, index.head, i % 2 ? HAIR_LIGHT : HAIR, 0x4a2f20);
      g2.dispose();
    });
    // 横の房（耳の前に下がる。少し揺れる）と、髪留め
    for (const [side, s] of [['hairL', 1], ['hairR', -1]]) {
      const g2 = new THREE.SphereGeometry(1, 10, 10);
      M.compose(V(0.088 * s, hy + 0.05, 0.038), Q.setFromEuler(new THREE.Euler(0, 1.25 * s, 0.03 * s)), V(0.024, 0.072, 0.009));
      B.add(g2, M, index[side], HAIR_LIGHT, 0x4a2f20);
      g2.dispose();
    }
    for (const tilt of [0.5, -0.5]) {
      const g2 = new THREE.CapsuleGeometry(0.0042, 0.03, 3, 6);
      const a = 0.86;
      const r = headR(0.125, a) + 0.021;
      M.compose(V(Math.sin(a) * r * HEAD_X, hy + 0.128, Math.cos(a) * r), Q.setFromEuler(new THREE.Euler(0, a, Math.PI / 2 + tilt)), V(1, 1, 1));
      B.add(g2, M, index.head, PIN);
      g2.dispose();
    }
  }

  B.pre.identity();

  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0, side: THREE.DoubleSide });
  const body = new THREE.SkinnedMesh(B.build(), material);
  body.name = 'girlBody';
  scene.add(body);
  scene.updateMatrixWorld(true);
  body.bind(new THREE.Skeleton(list));

  // --- 顔 --------------------------------------------------------------------------
  const face = createFace();
  face.mesh.scale.setScalar(HEAD_SCALE);
  bones.head.add(face.mesh);

  // --- 表情・視線・髪 ----------------------------------------------------------------
  const values = {};
  const lookAt = { target: camera };
  const local = new THREE.Vector3();
  const headPos = new THREE.Vector3();
  const lastHead = new THREE.Vector3();
  const headVel = new THREE.Vector3();
  const headQ = new THREE.Quaternion();
  let primed = false;
  const sway = { x: 0, z: 0, vx: 0, vz: 0 };

  function update(dt) {
    // ひとみ：見る相手の向き（頭から見て）。正面から大きく外れたら、追うのをやめて前を見る
    let ex = 0;
    let ey = 0;
    if (lookAt.target) {
      lookAt.target.getWorldPosition(local);
      bones.head.worldToLocal(local);
      local.y -= EYE.y * HEAD_SCALE;
      const yaw = Math.atan2(local.x, local.z);
      const pitch = Math.atan2(local.y, Math.hypot(local.x, local.z));
      if (Math.abs(yaw) < 1.2 && local.z > 0) {
        ex = THREE.MathUtils.clamp(yaw / 0.7, -1, 1);
        ey = THREE.MathUtils.clamp(pitch / 0.6, -1, 1);
      }
    }
    face.draw(values, ex, ey);

    // 横の房：頭の動きに遅れてついてくる（ばねと減衰）。頭が傾いたぶんは、重力でまっすぐ下がろうとする
    bones.head.getWorldPosition(headPos);
    bones.head.getWorldQuaternion(headQ);
    if (!primed) { lastHead.copy(headPos); primed = true; }
    const step = Math.min(dt, 0.05);
    if (step > 0) {
      headVel.subVectors(headPos, lastHead).divideScalar(step).applyQuaternion(headQ.invert());
      lastHead.copy(headPos);
      const wantX = THREE.MathUtils.clamp(headVel.z * 0.12, -0.5, 0.5);
      const wantZ = THREE.MathUtils.clamp(-headVel.x * 0.12, -0.5, 0.5);
      sway.vx += ((wantX - sway.x) * 60 - sway.vx * 9) * step;
      sway.vz += ((wantZ - sway.z) * 60 - sway.vz * 9) * step;
      sway.x += sway.vx * step;
      sway.z += sway.vz * step;
      for (const b of [bones.hairL, bones.hairR]) b.rotation.set(sway.x, 0, sway.z);
    }
  }

  const humanoid = {
    getNormalizedBoneNode: (name) => bones[name] ?? null,
    getRawBoneNode: (name) => bones[name] ?? null,
  };

  return {
    scene,
    humanoid,
    expressionManager: {
      setValue(name, value) { values[name] = value; },
      getValue(name) { return values[name] ?? 0; },
    },
    lookAt,
    springBoneManager: null,
    meta: { name: 'オリジナルの女の子（コードで生成）', authors: ['vrsample'] },
    update,
    /** 検証用 */
    get faceState() { return face.state; },
  };
}

// --- 顔の絵 ------------------------------------------------------------------------------
/** 顔の板の範囲（頭の骨から。m） */
const FACE = { x0: -0.08, x1: 0.08, y0: 0.004, y1: 0.152 };
/** 顔の板が、正面から左右へ回り込む角度（rad） */
const FACE_ANGLE = 1.02;
const EYE = { x: 0.0315, y: 0.074, rx: 0.0165, ry: 0.0205 };

function createFace() {
  const SIZE = 512;
  // 絵は 512 の目盛りで描き、キャンバスは 2 倍の細かさにする（近くで見ても、線がぎざぎざにならない）
  const canvas = document.createElement('canvas');
  canvas.width = SIZE * 2;
  canvas.height = SIZE * 2;
  const ctx = canvas.getContext('2d');
  ctx.scale(2, 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;

  // 頭の曲面に沿わせた板（頭より 1.5mm 外）
  const NX = 36;
  const NY = 32;
  const pos = [];
  const uv = [];
  const idx = [];
  for (let j = 0; j <= NY; j++) {
    const v = j / NY;
    const y = THREE.MathUtils.lerp(FACE.y0, FACE.y1, v);
    for (let i = 0; i <= NX; i++) {
      // 正面から左右へ FACE_ANGLE まで、頭の面に沿って置く。絵の横の位置は、正面から見た位置（x）で決める
      // （こうすると、正面から見た絵はゆがまず、横へ回り込むぶんだけ縮む）
      const a = THREE.MathUtils.lerp(-FACE_ANGLE, FACE_ANGLE, i / NX);
      const r = headR(y, a);
      const x = Math.sin(a) * r * HEAD_X;
      pos.push(x, y, Math.cos(a) * r + 0.0015);
      uv.push(THREE.MathUtils.clamp((x - FACE.x0) / (FACE.x1 - FACE.x0), 0, 1), v);
    }
  }
  for (let j = 0; j < NY; j++) {
    for (let i = 0; i < NX; i++) {
      const a = j * (NX + 1) + i;
      idx.push(a, a + 1, a + NX + 1, a + 1, a + NX + 2, a + NX + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(idx);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
    map: texture, transparent: true, roughness: 0.85, metalness: 0, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  }));
  mesh.name = 'girlFace';
  mesh.renderOrder = 2;

  const W = FACE.x1 - FACE.x0;
  const H = FACE.y1 - FACE.y0;
  const px = (x) => ((x - FACE.x0) / W) * SIZE;
  const py = (y) => (1 - (y - FACE.y0) / H) * SIZE;
  const sx = SIZE / W;
  const sy = SIZE / H;

  let signature = '';
  const state = { draws: 0, last: null };

  function eye(side, open, smile, wide, ex, ey) {
    const cx = px(EYE.x * side);
    const cy = py(EYE.y);
    const rx = EYE.rx * sx * (1 + wide * 0.08);
    const ry = EYE.ry * sy * (1 + wide * 0.16);
    ctx.lineCap = 'round';
    // 笑った目・閉じた目は、弧 1 本で描く（笑顔は上へふくらむ ∩、まばたきは下へふくらむ ∪）
    if (open < 0.14) {
      ctx.strokeStyle = '#3a2420';
      ctx.lineWidth = 7;
      ctx.beginPath();
      const bend = smile > 0.5 ? -ry * 0.42 : ry * 0.2;
      ctx.moveTo(cx - rx * 0.95, cy + ry * 0.05);
      ctx.quadraticCurveTo(cx, cy + ry * 0.05 + bend * 2, cx + rx * 0.95, cy + ry * 0.05);
      ctx.stroke();
      return;
    }
    const top = cy - ry * (2 * open - 1);   // まぶたの下がった高さ
    ctx.save();
    // 目の形（上がまぶたで切れる）
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.clip();
    ctx.beginPath();
    ctx.rect(cx - rx - 2, top, rx * 2 + 4, ry * 2 + 4);
    ctx.clip();
    // 白目（上は少し影）
    const white = ctx.createLinearGradient(0, cy - ry, 0, cy + ry);
    white.addColorStop(0, '#d9dbe6');
    white.addColorStop(0.35, '#ffffff');
    ctx.fillStyle = white;
    ctx.fillRect(cx - rx - 2, cy - ry - 2, rx * 2 + 4, ry * 2 + 4);
    // ひとみ：上が濃く、下が明るい
    const ix = cx + ex * rx * 0.3;
    const iy = cy - ey * ry * 0.2 + ry * 0.06;
    const irx = rx * 0.7;
    const iry = ry * 0.82;
    const iris = ctx.createLinearGradient(0, iy - iry, 0, iy + iry);
    iris.addColorStop(0, '#3b2416');
    iris.addColorStop(0.45, '#8a5226');
    iris.addColorStop(1, '#e0a050');
    ctx.fillStyle = iris;
    ctx.beginPath();
    ctx.ellipse(ix, iy, irx, iry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#24140e';
    ctx.beginPath();
    ctx.ellipse(ix, iy - iry * 0.05, irx * 0.42, iry * 0.46, 0, 0, Math.PI * 2);
    ctx.fill();
    // 光：左上に大きく、右下に小さく
    ctx.fillStyle = 'rgba(255,255,255,0.96)';
    ctx.beginPath();
    ctx.ellipse(ix - irx * 0.36, iy - iry * 0.42, irx * 0.26, iry * 0.2, -0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.beginPath();
    ctx.ellipse(ix + irx * 0.36, iy + iry * 0.42, irx * 0.13, iry * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // 上まつげ（太い弧。目じりを少しはね上げる）と、下まつげ（細く）
    ctx.strokeStyle = '#3a2420';
    ctx.lineWidth = 7;
    ctx.beginPath();
    let tipX;
    let tipY;
    if (top <= cy - ry * 0.9) {
      // 開いた目：目の上のふちに沿った弧
      ctx.ellipse(cx, cy, rx, ry, 0, Math.PI * 1.06, Math.PI * 1.94);
      tipX = cx + side * rx * Math.cos(Math.PI * 0.06);
      tipY = cy - ry * Math.sin(Math.PI * 0.06);
    } else {
      // まぶたが下がった目：その高さの横線（少し上へふくらむ）
      const half = rx * Math.sqrt(Math.max(0.05, 1 - ((top - cy) / ry) ** 2));
      ctx.moveTo(cx - half, top + 1);
      ctx.quadraticCurveTo(cx, top - ry * 0.12, cx + half, top + 1);
      tipX = cx + side * half;
      tipY = top + 1;
    }
    ctx.stroke();
    // 目じりを少しはね上げる
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX + side * rx * 0.22, tipY - ry * 0.14);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(90,56,46,0.55)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx * 0.9, ry * 0.98, 0, Math.PI * 0.25, Math.PI * 0.75);
    ctx.stroke();
  }

  function draw(values, ex, ey) {
    const g = (k) => THREE.MathUtils.clamp(values[k] ?? 0, 0, 1);
    const happy = g('happy');
    const relaxed = g('relaxed');
    const surprised = g('surprised');
    const blink = g('blink');
    const blinkR = Math.max(blink, g('blinkRight'));
    const aa = g('aa');
    const ih = g('ih');
    const ou = g('ou');
    const ee = g('ee');
    const oh = g('oh');
    // 変わったときだけ描き直す（テクスチャの転送は重い）
    const q = (v, n = 20) => Math.round(v * n);
    const sig = [q(happy), q(relaxed), q(surprised), q(blink, 8), q(blinkR, 8), q(aa, 10), q(ih, 10), q(ou, 10), q(ee, 10), q(oh, 10), q(ex, 6), q(ey, 6)].join(',');
    if (sig === signature) return;
    signature = sig;
    state.draws++;
    state.last = { happy, blink, aa, ex, ey };

    ctx.clearRect(0, 0, SIZE, SIZE);
    // ほお：いつも少し。笑うと濃く
    for (const s of [1, -1]) {
      const cx = px(0.05 * s);
      const cy = py(0.05);
      const blush = ctx.createRadialGradient(cx, cy, 0, cx, cy, 0.024 * sx);
      blush.addColorStop(0, `rgba(240,120,120,${0.22 + happy * 0.22})`);
      blush.addColorStop(1, 'rgba(240,120,120,0)');
      ctx.fillStyle = blush;
      ctx.fillRect(cx - 0.03 * sx, cy - 0.03 * sy, 0.06 * sx, 0.06 * sy);
    }
    // 目。笑顔は細め、ゆるんだ顔は少しまぶたを下げ、驚きは見開く。向かって右が女の子の左目（+X）
    const base = 1 - happy * 0.5 - relaxed * 0.28;
    const openL = base * (1 - blink);
    const openR = base * (1 - blinkR);
    eye(1, happy > 0.82 ? 0 : openL, happy, surprised, ex, ey);
    // ウインク（右だけ閉じる）は、笑った目の弧（∩）で
    eye(-1, happy > 0.82 ? 0 : openR, happy > 0.82 || blinkR - blink > 0.5 ? 1 : 0, surprised, ex, ey);
    // 眉：細い弧。驚きで上がり、笑顔で少し下がる
    ctx.strokeStyle = '#6b4630';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    for (const s of [1, -1]) {
      const by = 0.116 + surprised * 0.008 - happy * 0.002;
      ctx.beginPath();
      ctx.moveTo(px((EYE.x - 0.018) * s), py(by - 0.002));
      ctx.quadraticCurveTo(px(EYE.x * s), py(by + 0.005 + surprised * 0.003), px((EYE.x + 0.02) * s), py(by - 0.001));
      ctx.stroke();
    }
    // 鼻は立体（頭の部品）。絵では、下に小さな影だけ
    ctx.fillStyle = 'rgba(200,130,110,0.4)';
    ctx.beginPath();
    ctx.ellipse(px(0), py(0.0445), 5, 1.8, 0, 0, Math.PI * 2);
    ctx.fill();
    // 口。開きは「あ・お・え・い・う」の重みから、幅と高さを決める。閉じているときは笑みの弧
    const mx = px(0);
    const my = py(0.031);
    const openAmt = Math.max(aa, oh * 0.8, ee * 0.5, ih * 0.3, ou * 0.5);
    const w = (0.0125 + happy * 0.004 + ee * 0.004 + ih * 0.005 + aa * 0.002 - ou * 0.006 - oh * 0.004) * sx;
    const h = (aa * 0.013 + oh * 0.011 + ee * 0.006 + ih * 0.004 + ou * 0.006) * sy;
    if (openAmt < 0.08) {
      ctx.strokeStyle = '#a8483e';
      ctx.lineWidth = 4.5;
      ctx.beginPath();
      const curve = (0.0035 + happy * 0.006 + relaxed * 0.002) * sy;
      ctx.moveTo(mx - w, my - curve * 0.4);
      ctx.quadraticCurveTo(mx, my + curve * 1.3, mx + w, my - curve * 0.4);
      ctx.stroke();
    } else {
      // 開いた口：上はほぼ平ら、下が丸い。奥に舌の色
      ctx.fillStyle = '#7a2c2a';
      ctx.beginPath();
      ctx.moveTo(mx - w, my - h * 0.35);
      ctx.quadraticCurveTo(mx, my - h * (0.55 - happy * 0.25), mx + w, my - h * 0.35);
      ctx.quadraticCurveTo(mx + w * 0.9, my + h * 1.25, mx, my + h * 1.3);
      ctx.quadraticCurveTo(mx - w * 0.9, my + h * 1.25, mx - w, my - h * 0.35);
      ctx.closePath();
      ctx.fill();
      ctx.save();
      ctx.clip();
      ctx.fillStyle = '#e07a7a';
      ctx.beginPath();
      ctx.ellipse(mx, my + h * 1.25, w * 0.7, h * 0.7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    texture.needsUpdate = true;
  }

  draw({}, 0, 0);
  return { mesh, draw, state };
}
