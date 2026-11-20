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
 * - 大人の体つき（身長 1.62m・7 頭身ほど）。体・髪・服は、部品（なめらかな輪切りの管・先細りの筒・だ円体）を骨ごとに
 *   置いて 1 つの SkinnedMesh にまとめる（色は頂点色、描画命令は体で 1 回）。関節の前後は 2 つの骨で分け合う
 * - 頭は、前・横・後ろで輪郭の違う立体（headR）。鼻とほおは、頭の面そのものを盛り上げる（別の部品を貼らない）
 * - 顔は、頭の曲面に沿わせた板に、キャンバスで目・眉・唇・生えぎわを描く。表情が変わったときだけ描き直す
 * - 髪は黒のストレートのロング。前髪は眉の上でまっすぐ切りそろえる（横は肩の上まで、背中は長く）
 * - 服は黒の長そでニット（ハイネック）と、ウエストをリボンで結んだ黒のフレアスカート、黒のパンプス。
 *   スカートは腰と左右の腿の骨で分け合う（座ると腿の上に乗る。布の計算はしない）
 * - 実在の人の顔には似せない（顔立ちの系統と雰囲気だけを参考にする）
 */

// --- 寸法（m。T ポーズ、足元が原点） ----------------------------------------------------
const SKIN = 0xf2cdb6;
const SKIN_SHADE = 0xd9a88f;
const HAIR = 0x1d1714;
const HAIR_LIGHT = 0x4a3528;
const HAIR_DARK = 0x0d0a09;
// 服：黒の長そでニット（ハイネック）と、黒のフレアスカート（ウエストをリボンで結ぶ）、黒のパンプス
const DRESS = 0x1d1d22;
const DRESS_SHADE = 0x0e0e11;
const SKIRT = 0x26262c;
const SKIRT_SHADE = 0x101013;
const SLIP = 0x1f1f24;
const SHOE = 0x18181b;
const SOLE = 0x0b0b0c;
/** スカートのすその高さ（立った姿勢。m） */
const SKIRT_HEM = 0.55;

/** 骨：[名前, 親, 親からの位置]。左は +X（VRM と同じ）。身長 1.62m・7 頭身ほどの、大人の体つき */
function boneTable() {
  const t = [
    ['hips', null, [0, 0.93, 0]],
    ['spine', 'hips', [0, 0.07, 0]],
    ['chest', 'spine', [0, 0.10, 0]],
    ['upperChest', 'chest', [0, 0.10, 0]],
    ['neck', 'upperChest', [0, 0.115, 0]],
    ['head', 'neck', [0, 0.052, 0]],
    ['hairL', 'head', [0.072, 0.13, 0.05]],
    ['hairR', 'head', [-0.072, 0.13, 0.05]],
  ];
  for (const [side, s] of [['left', 1], ['right', -1]]) {
    t.push(
      [`${side}Shoulder`, 'upperChest', [0.035 * s, 0.085, 0]],
      [`${side}UpperArm`, `${side}Shoulder`, [0.095 * s, 0, 0]],
      [`${side}LowerArm`, `${side}UpperArm`, [0.245 * s, 0, 0]],
      [`${side}Hand`, `${side}LowerArm`, [0.225 * s, 0, 0]],
      [`${side}UpperLeg`, 'hips', [0.078 * s, -0.04, 0]],
      [`${side}LowerLeg`, `${side}UpperLeg`, [0, -0.41, 0]],
      [`${side}Foot`, `${side}LowerLeg`, [0, -0.40, 0]],
      [`${side}Toes`, `${side}Foot`, [0, -0.06, 0.11]],
    );
    // 指：付け根の位置（手の骨から）と 3 節の長さ。親指は手のひらの前（+Z）から斜めに出る
    for (const [finger, z, len] of FINGERS) {
      const L = FINGER_LEN.map((v) => v * len);
      t.push(
        [`${side}${finger}Proximal`, `${side}Hand`, [0.08 * s, 0, z]],
        [`${side}${finger}Intermediate`, `${side}${finger}Proximal`, [L[0] * s, 0, 0]],
        [`${side}${finger}Distal`, `${side}${finger}Intermediate`, [L[1] * s, 0, 0]],
      );
    }
    t.push(
      [`${side}ThumbMetacarpal`, `${side}Hand`, [0.022 * s, -0.004, 0.022]],
      [`${side}ThumbProximal`, `${side}ThumbMetacarpal`, [0.02 * s, 0, 0.019]],
      [`${side}ThumbDistal`, `${side}ThumbProximal`, [0.018 * s, 0, 0.018]],
    );
  }
  return t;
}
const FINGERS = [['Index', 0.022, 1.0], ['Middle', 0.008, 1.08], ['Ring', -0.007, 1.0], ['Little', -0.021, 0.8]];
const FINGER_LEN = [0.03, 0.022, 0.018];

/** 頭の高さ（頭の骨＝首の上から、てっぺんまで） */
const HEAD_H = 0.225;
const HEAD_TOP = [[0.19, 0.073], [0.208, 0.05], [0.219, 0.03], [HEAD_H, 0.0]];
// 向きごとの輪郭（頭の骨からの高さ, 半径）。回転体（どの向きも同じ輪郭）だと、横顔が丸い筒になる。
//   前：あごの先が前へ出て（あごの下は首へ向かって引っ込む）、口もと・ほおがふくらみ、目のあたりが少しくぼんで、おでこが丸い
//   横：あごの線は細く、ほお骨から耳の高さでいちばん広い（大人の顔は、子どもより面長で幅が狭い）
//   後ろ：首のつけ根は細く、後頭部が大きく丸く張り出す
const HEAD_FRONT = [[0.0, 0.028], [0.005, 0.05], [0.013, 0.0605], [0.03, 0.0725], [0.058, 0.0795], [0.09, 0.0815], [0.125, 0.0885], [0.16, 0.0915], ...HEAD_TOP];
const HEAD_SIDE = [[0.0, 0.018], [0.012, 0.033], [0.03, 0.052], [0.055, 0.068], [0.085, 0.0765], [0.12, 0.079], [0.16, 0.073], [0.19, 0.06], [0.208, 0.042], [0.219, 0.025], [HEAD_H, 0.0]];
const HEAD_BACK = [[0.0, 0.022], [0.02, 0.045], [0.045, 0.075], [0.08, 0.095], [0.12, 0.102], [0.16, 0.097], [0.19, 0.079], [0.208, 0.055], [0.219, 0.033], [HEAD_H, 0.0]];
/** 頭の左右の倍率と、頭・髪・顔の拡大率（写実寄りの等身なので、どちらも 1。絵としての頭身にするときは変える） */
const HEAD_X = 1.03;
const HEAD_SCALE = 1.0;
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
/**
 * 鼻：頭の面そのものを盛り上げる（別の部品を貼ると、継ぎ目と玉が見えて不自然になる）。
 * 目のあいだの鼻筋からゆるやかに高くなり、鼻先（NOSE.tip の高さ）でいちばん出て、その下はすぐ引っ込む。小鼻は鼻先の左右に低く広く
 */
const NOSE = { top: 0.112, tip: 0.0705, bottom: 0.0632, height: 0.0112, width: 0.046, wing: 0.003, wingWidth: 0.125 };
function noseBump(y, a) {
  if (y < NOSE.bottom - 0.004 || y > NOSE.top || Math.abs(a) > 0.6) return 0;
  // 鼻筋：上から鼻先へ、なめらかに高くなる。鼻先の下は、短い距離で 0 へ
  const up = y >= NOSE.tip
    ? (1 - THREE.MathUtils.smoothstep(y, NOSE.tip, NOSE.top)) ** 2.3   // 鼻筋は、眉間から鼻先へゆるく反る（まっすぐだと柱に見える）
    : THREE.MathUtils.smoothstep(y, NOSE.bottom - 0.004, NOSE.tip);
  // 鼻筋は細く、鼻先へ向かって少し広く
  const w = NOSE.width * (0.62 + 0.38 * (1 - THREE.MathUtils.smoothstep(y, NOSE.tip, NOSE.top)));
  // 鼻先は、鼻筋より少し丸く出す
  const tip = 0.0026 * Math.exp(-(((y - NOSE.tip - 0.001) / 0.0055) ** 2)) * Math.exp(-((a / 0.065) ** 2));
  const ridge = NOSE.height * up * Math.exp(-((a / w) ** 2)) + tip;
  const wing = NOSE.wing * Math.exp(-(((y - 0.0675) / 0.0062) ** 2)) * Math.exp(-((a / NOSE.wingWidth) ** 2));
  return ridge + wing;
}
/** 顔にかかる髪のふちの高さ（頭の骨から）。まわりの角度 a（0 が正面） */
function hairline(a) {
  const f = Math.abs(a);
  // 前髪は、眉のすぐ上でまっすぐ切りそろえる（|a| 0.95 まで）。そこから外は、顔の横を下りる髪
  // 前髪の端は、目じりの外でほぼまっすぐ下へ折れる（斜めに欠けると、髪が足りないように見える）
  return THREE.MathUtils.lerp(0.1355 + Math.sin(a * 40) * 0.0006, 0.02, THREE.MathUtils.smoothstep(f, 0.9, 0.98));
}
/** 顔を正面から見た横の位置 x（m）での、生えぎわの高さ（顔の絵で使う） */
function hairlineAtX(x) {
  return hairline(Math.asin(THREE.MathUtils.clamp(x / 0.084, -1, 1)));
}
/**
 * 口もととあご：横顔の線を作る盛り上がり。上唇と下唇をわずかに前へ（合わせ目は少しくぼむ）、下唇の下はくぼみ、
 * あご先は丸く前へ出る。正面の幅は狭く（口の幅くらい）、横へはすぐ消える
 */
function mouthChin(y, a) {
  if (y > 0.062 || Math.abs(a) > 0.9) return 0;
  const g = (c, w) => Math.exp(-(((y - c) / w) ** 2));
  const lips = (0.0036 * g(0.0505, 0.0042) + 0.0034 * g(0.0395, 0.0045) - 0.0012 * g(0.0448, 0.0016)) * Math.exp(-((a / 0.27) ** 2));
  const dip = -0.0022 * g(0.029, 0.005) * Math.exp(-((a / 0.3) ** 2));
  const chin = 0.0068 * g(0.0145, 0.0095) * Math.exp(-((a / 0.36) ** 2));
  return lips + dip + chin;
}
/** 頭の半径：頭の骨からの高さ y、まわりの角度 a（0 が正面、±π/2 が横、π が後ろ）。前・横・後ろの輪郭を、向きでなめらかに混ぜる */
function headR(y, a = 0) {
  if (y >= HEAD_H) return 0;
  const c = Math.cos(a);
  const wf = c > 0 ? c * c : 0;
  const wb = c < 0 ? c * c : 0;
  const r = spline(HEAD_FRONT, y) * wf + spline(HEAD_BACK, y) * wb + spline(HEAD_SIDE, y) * (1 - wf - wb);
  // ほお：口の横から目の下にかけて、少しふくらませる（丸みのある顔に）
  const cheek = 0.0042 * Math.exp(-(((Math.abs(a) - 0.62) / 0.3) ** 2)) * Math.exp(-(((y - 0.062) / 0.03) ** 2));
  return Math.max(0, r) + cheek + noseBump(y, a) + mouthChin(y, a);
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
        // [骨, 骨, 重み, 重み] または [骨, 骨, 重み, 重み, 骨, 重み]（3 つの骨：スカートは腰と左右の腿）
        skinIndex.push(w[0], w[1], w[4] ?? 0, 0);
        skinWeight.push(w[2], w[3], w[5] ?? 0, 0);
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
    // 端のふた：管の端より少し小さくして、中に収める（同じ大きさだと、面が重なってぎざぎざの輪が出る）
    const rStart = profile[0][1] * 0.94;
    ball(upper, a, [rStart, rStart, rStart], typeof hex === 'function' ? hex(a) : hex, shade);
    const rEnd = profile[profile.length - 1][1] * 0.94;
    ball(lower, b, [rEnd, rEnd, rEnd], typeof hex === 'function' ? hex(b) : hex, shade);
  };

  /** 輪切りがだ円の管を、縦（y）に積む。rings は [高さ, 左右の半径, 前後の半径, 前へのずれ]（高さの低い順） */
  const stack = (rings, hex, shade, skin, { seg = 36, rows = 44, wave = null } = {}) => {
    const pos = [];
    const idx = [];
    const y0 = rings[0][0];
    const y1 = rings[rings.length - 1][0];
    for (let j = 0; j <= rows; j++) {
      const y = THREE.MathUtils.lerp(y0, y1, j / rows);
      const rx = spline(rings, y, 1);
      const rz = spline(rings, y, 2);
      const oz = rings[0].length > 3 ? spline(rings, y, 3) : 0;
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * Math.PI * 2;
        const k = wave ? wave(a, y) : 1;
        pos.push(Math.sin(a) * rx * k, y, Math.cos(a) * rz * k + oz);
      }
    }
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < seg; i++) {
        const k = j * (seg + 1) + i;
        idx.push(k, k + 1, k + seg + 1, k + 1, k + seg + 2, k + seg + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    B.add(g, new THREE.Matrix4(), 0, hex, shade, skin);
    g.dispose();
  };

  // スカートの中：腰と腿の付け根（ワンピースの裏地の色。低い所から見えても、ここまで）
  ball('hips', V(0, 0.9, 0), [0.15, 0.105, 0.108], SLIP, DRESS_SHADE);

  // 胴：ウエストからえり元まで、1 つのなめらかな形。骨の境目の上下 3cm は、2 つの骨で分け合う。
  // 長そでのニット（首まで）
  {
    const rings = [[0.98, 0.118, 0.084, 0.002], [1.04, 0.099, 0.071, 0.005], [1.1, 0.113, 0.083, 0.012], [1.15, 0.131, 0.097, 0.022], [1.19, 0.134, 0.09, 0.013],
      [1.235, 0.134, 0.076, 0.003], [1.265, 0.128, 0.068, 0], [1.29, 0.102, 0.062, 0], [1.308, 0.074, 0.058, 0], [1.322, 0.058, 0.055, 0]];
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
    stack(rings, DRESS, DRESS_SHADE, skin, { seg: 40, rows: 56 });
  }

  // スカート：ウエストからひざ上まで広がる。腰と左右の腿の骨で分け合う（下へ行くほど腿に付いていく）ので、
  // 歩けば脚に沿って揺れ、座れば腿の上に乗る。布の計算はしない
  {
    const rings = [[0.55, 0.25, 0.215, 0], [0.7, 0.222, 0.188, 0], [0.84, 0.19, 0.152, 0], [0.93, 0.16, 0.118, 0], [1.0, 0.122, 0.088, 0.002], [1.06, 0.1, 0.0725, 0.005]];
    const skin = (p) => {
      // 腰のすぐ下から腿に付きはじめ、下のほうはほぼ腿といっしょに動く（弱いと、足を組んだとき腿が突き抜ける）
      const leg = THREE.MathUtils.smoothstep(0.97 - p.y, 0, 0.2) * 0.96;
      const left = THREE.MathUtils.smoothstep(p.x, -0.05, 0.05);
      return [index.hips, index.leftUpperLeg, 1 - leg, leg * left, index.rightUpperLeg, leg * (1 - left)];
    };
    // すそへ向かって、ゆるいひだ（7 つの波）
    const wave = (a, y) => 1 + Math.sin(a * 7 + 0.6) * 0.035 * THREE.MathUtils.smoothstep(0.98 - y, 0, 0.4);
    const pleat = new THREE.Color();
    const fold = new THREE.Color(SKIRT_SHADE);
    const cloth = (p) => {
      const a = Math.atan2(p.x, p.z);
      const k = (0.5 - 0.5 * Math.sin(a * 7 + 0.6)) * THREE.MathUtils.smoothstep(0.98 - p.y, 0, 0.4);
      return pleat.setHex(SKIRT).lerp(fold, k * 0.6).getHex();
    };
    stack(rings, cloth, null, skin, { seg: 56, rows: 40, wave });
    // ウエストのリボン：帯を 1 周まわし、前の左寄りでちょう結び（輪 2 つ・結び目・短い垂れ 2 本）
    stack([[1.03, 0.107, 0.0775, 0.005], [1.048, 0.103, 0.0745, 0.0055], [1.066, 0.1035, 0.075, 0.006]], SKIRT_SHADE, null, () => [index.spine, index.hips, 0.6, 0.4], { seg: 40, rows: 4 });
    const kx = 0.04;
    const kz = 0.081;
    ball('spine', V(kx, 1.048, kz), [0.011, 0.011, 0.008], SKIRT_SHADE);
    for (const d of [1, -1]) {
      const g = new THREE.SphereGeometry(1, 12, 8);
      M.compose(V(kx + 0.027 * d, 1.052, kz - 0.003 * d), Q.setFromEuler(new THREE.Euler(0, 0.25 * d, 0.28 * d)), V(0.027, 0.014, 0.006));
      B.add(g, M, index.spine, SKIRT, SKIRT_SHADE);
      g.dispose();
      limb('hips', V(kx + 0.004 * d, 1.042, kz), V(kx + 0.022 * d, 0.93, kz + 0.022), 0.0075, 0.0085, SKIRT_SHADE, { seg: 6 });
    }
  }

  // 首：付け根は太く、上は細く。頭の中まで入れて、あごの下の面とつなぐ。少し前へ傾ける
  // 首の太さは、あごの幅の 7 割ほど（細いと、頭が棒の上に乗って見える）
  // 首は、あご先より後ろに立つ（前へ出ると、あごの下の影が無くなり、あごが首に埋もれる）。頭の中まで入れる
  stack([[1.292, 0.06, 0.056, -0.008], [1.32, 0.053, 0.05, -0.011], [1.338, 0.0455, 0.0455, -0.013], [rest.head.y, 0.0425, 0.044, -0.013], [rest.head.y + 0.05, 0.042, 0.044, -0.012]],
    SKIN, SKIN_SHADE, () => [index.neck, 0, 1, 0], { seg: 24, rows: 24 });
  // ハイネックのえり（首の下半分）
  stack([[1.29, 0.064, 0.06, -0.008], [1.315, 0.057, 0.054, -0.011], [1.337, 0.05, 0.0495, -0.013]], DRESS, DRESS_SHADE, () => [index.neck, index.upperChest, 0.7, 0.3], { seg: 24, rows: 8 });
  // 首の付け根から肩へ下る線（僧帽筋）。これが無いと、首が肩の上に立てた棒に見える
  for (const s of [1, -1]) limb('upperChest', V(0.028 * s, 1.318, -0.012), V(0.112 * s, 1.288, -0.006), 0.029, 0.032, DRESS, { shade: DRESS_SHADE, seg: 12 });

  for (const [side, s] of [['left', 1], ['right', -1]]) {
    const sh = rest[`${side}UpperArm`];
    const el = rest[`${side}LowerArm`];
    const wr = rest[`${side}Hand`];
    // 肩：胴の中から肩を通って二の腕へ。肩の関節の前後は、肩の骨と腕の骨で分け合う（長そで）
    tube(`${side}Shoulder`, `${side}UpperArm`, V(0.07 * s, sh.y - 0.012, 0), sh, V(sh.x + 0.07 * s, sh.y, 0),
      [[0, 0.045], [0.4, 0.045], [0.7, 0.042], [1, 0.0395]], DRESS, { shade: DRESS_SHADE, seg: 18, rows: 18, blend: 0.035 });
    {
      const a = V(sh.x + 0.05 * s, sh.y, 0);
      const tj = Math.abs(el.x - a.x) / Math.abs(wr.x - a.x);
      tube(`${side}UpperArm`, `${side}LowerArm`, a, el, wr, [[0, 0.0405], [0.2, 0.038], [tj, 0.032], [tj + 0.15, 0.0335], [0.88, 0.028], [1, 0.0265]], DRESS, { shade: DRESS_SHADE, seg: 14, blend: 0.035 });
    }
    // 手のひらと指
    // 手首から手のひらへ：丸い腕から、平たい手へ、段をつけずにつなぐ（付け根のふくらみ → 手のひら）
    ball(`${side}Hand`, V(wr.x + 0.012 * s, wr.y, 0.0005), [0.024, 0.0185, 0.0265], SKIN, SKIN_SHADE);
    ball(`${side}Hand`, V(wr.x + 0.042 * s, wr.y, 0.001), [0.044, 0.0138, 0.033], SKIN, SKIN_SHADE);
    for (const [finger] of FINGERS) {
      const names = ['Proximal', 'Intermediate', 'Distal'].map((j) => `${side}${finger}${j}`);
      names.forEach((name, i) => {
        const a = rest[name];
        const b = i < 2 ? rest[names[i + 1]] : V(a.x + FINGER_LEN[2] * s * (finger === 'Little' ? 0.8 : 1), a.y, a.z);
        limb(name, a, b, 0.0078 - i * 0.0008, 0.0072 - i * 0.0008, SKIN, { seg: 6 });
      });
    }
    {
      const a = rest[`${side}ThumbMetacarpal`];
      const b = rest[`${side}ThumbProximal`];
      const c2 = rest[`${side}ThumbDistal`];
      limb(`${side}ThumbMetacarpal`, a, b, 0.0105, 0.009, SKIN, { seg: 6 });
      limb(`${side}ThumbProximal`, b, c2, 0.0088, 0.0082, SKIN, { seg: 6 });
      limb(`${side}ThumbDistal`, c2, V(c2.x + 0.013 * s, c2.y, c2.z + 0.014), 0.0082, 0.0072, SKIN, { seg: 6 });
    }

    // 脚：腿 → ひざ → ふくらはぎ → 足首（素足）。腿の付け根は裏地の色
    const hip = rest[`${side}UpperLeg`];
    const knee = rest[`${side}LowerLeg`];
    const ankle = rest[`${side}Foot`];
    limb(`${side}UpperLeg`, V(hip.x, hip.y + 0.03, 0), V(hip.x, hip.y - 0.1, 0), 0.076, 0.072, SLIP, { caps: false, shade: SKIRT_SHADE, seg: 16 });
    {
      const a = V(hip.x, hip.y - 0.01, 0);
      const b = V(ankle.x, ankle.y - 0.012, 0);
      const tj = (a.y - knee.y) / (a.y - b.y);
      tube(`${side}UpperLeg`, `${side}LowerLeg`, a, knee, b, [[0, 0.073], [0.2, 0.067], [tj - 0.06, 0.05], [tj, 0.0465], [tj + 0.14, 0.0485], [0.84, 0.034], [0.94, 0.0292], [1, 0.0288]],
        // スカートに隠れる範囲（すその少し上まで）は、スカートの裏地の色にする。足を組む・またがるなどで
        // 腿がスカートを突き抜けても、肌ではなく布に見える（スカートが透けて見えるのを防ぐ）
        (p) => (p.y > SKIRT_HEM + 0.025 ? SLIP : SKIN), { shade: null, seg: 18, rows: 60, blend: 0.045 });
    }
    // 足と、かかとの低い靴
    // 足首から足へ：くるぶし・かかと・足の甲をつなぐ（すねの管をそのまま足に刺すと、棒に見える）
    // 足首の球は、すねの端より小さくして中に収める（大きいと、足首に輪をはめたように見える）
    ball(`${side}Foot`, V(ankle.x, ankle.y - 0.006, 0), [0.027, 0.03, 0.029], SKIN, SKIN_SHADE);
    ball(`${side}Foot`, V(ankle.x, 0.045, -0.014), [0.028, 0.038, 0.03], SKIN, SKIN_SHADE);
    {
      // 足の甲：足首から つま先へ下る
      const g = new THREE.SphereGeometry(1, 14, 10);
      M.compose(V(ankle.x, 0.052, 0.04), Q.setFromEuler(new THREE.Euler(0.42, 0, 0)), V(0.034, 0.026, 0.082));
      B.add(g, M, index[`${side}Foot`], SKIN, SKIN_SHADE);
      g.dispose();
    }
    ball(`${side}Foot`, V(ankle.x, 0.03, 0.045), [0.041, 0.028, 0.108], SHOE, SOLE);
    ball(`${side}Foot`, V(ankle.x, 0.012, 0.04), [0.04, 0.012, 0.1], SOLE);
  }

  // ここから頭・髪：頭の骨を中心に HEAD_SCALE 倍
  B.pre.makeTranslation(rest.head.x, rest.head.y, rest.head.z).scale(V(HEAD_SCALE, HEAD_SCALE, HEAD_SCALE)).multiply(new THREE.Matrix4().makeTranslation(-rest.head.x, -rest.head.y, -rest.head.z));
  // 頭：向きごとに輪郭の違う立体（headR）
  {
    const SEG = 84;
    const ROWS = 72;
    const pos = [];
    const idx = [];
    for (let j = 0; j <= ROWS; j++) {
      const y = (j / ROWS) * HEAD_H;
      for (let i = 0; i <= SEG; i++) {
        // 正面（鼻のあたり）を細かく、後ろを粗く分ける
        const u = (i / SEG) * 2 - 1;
        const a = Math.PI * Math.sign(u) * Math.abs(u) ** 1.7;
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
    // あごの下の面（あご先から首へ）・耳
    // あごの下は、首が頭の中まで入っているので、ふさぐ部品は置かない（置くと、あごにふたが付いて見える）
    // 耳：頭の横（少し後ろ）に、薄いだ円。この髪型では髪に隠れるので、髪から突き出ない大きさに
    for (const s of [1, -1]) {
      const ex = headR(0.098, Math.PI / 2 + 0.12) * HEAD_X;
      M.compose(V((ex - 0.006) * s, rest.head.y + 0.1, -0.016), Q.setFromEuler(new THREE.Euler(0.12, -0.3 * s, 0.06 * s)), V(0.005, 0.025, 0.0145));
      B.add(sphereGeo, M, index.head, SKIN, SKIN_SHADE);
      ball('head', V((ex - 0.006) * s, rest.head.y + 0.078, -0.012), [0.0045, 0.007, 0.006], SKIN, SKIN_SHADE);
    }
  }

  // 髪：黒のセミロング。前は生えぎわまで、横と後ろは肩の上まで下ろす（ゆるい波）
  {
    const hy = rest.head.y;
    const SEG = 72;
    const ROWS = 40;
    const TOP = HEAD_H + 0.014;
    const HAIRLINE = 0.172;
    const pos = [];
    const idx = [];
    /** まわりの角度（0 が正面）での、髪のすその高さ */
    const hem = (a) => {
      const f = Math.abs(a);
      // 前は切りそろえた前髪（hairline）。顔の横から後ろは、まっすぐ下ろす：横は肩の上まで、背中は肩甲骨の下まで
      // （横を長くすると、頭に固定した髪が肩の中へ入ってしまう）
      const side = THREE.MathUtils.smoothstep(f, 0.9, 1.0);
      const long = THREE.MathUtils.lerp(-0.088, -0.3, THREE.MathUtils.smoothstep(f, 1.75, 2.35)) + Math.sin(a * 17) * 0.003;
      return THREE.MathUtils.lerp(hairline(a), long, side);
    };
    for (let i = 0; i <= SEG; i++) {
      const a = (i / SEG) * Math.PI * 2 - Math.PI;
      const bottom = hem(a);
      for (let j = 0; j <= ROWS; j++) {
        const t = j / ROWS;
        const y = THREE.MathUtils.lerp(TOP, bottom, t * t * 0.35 + t * 0.65);
        // てっぺんは、頭の丸みに沿って閉じる。耳より下は、頭がすぼまっても髪はそのまま下ろし、すそへ少し広がって波打つ
        const yy = Math.max(0, y) * (HEAD_H / TOP);
        // ストレート：耳の下からは、ほぼまっすぐ下りる（背中へ向かって、体の厚みのぶんだけ外へ）
        const hang = y < 0.075 ? 0.089 + Math.min(0.075 - y, 0.12) * 0.07 + Math.max(0, -0.1 - y) * 0.09 * Math.max(0, -Math.cos(a)) : 0;
        // 髪の厚み：頭より 1.2cm ほど外（薄いと、地肌に貼り付いて見える）。てっぺんへ向かって閉じる
        // 頭の丸みから、まっすぐ下りる髪へは、耳の上あたりでなめらかに移る（急に切り替えると、髪に段ができる）
        const head = headR(yy, a);
        const body = THREE.MathUtils.lerp(head, Math.max(head, y < 0.075 ? hang : 0.089), THREE.MathUtils.smoothstep(0.125 - y, 0, 0.06));
        const r = Math.max(0.0005, body * 1.06 + 0.0115 * (1 - THREE.MathUtils.smoothstep(y, 0.195, TOP)));
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
    // 色：縦の細い筋（房ごとに明るさを変える）と、頭の上の少し下のつやの帯。毛先は少し暗く
    const hc = new THREE.Color();
    const hl = new THREE.Color(HAIR_LIGHT);
    const hd = new THREE.Color(HAIR_DARK);
    const part = new THREE.Color(0x9a7a68);
    const hairColor = (p) => {
      const ang = Math.atan2(p.x - rest.head.x, p.z - rest.head.z);
      const h = (p.y - rest.head.y) / HEAD_SCALE;
      const strand = 0.5 + 0.5 * Math.sin(ang * 47 + Math.sin(ang * 5) * 2);
      const ring = Math.exp(-(((h - 0.178) / 0.016) ** 2)) * (0.5 + 0.5 * Math.sin(ang * 37));
      hc.setHex(HAIR).lerp(hl, strand * 0.22 + ring * 0.8).lerp(hd, THREE.MathUtils.clamp((-0.05 - h) / 0.25, 0, 0.4));
      // 分け目：頭の真ん中の前半分に、細い明るい線（地肌）
      return hc.getHex();
    };
    B.add(g, new THREE.Matrix4(), index.head, hairColor, HAIR_DARK);
    g.dispose();
    // 顔の横の髪：こめかみから、肩の前を通って胸まで、まっすぐ下りる帯（左右）。上は頭の髪に重ね、下へ行くほど
    // 前へ出す（頭の髪と同じ筒のまま下ろすと、肩と胸の中へ入ってしまう）。毛先は少しだけ不ぞろいに
    for (const s of [1, -1]) {
      const COLS = 10;
      const ROWS2 = 30;
      const p2 = [];
      const i2 = [];
      for (let j = 0; j <= ROWS2; j++) {
        for (let i = 0; i <= COLS; i++) {
          const u = i / COLS;
          const ang = THREE.MathUtils.lerp(0.8, 1.72, u);
          const bottom = -0.335 + Math.sin(u * 9 + s) * 0.006 - u * 0.02;
          const y = THREE.MathUtils.lerp(0.15, bottom, j / ROWS2);
          const head = headR(Math.max(0, y) * (HEAD_H / TOP), ang * s);
          // 毛量：頭の髪より 1cm 外に、厚い束として重ねる（前の端は前髪の端に重なる）
          const round = THREE.MathUtils.lerp(head, Math.max(head, 0.088), THREE.MathUtils.smoothstep(0.125 - y, 0, 0.06)) * 1.06 + 0.021;
          const down = Math.max(0, -y);
          const forward = 0.062 * THREE.MathUtils.smoothstep(down, 0, 0.12) + 0.034 * THREE.MathUtils.smoothstep(down, 0.1, 0.26);
          const out = 0.012 * THREE.MathUtils.smoothstep(down, 0.02, 0.14);
          p2.push(Math.sin(ang) * (round + out) * HEAD_X * s, hy + y, Math.cos(ang) * round + forward * (1 - u * 0.45));
        }
      }
      for (let j = 0; j < ROWS2; j++) {
        for (let i = 0; i < COLS; i++) {
          const k = j * (COLS + 1) + i;
          i2.push(k, k + 1, k + COLS + 1, k + 1, k + COLS + 2, k + COLS + 1);
        }
      }
      const g2 = new THREE.BufferGeometry();
      g2.setAttribute('position', new THREE.Float32BufferAttribute(p2, 3));
      g2.setIndex(i2);
      g2.computeVertexNormals();
      B.add(g2, new THREE.Matrix4(), index.head, hairColor, HAIR_DARK);
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
const FACE = { x0: -0.078, x1: 0.078, y0: 0.004, y1: 0.182 };
/** 顔の板が、正面から左右へ回り込む角度（rad） */
const FACE_ANGLE = 0.98;
const EYE = { x: 0.031, y: 0.106, rx: 0.0158, ry: 0.0086 };

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
  const NX = 56;
  const NY = 56;
  const pos = [];
  const uv = [];
  const idx = [];
  for (let j = 0; j <= NY; j++) {
    const v = j / NY;
    const y = THREE.MathUtils.lerp(FACE.y0, FACE.y1, v);
    for (let i = 0; i <= NX; i++) {
      // 正面から左右へ FACE_ANGLE まで、頭の面に沿って置く。絵の横の位置は、正面から見た位置（x）で決める
      // （こうすると、正面から見た絵はゆがまず、横へ回り込むぶんだけ縮む）
      const u = (i / NX) * 2 - 1;
      const a = FACE_ANGLE * Math.sign(u) * Math.abs(u) ** 1.5;   // 正面（鼻のあたり）を細かく
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

  const INK = '#1c1412';

  /**
   * 目（切れ長）。side は +1 が女の子の左目（向かって右）。open は 0..1（まぶたの開き）、smile で下まぶたが上がり、
   * wide で見開く。ex / ey はひとみの向き（-1..1）
   */
  function eye(side, open, smile, wide, ex, ey) {
    const cx = px(EYE.x * side);
    const cy = py(EYE.y);
    const rx = EYE.rx * sx;
    const ry = EYE.ry * sy * (1 + wide * 0.35);
    const inX = cx - side * rx;            // 目がしら（鼻の側）
    const outX = cx + side * rx * 1.04;    // 目じり（少し外へ長く、少し上がる）
    const inY = cy + ry * 0.28;
    const outY = cy - ry * 0.16;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (open < 0.16) {
      // 閉じた目：まつげの線 1 本。笑顔は上へふくらむ弧、まばたきは下へふくらむ弧
      ctx.strokeStyle = INK;
      ctx.lineWidth = 4.2;
      ctx.beginPath();
      ctx.moveTo(inX, inY);
      ctx.quadraticCurveTo(cx, smile > 0.5 ? cy - ry * 0.9 : cy + ry * 1.25, outX, outY + ry * 0.25);
      ctx.stroke();
      return;
    }
    const lidY = cy - ry * (0.35 + 1.6 * open);        // 上まぶたの山の高さ
    const lowY = cy + ry * (1.15 - smile * 0.55);      // 下まぶたの谷（笑うと上がる）
    const upper = () => { ctx.moveTo(inX, inY); ctx.bezierCurveTo(cx - side * rx * 0.55, lidY, cx + side * rx * 0.45, lidY - ry * 0.15, outX, outY); };
    ctx.save();
    ctx.beginPath();
    upper();
    ctx.quadraticCurveTo(cx + side * rx * 0.15, lowY, inX, inY);
    ctx.closePath();
    ctx.clip();
    // 白目（上はまぶたの影）
    const white = ctx.createLinearGradient(0, cy - ry * 1.6, 0, cy + ry);
    white.addColorStop(0, '#b9b4b6');
    white.addColorStop(0.5, '#f6f3f1');
    white.addColorStop(1, '#fbf9f7');
    ctx.fillStyle = white;
    ctx.fillRect(cx - rx * 1.3, cy - ry * 2.4, rx * 2.6, ry * 4.2);
    // ひとみ：黒に近い茶。目の高さより大きく、上下はまぶたに隠れる
    const ir = EYE.ry * sy * 1.28;
    const ix = cx + ex * rx * 0.34;
    const iy = cy - ry * 0.12 - ey * ry * 0.3;
    const iris = ctx.createRadialGradient(ix, iy + ir * 0.25, ir * 0.1, ix, iy, ir);
    iris.addColorStop(0, '#6a4630');
    iris.addColorStop(0.7, '#3a2418');
    iris.addColorStop(1, '#1a100c');
    ctx.fillStyle = iris;
    ctx.beginPath();
    ctx.arc(ix, iy, ir, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0c0807';
    ctx.beginPath();
    ctx.arc(ix, iy, ir * 0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.beginPath();
    ctx.arc(ix - ir * 0.34, iy - ir * 0.36, ir * 0.17, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // 上まぶたの線とまつげ（目じりへ向かって太く、少しはね上げる）。下まぶたは細く薄く
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3.4;
    ctx.beginPath();
    upper();
    ctx.stroke();
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(outX - side * rx * 0.2, outY - ry * 0.12);
    ctx.lineTo(outX + side * rx * 0.2, outY - ry * 0.75);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(70,40,34,0.45)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(outX, outY);
    ctx.quadraticCurveTo(cx + side * rx * 0.15, lowY, inX + side * rx * 0.3, inY + ry * 0.25);
    ctx.stroke();
    // 二重の線（上まぶたの少し上に、平行な細い線）
    ctx.strokeStyle = 'rgba(150,96,84,0.6)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(inX + side * rx * 0.25, inY - ry * 0.75);
    ctx.bezierCurveTo(cx - side * rx * 0.4, lidY - ry * 0.85, cx + side * rx * 0.5, lidY - ry * 1.0, outX - side * rx * 0.05, outY - ry * 0.7);
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
    // ほお：ごく薄く。笑うと少し濃く
    for (const s of [1, -1]) {
      const cx = px(0.046 * s);
      const cy = py(0.072);
      const blush = ctx.createRadialGradient(cx, cy, 0, cx, cy, 0.026 * sx);
      blush.addColorStop(0, `rgba(226,120,116,${0.13 + happy * 0.14})`);
      blush.addColorStop(1, 'rgba(226,120,116,0)');
      ctx.fillStyle = blush;
      ctx.fillRect(cx - 0.03 * sx, cy - 0.03 * sy, 0.06 * sx, 0.06 * sy);
    }
    // 生えぎわ：センター分けで、おでこを出す。頭の髪のふち（hairline）より上を髪の色で塗り、ふちから下へ
    // 産毛のような細い毛を少し描く（ふちがまっすぐな線だと、かつらに見える）
    {
      // 塗るのは前髪の範囲だけ（目じりの外まで）。顔の横は立体の髪が覆う。横まで塗ると、目の横に細い筋が垂れて見える
      const BANG_X = 0.071;
      ctx.fillStyle = 'rgb(24,19,17)';
      ctx.beginPath();
      ctx.moveTo(px(-BANG_X), py(FACE.y1));
      for (let i = 0; i <= 40; i++) {
        const x = THREE.MathUtils.lerp(-BANG_X, BANG_X, i / 40);
        ctx.lineTo(px(x), py(hairline(0) + 0.0015));
      }
      ctx.lineTo(px(BANG_X), py(FACE.y1));
      ctx.closePath();
      ctx.fill();
    }
    // 目のまわりの影（まぶたのくぼみ）
    for (const s of [1, -1]) {
      const cx = px(EYE.x * s);
      const cy = py(EYE.y + 0.006);
      const shade = ctx.createRadialGradient(cx, cy, 0, cx, cy, 0.024 * sx);
      shade.addColorStop(0, 'rgba(150,96,84,0.22)');
      shade.addColorStop(1, 'rgba(150,96,84,0)');
      ctx.fillStyle = shade;
      ctx.fillRect(cx - 0.026 * sx, cy - 0.022 * sy, 0.052 * sx, 0.044 * sy);
    }
    // 目。笑顔は細め（下まぶたが上がる）、ゆるんだ顔は少しまぶたを下げ、驚きは見開く
    const base = 0.78 - happy * 0.3 - relaxed * 0.2 + surprised * 0.3;
    const openL = base * (1 - blink);
    const openR = base * (1 - blinkR);
    const closedSmile = happy > 0.9;
    eye(1, closedSmile ? 0 : openL, happy, surprised, ex, ey);
    eye(-1, closedSmile ? 0 : openR, closedSmile || blinkR - blink > 0.5 ? 1 : happy, surprised, ex, ey);
    // 眉：自然な太さ。眉がしらは太く、眉じりへ細く。驚きで上がる
    for (const s of [1, -1]) {
      const by = 0.1285 + surprised * 0.006;
      const x0 = px(0.012 * s);
      const x1 = px(0.034 * s);
      const x2 = px(0.052 * s);
      ctx.fillStyle = 'rgba(38,28,24,0.78)';
      ctx.beginPath();
      ctx.moveTo(x0, py(by - 0.0022));
      ctx.quadraticCurveTo(x1, py(by + 0.0052 + surprised * 0.002), x2, py(by + 0.0005));
      ctx.quadraticCurveTo(x1, py(by + 0.0026), x0, py(by - 0.0048));
      ctx.closePath();
      ctx.fill();
    }
    // 鼻：立体（頭の部品）。絵では、鼻の穴の小さな影だけ
    ctx.fillStyle = 'rgba(120,70,60,0.5)';
    for (const s of [1, -1]) {
      ctx.beginPath();
      ctx.ellipse(px(0.0052 * s), py(0.0655), 3.4, 1.7, s * 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
    // 唇。閉じているときは、上唇（山が 2 つ）と下唇（ふっくら）と、合わせ目の線。開きは「あ・お・え・い・う」の重みから
    const mx = px(0);
    const my = py(0.0445);
    const openAmt = Math.max(aa, oh * 0.8, ee * 0.5, ih * 0.3, ou * 0.5);
    const w = (0.0205 + happy * 0.0045 + ee * 0.003 + ih * 0.004 - ou * 0.007 - oh * 0.005) * sx;
    const gap = (aa * 0.011 + oh * 0.0095 + ee * 0.0045 + ih * 0.003 + ou * 0.005) * sy;   // 上下の唇のあいだ
    const lift = (happy * 0.0042 + relaxed * 0.0012) * sy;        // 口角の上がり
    const upH = 0.0042 * sy;
    const lowH = 0.0058 * sy;
    const cornerY = my - lift;
    if (openAmt >= 0.08) {
      // 口の中（上に歯、奥に舌）
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(mx - w, cornerY);
      ctx.quadraticCurveTo(mx, my - gap * 0.25, mx + w, cornerY);
      ctx.quadraticCurveTo(mx, my + gap * 2.1, mx - w, cornerY);
      ctx.closePath();
      ctx.fillStyle = '#5a2020';
      ctx.fill();
      ctx.clip();
      ctx.fillStyle = '#f4efe9';
      ctx.fillRect(mx - w, my - gap * 0.4, w * 2, gap * 0.55 + 2);
      ctx.fillStyle = '#c96a6a';
      ctx.beginPath();
      ctx.ellipse(mx, my + gap * 1.15, w * 0.6, gap * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    // 上唇
    ctx.fillStyle = '#c4696b';
    ctx.beginPath();
    ctx.moveTo(mx - w, cornerY);
    ctx.quadraticCurveTo(mx - w * 0.5, my - upH * 0.9, mx - w * 0.18, my - upH * 1.25);
    ctx.quadraticCurveTo(mx, my - upH * 0.75, mx + w * 0.18, my - upH * 1.25);
    ctx.quadraticCurveTo(mx + w * 0.5, my - upH * 0.9, mx + w, cornerY);
    ctx.quadraticCurveTo(mx, my + (openAmt >= 0.08 ? -gap * 0.25 : upH * 0.25), mx - w, cornerY);
    ctx.closePath();
    ctx.fill();
    // 下唇
    ctx.fillStyle = '#d27e7c';
    ctx.beginPath();
    const lowTop = openAmt >= 0.08 ? gap * 1.05 : upH * 0.25;
    ctx.moveTo(mx - w * 0.92, cornerY + (openAmt >= 0.08 ? gap * 0.35 : 0));
    ctx.quadraticCurveTo(mx, my + lowTop * 2 - (openAmt >= 0.08 ? 0 : upH * 0.25), mx + w * 0.92, cornerY + (openAmt >= 0.08 ? gap * 0.35 : 0));
    ctx.quadraticCurveTo(mx, my + lowTop * 2 + lowH * 1.9, mx - w * 0.92, cornerY + (openAmt >= 0.08 ? gap * 0.35 : 0));
    ctx.closePath();
    ctx.fill();
    // 下唇のつや
    ctx.fillStyle = 'rgba(255,235,230,0.28)';
    ctx.beginPath();
    ctx.ellipse(mx, my + lowTop * 2 + lowH * 0.55, w * 0.34, lowH * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
    if (openAmt < 0.08) {
      // 合わせ目の線（口角を少し長く。笑うと両端が上がる）
      ctx.strokeStyle = '#8a3c40';
      ctx.lineWidth = 1.8;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(mx - w * 1.04, cornerY - lift * 0.15);
      ctx.quadraticCurveTo(mx, my + upH * 0.6 + lift * 0.5, mx + w * 1.04, cornerY - lift * 0.15);
      ctx.stroke();
    }
    texture.needsUpdate = true;
  }

  draw({}, 0, 0);
  return { mesh, draw, state };
}
